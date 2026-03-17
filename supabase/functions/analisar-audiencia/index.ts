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
Sua tarefa é realizar uma auditoria completa dos arquivos anexados (áudio/vídeo da audiência e/ou PDF do processo) para identificar contradições, fatos relevantes e fornecer uma síntese conclusiva.

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

// Helper para upload de arquivos via REST API (Resumable Upload) - STREAMING PURO (MEMÓRIA EFICIENTE)
async function uploadToGemini(fileUrl: string, fileName: string, maxRetries = 3) {
  const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 0. Obter headers (tamanho e tipo) sem baixar o corpo ainda
      const headRes = await fetch(fileUrl, { method: 'GET' });
      if (!headRes.ok) throw new Error(`Erro ao acessar arquivo: ${headRes.status}`);
      
      const fileSize = parseInt(headRes.headers.get('content-length') || '0');
      const mimeType = headRes.headers.get('content-type') || 'application/octet-stream';
      
      console.log(`[GEMINI] Tentativa ${attempt + 1}: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      
      // 1. INICIAR SESSÃO DE UPLOAD
      const initResponse = await fetch(initUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
          'X-Goog-Upload-Header-Content-Type': mimeType,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file: { display_name: fileName } }),
      });

      if (!initResponse.ok) {
        const errText = await initResponse.text();
        console.warn(`[GEMINI] Erro no Init (Tentativa ${attempt + 1}): ${initResponse.status}`);
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        throw new Error(`Gemini Init Upload Error: ${initResponse.status} - ${errText}`);
      }

      const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
      if (!uploadUrl) throw new Error("Gemini Upload Error: Falha ao obter URL de upload resumível.");

      // 2. ENVIAR O CONTEÚDO (STREAM DIRETO)
      const startTime = Date.now();
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
        },
        body: headRes.body, // Passando o corpo como stream
      });

      if (response.ok) {
        const result = await response.json();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[GEMINI] Upload concluído em ${duration}s: ${fileName}`);
        return result.file;
      }

      const errorText = await response.text();
      console.warn(`[GEMINI] Upload falhou (Tentativa ${attempt + 1}): ${response.status} - ${errorText}`);

      if (response.status === 503 || response.status === 500 || response.status === 429 || response.status === 400) {
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 2000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      throw new Error(`Gemini Upload Error: ${response.status} - ${errorText}`);

    } catch (error: any) {
      if (attempt === maxRetries - 1) throw error;
      console.warn(`[GEMINI] Erro inesperado na tentativa ${attempt + 1}:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
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

    if (videoUrls.length === 0 && pdfUrls.length === 0) {
       throw new Error("Nenhum arquivo de vídeo/áudio ou PDF encontrado para esta análise.");
    }

    const googleFiles: any[] = [];
    const contentsParts: any[] = [];

    try {
      // 1. Processar arquivos SEQUENCIALMENTE com STREAMING para economia de RAM
      console.log(`Processando ${videoUrls.length} mídias e ${pdfUrls.length} PDFs...`);
      
      const fileTasks = [
        ...videoUrls.map(url => ({ url, type: 'video' })),
        ...pdfUrls.map(url => ({ url, type: 'pdf' }))
      ];

      for (const task of fileTasks) {
        const path = task.url.split('/storage/v1/object/public/legalcheck/')[1];
        console.log(`[PROCESSANDO] ${task.type}: ${path}`);
        
        // Obter URL pública para streaming
        const { data: { publicUrl } } = supabase.storage.from('legalcheck').getPublicUrl(path);

        const file = await uploadToGemini(publicUrl, path);
        console.log(`[OK] ${task.type}: ${path}`);
        
        googleFiles.push(file);
        contentsParts.push({ 
          text: `${task.type === 'video' ? 'Arquivo de Áudio/Vídeo' : 'Documento Processual PDF'}: ${path}` 
        });
        contentsParts.push({
          file_data: { file_uri: file.uri, mime_type: file.mimeType }
        });
      }

      // 2. Adicionar Instrução e Gerar
      contentsParts.push({
        text: `ANÁLISE JURÍDICA REQUERIDA:\n\nInstrução:\nAnalise os arquivos anexos. Dependendo do que foi enviado, busque por:\n- Contradições entre Depoimentos vs. PDFs (se ambos disponíveis).\n- Contradições entre diferentes Depoimentos (se múltiplas mídias disponíveis).\n- Fatos relevantes e tendências baseados no que estiver presente.\n\nRetorne os resultados em JSON conforme solicitado.`
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
        
        const delay = Math.pow(2, attempt) * 2000;
        console.log(`[GEMINI] Tentando nova geração em ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
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
        await deleteGeminiFile(file.name).catch(() => {});
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
