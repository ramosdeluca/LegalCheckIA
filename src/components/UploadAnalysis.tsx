import React, { useState, useCallback } from 'react';
import { Upload, FileVideo, FileText, Loader2, CheckCircle2, AlertCircle, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeHearing } from '../services/geminiService';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface UploadAnalysisProps {
  processoId: string;
  onAnalysisComplete: (result: any, videoUrl?: string, pdfUrl?: string) => void;
}

export const UploadAnalysis: React.FC<UploadAnalysisProps> = ({ processoId, onAnalysisComplete }) => {
  const { user } = useAuth();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } catch (err: any) {
      console.error('PDF Extraction Error:', err);
      throw new Error('Falha ao ler o PDF. Verifique se o arquivo não está protegido por senha.');
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const handleStartAnalysis = async () => {
    if (!videoFile || !pdfFile) return;
    if (!user) return;

    setIsAnalyzing(true);
    setError(null);
    setProgress('Subindo arquivos para o servidor seguro...');

    try {
      // 0. Cleanup old analysis for this process to save space and keep only the latest
      setProgress('Limpando análises anteriores...');
      const { data: oldAnalises } = await supabase
        .from('analises')
        .select('id, video_url, pdf_url')
        .eq('processo_id', processoId);

      if (oldAnalises && oldAnalises.length > 0) {
        const filesToDelete: string[] = [];
        oldAnalises.forEach(a => {
          if (a.video_url) {
            const path = a.video_url.split('/storage/v1/object/public/legalcheck/')[1];
            if (path) filesToDelete.push(path);
          }
          if (a.pdf_url) {
            const path = a.pdf_url.split('/storage/v1/object/public/legalcheck/')[1];
            if (path) filesToDelete.push(path);
          }
        });

        if (filesToDelete.length > 0) {
          await supabase.storage.from('legalcheck').remove(filesToDelete);
        }

        // Delete old records
        await supabase.from('analises').delete().eq('processo_id', processoId);
      }

      setProgress('Subindo arquivos para o servidor seguro...');

      // 1. Upload Media (Video or Audio) to Supabase Storage
      const mediaExt = videoFile.name.split('.').pop();
      const mediaType = videoFile.type.startsWith('video') ? 'video' : 'audio';
      const mediaPath = `${user.id}/${Date.now()}_${mediaType}.${mediaExt}`;
      const { data: mediaData, error: mediaError } = await supabase.storage
        .from('legalcheck')
        .upload(mediaPath, videoFile);

      if (mediaError) throw new Error(`Erro no upload da mídia: ${mediaError.message}`);

      // 2. Upload PDF to Supabase Storage
      const pdfPath = `${user.id}/${Date.now()}_processo.pdf`;
      const { data: pdfData, error: pdfError } = await supabase.storage
        .from('legalcheck')
        .upload(pdfPath, pdfFile);

      if (pdfError) throw new Error(`Erro no upload do PDF: ${pdfError.message}`);

      // Get Public URLs
      const { data: { publicUrl: mediaUrl } } = supabase.storage.from('legalcheck').getPublicUrl(mediaPath);
      const { data: { publicUrl: pdfUrl } } = supabase.storage.from('legalcheck').getPublicUrl(pdfPath);

      setProgress('Extraindo texto do PDF...');
      const pdfText = await extractTextFromPdf(pdfFile);
      
      setProgress('Preparando mídia para análise (isso pode levar alguns minutos)...');
      const mediaBase64 = await fileToBase64(videoFile);

      setProgress('IA analisando audiência e buscando contradições...');
      const result = await analyzeHearing(mediaBase64, pdfText, videoFile.type);

      // Save analysis to Supabase
      const { error: dbError } = await supabase.from('analises').insert({
        processo_id: processoId,
        user_id: user.id,
        status: 'concluido',
        resultado_json: result,
        video_url: mediaUrl,
        pdf_url: pdfUrl
      });

      if (dbError) throw dbError;

      onAnalysisComplete(result, mediaUrl, pdfUrl);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro durante a análise. Verifique o tamanho dos arquivos.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-black/5 p-8">
      <div className="mb-8">
        <h2 className="text-2xl font-serif text-[#1a1a1a] mb-2">Upload de Provas</h2>
        <p className="text-gray-500">Suba o vídeo da audiência e o PDF do processo para iniciar a análise.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Media Upload */}
        <div 
          className={`relative border-2 border-dashed rounded-3xl p-8 transition-all flex flex-col items-center justify-center gap-4 cursor-pointer
            ${videoFile ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-200 hover:border-[#5A5A40]/50'}`}
        >
          <input 
            type="file" 
            accept="video/*,audio/*" 
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
          />
          {videoFile ? (
            <>
              <div className="w-16 h-16 bg-[#5A5A40] text-white rounded-full flex items-center justify-center">
                {videoFile.type.startsWith('video') ? <FileVideo size={32} /> : <Play size={32} />}
              </div>
              <div className="text-center">
                <p className="font-medium text-[#1a1a1a] truncate max-w-[200px]">{videoFile.name}</p>
                <p className="text-xs text-gray-500">{videoFile.type.startsWith('video') ? 'Vídeo' : 'Áudio'} selecionado</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <p className="font-medium text-[#1a1a1a]">Mídia da Audiência</p>
                <p className="text-xs text-gray-500">Vídeo ou Áudio (Arraste ou clique)</p>
              </div>
            </>
          )}
        </div>

        {/* PDF Upload */}
        <div 
          className={`relative border-2 border-dashed rounded-3xl p-8 transition-all flex flex-col items-center justify-center gap-4 cursor-pointer
            ${pdfFile ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-200 hover:border-[#5A5A40]/50'}`}
        >
          <input 
            type="file" 
            accept="application/pdf" 
            className="absolute inset-0 opacity-0 cursor-pointer"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
          />
          {pdfFile ? (
            <>
              <div className="w-16 h-16 bg-[#5A5A40] text-white rounded-full flex items-center justify-center">
                <FileText size={32} />
              </div>
              <div className="text-center">
                <p className="font-medium text-[#1a1a1a] truncate max-w-[200px]">{pdfFile.name}</p>
                <p className="text-xs text-gray-500">PDF selecionado</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <p className="font-medium text-[#1a1a1a]">PDF do Processo</p>
                <p className="text-xs text-gray-500">Arraste ou clique para subir</p>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3">
          <AlertCircle size={20} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      <button
        onClick={handleStartAnalysis}
        disabled={!videoFile || !pdfFile || isAnalyzing}
        className="w-full bg-[#5A5A40] text-white rounded-2xl py-5 font-medium hover:bg-[#4a4a35] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-[#5A5A40]/20"
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="animate-spin" size={24} />
            <span>{progress}</span>
          </>
        ) : (
          <>
            <Play size={24} />
            <span>Iniciar Análise Jurídica</span>
          </>
        )}
      </button>

      <AnimatePresence>
        {isAnalyzing && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-8 p-6 bg-gray-50 rounded-2xl border border-gray-100"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-[#5A5A40]"
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                />
              </div>
            </div>
            <p className="text-center text-sm text-gray-500 font-mono uppercase tracking-widest animate-pulse">
              Processando evidências...
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
