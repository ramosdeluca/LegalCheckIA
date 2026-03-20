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
      .select('subscription_id, plan_type, asaas_customer_id')
      .eq('id', userId)
      .single();

    if (pErr || !profile?.subscription_id) {
      return res.status(400).json({ error: 'Assinatura ativa não encontrada' });
    }

    if (profile.plan_type === novoPlano) {
      return res.status(400).json({ error: `Você já está no plano ${novoPlano}` });
    }

    // 1.5 Buscar detalhes da assinatura atual no Asaas
    const asaasGetResp = await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
      method: 'GET',
      headers: { 'access_token': ASAAS_API_KEY || '' }
    });
    const oldSub = await asaasGetResp.json();
    
    // Forçamos o próximo vencimento para o dia 20 do próximo mês (Abril), para "consertar" o pulo do Asaas
    const d = new Date();
    // Se hoje for dia 20 ou mais, o próximo é no mês que vem
    if (d.getDate() >= 20) {
      d.setMonth(d.getMonth() + 1);
    }
    d.setDate(20);
    const nextDueDate = d.toISOString().split('T')[0];
    
    console.log(`Fix Debug: Forcing new nextDueDate to ${nextDueDate}`);

    // 2. Definir novos valores
    const valor = novoPlano === 'profissional' ? 597.00 : 297.00;
    const creditos = novoPlano === 'profissional' ? 20 : 5;
    const desc = `Plano ${novoPlano.charAt(0).toUpperCase() + novoPlano.slice(1)} - ExpertIA`;

    // 3. Deletar Assinatura Antiga
    try {
      await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
        method: 'DELETE',
        headers: { 'access_token': ASAAS_API_KEY || '' }
      });
    } catch (err) {
      console.warn("Aviso: Falha ao deletar assinatura anterior");
    }

    // 4. Criar Nova Assinatura no Asaas (Mantendo o mesmo ciclo de cobrança)
    const subResp = await fetch(`${ASAAS_URL}/subscriptions`, {
      method: 'POST',
      headers: { 
        'access_token': ASAAS_API_KEY || '',
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        customer: profile.asaas_customer_id,
        billingType: 'CREDIT_CARD',
        value: valor,
        nextDueDate: nextDueDate, // Preserva o dia de vencimento original
        cycle: 'MONTHLY',
        description: desc,
        split: [{ walletId: '0209fdc4-a1ab-440d-b990-280f03b8b345', percentualValue: 60 }]
      })
    });

    const subData = await subResp.json();

    if (!subResp.ok) {
      console.error("Asaas recreation error:", JSON.stringify(subData, null, 2));
      const firstError = subData.errors?.[0]?.description || 'Erro ao criar nova assinatura';
      return res.status(400).json({ error: `Erro Asaas: ${firstError}`, details: subData });
    }

    // 5. Atualizar Supabase com a nova assinatura e créditos
    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        plan_type: novoPlano,
        credits: creditos,
        subscription_id: subData.id, // Novo ID
        status_assinatura: oldSub.status === 'ACTIVE' ? 'active' : 'inactive', 
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
