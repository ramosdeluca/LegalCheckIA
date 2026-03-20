import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../AuthContext';
import { User, Phone, FileText, Save, X, Loader2, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ProfileSettingsProps {
    onClose: () => void;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({ onClose }) => {
    const { user, profile, refreshProfile } = useAuth();
    const [fullName, setFullName] = useState(profile?.full_name || '');
    const [phone, setPhone] = useState(profile?.phone || '');
    const [document, setDocument] = useState(profile?.document || '');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    
    // Subscription Cancel/Change states
    const [isCanceling, setIsCanceling] = useState(false);
    const [isChangingPlan, setIsChangingPlan] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);

    useEffect(() => {
        if (profile) {
            setFullName(profile.full_name || '');
            setPhone(profile.phone || '');
            setDocument(profile.document || '');
        }
    }, [profile]);

    // Masks (same as Register.tsx)
    const maskPhone = (value: string) => {
        return value
            .replace(/\D/g, '')
            .replace(/(\d{2})(\d)/, '($1) $2')
            .replace(/(\d{5})(\d)/, '$1-$2')
            .replace(/(-\d{4})\d+?$/, '$1');
    };

    const maskDocument = (value: string) => {
        const clean = value.replace(/\D/g, '');
        if (clean.length <= 11) {
            return clean
                .replace(/(\d{3})(\d)/, '$1.$2')
                .replace(/(\d{3})(\d)/, '$1.$2')
                .replace(/(\d{3})(\d{1,2})/, '$1-$2')
                .replace(/(-\d{2})\d+?$/, '$1');
        } else {
            return clean
                .replace(/(\d{2})(\d)/, '$1.$2')
                .replace(/(\d{3})(\d)/, '$1.$2')
                .replace(/(\d{3})(\d)/, '$1/$2')
                .replace(/(\d{4})(\d{1,2})/, '$1-$2')
                .replace(/(-\d{2})\d+?$/, '$1');
        }
    };

    const validateCPF = (cpf: string) => {
        cpf = cpf.replace(/[^\d]+/g, '');
        if (cpf.length !== 11 || !!cpf.match(/(\d)\1{10}/)) return false;
        let add = 0;
        for (let i = 0; i < 9; i++) add += parseInt(cpf.charAt(i)) * (10 - i);
        let rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        if (rev !== parseInt(cpf.charAt(9))) return false;
        add = 0;
        for (let i = 0; i < 10; i++) add += parseInt(cpf.charAt(i)) * (11 - i);
        rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        if (rev !== parseInt(cpf.charAt(10))) return false;
        return true;
    };

    const validateCNPJ = (cnpj: string) => {
        cnpj = cnpj.replace(/[^\d]+/g, '');
        if (cnpj.length !== 14 || !!cnpj.match(/(\d)\1{13}/)) return false;
        let size = cnpj.length - 2;
        let numbers = cnpj.substring(0, size);
        const digits = cnpj.substring(size);
        let sum = 0;
        let pos = size - 7;
        for (let i = size; i >= 1; i--) {
            sum += parseInt(numbers.charAt(size - i)) * pos--;
            if (pos < 2) pos = 9;
        }
        let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        if (result !== parseInt(digits.charAt(0))) return false;
        size = size + 1;
        numbers = cnpj.substring(0, size);
        sum = 0;
        pos = size - 7;
        for (let i = size; i >= 1; i--) {
            sum += parseInt(numbers.charAt(size - i)) * pos--;
            if (pos < 2) pos = 9;
        }
        result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
        if (result !== parseInt(digits.charAt(1))) return false;
        return true;
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        // Document Validation
        const cleanDoc = document.replace(/\D/g, '');
        if (cleanDoc.length === 11) {
            if (!validateCPF(cleanDoc)) {
                setError('CPF inválido.');
                setLoading(false);
                return;
            }
        } else if (cleanDoc.length === 14) {
            if (!validateCNPJ(cleanDoc)) {
                setError('CNPJ inválido.');
                setLoading(false);
                return;
            }
        } else {
            setError('Documento deve ser um CPF ou CNPJ válido.');
            setLoading(false);
            return;
        }

        try {
            // 1. Update Profile table
            const { error: profileError } = await supabase
                .from('profiles')
                .update({
                    full_name: fullName,
                    phone: phone,
                    document: document,
                    updated_at: new Date().toISOString()
                })
                .eq('id', user?.id);

            if (profileError) throw profileError;

            // 2. Update Auth Metadata
            const { error: authError } = await supabase.auth.updateUser({
                data: {
                    full_name: fullName,
                    phone: phone,
                    document: document
                }
            });

            if (authError) throw authError;

            await refreshProfile();
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (err: any) {
            console.error('Update profile error:', err);
            setError(err.message || 'Erro ao atualizar perfil.');
        } finally {
            setLoading(false);
        }
    };

    const handleCancelSubscription = async () => {
        setIsCanceling(true);
        setError(null);
        try {
            const res = await fetch('/api/pagamentos/cancelar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user?.id })
            });
            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || 'Erro ao cancelar assinatura. Tente novamente.');
            }
            
            await refreshProfile();
            setSuccess(true);
            setShowCancelConfirm(false);
        } catch (err: any) {
            console.error('Cancel error:', err);
            setError(err.message);
        } finally {
            setIsCanceling(false);
        }
    };

    const handlePlanChange = async (novoPlano: 'basico' | 'profissional') => {
        const text = novoPlano === 'profissional' ? 'Upgrade para Profissional (20 créditos)' : 'Downgrade para Básico (5 créditos)';
        if (!window.confirm(`Tem certeza que deseja realizar o ${text}? Seu valor de assinatura no Asaas será atualizado.`)) return;
        
        setIsChangingPlan(true);
        setError(null);
        try {
            const res = await fetch('/api/pagamentos/alterar-plano', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user?.id, novoPlano })
            });
            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error || 'Erro ao alterar plano. Tente novamente.');
            }
            
            await refreshProfile();
            setSuccess(true);
        } catch (err: any) {
            console.error('Plan change error:', err);
            setError(err.message);
        } finally {
            setIsChangingPlan(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
// ... (rest of the file remains similar until section)
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="bg-white rounded-[32px] shadow-2xl p-6 md:p-10 max-w-lg w-full relative overflow-hidden"
            >
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#5A5A40]/5 rounded-bl-full pointer-events-none" />

                <button
                    onClick={onClose}
                    className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all"
                >
                    <X size={24} />
                </button>

                <div className="mb-8">
                    <h2 className="text-3xl font-serif text-[#1a1a1a] mb-2">Meus Dados</h2>
                    <p className="text-sm text-gray-500 font-medium">Atualize suas informações profissionais</p>
                </div>

                <form onSubmit={handleUpdate} className="space-y-6">
                    {error && (
                        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1">
                            <AlertCircle size={18} className="shrink-0" />
                            <p>{error}</p>
                        </div>
                    )}

                    {success && (
                        <div className="bg-green-50 border border-green-100 text-green-600 p-4 rounded-2xl flex items-center gap-2 text-sm animate-in fade-in slide-in-from-top-1">
                            <CheckCircle2 size={18} className="shrink-0" />
                            <p>Perfil atualizado com sucesso!</p>
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Nome Completo</label>
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="w-full bg-gray-50 border border-black/5 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/10 focus:border-[#5A5A40] transition-all"
                                    placeholder="Seu nome completo"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Telefone Celular</label>
                            <div className="relative">
                                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={phone}
                                    onChange={(e) => setPhone(maskPhone(e.target.value))}
                                    className="w-full bg-gray-50 border border-black/5 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/10 focus:border-[#5A5A40] transition-all"
                                    placeholder="(00) 00000-0000"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">CPF ou CNPJ</label>
                            <div className="relative">
                                <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="text"
                                    value={document}
                                    onChange={(e) => setDocument(maskDocument(e.target.value))}
                                    className="w-full bg-gray-50 border border-black/5 rounded-2xl py-3.5 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/10 focus:border-[#5A5A40] transition-all"
                                    placeholder="000.000.000-00 ou 00.000.000/0000-00"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2 opacity-60">
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">E-mail (Não editável)</label>
                            <div className="w-full bg-gray-100 border border-black/5 rounded-2xl py-3.5 px-4 text-gray-500 font-medium cursor-not-allowed">
                                {user?.email}
                            </div>
                        </div>
                    </div>

                    {/* Subscription Status Section */}
                    <div className="p-5 bg-gray-50 border border-black/5 rounded-2xl space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-bold text-[#1a1a1a] uppercase tracking-wider mb-1">Status da Assinatura</h3>
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${profile?.status_assinatura === 'active' ? 'bg-green-500' : profile?.status_assinatura === 'canceled' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                                    <span className="text-sm text-gray-600 capitalize">
                                        {profile?.status_assinatura === 'active' ? 'Ativa' : profile?.status_assinatura === 'canceled' ? 'Cancelada' : profile?.status_assinatura || 'Sem Plano'}
                                    </span>
                                </div>
                            </div>
                            {profile?.plan_type && (
                                <div className="text-right">
                                    <span className="text-xs text-gray-400 font-bold uppercase tracking-widest block mb-1">Plano Atual</span>
                                    <span className="text-[#5A5A40] font-medium capitalize prose-sm">{profile.plan_type}</span>
                                </div>
                            )}
                        </div>

                        {/* Botoes de Mudanca de Plano (Upgrade/Downgrade) */}
                        {profile?.status_assinatura === 'active' && !showCancelConfirm && (
                            <div className="grid grid-cols-1 gap-2 mt-2">
                                {profile.plan_type === 'basico' && (
                                    <button
                                        type="button"
                                        disabled={isChangingPlan}
                                        onClick={() => handlePlanChange('profissional')}
                                        className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {isChangingPlan ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        Mudar para Profissional (Upgrade)
                                    </button>
                                )}
                                {profile.plan_type === 'profissional' && (
                                    <button
                                        type="button"
                                        disabled={isChangingPlan}
                                        onClick={() => handlePlanChange('basico')}
                                        className="w-full py-3 rounded-xl font-bold text-blue-600 border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-all text-xs uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {isChangingPlan ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                        Mudar para Básico (Downgrade)
                                    </button>
                                )}
                            </div>
                        )}

                        {profile?.status_assinatura === 'active' && !showCancelConfirm && (
                            <button
                                type="button"
                                onClick={() => setShowCancelConfirm(true)}
                                className="w-full mt-1 py-3 rounded-xl font-medium text-red-400 hover:text-red-600 transition-all text-[10px] uppercase tracking-widest flex items-center justify-center gap-2"
                            >
                                <Trash2 size={14} />
                                Cancelar Assinatura
                            </button>
                        )}

                        {showCancelConfirm && (
                            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl space-y-4 animate-in fade-in zoom-in-95">
                                <h4 className="font-bold text-red-700 text-sm">Atenção: Ação Irreversível</h4>
                                <p className="text-sm text-red-600/90 leading-relaxed">
                                    Tem certeza que deseja cancelar sua assinatura? O cancelamento é imediato e você <strong>perderá todo o acesso visual aos seus processos, dados e análises</strong>.
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowCancelConfirm(false)}
                                        className="flex-1 py-2.5 bg-white text-gray-600 border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50"
                                    >
                                        Voltar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancelSubscription}
                                        disabled={isCanceling}
                                        className="flex-1 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {isCanceling ? <Loader2 className="animate-spin" size={16} /> : 'Sim, Cancelar'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex gap-3 pt-4 border-t border-black/5">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-4 rounded-2xl font-medium text-gray-500 hover:bg-gray-50 transition-all border border-transparent"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-4 bg-[#5A5A40] text-white rounded-2xl font-medium hover:bg-[#4a4a35] transition-all shadow-lg shadow-[#5A5A40]/20 flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="animate-spin" size={20} />
                                    <span>Salvando...</span>
                                </>
                            ) : (
                                <>
                                    <Save size={20} />
                                    <span>Salvar Alterações</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};
