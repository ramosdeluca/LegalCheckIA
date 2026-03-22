import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SERVICE_ROLE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
const deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';

const ANALYSIS_PROMPT = `
REQUISITO DE FORMATAÇÃO (Obrigatório retornar em JSON):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações.
2. "analise_tendencia": Aponte a tendência geral da prova de forma direta.
3. "contradicoes": Liste no máximo as 5 contradições mais relevantes contendo:
   - "timestamp": DEVE seguir o formato EXATO: 'Áudio X - MM:SS' (ex: 'Áudio 2 - 04:20').
   - "tipo_contradicao": Tipo da contradição (ex: Factual, Depoimento contraditório, Documental).
   - "gravidade": Nível de impacto (Alta, Média ou Baixa).
   - "o_que_foi_dito": Personagem + transcrição fiel e MAIS DETALHADA da fala CITANDO O ÁUDIO DE ORIGEM. Máximo 3 linhas.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório no processo.
   - "explicacao": Impacto jurídica da contradição.
`;

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function transcribeWithDeepgram(apiKey: string, audioUrl: string, index: number) {
  console.log(`[Deepgram] Transcrevendo áudio ${index + 1} (${audioUrl})...`);
  try {
    const url = `https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&language=pt-BR&utterances=true&punctuate=true`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ url: audioUrl })
    });

    if (!response.ok) {
        const err = await response.text();
        console.warn(`[Deepgram Error]`, err);
        return `[Erro Deepgram no áudio ${index + 1}]`;
    }

    const res = await response.json();
    const utterances = res.results.utterances || [];
    
    if (utterances.length === 0) {
        return `--- INÍCIO DO ARQUIVO: ÁUDIO ${index + 1} ---\n[Sem fala detectada ou áudio muito curto]\n--- FIM DO ÁUDIO ${index + 1} ---\n\n`;
    }

    const transcriptWithTimestamps = utterances
        .map((u: any) => `[${formatTime(u.start)}] - Áudio ${index + 1}: "${u.transcript}"`)
        .join('\n');
    
    return `--- INÍCIO DO ARQUIVO: ÁUDIO ${index + 1} ---\n${transcriptWithTimestamps}\n--- FIM DO ÁUDIO ${index + 1} ---\n\n`;
  } catch (err: any) {
    console.error(`[Deepgram Fatal]`, err.message);
    return `[Erro crítico no Deepgram áudio ${index + 1}]`;
  }
}

async function callClaude(apiKey: string, text: string, transcript: string, prompt: string) {
  console.log("[Worker Fallback] Acionando Claude 3.5 Sonnet para análise de elite...");
  
  const cleanPdf = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '')
    .replace(/\u0000/g, '') // Sanitize nulls
    .trim()
    .slice(0, 150000); // 150k chars p/ caber no contexto do Claude 3.5 Sonnet (200k tokens)

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0,
      system: `Você é um Promotor de Justiça e Analista Judiciário Sênior de alto escalão. Sua missão é realizar um confronto exaustivo entre a transcrição etiquetada e o PDF do processo para encontrar contradições.\n\nREQUISITO CRÍTICO DE ANCORAGEM: Cada linha de fala na transcrição já está rotulada com o número do áudio, exemplo: '[02:15] - Áudio 1: \"Texto\"'.\n\nNo campo 'timestamp' do JSON, você DEVE combinar a etiqueta com o tempo, exatamente no formato: 'Áudio X - MM:SS'. Exemplo: 'Áudio 1 - 02:15'.\n\nSua análise deve ser incisiva, técnica e investigativa. Nunca resuma se houver detalhes relevantes.`,
      messages: [
        { role: "user", content: `TRANSCRIÇÃO DA AUDIÊNCIA (ETIQUETADA):\n${transcript}\n\nCONTEÚDO DO PROCESSO (PDF):\n${cleanPdf}\n\n${prompt}\n\nRetorne APENAS um objeto JSON puro, sem conversinhas.` }
      ]
    })
  });
  
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude Error: ${response.status} - ${errText}`);
  }
  
  const result = await response.json();
  const content = result.content[0].text;
  
  // Extração robusta de JSON caso o Claude adicione texto explicativo
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : content;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { data: jobData, error: dequeueErr } = await supabase.rpc('dequeue_analysis_job').maybeSingle();
  const job = jobData as any;
  if (dequeueErr || !job) return res.status(200).json({ message: "No jobs" });

  const processId = job.process_id;
  const jobId = job.id;
  console.log(`[Worker] Job ${jobId} para Processo ${processId}`);

  try {
    const { data: analise, error: analiseErr } = await supabase
      .from('analises')
      .select('id, user_id, gemini_file_uris, pdf_text_content, video_urls')
      .eq('processo_id', processId)
      .eq('status', 'arquivos_prontos')
      .maybeSingle();

    if (analiseErr || !analise) throw new Error("Análise incompleta.");

    const uris = analise.gemini_file_uris || [];
    const mediaUrlsToTranscribe = analise.video_urls || [];
    const recordId = analise.id;
    const preExtractedText = analise.pdf_text_content || "";

    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', analise.user_id).single();
    const currentCredits = profile?.credits || 0;

    const modelName = "models/gemini-2.5-pro"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    console.log(`[Worker] Tentando Gemini (${modelName})...`);
    let genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        contents: [{ role: "user", parts: [...uris.map((f: any) => ({ file_data: { file_uri: f.uri, mime_type: f.mime } })), { text: "Analise contradições exaustivamente." }] }],
        system_instruction: { parts: [{ text: `Analista Jurídico de Elite.\n\n${ANALYSIS_PROMPT}` }] },
        generation_config: { temperature: 0.1, response_mime_type: "application/json" },
        safety_settings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }] 
      })
    });

    let finalResultText = "";
    let capturedTranscript = "";

    if (genResponse.ok) {
       const genResult = await genResponse.json();
       if (genResult.promptFeedback?.blockReason === "PROHIBITED_CONTENT" || !genResult.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.log("[Worker Fallback] Google bloqueou. Ativando Claude Fallback...");
          if (anthropicApiKey && deepgramApiKey) {
            let fullTranscript = "";
            for (let i = 0; i < mediaUrlsToTranscribe.length; i++) {
              fullTranscript += await transcribeWithDeepgram(deepgramApiKey, mediaUrlsToTranscribe[i], i);
            }
            capturedTranscript = fullTranscript.replace(/\u0000/g, ''); 
            finalResultText = await callClaude(anthropicApiKey, preExtractedText, fullTranscript, ANALYSIS_PROMPT);
          } else {
            throw new Error("BLOCK: Chaves API não configuradas para fallback (ANTHROPIC + DEEPGRAM).");
          }
       } else {
          finalResultText = genResult.candidates[0].content.parts[0].text;
       }
    } else {
       console.warn("[Worker] Erro Gemini. Ativando Claude Resgate...");
       if (anthropicApiKey) {
          finalResultText = await callClaude(anthropicApiKey, preExtractedText, "Sem transcrição (erro Gemini).", ANALYSIS_PROMPT);
       } else {
          const errText = await genResponse.text();
          throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
       }
    }

    if (!finalResultText) throw new Error("Falha total IA.");
    const resultJson = JSON.parse(finalResultText.replace(/```json\n?|```/g, '').trim());

    await supabase.from('analises').update({ 
      resultado_json: resultJson, 
      status: 'concluido',
      audio_transcription: capturedTranscript || null
    }).eq('id', recordId);
    
    await supabase.from('profiles').update({ credits: Math.max(0, currentCredits - 1) }).eq('id', analise.user_id);
    await supabase.from('analysis_jobs').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', jobId);
    
    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error(`[Worker Error]`, error.message);
    await supabase.from('analysis_jobs').update({ status: 'failed', error_message: error.message }).eq('id', jobId);
    await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: error.message } }).eq('id', job.analise_id);
    return res.status(500).json({ error: error.message });
  }
}
