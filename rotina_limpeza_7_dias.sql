-- Habilitar a extensão pg_cron (caso ainda não esteja habilitada no seu projeto)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Criar a função nativa que realiza a exclusão física e lógica
CREATE OR REPLACE FUNCTION public.limpar_midias_antigas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Deletar (Exclusão Física) os arquivos do Supabase Storage
  -- Remove todos os objetos do bucket 'legalcheck' que foram criados há mais de 7 dias
  DELETE FROM storage.objects 
  WHERE bucket_id = 'legalcheck'
  AND created_at < NOW() - INTERVAL '7 days';

  -- 2. Limpar as Referências (Exclusão Lógica) na tabela analises
  -- Evita que o banco de dados fique guardando URLs fantasmas
  UPDATE public.analises
  SET video_url = NULL,
      pdf_url = NULL,
      video_urls = NULL,
      pdf_urls = NULL
  WHERE created_at < NOW() - INTERVAL '7 days';

END;
$$;

-- Agendar a rotina para rodar automaticamente TODOS OS DIAS à meia-noite (00:00 UTC)
SELECT cron.schedule(
  'cleanup-midias-diario-7dias',
  '0 0 * * *',
  'SELECT public.limpar_midias_antigas()'
);
