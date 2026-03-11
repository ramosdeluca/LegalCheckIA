import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { GoogleGenAI, Type } from "npm:@google/genai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

const SYSTEM_INSTRUCTION = `
Você é um Engenheiro Jurídico de elite, especializado em análise minuciosa de audiências judiciais e processos complexos.
Sua tarefa é realizar uma auditoria completa do áudio/vídeo da audiência, comparando-o com o texto do processo (PDF) para identificar TODAS as contradições possíveis e fornecer uma síntese conclusiva.

DIRETRIZES DE ANÁLISE:
- Identifique e analise o depoimento de CADA pessoa (Autor, Réu, Testemunha 1, 2, 3, etc.).
- Compare o depoimento com o PDF (Contradição Documental).
- Compare depoimentos entre diferentes testemunhas (Contradição Inter-testemunhal).
- Seja extremamente rigoroso com o TIMESTAMP (minuto:segundo).

REGRAS DE PREENCHIMENTO (CRÍTICO):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações da análise panorâmica do processo.
2. "analise_tendencia": Escreva uma frase ou pequeno parágrafo apontando a tendência geral da prova oral (ex: depoimento confiável, testemunha fragilizada, provas robustas a favor do autor, etc.).
3. Para cada item na lista de "contradicoes":
   - "o_que_foi_dito": Deve conter DE QUEM é a fala e APENAS o que foi afirmado no vídeo/áudio no timestamp, preferencialmente entre aspas. Exemplo: "Testemunha 1: '...'".
   - "o_que_diz_o_processo": Deve conter APENAS a prova documental (PDF) ou depoimento anterior que contradiz a fala acima.
   - "explicacao": Use este cenário para sua análise técnica e o impacto jurídico. Não misture análise nos campos acima.
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { processoId } = await req.json();

    if (!processoId) {
      return new Response(JSON.stringify({ error: "processoId is required" }), { status: 400, headers: corsHeaders });
    }

    console.log(`Iniciando processamento para o processo: ${processoId}`);

    // Buscar a análise pendente
    const { data: analiseData, error: analiseError } = await supabase
      .from('analises')
      .select('*')
      .eq('processo_id', processoId)
      .eq('status', 'processando')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (analiseError || !analiseData) {
      return new Response(JSON.stringify({ message: "Nenhuma análise pendente." }), { status: 200, headers: corsHeaders });
    }

    // Baixar o áudio e o PDF usando a Supabase Storage
    const mediaPath = analiseData.video_url.split('/storage/v1/object/public/legalcheck/')[1];
    const pdfPath = analiseData.pdf_url.split('/storage/v1/object/public/legalcheck/')[1];

    console.log("Baixando arquivos do Storage...");
    const { data: mediaBlob, error: mediaError } = await supabase.storage.from('legalcheck').download(mediaPath);
    if (mediaError || !mediaBlob) throw new Error("Erro ao baixar a mídia do storage.");

    const { data: pdfBlob, error: pdfError } = await supabase.storage.from('legalcheck').download(pdfPath);
    if (pdfError || !pdfBlob) throw new Error("Erro ao baixar o PDF do storage.");

    console.log("Iniciando IA Gemini...");
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    let uploadedMedia: any = null;
    let uploadedPdf: any = null;

    try {
      console.log("Fazendo upload da mídia (Streaming) para Google File API...");
      uploadedMedia = await ai.files.upload({
        file: mediaBlob,
        mimeType: mediaBlob.type || "audio/mp3",
      });
      
      console.log("Fazendo upload do PDF para Google File API...");
      uploadedPdf = await ai.files.upload({
        file: pdfBlob,
        mimeType: "application/pdf",
      });

      console.log(`Mídia URI: ${uploadedMedia.uri}`);

      console.log("Iniciando Análise de Contradições no modelo Gemini...");
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            parts: [
              {
                fileData: {
                  fileUri: uploadedMedia.uri,
                  mimeType: uploadedMedia.mimeType,
                },
              },
              {
                fileData: {
                  fileUri: uploadedPdf.uri,
                  mimeType: uploadedPdf.mimeType,
                },
              },
              {
                text: `ANÁLISE JURÍDICA EXAUSTIVA REQUERIDA:\n\nInstrução:\nAnalise o arquivo PDF anexo (processo) e o áudio da audiência.\nBusque por contradições entre:\n- Depoimento vs. PDF.\n- Depoimento vs. Outro Depoimento.\n\nRetorne os resultados em JSON estritamente no Schema configurado.`
              }
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              resumo_executivo: { type: Type.STRING },
              analise_tendencia: { type: Type.STRING },
              contradicoes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    o_que_foi_dito: { type: Type.STRING },
                    o_que_diz_o_processo: { type: Type.STRING },
                    tipo_contradicao: { type: Type.STRING },
                    gravidade: { type: Type.STRING, enum: ["Baixa", "Média", "Alta"] },
                    explicacao: { type: Type.STRING },
                  },
                  required: ["timestamp", "o_que_foi_dito", "o_que_diz_o_processo", "tipo_contradicao", "gravidade", "explicacao"],
                },
              }
            },
            required: ["resumo_executivo", "analise_tendencia", "contradicoes"],
          },
        },
      });

      const resultJson = JSON.parse(response.text || "{}");

      console.log("Análise concluída. Salvando no banco...");
      await supabase.from('analises').update({
        resultado_json: resultJson,
        status: 'concluido'
      }).eq('id', analiseData.id);

    } finally {
      // Cleanup: Excluir os arquivos no servidor do Google para não ocupar cota
      // O bloco finally roda mesmo se houver erro no try (ex: timeout da IA ou erro de parse)
      console.log("Limpando arquivos do Google File API...");
      if (uploadedMedia) await ai.files.delete({ name: uploadedMedia.name }).catch(console.error);
      if (uploadedPdf) await ai.files.delete({ name: uploadedPdf.name }).catch(console.error);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });

  } catch (error: any) {
    console.error("Erro na Edge Function:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});
