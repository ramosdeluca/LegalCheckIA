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

    const userId = analiseData.user_id;

    console.log(`[fnc_gerar_relatorio] Verificando créditos para usuario: ${userId}`);
    // Verificar créditos
    const { data: profile, error: profileError } = await supabase.from('profiles').select('credits, status_assinatura').eq('id', userId).single();
    
    if (profileError || !profile) {
      console.error(`[fnc_gerar_relatorio] Erro ao carregar perfil:`, profileError);
      await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: 'Usuário não encontrado.' } }).eq('id', recordId);
      return new Response(JSON.stringify({ error: "Perfil não encontrado" }), { status: 404 });
    }

    if (profile.credits <= 0 && profile.status_assinatura !== 'active') {
      console.warn(`[fnc_gerar_relatorio] Bloqueado: créditos=${profile.credits}, status=${profile.status_assinatura}`);
      await supabase.from('analises').update({ status: 'erro', resultado_json: { erro: 'Saldo insuficiente ou assinatura inativa. Faça o upgrade do seu plano clicando no avatar do seu perfil.' } }).eq('id', recordId);
      return new Response(JSON.stringify({ error: "Saldo insuficiente ou assinatura inativa" }), { status: 403 });
    }

    // REMOVIDO: update status para 'processando' aqui para evitar loop de Webhook
    // O status já é 'arquivos_prontos', que o Dashboard já entende como carregamento.
    console.log(`[fnc_gerar_relatorio] Pulando atualização de status para evitar loop de Webhook.`);

    const modelName = "models/gemini-2.5-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    console.log(`[fnc_gerar_relatorio] Preparando chamada Gemini (${modelName})...`);

    const generationBody = {
      cachedContent: cacheName,
      contents: [{ 
        role: "user", 
        parts: [{ text: `TAREFA: Realize a análise jurídica objetiva dos arquivos em cache. \n\n${ANALYSIS_PROMPT}` }] 
      }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 2048,
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
    // Reduzido para 2 tentativas para caber no limite de 300s do Pro Plan se houver timeout
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      // Tentativa 1: 150s, Tentativa 2: 100s
      const currentTimeout = attempt === 0 ? 150000 : 100000;
      const timeoutId = setTimeout(() => controller.abort(), currentTimeout);

      try {
        const startTime = Date.now();
        console.log(`[fnc_gerar_relatorio] Disparando fetch para Gemini (Tentativa ${attempt + 1}). Timeout: ${currentTimeout/1000}s...`);
        
        const genResponse = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(generationBody),
          signal: controller.signal
        });

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[fnc_gerar_relatorio] Resposta Gemini recebida em ${duration}s! HTTP Status: ${genResponse.status}`);

        if (genResponse.ok) {
          genResult = await genResponse.json();
          break;
        }

        const errText = await genResponse.text();
        console.warn(`[GEMINI] Tentativa ${attempt + 1} de geração falhou: ${genResponse.status} - ${errText}`);
        
        if (attempt === 1) throw new Error(`Gemini Generation Error: ${genResponse.status} - ${errText}`);
        
        // Espera curta antes da próxima tentativa
        await new Promise(r => setTimeout(r, 5000));

      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn(`[fnc_gerar_relatorio] Timeout de ${currentTimeout/1000}s atingido na tentativa ${attempt + 1}.`);
          if (attempt === 1) {
            throw new Error("O Gemini está demorando muito para processar esses arquivos (limite do servidor atingido). Por favor, tente novamente em alguns minutos com menos arquivos ou um prompt mais simples.");
          }
          // Espera um pouco para tentar a última vez
          await new Promise(r => setTimeout(r, 5000));
        } else {
          throw err;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    console.log(`[fnc_gerar_relatorio] Análise concluída. Salvando no banco... (Record: ${recordId})`);
    
    // Calcular expiração (4 horas)
    const expiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

    await supabase.from('analises').update({
      resultado_json: resultJson,
      status: 'concluido',
      gemini_cache_expiry: expiry 
    }).eq('id', recordId);

    // Deduzir crédito após sucesso
    await supabase.rpc('deduct_credit', { user_id: userId });
    console.log(`[fnc_gerar_relatorio] Crédito deduzido para ${userId}`);

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
