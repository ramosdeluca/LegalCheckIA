import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'ID do usuário não fornecido.' });

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_id')
      .eq('id', userId)
      .single();
      
    if (!profile?.subscription_id) {
      return res.status(400).json({ error: 'Nenhuma assinatura ativa encontrada para este usuário.' });
    }

    // 1. Cancel on Asaas
    const cancelResp = await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
      method: 'DELETE',
      headers: { 'access_token': ASAAS_API_KEY || '' }
    });

    if (!cancelResp.ok) {
      const errorData = await cancelResp.json();
      console.error("Erro ao cancelar no Asaas:", errorData);
      return res.status(400).json({ error: 'Erro ao processar cancelamento no servidor.', details: errorData });
    }

    // 2. Update status in Supabase
    await supabase.from('profiles').update({
      status_assinatura: 'canceled',
      credits: 0,
      plan_type: null
    }).eq('id', userId);

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error("Exception em /cancelar:", error.message);
    return res.status(500).json({ error: 'Erro interno ao processar cancelamento.' });
  }
}
