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
Sua tarefa é realizar uma auditoria completa de TODOS os arquivos de áudio/vídeo da audiência anexados, comparando-os com o texto do processo (PDF) para identificar TODAS as contradições possíveis e fornecer uma síntese conclusiva.

DIRETRIZES DE ANÁLISE (CRÍTICO):
- Identifique e analise o depoimento de CADA pessoa (Autor, Réu, Testemunha 1, 2, 3, etc.).
- Compare o depoimento com o PDF (Contradição Documental).
- Compare depoimentos entre diferentes testemunhas (Contradição Inter-testemunhal).
- TIMESTAMP: Você deve fornecer o tempo exato (minuto:segundo) relativo ao arquivo de áudio onde a fala ocorreu. Se houver múltiplos arquivos, especifique de qual arquivo se trata se houver dúvida.
- NÃO retorne "00:00" a menos que a fala tenha ocorrido exatamente no início do arquivo. Você DEVE ouvir o áudio para encontrar o ponto exato da fala.

REGRAS DE PREENCHIMENTO:
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações da análise panorâmica do processo.
2. "analise_tendencia": Escreva uma frase ou pequeno parágrafo apontando a tendência geral da prova oral (ex: depoimento confiável, testemunha fragilizada, provas robustas a favor do autor, etc.).
3. Para cada item na lista de "contradicoes":
   - "timestamp": Formato "MM:SS". Seja preciso. Use o tempo relativo ao arquivo de áudio.
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

    // Listas de arquivos para baixar e processar
    const videoUrls = analiseData.video_urls || (analiseData.video_url ? [analiseData.video_url] : []);
    const pdfUrls = analiseData.pdf_urls || (analiseData.pdf_url ? [analiseData.pdf_url] : []);

    if (videoUrls.length === 0 || pdfUrls.length === 0) {
      throw new Error("Nenhum arquivo de vídeo ou PDF encontrado para esta análise.");
    }

    console.log(`Iniciando IA Gemini para ${videoUrls.length} vídeos e ${pdfUrls.length} PDFs...`);
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    const googleFiles: any[] = [];
    const promptParts: any[] = [];

    try {
      // 1. Processar Vídeos/Áudios
      for (const url of videoUrls) {
        const path = url.split('/storage/v1/object/public/legalcheck/')[1];
        console.log(`Baixando mídia: ${path}`);
        const { data: blob, error } = await supabase.storage.from('legalcheck').download(path);
        if (error || !blob) throw new Error(`Erro ao baixar mídia: ${path}`);

        console.log(`Fazendo upload para Google File API: ${path}`);
        const uploaded = await ai.files.upload({
          file: blob,
          mimeType: blob.type || "audio/mp3",
        });
        googleFiles.push(uploaded);
        promptParts.push({
          text: `Arquivo de Áudio/Vídeo: ${path}`
        });
        promptParts.push({
          fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType }
        });
      }

      // 2. Processar PDFs
      for (const url of pdfUrls) {
        const path = url.split('/storage/v1/object/public/legalcheck/')[1];
        console.log(`Baixando PDF: ${path}`);
        const { data: blob, error } = await supabase.storage.from('legalcheck').download(path);
        if (error || !blob) throw new Error(`Erro ao baixar PDF: ${path}`);

        console.log(`Fazendo upload para Google File API: ${path}`);
        const uploaded = await ai.files.upload({
          file: blob,
          mimeType: "application/pdf",
        });
        googleFiles.push(uploaded);
        promptParts.push({
          text: `Documento Processual PDF: ${path}`
        });
        promptParts.push({
          fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType }
        });
      }

      // 3. Adicionar Instrução a prompt
      promptParts.push({
        text: `ANÁLISE JURÍDICA EXAUSTIVA REQUERIDA:\n\nInstrução:\nAnalise TODOS os arquivos anexos (processos em PDF e áudios de audiências).\nBusque por contradições entre:\n- Depoimentos vs. PDFs.\n- Depoimentos vs. Outros Depoimentos.\n\nRetorne os resultados em JSON estritamente no Schema configurado.`
      });

      console.log("Iniciando Geração de Conteúdo consolidada no Gemini...");
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: promptParts }],
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
      console.log("Limpando arquivos do Google File API...");
      for (const file of googleFiles) {
        await ai.files.delete({ name: file.name }).catch(console.error);
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });

  } catch (error: any) {
    console.error("Erro na Edge Function:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});
