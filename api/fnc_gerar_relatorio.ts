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

async function waitForFileActive(fileUri: string, apiKey: string) {
  const fileName = fileUri.split('/').pop();
  if (!fileName || !fileName.startsWith('files/')) return true;
  
  const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`;
  
  for (let i = 0; i < 40; i++) { // Aumentado para 40 tentativas (aprox 3min) para PDFs grandes
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.state === 'ACTIVE') return true;
        if (data.state === 'FAILED') throw new Error(`Google indexing failed for ${fileName}`);
        console.log(`[Worker Sync] ${fileName} status: ${data.state}...`);
      } else {
        console.log(`[Worker Sync] Erro ao checar status (HTTP ${res.status})...`);
      }
    } catch (e: any) {
      console.warn(`[Worker Sync] Poll error:`, e.message);
    }
    await new Promise(r => setTimeout(r, 4500));
  }
  return false;
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
    // 1. Localizar a análise correspondente que está pronta para processar
    const { data: analise, error: analiseErr } = await supabase
      .from('analises')
      .update({ status: 'analisando' })
      .eq('processo_id', processId)
      .eq('status', 'arquivos_prontos')
      .select('id, user_id, gemini_file_uris')
      .maybeSingle();

    if (analiseErr || !analise) {
       console.log(`[Worker] Análise já em andamento ou não encontrada para ${processId}`);
       return res.status(200).json({ message: "Job skipping" });
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

    // ---- SINCRONIZAÇÃO DE MÍDIA ----
    console.log(`[Worker] Sincronizando ${uris.length} arquivos no Gemini...`);
    for (const f of uris) {
      const active = await waitForFileActive(f.uri, geminiApiKey);
      if (!active) {
          console.warn(`[Worker] Timeout na indexação do arquivo: ${f.uri}`);
          await supabase.from('analises').update({ status: 'arquivos_prontos' }).eq('id', recordId);
          await supabase.from('analysis_jobs').update({ status: 'pending', scheduled_for: new Date().toISOString() }).eq('id', jobId);
          return res.status(200).json({ message: "Polling timeout. Job rescheduled." });
      }
    }

    // Delay estratégico de 5s após polling para evitar race condition
    await new Promise(r => setTimeout(r, 5000));

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

    let genResult: any = null;
    let success = false;
    let localRetries = 0;

    while (localRetries < 3 && !success) {
      console.log(`[Worker] Chamada Gemini (Tentativa Local ${localRetries + 1})...`);
      const genResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody)
      });

      if (!genResponse.ok) {
        const errText = await genResponse.text();
        throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
      }

      genResult = await genResponse.json();

      // DEBUG LOGS - O que o Gemini está retornando?
      console.log(`[Gemini Response Metadata] candidates: ${genResult.candidates?.length || 0}`);
      if (genResult.promptFeedback) console.log(`[Gemini Prompt Feedback]`, JSON.stringify(genResult.promptFeedback));
      
      if (genResult.candidates?.[0]) {
        const cand = genResult.candidates[0];
        console.log(`[Gemini Candidate 0] FinishReason: ${cand.finishReason}`);
        if (cand.safetyRatings) console.log(`[Gemini Safety Ratings]`, JSON.stringify(cand.safetyRatings));
        
        if (cand.finishReason === 'SAFETY') {
          console.error("❌ BLOQUEIO DE SEGURANÇA DETECTADO!");
          throw new Error("O Gemini bloqueou o conteúdo por segurança (SAFETY). Revise os arquivos.");
        }
      }

      if (genResult.error) {
        const msg = genResult.error.message || "";
        if (msg.toLowerCase().includes("still processing") || msg.toLowerCase().includes("not in an active state")) {
          localRetries++;
          console.warn("[Worker] Gemini reportou indexação incompleta. Esperando 10s...");
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }
        throw new Error(`Gemini API Error: ${msg}`);
      }
      success = true;
    }

    const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText) {
      console.error("[Worker] RESPOSTA VAZIA DO GEMINI. Verifique Logs de Metadata acima.");
      throw new Error("Resposta vazia da Inteligência Artificial. Pode ser um bloqueio silencioso.");
    }

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
    
    // Incrementa tentativas
    await supabase.rpc('increment_job_attempts', { job_id: jobId });

    // Volta status para arquivos_prontos para permitir retry
    if (processId) {
      await supabase.from('analises').update({ 
        status: 'arquivos_prontos',
        resultado_json: { erro: error.message }
      }).eq('processo_id', processId).eq('status', 'analisando');
    }

    return res.status(500).json({ error: error.message, jobId });
  }
}
