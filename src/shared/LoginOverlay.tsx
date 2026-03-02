import React, { useState } from 'react';
import { supabase } from './supabase';
import { stateManager } from './stateManager';
import { cn } from './utils';

export const LoginOverlay: React.FC = () => {
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isValidUserId = (id: string) => {
        const regex = /^metaon(0[1-9]|[12][0-9]|30)$/;
        return regex.test(id.toLowerCase());
    };

    const [showConfig, setShowConfig] = useState(false);
    const [manualUrl, setManualUrl] = useState(stateManager.getState().supabaseConfig.url || '');
    const [manualKey, setManualKey] = useState(stateManager.getState().supabaseConfig.anonKey || '');

    const [showChoice, setShowChoice] = useState(false);
    const [pendingData, setPendingData] = useState<any>(null);

    const handleConfigSave = () => {
        stateManager.setSupabaseConfig(manualUrl, manualKey);
        setShowConfig(false);
        alert('Supabase 설정이 임시 저장되었습니다. 다시 로그인을 시도해주세요.');
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const normalizedId = userId.trim().toLowerCase();
        if (!isValidUserId(normalizedId)) {
            setError('아이디는 metaon01 ~ metaon30 범위 내에서 입력해주세요.');
            return;
        }

        setIsLoading(true);

        try {
            const { data, error: dbError } = await supabase
                .from('edu_page_data')
                .select('user_id, password, app_state, hierarchy, classification_config')
                .eq('user_id', normalizedId)
                .single();

            if (dbError && dbError.code === 'PGRST116') {
                if (password === '3212') {
                    const { error: insertError } = await supabase
                        .from('edu_page_data')
                        .insert({
                            user_id: normalizedId,
                            password: '3212',
                            app_state: {},
                            hierarchy: {},
                            classification_config: {}
                        });

                    if (insertError) throw insertError;

                    stateManager.setAuthenticated(normalizedId);
                } else {
                    setError('비밀번호가 일치하지 않습니다. (초기 비밀번호: 3212)');
                }
            } else if (dbError) {
                throw dbError;
            } else if (data) {
                if (data.password === password) {
                    if (data.app_state && Object.keys(data.app_state).length > 0) {
                        setPendingData(data);
                        setShowChoice(true);
                    } else {
                        completeLogin(data, false);
                    }
                } else {
                    setError('비밀번호가 일치하지 않습니다.');
                }
            }
        } catch (err: any) {
            console.error('Login Error:', err);
            setError(`로그인 중 오류가 발생했습니다: ${err.message || 'Unknown error'}`);
        } finally {
            setIsLoading(false);
        }
    };

    const completeLogin = (dbData: any, shouldRestore: boolean) => {
        stateManager.setAuthenticated(dbData.user_id);

        if (shouldRestore && dbData.app_state) {
            stateManager.restoreSession(dbData.app_state, dbData.classification_config);
        } else {
            stateManager.startNewSession();
        }

        setShowChoice(false);
        setPendingData(null);
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto"
            style={{ background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(8px)' }}>

            {/* Login Card */}
            <div className="w-full max-w-md mx-4 my-8 animate-fade-up">
                <div className="bg-white rounded-2xl shadow-card-lg overflow-hidden"
                    style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.18)' }}>

                    {/* Top Brand Bar */}
                    <div className="step2-gradient px-8 pt-8 pb-10 relative overflow-hidden">
                        {/* Decorative circles */}
                        <div className="absolute -top-6 -right-6 w-28 h-28 bg-white/10 rounded-full" />
                        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-white/10 rounded-full" />

                        <div className="relative">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                        <path d="M2 17l10 5 10-5"/>
                                        <path d="M2 12l10 5 10-5"/>
                                    </svg>
                                </div>
                                <div>
                                    <p className="text-white/70 text-xs font-semibold tracking-wider uppercase">Metaon</p>
                                    <p className="text-white font-bold text-sm leading-tight">Instant Content Builder</p>
                                </div>
                            </div>
                            <h1 className="text-white font-bold text-2xl leading-tight">
                                교사 전용 로그인
                            </h1>
                            <p className="text-white/70 text-sm mt-1">AI 기반 학습 콘텐츠 제작 시스템</p>
                        </div>
                    </div>

                    {/* Form */}
                    <form onSubmit={handleLogin} className="px-8 py-7 space-y-5">

                        {/* User ID */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                사용자 ID
                            </label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                        <circle cx="12" cy="7" r="4"/>
                                    </svg>
                                </div>
                                <input
                                    type="text"
                                    value={userId}
                                    onChange={(e) => setUserId(e.target.value)}
                                    placeholder="metaon01"
                                    required
                                    className="input-field pl-11"
                                />
                            </div>
                            <p className="text-xs text-slate-400 mt-1.5 pl-1">metaon01 ~ metaon30</p>
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                비밀번호
                            </label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                </div>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••"
                                    required
                                    className="input-field pl-11 font-mono tracking-widest"
                                />
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl animate-fade-in">
                                <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                <p className="text-red-600 text-sm font-medium">{error}</p>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className={cn('btn btn-primary w-full btn-lg', isLoading && 'opacity-60 pointer-events-none')}
                        >
                            {isLoading ? (
                                <>
                                    <span className="spinner-sm" style={{ borderTopColor: 'white' }} />
                                    로그인 중...
                                </>
                            ) : (
                                <>
                                    로그인
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M5 12h14M12 5l7 7-7 7"/>
                                    </svg>
                                </>
                            )}
                        </button>

                        {/* Hint */}
                        <p className="text-center text-xs text-slate-400">
                            초기 비밀번호: <span className="font-bold text-slate-600">3212</span>
                        </p>

                        {/* Supabase Config Toggle */}
                        <div className="pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setShowConfig(!showConfig)}
                                className="text-xs text-slate-400 hover:text-indigo-500 transition-colors font-medium mx-auto block"
                            >
                                {showConfig ? '닫기' : 'Supabase 수동 설정'}
                            </button>

                            {showConfig && (
                                <div className="mt-4 space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100 animate-fade-up">
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500 block mb-1">Supabase URL</label>
                                        <input
                                            type="text"
                                            value={manualUrl}
                                            onChange={(e) => setManualUrl(e.target.value)}
                                            placeholder="https://xxx.supabase.co"
                                            className="input-field text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-semibold text-slate-500 block mb-1">Anon Key</label>
                                        <input
                                            type="password"
                                            value={manualKey}
                                            onChange={(e) => setManualKey(e.target.value)}
                                            placeholder="eyJhbGci..."
                                            className="input-field text-sm"
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleConfigSave}
                                        className="btn btn-secondary w-full btn-sm"
                                    >
                                        설정 적용
                                    </button>
                                </div>
                            )}
                        </div>
                    </form>
                </div>
            </div>

            {/* Session Choice Modal */}
            {showChoice && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
                    style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}>
                    <div className="w-full max-w-sm bg-white rounded-2xl shadow-card-lg p-6 animate-scale-in"
                        style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.2)' }}>

                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                            style={{ background: 'linear-gradient(135deg, #F97316, #FB923C)' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="1 4 1 10 7 10"/>
                                <path d="M3.51 15a9 9 0 1 0 .49-3.68"/>
                            </svg>
                        </div>

                        <h3 className="text-xl font-bold text-slate-900 text-center mb-1">기존 작업 발견</h3>
                        <p className="text-slate-500 text-sm text-center mb-6 leading-relaxed">
                            이전에 작업하던 데이터가 있습니다.
                        </p>

                        <div className="space-y-3">
                            <button
                                onClick={() => completeLogin(pendingData, true)}
                                className="btn btn-primary w-full"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                </svg>
                                작업 이어서 하기
                            </button>
                            <button
                                onClick={() => completeLogin(pendingData, false)}
                                className="btn btn-secondary w-full"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1 4 1 10 7 10"/>
                                    <path d="M3.51 15a9 9 0 1 0 .49-3.68"/>
                                </svg>
                                처음부터 새로 시작
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
