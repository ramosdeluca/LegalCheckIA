import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';
import { Plus, Briefcase, FileText, Clock, ChevronRight, LogOut, User as UserIcon, Loader2, Search, Trash2, AlertTriangle as AlertIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UploadAnalysis } from './UploadAnalysis';
import { AnalysisReport } from './AnalysisReport';

export const Dashboard: React.FC = () => {
  const { user, signOut } = useAuth();
  const [processos, setProcessos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProcesso, setActiveProcesso] = useState<any | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any | null>(null);
  const [analysisUrls, setAnalysisUrls] = useState<{ video?: string, pdf?: string }>({});
  const [showNewProcessoModal, setShowNewProcessoModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [processToDelete, setProcessToDelete] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // New Processo Form
  const [numero, setNumero] = useState('');
  const [cliente, setCliente] = useState('');

  const formatProcessNumber = (value: string) => {
    const digits = value.replace(/\D/g, '');
    let formatted = digits;
    if (digits.length > 7) formatted = digits.replace(/^(\d{7})(\d)/, '$1-$2');
    if (digits.length > 9) formatted = formatted.replace(/^(\d{7})-(\d{2})(\d)/, '$1-$2.$3');
    if (digits.length > 13) formatted = formatted.replace(/^(\d{7})-(\d{2})\.(\d{4})(\d)/, '$1-$2.$3.$4');
    if (digits.length > 14) formatted = formatted.replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d{1})(\d)/, '$1-$2.$3.$4.$5');
    if (digits.length > 16) formatted = formatted.replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d{1})\.(\d{2})(\d)/, '$1-$2.$3.$4.$5.$6');
    return formatted.substring(0, 25);
  };

  const fetchProcessos = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('processos')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error) setProcessos(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchProcessos();
  }, [user]);

  const fetchAnalysis = async (processoId: string) => {
    const { data, error } = await supabase
      .from('analises')
      .select('*')
      .eq('processo_id', processoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setAnalysisResult(data.resultado_json);
      setAnalysisUrls({ video: data.video_url, pdf: data.pdf_url });
    } else {
      setAnalysisResult(null);
      setAnalysisUrls({});
    }
  };

  useEffect(() => {
    if (activeProcesso) {
      fetchAnalysis(activeProcesso.id);
    }
  }, [activeProcesso]);

  const handleCreateProcesso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const { data, error } = await supabase
      .from('processos')
      .insert({
        user_id: user.id,
        numero_processo: numero,
        cliente: cliente,
      })
      .select()
      .single();

    if (!error) {
      setProcessos([data, ...processos]);
      setShowNewProcessoModal(false);
      setNumero('');
      setCliente('');
      setActiveProcesso(data);
    }
  };

  const handleDeleteProcesso = async () => {
    if (!processToDelete || !user) return;
    setIsDeleting(true);

    try {
      // 1. Get all analyses for this process to find file paths
      const { data: analises } = await supabase
        .from('analises')
        .select('video_url, pdf_url')
        .eq('processo_id', processToDelete.id);

      if (analises && analises.length > 0) {
        const filesToDelete: string[] = [];

        analises.forEach(a => {
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
      }

      // 2. Delete from database (analises will be deleted by cascade if configured, but let's be explicit or rely on it)
      // Assuming cascade delete is set up in Supabase, otherwise we'd delete analises first.
      const { error } = await supabase
        .from('processos')
        .delete()
        .eq('id', processToDelete.id);

      if (error) throw error;

      // 3. Update UI
      setProcessos(processos.filter(p => p.id !== processToDelete.id));
      if (activeProcesso?.id === processToDelete.id) {
        setActiveProcesso(null);
        setAnalysisResult(null);
      }
      setProcessToDelete(null);
    } catch (err) {
      console.error('Error deleting process:', err);
      alert('Erro ao excluir o processo. Tente novamente.');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredProcessos = processos.filter(p =>
    p.numero_processo.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.cliente.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f2ed]">
        <Loader2 className="animate-spin text-[#5A5A40]" size={40} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f2ed] font-sans">
      {/* Sidebar / Header */}
      <nav className="bg-white border-b border-black/5 px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white">
            <Briefcase size={20} />
          </div>
          <h1 className="text-xl font-serif text-[#1a1a1a]">LegalCheck IA</h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <UserIcon size={16} />
            <span>{user?.email}</span>
          </div>
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-red-500 transition-colors"
          >
            <LogOut size={20} />
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Processos List */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">Meus Processos</h2>
            <button
              onClick={() => setShowNewProcessoModal(true)}
              className="p-2 bg-[#5A5A40] text-white rounded-full hover:bg-[#4a4a35] transition-all shadow-lg shadow-[#5A5A40]/20"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar processo ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white border border-black/5 rounded-2xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/10 focus:border-[#5A5A40] transition-all shadow-sm"
            />
          </div>

          <div className="space-y-3">
            {filteredProcessos.map((p) => (
              <motion.button
                key={p.id}
                whileHover={{ x: 4 }}
                onClick={() => {
                  setActiveProcesso(p);
                }}
                className={`w-full text-left p-5 rounded-3xl border transition-all flex items-center justify-between
                  ${activeProcesso?.id === p.id
                    ? 'bg-white border-[#5A5A40] shadow-md'
                    : 'bg-white/50 border-transparent hover:bg-white hover:border-gray-200'}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center
                    ${activeProcesso?.id === p.id ? 'bg-[#5A5A40] text-white' : 'bg-gray-100 text-gray-400'}`}>
                    <FileText size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[#1a1a1a] truncate">{formatProcessNumber(p.numero_processo || '')}</p>
                    <p className="text-xs text-gray-500 truncate">{p.cliente}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setProcessToDelete(p);
                    }}
                    className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                  <ChevronRight size={18} className={activeProcesso?.id === p.id ? 'text-[#5A5A40]' : 'text-gray-300'} />
                </div>
              </motion.button>
            ))}

            {processos.length === 0 && (
              <div className="text-center py-12 bg-white/30 rounded-3xl border border-dashed border-gray-300">
                <p className="text-sm text-gray-500">Nenhum processo cadastrado.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Active Content */}
        <div className="lg:col-span-8">
          {activeProcesso ? (
            <div className="space-y-8">
              <div className="bg-white rounded-3xl p-8 shadow-sm border border-black/5">
                <div className="flex items-center gap-2 text-xs text-[#5A5A40] font-semibold uppercase tracking-widest mb-2">
                  <Clock size={14} />
                  <span>Processo em Aberto</span>
                </div>
                <h1 className="text-xl md:text-3xl font-sans font-semibold text-[#1a1a1a] mb-1 break-all md:break-normal">{formatProcessNumber(activeProcesso.numero_processo || '')}</h1>
                <p className="text-gray-500 break-words">Cliente: {activeProcesso.cliente}</p>
              </div>

              {analysisResult ? (
                <AnalysisReport
                  result={analysisResult}
                  onReset={() => {
                    setAnalysisResult(null);
                    setAnalysisUrls({});
                  }}
                  videoUrl={analysisUrls.video}
                  pdfUrl={analysisUrls.pdf}
                  processNumber={formatProcessNumber(activeProcesso.numero_processo || '')}
                  clientName={activeProcesso.cliente}
                />
              ) : (
                <UploadAnalysis
                  processoId={activeProcesso.id}
                  onAnalysisComplete={(result, video, pdf) => {
                    setAnalysisResult(result);
                    setAnalysisUrls({ video, pdf });
                  }}
                />
              )}
            </div>
          ) : (
            <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center bg-white/30 rounded-[40px] border border-dashed border-gray-300 p-12">
              <div className="w-20 h-20 bg-gray-100 text-gray-300 rounded-full flex items-center justify-center mb-6">
                <Briefcase size={40} />
              </div>
              <h2 className="text-xl font-serif text-gray-400 mb-2">Selecione um processo</h2>
              <p className="text-sm text-gray-400 max-w-xs">Escolha um processo na lista ao lado ou crie um novo para iniciar a análise de contradições.</p>
            </div>
          )}
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {processToDelete && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-[32px] shadow-2xl p-8 max-w-md w-full"
            >
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
                <AlertIcon size={32} />
              </div>
              <h2 className="text-2xl font-serif text-[#1a1a1a] mb-2">Excluir Processo?</h2>
              <p className="text-gray-500 mb-8">
                Esta ação é permanente. Todos os dados, análises, vídeos e PDFs associados ao processo <span className="font-bold text-[#1a1a1a]">{processToDelete.numero_processo}</span> serão removidos definitivamente do servidor.
              </p>

              <div className="flex gap-3">
                <button
                  disabled={isDeleting}
                  onClick={() => setProcessToDelete(null)}
                  className="flex-1 py-4 rounded-2xl font-medium text-gray-500 hover:bg-gray-50 transition-all disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  disabled={isDeleting}
                  onClick={handleDeleteProcesso}
                  className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-medium hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      <span>Excluindo...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={20} />
                      <span>Excluir</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Processo Modal */}
      {showNewProcessoModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-[32px] shadow-2xl p-8 max-w-md w-full"
          >
            <h2 className="text-2xl font-serif text-[#1a1a1a] mb-6">Novo Processo</h2>
            <form onSubmit={handleCreateProcesso} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Número do Processo</label>
                <input
                  type="text"
                  value={numero}
                  onChange={(e) => setNumero(formatProcessNumber(e.target.value))}
                  className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all"
                  placeholder="0000000-00.2024.8.26.0000"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Nome do Cliente</label>
                <input
                  type="text"
                  value={cliente}
                  onChange={(e) => setCliente(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 focus:border-[#5A5A40] transition-all"
                  placeholder="Nome Completo"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowNewProcessoModal(false)}
                  className="flex-1 py-4 rounded-2xl font-medium text-gray-500 hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-4 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4a4a35] transition-all shadow-lg shadow-[#5A5A40]/20"
                >
                  Criar
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
