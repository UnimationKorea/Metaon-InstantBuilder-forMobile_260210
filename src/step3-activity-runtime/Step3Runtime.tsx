/**
 * =========================================
 * Step 3: 액티비티 런타임 모듈 (Activity Engine & Sandbox)
 * =========================================
 * 메타온 액티비티 선택 및 샌드박스 실행
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Step2Session,
    Step3ActivityBundle,
    ActivityConfig,
    ActivityInstance,
    ActivityType,
    ResourceData,
    PageHierarchy,
    ClassificationConfig,
    DEFAULT_CLASSIFICATION,
    ACTIVITY_TYPES,
    generateId,
    getTimestamp,
    cn,
    saveAppState,
    stateManager,
    fetchStorageMap,
    fetchPageContent
} from '@/shared';

interface Step3RuntimeProps {
    sessionData: Step2Session | null;
    onComplete: (data: Step3ActivityBundle) => void;
    onBack?: () => void;
    onNavigateToStep1?: (hierarchy: PageHierarchy) => void; // 신규 입력
    onNavigateToStep2?: (hierarchy: PageHierarchy) => void; // 편집
    classificationConfig?: ClassificationConfig;
}

export const Step3Runtime: React.FC<Step3RuntimeProps> = ({
    sessionData,
    onComplete,
    onBack,
    onNavigateToStep1,
    onNavigateToStep2,
    classificationConfig = DEFAULT_CLASSIFICATION
}) => {
    // 전역 계층 상태 (stateManager에서 초기화)
    const [hierarchy, setHierarchy] = useState<PageHierarchy>(
        sessionData?.hierarchy || stateManager.getState().hierarchy
    );

    // CMS 저장 맵 (DB에 저장된 페이지 목록)
    const [storageMap, setStorageMap] = useState<any[]>([]);
    const [isLoadingMap, setIsLoadingMap] = useState(true);

    // 로컬 세션 데이터 (계층 변경 시 DB에서 로드)
    const [localSessionData, setLocalSessionData] = useState<Step2Session | null>(sessionData);
    const [isLoadingPageData, setIsLoadingPageData] = useState(false);

    // 현재 페이지의 데이터 존재 여부
    const hasDataForCurrentPage = useMemo(() => {
        return storageMap.some(m =>
            m.subject === hierarchy.subject &&
            m.level === hierarchy.level &&
            m.set_num === hierarchy.set &&
            m.page_num === hierarchy.page
        );
    }, [storageMap, hierarchy]);

    // 상태
    const [selectedActivities, setSelectedActivities] = useState<ActivityConfig[]>([]);
    const [activeInstance, setActiveInstance] = useState<ActivityInstance | null>(null);
    const [, setIsRunning] = useState(false);
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [tempSyncStatus, setTempSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [previewMode, setPreviewMode] = useState(false);

    // 초기 로드: 저장 맵 가져오기
    useEffect(() => {
        (async () => {
            setIsLoadingMap(true);
            const { data } = await fetchStorageMap();
            if (data) setStorageMap(data);
            setIsLoadingMap(false);
        })();
    }, []);

    // 계층 변경 시 전역 상태 동기화 + DB에서 해당 페이지 데이터 자동 로드
    useEffect(() => {
        stateManager.setHierarchy(hierarchy);

        // DB에서 해당 페이지 데이터 가져오기
        (async () => {
            setIsLoadingPageData(true);
            try {
                const { data } = await fetchPageContent(
                    hierarchy.subject,
                    hierarchy.level,
                    hierarchy.set,
                    hierarchy.page
                );
                if (data && data.content_data) {
                    // DB의 content_data는 { stacks: [...], resources: [...] } 형태 (배열)
                    // Step2Session은 { stacks: { "key": [...] }, resources: { "key": [...] } } 형태 (맵)
                    // App.tsx와 동일한 변환 로직 적용
                    const contentData = data.content_data;
                    const setPageKey = `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}-${hierarchy.page}`;
                    const setKey = `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}`;

                    const dbSession: Step2Session = {
                        sessionId: `session-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        subject: hierarchy.subject as any,
                        hierarchy: hierarchy,
                        stacks: { [setPageKey]: contentData.stacks || [] },
                        resources: { [setKey]: contentData.resources || [] },
                        config: {
                            viewMode: 'PAGE_EDITOR',
                            hierarchy: hierarchy
                        },
                        validationStatus: { isValid: true, errors: [], warnings: [] }
                    };
                    console.log(`[Step3] Loaded page data from DB. stacks count: ${(contentData.stacks || []).length}, resources count: ${(contentData.resources || []).length}`);
                    setLocalSessionData(dbSession);
                } else {
                    // 데이터 없으면 null로 초기화
                    setLocalSessionData(null);
                }
            } catch (err) {
                console.error('페이지 데이터 로드 실패:', err);
                setLocalSessionData(null);
            }
            setIsLoadingPageData(false);
        })();
    }, [hierarchy.subject, hierarchy.level, hierarchy.set, hierarchy.page]);

    // 계층 변경 핸들러
    const handleHierarchyChange = useCallback((newH: Partial<PageHierarchy>) => {
        setHierarchy(prev => ({ ...prev, ...newH }));
    }, []);

    // iframe ref - 향후 실제 샌드박스 구현 시 사용 예정
    // const sandboxRef = useRef<HTMLIFrameElement>(null);

    // 현재 페이지 고유 키 추출 (로컬 hierarchy 사용)
    const currentKey = `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}-${hierarchy.page}`;

    // 활용 가능한 데이터 수집 (localSessionData 사용)
    const allStacksArray = localSessionData ? Object.values(localSessionData.stacks).flat() : [];
    const availableData: ResourceData[] = allStacksArray.flatMap(stack => stack.items);
    const currentStacks = localSessionData?.stacks?.[currentKey] || [];

    // [변경] 로컬 세션 데이터 변경 시 스택 정보로 액티비티 초기화
    React.useEffect(() => {
        if (localSessionData && localSessionData.stacks) {
            const activities = currentStacks.map(stack => {
                const activityInfo = ACTIVITY_TYPES.find(a => a.id === stack.activityType);
                return {
                    id: stack.id,
                    type: stack.activityType,
                    title: activityInfo?.label || stack.activityType,
                    description: '',
                    timeLimit: 300,
                    shuffleItems: true,
                    showHints: false,
                    difficultyLevel: 1
                } as ActivityConfig;
            });
            setSelectedActivities(activities);
        } else {
            setSelectedActivities([]);
        }
    }, [localSessionData, currentKey]);

    // 액티비티 설정 업데이트
    const updateActivity = useCallback((id: string, updates: Partial<ActivityConfig>) => {
        setSelectedActivities(prev =>
            prev.map(a => a.id === id ? { ...a, ...updates } : a)
        );
    }, []);

    // 액티비티 실행 (스택별 데이터 연결)
    const runActivity = useCallback((config: ActivityConfig) => {
        // 해당 액티비티(스택)에 맞는 데이터 찾기
        const targetStack = currentStacks.find(s => s.id === config.id);
        const activityData = targetStack ? targetStack.items : availableData;

        const instance: ActivityInstance = {
            config,
            data: activityData,
            sandboxId: `sandbox-${config.id}`,
            state: {
                status: 'loading',
                progress: 0
            }
        };
        setActiveInstance(instance);
        setPreviewMode(true);
        setIsRunning(true);

        // 샌드박스에 데이터 전송 시뮬레이션
        setTimeout(() => {
            setActiveInstance(prev => prev ? {
                ...prev,
                state: { ...prev.state, status: 'running' }
            } : null);
        }, 1000);
    }, [localSessionData?.stacks, availableData]);

    // 액티비티 종료
    const stopActivity = useCallback(() => {
        setActiveInstance(prev => prev ? {
            ...prev,
            state: { ...prev.state, status: 'completed', progress: 100 }
        } : null);
        setIsRunning(false);
        setPreviewMode(false);
    }, []);

    // 메타온 동기화
    const syncToMetaon = async () => {
        setSyncStatus('syncing');

        try {
            // 실제 API 호출 시뮬레이션
            await new Promise(resolve => setTimeout(resolve, 2000));

            const bundle: Step3ActivityBundle = {
                sessionId: localSessionData?.sessionId || generateId(),
                bundleId: generateId(),
                timestamp: getTimestamp(),
                hierarchy,
                activities: selectedActivities.map(config => ({
                    config,
                    data: availableData,
                    sandboxId: `sandbox-${config.id}`,
                    state: { status: 'idle', progress: 0 }
                })),
                metaonIntegration: {
                    targetCurriculum: `${hierarchy.subject}-${hierarchy.level}`,
                    targetUnit: hierarchy.set,
                    syncEnabled: true,
                    lastSyncTime: getTimestamp(),
                    syncStatus: 'synced'
                }
            };

            setSyncStatus('synced');
            onComplete(bundle);
        } catch {
            setSyncStatus('error');
        }
    };

    // [추가] 임시 DB 저장 (Supabase edu_page_data 연동)
    const handleTempDBSave = async () => {
        const state = stateManager.getState();
        if (!state.auth.isAuthenticated || !state.auth.userId) {
            alert('로그인이 필요합니다.');
            return;
        }

        setTempSyncStatus('syncing');
        try {
            // 전역 상태에 현재 세션 데이터(Step 2 산출물) 반영
            if (localSessionData) {
                stateManager.setStep2Data(localSessionData);
            }

            // 공통 저장 유틸리티 호출
            const { error: dbError } = await saveAppState();

            if (dbError) throw dbError;

            setTempSyncStatus('synced');
            // 3초 후 다시 'idle'로 복구 (다음 저장을 위해)
            setTimeout(() => setTempSyncStatus('idle'), 3000);
        } catch (error: any) {
            console.error('Temp DB Save Error:', error);
            alert(`임시 DB 저장에 실패했습니다: ${error.message || 'Unknown error'}`);
            setTempSyncStatus('error');
        }
    };

    // 액티비티 아이콘 렌더링
    const getActivityIcon = (type: ActivityType): string => {
        const icons: Record<ActivityType, string> = {
            'quiz_multiple': 'fa-list-check',
            'quiz_fill_blank': 'fa-pen-to-square',
            'matching_game': 'fa-puzzle-piece',
            'voice_recognition': 'fa-microphone',
            'handwriting': 'fa-pen-nib',
            'flashcard': 'fa-clone',
            'drag_drop': 'fa-hand-pointer',
            'metaverse_explore': 'fa-vr-cardboard'
        };
        return icons[type] || 'fa-gamepad';
    };

    // 액티비티 컬러 렌더링
    const getActivityColor = (type: ActivityType): string => {
        const colors: Record<ActivityType, string> = {
            'quiz_multiple': 'from-indigo-500 to-purple-600',
            'quiz_fill_blank': 'from-blue-500 to-cyan-600',
            'matching_game': 'from-amber-500 to-orange-600',
            'voice_recognition': 'from-pink-500 to-rose-600',
            'handwriting': 'from-emerald-500 to-teal-600',
            'flashcard': 'from-violet-500 to-fuchsia-600',
            'drag_drop': 'from-lime-500 to-green-600',
            'metaverse_explore': 'from-cyan-500 to-blue-600'
        };
        return colors[type] || 'from-slate-500 to-slate-600';
    };

    return (
        <div className="space-y-8 animate-fade-in">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-emerald-200">
                            3
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 tracking-tight">액티비티 런타임</h2>
                    </div>
                    <p className="text-slate-500 font-medium ml-13">
                        학습 액티비티를 선택하고 메타온에 배포합니다
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {onBack && (
                        <button onClick={onBack} className="tooltip btn-secondary" data-tooltip="이전 단계로 돌아갑니다">
                            <i className="fas fa-arrow-left mr-2"></i>
                            이전
                        </button>
                    )}

                    <button
                        onClick={syncToMetaon}
                        disabled={selectedActivities.length === 0 || syncStatus === 'syncing'}
                        className={cn(
                            'btn-primary flex items-center gap-2',
                            syncStatus === 'syncing' && 'opacity-70'
                        )}
                    >
                        {syncStatus === 'syncing' ? (
                            <>
                                <i className="fas fa-spinner fa-spin"></i>
                                동기화 중...
                            </>
                        ) : syncStatus === 'synced' ? (
                            <>
                                <i className="fas fa-check-circle"></i>
                                동기화 완료!
                            </>
                        ) : (
                            <>
                                <i className="fas fa-cloud-upload-alt"></i>
                                메타온 동기화
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* [변경] 계층 선택 네비게이션 - 라이트 테마 통일 */}
            <div className="card p-4 flex flex-wrap items-center gap-4 bg-white/80 backdrop-blur-lg border-2 border-indigo-100">
                <div className="flex-1 min-w-[100px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">{classificationConfig.subject}</label>
                    <select
                        value={hierarchy.subject}
                        onChange={(e) => handleHierarchyChange({ subject: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    >
                        {['Hanja', 'Chinese', 'Japanese', 'English', 'Korean'].slice(0, classificationConfig.subjectCount || 5).map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1 min-w-[80px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">{classificationConfig.label1}</label>
                    <select
                        value={hierarchy.level}
                        onChange={(e) => handleHierarchyChange({ level: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    >
                        {Array.from({ length: classificationConfig.label1Count || 1 }, (_, i) => String(i + 1)).map(l => {
                            const exists = storageMap.some(m => m.subject === hierarchy.subject && m.level === l);
                            return <option key={l} value={l} style={{ color: exists ? '#ef4444' : 'inherit' }}>{l}{exists ? ' (data)' : ''}</option>;
                        })}
                    </select>
                </div>
                <div className="flex-1 min-w-[80px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">{classificationConfig.label2}</label>
                    <select
                        value={hierarchy.set}
                        onChange={(e) => handleHierarchyChange({ set: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    >
                        {Array.from({ length: classificationConfig.label2Count || 1 }, (_, i) => String(i + 1)).map(sn => {
                            const exists = storageMap.some(m => m.subject === hierarchy.subject && m.level === hierarchy.level && m.set_num === sn);
                            return <option key={sn} value={sn} style={{ color: exists ? '#ef4444' : 'inherit' }}>{sn}{exists ? ' (data)' : ''}</option>;
                        })}
                    </select>
                </div>
                <div className="flex-1 min-w-[80px]">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">{classificationConfig.label3}</label>
                    <select
                        value={hierarchy.page}
                        onChange={(e) => handleHierarchyChange({ page: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
                    >
                        {Array.from({ length: classificationConfig.label3Count || 1 }, (_, i) => String(i + 1)).map(pn => {
                            const exists = storageMap.some(m => m.subject === hierarchy.subject && m.level === hierarchy.level && m.set_num === hierarchy.set && m.page_num === pn);
                            return <option key={pn} value={pn} style={{ color: exists ? '#ef4444' : 'inherit', fontWeight: exists ? 'bold' : 'normal' }}>{pn}{exists ? ' ●' : ''}</option>;
                        })}
                    </select>
                </div>

                {/* 액션 버튼: 편집 / 신규 */}
                <div className="flex flex-col gap-2 ml-auto">
                    {hasDataForCurrentPage ? (
                        <button
                            onClick={() => onNavigateToStep2?.(hierarchy)}
                            className="tooltip px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-bold text-sm flex items-center gap-2 transition-colors"
                            data-tooltip="선택한 페이지의 데이터를 편집합니다"
                        >
                            <i className="fas fa-edit"></i> 편집
                        </button>
                    ) : (
                        <button
                            onClick={() => onNavigateToStep1?.(hierarchy)}
                            className="tooltip px-4 py-2 bg-amber-500 hover:bg-amber-600 rounded-lg text-white font-bold text-sm flex items-center gap-2 transition-colors"
                            data-tooltip="선택한 페이지에 새 원고를 입력합니다"
                        >
                            <i className="fas fa-plus"></i> 신규 입력
                        </button>
                    )}
                </div>
            </div>

            {/* 로딩 상태 표시 - shimmer 스켈레톤 */}
            {isLoadingMap && (
                <div className="space-y-4 animate-fade-in">
                    <div className="card p-6">
                        <div className="flex items-center gap-6">
                            <div className="skeleton skeleton-circle w-16 h-16"></div>
                            <div className="flex-1 space-y-3">
                                <div className="skeleton skeleton-text"></div>
                                <div className="skeleton skeleton-text-sm"></div>
                            </div>
                            <div className="flex gap-4">
                                <div className="skeleton w-16 h-12 rounded-xl"></div>
                                <div className="skeleton w-16 h-12 rounded-xl"></div>
                                <div className="skeleton w-16 h-12 rounded-xl"></div>
                            </div>
                        </div>
                    </div>
                    <div className="skeleton skeleton-card w-full"></div>
                </div>
            )}

            {/* 세션 정보 */}
            <div className={cn("card p-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-100 transition-opacity duration-300", isLoadingPageData && "opacity-50")}>
                {isLoadingPageData && (
                    <div className="absolute inset-0 flex items-center justify-center z-10">
                        <div className="spinner"></div>
                    </div>
                )}
                <div className="flex items-center justify-between relative">
                    <div className="flex items-center gap-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                            <i className="fas fa-database text-2xl text-white"></i>
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-800 mb-1">세션 데이터</h3>
                            <div className="flex items-center gap-4 text-sm text-slate-500">
                                <span><i className="fas fa-book mr-1 text-indigo-400"></i> {hierarchy.subject}</span>
                                <span><i className="fas fa-layer-group mr-1 text-purple-400"></i> {hierarchy.level}</span>
                                <span><i className="fas fa-folder mr-1 text-emerald-400"></i> {hierarchy.set}</span>
                                <span><i className="fas fa-file-alt mr-1 text-amber-400"></i> {hierarchy.page}</span>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-8 text-center">
                        <div>
                            <p className="text-3xl font-black text-indigo-600">{currentStacks.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">스택</p>
                        </div>
                        <div>
                            <p className="text-3xl font-black text-emerald-600">{availableData.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">데이터</p>
                        </div>
                        <div>
                            <p className="text-3xl font-black text-amber-600">{selectedActivities.length}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">액티비티</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 max-w-4xl mx-auto">
                {/* 선택된 액티비티 & 미리보기 */}
                <div className="space-y-6">
                    {/* 선택된 액티비티 목록 */}
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-black text-slate-900">배포할 액티비티 목록</h3>
                        <span className="text-xs font-bold text-slate-400">
                            총 {selectedActivities.length}개
                        </span>
                    </div>

                    {selectedActivities.length === 0 ? (
                        <div className="card p-12 text-center">
                            <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-layer-group text-3xl text-slate-300"></i>
                            </div>
                            <p className="text-slate-400 font-bold">생성된 스택이 없습니다</p>
                            <p className="text-slate-300 text-sm mt-1">Step 2에서 스택을 구성해주세요</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {selectedActivities.map((activity, idx) => (
                                <div key={activity.id} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                                    <div className={cn(
                                        'w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center text-white font-bold text-lg',
                                        getActivityColor(activity.type)
                                    )}>
                                        {idx + 1}
                                    </div>

                                    <div className="flex-1">
                                        <h4 className="font-bold text-slate-900">{activity.title}</h4>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-500 font-medium">
                                                {currentStacks.find(s => s.id === activity.id)?.items.length || 0} items
                                            </span>
                                            <span className="text-xs text-slate-300">|</span>
                                            <span className="text-xs text-slate-400 font-medium uppercase">{activity.type.replace(/_/g, ' ')}</span>
                                        </div>
                                    </div>

                                    {/* 설정 */}
                                    <div className="flex items-center gap-2">
                                        <div className="flex flex-col items-end mr-4">
                                            <label className="text-[10px] font-bold text-slate-400 mb-0.5">난이도</label>
                                            <select
                                                value={activity.difficultyLevel}
                                                onChange={(e) => updateActivity(activity.id, {
                                                    difficultyLevel: parseInt(e.target.value) as 1 | 2 | 3
                                                })}
                                                className="text-xs bg-slate-50 rounded-lg px-2 py-1 border border-slate-200 outline-none font-bold text-slate-600 focus:border-indigo-500 transition-colors"
                                            >
                                                <option value={1}>쉬움</option>
                                                <option value={2}>보통</option>
                                                <option value={3}>어려움</option>
                                            </select>
                                        </div>

                                        <button
                                            onClick={() => runActivity(activity)}
                                            className="tooltip px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-sm font-bold hover:bg-indigo-100 hover:text-indigo-700 transition-colors flex items-center gap-2"
                                            data-tooltip="이 액티비티를 샌드박스에서 미리봅니다"
                                        >
                                            <i className="fas fa-play"></i>
                                            테스트
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 미리보기 / 샌드박스 */}
                    {previewMode && activeInstance && (
                        <div className="card overflow-hidden">
                            <div className="bg-slate-900 px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1.5">
                                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                                    </div>
                                    <span className="text-white/70 text-xs font-bold">
                                        Sandbox: {activeInstance.config.title}
                                    </span>
                                </div>
                                <button
                                    onClick={stopActivity}
                                    className="text-white/50 hover:text-white text-xs font-bold"
                                >
                                    <i className="fas fa-times mr-1"></i>
                                    닫기
                                </button>
                            </div>

                            <div className="sandbox-frame bg-slate-100 h-[400px] flex items-center justify-center">
                                {activeInstance.state.status === 'loading' ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <div className="spinner"></div>
                                        <p className="text-slate-400 font-bold text-sm">샌드박스 로딩 중...</p>
                                    </div>
                                ) : (
                                    <div className="text-center p-8">
                                        <div className={cn(
                                            'w-24 h-24 rounded-3xl bg-gradient-to-br flex items-center justify-center text-white mx-auto mb-6 shadow-2xl',
                                            getActivityColor(activeInstance.config.type)
                                        )}>
                                            <i className={`fas ${getActivityIcon(activeInstance.config.type)} text-4xl`}></i>
                                        </div>
                                        <h3 className="text-2xl font-black text-slate-800 mb-2">
                                            {activeInstance.config.title}
                                        </h3>
                                        <p className="text-slate-500 font-medium mb-6">
                                            {availableData.length}개의 학습 데이터 준비됨
                                        </p>

                                        {/* 샘플 데이터 미리보기 */}
                                        <div className="bg-white rounded-2xl p-4 max-w-md mx-auto border border-slate-200">
                                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
                                                데이터 샘플
                                            </h4>
                                            <div className="space-y-2">
                                                {availableData.slice(0, 3).map((item, i) => (
                                                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                                                        <span className="font-bold text-slate-700">{item.text}</span>
                                                        <span className="text-sm text-slate-400">{item.translation}</span>
                                                    </div>
                                                ))}
                                                {availableData.length > 3 && (
                                                    <p className="text-xs text-slate-300 text-center pt-2">
                                                        +{availableData.length - 3}개 더...
                                                    </p>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={stopActivity}
                                            className="btn-success mt-6"
                                        >
                                            <i className="fas fa-check mr-2"></i>
                                            미리보기 완료
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 메타온 통합 설정 */}
            <div className="card p-6">
                <h3 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
                    <i className="fas fa-cloud text-indigo-500"></i>
                    메타온 통합 설정
                </h3>

                <div className="grid md:grid-cols-3 gap-6">
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                            대상 커리큘럼
                        </label>
                        <input
                            type="text"
                            value={`${hierarchy.subject}-${hierarchy.level}`}
                            readOnly
                            className="input-field bg-slate-100"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                            대상 유닛
                        </label>
                        <input
                            type="text"
                            value={hierarchy.set}
                            readOnly
                            className="input-field bg-slate-100"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                            동기화 상태
                        </label>
                        <div className={cn(
                            'input-field flex items-center gap-2',
                            syncStatus === 'synced' ? 'bg-emerald-50 text-emerald-700' :
                                syncStatus === 'error' ? 'bg-red-50 text-red-700' :
                                    syncStatus === 'syncing' ? 'bg-blue-50 text-blue-700' :
                                        'bg-slate-100 text-slate-500'
                        )}>
                            <i className={cn(
                                'fas',
                                syncStatus === 'synced' ? 'fa-check-circle' :
                                    syncStatus === 'error' ? 'fa-exclamation-circle' :
                                        syncStatus === 'syncing' ? 'fa-spinner fa-spin' :
                                            'fa-hourglass-half'
                            )}></i>
                            {syncStatus === 'synced' ? '동기화 완료' :
                                syncStatus === 'error' ? '동기화 실패' :
                                    syncStatus === 'syncing' ? '동기화 중...' :
                                        '대기 중'}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-center items-center gap-4 pt-4">
                <button
                    onClick={handleTempDBSave}
                    disabled={tempSyncStatus === 'syncing'}
                    className={cn(
                        "tooltip px-8 py-5 rounded-3xl font-black text-lg flex items-center gap-3 transition-all",
                        tempSyncStatus === 'synced'
                            ? "bg-emerald-500 text-white shadow-emerald-200"
                            : "bg-white text-indigo-600 border-4 border-indigo-600 shadow-xl hover:bg-indigo-50"
                    )}
                    data-tooltip="현재 작업 상태를 서버 DB에 임시 저장합니다"
                >
                    <i className={cn("fas", tempSyncStatus === 'syncing' ? "fa-spinner fa-spin" : tempSyncStatus === 'synced' ? "fa-check-circle" : "fa-database")}></i>
                    {tempSyncStatus === 'synced' ? "임시 DB 저장됨" : "임시 DB 저장"}
                </button>

                <button
                    onClick={syncToMetaon}
                    disabled={syncStatus === 'syncing'}
                    className="tooltip bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-12 py-5 rounded-3xl font-black text-lg flex items-center gap-3 shadow-2xl shadow-emerald-200 hover:shadow-3xl hover:scale-[1.02] transition-all"
                    data-tooltip="모든 액티비티를 메타온 플랫폼에 배포합니다"
                >
                    <i className="fas fa-rocket text-xl"></i>
                    {selectedActivities.length}개 액티비티 메타온에 배포하기
                </button>
            </div>
        </div>
    );
};

export default Step3Runtime;
