import React, { useRef, useState } from 'react';
import { AlertTriangle, Clock, FileText, ArrowLeft, ShieldAlert, ShieldCheck, Info, Volume2, Download, Share2, Scale, Sparkles, X, MessageSquare, ChevronLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import jsPDF from 'jspdf';
import { domToPng } from 'modern-screenshot';
import { AnalysisChat } from './AnalysisChat';

interface Contradicao {
  timestamp: string;
  o_que_foi_dito: string;
  o_que_diz_o_processo: string;
  tipo_contradicao: string;
  gravidade: 'Baixa' | 'Média' | 'Alta';
  explicacao: string;
}

interface AnalysisReportProps {
  result: any;
  onReset: () => void;
  videoUrl?: string;
  pdfUrl?: string;
  videoUrls?: string[];
  pdfUrls?: string[];
  processNumber?: string;
  clientName?: string;
  analiseId: string;
  processoId: string;
  cacheExpiry?: string;
  createdAt?: string;
}

export const AnalysisReport: React.FC<AnalysisReportProps> = ({
  result,
  onReset,
  videoUrl,
  pdfUrl,
  videoUrls,
  pdfUrls,
  processNumber,
  clientName,
  analiseId,
  processoId,
  cacheExpiry,
  createdAt
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [activeView, setActiveView] = useState<'report' | 'chat'>('report');

  // Resetar visualização ao mudar de análise
  React.useEffect(() => {
    setActiveView('report');
  }, [analiseId]);

  const isMediaExpired = React.useMemo(() => {
    if (!createdAt) return false;
    const createdDate = new Date(createdAt);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - createdDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 7;
  }, [createdAt]);

  const isNewFormat = !Array.isArray(result) && result?.contradicoes;
  const contradicoesLista: Contradicao[] = isNewFormat ? result.contradicoes : (Array.isArray(result) ? result : []);
  const hasInsights = isNewFormat && (result.resumo_executivo || result.analise_tendencia);

  const getGravidadeColor = (gravidade: string) => {
    switch (gravidade) {
      case 'Alta': return 'text-[#dc2626] bg-[#fef2f2] border-[#fee2e2]';
      case 'Média': return 'text-[#ea580c] bg-[#fff7ed] border-[#ffedd5]';
      case 'Baixa': return 'text-[#2563eb] bg-[#eff6ff] border-[#dbeafe]';
      default: return 'text-[#4b5563] bg-[#f9fafb] border-[#f3f4f6]';
    }
  };

  const getGravidadeIcon = (gravidade: string) => {
    switch (gravidade) {
      case 'Alta': return <ShieldAlert size={16} />;
      case 'Média': return <Info size={16} />;
      case 'Baixa': return <ShieldCheck size={16} />;
      default: return null;
    }
  };

  const generatePDFBlob = async (): Promise<Blob | null> => {
    if (!reportRef.current) return null;
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentWidth = pageWidth - (2 * margin);
      let currentY = margin;
      const elements = reportRef.current.querySelectorAll('.pdf-section');
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLElement;
        const canvas = await domToPng(el, { scale: 2, backgroundColor: '#f5f2ed', quality: 1 });
        const img = new Image();
        img.src = canvas;
        await new Promise((resolve) => (img.onload = resolve));
        const imgHeight = (img.height * contentWidth) / img.width;
        if (currentY + imgHeight > pageHeight - margin) {
          pdf.addPage();
          currentY = margin;
        }
        pdf.addImage(canvas, 'PNG', margin, currentY, contentWidth, imgHeight);
        currentY += imgHeight + 5;
      }
      return pdf.output('blob');
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      return null;
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    const blob = await generatePDFBlob();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Relatorio_Contradicoes_${processNumber || 'Analise'}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      alert('Erro ao gerar o PDF. Tente novamente.');
    }
    setIsExporting(false);
  };

  const handleShare = async () => {
    setIsSharing(true);
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const shareText = `Relatório de Contradições Jurídicas\nProcesso: ${processNumber}\nCliente: ${clientName}\n\nConfira os detalhes no LegalCheck.`;
    const blob = await generatePDFBlob();
    if (!blob) {
      alert('Erro ao gerar o PDF para compartilhamento.');
      setIsSharing(false);
      return;
    }
    if (isMobile && navigator.share) {
      try {
        const file = new File([blob], `Relatorio_Contradicoes_${processNumber || 'Analise'}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Relatório de Contradições', text: shareText, files: [file] });
          setIsSharing(false);
          return;
        }
        await navigator.share({ title: 'Relatório de Contradições', text: shareText });
        setIsSharing(false);
        return;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') console.error('Erro no compartilhamento nativo:', error);
        setIsSharing(false);
        return;
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_Contradicoes_${processNumber || 'Analise'}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
    handleWhatsAppShare();
    alert('O PDF foi baixado automaticamente. Agora, basta anexá-lo na conversa do WhatsApp que abriu!');
    setIsSharing(false);
  };

  const handleWhatsAppShare = () => {
    const text = `Relatório de Contradições Jurídicas\nProcesso: ${processNumber}\nCliente: ${clientName}\n\nConfira os detalhes no LegalCheck.`;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const whatsappUrl = isMobile
      ? `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`
      : `https://web.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    const newWindow = window.open(whatsappUrl, '_blank');
    if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
      alert('O compartilhamento foi bloqueado pelo navegador. Por favor, permita pop-ups para este site.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 bg-white/60 backdrop-blur-md p-3 md:p-4 rounded-[28px] md:rounded-[40px] border border-white shadow-sm overflow-visible">
        {((videoUrls && videoUrls.length > 0) || (pdfUrls && pdfUrls.length > 0) || videoUrl || pdfUrl) && (
          <div className="w-full">
            {isMediaExpired ? (
              <div className="flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 rounded-[18px] border border-red-100 shadow-sm text-[11px] font-medium text-center">
                <ShieldAlert size={16} className="shrink-0" />
                As mídias já foram removidas dessa análise (prazo de 7 dias).
              </div>
            ) : (
              <div className="flex flex-col bg-white/80 rounded-[18px] border border-black/5 shadow-sm overflow-hidden">
                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border-b border-amber-100/50 text-[10px] font-bold uppercase tracking-widest text-center">
                  <Clock size={14} className="shrink-0" />
                  As mídias ficam disponíveis por 7 dias neste aplicativo.
                </div>
                <div className="flex items-center justify-center gap-4 px-4 py-3 overflow-x-auto no-scrollbar whitespace-nowrap w-full">
                  {videoUrls && videoUrls.length > 0 ? (
                    videoUrls.map((url, i) => (
                      <a key={`v-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-blue-600 flex items-center gap-2 transition-all hover:scale-105">
                        <Volume2 size={16} className="text-blue-500" /> Áudio {videoUrls.length > 1 ? i + 1 : ''}
                      </a>
                    ))
                  ) : videoUrl && (
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-blue-600 flex items-center gap-2 transition-all hover:scale-105">
                      <Volume2 size={16} className="text-blue-500" /> Áudio Original
                    </a>
                  )}
                  {((videoUrls?.length || videoUrl) && (pdfUrls?.length || pdfUrl)) && <div className="w-px h-5 bg-gray-200" />}
                  {pdfUrls && pdfUrls.length > 0 ? (
                    pdfUrls.map((url, i) => (
                      <a key={`p-${i}`} href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-red-600 flex items-center gap-2 transition-all hover:scale-105 shrink-0">
                        <FileText size={16} className="text-red-500" /> PDF {pdfUrls.length > 1 ? i + 1 : ''}
                      </a>
                    ))
                  ) : pdfUrl && (
                    <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-red-600 flex items-center gap-2 transition-all hover:scale-105 shrink-0">
                      <FileText size={16} className="text-red-500" /> PDF Original
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {hasInsights && (
            <button
              onClick={() => setShowInsightsModal(true)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:shadow-lg hover:shadow-blue-500/30 transition-all transform active:scale-95 shrink-0"
            >
              <Sparkles size={14} className="text-blue-200" />
              Insights IA
            </button>
          )}

          <button
            onClick={() => setActiveView(activeView === 'report' ? 'chat' : 'report')}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all transform active:scale-95 shrink-0
              ${activeView === 'chat' 
                ? 'bg-blue-50 text-blue-600 border border-blue-200' 
                : 'bg-gradient-to-r from-[#5A5A40] to-[#4a4a35] text-white shadow-md hover:shadow-lg'}`}
          >
            {activeView === 'report' ? (
              <>
                <MessageSquare size={14} />
                Chat Jurídico IA
              </>
            ) : (
              <>
                <FileText size={14} />
                Ver Relatório
              </>
            )}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExporting || isSharing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#5A5A40] to-[#4a4a35] text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:shadow-lg hover:shadow-[#5A5A40]/30 transition-all disabled:opacity-50 transform active:scale-95 shrink-0"
          >
            <Download size={14} />
            {isExporting ? 'Exportando' : 'Exportar PDF'}
          </button>
          <button
            onClick={handleShare}
            disabled={isExporting || isSharing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 text-[#5A5A40] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 hover:border-gray-300 transition-all disabled:opacity-50 shadow-sm transform active:scale-95 shrink-0"
          >
            <Share2 size={14} />
            {isSharing ? 'Preparando' : 'Compartilhar'}
          </button>
          <div className="w-px h-5 bg-gray-200 hidden sm:block" />
          <button
            onClick={onReset}
            className="flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#5A5A40] transition-all hover:bg-white/80 rounded-full transform active:scale-95 shrink-0"
          >
            <ArrowLeft size={16} />
            Nova Análise
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeView === 'report' ? (
          <motion.div 
            key="report-view"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            ref={reportRef} 
            className="space-y-6 p-1"
          >
            <div className="pdf-section relative bg-white/80 backdrop-blur-sm rounded-[32px] p-8 md:p-10 border border-white shadow-sm mb-6 overflow-hidden">
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#5A5A40]/[0.02] rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6 md:mb-8">
                  <div className="w-10 h-10 md:w-14 md:h-14 bg-gradient-to-br from-[#5A5A40] to-[#3A3A20] rounded-xl md:rounded-[20px] flex items-center justify-center text-white shadow-lg shadow-[#5A5A40]/20 shrink-0">
                    <Scale size={22} className="md:w-7 md:h-7" />
                  </div>
                  <div>
                    <h1 className="text-lg md:text-3xl font-serif text-[#1a1a1a] leading-tight tracking-tight mb-0.5">Relatório Oficial de Contradições</h1>
                    <p className="text-[9px] md:text-xs text-[#5A5A40] uppercase tracking-[0.2em] font-bold">LegalCheck IA • Análise Jurídica</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 pt-6 border-t border-gray-100">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Número do Processo</p>
                    <p className="text-base md:text-lg font-medium text-[#1a1a1a] break-all">{processNumber || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Cliente</p>
                    <p className="text-base md:text-lg font-medium text-[#1a1a1a] break-words">{clientName || 'Não informado'}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Data da Análise</p>
                    <p className="text-sm text-gray-600">{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              </div>
            </div>
            {contradicoesLista.length === 0 ? (
              <div className="pdf-section bg-white rounded-3xl p-12 text-center border border-black/5 shadow-sm">
                <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck size={32} />
                </div>
                <h3 className="text-xl font-serif text-[#1a1a1a] mb-2">Nenhuma contradição encontrada</h3>
                <p className="text-gray-500">A IA não detectou divergências significativas entre o vídeo e o processo.</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {contradicoesLista.map((item, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="pdf-section bg-white/90 backdrop-blur-sm rounded-[32px] border border-white shadow-lg shadow-black/5 overflow-hidden hover:shadow-xl transition-shadow duration-300 group"
                  >
                    <div className="p-5 md:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-white rounded-full border border-gray-200 text-xs font-mono font-bold text-[#5A5A40] shadow-sm">
                          <Clock size={16} />
                          {item.timestamp}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-[0.15em] text-[#5A5A40]/70">
                          TIPO: {item.tipo_contradicao}
                        </span>
                      </div>
                      <div className={`flex items-center gap-2 px-4 py-1.5 rounded-full border text-xs font-extrabold uppercase tracking-wider self-start sm:self-auto shrink-0 shadow-sm ${getGravidadeColor(item.gravidade)}`}>
                        {getGravidadeIcon(item.gravidade)}
                        Gravidade {item.gravidade}
                      </div>
                    </div>
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest">
                          <AlertTriangle size={14} className="text-orange-400" />
                          Dito na Audiência
                        </div>
                        <p className="text-[#1a1a1a] leading-relaxed italic">"{item.o_que_foi_dito}"</p>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest">
                          <FileText size={14} className="text-blue-400" />
                          Consta no Processo
                        </div>
                        <p className="text-[#1a1a1a] leading-relaxed italic">"{item.o_que_diz_o_processo}"</p>
                      </div>
                      <div className="md:col-span-2 pt-4 border-t border-gray-50">
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Análise Jurídica</div>
                        <p className="text-gray-600 leading-relaxed text-sm">{item.explicacao}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="chat-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            {/* Header simplificado para o Chat com dados do processo */}
            <div className="bg-white/80 backdrop-blur-sm rounded-[24px] p-4 border border-white shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setActiveView('report')}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors text-[#5A5A40] text-[10px] font-bold uppercase tracking-widest"
                >
                  <ChevronLeft size={16} />
                  Voltar ao Relatório
                </button>
                <div className="w-px h-8 bg-gray-200 mx-2 hidden sm:block" />
                <div>
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Processo em Análise</h4>
                  <p className="text-sm font-medium text-[#1a1a1a]">{processNumber}</p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-gray-100 mx-2" />
                <div className="hidden sm:block">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cliente</h4>
                  <p className="text-sm font-medium text-[#1a1a1a]">{clientName}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-wider border border-green-100 whitespace-nowrap hidden md:flex">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                Chat Ativo
              </div>
            </div>

            <AnalysisChat 
              analiseId={analiseId} 
              processoId={processoId} 
              cacheExpiry={cacheExpiry} 
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showInsightsModal && hasInsights && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pb-20 sm:pb-6">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowInsightsModal(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="relative w-full max-w-2xl bg-[#f8f9fa] rounded-[32px] sm:rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="relative bg-gradient-to-r from-blue-600 to-indigo-700 p-8 sm:p-10 shrink-0">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/3 blur-2xl pointer-events-none" />
                <button onClick={() => setShowInsightsModal(false)} className="absolute top-6 right-6 p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                <div className="flex items-center gap-4 mb-4 relative z-10">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-[16px] flex items-center justify-center text-white shrink-0 shadow-inner"><Sparkles size={24} /></div>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-serif text-white leading-tight tracking-tight">Insights da IA</h2>
                    <p className="text-xs text-blue-200 uppercase tracking-[0.1em] font-medium mt-1">Análise Panorâmica do Processo</p>
                  </div>
                </div>
              </div>
              <div className="p-8 sm:p-10 overflow-y-auto custom-scrollbar flex-1 bg-white relative">
                <div className="space-y-8">
                  <div className="flex flex-col sm:flex-row gap-6 p-5 bg-blue-50/50 rounded-[24px] border border-blue-100/50">
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Processo</p>
                      <p className="text-sm font-semibold text-[#1a1a1a] break-all">{processNumber || 'Não informado'}</p>
                    </div>
                    <div className="hidden sm:block w-px bg-blue-100" />
                    <div className="flex-1">
                      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Cliente</p>
                      <p className="text-sm font-semibold text-[#1a1a1a] break-words">{clientName || 'Não informado'}</p>
                    </div>
                  </div>
                  {result.resumo_executivo && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-extrabold text-[#1a1a1a] uppercase tracking-widest flex items-center gap-2"><FileText size={16} className="text-blue-500" />Resumo Executivo</h3>
                      <div className="p-6 bg-white rounded-[24px] border border-gray-100 shadow-sm leading-relaxed text-gray-700 text-sm sm:text-base">{result.resumo_executivo}</div>
                    </div>
                  )}
                  {result.analise_tendencia && (
                    <div className="space-y-3">
                      <h3 className="text-xs font-extrabold text-[#1a1a1a] uppercase tracking-widest flex items-center gap-2"><AlertTriangle size={16} className="text-indigo-500" />Análise de Tendência</h3>
                      <div className="p-6 bg-indigo-50/30 rounded-[24px] border border-indigo-100 leading-relaxed text-indigo-950 font-medium text-sm sm:text-base shadow-sm">{result.analise_tendencia}</div>
                    </div>
                  )}
                </div>
              </div>
              <div className="p-6 bg-gray-50 border-t border-gray-100 shrink-0 flex justify-end">
                <button onClick={() => setShowInsightsModal(false)} className="px-8 py-3 bg-gray-200 text-gray-700 font-semibold rounded-full hover:bg-gray-300 transition-colors">Fechar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
