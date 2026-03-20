import React from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  Clock, 
  Search, 
  FileText, 
  ShieldCheck, 
  Users, 
  ArrowRight, 
  Scale, 
  Video, 
  MessageSquare,
  Zap
} from 'lucide-react';

interface LandingPageProps {
  onGetStarted: () => void;
  onLogin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGetStarted, onLogin }) => {
  const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true },
    transition: { duration: 0.6 }
  };

  return (
    <div className="min-h-screen bg-[#f8f5f0] text-[#1a1a1a] font-sans selection:bg-[#5A5A40]/20">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-[#f8f5f0]/80 backdrop-blur-md border-b border-black/5">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white shadow-lg shadow-[#5A5A40]/20">
              <Scale size={24} />
            </div>
            <span className="text-2xl font-serif font-bold tracking-tight text-[#5A5A40]">ExpertIA</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
            <a href="#problem" className="hover:text-[#5A5A40] transition-colors">O Problema</a>
            <a href="#solution" className="hover:text-[#5A5A40] transition-colors">Como Funciona</a>
            <a href="#pricing" className="hover:text-[#5A5A40] transition-colors">Planos</a>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={onLogin}
              className="px-6 py-2.5 text-sm font-semibold text-gray-600 hover:text-[#1a1a1a] transition-all"
            >
              Entrar
            </button>
            <button 
              onClick={onGetStarted}
              className="px-6 py-2.5 bg-[#5A5A40] text-white rounded-full text-sm font-bold shadow-lg shadow-[#5A5A40]/20 hover:bg-[#4a4a35] transition-all"
            >
              Testar Grátis
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-40 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <motion.div {...fadeInUp}>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5A5A40]/10 border border-[#5A5A40]/20 text-[#5A5A40] text-xs font-bold uppercase tracking-widest mb-6">
              <Zap size={14} /> Inteligência Artificial Jurídica
            </div>
            <h1 className="text-5xl lg:text-7xl font-serif leading-[1.1] text-[#1a1a1a] mb-6">
              Transforme horas de audiência em <span className="italic text-[#5A5A40]">evidência</span> jurídica em minutos.
            </h1>
            <p className="text-xl text-gray-500 mb-10 leading-relaxed max-w-xl">
              O ExpertIA analisa vídeos e documentos processuais automaticamente e identifica contradições entre depoimentos com precisão.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <button 
                onClick={onGetStarted}
                className="w-full sm:w-auto px-10 py-5 bg-[#5A5A40] text-white rounded-2xl text-lg font-bold shadow-2xl shadow-[#5A5A40]/30 hover:bg-[#4a4a35] transition-all flex items-center justify-center gap-3"
              >
                Analisar Minha Primeira Audiência
                <ArrowRight size={20} />
              </button>
              <p className="text-xs text-center text-gray-400 font-medium">
                Sem necessidade de instalação. <br/>Teste agora e sinta a diferença.
              </p>
            </div>
          </motion.div>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="absolute inset-0 bg-gradient-to-tr from-[#5A5A40]/20 to-transparent blur-3xl -z-10 rounded-full" />
            <img 
              src="/hero-legal.png" 
              alt="ExpertIA Dashboard Mockup" 
              className="w-full rounded-[40px] shadow-2xl border border-white/50"
            />
          </motion.div>
        </div>
      </section>

      {/* Problem Section */}
      <section id="problem" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <motion.div {...fadeInUp} className="max-w-3xl mx-auto">
            <span className="text-xs font-bold text-red-400 uppercase tracking-widest block mb-4">O Desafio do Advogado</span>
            <h2 className="text-4xl lg:text-5xl font-serif mb-8 text-[#1a1a1a]">"O problema não é falta de competência. É falta de tempo."</h2>
            <div className="grid md:grid-cols-4 gap-8 mt-16 text-left">
              {[
                { icon: <Clock className="text-red-400" />, title: "Horas perdidas", text: "Assistir vídeos extensos manualmente consome seu dia." },
                { icon: <Search className="text-red-400" />, title: "Risco de Falhas", text: "Contradições sutis passam despercebidas na pressa." },
                { icon: <FileText className="text-red-400" />, title: "Prazos Curtos", text: "Escrever petições em tempo recorde é exaustivo." },
                { icon: <Scale className="text-red-400" />, title: "Sobrecarga", text: "Analisar dezenas de depoimentos pesa na sua estratégia." }
              ].map((item, i) => (
                <div key={i} className="p-6 rounded-3xl bg-gray-50 border border-gray-100">
                  <div className="mb-4">{item.icon}</div>
                  <h3 className="font-bold mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-500">{item.text}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Solution Section */}
      <section id="solution" className="py-24 px-6 overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-20 items-center">
            <motion.div {...fadeInUp}>
              <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-widest block mb-4">A Solução Inteligente</span>
              <h2 className="text-4xl lg:text-5xl font-serif mb-12">Simples como deve ser.</h2>
              <div className="space-y-12">
                {[
                  { step: "01", title: "Envie vídeos e PDFs", text: "Arraste os arquivos da audiência e do processo direto para o sistema." },
                  { step: "02", title: "Processamento por IA", text: "Nossa IA processa cada depoimento, cruza falas e encontra inconsistências." },
                  { step: "03", title: "Relatório Jurídico", text: "Receba PDFs estruturados com pontos de contradição e timestamps do vídeo." }
                ].map((item, i) => (
                  <div key={i} className="flex gap-6 items-start">
                    <span className="text-4xl font-serif text-[#5A5A40]/20 font-bold">{item.step}</span>
                    <div>
                      <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                      <p className="text-gray-500 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
            <div className="relative">
              <img src="/hero-legal.png" className="rounded-3xl shadow-xl opacity-80" alt="Processo" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-2xl cursor-pointer hover:scale-110 transition-transform">
                <Video size={32} className="text-[#5A5A40]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Differentials Section */}
      <section className="py-24 bg-[#1a1a1a] text-white overflow-hidden relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#5A5A40]/10 blur-[100px] pointer-events-none" />
        <div className="max-w-7xl mx-auto px-6">
          <motion.div {...fadeInUp} className="text-center mb-20">
            <h2 className="text-4xl lg:text-5xl font-serif mb-6">Por que não é apenas IA comum?</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">Desenvolvemos um sistema pensado exclusivamente no fluxo de trabalho do advogado, não um chat genérico.</p>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { icon: ShieldCheck, title: "Memória Persistente", desc: "A cada nova análise, o ExpertIA 'lembra' de todo o contexto do processo." },
              { icon: Users, title: "Cruzamento Coletivo", desc: "Identifica se o que a Testemunha A disse conflita com a petição ou com o Réu B." },
              { icon: MessageSquare, title: "Chat Jurídico Contextual", desc: "Tire dúvidas específicas sobre os depoimentos direto em um chat focado no caso." },
              { icon: Zap, title: "Relatórios Estruturados", desc: "Documentos prontos para serem usados como base para suas razões finais." },
              { icon: Clock, title: "Histórico Permanente", desc: "Seus processos analisados ficam salvos e prontos para consulta eterna." },
              { icon: Scale, title: "Foco Jurídico Real", desc: "Diferente do ChatGPT, nossa IA foi instruída para encontrar PROVAS e CONTRADIÇÕES." }
            ].map((item, i) => (
              <div key={i} className="p-8 rounded-[32px] bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                <div className="w-12 h-12 bg-[#5A5A40] rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-[#5A5A40]/20">
                  <item.icon size={24} />
                </div>
                <h3 className="text-xl font-bold mb-4">{item.title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-serif mb-4">Escolha sua potência de análise</h2>
            <p className="text-gray-500">Planos escaláveis para advogados autônomos e grandes escritórios.</p>
          </div>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {/* Plano Básico */}
            <motion.div whileHover={{ y: -10 }} className="p-10 rounded-[40px] border border-gray-100 bg-[#f8f5f0] flex flex-col items-center text-center">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">Plano Básico</span>
              <div className="mb-8">
                <span className="text-gray-400 text-3xl">R$</span>
                <span className="text-6xl font-bold">297</span>
                <span className="text-gray-400">/mês</span>
              </div>
              <ul className="space-y-4 mb-10 text-left w-full">
                <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500" size={18} /> 5 Análises Mensais</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500" size={18} /> 48h de Chat (4 chats/análise)</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500" size={18} /> Relatórios em PDF</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-green-500" size={18} /> Armazenamento Seguro</li>
              </ul>
              <button 
                onClick={onGetStarted}
                className="w-full py-4 rounded-2xl border-2 border-[#5A5A40] text-[#5A5A40] font-bold hover:bg-[#5A5A40] hover:text-white transition-all"
              >
                Começar Agora
              </button>
            </motion.div>

            {/* Plano Profissional */}
            <motion.div whileHover={{ y: -10 }} className="p-10 rounded-[40px] bg-[#1a1a1a] text-white relative flex flex-col items-center text-center shadow-2xl shadow-[#5A5A40]/40">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-[#5A5A40] rounded-full text-[10px] font-bold uppercase tracking-widest">Recomendado</div>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-6">Plano Profissional</span>
              <div className="mb-8">
                <span className="text-gray-500 text-3xl">R$</span>
                <span className="text-6xl font-bold">597</span>
                <span className="text-gray-500">/mês</span>
              </div>
              <ul className="space-y-4 mb-10 text-left w-full">
                <li className="flex items-center gap-3"><CheckCircle2 className="text-[#5A5A40]" size={18} /> 20 Análises Mensais</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-[#5A5A40]" size={18} /> 48h de Chat (12 chats/análise)</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-[#5A5A40]" size={18} /> Relatórios em PDF</li>
                <li className="flex items-center gap-3"><CheckCircle2 className="text-[#5A5A40]" size={18} /> Armazenamento Seguro</li>
              </ul>
              <button 
                onClick={onGetStarted}
                className="w-full py-4 rounded-2xl bg-[#5A5A40] text-white font-bold hover:bg-[#4a4a35] transition-all shadow-lg shadow-[#5A5A40]/30"
              >
                Ativar Plano Profissional
              </button>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 px-6">
        <motion.div {...fadeInUp} className="max-w-5xl mx-auto p-12 lg:p-24 rounded-[64px] bg-[#5A5A40] text-white text-center relative overflow-hidden">
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-[80px] -mr-20 -mb-20" />
          <h2 className="text-4xl lg:text-7xl font-serif mb-8 leading-tight">Pare de assistir horas de audiência. <br className="hidden lg:block" /><span className="opacity-60 italic">Ganhe tempo para vencer.</span></h2>
          <p className="text-xl text-white/70 mb-12 max-w-2xl mx-auto">Deixe a inteligência artificial encontrar as provas e contradições que você precisa para suas petições estratégicas.</p>
          <button 
            onClick={onGetStarted}
            className="px-12 py-6 bg-white text-[#5A5A40] rounded-3xl text-xl font-bold shadow-2xl hover:bg-gray-50 hover:scale-105 transition-all"
          >
            Começar Gratuitamente
          </button>
          <p className="mt-8 text-white/40 text-sm">Sem necessidade de instalação. Resultados em minutos.</p>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-12 border-t border-black/5">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Scale size={20} className="text-[#5A5A40]" />
            <span className="text-xl font-serif font-bold text-[#5A5A40]">ExpertIA</span>
          </div>
          <p className="text-sm text-gray-400">© 2026 ExpertIA. Todos os direitos reservados. Inteligência Artificial para Direito.</p>
          <div className="flex gap-6 text-sm text-gray-500 font-medium">
            <a href="#" className="hover:text-[#5A5A40]">Termos</a>
            <a href="#" className="hover:text-[#5A5A40]">Privacidade</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
