/**
 * =========================================
 * Metaon Instant Content Builder - Mobile
 * =========================================
 * Redesigned: Bright & Trendy UX (2026)
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

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            const { data } = await fetchStorageMap();
            if (data) setStorageMap(data);
            setLoading(false);
        };
        load();
    }, []);

    const subjectOptions = ['Hanja', 'Chinese', 'Japanese', 'English', 'Korean']
        .slice(0, classificationConfig.subjectCount || 5);

    const handleChange = (field: keyof PageHierarchy, value: string) => {
        const current = hierarchy || { subject: subjectOptions[0] || '', level: '1', set: '1', page: '1' };
        const updated = { ...current, [field]: value };
        onHierarchyChange(updated);
    };

    const h = hierarchy || { subject: subjectOptions[0] || '', level: '1', set: '1', page: '1' };

    const selectClass = "w-full h-10 px-3 text-sm font-semibold text-slate-800 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition-all cursor-pointer hover:border-slate-300 appearance-none";

    return (
        <div className="bg-white border-b border-slate-100 px-4 py-3">
            <div className="max-w-md mx-auto">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {/* Subject */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            {classificationConfig.subject || 'Subject'}
                        </label>
                        <select
                            value={h.subject}
                            onChange={e => handleChange('subject', e.target.value)}
                            disabled={loading}
                            className={selectClass}
                        >
                            {subjectOptions.map(s => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </div>

                    {/* Level */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            {classificationConfig.label1 || 'Package'}
                        </label>
                        <select
                            value={h.level}
                            onChange={e => handleChange('level', e.target.value)}
                            disabled={loading}
                            className={selectClass}
                        >
                            {Array.from({ length: classificationConfig.label1Count || 1 }, (_, i) => String(i + 1)).map(l => {
                                const exists = storageMap.some(m => m.subject === h.subject && m.level === l);
                                return (
                                    <option key={l} value={l}>
                                        {exists ? `${l} ●` : l}
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    {/* Set */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            {classificationConfig.label2 || 'Book'}
                        </label>
                        <select
                            value={h.set}
                            onChange={e => handleChange('set', e.target.value)}
                            disabled={loading}
                            className={selectClass}
                        >
                            {Array.from({ length: classificationConfig.label2Count || 1 }, (_, i) => String(i + 1)).map(sn => {
                                const exists = storageMap.some(m => m.subject === h.subject && m.level === h.level && m.set_num === sn);
                                return (
                                    <option key={sn} value={sn}>
                                        {exists ? `${sn} ●` : sn}
                                    </option>
                                );
                            })}
                        </select>
                    </div>

                    {/* Page */}
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                            {classificationConfig.label3 || 'Page'}
                        </label>
                        <select
                            value={h.page}
                            onChange={e => handleChange('page', e.target.value)}
                            disabled={loading}
                            className={selectClass}
                        >
                            {Array.from({ length: classificationConfig.label3Count || 1 }, (_, i) => String(i + 1)).map(pn => {
                                const exists = storageMap.some(m => m.subject === h.subject && m.level === h.level && m.set_num === h.set && m.page_num === pn);
                                return (
                                    <option key={pn} value={pn} style={{ fontWeight: exists ? '700' : '400' }}>
                                        {exists ? `${pn} ●` : pn}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ===== 메인 앱 컴포넌트 =====
const App: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

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

    const [pageDataExists, setPageDataExists] = useState<boolean | null>(null);
    const [checkingPage, setCheckingPage] = useState(false);
    const [step1Completed, setStep1Completed] = useState(false);
    const [isStep2Dirty, setIsStep2Dirty] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [totalCost, setTotalCost] = useState(0);

    const MODEL_RATES: Record<string, { input: number, output: number }> = {
        'gemini-2.5-pro': { input: 1.25, output: 3.75 },
        'gemini-2.5-flash': { input: 0.075, output: 0.30 },
        'gemini-2.5-flash-lite': { input: 0.0375, output: 0.15 }
    };

    const handleCostUpdate = useCallback((model: string, inputTokens: number, outputTokens: number) => {
        const actualModel = model.includes('gemini-1.5') || model.includes('gemini-2.0') ? 'gemini-2.5-flash' : model;
        const rates = MODEL_RATES[actualModel] || MODEL_RATES['gemini-2.5-flash'];
        const inputCost = (inputTokens / 1000000) * rates.input;
        const outputCost = (outputTokens / 1000000) * rates.output;
        setTotalCost(prev => prev + inputCost + outputCost);
    }, []);

    useEffect(() => {
        const path = location.pathname;
        if (path.includes('step1')) setCurrentView('step1');
        else if (path.includes('step2')) setCurrentView('step2');
        else if (path.includes('step3')) setCurrentView('step3');
        else setCurrentView('home');
    }, [location]);

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

    const handleHierarchyChange = useCallback((h: PageHierarchy) => {
        setHierarchy(h);
        setStep1Completed(false);
        if (h.subject && h.level && h.set && h.page) {
            stateManager.setHierarchy(h);
        }
    }, []);

    const isCategorySelected = !!(
        hierarchy?.subject && hierarchy?.level && hierarchy?.set && hierarchy?.page
    );

    const isStep1Enabled = isCategorySelected;
    const isStep2Enabled = isCategorySelected && (pageDataExists === true || step1Completed);
    const isStep3Enabled = isCategorySelected && pageDataExists === true;

    const recommendedStep = isCategorySelected
        ? (pageDataExists === true ? 2 : 1)
        : null;

    const handleStep1Complete = useCallback(async (data: Step1Output) => {
        const currentHierarchy = hierarchy || stateManager.getState().hierarchy;

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

    const handleStep2Update = useCallback((data: Step2Session) => {
        setStep2Data(data);
        stateManager.setStep2Data(data);
    }, []);

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

    const handleGoHome = useCallback(() => {
        if (currentView === 'step1' && step1Data) {
            if (!window.confirm('이동하시면 수집된 모든 데이터가 사라집니다.\n\n삭제후 이동하시겠습니까?')) {
                return;
            }
            setStep1Data(null);
        } else if (currentView === 'step2' && isStep2Dirty) {
            if (!window.confirm('이동하시면 편집된 모든 데이터가 사라집니다.\n(저장을 원하시면 저장버튼 누르신후 이동하세요)\n\n삭제후 이동하시겠습니까?')) {
                return;
            }
            setIsStep2Dirty(false);
        }
        navigate('/');
    }, [currentView, step1Data, isStep2Dirty, navigate]);

    const viewMeta = {
        home:  { title: 'Metaon ICB',    sub: 'Instant Builder',  stepLabel: null },
        step1: { title: "Let's collect", sub: 'Step 01 · Acquisition', stepLabel: '01' },
        step2: { title: "Let's make",    sub: 'Step 02 · Refinement',  stepLabel: '02' },
        step3: { title: "Let's play",    sub: 'Step 03 · Activity',    stepLabel: '03' },
    };
    const meta = viewMeta[currentView];

    return (
        <div className="min-h-screen flex flex-col" style={{ background: '#F8FAFF' }}>
            {!authState.isAuthenticated && <LoginOverlay />}

            {/* ── Header ── */}
            <header className="sticky top-0 z-50 bg-white border-b border-slate-100"
                style={{ boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.06)' }}>
                <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
                    {/* Left: back / logo */}
                    <div className="flex items-center gap-3">
                        {currentView !== 'home' ? (
                            <button
                                onClick={handleGoHome}
                                className="w-10 h-10 flex items-center justify-center text-slate-500 bg-slate-50 rounded-xl hover:bg-slate-100 transition-all active:scale-90 cursor-pointer"
                                aria-label="홈으로 돌아가기"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 18l-6-6 6-6"/>
                                </svg>
                            </button>
                        ) : (
                            <div className="w-10 h-10 rounded-xl step2-gradient flex items-center justify-center float-animation">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                                    <path d="M2 17l10 5 10-5"/>
                                    <path d="M2 12l10 5 10-5"/>
                                </svg>
                            </div>
                        )}
                        <div>
                            <h1 className="text-base font-bold text-slate-900 leading-none" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
                                {meta.title}
                            </h1>
                            <p className="text-[11px] font-semibold text-indigo-500 mt-0.5 leading-none">
                                {meta.sub}
                            </p>
                        </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-2">
                        {currentView === 'step1' && step1Data && (
                            <button
                                onClick={() => handleStep1Complete(step1Data)}
                                className="btn btn-step3 btn-sm"
                            >
                                Next
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M5 12h14M12 5l7 7-7 7"/>
                                </svg>
                            </button>
                        )}
                        {currentView === 'home' && (
                            <button
                                onClick={() => setShowSettings(true)}
                                className="w-10 h-10 flex items-center justify-center text-slate-400 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
                                aria-label="설정"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="3"/>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                </svg>
                            </button>
                        )}
                        <div id="step2-header-actions" className="flex items-center" />
                    </div>
                </div>
            </header>

            {/* ── Category Bar ── */}
            {authState.isAuthenticated && (
                <CategoryBar
                    hierarchy={hierarchy}
                    onHierarchyChange={handleHierarchyChange}
                    classificationConfig={classificationConfig}
                />
            )}

            {/* ── Main ── */}
            <main className="flex-1 flex flex-col">
                <Routes>
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
                        />
                    } />

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

                    <Route path="/step3" element={
                        <Step3Runtime
                            sessionData={step2Data}
                        />
                    } />
                </Routes>
            </main>

            {/* ── Settings Modal ── */}
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

// ===== 홈 화면 =====
interface HomeViewProps {
    isCategorySelected: boolean;
    pageDataExists: boolean | null;
    checkingPage: boolean;
    recommendedStep: number | null;
    isStep1Enabled: boolean;
    isStep2Enabled: boolean;
    isStep3Enabled: boolean;
    onStepClick: (id: number) => void;
}

const HomeView: React.FC<HomeViewProps> = ({
    isCategorySelected, pageDataExists, checkingPage,
    recommendedStep,
    isStep1Enabled, isStep2Enabled, isStep3Enabled,
    onStepClick
}) => {
    const steps = [
        {
            id: 1,
            label: 'Acquisition',
            labelKo: "Let's collect",
            desc: 'OCR 또는 직접 입력으로 학습 데이터 수집',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
            ),
            gradient: 'step1-gradient',
            shadowColor: 'rgba(249,115,22,0.25)',
            lightBg: '#FFF7ED',
            textColor: '#EA580C',
            enabled: isStep1Enabled,
            recommended: recommendedStep === 1
        },
        {
            id: 2,
            label: 'Refinement',
            labelKo: "Let's make",
            desc: 'AI로 이미지·음성 추가 및 액티비티 구성',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
            ),
            gradient: 'step2-gradient',
            shadowColor: 'rgba(99,102,241,0.25)',
            lightBg: '#EEF2FF',
            textColor: '#4F46E5',
            enabled: isStep2Enabled,
            recommended: recommendedStep === 2
        },
        {
            id: 3,
            label: 'Activity',
            labelKo: "Let's play",
            desc: '퀴즈·매칭·플래시카드 등 9가지 액티비티',
            icon: (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
            ),
            gradient: 'step3-gradient',
            shadowColor: 'rgba(20,184,166,0.25)',
            lightBg: '#F0FDFA',
            textColor: '#0D9488',
            enabled: isStep3Enabled,
            recommended: false
        }
    ];

    return (
        <div className="flex-1 max-w-md mx-auto w-full px-4 py-6 animate-fade-up">

            {/* Status Pills */}
            <div className="flex items-center gap-2 mb-6">
                <span className={cn(
                    'badge',
                    isCategorySelected ? 'badge-step3' : 'badge-warning'
                )}>
                    {isCategorySelected ? (
                        <>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="10"/>
                            </svg>
                            카테고리 선택됨
                        </>
                    ) : '카테고리를 선택하세요'}
                </span>

                {isCategorySelected && (
                    <span className={cn('badge', pageDataExists ? 'badge-primary' : 'badge-neutral')}>
                        {pageDataExists === null ? '확인 중...' : pageDataExists ? '데이터 있음' : '신규 페이지'}
                    </span>
                )}
            </div>

            {/* Hero Text */}
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900 leading-tight" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>
                    콘텐츠를 즉석에서<br />
                    <span className="text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(135deg, #6366F1, #8B5CF6)' }}>
                        만들어보세요
                    </span>
                </h2>
                <p className="text-slate-500 text-sm mt-1.5">기획부터 액티비티까지 3단계로 완성</p>
            </div>

            {/* Step Cards */}
            <div className="space-y-3">
                {steps.map((step) => (
                    <button
                        key={step.id}
                        onClick={() => onStepClick(step.id)}
                        disabled={!step.enabled}
                        className={cn(
                            'w-full text-left transition-all duration-200',
                            !step.enabled && 'opacity-40 pointer-events-none'
                        )}
                    >
                        <div className={cn(
                            'card-hover p-4 flex items-center gap-4',
                            step.recommended && 'ring-2 ring-indigo-200'
                        )}>
                            {/* Step Icon */}
                            <div
                                className={cn('flex items-center justify-center rounded-2xl shrink-0', step.gradient)}
                                style={{ width: 52, height: 52, boxShadow: `0 4px 14px ${step.shadowColor}` }}
                            >
                                {step.icon}
                            </div>

                            {/* Text */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: step.textColor }}>
                                        Step {String(step.id).padStart(2, '0')}
                                    </p>
                                    {step.recommended && (
                                        <span className="badge badge-primary text-[10px]">추천</span>
                                    )}
                                    {step.id === 2 && pageDataExists && (
                                        <span className="badge badge-success text-[10px]">저장됨</span>
                                    )}
                                </div>
                                <p className="font-bold text-slate-900 text-base leading-tight">{step.labelKo}</p>
                                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{step.desc}</p>
                            </div>

                            {/* Arrow */}
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-50 text-slate-400 shrink-0">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 18l6-6-6-6"/>
                                </svg>
                            </div>
                        </div>

                        {/* Recommended bar */}
                        {step.recommended && (
                            <div className={cn('h-0.5 rounded-b-2xl', step.gradient)} style={{ marginTop: -1 }} />
                        )}
                    </button>
                ))}
            </div>

            {/* Checking overlay */}
            {checkingPage && (
                <div className="fixed inset-0 bg-white/70 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white rounded-2xl px-6 py-5 flex items-center gap-4 shadow-card-lg">
                        <div className="spinner" />
                        <p className="font-semibold text-slate-700 text-sm">데이터 확인 중...</p>
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
        { id: 'gemini-2.5-pro', label: 'Pro', desc: '최고 품질, 고비용' },
        { id: 'gemini-2.5-flash', label: 'Flash', desc: '균형 잡힌 속도/품질' },
        { id: 'gemini-2.5-flash-lite', label: 'Flash Lite', desc: '빠르고 저렴' },
    ];

    return (
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center px-4 pb-4"
            style={{ background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(6px)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg bg-white rounded-2xl shadow-card-lg max-h-[85vh] flex flex-col animate-slide-up overflow-hidden"
                style={{ boxShadow: '0 25px 50px -12px rgba(0,0,0,0.18)' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                    <div>
                        <h3 className="font-bold text-slate-900 text-lg" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>환경 설정</h3>
                        <p className="text-xs text-slate-400 mt-0.5">API 키 및 AI 엔진 설정</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 flex items-center justify-center text-slate-400 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <div className="px-6 py-5 space-y-6 overflow-y-auto flex-1">
                    {/* Usage Card */}
                    <div className="flex items-center gap-4 p-4 bg-step3-50 rounded-xl border border-step3-100">
                        <div className="w-10 h-10 step3-gradient rounded-xl flex items-center justify-center">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="1" x2="12" y2="23"/>
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                            </svg>
                        </div>
                        <div className="flex-1">
                            <p className="text-xs font-bold text-step3-600 uppercase tracking-wide">세션 비용</p>
                            <p className="text-xl font-bold text-slate-900">${totalCost.toFixed(5)}</p>
                        </div>
                    </div>

                    {/* API Key */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                            Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={geminiApiKey}
                            onChange={e => setGeminiApiKey(e.target.value)}
                            placeholder="API 키를 입력하세요..."
                            className="input-field"
                        />
                    </div>

                    {/* Model Selection */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                            AI 엔진 모델
                        </label>
                        <div className="space-y-2">
                            {models.map(model => (
                                <button
                                    key={model.id}
                                    onClick={() => setEngineModel(model.id)}
                                    className={cn(
                                        'w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all duration-150 cursor-pointer',
                                        engineModel === model.id
                                            ? 'border-indigo-400 bg-indigo-50'
                                            : 'border-slate-100 bg-white hover:border-slate-200'
                                    )}
                                >
                                    <div className="text-left">
                                        <p className={cn('font-bold text-sm', engineModel === model.id ? 'text-indigo-700' : 'text-slate-700')}>
                                            {model.label}
                                        </p>
                                        <p className="text-xs text-slate-400 mt-0.5">{model.id}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400">{model.desc}</span>
                                        {engineModel === model.id && (
                                            <div className="w-5 h-5 step2-gradient rounded-full flex items-center justify-center">
                                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                    <polyline points="20 6 9 17 4 12"/>
                                                </svg>
                                            </div>
                                        )}
                                    </div>
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
