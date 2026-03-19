import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { analiseId, message, processoId } = await req.json();

    if (!analiseId || !message) {
      return new Response(JSON.stringify({ error: "analiseId and message are required" }), { status: 400, headers: corsHeaders });
    }

    // 1. Recuperar os links seguros (URIs) do Gemini
    const { data: analise, error: analiseError } = await supabase
      .from('analises')
      .select('gemini_file_uris, status')
      .eq('id', analiseId)
      .single();
    
    if (analiseError || !analise) {
      throw new Error("Análise não encontrada.");
    }

    const uris = analise.gemini_file_uris || [];
    if (!uris.length) {
      throw new Error("Arquivos da análise não encontrados. Realize o upload novamente.");
    }

    // 2. Enviar para o Gemini usando URIs
    const modelName = "models/gemini-2.5-pro";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;

    // Preparar os componentes da mensagem (Arquivos + Histórico + Nova Pergunta)
    const fileParts = uris.map((fileObj: any) => ({
      file_data: { file_uri: fileObj.uri, mime_type: fileObj.mime }
    }));

    // Recuperar histórico recente
    const { data: history } = await supabase
      .from('analise_chats')
      .select('role, content')
      .eq('analise_id', analiseId)
      .order('created_at', { ascending: true })
      .limit(10);

    const historyContents = (history || []).map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }]
    }));

    const generationBody = {
      system_instruction: {
        parts: [{ text: "Você é um assistente jurídico especialista em análise de audiências. Responda de forma direta e amigável em Markdown. Use o contexto dos arquivos fornecidos para embasar suas respostas." }]
      },
      contents: [
        ...historyContents,
        { 
          role: "user", 
          parts: [
            ...fileParts,
            { text: `PERGUNTA DO USUÁRIO: ${message}` }
          ] 
        }
      ],
      generationConfig: { temperature: 0.2 }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generationBody)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Chat Error: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    const aiResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiResponse) {
      console.error("Gemini returned no response text. FULL RESULT:", JSON.stringify(result, null, 2));
      throw new Error(`Gemini não retornou texto. Motivo provável: ${result.candidates?.[0]?.finishReason || "Desconhecido"}`);
    }

    // 3. Salvar Histórico Permanentemente
    const { data: insertedData, error: insertError } = await supabase.from('analise_chats').insert([
      { analise_id: analiseId, processo_id: processoId, role: 'user', content: message },
      { analise_id: analiseId, processo_id: processoId, role: 'assistant', content: aiResponse }
    ]).select('id, role');

    if (insertError) {
      console.error("Erro ao salvar no banco:", insertError);
    }

    return new Response(JSON.stringify({ 
      response: aiResponse,
      userMessageId: insertedData?.find(m => m.role === 'user')?.id,
      assistantMessageId: insertedData?.find(m => m.role === 'assistant')?.id
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 
    });

  } catch (error: any) {
    console.error("ERRO NO CHAT:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500 
    });
  }
});
