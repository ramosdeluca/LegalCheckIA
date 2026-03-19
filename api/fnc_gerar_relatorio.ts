import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SERVICE_ROLE_KEY || '';
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';

const ANALYSIS_PROMPT = `
REQUISITO DE FORMATAÇÃO (Obrigatório retornar em JSON):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações.
2. "analise_tendencia": Aponte a tendência geral da prova de forma direta.
3. "contradicoes": Liste no máximo as 5 contradições mais relevantes contendo:
   - "timestamp": Formato "Áudio X - MM:SS".
   - "tipo": Tipo da contradição (ex: Factual, Depoimento contraditório, Documental).
   - "gravidade": Nível de impacto (Alta, Média ou Baixa).
   - "o_que_foi_dito": Personagem + transcrição fiel e MAIS DETALHADA da fala. Máximo 3 linhas.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório no processo.
   - "explicacao": Impacto jurídico da contradição.
`;

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const body = req.body || {};
  const record = body.record || body;

  console.log(`[Vercel API] Acionado para ID: ${record?.id}`);

  if (record?.status !== 'arquivos_prontos' || !record?.gemini_file_uris) {
    return res.status(200).json({ message: "Ignorado ou sem arquivos" });
  }

  const recordId = record.id;
  const cacheName = record.gemini_cache_name;

  try {
    // 1. Carregar Dados da Análise
    const { data: recordData, error: fetchErr } = await supabase
      .from('analises')
      .select('user_id, gemini_file_uris')
      .eq('id', recordId)
      .single();
      
    if (fetchErr || !recordData) throw new Error(`Análise ${recordId} não encontrada.`);
    
    const userId = recordData.user_id;
    const uris = recordData.gemini_file_uris || [];

    // 2. Carregar Créditos do Perfil (separado para evitar erro de join)
    const { data: profileData, error: profileErr } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (profileErr || !profileData) throw new Error("Perfil do usuário não encontrado.");
    const currentCredits = profileData.credits || 0;

    if (currentCredits <= 0) {
      throw new Error("Saldo insuficiente de créditos.");
    }

    if (!uris.length) throw new Error("URIs dos arquivos não encontradas no banco.");

    // 2. Chamada Gemini (CONFIRMADO: gemini-2.5-pro existe nesta chave)
    const modelName = "models/gemini-2.5-pro"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${geminiApiKey}`;
    
    // Preparar os componentes da mensagem
    const parts = uris.map((fileObj: any) => ({
      file_data: { file_uri: fileObj.uri, mime_type: fileObj.mime }
    }));
    
    const generationBody = {
      system_instruction: { 
        parts: [{ text: `Realize a análise jurídica objetiva dos arquivos fornecidos. \n\n${ANALYSIS_PROMPT}` }] 
      },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.0 }
    };

    console.log(`[Vercel API] Chamando Gemini 1.5 PRO v1beta (via ${uris.length} URIs)...`);
    const genResponse = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generationBody)
    });

    if (!genResponse.ok) {
      const errText = await genResponse.text();
      throw new Error(`Gemini Error: ${genResponse.status} - ${errText}`);
    }

    const genResult = await genResponse.json();
    const resultText = genResult.candidates?.[0]?.content?.parts?.[0]?.text;
    const cleanJson = resultText?.replace(/```json\n?|```/g, '').trim();
    const resultJson = JSON.parse(cleanJson || "{}");

    // 3. Sucesso - Update no Banco
    const expiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    await supabase.from('analises').update({
      resultado_json: resultJson,
      status: 'concluido',
      gemini_cache_expiry: expiry 
    }).eq('id', recordId);

    // Decrementar crédito manualmente (já que o RPC pode estar falhando ou ausente)
    await supabase.from('profiles').update({ 
      credits: Math.max(0, currentCredits - 1) 
    }).eq('id', userId);
    
    console.log(`[Vercel API] Sucesso final e crédito deduzido para ${recordId}`);
    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error(`[Vercel API] Erro:`, error.message);
    if (recordId) {
      await supabase.from('analises').update({
        status: 'erro',
        resultado_json: { erro: error.message }
      }).eq('id', recordId);
    }
    return res.status(500).json({ error: error.message });
  }
}
