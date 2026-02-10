import React, { useState } from 'react';
import { supabase } from './supabase';
import { stateManager } from './stateManager';
import { cn } from './utils';

export const LoginOverlay: React.FC = () => {
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // metaon01~30 유효성 검사
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
        // ... (rest of the login logic)

        const normalizedId = userId.trim().toLowerCase();
        if (!isValidUserId(normalizedId)) {
            setError('아이디는 metaon01 ~ metaon30 범위 내에서 입력해주세요.');
            return;
        }

        setIsLoading(true);

        try {
            // DB에서 사용자 정보 조회
            const { data, error: dbError } = await supabase
                .from('edu_page_data')
                .select('user_id, password, app_state, hierarchy, classification_config')
                .eq('user_id', normalizedId)
                .single();

            // 에러 코드 406은 행을 찾을 수 없는 경우 (PGRST116)
            if (dbError && dbError.code === 'PGRST116') {
                // 사용자가 존재하지 않음 -> 초기 비밀번호 3212로 자동 생성 시도
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
                // 사용자가 존재함 -> 비밀번호 확인
                if (data.password === password) {
                    // app_state가 있고 내용이 있으면 선택권 제공
                    if (data.app_state && Object.keys(data.app_state).length > 0) {
                        setPendingData(data);
                        setShowChoice(true);
                    } else {
                        // 기존 데이터 없으면 즉시 로그인
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
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
            <div className="w-full max-w-[400px] bg-white/90 backdrop-blur-xl border border-white/40 rounded-2xl sm:rounded-3xl shadow-2xl p-5 sm:p-8 animate-fade-in my-auto">
                <div className="text-center mb-5 sm:mb-8">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl sm:rounded-2xl flex items-center justify-center text-white text-lg sm:text-2xl mx-auto mb-3 sm:mb-4 shadow-xl shadow-indigo-200">
                        <i className="fas fa-lock"></i>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black text-slate-900 mb-1 sm:mb-2">Metaon ICB 로그인</h2>
                    <p className="text-slate-500 text-xs sm:text-sm font-medium">교사 전용 메타온 콘텐츠 빌더 서비스</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-5">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 px-1">사용자 ID (metaon01~30)</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                placeholder="metaon01"
                                required
                                className="w-full bg-slate-50 border border-slate-100 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 outline-none transition-all font-bold text-slate-800"
                            />
                            <div className="absolute right-4 top-3.5 text-slate-300">
                                <i className="fas fa-user text-sm"></i>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1.5 px-1">비밀번호</label>
                        <div className="relative">
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••"
                                required
                                className="w-full bg-slate-50 border border-slate-100 rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 text-sm focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 outline-none transition-all font-mono"
                            />
                            <div className="absolute right-4 top-3.5 text-slate-300">
                                <i className="fas fa-key text-sm"></i>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <p className="text-rose-500 text-xs font-bold px-1 animate-shake bg-rose-50 rounded-xl py-2 px-3 border border-rose-100">
                            <i className="fas fa-exclamation-circle mr-1"></i>
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={cn(
                            "w-full min-h-[48px] py-3 sm:py-4 rounded-xl sm:rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black text-sm shadow-xl shadow-indigo-100 hover:shadow-indigo-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2 mt-3 sm:mt-4",
                            isLoading && "opacity-50 pointer-events-none"
                        )}
                    >
                        {isLoading ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                처리 중...
                            </>
                        ) : (
                            <>
                                로그인
                                <i className="fas fa-arrow-right text-xs"></i>
                            </>
                        )}
                    </button>

                    <div className="mt-6 pt-4 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setShowConfig(!showConfig)}
                            className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-500 transition-colors mx-auto block mb-2"
                        >
                            {showConfig ? '기본 로그인으로 돌아가기' : 'Supabase 수동 설정 (비상용)'}
                        </button>

                        {showConfig && (
                            <div className="space-y-4 animate-slide-up bg-slate-50/50 p-4 rounded-2xl border border-slate-100 mt-2">
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Supabase URL</label>
                                    <input
                                        type="text"
                                        value={manualUrl}
                                        onChange={(e) => setManualUrl(e.target.value)}
                                        placeholder="https://xxx.supabase.co"
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-[11px] focus:ring-2 focus:ring-indigo-100 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Anon Key</label>
                                    <input
                                        type="password"
                                        value={manualKey}
                                        onChange={(e) => setManualKey(e.target.value)}
                                        placeholder="eyJhbGci..."
                                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 text-[11px] focus:ring-2 focus:ring-indigo-100 outline-none"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={handleConfigSave}
                                    className="w-full py-2 bg-slate-800 text-white text-[10px] font-black rounded-xl hover:bg-slate-700 transition-colors"
                                >
                                    설정 적용
                                </button>
                            </div>
                        )}
                    </div>

                    <p className="text-[10px] text-center text-slate-400 mt-4 leading-relaxed">
                        초기 비밀번호는 <strong>3212</strong>입니다.<br />
                        로그인 후 설정 메뉴에서 변경하실 수 있습니다.
                    </p>
                </form>

                {/* 이어서 하기 / 새로 시작 선택 모달 */}
                {showChoice && (
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-6">
                        <div className="w-full max-w-[360px] bg-white rounded-3xl shadow-2xl p-8 animate-slide-up border border-slate-100">
                            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-4">
                                <i className="fas fa-history"></i>
                            </div>
                            <h3 className="text-xl font-black text-slate-900 text-center mb-2">기존 작업 발견</h3>
                            <p className="text-slate-500 text-sm text-center mb-8 leading-relaxed">
                                이전에 작업하던 데이터가 있습니다.<br />
                                <strong>이어서 진행</strong>하시겠습니까?
                            </p>

                            <div className="space-y-3">
                                <button
                                    onClick={() => completeLogin(pendingData, true)}
                                    className="w-full py-4 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                                >
                                    <i className="fas fa-play"></i>
                                    작업 이어서 하기
                                </button>
                                <button
                                    onClick={() => completeLogin(pendingData, false)}
                                    className="w-full py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                                >
                                    <i className="fas fa-redo"></i>
                                    처음부터 새로 시작
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
