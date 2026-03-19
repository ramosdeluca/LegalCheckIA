-- Adiciona campos na tabela profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS credits INT4 DEFAULT 1,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS status_assinatura TEXT DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS plan_type TEXT,
  ADD COLUMN IF NOT EXISTS ultima_invoice_url TEXT;

-- Criação da tabela de pagamentos
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asaas_id TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  valor NUMERIC(10, 2),
  status TEXT,
  data_pagamento TIMESTAMPTZ,
  url_fatura TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ativar RLS para segurança na tabela de pagamentos
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para pagamentos
CREATE POLICY "Usuários podem ver seus próprios pagamentos" 
  ON public.pagamentos FOR SELECT 
  USING (auth.uid() = user_id);

-- Atualiza usuários existentes que por acaso estejam sem créditos
UPDATE public.profiles SET credits = 1 WHERE credits IS NULL;

-- Gatilho existente de perfil: certificar-se de que a trigger do Supabase auth adiciona créditos (se necessário, o default 1 já cuida disso no INSERT)
-- Se o usuário tiver um handle_new_user, podemos substituí-lo para garantir o valor 1 explícito:
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, document, credits, status_assinatura)
  VALUES (
    new.id, 
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'document',
    1, 
    'inactive'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
