import React, { useState, useCallback } from 'react';
import { Upload, FileVideo, FileText, Loader2, CheckCircle2, AlertCircle, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeHearing } from '../services/geminiService';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';
import { extractAudioFromVideo } from '../utils/audioExtractor';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface UploadAnalysisProps {
  processoId: string;
  onAnalysisStarted: () => void;
}

export const UploadAnalysis: React.FC<UploadAnalysisProps> = ({ processoId, onAnalysisStarted }) => {
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

      setProgress('Extraindo áudio do vídeo para análise...');
      const mediaToUpload = await extractAudioFromVideo(videoFile);

      setProgress('Subindo arquivos para o servidor seguro...');

      // 1. Upload Media (Video or Audio) to Supabase Storage
      const mediaExt = mediaToUpload.name.split('.').pop();
      const mediaPath = `${user.id}/${Date.now()}_audio.${mediaExt}`;
      const { data: mediaData, error: mediaError } = await supabase.storage
        .from('legalcheck')
        .upload(mediaPath, mediaToUpload);

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

      // Save analysis to Supabase with status 'processando'
      const { error: dbError } = await supabase.from('analises').insert({
        processo_id: processoId,
        user_id: user.id,
        status: 'processando',
        resultado_json: null,
        video_url: mediaUrl,
        pdf_url: pdfUrl
      });

      if (dbError) throw dbError;

      // Chama a função server-side background "Fire-and-forget"
      supabase.functions.invoke('analisar-audiencia', {
        body: { processoId: processoId }
      }).catch(console.error);

      // Informa o Dashboard que iniciou
      onAnalysisStarted();
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Erro durante a análise. Verifique o tamanho dos arquivos.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="relative bg-white/40 backdrop-blur-3xl rounded-[40px] shadow-2xl border border-white/60 p-10 overflow-hidden">
      {/* Decorative gradient blob */}
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#5A5A40]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-[#5A5A40]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative mb-8 text-center">
        <h2 className="text-3xl font-serif text-[#1a1a1a] mb-3 tracking-tight">Upload de Provas</h2>
        <p className="text-gray-500 font-medium">Suba a mídia da audiência e o PDF do processo para iniciar a análise.</p>
      </div>

      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
        {/* Media Upload */}
        <div
          className={`group relative border-2 border-dashed rounded-[32px] p-10 transition-all duration-300 flex flex-col items-center justify-center gap-5 cursor-pointer overflow-hidden
            ${videoFile ? 'border-[#5A5A40] bg-[#5A5A40]/5 shadow-inner' : 'border-gray-300/80 hover:border-[#5A5A40]/50 hover:bg-white/50 hover:shadow-xl hover:-translate-y-1'}`}
        >
          <input
            type="file"
            accept="video/*,audio/*"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
          />
          {videoFile ? (
            <>
              <div className="w-20 h-20 bg-gradient-to-br from-[#5A5A40] to-[#3A3A20] text-white rounded-[24px] flex items-center justify-center shadow-lg shadow-[#5A5A40]/20 transform transition-transform group-hover:scale-105">
                {videoFile.type.startsWith('video') ? <FileVideo size={36} /> : <Play size={36} />}
              </div>
              <div className="text-center z-10">
                <p className="font-semibold text-[#1a1a1a] truncate max-w-[200px] text-lg">{videoFile.name}</p>
                <p className="text-sm font-medium text-[#5A5A40] mt-1">{videoFile.type.startsWith('video') ? 'Vídeo' : 'Áudio'} selecionado</p>
              </div>
            </>
          ) : (
            <>
              <div className="relative z-10 w-20 h-20 bg-white text-gray-400 rounded-[24px] flex items-center justify-center shadow-sm border border-gray-100 transform transition-all group-hover:scale-110 group-hover:rotate-3 group-hover:text-[#5A5A40]">
                <Upload size={36} />
              </div>
              <div className="text-center relative z-10">
                <p className="font-semibold text-[#1a1a1a] text-lg mb-1">Mídia da Audiência</p>
                <p className="text-sm font-medium text-gray-500">Vídeo ou Áudio (Arraste ou clique)</p>
              </div>
            </>
          )}
        </div>

        {/* PDF Upload */}
        <div
          className={`group relative border-2 border-dashed rounded-[32px] p-10 transition-all duration-300 flex flex-col items-center justify-center gap-5 cursor-pointer overflow-hidden
            ${pdfFile ? 'border-[#5A5A40] bg-[#5A5A40]/5 shadow-inner' : 'border-gray-300/80 hover:border-[#5A5A40]/50 hover:bg-white/50 hover:shadow-xl hover:-translate-y-1'}`}
        >
          <input
            type="file"
            accept="application/pdf"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
          />
          {pdfFile ? (
            <>
              <div className="w-20 h-20 bg-gradient-to-br from-[#5A5A40] to-[#3A3A20] text-white rounded-[24px] flex items-center justify-center shadow-lg shadow-[#5A5A40]/20 transform transition-transform group-hover:scale-105">
                <FileText size={36} />
              </div>
              <div className="text-center z-10">
                <p className="font-semibold text-[#1a1a1a] truncate max-w-[200px] text-lg">{pdfFile.name}</p>
                <p className="text-sm font-medium text-[#5A5A40] mt-1">PDF selecionado</p>
              </div>
            </>
          ) : (
            <>
              <div className="relative z-10 w-20 h-20 bg-white text-gray-400 rounded-[24px] flex items-center justify-center shadow-sm border border-gray-100 transform transition-all group-hover:scale-110 group-hover:-rotate-3 group-hover:text-[#5A5A40]">
                <Upload size={36} />
              </div>
              <div className="text-center relative z-10">
                <p className="font-semibold text-[#1a1a1a] text-lg mb-1">PDF do Processo</p>
                <p className="text-sm font-medium text-gray-500">Arraste ou clique para subir</p>
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
        className="w-full relative overflow-hidden bg-[#5A5A40] text-white rounded-[24px] py-5 font-semibold text-lg hover:bg-[#4a4a35] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-[#5A5A40]/30 transform active:scale-[0.98]"
      >
        {isAnalyzing && (
          <div className="absolute inset-0 bg-white/20 animate-pulse pointer-events-none" />
        )}
        {isAnalyzing ? (
          <>
            <Loader2 className="animate-spin text-white/80" size={26} />
            <span className="relative z-10">{progress}</span>
          </>
        ) : (
          <>
            <Play size={26} className="fill-current" />
            <span className="relative z-10 tracking-wide">Iniciar Análise Jurídica Exaustiva</span>
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
