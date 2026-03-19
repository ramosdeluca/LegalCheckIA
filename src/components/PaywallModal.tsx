import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../AuthContext';

interface PaywallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PaywallModal: React.FC<PaywallModalProps> = ({ isOpen, onClose }) => {
  const { user, profile } = useAuth();
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'basico' | 'profissional' | null>(null);
  const [checkoutCpf, setCheckoutCpf] = useState(profile?.document || '');
  const [checkoutPhone, setCheckoutPhone] = useState(profile?.phone || '');

  useEffect(() => {
    if (isOpen && profile) {
      if (!checkoutCpf && profile.document) setCheckoutCpf(profile.document);
      if (!checkoutPhone && profile.phone) setCheckoutPhone(profile.phone);
    }
  }, [isOpen, profile]);

  const handleSubscribe = async () => {
    if (!selectedPlan) {
      alert("Selecione um plano primeiro.");
      return;
    }
    if (!checkoutCpf || !checkoutPhone) {
      alert("Preencha seu CPF e Telefone para concluir a assinatura.");
      return;
    }
    
    setIsSubscribing(true);
    try {
      const res = await fetch('/api/pagamentos/assinar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          plano: selectedPlan,
          name: profile?.full_name || user?.email?.split('@')[0] || 'Usuário',
          email: user?.email,
          cpfCnpj: checkoutCpf.replace(/\D/g, ''),
          mobilePhone: checkoutPhone.replace(/\D/g, '')
        })
      });
      const data = await res.json();
      if (data.invoiceUrl) {
        window.location.href = data.invoiceUrl;
      } else {
        alert("Erro ao gerar link de pagamento: " + (data.error || "Desconhecido"));
      }
    } catch(e) {
      alert("Erro na conexão com o servidor de pagamentos.");
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-[32px] shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-[#5A5A40]/10 text-[#5A5A40] rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Play size={32} />
              </div>
              <h2 className="text-3xl font-serif text-[#1a1a1a] mb-2 tracking-tight">Faça o Upgrade do seu Plano</h2>
              <p className="text-gray-500 font-medium">Seus créditos acabaram. Escolha um plano para continuar analisando processos com o poder da Inteligência Artificial.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4 mb-8">
              {/* Plano Básico */}
              <div 
                onClick={() => setSelectedPlan('basico')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all ${selectedPlan === 'basico' ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-200 hover:border-[#5A5A40]/30 hover:bg-gray-50'}`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-[#1a1a1a]">Básico</h3>
                    <p className="text-sm text-gray-500">Ideal para casos esporádicos</p>
                  </div>
                </div>
                <div className="mb-4">
                  <span className="text-2xl font-bold text-[#1a1a1a]">R$ 297</span>
                  <span className="text-gray-500 text-sm">/mês</span>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> 5 Análises Mensais</li>
                  <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Chat com a IA por 4 Horas</li>
                </ul>
              </div>

              {/* Plano Profissional */}
              <div 
                onClick={() => setSelectedPlan('profissional')}
                className={`relative p-6 rounded-2xl border-2 cursor-pointer transition-all ${selectedPlan === 'profissional' ? 'border-[#5A5A40] bg-[#5A5A40]/5' : 'border-gray-200 hover:border-[#5A5A40]/30 hover:bg-gray-50'}`}
              >
                <div className="absolute -top-3 right-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-sm">
                  Recomendado
                </div>
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-lg text-[#1a1a1a]">Profissional</h3>
                    <p className="text-sm text-gray-500">Para alta demanda</p>
                  </div>
                </div>
                <div className="mb-4">
                  <span className="text-2xl font-bold text-[#1a1a1a]">R$ 597</span>
                  <span className="text-gray-500 text-sm">/mês</span>
                </div>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> 20 Análises Mensais</li>
                  <li className="flex items-center gap-2"><CheckCircle2 size={16} className="text-green-500" /> Chat com a IA por 4 Horas</li>
                </ul>
              </div>
            </div>

            {selectedPlan && (
              <div className="mb-8 space-y-4 animate-in fade-in slide-in-from-bottom-2">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">CPF / CNPJ</label>
                    <input 
                      type="text" 
                      placeholder="Somente números"
                      value={checkoutCpf}
                      onChange={(e) => setCheckoutCpf(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-[16px] focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Telefone</label>
                    <input 
                      type="text" 
                      placeholder="(DDD) 90000-0000"
                      value={checkoutPhone}
                      onChange={(e) => setCheckoutPhone(e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-[16px] focus:ring-2 focus:ring-[#5A5A40] focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={onClose}
                disabled={isSubscribing}
                className="flex-1 py-4 text-gray-500 hover:bg-gray-100 rounded-[20px] font-semibold transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubscribe}
                disabled={!selectedPlan || isSubscribing}
                className="flex-2 min-w-[60%] py-4 bg-[#5A5A40] text-white rounded-[20px] font-semibold hover:bg-[#4a4a35] transition-colors shadow-lg shadow-[#5A5A40]/20 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubscribing ? <Loader2 size={20} className="animate-spin" /> : <span>Ir para Pagamento Seguro</span>}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
