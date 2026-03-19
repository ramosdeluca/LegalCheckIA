import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, prefer',
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

const SYSTEM_INSTRUCTION = `
Você é um Engenheiro Jurídico de elite, especializado em análise minuciosa de audiências judiciais e processos complexos.
Sua tarefa é realizar uma auditoria completa dos arquivos anexados (áudio/vídeo da audiência e/ou PDF do processo) para identificar contradições, fatos relevantes e fornecer uma síntese conclusiva.

DIRETRIZES GERAIS (Sempre siga estas regras):
- Identifique e analise o depoimento de CADA pessoa (Autor, Réu, Testemunha 1, 2, 3, etc.).
- Compare o depoimento com o PDF (Contradição Documental) e entre testemunhas.
- TIMESTAMP: Formato "Áudio X - MM:SS". Identifique o arquivo e o tempo exato (NUNCA use 00:00 se não for o início).
- NUMERAÇÃO: Áudio 1, 2, 3... PDF 1, 2, 3... (Sempre começa em 1).
- Seja técnico, imparcial e extremamente detalhista.
`;

// Helper para upload de arquivos via REST API (Resumable Upload) - STREAMING PURO
async function uploadToGemini(fileUrl: string, fileName: string, maxRetries = 3) {
  const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headRes = await fetch(fileUrl, { method: 'GET' });
      if (!headRes.ok) throw new Error(`Erro ao acessar arquivo: ${headRes.status}`);
      
      const fileSize = parseInt(headRes.headers.get('content-length') || '0');
      const mimeType = headRes.headers.get('content-type') || 'application/octet-stream';
      
      console.log(`[GEMINI] Tentativa ${attempt + 1}: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
      
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

      const startTime = Date.now();
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'upload, finalize',
          'X-Goog-Upload-Offset': '0',
        },
        body: headRes.body,
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

// Helper para criar Context Cache no Gemini (v1beta)
async function createGeminiCache(parts: any[], model: string = "models/gemini-2.5-flash", systemInstruction?: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${geminiApiKey}`;
  
  const body: any = {
    model: model,
    contents: [{ role: "user", parts: parts }],
    ttl: "14400s", // 4 horas
    display_name: `analise-${Date.now()}`
  };

  if (systemInstruction) {
    body.system_instruction = { parts: [{ text: systemInstruction }] };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini Cache Error: ${response.status} - ${errText}`);
  }

  return await response.json();
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
    console.log(`[fnc_upload_gemini] Chamada recebida para processoId: ${processoId}`);

    if (!processoId) {
      return new Response(JSON.stringify({ error: "processoId is required" }), { status: 400, headers: corsHeaders });
    }

    console.log(`[fnc_upload_gemini] Iniciando upload para o processo: ${processoId}`);

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
    const geminiFileData: any[] = [];
    const cacheParts: any[] = [];

    console.log(`Processando ${videoUrls.length} mídias e ${pdfUrls.length} PDFs...`);
    
    const fileTasks = [
      ...videoUrls.map(url => ({ url, type: 'video' })),
      ...pdfUrls.map((url: string) => ({ url, type: 'pdf' }))
    ];

    for (const task of fileTasks) {
      const path = task.url.split('/storage/v1/object/public/legalcheck/')[1];
      const { data: { publicUrl } } = supabase.storage.from('legalcheck').getPublicUrl(path);

      const file = await uploadToGemini(publicUrl, path);
      googleFiles.push(file);
      geminiFileData.push({ uri: file.uri, mime: file.mimeType });
    }

    console.log("[fnc_upload_gemini] Arquivos processados. Salvando URIs no banco...");
    
    // Salvando os links seguros (URIs) no banco para a função de relatório usar
    const { error: updateErr } = await supabase
      .from('analises')
      .update({ 
        gemini_file_uris: geminiFileData,
        status: 'arquivos_prontos' 
      })
      .eq('id', currentAnaliseId);

    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ 
      success: true,
      files: geminiFileData.length
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 200 
    });

    // NOTA: Os arquivos permanecem no Gemini para a próxima função poder acessá-los.
    // O Gemini os deleta automaticamente após 2 dias por padrão nos uploads temporários.

  } catch (error: any) {
    console.error("ERRO CRÍTICO no upload:", error.message);
    
    if (currentAnaliseId) {
      await supabase.from('analises').update({
        status: 'erro',
        resultado_json: { erro: error.message }
      }).eq('id', currentAnaliseId);
    }

    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});
