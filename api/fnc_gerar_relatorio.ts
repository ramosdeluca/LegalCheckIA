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
   - "explicacao": Impacto jurídica da contradição.
`;

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function transcribeAudio(apiKey: string, audioUrl: string, index: number) {
  console.log(`[Whisper Fallback] Transcrevendo áudio ${index + 1}...`);
  try {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) return `[Erro ao baixar áudio ${index + 1}]`;
    const arrayBuffer = await audioResp.arrayBuffer();
    const fullBuffer = new Uint8Array(arrayBuffer);
    
    const CHUNK_SIZE = 24 * 1024 * 1024;
    const OVERLAP = 16000; // 1 segundo (8000 samples * 2 bytes)
    
    if (fullBuffer.length <= CHUNK_SIZE) {
      return await sendToWhisper(apiKey, fullBuffer, index);
    } else {
      console.log(`[Whisper] Arquivo grande (${(fullBuffer.length / 1024 / 1024).toFixed(1)}MB). Fatiando...`);
      let combinedText = "";
      const pcmData = fullBuffer.slice(44); 
      const chunkCount = Math.ceil(pcmData.length / CHUNK_SIZE);
      
      for (let i = 0; i < chunkCount; i++) {
        const start = Math.max(0, i * CHUNK_SIZE - (i > 0 ? OVERLAP : 0));
        const end = Math.min(start + CHUNK_SIZE, pcmData.length);
        const chunkPcm = pcmData.slice(start, end);
        
        const header = createWavHeader(chunkPcm.length);
        const chunkBuffer = new Uint8Array(header.length + chunkPcm.length);
        chunkBuffer.set(header, 0);
        chunkBuffer.set(chunkPcm, header.length);

        console.log(`[Whisper] Enviando fatia ${i + 1}/${chunkCount}...`);
        const timeOffset = (start / 16000); 
        const text = await sendToWhisper(apiKey, chunkBuffer, index, i, timeOffset);
        combinedText += text + " ";
      }
      return `--- TRANSCRIÇÃO DE ÁUDIO ${index + 1} ---\n${combinedText}\n`;
    }
  } catch (err: any) {
    console.error(`[Whisper Fatal]`, err.message);
    return `[Erro crítico no áudio ${index + 1}]`;
  }
}

function createWavHeader(dataLength: number) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  header.set([82, 73, 70, 70], 0); 
  view.setUint32(4, dataLength + 36, true);
  header.set([87, 65, 86, 69], 8); 
  header.set([102, 109, 116, 32], 12); 
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); 
  view.setUint16(22, 1, true); 
  view.setUint32(24, 8000, true); 
  view.setUint32(28, 16000, true); 
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  header.set([100, 97, 116, 97], 36); 
  view.setUint32(40, dataLength, true);
  return header;
}

async function sendToWhisper(apiKey: string, buffer: Uint8Array, audioIdx: number, chunkIdx?: number, timeOffset: number = 0) {
  const formData = new FormData();
  const filename = chunkIdx !== undefined ? `audio_${audioIdx}_p${chunkIdx}.wav` : `audio_${audioIdx}.wav`;
  // Fix lint by using ArrayBuffer directly
  formData.append('file', new Blob([buffer.buffer as ArrayBuffer], { type: 'audio/wav' }), filename);
  formData.append('model', 'whisper-1');
  formData.append('language', 'pt');
  formData.append('response_format', 'verbose_json');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.warn(`[Whisper Slice Error]`, err);
    return "";
  }
  
  const result = await response.json();
  if (!result.segments) return result.text || "";
  
  return result.segments.map((s: any) => `[${formatTime(s.start + timeOffset)}] ${s.text}`).join(' ');
}

async function callOpenAI(apiKey: string, text: string, transcript: string, prompt: string) {
  console.log("[Worker Fallback] Chamando OpenAI GPT-4o-mini (com transcrição cronometrada)...");
  
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '')
    .trim()
    .slice(0, 300000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um Desembargador revisor altamente qualificado e extremamente detalhista. Use o formato JSON.\n\nSua análise deve ser exaustiva, comparando cada segundo da transcrição do áudio com o texto do processo. Se uma contradição for encontrada, indique o ÁUDIO e o TEMPO [MM:SS] exatos conforme as marcações na transcrição." },
        { role: "user", content: `DADOS TÉCNICOS DO PROCESSO (PDF):\n${cleanText}\n\nTRANSCRIÇÃO DA AUDIÊNCIA COM MARCAS DE TEMPO (ÁUDIO):\n${transcript}\n\n${prompt}` }
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
    const preExtractedText = analise.pdf_text_content;

    const { data: profile } = await supabase.from('profiles').select('credits').eq('id', analise.user_id).single();
    const currentCredits = profile?.credits || 0;

    const modelName = "models/gemini-2.5-pro"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    console.log(`[Worker] Tentando Gemini...`);
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
          console.log("[Worker Fallback] Google bloqueou. Ativando Whisper Cronometrado + GPT-4o-mini...");
          if (openaiApiKey) {
            let fullTranscript = "";
            for (let i = 0; i < mediaUrlsToTranscribe.length; i++) {
              fullTranscript += `--- ÁUDIO ${i + 1} ---\n${await transcribeAudio(openaiApiKey, mediaUrlsToTranscribe[i], i)}\n\n`;
            }
            capturedTranscript = fullTranscript;
            finalResultText = await callOpenAI(openaiApiKey, preExtractedText || "", fullTranscript || "Sem áudio disponível.", ANALYSIS_PROMPT);
          } else {
            throw new Error("BLOCK: OpenAI não configurada.");
          }
       } else {
          finalResultText = genResult.candidates[0].content.parts[0].text;
       }
    } else {
       console.warn("[Worker] Erro Gemini. Tentando resgate OpenAI...");
       if (openaiApiKey) {
          finalResultText = await callOpenAI(openaiApiKey, preExtractedText || "", "Sem transcrição cronometrada (erro Gemini).", ANALYSIS_PROMPT);
       } else {
          throw new Error("Gemini Error: " + genResponse.status);
       }
    }

    if (!finalResultText) throw new Error("Falha total IA.");
    const resultJson = JSON.parse(finalResultText.replace(/```json\n?|```/g, '').trim());

    // Se houve fallback, salvamos a transcrição para uso no Chat
    await supabase.from('analises').update({ 
      resultado_json: resultJson, 
      status: 'concluido',
      audio_transcription: (capturedTranscript || "").replace(/\u0000/g, '') || null
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
