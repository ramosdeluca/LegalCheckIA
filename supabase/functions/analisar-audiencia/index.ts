import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
- RELEVÂNCIA (CRÍTICO): Concentre-se nas divergências mais importantes. O objetivo é um relatório focado. Liste NO MÁXIMO as 5 contradições mais relevantes.
- TIMESTAMP: Formato "Áudio X - MM:SS". Você deve identificar em qual arquivo a fala ocorreu e indicar o tempo exato. Exemplo: "Áudio 1 - 05:20".
- NUMERAÇÃO DE ARQUIVOS: A numeração de arquivos (Áudio 1, 2, 3... e PDF 1, 2, 3...) SEMPRE começa em 1. NUNCA use "Áudio 0".
- NÃO retorne "00:00" a menos que a fala tenha ocorrido exatamente no início do arquivo. Você DEVE ouvir o áudio para encontrar o ponto exato da fala.

REGRAS DE PREENCHIMENTO:
1. "resumo_executivo": Forneça um parágrafo detalhado resumindo as principais constatações da análise panorâmica do processo.
2. "analise_tendencia": Realize uma análise profunda e técnica apontando a tendência geral da prova oral (ex: credibilidade dos depoimentos, fragilidades encontradas, robustez das provas documentais vs. orais). Seja analítico.
3. Para cada item na lista de "contradicoes":
   - "timestamp": Formato "Áudio X - MM:SS". Identifique o arquivo (1, 2, 3...) e o tempo preciso.
   - "o_que_foi_dito": Deve conter DE QUEM é a fala e APENAS o que foi afirmado no vídeo/áudio no timestamp, preferencialmente entre aspas. Exemplo: "Testemunha 1: '...'".
   - "o_que_diz_o_processo": Deve conter APENAS a prova documental (PDF) ou depoimento anterior que contradiz a fala acima.
   - "explicacao": Forneça uma análise técnica concisa (no máximo 2 linhas) sobre o impacto jurídico dessa contradição para o resultado do processo.
`;

// Helper para upload de arquivos via REST API (Manual Multipart/Related) - OTIMIZADO PARA RAM
async function uploadToGemini(blob: Blob, fileName: string) {
  const url = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`;
  const boundary = "-------antigravity_boundary_" + Date.now();
  
  const metadata = JSON.stringify({
    file: {
      display_name: fileName,
    },
  });

  // Construir o corpo usando partes de Blob para evitar duplicar o conteúdo em RAM
  const header = 
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`;
  
  const footer = `\r\n--${boundary}--`;

  const bodyBlob = new Blob([
    new TextEncoder().encode(header),
    blob,
    new TextEncoder().encode(footer)
  ], { type: `multipart/related; boundary=${boundary}` });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body: bodyBlob,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Upload Error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.file;
}

// Helper para excluir arquivo via REST API
async function deleteGeminiFile(fileName: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiApiKey}`;
  await fetch(url, { method: 'DELETE' }).catch(console.error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  let currentAnaliseId: string | null = null;

  try {
    const bodyText = await req.text();
    const { processoId } = JSON.parse(bodyText);

    if (!processoId) {
      return new Response(JSON.stringify({ error: "processoId is required" }), { status: 400, headers: corsHeaders });
    }

    console.log(`Iniciando processamento para o processo: ${processoId}`);

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

    currentAnaliseId = analiseData.id;
    const videoUrls = analiseData.video_urls || (analiseData.video_url ? [analiseData.video_url] : []);
    const pdfUrls = analiseData.pdf_urls || (analiseData.pdf_url ? [analiseData.pdf_url] : []);

    if (videoUrls.length === 0 || pdfUrls.length === 0) {
       throw new Error("Nenhum arquivo de vídeo ou PDF encontrado para esta análise.");
    }

    const googleFiles: any[] = [];
    const contentsParts: any[] = [];

    try {
      // 1. Processar arquivos SEQUENCIALMENTE para economizar memória (evitar Memory limit exceeded)
      console.log(`Processando ${videoUrls.length} vídeos e ${pdfUrls.length} PDFs sequencialmente...`);
      
      const fileTasks = [
        ...videoUrls.map(url => ({ url, type: 'video' })),
        ...pdfUrls.map(url => ({ url, type: 'pdf' }))
      ];

      for (const task of fileTasks) {
        const path = task.url.split('/storage/v1/object/public/legalcheck/')[1];
        console.log(`[PROCESSANDO] ${task.type}: ${path}`);
        
        const { data: blob, error } = await supabase.storage.from('legalcheck').download(path);
        if (error || !blob) throw new Error(`Erro no download de ${task.type}: ${path}`);

        const file = await uploadToGemini(blob, path);
        console.log(`[OK] ${task.type}: ${path}`);
        
        googleFiles.push(file);
        contentsParts.push({ 
          text: `${task.type === 'video' ? 'Arquivo de Áudio/Vídeo' : 'Documento Processual PDF'}: ${path}` 
        });
        contentsParts.push({
          file_data: { file_uri: file.uri, mime_type: file.mimeType }
        });

        // Garantir que o blob seja limpo da memória antes do próximo arquivo
        // (No JS o garbage collector cuida disso, mas processar um por vez garante que não acumulem)
      }

      // 2. Adicionar Instrução e Gerar
      contentsParts.push({
        text: `ANÁLISE JURÍDICA EXAUSTIVA REQUERIDA:\n\nInstrução:\nAnalise TODOS os arquivos anexos (processos em PDF e áudios de audiências).\nBusque por contradições entre:\n- Depoimentos vs. PDFs.\n- Depoimentos vs. Outros Depoimentos.\n\nRetorne os resultados em JSON conforme solicitado.`
      });

      console.log("Enviando para Gemini (geração pode levar tempo)...");
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${geminiApiKey}`;
      
      const generationBody = {
        contents: [{ role: "user", parts: contentsParts }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
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

      const genResponse = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(generationBody),
      });

      if (!genResponse.ok) {
        const errText = await genResponse.text();
        throw new Error(`Gemini Generation Error: ${genResponse.status} - ${errText}`);
      }

      const genResult = await genResponse.json();
      const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
      const resultJson = JSON.parse(resultText || "{}");

      console.log("Sucesso! Salvando resultado no banco...");
      await supabase.from('analises').update({
        resultado_json: resultJson,
        status: 'concluido'
      }).eq('id', currentAnaliseId);

    } finally {
      console.log("Limpando arquivos temporários no Gemini...");
      for (const file of googleFiles) {
        await deleteGeminiFile(file.name);
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders, status: 200 });

  } catch (error: any) {
    console.error("ERRO CRÍTICO:", error.message);
    
    // Marcar como erro no banco para não travar a UI
    if (currentAnaliseId) {
      await supabase.from('analises').update({
        status: 'erro',
        resultado_json: { erro: error.message }
      }).eq('id', currentAnaliseId);
    }

    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});
