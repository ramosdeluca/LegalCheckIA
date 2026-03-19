import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

const ANALYSIS_PROMPT = `
REQUISITO DE FORMATAÇÃO (Obrigatório retornar em JSON):
1. "resumo_executivo": Forneça um parágrafo detalhado resumindo as principais constatações.
2. "analise_tendencia": Realize uma análise profunda e técnica apontando a tendência geral da prova.
3. "contradicoes": Liste no máximo as 5 contradições mais relevantes contendo:
   - "timestamp": Formato "Áudio X - MM:SS".
   - "o_que_foi_dito": Personagem + fala precisa.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório.
   - "explicacao": Impacto jurídico (máx 2 linhas).
`;

serve(async (req) => {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let recordId: string | null = null;

  try {
    const body = await req.json();
    
    // Suporte tanto para chamada direta do client quanto para Database Webhook
    const record = body.record || body;
    console.log(`[fnc_gerar_relatorio] Webhook recebido! Status: ${record?.status}, ID: ${record?.id}`);

    if (!record || !record.id || !record.gemini_cache_name) {
      console.warn("Payload inválido ou sem gemini_cache_name:", body);
      return new Response(JSON.stringify({ error: "Invalid payload or missing cache name" }), { status: 400 });
    }

    if (record.status !== 'arquivos_prontos') {
      console.log(`[fnc_gerar_relatorio] Ignorando webhook: status atual é '${record.status}'.`);
      return new Response(JSON.stringify({ message: "Ignorado" }), { status: 200 });
    }

    recordId = record.id;
    const cacheName = record.gemini_cache_name;

    console.log(`[fnc_gerar_relatorio] Iniciando análise para ${recordId} usando cache: ${cacheName}`);

    // == LÓGICA DE CRÉDITOS E ASSINATURA ==
    const { data: analiseData } = await supabase.from('analises').select('user_id').eq('id', recordId).single();
    if (!analiseData?.user_id) {
      throw new Error("ID do usuário não encontrado na análise.");
    }

    const { data: profile } = await supabase.from('profiles').select('credits, status_assinatura').eq('id', analiseData.user_id).single();
    
    if (!profile || profile.credits <= 0) {
      await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: 'Sem créditos disponíveis. Faça o upgrade do seu plano clicando no avatar do seu perfil.' } }).eq('id', recordId);
      return new Response(JSON.stringify({ error: "Créditos insuficientes" }), { status: 403 });
    }

    if (profile.status_assinatura !== 'active' && profile.credits !== 1) {
      await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: 'Sua assinatura não está ativa. Atualize seu meio de pagamento.' } }).eq('id', recordId);
      return new Response(JSON.stringify({ error: "Assinatura inativa" }), { status: 403 });
    }

    // Alterar o status para processando
    await supabase.from('analises').update({ status: 'processando' }).eq('id', recordId);

    const modelName = "models/gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;

    const generationBody = {
      cachedContent: cacheName,
      contents: [{ 
        role: "user", 
        parts: [{ text: `TAREFA: Realize a análise jurídica exaustiva dos arquivos em cache. \n\n${ANALYSIS_PROMPT}` }] 
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            resumo_executivo: { type: "string" },
            analise_tendencia: { type: "string" },
            contradicoes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  timestamp: { type: "string" },
                  o_que_foi_dito: { type: "string" },
                  o_que_diz_o_processo: { type: "string" },
                  tipo_contradicao: { type: "string" },
                  gravidade: { type: "string", enum: ["Baixa", "Média", "Alta"] },
                  explicacao: { type: "string" },
                },
                required: ["timestamp", "o_que_foi_dito", "o_que_diz_o_processo", "tipo_contradicao", "gravidade", "explicacao"],
              },
            }
          },
          required: ["resumo_executivo", "analise_tendencia", "contradicoes"],
        }
      }
    };

    let genResult;
    for (let attempt = 0; attempt < 3; attempt++) {
      const genResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody),
      });

      if (genResponse.ok) {
        genResult = await genResponse.json();
        break;
      }

      const errText = await genResponse.text();
      console.warn(`[GEMINI] Tentativa ${attempt + 1} de geração falhou: ${genResponse.status} - ${errText}`);
      if (attempt === 2) throw new Error(`Gemini Generation Error: ${genResponse.status} - ${errText}`);
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 2000));
    }

    const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    // == DEBITAR CRÉDITOS ==
    const novoSaldo = profile.credits - 1;
    await supabase.from('profiles').update({ credits: novoSaldo }).eq('id', analiseData.user_id);
    console.log(`[fnc_gerar_relatorio] Crédito debitado com sucesso. Novo saldo: ${novoSaldo}`);

    const expiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    
    console.log(`[fnc_gerar_relatorio] Análise concluída com sucesso para ${recordId}! Atualizando banco...`);
    
    await supabase.from('analises').update({
      resultado_json: resultJson,
      status: 'concluido',
      gemini_cache_expiry: expiry 
    }).eq('id', recordId);

    console.log(`[fnc_gerar_relatorio] FINALIZADO com sucesso para ${recordId}.`);
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' }, status: 200 });

  } catch (error: any) {
    console.error(`[fnc_gerar_relatorio] ERRO CRÍTICO para ${recordId}:`, error.message);
    
    if (recordId) {
      await supabase.from('analises').update({
        status: 'erro',
        resultado_json: { erro: error.message }
      }).eq('id', recordId);
    }

    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
