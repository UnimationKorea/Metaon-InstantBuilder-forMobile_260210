/**
 * =========================================
 * Step 3: 액티비티 런타임 모듈 (Activity Engine & Sandbox)
 * =========================================
 * 메타온 액티비티 선택 및 샌드박스 실행
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
    Step2Session,
    ActivityConfig,
    ActivityInstance,
    ActivityType,
    ResourceData,
    PageHierarchy,
    ACTIVITY_TYPES,
    cn,
    saveAppState,
    stateManager,
    fetchPageContent
} from '@/shared';
import { ActivityRenderer } from './ActivityRenderer';

interface Step3RuntimeProps {
    sessionData: Step2Session | null;
}

export const Step3Runtime: React.FC<Step3RuntimeProps> = ({
    sessionData
}) => {
    // 전역 계층 상태 (stateManager에서 초기화)
    const hierarchy: PageHierarchy = sessionData?.hierarchy || stateManager.getState().hierarchy;

    // 로컬 세션 데이터 (계층 변경 시 DB에서 로드)
    const [localSessionData, setLocalSessionData] = useState<Step2Session | null>(sessionData);
    const [isLoadingPageData, setIsLoadingPageData] = useState(false);

    // sessionData prop 변경 시 localSessionData 동기화
    useEffect(() => {
        setLocalSessionData(sessionData);
    }, [sessionData]);

    // 상태
    const [selectedActivities, setSelectedActivities] = useState<ActivityConfig[]>([]);
    const [activeInstance, setActiveInstance] = useState<ActivityInstance | null>(null);
    const [, setIsRunning] = useState(false);
    const [tempSyncStatus, setTempSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [previewMode, setPreviewMode] = useState(false);

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
        setIsRunning(false);
        setPreviewMode(false);
        setActiveInstance(null);
    }, []);

    // 액티비티 완료 핸들러
    const handleActivityComplete = useCallback((score: number) => {
        console.log(`[Step3] Activity completed with score: ${score}`);

        // 인스턴스 상태 업데이트
        setActiveInstance(prev => prev ? {
            ...prev,
            state: { status: 'completed', progress: 100, score }
        } : null);

        // 성공 모달 표시 (또는 자동 종료)
        setTimeout(() => {
            alert(`축하합니다! ${score}점으로 액티비티를 완료했습니다.`);
            stopActivity();
        }, 500);
    }, [stopActivity]);


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
            'metaverse_explore': 'fa-vr-cardboard',
            'line_matching': 'fa-bezier-curve'
        };
        return icons[type] || 'fa-gamepad';
    };

    // 액티비티 컬러 렌더링 (Unused removed to fix build)
    /*
    const getActivityColor = (type: ActivityType): string => {
        ...
    };
    */

    return (
        <div className="max-w-2xl mx-auto w-full px-4 py-6 space-y-5 animate-fade-up">

            {/* Session Info Card */}
            <div className={cn("card p-5", isLoadingPageData && "opacity-50")}>
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 step3-gradient rounded-xl flex items-center justify-center" style={{ boxShadow: '0 4px 14px rgba(20,184,166,0.25)' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm" style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}>학습 액티비티</p>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="badge badge-step2">{hierarchy.subject}</span>
                                <span className="badge badge-neutral">Lv.{hierarchy.level} Set.{hierarchy.set} P.{hierarchy.page}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-center">
                            <p className="text-xl font-bold text-slate-900">{currentStacks.length}</p>
                            <p className="text-[10px] text-slate-400 font-semibold">Stacks</p>
                        </div>
                        <div className="w-px h-8 bg-slate-100" />
                        <div className="text-center">
                            <p className="text-xl font-bold text-indigo-600">{availableData.length}</p>
                            <p className="text-[10px] text-slate-400 font-semibold">Assets</p>
                        </div>
                        <div className="w-px h-8 bg-slate-100" />
                        <div className="text-center">
                            <p className="text-xl font-bold" style={{ color: '#F97316' }}>{selectedActivities.length}</p>
                            <p className="text-[10px] text-slate-400 font-semibold">활동</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-8 max-w-4xl mx-auto">
                {/* 선택된 액티비티 & 미리보기 */}
                <div className="space-y-6">
                    {/* 선택된 액티비티 목록 */}

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
                            {selectedActivities.map((activity) => (
                                <div key={activity.id} className="card !p-8 bg-white border-none hover:shadow-2xl hover:shadow-[#EEF2FF]/20 transition-all duration-300 flex items-center gap-8 group">
                                    <div className="w-16 h-16 rounded-[1.75rem] bg-[#F8F9FF] flex items-center justify-center text-[#0F172A] shadow-inner border border-slate-50 group-hover:scale-110 transition-transform duration-500">
                                        <i className={cn("fas text-xl", getActivityIcon(activity.type), "text-[#6366F1]")}></i>
                                    </div>

                                    <div className="flex-1 space-y-1">
                                        <h4 className="text-xl font-serif font-black text-[#0F172A]">{activity.title}</h4>
                                        <div className="flex items-center gap-4">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                                <i className="fas fa-cubes"></i>
                                                {currentStacks.find(s => s.id === activity.id)?.items.length || 0} Assets
                                            </span>
                                            <div className="w-1 h-1 rounded-full bg-slate-200"></div>
                                            <span className="text-[10px] font-black text-[#6366F1] uppercase tracking-widest">{activity.type.replace(/_/g, ' ')}</span>
                                        </div>
                                    </div>

                                    {/* Settings & Final Test */}
                                    <div className="flex items-center gap-6">
                                        <div className="flex flex-col items-end">
                                            <label className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Difficulty</label>
                                            <select
                                                value={activity.difficultyLevel}
                                                onChange={(e) => updateActivity(activity.id, {
                                                    difficultyLevel: parseInt(e.target.value) as 1 | 2 | 3
                                                })}
                                                className="text-[10px] bg-[#F8F9FF] rounded-xl px-4 py-2 border border-slate-50 outline-none font-black text-slate-600 focus:ring-2 focus:ring-[#EEF2FF] transition-all cursor-pointer"
                                            >
                                                <option value={1}>Gentle</option>
                                                <option value={2}>Standard</option>
                                                <option value={3}>Intense</option>
                                            </select>
                                        </div>

                                        <button
                                            onClick={() => runActivity(activity)}
                                            className="h-16 px-8 rounded-[2rem] bg-[#0F172A] text-white font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center gap-3"
                                        >
                                            <i className="fas fa-play text-[#6366F1]"></i>
                                            Test Runtime
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 미리보기 / 샌드박스 */}
                    {previewMode && activeInstance && (
                        <div className="space-y-0">
                            {/* Preview Header (Magic Terminal Style) */}
                            <div className="bg-[#0F172A] p-6 flex items-center justify-between border-b border-white/5 rounded-t-[2.5rem]">
                                <div className="flex items-center gap-4">
                                    <div className="flex gap-2">
                                        <div className="w-3 h-3 rounded-full bg-[#FF8585]"></div>
                                        <div className="w-3 h-3 rounded-full bg-[#FFD166]"></div>
                                        <div className="w-3 h-3 rounded-full bg-[#14B8A6]"></div>
                                    </div>
                                    <div className="h-4 w-px bg-white/10 mx-2"></div>
                                    <p className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] flex items-center gap-3">
                                        <i className="fas fa-terminal"></i>
                                        Magic Studio Sandbox
                                    </p>
                                </div>
                                <button
                                    onClick={stopActivity}
                                    className="text-white/40 hover:text-white transition-all"
                                >
                                    <i className="fas fa-times"></i>
                                </button>
                            </div>

                            <div className="relative min-h-[500px] flex flex-col bg-[#F8F9FF] border-x border-b border-slate-100 rounded-b-[2.5rem] overflow-hidden">
                                {activeInstance.state.status === 'loading' ? (
                                    <div className="flex-1 flex flex-col items-center justify-center p-20 text-center">
                                        <div className="spinner !w-16 !h-16 !border-t-[#6366F1]"></div>
                                        <p className="mt-8 text-slate-400 font-black text-[10px] uppercase tracking-widest">Warming up the studio...</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 flex flex-col p-4 sm:p-8">
                                        <div className="w-full h-full bg-white rounded-2xl overflow-hidden shadow-inner border border-slate-200">
                                            <ActivityRenderer
                                                activityType={activeInstance.config.type}
                                                config={activeInstance.config}
                                                data={activeInstance.data}
                                                onComplete={handleActivityComplete}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom Action (Magic Bar) */}
            <div className="flex gap-4 pt-10 border-t border-slate-100 mt-10">
                <button
                    onClick={() => setPreviewMode(!previewMode)}
                    className="flex-1 h-16 rounded-[2rem] bg-white text-slate-400 font-black text-xs uppercase tracking-widest shadow-lg hover:text-[#6366F1] transition-all flex items-center justify-center gap-3"
                >
                    <i className={cn("fas", previewMode ? "fa-eye-slash" : "fa-eye")}></i>
                    {previewMode ? "Hide Insights" : "Show Insights"}
                </button>
                <button
                    onClick={handleTempDBSave}
                    disabled={tempSyncStatus === 'syncing'}
                    className="btn-primary flex-[2] !h-16 !from-[#0F172A] !to-[#1a1a1a] !rounded-[2rem] !text-xs !font-black !uppercase !tracking-[0.2em]"
                >
                    {tempSyncStatus === 'syncing' ? (
                        <>
                            <i className="fas fa-spinner fa-spin mr-3"></i>
                            Syncing...
                        </>
                    ) : (
                        <>
                            <span>Finalize & Sync DB</span>
                            <i className="fas fa-cloud-upload-alt ml-3 text-[#6366F1]"></i>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default Step3Runtime;
