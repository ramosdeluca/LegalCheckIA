import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { event, payment, subscription } = req.body;
  const asaasCustomerId = payment?.customer || subscription?.customer;

  if (!asaasCustomerId) {
    return res.status(200).send('Ignorado: Sem Customer ID');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, plan_type, credits, subscription_id')
    .eq('asaas_customer_id', asaasCustomerId)
    .single();

  if (profileError || !profile) {
    console.error(`Usuário não encontrado: ${asaasCustomerId}`);
    return res.status(200).send('Usuário não localizado');
  }

  // Prevenção de "Race Condition": Se o webhook for de uma assinatura antiga que já foi trocada/deletada, ignore.
  const reqSubscriptionId = subscription?.id || payment?.subscription;
  if (reqSubscriptionId && profile.subscription_id && reqSubscriptionId !== profile.subscription_id) {
    console.log(`Ignorando webhook: Assinatura do evento (${reqSubscriptionId}) difere da atual do usuário (${profile.subscription_id})`);
    return res.status(200).send('Ignorado: Pertence a uma assinatura antiga/deletada do cliente.');
  }

  try {
    switch (event) {
      case 'PAYMENT_CONFIRMED': {
        const pacoteMensal = profile.plan_type === 'profissional' ? 20 : 5;
        
        await supabase.from('profiles').update({ 
          credits: pacoteMensal, 
          status_assinatura: 'active' 
        }).eq('id', profile.id);

        await supabase.from('pagamentos').upsert({
          asaas_id: payment.id,
          user_id: profile.id,
          valor: payment.value,
          status: 'pago_confirmado',
          url_fatura: payment.invoiceUrl,
          data_pagamento: new Date().toISOString()
        }, { onConflict: 'asaas_id' });
        
        console.log(`✅ [LIBERADO] ${pacoteMensal} créditos para o user ${profile.id}`);
        break;
      }

      case 'PAYMENT_RECEIVED': {
        await supabase.from('pagamentos').update({ 
          status: 'dinheiro_em_conta' 
        }).eq('asaas_id', payment.id);
        
        console.log(`💰 [RECEBIDO] Saldo disponível no Asaas para a fatura ${payment.id}`);
        break;
      }

      case 'PAYMENT_OVERDUE': {
        await supabase.from('profiles').update({ 
          status_assinatura: 'past_due',
          credits: 0 
        }).eq('id', profile.id);
        
        console.log(`⚠️ [BLOQUEADO] Inadimplência detectada para ${profile.id}`);
        break;
      }

      case 'SUBSCRIPTION_DELETED': {
        await supabase.from('profiles').update({ 
          status_assinatura: 'canceled',
          credits: 0,
          plan_type: null 
        }).eq('id', profile.id);
        
        console.log(`🚫 [CANCELADO] Assinatura removida para ${profile.id}`);
        break;
      }
    }

    return res.status(200).send('Webhook Processado com Sucesso');
  } catch (err: any) {
    console.error("Erro Webhook Process", err.message);
    return res.status(500).send('Erro interno');
  }
}
