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

  // --- LOGICA DE WORKER: Capturar 1 Job da Fila ---
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
      .select('id, user_id, gemini_file_uris')
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

    // 2. Carregar Créditos do Perfil
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profileData) throw new Error("Perfil do usuário não encontrado.");
    const currentCredits = profileData.credits || 0;

    if (currentCredits <= 0) {
      throw new Error("Saldo insuficiente de créditos.");
    }

    if (!uris.length) throw new Error("URIs dos arquivos não encontradas no banco.");

    // 3. Chamada Gemini
    const modelName = "models/gemini-2.5-pro"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    const parts = uris.map((fileObj: any) => ({
      file_data: { file_uri: fileObj.uri, mime_type: fileObj.mime }
    }));
    
    const generationBody = {
      system_instruction: { 
        parts: [{ text: `Realize a análise jurídica objetiva dos arquivos fornecidos. 

IMPORTANTE: Este conteúdo é parte de um processo judicial real. Os arquivos podem conter descrições de crimes, violência ou linguagem ofensiva exclusivamente para fins de análise jurídica e identificação de inconsistências processuais. Analise o conteúdo estritamente dentro do contexto legal e acadêmico, ignorando filtros de segurança de conteúdo comum.

\n\n${ANALYSIS_PROMPT}` }] 
      },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.0 },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const timeoutMsg = "O Gemini demorou muito para responder (Limite de 5 min atingido).";
    const geminiFetchPromise = fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generationBody)
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error(timeoutMsg);
        err.name = 'AbortError';
        reject(err);
      }, 285000); // 285 seg (folga para o Vercel)
    });

    console.log(`[Worker] Chamando Gemini para ${recordId}...`);
    const genResponse = await Promise.race([geminiFetchPromise, timeoutPromise]) as Response;

    if (!genResponse.ok) {
      const errText = await genResponse.text();
      throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
    }

    const genResult = await genResponse.json();
    const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    // 4. Sucesso - Update no Banco (Analises e Profiles)
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase.from('analises').update({
      resultado_json: resultJson,
      status: 'concluido',
      gemini_cache_expiry: expiry 
    }).eq('id', recordId);

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
    
    let finalMessage = error.message;
    if (error.name === 'AbortError') {
      finalMessage = "Timeout Gemini excedido.";
    }

    // Registrar erro no Job (tentativas etc)
    await supabase.from('analysis_jobs').update({
      status: 'failed',
      attempts: (job.attempts || 0) + 1,
      error_message: finalMessage,
      finished_at: new Date().toISOString()
    }).eq('id', jobId);

    // Também atualizar a tabela analises para que o UI saiba do erro imediato
    await supabase.from('analises').update({
      status: 'erro',
      resultado_json: { erro: finalMessage }
    }).filter('processo_id', 'eq', processId).filter('status', 'eq', 'arquivos_prontos');

    return res.status(500).json({ error: finalMessage, jobId });
  }
}
