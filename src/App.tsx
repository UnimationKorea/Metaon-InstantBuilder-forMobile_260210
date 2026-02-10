/**
 * =========================================
 * Metaon Instant Content Builder - Mobile
 * =========================================
 * 모바일 전용 앱 - 카테고리 선택 + 3단계 진입
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Step1Acquisition } from '@/step1-acquisition';
import { Step2Refinement } from '@/step2-refinement';
import { Step3Runtime } from '@/step3-activity-runtime';
import {
    Step1Output,
    Step2Session,
    Step3ActivityBundle,
    ClassificationConfig,
    PageHierarchy,
    stateManager,
    saveAppState,
    fetchPageContent,
    fetchStorageMap,
    cn,
    LoginOverlay
} from '@/shared';



// ===== 카테고리 바 컴포넌트 =====
interface CategoryBarProps {
    hierarchy: PageHierarchy | null;
    onHierarchyChange: (h: PageHierarchy) => void;
    classificationConfig: ClassificationConfig;
}

const CategoryBar: React.FC<CategoryBarProps> = ({ hierarchy, onHierarchyChange, classificationConfig }) => {
    const [storageMap, setStorageMap] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // DB에서 저장된 페이지 목록 조회
    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const { data } = await fetchStorageMap();
            if (data) setStorageMap(data);
            setLoading(false);
        };
        load();
    }, []);

    // 고유 옵션 추출
    const subjects = [...new Set(storageMap.map(d => d.subject))];
    const levels = [...new Set(storageMap.filter(d => !hierarchy?.subject || d.subject === hierarchy.subject).map(d => d.level))];
    const sets = [...new Set(storageMap.filter(d =>
        (!hierarchy?.subject || d.subject === hierarchy.subject) &&
        (!hierarchy?.level || d.level === hierarchy.level)
    ).map(d => d.set_num))];
    const pages = [...new Set(storageMap.filter(d =>
        (!hierarchy?.subject || d.subject === hierarchy.subject) &&
        (!hierarchy?.level || d.level === hierarchy.level) &&
        (!hierarchy?.set || d.set_num === hierarchy.set)
    ).map(d => d.page_num))];

    const handleChange = (field: keyof PageHierarchy, value: string) => {
        const current = hierarchy || { subject: '', level: '', set: '', page: '' };
        const updated = { ...current, [field]: value };
        // 상위 변경 시 하위 초기화
        if (field === 'subject') { updated.level = ''; updated.set = ''; updated.page = ''; }
        if (field === 'level') { updated.set = ''; updated.page = ''; }
        if (field === 'set') { updated.page = ''; }
        onHierarchyChange(updated);
    };

    const selectors = [
        { label: classificationConfig.subject || 'Subject', field: 'subject' as const, options: subjects, value: hierarchy?.subject || '' },
        { label: classificationConfig.label1 || 'Package', field: 'level' as const, options: levels, value: hierarchy?.level || '' },
        { label: classificationConfig.label2 || 'Book', field: 'set' as const, options: sets, value: hierarchy?.set || '' },
        { label: classificationConfig.label3 || 'Page', field: 'page' as const, options: pages, value: hierarchy?.page || '' },
    ];

    return (
        <div className="bg-white border-b border-slate-200 px-4 py-3">
            <div className="grid grid-cols-4 gap-2">
                {selectors.map(sel => (
                    <div key={sel.field}>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            {sel.label}
                        </label>
                        <select
                            value={sel.value}
                            onChange={e => handleChange(sel.field, e.target.value)}
                            disabled={loading}
                            className="w-full h-10 px-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg appearance-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                        >
                            <option value="">선택</option>
                            {sel.options.sort().map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ===== 메인 앱 컴포넌트 =====
const App: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // 전역 상태
    const [currentView, setCurrentView] = useState<'home' | 'step1' | 'step2' | 'step3'>('home');
    const [step1Data, setStep1Data] = useState<Step1Output | null>(null);
    const [step2Data, setStep2Data] = useState<Step2Session | null>(null);
    const [, setStep3Data] = useState<Step3ActivityBundle | null>(null);
    const [classificationConfig, setClassificationConfig] = useState<ClassificationConfig>(
        stateManager.getState().classificationConfig
    );
    const [geminiApiKey, setGeminiApiKey] = useState<string>(
        stateManager.getState().geminiApiKey || ''
    );
    const [engineModel, setEngineModel] = useState('gemini-2.5-flash');
    const [authState, setAuthState] = useState(stateManager.getState().auth);
    const [hierarchy, setHierarchy] = useState<PageHierarchy | null>(
        stateManager.getState().hierarchy || null
    );

    // 페이지 데이터 존재 여부
    const [pageDataExists, setPageDataExists] = useState<boolean | null>(null);
    const [checkingPage, setCheckingPage] = useState(false);

    // Step1 완료 여부 (세션 내)
    const [step1Completed, setStep1Completed] = useState(false);

    // 설정 모달
    const [showSettings, setShowSettings] = useState(false);

    // 비용 추적
    const [totalCost, setTotalCost] = useState(0);
    const MODEL_RATES: Record<string, { input: number, output: number }> = {
        'gemini-3.0-pro-preview': { input: 2.50, output: 10.00 },
        'gemini-3.0-flash-preview': { input: 0.15, output: 0.60 },
        'gemini-2.5-pro': { input: 1.25, output: 3.75 },
        'gemini-2.5-flash': { input: 0.075, output: 0.30 },
        'gemini-2.5-flash-lite': { input: 0.04, output: 0.16 }
    };

    const handleCostUpdate = useCallback((model: string, inputTokens: number, outputTokens: number) => {
        const rates = MODEL_RATES[model] || MODEL_RATES['gemini-2.5-flash'];
        const inputCost = (inputTokens / 1000000) * rates.input;
        const outputCost = (outputTokens / 1000000) * rates.output;
        setTotalCost(prev => prev + inputCost + outputCost);
    }, []);

    // URL 동기화
    useEffect(() => {
        const path = location.pathname;
        if (path.includes('step1')) setCurrentView('step1');
        else if (path.includes('step2')) setCurrentView('step2');
        else if (path.includes('step3')) setCurrentView('step3');
        else setCurrentView('home');
    }, [location]);

    // 상태 변경 구독
    useEffect(() => {
        const unsubscribe = stateManager.subscribe((state) => {
            setStep1Data(state.step1Data);
            setStep2Data(state.step2Data);
            setStep3Data(state.step3Data);
            setClassificationConfig(state.classificationConfig);
            setGeminiApiKey(state.geminiApiKey || '');
            setAuthState({ ...state.auth });
        });
        return () => unsubscribe();
    }, []);

    // 카테고리 변경 시 데이터 존재 여부 확인
    useEffect(() => {
        const checkPageData = async () => {
            if (!hierarchy?.subject || !hierarchy?.level || !hierarchy?.set || !hierarchy?.page) {
                setPageDataExists(null);
                return;
            }
            setCheckingPage(true);
            try {
                const { data } = await fetchPageContent(
                    hierarchy.subject, hierarchy.level, hierarchy.set, hierarchy.page
                );
                setPageDataExists(!!(data && data.content_data));
            } catch {
                setPageDataExists(null);
            }
            setCheckingPage(false);
        };
        checkPageData();
        // Step1 완료 상태 초기화
        setStep1Completed(false);
    }, [hierarchy?.subject, hierarchy?.level, hierarchy?.set, hierarchy?.page]);

    // hierarchy를 전역에 동기화
    const handleHierarchyChange = useCallback((h: PageHierarchy) => {
        setHierarchy(h);
        if (h.subject && h.level && h.set && h.page) {
            stateManager.setHierarchy(h);
        }
    }, []);

    // 카테고리 완전 선택 여부
    const isCategorySelected = !!(
        hierarchy?.subject && hierarchy?.level && hierarchy?.set && hierarchy?.page
    );

    // ===== 스텝 네비게이션 규칙 =====
    // 기존 완성 페이지: Step1, Step2 활성 → Step2 깜빡임
    // 신규 페이지: Step1만 활성 → Step1 깜빡임 (Step1 완료 후 Step2 활성)
    const isStep1Enabled = isCategorySelected;
    const isStep2Enabled = isCategorySelected && (pageDataExists === true || step1Completed);
    const isStep3Enabled = isCategorySelected && pageDataExists === true;

    const recommendedStep = isCategorySelected
        ? (pageDataExists === true ? 2 : 1)
        : null;

    // ===== Step 핸들러 =====
    const handleStep1Complete = useCallback(async (data: Step1Output) => {
        const currentHierarchy = hierarchy || stateManager.getState().hierarchy;

        // 기존 데이터가 있는 완성 페이지에서 Step1→Step2 시 경고
        if (currentHierarchy && pageDataExists) {
            try {
                const { data: existingData } = await fetchPageContent(
                    currentHierarchy.subject, currentHierarchy.level,
                    currentHierarchy.set, currentHierarchy.page
                );
                if (existingData && existingData.content_data) {
                    const confirmed = window.confirm(
                        `[⚠️ 경고]\n\n${currentHierarchy.subject} ${currentHierarchy.level}-${currentHierarchy.set} Set - ${currentHierarchy.page} Page에\n이미 저장된 데이터가 있습니다.\n\n계속 진행하면 기존 데이터가 덮어씌워집니다.\n\n진행하시겠습니까?`
                    );
                    if (!confirmed) return;
                }
            } catch (err) {
                console.error('[Mobile] Data check failed:', err);
            }
        }

        setStep1Data(data);
        stateManager.setStep1Data(data);
        setStep1Completed(true);

        // Step2 세션 생성
        if (currentHierarchy) {
            const newSession: Step2Session = {
                sessionId: `session-${Date.now()}`,
                timestamp: new Date().toISOString(),
                subject: currentHierarchy.subject as any,
                hierarchy: currentHierarchy,
                stacks: {},
                resources: {},
                config: { viewMode: 'ASSET_POOL', hierarchy: currentHierarchy },
                validationStatus: { isValid: true, errors: [], warnings: [] }
            };
            setStep2Data(newSession);
            stateManager.setStep2Data(newSession);
        }

        saveAppState().catch(err => console.error('Auto save failed:', err));
        navigate('/step2');
    }, [hierarchy, pageDataExists, navigate]);

    const handleStep2Complete = useCallback((data: Step2Session) => {
        setStep2Data(data);
        stateManager.setStep2Data(data);
        saveAppState().catch(err => console.error('Auto save failed:', err));
        navigate('/step3');
    }, [navigate]);

    const handleStep3Complete = useCallback((data: Step3ActivityBundle) => {
        setStep3Data(data);
        stateManager.setStep3Data(data);
    }, []);

    // 스텝 카드 클릭
    const handleStepCardClick = useCallback(async (stepId: number) => {
        if (!isCategorySelected || !hierarchy) return;

        stateManager.setHierarchy(hierarchy);

        if (stepId === 1) {
            if (!isStep1Enabled) return;
            stateManager.clearStepData(1);
            setStep1Data(null);
            navigate('/step1');
        } else if (stepId === 2) {
            if (!isStep2Enabled) return;

            if (pageDataExists) {
                // 기존 완성 페이지 → DB 데이터 로드
                const { data } = await fetchPageContent(
                    hierarchy.subject, hierarchy.level, hierarchy.set, hierarchy.page
                );
                if (data && data.content_data) {
                    const contentData = data.content_data;
                    const setPageKey = `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}-${hierarchy.page}`;
                    const setKey = `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}`;
                    const session: Step2Session = {
                        sessionId: `session-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        subject: hierarchy.subject as any,
                        hierarchy,
                        stacks: { [setPageKey]: contentData.stacks || [] },
                        resources: { [setKey]: contentData.resources || [] },
                        config: { viewMode: 'PAGE_EDITOR', hierarchy },
                        validationStatus: { isValid: true, errors: [], warnings: [] }
                    };
                    setStep2Data(session);
                    stateManager.setStep2Data(session);
                }
            }
            navigate('/step2');
        } else if (stepId === 3) {
            if (!isStep3Enabled) return;
            navigate('/step3');
        }
    }, [isCategorySelected, hierarchy, isStep1Enabled, isStep2Enabled, isStep3Enabled, pageDataExists, navigate]);

    // 뒤로가기 (스텝 → 홈)
    const handleGoHome = useCallback(() => {
        navigate('/');
    }, [navigate]);

    // ===== 렌더링 =====
    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex flex-col">
            {!authState.isAuthenticated && <LoginOverlay />}

            {/* 상단 헤더 */}
            <header className="bg-white/90 backdrop-blur-xl border-b border-slate-200/50 px-4 py-3 sticky top-0 z-50 shadow-sm">
                <div className="flex items-center justify-between">
                    {/* 로고 / 뒤로가기 */}
                    <div className="flex items-center gap-3">
                        {currentView !== 'home' ? (
                            <button
                                onClick={handleGoHome}
                                className="w-10 h-10 flex items-center justify-center text-slate-500 hover:text-indigo-600 rounded-xl transition-all active:scale-95"
                            >
                                <i className="fas fa-arrow-left text-lg"></i>
                            </button>
                        ) : (
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                                <i className="fas fa-rocket text-white text-lg"></i>
                            </div>
                        )}
                        <div>
                            <h1 className="text-base font-black text-slate-900 leading-none">
                                {currentView === 'home' ? 'Metaon Mobile' :
                                    currentView === 'step1' ? "Let's collect" :
                                        currentView === 'step2' ? "Let's make" : "Let's play"}
                            </h1>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                                {currentView === 'home' ? 'Instant Content Builder' :
                                    currentView === 'step1' ? '원고 수집' :
                                        currentView === 'step2' ? '데이터 편집' : '액티비티 런타임'}
                            </p>
                        </div>
                    </div>

                    {/* 우측 액션 */}
                    <div className="flex items-center gap-1">
                        {authState.isAuthenticated && (
                            <button
                                onClick={() => {
                                    if (confirm('로그아웃 하시겠습니까?')) {
                                        stateManager.logout();
                                        navigate('/');
                                    }
                                }}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-rose-500 rounded-xl transition-all"
                            >
                                <i className="fas fa-sign-out-alt text-sm"></i>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* 카테고리 바 (항상 표시) */}
            {authState.isAuthenticated && (
                <CategoryBar
                    hierarchy={hierarchy}
                    onHierarchyChange={handleHierarchyChange}
                    classificationConfig={classificationConfig}
                />
            )}

            {/* 메인 콘텐츠 */}
            <main className="flex-1 flex flex-col">
                <Routes>
                    {/* 홈 화면 */}
                    <Route path="/" element={
                        <HomeView
                            isCategorySelected={isCategorySelected}
                            pageDataExists={pageDataExists}
                            checkingPage={checkingPage}
                            recommendedStep={recommendedStep}
                            isStep1Enabled={isStep1Enabled}
                            isStep2Enabled={isStep2Enabled}
                            isStep3Enabled={isStep3Enabled}
                            onStepClick={handleStepCardClick}
                            onSettingsClick={() => setShowSettings(true)}
                        />
                    } />

                    {/* Step 1 */}
                    <Route path="/step1" element={
                        <Step1Acquisition
                            initialData={step1Data}
                            onComplete={handleStep1Complete}
                            onUpdate={setStep1Data}
                            engineModel={engineModel}
                            geminiApiKey={geminiApiKey}
                            onCostUpdate={handleCostUpdate}
                        />
                    } />

                    {/* Step 2 */}
                    <Route path="/step2" element={
                        <Step2Refinement
                            initialData={step1Data}
                            workingSession={step2Data}
                            onComplete={handleStep2Complete}
                            onUpdate={setStep2Data}
                            onBack={handleGoHome}
                            engineModel={engineModel}
                            geminiApiKey={geminiApiKey}
                            classificationConfig={classificationConfig}
                        />
                    } />

                    {/* Step 3 */}
                    <Route path="/step3" element={
                        <Step3Runtime
                            sessionData={step2Data}
                            onComplete={handleStep3Complete}
                            onBack={handleGoHome}
                            onNavigateToStep1={(h) => {
                                stateManager.setHierarchy(h);
                                stateManager.clearStepData(1);
                                setStep1Data(null);
                                navigate('/step1');
                            }}
                            onNavigateToStep2={async (h) => {
                                stateManager.setHierarchy(h);
                                const { data } = await fetchPageContent(h.subject, h.level, h.set, h.page);
                                if (data && data.content_data) {
                                    const spk = `${h.subject}-${h.level}-${h.set}-${h.page}`;
                                    const sk = `${h.subject}-${h.level}-${h.set}`;
                                    const session: Step2Session = {
                                        sessionId: `session-${Date.now()}`,
                                        timestamp: new Date().toISOString(),
                                        subject: h.subject as any,
                                        hierarchy: h,
                                        stacks: { [spk]: data.content_data.stacks || [] },
                                        resources: { [sk]: data.content_data.resources || [] },
                                        config: { viewMode: 'PAGE_EDITOR', hierarchy: h },
                                        validationStatus: { isValid: true, errors: [], warnings: [] }
                                    };
                                    setStep2Data(session);
                                    stateManager.setStep2Data(session);
                                }
                                navigate('/step2');
                            }}
                            classificationConfig={classificationConfig}
                        />
                    } />
                </Routes>
            </main>

            {/* 설정 모달 */}
            {showSettings && (
                <SettingsModal
                    engineModel={engineModel}
                    setEngineModel={setEngineModel}
                    geminiApiKey={geminiApiKey}
                    setGeminiApiKey={setGeminiApiKey}
                    totalCost={totalCost}
                    onClose={() => setShowSettings(false)}
                />
            )}
        </div>
    );
};

// ===== 홈 화면 컴포넌트 =====
interface HomeViewProps {
    isCategorySelected: boolean;
    pageDataExists: boolean | null;
    checkingPage: boolean;
    recommendedStep: number | null;
    isStep1Enabled: boolean;
    isStep2Enabled: boolean;
    isStep3Enabled: boolean;
    onStepClick: (id: number) => void;
    onSettingsClick: () => void;
}

const HomeView: React.FC<HomeViewProps> = ({
    isCategorySelected, pageDataExists, checkingPage,
    recommendedStep,
    isStep1Enabled, isStep2Enabled, isStep3Enabled,
    onStepClick, onSettingsClick
}) => {
    const stepCards = [
        {
            id: 1, label: "Let's collect", labelKo: '1단계',
            icon: 'fa-cloud-upload-alt',
            gradient: 'from-amber-400 to-orange-500',
            shadow: 'shadow-amber-200',
            enabled: isStep1Enabled,
            recommended: recommendedStep === 1
        },
        {
            id: 2, label: "Let's make", labelKo: '2단계',
            icon: 'fa-edit',
            gradient: 'from-blue-500 to-indigo-600',
            shadow: 'shadow-blue-200',
            enabled: isStep2Enabled,
            recommended: recommendedStep === 2
        },
        {
            id: 3, label: "Let's play", labelKo: '3단계',
            icon: 'fa-play',
            gradient: 'from-emerald-500 to-teal-600',
            shadow: 'shadow-emerald-200',
            enabled: isStep3Enabled,
            recommended: false
        }
    ];

    return (
        <div className="flex-1 flex flex-col px-5 py-6">
            {/* 상태 안내 */}
            {!isCategorySelected && (
                <div className="mb-5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <i className="fas fa-hand-point-up text-amber-500"></i>
                        상단에서 카테고리를 선택해주세요
                    </p>
                    <p className="text-xs text-amber-600 mt-1">PC에서 저장한 과목/패키지/북/페이지를 선택합니다.</p>
                </div>
            )}

            {isCategorySelected && checkingPage && (
                <div className="mb-5 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm font-medium text-slate-600">데이터 확인 중...</p>
                </div>
            )}

            {isCategorySelected && !checkingPage && pageDataExists === true && (
                <div className="mb-5 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-sm font-bold text-blue-800 flex items-center gap-2">
                        <i className="fas fa-database text-blue-500"></i>
                        기존 완성 페이지 — <span className="text-indigo-600">편집(Step 2)</span> 추천
                    </p>
                </div>
            )}

            {isCategorySelected && !checkingPage && pageDataExists === false && (
                <div className="mb-5 px-4 py-3 bg-orange-50 border border-orange-200 rounded-xl">
                    <p className="text-sm font-bold text-orange-800 flex items-center gap-2">
                        <i className="fas fa-plus-circle text-orange-500"></i>
                        신규 페이지 — <span className="text-amber-600">수집(Step 1)</span>부터 시작
                    </p>
                </div>
            )}

            {/* 카드 목록 */}
            <div className="flex-1 flex flex-col gap-4">
                {stepCards.map(card => (
                    <button
                        key={card.id}
                        onClick={() => onStepClick(card.id)}
                        disabled={!card.enabled}
                        className={cn(
                            'relative flex-1 min-h-[100px] rounded-2xl flex items-center justify-center transition-all duration-300',
                            card.enabled
                                ? `bg-gradient-to-br ${card.gradient} text-white shadow-xl ${card.shadow} active:scale-[0.98]`
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                            card.recommended && card.enabled && 'animate-pulse-subtle ring-4 ring-white/50'
                        )}
                    >
                        <div className="text-center">
                            <i className={cn('fas text-3xl mb-2', card.icon)}></i>
                            <p className="text-xl font-black tracking-wide">{card.label}</p>
                            <p className="text-xs font-bold opacity-80 mt-1">{card.labelKo}</p>
                        </div>

                        {/* 추천 뱃지 */}
                        {card.recommended && card.enabled && (
                            <div className="absolute top-3 right-3 px-2 py-1 bg-white/30 backdrop-blur rounded-full text-[10px] font-black uppercase tracking-wider">
                                추천
                            </div>
                        )}

                        {/* 비활성 오버레이 */}
                        {!card.enabled && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <i className="fas fa-lock text-slate-300 text-2xl"></i>
                            </div>
                        )}
                    </button>
                ))}
            </div>

            {/* 하단 설정 버튼 */}
            <div className="mt-6 flex justify-center">
                <button
                    onClick={onSettingsClick}
                    className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-xl shadow-indigo-200 flex items-center justify-center active:scale-95 transition-all"
                >
                    <i className="fas fa-plus text-xl"></i>
                </button>
            </div>
        </div>
    );
};

// ===== 설정 모달 =====
interface SettingsModalProps {
    engineModel: string;
    setEngineModel: (m: string) => void;
    geminiApiKey: string;
    setGeminiApiKey: (k: string) => void;
    totalCost: number;
    onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({
    engineModel, setEngineModel, geminiApiKey, setGeminiApiKey, totalCost, onClose
}) => {
    const models = [
        'gemini-3.0-pro-preview', 'gemini-3.0-flash-preview',
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
    ];

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-white rounded-t-3xl shadow-2xl max-h-[80vh] flex flex-col animate-slide-up"
                onClick={e => e.stopPropagation()}
            >
                {/* 핸들바 */}
                <div className="flex justify-center pt-3 pb-2">
                    <div className="w-10 h-1 bg-slate-300 rounded-full"></div>
                </div>

                <div className="px-5 pb-2 flex items-center justify-between">
                    <h3 className="text-lg font-black text-slate-900">설정</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                        <i className="fas fa-times text-sm"></i>
                    </button>
                </div>

                <div className="px-5 pb-6 space-y-5 overflow-y-auto flex-1">
                    {/* 비용 */}
                    <div className="bg-slate-50 rounded-xl p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm text-indigo-500">
                                <i className="fas fa-chart-line"></i>
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-400">Session Cost</p>
                                <p className="text-sm font-bold text-slate-700">현재 세션</p>
                            </div>
                        </div>
                        <p className="text-xl font-black text-slate-800">${totalCost.toFixed(5)}</p>
                    </div>

                    {/* API Key */}
                    <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                        <label className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-2">
                            <i className="fas fa-key text-xs"></i>
                            Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={geminiApiKey}
                            onChange={e => setGeminiApiKey(e.target.value)}
                            placeholder="API 키를 입력하세요"
                            className="w-full bg-white border border-amber-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 outline-none font-mono"
                        />
                    </div>

                    {/* 모델 선택 */}
                    <div>
                        <label className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                            <i className="fas fa-robot text-indigo-500 text-xs"></i>
                            AI 엔진 모델
                        </label>
                        <div className="space-y-2 mt-2">
                            {models.map(model => (
                                <label
                                    key={model}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                                        engineModel === model
                                            ? "bg-indigo-50 border-indigo-200"
                                            : "bg-white border-slate-100"
                                    )}
                                >
                                    <div className={cn(
                                        "w-4 h-4 rounded-full border flex items-center justify-center",
                                        engineModel === model ? "border-indigo-600 bg-indigo-600" : "border-slate-300"
                                    )}>
                                        {engineModel === model && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <span className={cn(
                                        "font-medium text-sm",
                                        engineModel === model ? "text-indigo-900" : "text-slate-600"
                                    )}>{model}</span>
                                    <input type="radio" name="model" value={model} checked={engineModel === model}
                                        onChange={e => setEngineModel(e.target.value)} className="hidden" />
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
