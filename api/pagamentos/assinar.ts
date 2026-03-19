import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '', 
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';
const PARTNER_WALLET_ID = '0209fdc4-a1ab-440d-b990-280f03b8b345';

export default async function handler(req: any, res: any) {
  // CORS check for local dev or Vercel edge
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const { userId, plano, cpfCnpj, name, email, mobilePhone } = req.body;

  try {
    // 1. Verifica se já existe o asaas_customer_id no perfil
    const { data: profile } = await supabase
      .from('profiles')
      .select('asaas_customer_id, subscription_id, status_assinatura, plan_type, ultima_invoice_url')
      .eq('id', userId)
      .single();
      
    let customerId = profile?.asaas_customer_id;

    // 1.1 RECUPERAÇÃO DE FATURA: Se ele já iniciou assinatura INATIVA para o mesmo plano, retornar mesma URL.
    if (profile?.subscription_id && profile?.status_assinatura === 'inactive' && profile?.plan_type === plano && profile?.ultima_invoice_url) {
      try {
        // Validação adicional: Consultar o Asaas se a assinatura velha não expirou
        const checkResp = await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
          method: 'GET',
          headers: { 'access_token': ASAAS_API_KEY || '' }
        });
        const subStatus = await checkResp.json();
        
        // Se ela ainda estiver ativa (aguardando limite/cartão), reaproveitamos:
        if (checkResp.ok && subStatus.status === 'ACTIVE') {
          return res.status(200).json({ invoiceUrl: profile.ultima_invoice_url, subscriptionId: profile.subscription_id });
        }
      } catch (err) {
        console.error("Erro ao validar fatura pendente:", err);
      }
    }

    // 1.2 LIMPEZA: Se ele já tinha uma assinatura inativa (mesmo plano que expirou, ou plano diferente)
    if (profile?.subscription_id && profile?.status_assinatura === 'inactive') {
      try {
        await fetch(`${ASAAS_URL}/subscriptions/${profile.subscription_id}`, {
          method: 'DELETE',
          headers: { 'access_token': ASAAS_API_KEY || '' }
        });
      } catch (err) {
        console.error("Aviso: Falha ao deletar assinatura abandonada do asaas", err);
      }
    }

    // 2. Se não existir, cria o cliente no Asaas
    if (!customerId) {
      const customerResp = await fetch(`${ASAAS_URL}/customers`, {
        method: 'POST',
        headers: { 
          'access_token': ASAAS_API_KEY || '',
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ name, email, cpfCnpj, mobilePhone })
      });
      
      const customerData = await customerResp.json();
      
      if (!customerResp.ok) {
        console.error("Erro ao criar cliente no Asaas:", customerData);
        return res.status(400).json({ error: 'Erro ao criar cliente no Asaas', details: customerData });
      }
      
      customerId = customerData.id;
    }

    // Configurar o valor com base no plano
    let valor = 297.00; // basico
    if (plano === 'profissional') {
      valor = 597.00;
    } // 4. Cria a Assinatura (Recorrência Mensal)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1); // Cobrança começa amanhã
    const formattedDueDate = dueDate.toISOString().split('T')[0];

    const subResp = await fetch(`${ASAAS_URL}/subscriptions`, {
      method: 'POST',
      headers: { 
        'access_token': ASAAS_API_KEY || '',
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        customer: customerId,
        billingType: 'CREDIT_CARD', // Apenas cartão
        value: valor,
        nextDueDate: formattedDueDate, 
        cycle: 'MONTHLY',
        description: `Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)} - ExpertIA`,
        split: [{ walletId: PARTNER_WALLET_ID, percentualValue: 60 }]
      })
    });

    const subData = await subResp.json();
    
    if (!subResp.ok) {
      console.error("Erro ao criar assinatura:", subData);
      return res.status(400).json({ error: 'Erro ao criar assinatura', details: subData });
    }

    // 4.5. Busca a primeira cobrança (fatura) gerada para essa assinatura
    const paymentsResp = await fetch(`${ASAAS_URL}/subscriptions/${subData.id}/payments`, {
      method: 'GET',
      headers: { 'access_token': ASAAS_API_KEY || '' }
    });
    const paymentsData = await paymentsResp.json();
    
    // O Asaas não devolve o link na assinatura, devolve na "Cobrança" (Payment) filha dela.
    const invoiceUrl = paymentsData.data?.[0]?.invoiceUrl;

    if (!invoiceUrl) {
      console.error("Fatura não gerada ou não encontrada para a assinatura:", paymentsData);
      return res.status(400).json({ error: 'Link da fatura não retornado pelo Asaas', details: paymentsData });
    }

    // 5. Atualiza o banco com os dados da nova tentativa de assinatura
    await supabase.from('profiles').update({
      asaas_customer_id: customerId,
      plan_type: plano,
      subscription_id: subData.id,
      ultima_invoice_url: invoiceUrl,
      status_assinatura: 'inactive' // Forca inativo para previnir corrida de webhook do Asaas (Canceled)
    }).eq('id', userId);

    return res.status(200).json({ invoiceUrl, subscriptionId: subData.id });
  } catch (error: any) {
    console.error("Exception em /assinar:", error.message);
    return res.status(500).json({ error: 'Erro interno ao processar assinatura' });
  }
}
