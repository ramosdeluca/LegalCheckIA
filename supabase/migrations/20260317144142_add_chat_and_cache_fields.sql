-- Política para permitir que usuários excluam mensagens dos seus processos
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Usuários podem excluir mensagens dos seus processos') THEN
        CREATE POLICY "Usuários podem excluir mensagens dos seus processos" ON public.analise_chats
            FOR DELETE USING (
                EXISTS (
                    SELECT 1 FROM public.processos p
                    WHERE p.id = public.analise_chats.processo_id
                    AND p.user_id = auth.uid()
                )
            );
    END IF;
END $$;
