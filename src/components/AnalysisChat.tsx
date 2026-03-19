import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Send, User, Bot, Loader2, Clock, AlertCircle, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface AnalysisChatProps {
  analiseId: string;
  processoId: string;
  cacheExpiry?: string;
}

export const AnalysisChat: React.FC<AnalysisChatProps> = ({ analiseId, processoId, cacheExpiry }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingHistory, setIsFetchingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isExpired = cacheExpiry ? new Date(cacheExpiry) < new Date() : true;

  const fetchHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('analise_chats')
        .select('*')
        .eq('analise_id', analiseId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);
    } catch (err: any) {
      console.error('Erro ao carregar histórico do chat:', err.message);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [analiseId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isLoading || isExpired) return;

    const userMsg = newMessage;
    setNewMessage('');
    setIsLoading(true);
    setError(null);

    // Otimismo: adicionar mensagem do usuário na tela
    const tempId = Date.now().toString();
    setMessages(prev => [...prev, { id: tempId, role: 'user', content: userMsg, created_at: new Date().toISOString() }]);

    try {
      const { data, error: funcError } = await supabase.functions.invoke('chat-audiencia', {
        body: {
          analiseId,
          processoId,
          message: userMsg
        }
      });

      if (funcError) throw funcError;
      const result = data;

      // Adicionar resposta da IA e ATUALIZAR ID da mensagem do usuário para o UUID real
      setMessages(prev => {
        const withoutTemp = prev.filter(m => m.id !== tempId);
        return [...withoutTemp, 
          { 
            id: result.userMessageId || tempId, 
            role: 'user', 
            content: userMsg, 
            created_at: new Date().toISOString() 
          },
          { 
            id: result.assistantMessageId || (Date.now() + 1).toString(), 
            role: 'assistant', 
            content: result.response, 
            created_at: new Date().toISOString() 
          }
        ];
      });

    } catch (err: any) {
      setError(err.message);
      // Remover a mensagem otimista em caso de erro grave (opcional)
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteMessage = async (msgId: string, role: 'user' | 'assistant') => {
    try {
      // Identificar o par para exclusão
      const index = messages.findIndex(m => m.id === msgId);
      if (index === -1) return;

      let pairIds: string[] = [msgId];
      
      // Se for usuário, deletar a próxima (resposta)
      if (role === 'user' && messages[index + 1]?.role === 'assistant') {
        pairIds.push(messages[index + 1].id);
      } 
      // Se for assistente, deletar a anterior (pergunta)
      else if (role === 'assistant' && messages[index - 1]?.role === 'user') {
        pairIds.push(messages[index - 1].id);
      }

      const { error } = await supabase
        .from('analise_chats')
        .delete()
        .in('id', pairIds);

      if (error) throw error;

      // Atualizar estado local
      setMessages(prev => prev.filter(m => !pairIds.includes(m.id)));
    } catch (err: any) {
      console.error('Erro ao deletar mensagem:', err.message);
      setError('Falha ao excluir mensagem.');
    }
  };

  if (isFetchingHistory) {
    return (
      <div className="flex items-center justify-center p-8 text-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} />
        Carregando histórico do chat...
      </div>
    );
  }

  return (
    <div className="bg-white/80 backdrop-blur-md rounded-[32px] border border-white shadow-lg overflow-hidden flex flex-col h-[500px]">
      {/* Header */}
      <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md">
            <Bot size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#1a1a1a]">Chat Jurídico IA</h3>
            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Assistente de Audiência</p>
          </div>
        </div>
        
        {!isExpired && (
          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-600 rounded-full text-[10px] font-bold uppercase tracking-wider border border-green-100">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            Sessão Ativa
          </div>
        )}
      </div>

      {/* Messages */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar bg-gray-50/10"
      >
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
            <Bot size={40} className="text-blue-200 mb-4" />
            <p className="text-sm text-gray-400 max-w-[200px]">
              Tire dúvidas sobre contradições, fatos ou depoimentos específicos.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`group flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm
                ${msg.role === 'user' ? 'bg-[#5A5A40] text-white' : 'bg-white border border-gray-100 text-blue-600'}`}>
                {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
              </div>
              <div className="relative">
                <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm prose prose-sm max-w-none
                  ${msg.role === 'user' 
                    ? 'bg-[#5A5A40] text-white rounded-tr-none' 
                    : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content}
                  </ReactMarkdown>
                </div>
                
                {msg.role === 'user' && !isLoading && (
                  <button
                    onClick={() => handleDeleteMessage(msg.id, msg.role)}
                    className="absolute -left-10 top-2 text-gray-400 hover:text-red-500 transition-all p-1"
                    title="Excluir pergunta e resposta"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex gap-3 max-w-[85%]">
              <div className="w-8 h-8 bg-white border border-gray-100 text-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                <Bot size={16} />
              </div>
              <div className="p-4 bg-white border border-gray-100 rounded-2xl rounded-tl-none flex items-center gap-2 shadow-sm">
                <Loader2 className="animate-spin text-blue-500" size={16} />
                <span className="text-xs text-gray-400 font-medium">Analisando contexto...</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 text-red-600 text-xs py-2 px-4 rounded-full border border-red-100 flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-5 bg-white border-t border-gray-100">
        {isExpired ? (
          <div className="flex items-center justify-center gap-2 py-3 bg-gray-50 rounded-2xl border border-gray-200 text-gray-400 text-xs font-medium">
            <Clock size={14} />
            Sessão expirada (48h). O histórico foi salvo para consulta.
          </div>
        ) : (
          <form onSubmit={handleSendMessage} className="relative">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Ex: A testemunha Luciano confirmou o pagamento?"
              disabled={isLoading}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl py-4 pl-5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || isLoading}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center hover:bg-blue-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              <Send size={18} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
