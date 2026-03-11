import React, { useRef, useState } from 'react';
import { AlertTriangle, Clock, FileText, ArrowLeft, ShieldAlert, ShieldCheck, Info, Volume2, Download, Share2, Briefcase } from 'lucide-react';
import { motion } from 'motion/react';
import jsPDF from 'jspdf';
import { domToPng } from 'modern-screenshot';

interface Contradicao {
  timestamp: string;
  o_que_foi_dito: string;
  o_que_diz_o_processo: string;
  tipo_contradicao: string;
  gravidade: 'Baixa' | 'Média' | 'Alta';
  explicacao: string;
}

interface AnalysisReportProps {
  result: Contradicao[];
  onReset: () => void;
  videoUrl?: string;
  pdfUrl?: string;
  processNumber?: string;
  clientName?: string;
}

export const AnalysisReport: React.FC<AnalysisReportProps> = ({
  result,
  onReset,
  videoUrl,
  pdfUrl,
  processNumber,
  clientName
}) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // Use hex colors to avoid oklab/oklch issues in some PDF generators
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
      // modern-screenshot is much better at handling modern CSS like oklch/oklab
      const dataUrl = await domToPng(reportRef.current, {
        scale: 2,
        backgroundColor: '#f5f2ed',
        quality: 1,
      });

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();

      // Create an image to get dimensions
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve) => (img.onload = resolve));

      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgHeight = (img.height * pdfWidth) / img.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pageHeight;
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

    // Generate the PDF first so it's ready for either flow
    const blob = await generatePDFBlob();
    if (!blob) {
      alert('Erro ao gerar o PDF para compartilhamento.');
      setIsSharing(false);
      return;
    }

    // On Mobile, we prefer native sharing because it allows sending the actual PDF file directly
    if (isMobile && navigator.share) {
      try {
        const file = new File([blob], `Relatorio_Contradicoes_${processNumber || 'Analise'}.pdf`, { type: 'application/pdf' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Relatório de Contradições',
            text: shareText,
            files: [file],
          });
          setIsSharing(false);
          return;
        }

        // Fallback to text-only native share on mobile
        await navigator.share({
          title: 'Relatório de Contradições',
          text: shareText,
        });
        setIsSharing(false);
        return;
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Erro no compartilhamento nativo:', error);
        } else {
          setIsSharing(false);
          return;
        }
      }
    }

    // On Desktop:
    // 1. Automatically download the PDF so it's ready to be attached
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_Contradicoes_${processNumber || 'Analise'}.pdf`;
    link.click();
    URL.revokeObjectURL(url);

    // 2. Open WhatsApp Web
    handleWhatsAppShare();

    // 3. Inform the user
    alert('O PDF foi baixado automaticamente. Agora, basta anexá-lo na conversa do WhatsApp que abriu!');

    setIsSharing(false);
  };

  const handleWhatsAppShare = () => {
    const text = `Relatório de Contradições Jurídicas\nProcesso: ${processNumber}\nCliente: ${clientName}\n\nConfira os detalhes no LegalCheck.`;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Force web.whatsapp.com for desktop to avoid the "app picker" screen
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
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white/50 p-4 rounded-[24px] border border-black/5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {(videoUrl || pdfUrl) && (
            <div className="flex items-center gap-3 px-4 py-2 bg-white rounded-full border border-gray-100 shadow-sm">
              {videoUrl && (
                <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-[#4A4A30] flex items-center gap-1.5 transition-colors">
                  <Volume2 size={14} /> Áudio do Vídeo
                </a>
              )}
              {videoUrl && pdfUrl && <div className="w-px h-3 bg-gray-200" />}
              {pdfUrl && (
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-[#5A5A40] hover:text-[#4A4A30] flex items-center gap-1.5 transition-colors">
                  <FileText size={14} /> PDF Original
                </a>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportPDF}
              disabled={isExporting || isSharing}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#5A5A40] text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-[#4A4A30] transition-all disabled:opacity-50 shadow-md shadow-[#5A5A40]/10 active:scale-95"
            >
              <Download size={14} />
              {isExporting ? 'Gerando...' : 'Exportar PDF'}
            </button>

            <button
              onClick={handleShare}
              disabled={isExporting || isSharing}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-[#5A5A40] rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-gray-50 transition-all disabled:opacity-50 shadow-sm active:scale-95"
            >
              <Share2 size={14} />
              {isSharing ? 'Preparando...' : 'Compartilhar'}
            </button>
          </div>
        </div>

        <button
          onClick={onReset}
          className="flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-[#5A5A40] transition-all hover:bg-white rounded-full active:scale-95"
        >
          <ArrowLeft size={14} />
          Nova Análise
        </button>
      </div>

      <div ref={reportRef} className="space-y-6 p-1">
        {/* PDF Header - Only visible in export/report view */}
        <div className="bg-white rounded-[32px] p-8 border border-black/5 shadow-sm mb-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 md:w-12 md:h-12 bg-[#5A5A40] rounded-2xl flex items-center justify-center text-white shrink-0">
              <Briefcase size={20} className="md:w-6 md:h-6" />
            </div>
            <div>
              <h1 className="text-lg md:text-2xl font-serif text-[#1a1a1a] leading-tight">Relatório de Contradições e Análise Jurídica</h1>
              <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">LegalCheck IA • Documento Oficial</p>
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
        {result.length === 0 ? (
          <div className="bg-white rounded-3xl p-12 text-center border border-black/5 shadow-sm">
            <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={32} />
            </div>
            <h3 className="text-xl font-serif text-[#1a1a1a] mb-2">Nenhuma contradição encontrada</h3>
            <p className="text-gray-500">A IA não detectou divergências significativas entre o vídeo e o processo.</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {result.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden"
              >
                <div className="p-4 md:p-6 border-b border-gray-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-50/50">
                  <div className="flex flex-wrap items-center gap-3 md:gap-4">
                    <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-gray-200 text-[10px] md:text-xs font-mono font-bold text-[#5A5A40] shrink-0">
                      <Clock size={14} />
                      {item.timestamp}
                    </div>
                    <span className="text-[10px] md:text-xs font-semibold uppercase tracking-widest text-gray-400">
                      Tipo: {item.tipo_contradicao}
                    </span>
                  </div>
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full border text-[10px] md:text-xs font-bold uppercase tracking-wider self-start sm:self-auto shrink-0 ${getGravidadeColor(item.gravidade)}`}>
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
      </div>
    </div>
  );
};
