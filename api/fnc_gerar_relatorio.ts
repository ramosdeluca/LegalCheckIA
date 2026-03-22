import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SERVICE_ROLE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';
const deepgramApiKey = process.env.DEEPGRAM_API_KEY || '';

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
   - "explicacao": Impacto jurídica da contradição.
`;

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function transcribeWithDeepgram(apiKey: string, audioUrl: string, index: number) {
  console.log(`[Deepgram Fallback] Transcrevendo áudio ${index + 1} (${audioUrl})...`);
  try {
    // Deepgram Nova-2-Legal com suporte a URL direta (muito mais rápido)
    const url = `https://api.deepgram.com/v1/listen?model=nova-2-legal&smart_format=true&language=pt-BR&utterances=true&punctuate=true`;
    
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
        return `--- TRANSCRIÇÃO DE ÁUDIO ${index + 1} ---\n[Sem fala detectada ou áudio muito curto]\n`;
    }

    const transcriptWithTimestamps = utterances
        .map((u: any) => `[${formatTime(u.start)}] ${u.transcript}`)
        .join('\n');
    
    return `--- TRANSCRIÇÃO DE ÁUDIO ${index + 1} ---\n${transcriptWithTimestamps}\n\n`;
  } catch (err: any) {
    console.error(`[Deepgram Fatal]`, err.message);
    return `[Erro crítico no Deepgram áudio ${index + 1}]`;
  }
}

async function callOpenAI(apiKey: string, text: string, transcript: string, prompt: string) {
  console.log("[Worker Fallback] Chamando OpenAI GPT-4o-mini (com transcrição Deepgram Nova-2-Legal)...");
  
  const cleanPdf = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '')
    .replace(/\u0000/g, '') // Sanitize nulls
    .trim()
    .slice(0, 300000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um Desembargador revisor altamente qualificado e extremamente detalhista. Use o formato JSON.\n\nSua missão é realizar um confronto analítico entre o PDF do processo e as falas da audiência. Use as marcações de tempo [MM:SS] fornecidas pela transcrição para garantir que o relatório final coincida exatamente com o vídeo/áudio do advogado." },
        { role: "user", content: `CONTEÚDO DO PROCESSO (PDF):\n${cleanPdf}\n\nTRANSCRIÇÃO DA AUDIÊNCIA (DEEPGRAM NOVA-2-LEGAL):\n${transcript}\n\n${prompt}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
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
          console.log("[Worker Fallback] Google bloqueou. Ativando Deepgram Fallback...");
          if (openaiApiKey && deepgramApiKey) {
            let fullTranscript = "";
            for (let i = 0; i < mediaUrlsToTranscribe.length; i++) {
              fullTranscript += await transcribeWithDeepgram(deepgramApiKey, mediaUrlsToTranscribe[i], i);
            }
            capturedTranscript = fullTranscript.replace(/\u0000/g, ''); // Sanitizar null chars
            finalResultText = await callOpenAI(openaiApiKey, preExtractedText, fullTranscript, ANALYSIS_PROMPT);
          } else {
            throw new Error("BLOCK: Chaves API (OpenAI ou Deepgram) não configuradas para fallback.");
          }
       } else {
          finalResultText = genResult.candidates[0].content.parts[0].text;
       }
    } else {
       console.warn("[Worker] Erro Gemini. Tentando resgate OpenAI...");
       if (openaiApiKey) {
          finalResultText = await callOpenAI(openaiApiKey, preExtractedText, "Sem transcrição (erro Gemini).", ANALYSIS_PROMPT);
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
