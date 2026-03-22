import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SERVICE_ROLE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

const ANALYSIS_PROMPT = `
REQUISITO DE FORMATAÇÃO (Obrigatório retornar em JSON):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações.
2. "analise_tendencia": Aponte a tendência geral da prova de forma direta.
3. "contradicoes": Liste no máximo as 5 contradições mais relevantes contendo:
   - "timestamp": Formato "Áudio X - MM:SS".
   - "tipo_contradicao": Tipo da contradição (ex: Factual, Depoimento contraditório, Documental).
   - "gravidade": Nível de impacto (Alta, Média ou Baixa).
   - "o_que_foi_dito": Personagem + transcrição fiel e MAIS DETALHADA da fala. Máximo 3 linhas.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório no processo.
   - "explicacao": Impacto jurídico da contradição.
`;

async function callOpenAI(apiKey: string, text: string, prompt: string) {
  console.log("[Worker Fallback] Chamando OpenAI GPT-4o-mini (com limpeza de tokens)...");
  
  // Limpeza de texto para economizar tokens e evitar erro 429
  const cleanText = text
    .replace(/\s+/g, ' ')           // Reduz espaços e quebras múltiplas
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '') // Remove caracteres especiais ruidosos
    .trim()
    .slice(0, 450000);              // Limite aprox de 150k tokens (margem de segurança)

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um assistente jurídico sênior. Analise o processo e retorne APENAS o JSON solicitado." },
        { role: "user", content: `CONTEXTO DO PROCESSO (DADOS TÉCNICOS):\n${cleanText}\n\n${prompt}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI Error: ${response.status} - ${errText}`);
  }
  
  const result = await response.json();
  return result.choices[0].message.content;
}

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ---- LOGICA DE WORKER: Capturar 1 Job da Fila ---
  const { data: jobData, error: dequeueErr } = await supabase.rpc('dequeue_analysis_job').maybeSingle();
  const job = jobData as any;

  if (dequeueErr) {
    console.error("[Worker] Erro ao capturar job:", dequeueErr.message);
    return res.status(500).json({ error: dequeueErr.message });
  }

  if (!job) {
    console.log("[Worker] Nenhum job pendente na fila.");
    return res.status(200).json({ message: "No jobs to process" });
  }

  const processId = job.process_id;
  const jobId = job.id;
  console.log(`[Worker] Iniciando processamento do Job ${jobId} para Processo ${processId}`);

  try {
    const { data: analise, error: analiseErr } = await supabase
      .from('analises')
      .select('id, user_id, gemini_file_uris, pdf_text_content')
      .eq('processo_id', processId)
      .eq('status', 'arquivos_prontos')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (analiseErr || !analise) throw new Error("Análise não encontrada.");

    const userId = analise.user_id;
    const uris = analise.gemini_file_uris || [];
    const recordId = analise.id;
    const preExtractedText = analise.pdf_text_content;

    // Carregar Créditos
    const { data: profileData } = await supabase.from('profiles').select('credits').eq('id', userId).single();
    const currentCredits = profileData?.credits || 0;

    // 1. TENTATIVA GEMINI
    const modelName = "models/gemini-2.5-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    const systemInstruction = {
      parts: [{ text: `Você é um Analista de Dados Técnicos. Sua missão é identificar inconsistências lógicas.\n\n${ANALYSIS_PROMPT}` }]
    };

    const promptText = `Analise os arquivos e identifique contradições.`;

    const currentContents = [{ 
      role: "user", 
      parts: [
        ...uris.map((fileObj: any) => ({ file_data: { file_uri: fileObj.uri, mime_type: fileObj.mime } })),
        { text: promptText }
      ] 
    }];

    console.log(`[Worker] Tentando Gemini para ${recordId}...`);
    let genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: currentContents,
        system_instruction: systemInstruction,
        generation_config: { temperature: 0.1, response_mime_type: "application/json" },
        safety_settings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    let finalResultText = "";

    if (genResponse.ok) {
       const genResult = await genResponse.json();
       if (genResult.promptFeedback?.blockReason === "PROHIBITED_CONTENT" || !genResult.candidates || genResult.candidates.length === 0) {
          console.log("[Worker Fallback] Gemini bloqueou ou falhou. Tentando OpenAI...");
          if (openaiApiKey) {
            finalResultText = await callOpenAI(openaiApiKey, preExtractedText || "Sem texto extraído.", ANALYSIS_PROMPT);
          } else {
            throw new Error("SECURITY_BLOCK: Gemini bloqueou e OPENAI_API_KEY não configurada.");
          }
       } else {
          finalResultText = genResult.candidates[0].content.parts[0].text;
       }
    } else {
       console.warn("[Worker] Erro na API do Gemini. Tentando OpenAI de resgate...");
       if (openaiApiKey) {
          finalResultText = await callOpenAI(openaiApiKey, preExtractedText || "Sem texto extraído.", ANALYSIS_PROMPT);
       } else {
          const errText = await genResponse.text();
          throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
       }
    }

    if (!finalResultText) throw new Error("Falha ao obter resposta de ambas as IAs.");

    const cleanJson = finalResultText.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    // Sucesso - Update no Banco
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from('analises').update({ resultado_json: resultJson, status: 'concluido', gemini_cache_expiry: expiry }).eq('id', recordId);
    await supabase.from('profiles').update({ credits: Math.max(0, currentCredits - 1) }).eq('id', userId);
    await supabase.from('analysis_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId);
    
    console.log(`[Worker] Job ${jobId} concluído com sucesso.`);
    return res.status(200).json({ success: true, jobId });

  } catch (error: any) {
    console.error(`[Worker Error] Job ${jobId}:`, error.message);
    await supabase.from('analysis_jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, error_message: error.message, finished_at: new Date().toISOString() }).eq('id', jobId);
    await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: error.message } }).filter('processo_id', 'eq', processId).filter('status', 'eq', 'arquivos_prontos');
    return res.status(500).json({ error: error.message, jobId });
  }
}
