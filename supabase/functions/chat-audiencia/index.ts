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

    // 1. Recuperar o Cache Context do Gemini
    const { data: analise, error: analiseError } = await supabase
      .from('analises')
      .select('gemini_cache_name, gemini_cache_expiry, status')
      .eq('id', analiseId)
      .single();

    if (analiseError || !analise) {
      throw new Error("Análise não encontrada.");
    }

    // Verificar se o cache ainda é válido
    const now = new Date();
    const expiry = new Date(analise.gemini_cache_expiry);
    
    if (now > expiry || !analise.gemini_cache_name) {
      return new Response(JSON.stringify({ 
        error: "Sessão de chat expirada. O cache de 4 horas foi removido pelo Google para economizar tokens. Realize uma nova análise para reativar o chat." 
      }), { status: 403, headers: corsHeaders });
    }

    // 2. Enviar para o Gemini usando o Cache
    const modelName = "models/gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;

    // Recuperar histórico recente para contexto do chat (opcional, mas bom)
    const { data: history } = await supabase
      .from('analise_chats')
      .select('role, content')
      .eq('analise_id', analiseId)
      .order('created_at', { ascending: true })
      .limit(10);

    const contents = [
      ...(history || []).map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }]
      })),
      { role: "user", parts: [{ text: message }] }
    ];

    const generationBody = {
      cachedContent: analise.gemini_cache_name,
      contents: [
        ...contents.slice(0, -1),
        { 
          role: "user", 
          parts: [{ text: `INSTRUÇÃO DE CHAT: Responda de forma direta e amigável em Markdown. NÃO inclua "resumo_executivo", "analise_tendencia" ou estruturas da análise principal. Foque APENAS em responder a pergunta do usuário usando o contexto. \n\nPERGUNTA: ${message}` }] 
        }
      ]
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

    if (!aiResponse) throw new Error("IA não retornou resposta.");

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
