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

    // classificationConfig 기반 전체 옵션 생성 (Step3와 동일 방식)
    const subjectOptions = ['Hanja', 'Chinese', 'Japanese', 'English', 'Korean']
        .slice(0, classificationConfig.subjectCount || 5);

    const handleChange = (field: keyof PageHierarchy, value: string) => {
        const current = hierarchy || { subject: subjectOptions[0] || '', level: '1', set: '1', page: '1' };
        const updated = { ...current, [field]: value };
        onHierarchyChange(updated);
    };

    // 현재 hierarchy 값 (기본값 포함)
    const h = hierarchy || { subject: subjectOptions[0] || '', level: '1', set: '1', page: '1' };

    return (
        <div className="bg-white border-b border-slate-200 px-4 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {/* Subject */}
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {classificationConfig.subject || 'Subject'}
                    </label>
                    <select
                        value={h.subject}
                        onChange={e => handleChange('subject', e.target.value)}
                        disabled={loading}
                        className="w-full h-10 px-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                    >
                        {subjectOptions.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>

                {/* Level / Package */}
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {classificationConfig.label1 || 'Package'}
                    </label>
                    <select
                        value={h.level}
                        onChange={e => handleChange('level', e.target.value)}
                        disabled={loading}
                        className="w-full h-10 px-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                    >
                        {Array.from({ length: classificationConfig.label1Count || 1 }, (_, i) => String(i + 1)).map(l => {
                            const exists = storageMap.some(m => m.subject === h.subject && m.level === l);
                            return <option key={l} value={l} style={{ color: exists ? '#ef4444' : 'inherit' }}>{l}{exists ? ' (data)' : ''}</option>;
                        })}
                    </select>
                </div>

                {/* Set / Book */}
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {classificationConfig.label2 || 'Book'}
                    </label>
                    <select
                        value={h.set}
                        onChange={e => handleChange('set', e.target.value)}
                        disabled={loading}
                        className="w-full h-10 px-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                    >
                        {Array.from({ length: classificationConfig.label2Count || 1 }, (_, i) => String(i + 1)).map(sn => {
                            const exists = storageMap.some(m => m.subject === h.subject && m.level === h.level && m.set_num === sn);
                            return <option key={sn} value={sn} style={{ color: exists ? '#ef4444' : 'inherit' }}>{sn}{exists ? ' (data)' : ''}</option>;
                        })}
                    </select>
                </div>

                {/* Page */}
                <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                        {classificationConfig.label3 || 'Page'}
                    </label>
                    <select
                        value={h.page}
                        onChange={e => handleChange('page', e.target.value)}
                        disabled={loading}
                        className="w-full h-10 px-2 text-sm font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all"
                    >
                        {Array.from({ length: classificationConfig.label3Count || 1 }, (_, i) => String(i + 1)).map(pn => {
                            const exists = storageMap.some(m => m.subject === h.subject && m.level === h.level && m.set_num === h.set && m.page_num === pn);
                            return <option key={pn} value={pn} style={{ color: exists ? '#ef4444' : 'inherit', fontWeight: exists ? 'bold' : 'normal' }}>{pn}{exists ? ' ●' : ''}</option>;
                        })}
                    </select>
                </div>
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

    // Step2 미저장 편집 여부
    const [isStep2Dirty, setIsStep2Dirty] = useState(false);

    // 설정 모달
    const [showSettings, setShowSettings] = useState(false);

    // 비용 추적
    const [totalCost, setTotalCost] = useState(0);
    const MODEL_RATES: Record<string, { input: number, output: number }> = {
        'gemini-2.5-pro': { input: 1.25, output: 3.75 },
        'gemini-2.5-flash': { input: 0.075, output: 0.30 },
        'gemini-2.5-flash-lite': { input: 0.0375, output: 0.15 }
    };

    const handleCostUpdate = useCallback((model: string, inputTokens: number, outputTokens: number) => {
        const rates = MODEL_RATES[model] || MODEL_RATES['gemini-1.5-flash'];
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

    // 카테고리 변경 시 데이터 존재 여부 확인 + step2/step3에서 자동 데이터 로드
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
                const exists = !!(data && data.content_data);
                setPageDataExists(exists);

                // Step2 또는 Step3 뷰에서 카테고리 변경 시: DB 데이터 자동 로드하여 step2Data 갱신
                // 단, Step1을 방금 완료한 경우(step1Completed)는 덮어쓰지 않음
                if ((currentView === 'step2' || currentView === 'step3') && !step1Completed) {
                    if (exists) {
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
                    } else {
                        // 데이터 없는 페이지로 변경 시 → 빈 세션으로 갱신 (hierarchy만 갱신)
                        const emptySession: Step2Session = {
                            sessionId: `session-${Date.now()}`,
                            timestamp: new Date().toISOString(),
                            subject: hierarchy.subject as any,
                            hierarchy,
                            stacks: {},
                            resources: {},
                            config: { viewMode: 'ASSET_POOL', hierarchy },
                            validationStatus: { isValid: true, errors: [], warnings: [] }
                        };
                        setStep2Data(emptySession);
                        stateManager.setStep2Data(emptySession);
                    }
                }
            } catch {
                setPageDataExists(null);
            }
            setCheckingPage(false);
        };
        checkPageData();
    }, [hierarchy?.subject, hierarchy?.level, hierarchy?.set, hierarchy?.page, currentView]);

    // hierarchy를 전역에 동기화
    const handleHierarchyChange = useCallback((h: PageHierarchy) => {
        setHierarchy(h);
        // [FIX] 계층이 변경되면 Step 1 신규 수집 데이터의 '최초 진입' 상태를 해제함
        // 이를 통해 다른 페이지로 이동 시 DB 데이터를 정상적으로 불러올 수 있게 함
        setStep1Completed(false);

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

    // Step 2 업데이트 핸들러 (메모이제이션)
    const handleStep2Update = useCallback((data: Step2Session) => {
        setStep2Data(data);
        stateManager.setStep2Data(data);
    }, []);

    /*
    const handleStep3Complete = useCallback((data: Step3ActivityBundle) => {
        setStep3Data(data);
        stateManager.setStep3Data(data);
    }, []);
    */

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

    // 뒤로가기 (스텝 → 홈) + 경고창
    const handleGoHome = useCallback(() => {
        if (currentView === 'step1' && step1Data) {
            // Step1: 데이터가 있으면 경고
            if (!window.confirm('이동하시면 수집된 모든 데이터가 사라집니다.\n\n삭제후 이동하시겠습니까?')) {
                return; // 취소
            }
            setStep1Data(null);
        } else if (currentView === 'step2' && isStep2Dirty) {
            // Step2: 미저장 상태면 경고
            if (!window.confirm('이동하시면 편집된 모든 데이터가 사라집니다.\n(저장을 원하시면 저장버튼 누르신후 이동하세요)\n\n삭제후 이동하시겠습니까?')) {
                return; // 취소
            }
            setIsStep2Dirty(false);
        }
        navigate('/');
    }, [currentView, step1Data, isStep2Dirty, navigate]);

    // ===== 렌더링 =====
    return (
        <div className="min-h-screen flex flex-col relative overflow-x-hidden">
            {/* 배경 장식 (Tiimo Style) */}
            <div className="tiimo-bg-circle w-[400px] h-[400px] -top-20 -left-20" />
            <div className="tiimo-bg-circle w-[300px] h-[300px] bottom-40 -right-20 !bg-[#FFB3A1]" />

            {!authState.isAuthenticated && <LoginOverlay />}

            {/* 상단 헤더 */}
            <header className="sticky top-0 z-50 px-4 py-4 backdrop-blur-3xl border-b border-[#E0D7FF]/30">
                <div className="max-w-md mx-auto flex items-center justify-between">
                    {/* 로고 / 뒤로가기 */}
                    <div className="flex items-center gap-4">
                        {currentView !== 'home' ? (
                            <button
                                onClick={handleGoHome}
                                className="w-12 h-12 flex items-center justify-center text-[#9B87F5] bg-[#E0D7FF]/40 rounded-2xl hover:bg-[#E0D7FF]/60 transition-all active:scale-90"
                            >
                                <i className="fas fa-chevron-left text-xl"></i>
                            </button>
                        ) : (
                            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#9B87F5] to-[#8170FF] flex items-center justify-center shadow-lg shadow-indigo-100 float-animation">
                                <i className="fas fa-smile-beam text-white text-2xl"></i>
                            </div>
                        )}
                        <div>
                            <h1 className="text-xl font-serif text-[#2D2D2D] tracking-tight leading-none">
                                {currentView === 'home' ? 'Metaon ICB' :
                                    currentView === 'step1' ? "Let's collect" :
                                        currentView === 'step2' ? "Let's make" : "Let's play"}
                            </h1>
                            <p className="text-[11px] font-black text-[#9B87F5] uppercase tracking-[0.1em] mt-1">
                                {currentView === 'home' ? 'Instant Builder' :
                                    currentView === 'step1' ? 'Step 01' :
                                        currentView === 'step2' ? 'Step 02' : 'Step 03'}
                            </p>
                        </div>
                    </div>

                    {/* 우측 액션 */}
                    <div className="flex items-center">
                        {currentView === 'step1' && step1Data && (
                            <button
                                onClick={() => handleStep1Complete(step1Data)}
                                className="px-6 py-2.5 rounded-full bg-[#E6FFFA] text-[#4FD1C5] font-black text-sm hover:bg-[#D4FFF5] transition-all shaodw-sm"
                            >
                                Next →
                            </button>
                        )}
                        <div id="step2-header-actions" className="flex items-center"></div>
                    </div>
                </div>
            </header>

            {/* 카테고리 바 (Tiimo 스타일로 정규화) */}
            {authState.isAuthenticated && (
                <div className="px-4 py-2">
                    <div className="max-w-md mx-auto">
                        <CategoryBar
                            hierarchy={hierarchy}
                            onHierarchyChange={handleHierarchyChange}
                            classificationConfig={classificationConfig}
                        />
                    </div>
                </div>
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
                            initialData={step1Completed ? step1Data : null}
                            workingSession={step2Data}
                            onComplete={handleStep2Complete}
                            onUpdate={handleStep2Update}
                            geminiApiKey={geminiApiKey}
                            classificationConfig={classificationConfig}
                            onDirtyChange={setIsStep2Dirty}
                        />
                    } />

                    {/* Step 3 */}
                    <Route path="/step3" element={
                        <Step3Runtime
                            sessionData={step2Data}
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
            id: 1, label: "Acquisition", labelKo: "Let's collect",
            icon: 'fa-magic',
            bg: '#FFEFE6',
            color: '#FF9E85',
            enabled: isStep1Enabled,
            recommended: recommendedStep === 1
        },
        {
            id: 2, label: "Refinement", labelKo: "Let's make",
            icon: 'fa-wand-magic-sparkles',
            bg: '#E0D7FF',
            color: '#9B87F5',
            enabled: isStep2Enabled,
            recommended: recommendedStep === 2
        },
        {
            id: 3, label: "Activity", labelKo: "Let's play",
            icon: 'fa-gamepad',
            bg: '#E6FFFA',
            color: '#4FD1C5',
            enabled: isStep3Enabled,
            recommended: false
        }
    ];

    return (
        <div className="flex-1 px-5 py-8 animate-fade-in flex flex-col gap-8">
            {/* 현재 상태 인디케이터 (Subtle Status) */}
            <div className="flex items-center gap-3">
                <div className={cn(
                    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                    isCategorySelected ? "bg-[#E6FFFA] text-[#4FD1C5]" : "bg-amber-50 text-amber-500 animate-pulse"
                )}>
                    {isCategorySelected ? "Category Selected" : "Select Category"}
                </div>
                {isCategorySelected && (
                    <div className={cn(
                        "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                        pageDataExists ? "bg-[#E0D7FF] text-[#9B87F5]" : "bg-slate-50 text-slate-400"
                    )}>
                        {pageDataExists ? "Data Exists" : "New Page"}
                    </div>
                )}
            </div>

            {/* 환영 인사 */}
            <div className="pt-4">
                <h2 className="text-3xl font-serif text-[#2D2D2D] leading-[1.2]">
                    Ready to create<br />
                    <span className="text-[#9B87F5]">magic content?</span>
                </h2>
                <p className="text-slate-400 mt-2 font-bold text-sm">기획부터 액티비티까지 즉석에서!</p>
            </div>

            {/* 단계별 카드 그리드 */}
            <div className="flex flex-col gap-5">
                {stepCards.map((step) => (
                    <button
                        key={step.id}
                        onClick={() => onStepClick(step.id)}
                        disabled={!step.enabled}
                        className={cn(
                            "group relative card !p-0 overflow-hidden flex flex-col transition-all duration-500",
                            !step.enabled && "opacity-40 grayscale pointer-events-none",
                            step.recommended && "ring-4 ring-[#9B87F5]/20"
                        )}
                    >
                        <div className="flex items-center p-6 gap-5">
                            {/* 아이콘 영역 */}
                            <div
                                className="w-16 h-16 rounded-[1.5rem] flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-95 shadow-sm"
                                style={{ backgroundColor: step.bg, color: step.color }}
                            >
                                <i className={cn("fas text-2xl", step.icon)}></i>
                            </div>

                            {/* 텍스트 영역 */}
                            <div className="text-left">
                                <h3 className="text-xl font-serif text-[#2D2D2D] group-hover:text-[#9B87F5] transition-colors">
                                    {step.labelKo}
                                </h3>
                                <p className="text-xs font-black tracking-widest uppercase opacity-40 mt-1">
                                    {step.label}
                                </p>
                            </div>

                            {/* 화살표 가이드 */}
                            <div className="ml-auto w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:text-[#9B87F5] group-hover:bg-white transition-all">
                                <i className="fas fa-chevron-right"></i>
                            </div>
                        </div>

                        {/* 하단 미세 데코선 */}
                        {step.recommended && (
                            <div className="h-1 w-full bg-[#9B87F5] animate-shimmer" />
                        )}
                    </button>
                ))}
            </div>

            {/* 하단 설정 안내 */}
            <button
                onClick={onSettingsClick}
                className="mt-4 flex items-center justify-center gap-3 p-5 rounded-[2rem] bg-slate-50/50 border border-slate-100 text-slate-400 hover:text-[#9B87F5] transition-all font-bold text-sm"
            >
                <i className="fas fa-cog"></i>
                환경 설정 및 API 키 관리
            </button>

            {/* 로딩 표시 */}
            {checkingPage && (
                <div className="fixed inset-0 bg-white/60 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 border-4 border-[#E0D7FF] border-t-[#9B87F5] rounded-full animate-spin"></div>
                        <p className="font-serif text-[#9B87F5] font-bold">Checking magic...</p>
                    </div>
                </div>
            )}
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
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
    ];

    return (
        <div className="fixed inset-0 z-[100] bg-[#2D2D2D]/60 backdrop-blur-sm flex items-end justify-center px-4" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-white rounded-[3rem] shadow-2xl max-h-[85vh] flex flex-col animate-slide-up mb-8"
                onClick={e => e.stopPropagation()}
            >
                {/* 헤더 */}
                <div className="px-8 pt-8 pb-4 flex items-center justify-between">
                    <div>
                        <h3 className="text-2xl font-serif text-[#2D2D2D]">Settings</h3>
                        <p className="text-xs font-black text-[#9B87F5] uppercase tracking-widest mt-1">Config & Usage</p>
                    </div>
                    <button onClick={onClose} className="w-12 h-12 rounded-full bg-[#E0D7FF]/40 text-[#9B87F5] flex items-center justify-center hover:bg-[#E0D7FF]/60 transition-all">
                        <i className="fas fa-times text-lg"></i>
                    </button>
                </div>

                <div className="px-8 pb-10 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                    {/* 비용 요약 카드 */}
                    <div className="bg-[#E6FFFA] rounded-[2rem] p-6 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm text-[#4FD1C5]">
                                <i className="fas fa-coins text-2xl"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-[#4FD1C5] uppercase tracking-wider">Session Usage</p>
                                <p className="text-base font-bold text-[#2D2D2D]">현재 세션 비용</p>
                            </div>
                        </div>
                        <p className="text-2xl font-serif text-[#2D2D2D]">${totalCost.toFixed(5)}</p>
                    </div>

                    {/* API Key 입력 */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">
                            <i className="fas fa-key text-[10px]"></i>
                            Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={geminiApiKey}
                            onChange={e => setGeminiApiKey(e.target.value)}
                            placeholder="Entrez votre API key..."
                            className="input-field"
                        />
                    </div>

                    {/* 엔진 모델 선택 */}
                    <div>
                        <label className="flex items-center gap-2 text-sm font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">
                            <i className="fas fa-brain text-[10px]"></i>
                            AI Engine Model
                        </label>
                        <div className="grid grid-cols-1 gap-3">
                            {models.map(model => (
                                <button
                                    key={model}
                                    onClick={() => setEngineModel(model)}
                                    className={cn(
                                        "flex items-center justify-between p-5 rounded-[1.5rem] border-2 transition-all duration-300",
                                        engineModel === model
                                            ? "bg-[#E0D7FF]/30 border-[#9B87F5] ring-4 ring-[#9B87F5]/5"
                                            : "bg-white border-slate-50 hover:border-[#E0D7FF]"
                                    )}
                                >
                                    <span className={cn(
                                        "font-bold text-sm",
                                        engineModel === model ? "text-[#9B87F5]" : "text-slate-500"
                                    )}>{model}</span>
                                    {engineModel === model && (
                                        <div className="w-6 h-6 rounded-full bg-[#9B87F5] flex items-center justify-center text-white text-[10px]">
                                            <i className="fas fa-check"></i>
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;
