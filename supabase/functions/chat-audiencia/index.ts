import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callClaudeChat(apiKey: string, pdfText: string, audioTranscript: string, history: any[], newMessage: string) {
  console.log("[Chat Fallback] Acionando Claude 3.5 Sonnet para resposta de elite...");
  
  const cleanPdf = pdfText
    .replace(/\s+/g, ' ')
    .replace(/[^\w\sÀ-ÿ,.!?]/g, '')
    .trim()
    .slice(0, 100000); // 100k chars p/ contexto rico no Chat

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 4096,
      temperature: 0,
      system: `Você é um Desembargador revisor e Analista Judiciário Sênior. Sua missão é responder perguntas sobre o processo e a audiência com base nas evidências fornecidas.\n\nSua análise deve ser técnica, imparcial e extremamente fundamentada nas provas.`,
      messages: [
        { 
          role: "user", 
          content: `CONTEXTO DO PROCESSO (PDF):\n${cleanPdf}\n\nTRANSCRIÇÃO DOS DEPOIMENTOS (ÁUDIO):\n${audioTranscript}\n\nHistórico da conversa:\n${JSON.stringify(history)}\n\nPergunta do usuário: ${newMessage}` 
        }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude Chat Error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  return result.content[0].text;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { analiseId, processoId, message, history } = await req.json();

    // 1. Buscar contexto da análise (PDF e Transcrição)
    const { data: analise } = await supabaseClient
      .from("analises")
      .select("pdf_text_content, audio_transcription")
      .eq("id", analiseId)
      .single();

    const pdfText = analise?.pdf_text_content || "";
    const audioTranscript = analise?.audio_transcription || "";

    // 2. Tentar Gemini 2.5 Pro (Primatário)
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    const modelName = "models/gemini-2.5-pro"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;

    console.log(`[Chat] Tentando Gemini (${modelName})...`);
    
    // Simplificando o envio para o Gemini no Chat (focado em texto já extraído para evitar bloqueios de arquivo)
    const genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
            { role: "user", parts: [{ text: `CONTEXTO DO PROCESSO:\n${pdfText}\n\nTRANSCRIÇÃO DA AUDIÊNCIA:\n${audioTranscript}\n\nPERGUNTA: ${message}` }] }
        ],
        system_instruction: { parts: [{ text: "Você é um Analista Jurídico de Elite. Responda com base no PDF e na Audiência." }] },
        generation_config: { temperature: 0.2 }
      })
    });

    let aiResponse = "";
    if (genResponse.ok) {
        const genResult = await genResponse.json();
        if (genResult.promptFeedback?.blockReason === "PROHIBITED_CONTENT" || !genResult.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.log("[Chat Fallback] Gemini bloqueou. Ativando Claude Fallback...");
            const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
            if (anthropicApiKey) {
                aiResponse = await callClaudeChat(anthropicApiKey, pdfText, audioTranscript, history, message);
            } else {
                throw new Error("BLOCK: Anthropic API Key não configurada para o chat.");
            }
        } else {
            aiResponse = genResult.candidates[0].content.parts[0].text;
        }
    } else {
        console.warn("[Chat] Erro Gemini. Tentando resgate Claude...");
        const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (anthropicApiKey) {
            aiResponse = await callClaudeChat(anthropicApiKey, pdfText, audioTranscript, history, message);
        } else {
            const errText = await genResponse.text();
            throw new Error(`Gemini Chat Error: ${genResponse.status} - ${errText}`);
        }
    }

    // 3. Salvar no histórico
    if (aiResponse) {
        await supabaseClient.from("analise_chats").insert([
            { analise_id: analiseId, processo_id: processoId, role: "user", content: message },
            { analise_id: analiseId, processo_id: processoId, role: "assistant", content: aiResponse }
        ]);
    }

    return new Response(JSON.stringify({ response: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error("[Chat Error]", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
