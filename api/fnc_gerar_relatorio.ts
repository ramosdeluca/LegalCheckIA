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
   - "o_que_foi_dito": Personagem + fala precisa.
   - "o_que_diz_o_processo": Prova documental/depoimento contraditório.
   - "explicacao": Impacto jurídico (máx 2 linhas).
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
    // 1. Carregar Dados
    const { data: recordData, error: fetchErr } = await supabase
      .from('analises')
      .select('user_id, gemini_file_uris')
      .eq('id', recordId)
      .single();
      
    if (fetchErr || !recordData?.user_id) throw new Error("Usuário não encontrado.");
    const userId = recordData.user_id;
    const uris = recordData.gemini_file_uris || [];

    if (!uris.length) throw new Error("URIs dos arquivos não encontradas no banco.");

    // 2. Chamada Gemini (v1 estável)
    const modelName = "models/gemini-1.5-flash"; 
    const geminiUrl = `https://generativelanguage.googleapis.com/v1/${modelName}:generateContent?key=${geminiApiKey}`;
    
    // Preparar os componentes da mensagem
    const parts = uris.map((uri: string) => ({
      file_data: { file_uri: uri, mime_type: uri.endsWith('.pdf') ? 'application/pdf' : 'video/mp4' } // Mime-type aproximado
    }));
    
    parts.push({ text: `TAREFA: Realize a análise jurídica objetiva dos arquivos fornecidos. \n\n${ANALYSIS_PROMPT}` });

    const generationBody = {
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.0 }
    };

    console.log(`[Vercel API] Chamando Gemini v1 (via ${uris.length} URIs)...`);
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

    await supabase.rpc('deduct_credit', { user_id: userId });
    
    console.log(`[Vercel API] Sucesso final para ${recordId}`);
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
