import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';

export default async function handler(req: any, res: any) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { userId, novoPlano } = req.body;

  if (!userId || !novoPlano) {
    return res.status(400).json({ error: 'Parâmetros ausentes' });
  }

  try {
    // 1. Buscar assinatura atual
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('subscription_id, plan_type')
      .eq('id', userId)
      .single();

    if (pErr || !profile?.subscription_id) {
      return res.status(400).json({ error: 'Assinatura ativa não encontrada' });
    }

    if (profile.plan_type === novoPlano) {
      return res.status(400).json({ error: `Você já está no plano ${novoPlano}` });
    }

    // 2. Configurar novos valores
    const valor = novoPlano === 'profissional' ? 597.00 : 297.00;
    const creditos = novoPlano === 'profissional' ? 20 : 5;
    const desc = `Plano ${novoPlano.charAt(0).toUpperCase() + novoPlano.slice(1)} - ExpertIA`;

    // 3. Chamar Asaas para atualização
    const asaasResp = await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
      method: 'PUT',
      headers: { 
        'access_token': ASAAS_API_KEY || '',
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        value: valor,
        description: desc,
        updatePendingPayments: true // Importante para atualizar faturas em aberto
      })
    });

    const asaasData = await asaasResp.json();

    if (!asaasResp.ok) {
      console.error("Asaas update error:", JSON.stringify(asaasData, null, 2));
      const firstError = asaasData.errors?.[0]?.description || 'Erro no Asaas';
      return res.status(400).json({ 
        error: `Erro Asaas: ${firstError}`, 
        details: asaasData 
      });
    }

    // 4. Atualizar Supabase
    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        plan_type: novoPlano,
        credits: creditos,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (upErr) throw upErr;

    return res.status(200).json({ success: true, nuovoPlano: novoPlano });
  } catch (error: any) {
    console.error("Erro interno em /alterar-plano:", error.message);
    return res.status(500).json({ error: 'Erro interno ao processar mudança de plano' });
  }
}
