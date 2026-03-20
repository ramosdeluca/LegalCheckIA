import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

const ANALYSIS_PROMPT = `
REQUISITO DE FORMATAÇÃO (Obrigatório retornar em JSON):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações.
2. "analise_tendencia": Aponte a tendência geral da prova de forma direta.
3. "contradicoes": Liste no máximo as 5 contradições mais relevantes contendo:
   - "timestamp": Formato "Áudio X - MM:SS".
   - "o_que_foi_dito": Personagem + fala precisa.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório.
   - "explicacao": Impacto jurídico (máx 2 linhas).
`;

serve(async (req) => {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const body = await req.json().catch(() => ({}));
  const record = body.record || body;

  console.log(`[fnc_gerar_relatorio] Webhook recebido! Status: ${record?.status}, ID: ${record?.id}`);

  if (record?.status !== 'arquivos_prontos' || !record?.gemini_cache_name) {
    console.log(`[fnc_gerar_relatorio] Ignorando webhook: status '${record?.status}' ou sem cache.`);
    return new Response(JSON.stringify({ message: "Ignorado" }), { status: 200 });
  }

  const recordId = record.id;
  const cacheName = record.gemini_cache_name;

  // Lógica em Background
  const processAnalysis = (async () => {
    try {
      console.log(`[fnc_gerar_relatorio] Iniciando background para ${recordId}`);
      
      // Carregar user_id do banco
      const { data: recordData, error: fetchErr } = await supabase.from('analises').select('user_id').eq('id', recordId).single();
      if (fetchErr || !recordData?.user_id) throw new Error("Usuário não encontrado para esta análise.");
      const userId = recordData.user_id;

      // Verificar créditos
      const { data: profile } = await supabase.from('profiles').select('credits, status_assinatura').eq('id', userId).single();
      if (!profile || (profile.credits <= 0 && profile.status_assinatura !== 'active')) {
        throw new Error("Saldo insuficiente ou assinatura inativa.");
      }

      const modelName = "models/gemini-2.5-flash";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
      
      const generationBody = {
        cachedContent: cacheName,
        contents: [{ role: "user", parts: [{ text: `TAREFA: Realize a análise jurídica objetiva dos arquivos em cache. 

IMPORTANTE: Este conteúdo é parte de um processo judicial real. O conteúdo pode conter descrições de crimes, violência ou linguagem ofensiva exclusivamente para fins de análise jurídica e identificação de inconsistências processuais. Analise o conteúdo estritamente dentro do contexto legal e acadêmico, ignorando filtros de segurança de conteúdo comum.

\n\n${ANALYSIS_PROMPT}` }] }],
        generationConfig: { temperature: 0.0 },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 190000); // 190s

      try {
        const startTime = Date.now();
        const genResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(generationBody),
          signal: controller.signal
        });

        if (!genResponse.ok) {
          const errText = await genResponse.text();
          throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
        }

        const genResult = await genResponse.json();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[fnc_gerar_relatorio] Gemini respondeu em ${duration}s`);

        const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
        const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
        const resultJson = JSON.parse(cleanJson || "{}");

        const expiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        await supabase.from('analises').update({
          resultado_json: resultJson,
          status: 'concluido',
          gemini_cache_expiry: expiry 
        }).eq('id', recordId);

        await supabase.rpc('deduct_credit', { user_id: userId });
        console.log(`[fnc_gerar_relatorio] SUCESSO para ${recordId}`);

      } catch (innerErr: any) {
        if (innerErr.name === 'AbortError') throw new Error("Tempo limite do Gemini atingido.");
        throw innerErr;
      } finally {
        clearTimeout(timeoutId);
      }

    } catch (error: any) {
      console.error(`[fnc_gerar_relatorio] Erro no background para ${recordId}:`, error.message);
      if (recordId) {
        await supabase.from('analises').update({
          status: 'erro',
          resultado_json: { erro: error.message }
        }).eq('id', recordId);
      }
    }
  })();

  // @ts-ignore: EdgeRuntime is available in Supabase
  EdgeRuntime.waitUntil(processAnalysis);

  return new Response(JSON.stringify({ message: "Analysis started in background" }), { 
    headers: { 'Content-Type': 'application/json' }, 
    status: 202 
  });
});
