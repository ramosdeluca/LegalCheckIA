import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";
const openaiApiKey = Deno.env.get("OPENAI_API_KEY") ?? "";

async function callOpenAIChat(pdfText: string, audioTranscript: string, history: any[], newMessage: string) {
  console.log("[Chat Fallback] Chamando OpenAI GPT-4o-mini (PDF + Áudio)...");
  
  const cleanPdf = pdfText
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '')
    .trim()
    .slice(0, 250000);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Você é um Desembargador revisor altamente qualificado. Responda baseado no processo (PDF) e nos depoimentos da audiência (Transcrição fornecida). Seja exaustivo e técnico." },
        { role: "user", content: `CONTEXTO DO PROCESSO (PDF):\n${cleanPdf}\n\nTRANSCRIÇÃO DOS DEPOIMENTOS (ÁUDIO):\n${audioTranscript}` },
        ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.content })),
        { role: "user", content: newMessage }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Chat Error: ${response.status} - ${err}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { analiseId, message, processoId } = await req.json();
    if (!analiseId || !message) throw new Error("analiseId and message are required");

    const { data: analise, error: analiseError } = await supabase
      .from('analises')
      .select('gemini_file_uris, chat_credits, pdf_text_content, audio_transcription')
      .eq('id', analiseId)
      .single();
    
    if (analiseError || !analise) throw new Error("Análise não encontrada.");
    if (analise.chat_credits !== null && analise.chat_credits <= 0) throw new Error("Limite de mensagens atingido.");

    const uris = analise.gemini_file_uris || [];
    const preExtractedText = analise.pdf_text_content;
    const audioTranscript = analise.audio_transcription;

    const { data: history } = await supabase
      .from('analise_chats')
      .select('role, content')
      .eq('analise_id', analiseId)
      .order('created_at', { ascending: true })
      .limit(10);

    const modelName = "models/gemini-2.5-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;

    const generationBody = {
      system_instruction: {
        parts: [{ text: `Você é um Assistente Jurídico especializado. Responda baseado exclusivamente no contexto fornecido. Se houver termos sensíveis, interprete como contexto profissional legal.` }]
      },
      contents: [
        ...(history || []).map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })),
        { 
          role: "user", 
          parts: [
            ...uris.map((f: any) => ({ file_data: { file_uri: f.uri, mime_type: f.mime } })),
            { text: `PERGUNTA DO USUÁRIO: ${message}` }
          ] 
        }
      ],
      generationConfig: { temperature: 0.2 },
      safetySettings: [
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    let aiResponse = "";

    console.log(`[Chat] Tentando Gemini para ${analiseId}...`);
    const genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generationBody)
    });

    if (genResponse.ok) {
       const genResult = await genResponse.json();
       if (genResult.promptFeedback?.blockReason === "PROHIBITED_CONTENT" || !genResult.candidates?.[0]?.content?.parts?.[0]?.text) {
          console.log("[Chat Fallback] Gemini bloqueou ou falhou. Usando Resgate OpenAI (PDF + Transcrição)...");
          if (openaiApiKey) {
            aiResponse = await callOpenAIChat(
              preExtractedText || "Sem texto extraído.", 
              audioTranscript || "Transcrição de áudio não disponível para esta análise.",
              history || [], 
              message
            );
          } else {
            throw new Error("PROHIBITED_CONTENT: Google bloqueou e OpenAI não configurada.");
          }
       } else {
          aiResponse = genResult.candidates[0].content.parts[0].text;
       }
    } else {
       console.warn("[Chat] Erro Gemini. Tentando OpenAI...");
       if (openaiApiKey) {
          aiResponse = await callOpenAIChat(
            preExtractedText || "Sem texto extraído.", 
            audioTranscript || "Transcrição de áudio não disponível.",
            history || [], 
            message
          );
       } else {
          const errText = await genResponse.text();
          throw new Error(`Erro Gemini: ${genResponse.status} - ${errText}`);
       }
    }

    if (!aiResponse) throw new Error("Sem resposta das IAs.");

    const { data: insertedData } = await supabase.from('analise_chats').insert([
      { analise_id: analiseId, processo_id: processoId, role: 'user', content: message },
      { analise_id: analiseId, processo_id: processoId, role: 'assistant', content: aiResponse }
    ]).select('id, role');

    await supabase.from('analises').update({ chat_credits: Math.max(0, (analise.chat_credits || 0) - 1) }).eq('id', analiseId);

    return new Response(JSON.stringify({ 
      response: aiResponse,
      userMessageId: insertedData?.find(m => m.role === 'user')?.id,
      assistantMessageId: insertedData?.find(m => m.role === 'assistant')?.id
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error: any) {
    console.error("ERRO NO CHAT:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});
