-- SQL Schema for LegalCheck IA

-- Create profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create processos table
CREATE TABLE IF NOT EXISTS public.processos (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  numero_processo TEXT NOT NULL,
  cliente TEXT,
  descricao TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create analises table
CREATE TABLE IF NOT EXISTS public.analises (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  processo_id UUID REFERENCES public.processos ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  video_url TEXT,
  pdf_url TEXT,
  resultado_json JSONB,
  status TEXT DEFAULT 'pendente',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Set up Storage Buckets and Policies
-- Note: Buckets are usually created via UI, but we can set up policies here.
-- To create the bucket via SQL (if permissions allow):
INSERT INTO storage.buckets (id, name, public) 
VALUES ('legalcheck', 'legalcheck', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies for 'legalcheck' bucket
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'legalcheck');
CREATE POLICY "Authenticated users can upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'legalcheck' AND auth.role() = 'authenticated');
CREATE POLICY "Users can update their own objects" ON storage.objects FOR UPDATE USING (bucket_id = 'legalcheck' AND auth.uid() = owner);
CREATE POLICY "Users can delete their own objects" ON storage.objects FOR DELETE USING (bucket_id = 'legalcheck' AND auth.uid() = owner);

-- Set up Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analises ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Policies for processos
CREATE POLICY "Users can manage their own processos" ON public.processos
  FOR ALL USING (auth.uid() = user_id);

-- Policies for analises
CREATE POLICY "Users can manage their own analises" ON public.analises
  FOR ALL USING (auth.uid() = user_id);

-- Function to handle new user profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (new.id, new.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
