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
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
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
    if (videoFiles.length === 0 || pdfFiles.length === 0) return;
    if (!user) return;

    setIsAnalyzing(true);
    setError(null);
    setProgress('Limpando análises anteriores...');

    try {
      // 0. Cleanup old analysis for this process
      const { data: oldAnalises } = await supabase
        .from('analises')
        .select('id, video_url, pdf_url, video_urls, pdf_urls')
        .eq('processo_id', processoId);

      if (oldAnalises && oldAnalises.length > 0) {
        const filesToDelete: string[] = [];
        oldAnalises.forEach(a => {
          // Legacy check
          if (a.video_url) {
            const path = a.video_url.split('/storage/v1/object/public/legalcheck/')[1];
            if (path) filesToDelete.push(path);
          }
          if (a.pdf_url) {
            const path = a.pdf_url.split('/storage/v1/object/public/legalcheck/')[1];
            if (path) filesToDelete.push(path);
          }
          // New format check
          if (a.video_urls && Array.isArray(a.video_urls)) {
            a.video_urls.forEach((url: string) => {
              const path = url.split('/storage/v1/object/public/legalcheck/')[1];
              if (path) filesToDelete.push(path);
            });
          }
          if (a.pdf_urls && Array.isArray(a.pdf_urls)) {
            a.pdf_urls.forEach((url: string) => {
              const path = url.split('/storage/v1/object/public/legalcheck/')[1];
              if (path) filesToDelete.push(path);
            });
          }
        });

        if (filesToDelete.length > 0) {
          await supabase.storage.from('legalcheck').remove(filesToDelete);
        }
        await supabase.from('analises').delete().eq('processo_id', processoId);
      }

      const mediaUrls: string[] = [];
      const pdfUrls: string[] = [];

      // 1. Process and Upload Videos/Audios
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        setProgress(`Processando mídia ${i + 1}/${videoFiles.length}...`);
        const mediaToUpload = await extractAudioFromVideo(file);

        const mediaExt = mediaToUpload.name.split('.').pop();
        const mediaPath = `${user.id}/${Date.now()}_audio_${i}.${mediaExt}`;
        const { error: mError } = await supabase.storage.from('legalcheck').upload(mediaPath, mediaToUpload);
        if (mError) throw mError;

        const { data: { publicUrl } } = supabase.storage.from('legalcheck').getPublicUrl(mediaPath);
        mediaUrls.push(publicUrl);
      }

      // 2. Upload PDFs
      for (let i = 0; i < pdfFiles.length; i++) {
        const file = pdfFiles[i];
        setProgress(`Subindo PDF ${i + 1}/${pdfFiles.length}...`);
        const pdfPath = `${user.id}/${Date.now()}_processo_${i}.pdf`;
        const { error: pError } = await supabase.storage.from('legalcheck').upload(pdfPath, file);
        if (pError) throw pError;

        const { data: { publicUrl } } = supabase.storage.from('legalcheck').getPublicUrl(pdfPath);
        pdfUrls.push(publicUrl);
      }

      // 3. Save to DB
      const { error: dbError } = await supabase.from('analises').insert({
        processo_id: processoId,
        user_id: user.id,
        status: 'processando',
        resultado_json: null,
        video_url: mediaUrls[0], // backward compatibility
        pdf_url: pdfUrls[0], // backward compatibility
        video_urls: mediaUrls,
        pdf_urls: pdfUrls
      });

      if (dbError) throw dbError;

      supabase.functions.invoke('analisar-audiencia', {
        body: { processoId: processoId }
      }).catch(console.error);

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
        <div className="space-y-4">
          <div
            className={`group relative border-2 border-dashed rounded-[32px] p-8 transition-all duration-300 flex flex-col items-center justify-center gap-4 cursor-pointer overflow-hidden
              ${videoFiles.length > 0 ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-300/80 hover:border-[#5A5A40]/50 hover:bg-white/50'}`}
          >
            <input
              type="file"
              multiple
              accept="video/*,audio/*"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setVideoFiles(prev => [...prev, ...files]);
              }}
            />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${videoFiles.length > 0 ? 'bg-[#5A5A40] text-white' : 'bg-white text-gray-400 group-hover:text-[#5A5A40]'}`}>
              <Upload size={28} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-[#1a1a1a]">Mídias da Audiência</p>
              <p className="text-xs text-gray-500">Vídeos ou Áudios (Vários permitidos)</p>
            </div>
          </div>

          <div className="space-y-2">
            {videoFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-white/60 p-3 rounded-xl border border-black/5 text-sm">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileVideo size={16} className="text-[#5A5A40] shrink-0" />
                  <span className="truncate">{f.name}</span>
                </div>
                <button
                  onClick={() => setVideoFiles(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <AlertCircle size={14} className="rotate-45" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* PDF Upload */}
        <div className="space-y-4">
          <div
            className={`group relative border-2 border-dashed rounded-[32px] p-8 transition-all duration-300 flex flex-col items-center justify-center gap-4 cursor-pointer overflow-hidden
              ${pdfFiles.length > 0 ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-300/80 hover:border-[#5A5A40]/50 hover:bg-white/50'}`}
          >
            <input
              type="file"
              multiple
              accept="application/pdf"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setPdfFiles(prev => [...prev, ...files]);
              }}
            />
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${pdfFiles.length > 0 ? 'bg-[#5A5A40] text-white' : 'bg-white text-gray-400 group-hover:text-[#5A5A40]'}`}>
              <Upload size={28} />
            </div>
            <div className="text-center">
              <p className="font-semibold text-[#1a1a1a]">PDFs do Processo</p>
              <p className="text-xs text-gray-500">Documentos e Petições</p>
            </div>
          </div>

          <div className="space-y-2">
            {pdfFiles.map((f, i) => (
              <div key={i} className="flex items-center justify-between bg-white/60 p-3 rounded-xl border border-black/5 text-sm">
                <div className="flex items-center gap-2 overflow-hidden">
                  <FileText size={16} className="text-[#5A5A40] shrink-0" />
                  <span className="truncate">{f.name}</span>
                </div>
                <button
                  onClick={() => setPdfFiles(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <AlertCircle size={14} className="rotate-45" />
                </button>
              </div>
            ))}
          </div>
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
        disabled={videoFiles.length === 0 || pdfFiles.length === 0 || isAnalyzing}
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
