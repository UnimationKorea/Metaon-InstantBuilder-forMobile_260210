/**
 * =========================================
 * 메타온 인스턴트 수업자료 생성 시스템
 * Metaon Instant Content Builder (MICB)
 * =========================================
 * 3단계 모듈화 아키텍처 기반 메인 애플리케이션
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
    cn,
    LoginOverlay
} from '@/shared';

// 스텝 정보
const STEPS = [
    { id: 1, path: '/step1', label: '원고 수집', icon: 'fa-cloud-upload-alt', color: 'amber' },
    { id: 2, path: '/step2', label: '데이터 편집', icon: 'fa-edit', color: 'blue' },
    { id: 3, path: '/step3', label: '액티비티 런타임', icon: 'fa-play', color: 'emerald' }
];

const App: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    // 전역 상태
    const [currentStep, setCurrentStep] = useState(1);
    const [step1Data, setStep1Data] = useState<Step1Output | null>(null);
    const [step2Data, setStep2Data] = useState<Step2Session | null>(null);
    const [step3Data, setStep3Data] = useState<Step3ActivityBundle | null>(null);
    const [classificationConfig, setClassificationConfig] = useState<ClassificationConfig>(
        stateManager.getState().classificationConfig
    );
    const [geminiApiKey, setGeminiApiKey] = useState<string>(
        stateManager.getState().geminiApiKey || ''
    );
    const [showCompletionModal, setShowCompletionModal] = useState(false);
    const [showHelp, setShowHelp] = useState(false);

    // 카테고리 미설정 여부 판단 (DEFAULT_CLASSIFICATION과 동일하면 미설정)
    const isDefaultConfig = (
        classificationConfig.subject === 'Subject' &&
        classificationConfig.label1 === 'Package' &&
        classificationConfig.label2 === 'Book' &&
        classificationConfig.label3 === 'Page'
    );

    // URL에서 현재 스텝 파악
    useEffect(() => {
        const path = location.pathname;
        if (path.includes('step1')) setCurrentStep(1);
        else if (path.includes('step2')) setCurrentStep(2);
        else if (path.includes('step3')) setCurrentStep(3);
        else {
            navigate('/step3');
        }
    }, [location, navigate]);

    // 페이지 이탈 경고 전역 처리
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '나가면 모든 데이터가 소실 될 수 있습니다.';
            return e.returnValue;
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, []);

    // 상태 변경 구독
    useEffect(() => {
        const unsubscribe = stateManager.subscribe((state) => {
            // [FIX] currentStep은 URL 기반으로만 동기화 (52-60라인)
            // stateManager 구독에서 currentStep 제외하여 네비게이션 바 불일치 방지
            setStep1Data(state.step1Data);
            setStep2Data(state.step2Data);
            setStep3Data(state.step3Data);
            setClassificationConfig(state.classificationConfig);
            setGeminiApiKey(state.geminiApiKey || '');
            // API 키 유무에 따른 모델 선택 로직 (기타 모델 선택 로직이 있다면 보완 필요)
            if (state.geminiApiKey && !engineModel.includes('gemini')) {
                setEngineModel('gemini-2.0-flash-exp');
            }
            setAuthState({ ...state.auth });
        });
        return () => unsubscribe();
    }, []);

    // Step 1 완료 핸들러
    const handleStep1Complete = useCallback(async (data: Step1Output) => {
        // [CMS] 현재 작업 위치에 기존 데이터가 있는지 확인
        // [FIX] 전역 hierarchy를 우선 참조하여 Step 3 -> Step 1 이동 시에도 위치 정보 유지
        const currentHierarchy = stateManager.getState().hierarchy ||
            stateManager.getState().step2Data?.hierarchy ||
            stateManager.getState().step2Data?.config?.hierarchy;

        if (currentHierarchy) {
            try {
                const { data: existingData } = await fetchPageContent(
                    currentHierarchy.subject,
                    currentHierarchy.level,
                    currentHierarchy.set,
                    currentHierarchy.page
                );

                if (existingData && existingData.content_data) {
                    const confirmed = window.confirm(
                        `[⚠️ 경고]\n\n${currentHierarchy.subject} ${currentHierarchy.level}-${currentHierarchy.set} Set - ${currentHierarchy.page} Page 위치에\n이미 저장된 데이터가 있습니다.\n\n계속 진행하면 기존 데이터가 삭제되고\n현재 입력한 내용으로 덮어씌워집니다.\n\n진행하시겠습니까?`
                    );
                    if (!confirmed) {
                        return; // 사용자가 취소하면 Step 2로 이동하지 않음
                    }
                }
            } catch (err) {
                console.error('[CMS] Data check failed:', err);
                // 조회 실패 시에도 진행은 허용
            }
        }

        setStep1Data(data);
        stateManager.setStep1Data(data);

        // [FIX] Step2 세션을 명시적으로 생성하여 hierarchy를 전달
        // currentHierarchy가 있으면 그 위치로 저장되도록 Step2Session 갱신
        if (currentHierarchy) {
            const setPageKey = `${currentHierarchy.subject}-${currentHierarchy.level}-${currentHierarchy.set}-${currentHierarchy.page}`;
            const setKey = `${currentHierarchy.subject}-${currentHierarchy.level}-${currentHierarchy.set}`;

            // 기존 세션이 있으면 resources/stacks 유지, 없으면 빈 객체
            const existingSession = stateManager.getState().step2Data;
            const newSession: Step2Session = {
                sessionId: existingSession?.sessionId || `session-${Date.now()}`,
                timestamp: new Date().toISOString(),
                subject: currentHierarchy.subject as any,
                hierarchy: currentHierarchy,
                stacks: existingSession?.stacks || {},
                resources: existingSession?.resources || {},
                config: {
                    viewMode: 'ASSET_POOL',
                    hierarchy: currentHierarchy
                },
                validationStatus: { isValid: true, errors: [], warnings: [] }
            };
            console.log('[CMS] Creating Step2 session with hierarchy:', currentHierarchy);
            console.log('[CMS] Expected setPageKey:', setPageKey, 'setKey:', setKey);
            setStep2Data(newSession);
            stateManager.setStep2Data(newSession);
        }

        setCurrentStep(2);

        // [중요] 스텝 전환 시 즉시 DB 동기화하여 복구 지점 확보
        saveAppState().catch(err => console.error('Auto save failed:', err));

        navigate('/step2');
    }, [navigate]);

    // Step 2 완료 핸들러
    const handleStep2Complete = useCallback((data: Step2Session) => {
        setStep2Data(data);
        stateManager.setStep2Data(data);
        setCurrentStep(3);

        // [중요] 스텝 전환 시 즉시 DB 동기화하여 복구 지점 확보
        saveAppState().catch(err => console.error('Auto save failed:', err));

        navigate('/step3');
    }, [navigate]);

    // Step 3 완료 핸들러
    const handleStep3Complete = useCallback((data: Step3ActivityBundle) => {
        setStep3Data(data);
        stateManager.setStep3Data(data);
        setShowCompletionModal(true);
    }, []);

    // 새로운 세션 시작
    const handleNewSession = () => {
        setStep1Data(null);
        setStep2Data(null);
        setStep3Data(null);
        setShowCompletionModal(false);
        stateManager.reset();
        setCurrentStep(1);
        navigate('/step1');
    };

    // [CMS] Step 3 -> Step 1 (신규 입력)
    const handleNavigateToStep1FromStep3 = useCallback((targetHierarchy: PageHierarchy) => {
        // 위치 정보만 유지하고 데이터 초기화
        stateManager.setHierarchy(targetHierarchy);
        stateManager.clearStepData(1);
        // [FIX] Step 2 세션을 null로 설정하지 않고, hierarchy만 포함한 최소 세션을 유지
        const minimalSession: Step2Session = {
            sessionId: `session-${Date.now()}`,
            timestamp: new Date().toISOString(),
            subject: targetHierarchy.subject as any,
            hierarchy: targetHierarchy,
            stacks: {},
            resources: {},
            config: {
                viewMode: 'ASSET_POOL',
                hierarchy: targetHierarchy
            },
            validationStatus: { isValid: true, errors: [], warnings: [] }
        };
        setStep2Data(minimalSession);
        stateManager.setStep2Data(minimalSession);
        setStep1Data(null);
        setCurrentStep(1);
        navigate('/step1');
    }, [navigate]);

    // [CMS] Step 3 -> Step 2 (편집) - DB 데이터 자동 로드
    const handleNavigateToStep2FromStep3 = useCallback(async (targetHierarchy: PageHierarchy) => {
        // 1. hierarchy 설정
        stateManager.setHierarchy(targetHierarchy);

        // 2. DB에서 해당 페이지 데이터 조회
        const { data, error } = await fetchPageContent(
            targetHierarchy.subject,
            targetHierarchy.level,
            targetHierarchy.set,
            targetHierarchy.page
        );

        // 3. 데이터가 있으면 Step2 세션으로 복원
        if (data && data.content_data) {
            const contentData = data.content_data;
            const setPageKey = `${targetHierarchy.subject}-${targetHierarchy.level}-${targetHierarchy.set}-${targetHierarchy.page}`;
            const setKey = `${targetHierarchy.subject}-${targetHierarchy.level}-${targetHierarchy.set}`;

            const session: Step2Session = {
                sessionId: `session-${Date.now()}`,
                timestamp: new Date().toISOString(),
                subject: targetHierarchy.subject as any,
                hierarchy: targetHierarchy,
                stacks: { [setPageKey]: contentData.stacks || [] },
                resources: { [setKey]: contentData.resources || [] },
                config: {
                    viewMode: 'PAGE_EDITOR',
                    hierarchy: targetHierarchy
                },
                validationStatus: { isValid: true, errors: [], warnings: [] }
            };
            setStep2Data(session);
            stateManager.setStep2Data(session);
            console.log('[CMS] Loaded page data from DB:', targetHierarchy);
            console.log(`[CMS] Restored stacks for key: ${setPageKey} (count: ${session.stacks[setPageKey].length})`);
            console.log(`[CMS] Restored resources for key: ${setKey} (count: ${session.resources[setKey].length})`);
        } else {
            // 데이터가 없으면 빈 세션으로 시작
            console.warn('[CMS] No data found for page:', targetHierarchy, error);
            const emptySession: Step2Session = {
                sessionId: `session-${Date.now()}`,
                timestamp: new Date().toISOString(),
                subject: targetHierarchy.subject as any,
                hierarchy: targetHierarchy,
                stacks: {},
                resources: {},
                config: {
                    viewMode: 'PAGE_EDITOR',
                    hierarchy: targetHierarchy
                },
                validationStatus: { isValid: true, errors: [], warnings: [] }
            };
            setStep2Data(emptySession);
            stateManager.setStep2Data(emptySession);
        }

        // 4. Step 2로 이동
        setCurrentStep(2);
        navigate('/step2');
    }, [navigate]);

    // [FIX] 네비게이션 클릭 시 데이터 존재 여부에 따라 분기
    const handleNavigateToStep = useCallback(async (targetStep: number) => {
        const currentHierarchy = stateManager.getState().hierarchy;

        if (targetStep === 2 && currentHierarchy) {
            // Step 2 클릭 시: 데이터 존재 여부 확인
            const { data } = await fetchPageContent(
                currentHierarchy.subject,
                currentHierarchy.level,
                currentHierarchy.set,
                currentHierarchy.page
            );

            if (!data || !data.content_data) {
                // 데이터가 없으면 Step 1으로 리다이렉트
                alert(`${currentHierarchy.subject} ${currentHierarchy.level}-${currentHierarchy.set}-${currentHierarchy.page} 페이지에 저장된 데이터가 없습니다.\n\n먼저 [원고 수집] 단계에서 데이터를 입력해주세요.`);
                setCurrentStep(1);
                navigate('/step1');
                return;
            }
            // 데이터가 있으면 Step 2로 이동
            await handleNavigateToStep2FromStep3(currentHierarchy);
        } else if (targetStep === 1) {
            setCurrentStep(1);
            navigate('/step1');
        } else if (targetStep === 3) {
            setCurrentStep(3);
            navigate('/step3');
        } else {
            // 기본 동작
            setCurrentStep(targetStep);
            navigate(`/step${targetStep}`);
        }
    }, [navigate, handleNavigateToStep2FromStep3]);

    // 스텝 색상 가져오기
    const getStepColorClasses = (step: { color: string }) => {
        const colors: Record<string, { bg: string; text: string; border: string; shadow: string; ring: string }> = {
            amber: {
                bg: 'bg-gradient-to-br from-amber-500 to-orange-600',
                text: 'text-amber-600',
                border: 'border-amber-300',
                shadow: 'shadow-amber-200',
                ring: 'ring-amber-400'
            },
            blue: {
                bg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
                text: 'text-blue-600',
                border: 'border-blue-300',
                shadow: 'shadow-blue-200',
                ring: 'ring-blue-400'
            },
            emerald: {
                bg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
                text: 'text-emerald-600',
                border: 'border-emerald-300',
                shadow: 'shadow-emerald-200',
                ring: 'ring-emerald-400'
            }
        };
        return colors[step.color] || colors.blue;
    };

    // 설정 상태
    const [showSettings, setShowSettings] = useState(false);
    const [engineModel, setEngineModel] = useState('gemini-2.5-flash');
    const [availableModels, setAvailableModels] = useState<string[]>([
        'gemini-3.0-pro-preview',
        'gemini-3.0-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite'
    ]);
    const [supabaseUrl, setSupabaseUrl] = useState(stateManager.getState().supabaseConfig.url || '');
    const [supabaseAnonKey, setSupabaseAnonKey] = useState(stateManager.getState().supabaseConfig.anonKey || '');
    // 비용 추적 상태
    const [totalCost, setTotalCost] = useState(0);

    // 모델별 요금표 (1M 토큰 당 비용, USD 기준 - 2026 추정치)
    const MODEL_RATES: Record<string, { time: number, input: number, output: number }> = {
        'gemini-3.0-pro-preview': { time: 0, input: 2.50, output: 10.00 },
        'gemini-3.0-flash-preview': { time: 0, input: 0.15, output: 0.60 },
        'gemini-2.5-pro': { time: 0, input: 1.25, output: 3.75 },
        'gemini-2.5-flash': { time: 0, input: 0.075, output: 0.30 },
        'gemini-2.5-flash-lite': { time: 0, input: 0.04, output: 0.16 }
    };

    const [authState, setAuthState] = useState(stateManager.getState().auth);

    // 비용 업데이트 핸들러 (Step 1에서 호출)
    const handleCostUpdate = useCallback((model: string, inputTokens: number, outputTokens: number) => {
        const rates = MODEL_RATES[model] || MODEL_RATES['gemini-2.5-flash'];
        const inputCost = (inputTokens / 1000000) * rates.input;
        const outputCost = (outputTokens / 1000000) * rates.output;
        setTotalCost(prev => prev + inputCost + outputCost);
    }, []);

    const [newModelInput, setNewModelInput] = useState('');

    // 모델 추가 핸들러
    const handleAddModel = () => {
        if (newModelInput && !availableModels.includes(newModelInput)) {
            setAvailableModels([...availableModels, newModelInput]);
            setNewModelInput('');
        }
    };

    // ... (rest of the state)

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex flex-col">
            {!authState.isAuthenticated && <LoginOverlay />}
            {/* 헤더 - 모바일: 2행(1행 로고+액션, 2행 스텝네비), 데스크톱: 1행 */}
            <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/50 px-3 sm:px-8 py-2 sm:py-3 sticky top-0 z-50 shadow-sm">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
                    {/* 1행: 로고 + 우측 액션 */}
                    <div className="flex items-center justify-between sm:justify-start sm:gap-4 shrink-0">
                        {/* 로고 */}
                        <div className="flex items-center gap-2 sm:gap-4">
                            <div className="relative">
                                <div className="w-9 h-9 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-200">
                                    <i className="fas fa-rocket text-white text-base sm:text-xl"></i>
                                </div>
                                <div className="absolute -bottom-1 -right-1 w-3 h-3 sm:w-4 sm:h-4 bg-emerald-500 rounded-full border-2 border-white animate-pulse"></div>
                            </div>
                            <div className="hidden sm:block">
                                <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none">
                                    Metaon ICB
                                </h1>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">
                                    Instant Content Builder
                                </p>
                            </div>
                        </div>

                        {/* 우측 액션 (모바일: 1행 우측, 데스크톱: 헤더 우측) */}
                        <div className="flex items-center gap-1 sm:hidden">
                            {authState.isAuthenticated && (
                                <button
                                    onClick={() => {
                                        if (confirm('로그아웃 하시겠습니까?')) {
                                            stateManager.logout();
                                            navigate('/step3');
                                        }
                                    }}
                                    className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-rose-500 rounded-xl transition-all"
                                    title="로그아웃"
                                >
                                    <i className="fas fa-sign-out-alt text-sm"></i>
                                </button>
                            )}
                            <button
                                onClick={() => setShowSettings(true)}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-indigo-600 rounded-xl transition-all"
                            >
                                <i className="fas fa-cog text-sm"></i>
                            </button>
                            <button
                                onClick={handleNewSession}
                                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-xl transition-all"
                            >
                                <i className="fas fa-redo text-sm"></i>
                            </button>
                        </div>
                    </div>

                    {/* 2행 (모바일) / 중앙 (데스크톱): 스텝 네비게이션 */}
                    <nav className="flex items-center gap-0 sm:gap-2 bg-slate-100 p-1 sm:p-1.5 rounded-xl sm:rounded-2xl w-full sm:w-auto">
                        {STEPS.map((step, idx) => {
                            const colorClasses = getStepColorClasses(step);
                            const isActive = currentStep === step.id;
                            const isCompleted = currentStep > step.id;
                            const isAccessible = authState.isAuthenticated;

                            // 다음에 눌러야 할 스텝인지 판단
                            const isNextStep = isAccessible && !isActive && (
                                (currentStep === 1 && step.id === 2 && !!step1Data) ||
                                (currentStep === 2 && step.id === 3 && !!step2Data)
                            );

                            return (
                                <React.Fragment key={step.id}>
                                    <button
                                        onClick={() => handleNavigateToStep(step.id)}
                                        disabled={!isAccessible}
                                        className={cn(
                                            'relative flex-1 sm:flex-initial flex items-center justify-center sm:justify-start gap-1.5 sm:gap-2 min-h-[44px] px-2 sm:px-5 py-2.5 rounded-lg sm:rounded-xl font-bold text-[11px] sm:text-sm transition-all duration-300 whitespace-nowrap',
                                            isActive && `${colorClasses.bg} text-white shadow-lg ${colorClasses.shadow}`,
                                            isNextStep && `bg-white ${colorClasses.text} shadow-md ring-2 ${colorClasses.ring} animate-pulse-subtle`,
                                            !isActive && !isNextStep && isAccessible && `bg-white ${colorClasses.text} shadow-sm active:scale-95`,
                                            !isActive && !isAccessible && 'text-slate-300 cursor-not-allowed'
                                        )}
                                    >
                                        <i className={cn(
                                            'fas text-sm',
                                            isCompleted && !isActive ? 'fa-check-circle' : step.icon
                                        )}></i>
                                        <span className="hidden sm:inline">{step.label}</span>
                                        <span className="sm:hidden text-[10px]">{step.label.split(' ').pop()}</span>
                                    </button>

                                    {idx < STEPS.length - 1 && (
                                        <div className={cn(
                                            'hidden sm:block w-8 h-0.5 rounded-full transition-all duration-300',
                                            isCompleted ? colorClasses.bg : 'bg-slate-200'
                                        )}></div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </nav>

                    {/* 우측 액션 - 데스크톱 전용 */}
                    <div className="hidden sm:flex items-center gap-3 shrink-0">
                        {authState.isAuthenticated && (
                            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-xl border border-slate-200">
                                <i className="fas fa-user-circle text-slate-400 text-sm"></i>
                                <span className="text-[11px] font-black text-slate-600">{authState.userId}</span>
                                <div className="w-px h-3 bg-slate-200 mx-1"></div>
                                <button
                                    onClick={() => {
                                        if (confirm('로그아웃 하시겠습니까? 작업 중인 내용은 마지막 저장 시점까지만 유지됩니다.')) {
                                            stateManager.logout();
                                            navigate('/step3');
                                        }
                                    }}
                                    className="min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 text-xs font-bold text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all px-2"
                                    title="로그아웃"
                                >
                                    <i className="fas fa-sign-out-alt text-[10px]"></i>
                                    <span>LOGOUT</span>
                                </button>
                            </div>
                        )}
                        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100">
                            <i className="fas fa-robot text-indigo-500 text-xs"></i>
                            <span className="text-xs font-bold text-indigo-700">{engineModel}</span>
                        </div>
                        <button
                            onClick={() => setShowHelp(true)}
                            className="tooltip min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-xl transition-all"
                            data-tooltip="현재 페이지의 사용법을 확인합니다"
                        >
                            <i className="fas fa-question-circle text-sm"></i>
                        </button>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="tooltip min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-all"
                            data-tooltip="API 키, AI 모델, 분류 체계 설정"
                        >
                            <i className="fas fa-cog text-sm"></i>
                        </button>
                        <button
                            onClick={handleNewSession}
                            className="tooltip min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all"
                            data-tooltip="현재 작업을 초기화하고 새로 시작"
                        >
                            <i className="fas fa-redo text-sm"></i>
                        </button>
                    </div>
                </div>
            </header>

            {/* 초기 설정 가이드 배너 */}
            {authState.isAuthenticated && isDefaultConfig && (
                <div className="max-w-7xl mx-auto px-3 sm:px-8 pt-4 sm:pt-6">
                    <div className="guide-banner flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-2 border-amber-200 rounded-xl sm:rounded-2xl animate-slide-down shadow-sm">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white flex-shrink-0 shadow-lg shadow-amber-200">
                            <i className="fas fa-lightbulb text-lg"></i>
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-bold text-amber-900">
                                <i className="fas fa-hand-point-right mr-1 text-amber-500"></i>
                                처음 사용하시나요? 먼저 <strong>설정</strong>에서 콘텐츠 분류 체계(과목, 레벨, 세트, 페이지)를 설정해주세요.
                            </p>
                            <p className="text-xs text-amber-600 mt-1">
                                분류 체계를 설정하면 이 안내는 자동으로 사라집니다.
                            </p>
                        </div>
                        <button
                            onClick={() => setShowSettings(true)}
                            className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-amber-200 hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 flex-shrink-0"
                        >
                            <i className="fas fa-cog"></i>
                            설정으로 이동
                        </button>
                    </div>
                </div>
            )}

            {/* 메인 콘텐츠 */}
            <main className="flex-1 px-3 sm:px-8 py-5 sm:py-10 max-w-7xl mx-auto w-full">
                <Routes>
                    <Route
                        path="/"
                        element={
                            <Step3Runtime
                                sessionData={step2Data}
                                onComplete={handleStep3Complete}
                                onBack={async () => {
                                    const currentHierarchy = stateManager.getState().hierarchy;
                                    if (currentHierarchy) {
                                        const { data } = await fetchPageContent(
                                            currentHierarchy.subject,
                                            currentHierarchy.level,
                                            currentHierarchy.set,
                                            currentHierarchy.page
                                        );
                                        if (data && data.content_data) {
                                            await handleNavigateToStep2FromStep3(currentHierarchy);
                                        } else {
                                            handleNavigateToStep1FromStep3(currentHierarchy);
                                        }
                                    } else {
                                        setCurrentStep(2);
                                        navigate('/step2');
                                    }
                                }}
                                onNavigateToStep1={handleNavigateToStep1FromStep3}
                                onNavigateToStep2={handleNavigateToStep2FromStep3}
                                classificationConfig={classificationConfig}
                            />
                        }
                    />
                    <Route
                        path="/step1"
                        element={
                            <Step1Acquisition
                                initialData={step1Data}
                                onComplete={handleStep1Complete}
                                onUpdate={setStep1Data}
                                engineModel={engineModel}
                                geminiApiKey={geminiApiKey}
                                onCostUpdate={handleCostUpdate}
                            />
                        }
                    />
                    <Route
                        path="/step2"
                        element={
                            <Step2Refinement
                                initialData={step1Data}
                                workingSession={step2Data}
                                onComplete={handleStep2Complete}
                                onUpdate={setStep2Data}
                                onBack={() => {
                                    setCurrentStep(1);
                                    navigate('/step1');
                                }}
                                engineModel={engineModel}
                                geminiApiKey={geminiApiKey}
                                classificationConfig={classificationConfig}
                            />
                        }
                    />
                    <Route
                        path="/step3"
                        element={
                            <Step3Runtime
                                sessionData={step2Data}
                                onComplete={handleStep3Complete}
                                onBack={async () => {
                                    // [FIX] 현재 선택된 페이지의 데이터 존재 여부에 따라 분기
                                    const currentHierarchy = stateManager.getState().hierarchy;
                                    if (currentHierarchy) {
                                        const { data } = await fetchPageContent(
                                            currentHierarchy.subject,
                                            currentHierarchy.level,
                                            currentHierarchy.set,
                                            currentHierarchy.page
                                        );
                                        if (data && data.content_data) {
                                            // 데이터가 있으면 Step 2로 이동
                                            await handleNavigateToStep2FromStep3(currentHierarchy);
                                        } else {
                                            // 데이터가 없으면 Step 1으로 이동
                                            handleNavigateToStep1FromStep3(currentHierarchy);
                                        }
                                    } else {
                                        // hierarchy가 없으면 기본 동작
                                        setCurrentStep(2);
                                        navigate('/step2');
                                    }
                                }}
                                onNavigateToStep1={handleNavigateToStep1FromStep3}
                                onNavigateToStep2={handleNavigateToStep2FromStep3}
                                classificationConfig={classificationConfig}
                            />
                        }
                    />
                </Routes>
            </main>

            {/* 푸터 */}
            <footer className="bg-white/50 border-t border-slate-100 py-4 px-8">
                <div className="max-w-7xl mx-auto flex items-center justify-between text-sm text-slate-400">
                    <p className="font-medium">
                        © 2026 Metaon Instant Content Builder. <span className="text-[10px] ml-2 px-1.5 py-0.5 bg-slate-100 rounded text-slate-400">v1.3.0-cms-ready</span>
                    </p>
                    <p className="font-bold">
                        Powered by <span className="text-indigo-500">Gemini AI</span>
                    </p>
                </div>
            </footer>

            {/* 설정 모달 */}
            {showSettings && (
                <div className="modal-overlay">
                    <div className="modal-content max-w-lg max-h-[90vh] flex flex-col">
                        <div className="modal-header">
                            <h3 className="text-xl font-bold text-slate-900">시스템 설정</h3>
                            <button
                                onClick={() => setShowSettings(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center transition-colors"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-6 space-y-6 overflow-y-auto flex-1 custom-scrollbar">
                            {/* 비용 현황 패널 */}
                            <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-2xl p-5 border border-slate-200 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm text-indigo-500">
                                            <i className="fas fa-chart-line"></i>
                                        </div>
                                        <div>
                                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Session Cost</h4>
                                            <p className="text-sm font-bold text-slate-700">현재 세션 현황</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-2xl font-black text-slate-800 tracking-tight">${totalCost.toFixed(5)}</p>
                                        <p className="text-[10px] font-medium text-slate-400">Estimated Total</p>
                                    </div>
                                </div>
                            </div>

                            {/* 메인 설정 섹션 */}
                            <div className="space-y-6">
                                {/* API Key 설정 */}
                                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                                    <label className="flex items-center gap-2 text-sm font-bold text-amber-800 mb-3">
                                        <i className="fas fa-key text-xs"></i>
                                        <span>Gemini API Key</span>
                                    </label>
                                    <input
                                        type="password"
                                        value={geminiApiKey}
                                        onChange={(e) => {
                                            setGeminiApiKey(e.target.value);
                                        }}
                                        placeholder="API 키를 입력하세요 (VITE_GEMINI_API_KEY)"
                                        className="w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-amber-500/20 outline-none transition-all font-mono"
                                    />
                                    <p className="text-[10px] text-amber-600/70 mt-2 font-medium">
                                        * 환경 변수가 설정되어 있지 않은 경우 여기서 직접 입력할 수 있습니다.
                                    </p>
                                </div>

                                {/* 모델 선택 */}
                                <div>
                                    <label className="flex items-center justify-between text-sm font-bold text-slate-700 mb-3">
                                        <span className="flex items-center gap-2">
                                            <i className="fas fa-robot text-indigo-500 text-xs"></i>
                                            AI 엔진 모델
                                        </span>
                                        <span className="text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Active</span>
                                    </label>
                                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                                        {availableModels.map(model => (
                                            <label
                                                key={model}
                                                className={cn(
                                                    "flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all duration-200 group",
                                                    engineModel === model
                                                        ? "bg-indigo-50/50 border-indigo-200 shadow-sm"
                                                        : "bg-white border-slate-100 hover:bg-slate-50 hover:border-slate-200"
                                                )}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={cn(
                                                        "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                                                        engineModel === model ? "border-indigo-600 bg-indigo-600" : "border-slate-300 bg-white group-hover:border-slate-400"
                                                    )}>
                                                        {engineModel === model && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                                    </div>
                                                    <span className={cn(
                                                        "font-medium text-sm",
                                                        engineModel === model ? "text-indigo-900" : "text-slate-600"
                                                    )}>{model}</span>
                                                </div>
                                                {engineModel === model && <i className="fas fa-check text-indigo-500 text-sm"></i>}
                                                <input
                                                    type="radio"
                                                    name="engineModel"
                                                    value={model}
                                                    checked={engineModel === model}
                                                    onChange={(e) => setEngineModel(e.target.value)}
                                                    className="hidden"
                                                />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* 모델 추가 */}
                                <div className="pt-4 border-t border-slate-100">
                                    <label className="block text-xs font-bold text-slate-500 mb-2">
                                        커스텀 모델 추가
                                    </label>
                                    <div className="flex gap-2">
                                        <div className="flex-1 relative">
                                            <i className="fas fa-plus absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                            <input
                                                type="text"
                                                value={newModelInput}
                                                onChange={(e) => setNewModelInput(e.target.value)}
                                                placeholder="gemini-1.5-pro-exp"
                                                className="w-full bg-slate-50 border border-slate-100 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                            />
                                        </div>
                                        <button
                                            onClick={handleAddModel}
                                            disabled={!newModelInput}
                                            className="px-5 py-2.5 bg-slate-800 text-white rounded-xl font-bold text-xs hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>

                                {/* 분류 레이블 설정 */}
                                <div className="pt-4 border-t border-slate-100">
                                    <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-4">
                                        <i className="fas fa-tags text-indigo-500 text-xs"></i>
                                        <span>콘텐츠 분류 체계 설정</span>
                                    </label>
                                    <div className="space-y-4">
                                        {/* Row: Subject */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">과목 레이블 (Subject)</label>
                                                <input
                                                    type="text"
                                                    value={classificationConfig.subject}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, subject: e.target.value };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    placeholder="Subject"
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1 text-right">갯수</label>
                                                <input
                                                    type="number"
                                                    value={classificationConfig.subjectCount}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, subjectCount: parseInt(e.target.value) || 0 };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm text-right outline-none transition-all focus:bg-white focus:border-indigo-300"
                                                />
                                            </div>
                                        </div>

                                        {/* Row: Label 1 */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">분류 1 (Level)</label>
                                                <input
                                                    type="text"
                                                    value={classificationConfig.label1}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label1: e.target.value };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    placeholder="Package"
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1 text-right">갯수</label>
                                                <input
                                                    type="number"
                                                    value={classificationConfig.label1Count}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label1Count: parseInt(e.target.value) || 0 };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm text-right outline-none transition-all focus:bg-white focus:border-indigo-300"
                                                />
                                            </div>
                                        </div>

                                        {/* Row: Label 2 */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">분류 2 (Set)</label>
                                                <input
                                                    type="text"
                                                    value={classificationConfig.label2}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label2: e.target.value };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    placeholder="Book"
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1 text-right">갯수</label>
                                                <input
                                                    type="number"
                                                    value={classificationConfig.label2Count}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label2Count: parseInt(e.target.value) || 0 };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm text-right outline-none transition-all focus:bg-white focus:border-indigo-300"
                                                />
                                            </div>
                                        </div>

                                        {/* Row: Label 3 */}
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">분류 3 (Page)</label>
                                                <input
                                                    type="text"
                                                    value={classificationConfig.label3}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label3: e.target.value };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    placeholder="Page"
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-indigo-300 outline-none transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1 text-right">갯수</label>
                                                <input
                                                    type="number"
                                                    value={classificationConfig.label3Count}
                                                    onChange={(e) => {
                                                        const newConfig = { ...classificationConfig, label3Count: parseInt(e.target.value) || 0 };
                                                        setClassificationConfig(newConfig);
                                                    }}
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm text-right outline-none transition-all focus:bg-white focus:border-indigo-300"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-3 font-medium px-1">
                                        * 각 단계별 레이블 명칭과 생성할 옵션의 갯수를 지정할 수 있습니다.
                                    </p>

                                    {/* Supabase 설정 섹션 */}
                                    <div className="pt-6 mt-6 border-t border-slate-100">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                                                <i className="fas fa-database text-emerald-600 text-xs"></i>
                                            </div>
                                            <h4 className="text-sm font-black text-slate-700">Supabase 연동 설정 (배포용)</h4>
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">Supabase Project URL</label>
                                                <input
                                                    type="text"
                                                    value={supabaseUrl}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setSupabaseUrl(val);
                                                        stateManager.setSupabaseConfig(val, supabaseAnonKey);
                                                    }}
                                                    placeholder="https://your-project.supabase.co"
                                                    className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-emerald-300 outline-none transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1 px-1">Anon Key (API Key)</label>
                                                <div className="relative">
                                                    <input
                                                        type="password"
                                                        value={supabaseAnonKey}
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setSupabaseAnonKey(val);
                                                            stateManager.setSupabaseConfig(supabaseUrl, val);
                                                        }}
                                                        placeholder="eyJhbGciOi..."
                                                        className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm focus:bg-white focus:border-emerald-300 outline-none transition-all font-mono"
                                                    />
                                                    <div className="absolute top-2.5 right-4 pointer-events-none">
                                                        <i className="fas fa-key text-slate-300"></i>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-slate-400 mt-2 px-1">
                                                    <i className="fas fa-info-circle mr-1 text-amber-500"></i>
                                                    Vercel 환경 변수가 등록되지 않은 경우 위 정보를 수동 입력하여 DB를 활성화할 수 있습니다.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 flex justify-end shrink-0">
                            <button
                                onClick={() => {
                                    stateManager.setGeminiApiKey(geminiApiKey);
                                    stateManager.setClassificationConfig(classificationConfig);
                                    setShowSettings(false);
                                }}
                                className="btn-primary"
                            >
                                저장 및 적용
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 헬프 모달 */}
            {showHelp && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}>
                    <div className="modal-content max-w-2xl max-h-[85vh] flex flex-col">
                        <div className="modal-header">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-100">
                                    <i className="fas fa-question"></i>
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-900">
                                        {currentStep === 1 ? '원고 수집' : currentStep === 2 ? '데이터 편집' : '액티비티 런타임'} 사용법
                                    </h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Step {currentStep} Guide</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowHelp(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center transition-colors"
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                            {currentStep === 1 && (
                                <div className="space-y-6">
                                    <div className="help-step-card">
                                        <div className="help-step-number">1</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">파일 업로드 또는 직접 입력</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                PDF 또는 이미지 파일을 드래그하여 올리거나, '직접 입력' 탭에서 학습 데이터를 수동으로 입력하세요.
                                                지원 형식: PDF, PNG, JPG, JPEG, WEBP
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">2</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">AI OCR 분석</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                파일을 업로드하면 Gemini AI가 자동으로 텍스트를 추출하고, 단어와 문장을 분류하며, 발음(병음/후리가나)과 번역을 생성합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">3</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">결과 확인 및 편집</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                추출된 결과를 확인하고, 필요 시 수정하세요. 고유 세트(추출 단어, 관련 단어, 추출 문장, 관련 문장)를 확인할 수 있습니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">4</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">다음 단계로 진행</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                '다음 단계로' 버튼을 클릭하면 데이터가 Step 2(데이터 편집)로 전달됩니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                                        <p className="text-xs font-bold text-indigo-700 flex items-center gap-2">
                                            <i className="fas fa-info-circle"></i>
                                            Tip: 직접 입력 모드에서는 단어/문장별로 이미지와 오디오도 첨부할 수 있습니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                            {currentStep === 2 && (
                                <div className="space-y-6">
                                    <div className="help-step-card">
                                        <div className="help-step-number">1</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">저장 위치 선택</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                상단의 계층 선택기(Subject → Level → Set → Page)에서 데이터를 저장할 위치를 지정하세요.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">2</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">리소스 편집</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                각 리소스 카드에서 텍스트, 발음, 번역을 편집할 수 있습니다. 슬래시(/)로 텍스트를 분절하면 학습 단위가 분리됩니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">3</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">AI 보강 (이미지/오디오)</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                각 리소스 카드의 AI 버튼을 클릭하면 이미지 자동 생성, TTS 음성 생성, AI 스마트 분절 기능을 사용할 수 있습니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">4</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">스택 구성</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                리소스를 스택으로 구성하고, 각 스택에 액티비티 유형(퀴즈, 매칭 게임, 플래시카드 등)을 지정하세요.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">5</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">DB 저장 및 다음 단계</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                '임시 DB 저장'으로 중간 결과를 저장하거나, '다음 단계로' 버튼을 클릭하여 Step 3(액티비티 런타임)으로 이동하세요.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                                        <p className="text-xs font-bold text-indigo-700 flex items-center gap-2">
                                            <i className="fas fa-info-circle"></i>
                                            Tip: CSV/JSON 다운로드 기능으로 데이터를 외부 백업할 수 있습니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                            {currentStep === 3 && (
                                <div className="space-y-6">
                                    <div className="help-step-card">
                                        <div className="help-step-number">1</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">계층 네비게이션</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                상단 네비게이션에서 Subject, Level, Set, Page를 선택하여 원하는 콘텐츠 위치로 이동하세요.
                                                빨간색(data) 표시는 해당 위치에 이미 데이터가 있음을 의미합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">2</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">편집 / 신규 입력</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                선택한 페이지에 데이터가 있으면 <strong>'편집'</strong> 버튼이, 없으면 <strong>'신규 입력'</strong> 버튼이 나타납니다.
                                                클릭하면 해당 단계(Step 2 또는 Step 1)로 바로 이동합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">3</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">액티비티 테스트</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                각 액티비티 옆의 '테스트' 버튼을 클릭하면 샌드박스에서 미리보기 할 수 있습니다.
                                                난이도(쉬움/보통/어려움)도 조절 가능합니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="help-step-card">
                                        <div className="help-step-number">4</div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 mb-1">메타온 배포</h4>
                                            <p className="text-sm text-slate-500 leading-relaxed">
                                                '메타온에 배포하기' 버튼을 클릭하면 모든 액티비티가 메타온 플랫폼에 동기화됩니다.
                                                '임시 DB 저장' 버튼으로 중간 결과를 먼저 저장할 수도 있습니다.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                                        <p className="text-xs font-bold text-emerald-700 flex items-center gap-2">
                                            <i className="fas fa-info-circle"></i>
                                            Tip: 이 페이지는 로그인 후 기본 화면입니다. 여기서 모든 콘텐츠를 탐색하고 관리할 수 있습니다.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-slate-100 flex justify-end shrink-0">
                            <button
                                onClick={() => setShowHelp(false)}
                                className="btn-primary text-sm"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 완료 모달 */}
            {showCompletionModal && step3Data && (
                <div className="modal-overlay">
                    <div className="modal-content max-w-lg">
                        <div className="p-10 text-center">
                            {/* 성공 아이콘 */}
                            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-200 animate-bounce-subtle">
                                <i className="fas fa-check text-white text-4xl"></i>
                            </div>

                            <h2 className="text-3xl font-black text-slate-900 mb-2">
                                배포 완료! 🎉
                            </h2>
                            <p className="text-slate-500 font-medium mb-8">
                                {step3Data.activities.length}개의 액티비티가 메타온에 성공적으로 배포되었습니다.
                            </p>

                            {/* 요약 정보 */}
                            <div className="bg-slate-50 rounded-2xl p-6 mb-8">
                                <div className="grid grid-cols-2 gap-4 text-left">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">번들 ID</p>
                                        <p className="text-sm font-bold text-slate-700 truncate">{step3Data.bundleId}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">타임스탬프</p>
                                        <p className="text-sm font-bold text-slate-700">{new Date(step3Data.timestamp).toLocaleString('ko-KR')}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">대상 커리큘럼</p>
                                        <p className="text-sm font-bold text-slate-700">{step3Data.metaonIntegration.targetCurriculum}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">액티비티 수</p>
                                        <p className="text-sm font-bold text-emerald-600">{step3Data.activities.length}개</p>
                                    </div>
                                </div>
                            </div>

                            {/* 액션 버튼 */}
                            <div className="flex gap-4 justify-center">
                                <button
                                    onClick={() => {
                                        // 메타온 대시보드로 이동 (시뮬레이션)
                                        window.open('https://metaon.example.com/dashboard', '_blank');
                                    }}
                                    className="btn-secondary"
                                >
                                    <i className="fas fa-external-link-alt mr-2"></i>
                                    메타온에서 보기
                                </button>
                                <button
                                    onClick={handleNewSession}
                                    className="btn-primary"
                                >
                                    <i className="fas fa-plus mr-2"></i>
                                    새 콘텐츠 생성
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
