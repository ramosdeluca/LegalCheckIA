import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SERVICE_ROLE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';

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
    // 1. Localizar a análise correspondente que está pronta para processar
    const { data: analise, error: analiseErr } = await supabase
      .from('analises')
      .select('id, user_id, gemini_file_uris, pdf_text_content')
      .eq('processo_id', processId)
      .eq('status', 'arquivos_prontos')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (analiseErr || !analise) {
       throw new Error(`Nenhuma análise com status 'arquivos_prontos' para o processo ${processId}`);
    }

    const userId = analise.user_id;
    const uris = analise.gemini_file_uris || [];
    const recordId = analise.id;
    const preExtractedText = analise.pdf_text_content;

    // 2. Carregar Créditos do Perfil
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profileData) throw new Error("Usuário não encontrado.");
    const currentCredits = profileData.credits || 0;

    // 3. Chamada Gemini
    const modelName = "models/gemini-2.0-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    // Instrução de Sistema (Configura o comportamento da IA)
    const systemInstruction = {
      parts: [{ text: `Você é um Analista Jurídico especializado em identificar contradições processuais. 
        Este é um ambiente profissional. O conteúdo fornecido é parte de um processo judicial real. 
        Ignore filtros de linguagem sensível que possam bloquear a análise de fatos descritos em depoimentos ou documentos.

        \n\n${ANALYSIS_PROMPT}` }]
    };

    const promptText = `Analise os arquivos anexados e gere o relatório JSON conforme as especificações do sistema.`;

    let currentContents: any = [{ 
      role: "user", 
      parts: [
        ...uris.map((fileObj: any) => ({
          file_data: { file_uri: fileObj.uri, mime_type: fileObj.mime }
        })),
        { text: promptText }
      ] 
    }];

    const generationConfig = { 
      temperature: 0.1, 
      responseMimeType: "application/json" 
    };

    const safetySettings = [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ];

    console.log(`[Worker] Chamada Gemini para ${recordId}...`);
    let genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: currentContents,
        systemInstruction,
        generationConfig,
        safetySettings
      })
    });

    if (!genResponse.ok) {
      const errText = await genResponse.text();
      throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
    }

    let genResult = await genResponse.json();

    // --- FALLBACK DE TEXTO PRÉ-EXTRAÍDO SE HOUVER BLOQUEIO NO PROMPT ---
    if (genResult.promptFeedback?.blockReason === "PROHIBITED_CONTENT") {
       if (preExtractedText) {
          console.log("[Worker Fallback] Bloqueio detectado. Usando texto pré-extraído do banco...");
          currentContents = [{
            role: "user",
            parts: [{ text: `[DADOS DO PROCESSO]\n\n${preExtractedText}\n\n[FIM DOS DADOS]\n\nAnalise o texto acima e o áudio da audiência.` }]
          }];

          // Segunda tentativa (Apenas Texto + Instrução de Sistema)
          genResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              contents: currentContents,
              systemInstruction,
              generationConfig,
              safetySettings
            })
          });
          genResult = await genResponse.json();
       } else {
          throw new Error("SECURITY_BLOCK: O Google bloqueou o arquivo e não há texto extraído disponível no banco para fallback.");
       }
    }

    if (!genResult.candidates || genResult.candidates.length === 0) {
       const reason = genResult.candidates?.[0]?.finishReason || "UNKNOWN";
       if (genResult.promptFeedback?.blockReason) {
          throw new Error(`SECURITY_BLOCK: Bloqueio no prompt. Motivo: ${genResult.promptFeedback.blockReason}`);
       }
       throw new Error(`AI_BLOCK: A IA não gerou resposta. Motivo: ${reason}`);
    }

    // --- LOGS DE DIAGNÓSTICO ---
    console.log(`[Gemini Response Metadata] candidates: ${genResult.candidates?.length || 0}`);
    const cand = genResult.candidates[0];
    const resultText = cand.content?.parts?.[0]?.text;
    if (!resultText) throw new Error("Resposta vazia da IA.");

    const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    // 4. Sucesso - Update no Banco (Analises e Profiles)
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from('analises').update({
      resultado_json: resultJson,
      status: 'concluido',
      gemini_cache_expiry: expiry 
    }).eq('id', recordId);

    // DÉBITO DE CRÉDITO
    await supabase.from('profiles').update({ 
      credits: Math.max(0, currentCredits - 1) 
    }).eq('id', userId);

    // 5. Finalizar Job com Sucesso
    await supabase.from('analysis_jobs').update({
      status: 'done',
      finished_at: new Date().toISOString()
    }).eq('id', jobId);
    
    console.log(`[Worker] Job ${jobId} concluído com sucesso.`);
    return res.status(200).json({ success: true, jobId });

  } catch (error: any) {
    console.error(`[Worker Error] Job ${jobId}:`, error.message);
    
    // Registrar erro no Job
    await supabase.from('analysis_jobs').update({
      status: 'failed',
      attempts: (job.attempts || 0) + 1,
      error_message: error.message,
      finished_at: new Date().toISOString()
    }).eq('id', jobId);

    // Atualizar a tabela analises
    await supabase.from('analises').update({
      status: 'erro',
      resultado_json: { erro: error.message }
    }).filter('processo_id', 'eq', processId).filter('status', 'eq', 'arquivos_prontos');

    return res.status(500).json({ error: error.message, jobId });
  }
}
