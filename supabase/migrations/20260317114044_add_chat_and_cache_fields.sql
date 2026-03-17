-- Alterar tabela analises para suportar cache do Gemini
ALTER TABLE public.analises 
ADD COLUMN IF NOT EXISTS gemini_cache_name TEXT,
ADD COLUMN IF NOT EXISTS gemini_cache_expiry TIMESTAMPTZ;

-- Criar tabela de chat para as análises
CREATE TABLE IF NOT EXISTS public.analise_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analise_id UUID REFERENCES public.analises(id) ON DELETE CASCADE,
    processo_id UUID REFERENCES public.processos(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.analise_chats ENABLE ROW LEVEL SECURITY;

-- Políticas de segurança
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuários podem ver chats dos seus processos') THEN
        CREATE POLICY "Usuários podem ver chats dos seus processos" ON public.analise_chats
            FOR SELECT USING (
                EXISTS (
                    SELECT 1 FROM public.processos p
                    WHERE p.id = public.analise_chats.processo_id
                    AND p.user_id = auth.uid()
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuários podem inserir mensagens nos seus processos') THEN
        CREATE POLICY "Usuários podem inserir mensagens nos seus processos" ON public.analise_chats
            FOR INSERT WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.processos p
                    WHERE p.id = public.analise_chats.processo_id
                    AND p.user_id = auth.uid()
                )
            );
    END IF;
END $$;
