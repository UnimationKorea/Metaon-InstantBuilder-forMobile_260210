/**
 * =========================================
 * 모듈 간 상태 관리 (Sandbox State Manager)
 * =========================================
 * 각 스텝은 독립된 상태를 유지하며,
 * 스텝 간 데이터 전환은 이 매니저를 통해서만 진행
 */

import type {
    Step1Output,
    Step2Session,
    Step3ActivityBundle,
    StepTransition,
    ClassificationConfig,
    PageHierarchy
} from './types';
import { DEFAULT_CLASSIFICATION } from './types';
import { getTimestamp } from './utils';

type StepData = Step1Output | Step2Session | Step3ActivityBundle | null;

interface StateManagerConfig {
    enablePersistence?: boolean;
    persistenceKey?: string;
    onStateChange?: (state: GlobalState) => void;
}

interface GlobalState {
    currentStep: 1 | 2 | 3;
    step1Data: Step1Output | null;
    step2Data: Step2Session | null;
    step3Data: Step3ActivityBundle | null;
    classificationConfig: ClassificationConfig;
    geminiApiKey: string | null;
    supabaseConfig: {
        url: string | null;
        anonKey: string | null;
    };
    auth: {
        isAuthenticated: boolean;
        userId: string | null;
        lastLogin: string | null;
    };
    hierarchy: PageHierarchy; // 추가: 전역 위치 정보
    transitions: Array<StepTransition<unknown, unknown>>;
    lastUpdated: string;
}

class StateManager {
    private state: GlobalState;
    private config: StateManagerConfig;
    private listeners: Set<(state: GlobalState) => void>;

    constructor(config: StateManagerConfig = {}) {
        this.config = {
            enablePersistence: true,
            persistenceKey: 'metaon-icb-state',
            ...config,
        };
        this.listeners = new Set();
        this.state = this.loadState();
    }

    private loadState(): GlobalState {
        if (this.config.enablePersistence) {
            try {
                const saved = localStorage.getItem(this.config.persistenceKey!);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // 초기 상태와 병합하여 누락된 필드 보완 (하위 호환성)
                    return {
                        ...this.getInitialState(),
                        ...parsed,
                        supabaseConfig: {
                            ...this.getInitialState().supabaseConfig,
                            ...(parsed.supabaseConfig || {})
                        },
                        auth: parsed.auth || this.getInitialState().auth
                    };
                }
            } catch (error) {
                console.warn('Failed to load persisted state:', error);
            }
        }
        return this.getInitialState();
    }

    private getInitialState(): GlobalState {
        return {
            currentStep: 1,
            step1Data: null,
            step2Data: null,
            step3Data: null,
            classificationConfig: DEFAULT_CLASSIFICATION,
            geminiApiKey: null,
            supabaseConfig: {
                url: null,
                anonKey: null,
            },
            auth: {
                isAuthenticated: false,
                userId: null,
                lastLogin: null,
            },
            hierarchy: { // 추가: 기본값
                subject: 'Chinese',
                level: '1',
                set: '1',
                page: '1'
            },
            transitions: [],
            lastUpdated: getTimestamp(),
        };
    }

    private persist(): void {
        if (this.config.enablePersistence) {
            try {
                localStorage.setItem(
                    this.config.persistenceKey!,
                    JSON.stringify(this.state)
                );
            } catch (error) {
                console.warn('Failed to persist state:', error);
            }
        }
    }

    private notify(): void {
        this.listeners.forEach(listener => listener(this.state));
        this.config.onStateChange?.(this.state);
    }

    // 상태 조회
    getState(): GlobalState {
        return { ...this.state };
    }

    getCurrentStep(): 1 | 2 | 3 {
        return this.state.currentStep;
    }

    getStepData<T extends StepData>(step: 1 | 2 | 3): T | null {
        switch (step) {
            case 1: return this.state.step1Data as T;
            case 2: return this.state.step2Data as T;
            case 3: return this.state.step3Data as T;
            default: return null;
        }
    }

    // 상태 업데이트
    setCurrentStep(step: 1 | 2 | 3): void {
        this.state.currentStep = step;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setStep1Data(data: Step1Output): void {
        this.state.step1Data = data;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setStep2Data(data: Step2Session): void {
        this.state.step2Data = data;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setStep3Data(data: Step3ActivityBundle): void {
        this.state.step3Data = data;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setClassificationConfig(config: ClassificationConfig): void {
        this.state.classificationConfig = config;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setGeminiApiKey(key: string): void {
        this.state.geminiApiKey = key;
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    setSupabaseConfig(url: string, key: string): void {
        this.state.supabaseConfig = { url, anonKey: key };
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    // 전역 위치 정보 업데이트
    setHierarchy(hierarchy: PageHierarchy): void {
        this.state.hierarchy = { ...hierarchy };
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    // 인증 관련 메서드
    setAuthenticated(userId: string): void {
        this.state.auth = {
            isAuthenticated: true,
            userId,
            lastLogin: getTimestamp()
        };
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    logout(): void {
        const config = this.state.supabaseConfig; // 설정은 유지
        const key = this.state.geminiApiKey;
        this.state = this.getInitialState();
        this.state.supabaseConfig = config;
        this.state.geminiApiKey = key;
        this.persist();
        this.notify();
    }

    /**
     * 새로운 세션 시작: 인증 정보와 설정은 유지하고 모든 작업 데이터만 초기화
     */
    startNewSession(): void {
        const { auth, supabaseConfig, geminiApiKey, classificationConfig } = this.state;
        this.state = {
            ...this.getInitialState(),
            auth,
            supabaseConfig,
            geminiApiKey,
            classificationConfig
        };
        this.persist();
        this.notify();
    }

    /**
     * 특정 위치의 콘텐츠 데이터만 업데이트 (DB 저장 전 단계)
     */
    setPageContent(subject: string, level: string, set: string, page: string, stacks: any[]): void {
        const key = `${subject}-${level}-${set}-${page}`;
        this.state.step2Data = {
            ...(this.state.step2Data || {}),
            stacks: {
                ...(this.state.step2Data?.stacks || {}),
                [key]: stacks
            }
        } as any;
        this.persist();
        this.notify();
    }

    /**
     * DB에서 특정 위치의 데이터를 가져와 현재 편집 상태로 즉시 로드
     */
    loadPageContent(content: any): void {
        if (!content) return;

        // Step 2 데이터 구조에 맞게 변환하여 반영
        this.state.step2Data = {
            ...(this.state.step2Data || {}),
            stacks: {
                ...(this.state.step2Data?.stacks || {}),
                [`${content.subject}-${content.level}-${content.set_num}-${content.page_num}`]: content.content_data?.stacks || []
            }
        } as any;

        this.persist();
        this.notify();
    }
    restoreSession(appState: any, classificationConfig?: any): void {
        if (!appState) return;

        this.state.step1Data = appState.step1Data || null;
        this.state.step2Data = appState.step2Data || null;
        this.state.step3Data = appState.step3Data || null;

        // [강화] 만약 2단계 데이터(또는 CMS 스택)가 있다면, 최소한 2단계부터 시작하도록 유도
        let targetStep = appState.currentStep || 1;
        const s2Data = this.state.step2Data;
        if (targetStep === 1 && s2Data) {
            // 2단계 데이터가 실제 내용(stacks)을 포함하고 있는지 확인
            const hasStacks = s2Data.stacks && Object.keys(s2Data.stacks).length > 0;
            if (hasStacks) {
                targetStep = 2;
            }
        }

        this.state.currentStep = targetStep;

        if (classificationConfig) {
            this.state.classificationConfig = classificationConfig;
        }

        // [추가] 계층 정보 복구
        if (appState.hierarchy) {
            this.state.hierarchy = appState.hierarchy;
        }

        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }

    // 스텝 전환 (데이터 변환 포함)
    transitionToStep2(transformer: (data: Step1Output) => Step2Session): boolean {
        if (!this.state.step1Data) {
            console.error('Step 1 data is required for transition');
            return false;
        }

        try {
            const transformedData = transformer(this.state.step1Data);

            const transition: StepTransition<Step1Output, Step2Session> = {
                fromStep: 1,
                toStep: 2,
                data: this.state.step1Data,
                transformedData,
                timestamp: getTimestamp(),
                validationPassed: true,
            };

            this.state.step2Data = transformedData;
            this.state.transitions.push(transition);
            this.state.currentStep = 2;
            this.state.lastUpdated = getTimestamp();

            this.persist();
            this.notify();
            return true;
        } catch (error) {
            console.error('Transition to Step 2 failed:', error);
            return false;
        }
    }

    transitionToStep3(transformer: (data: Step2Session) => Step3ActivityBundle): boolean {
        if (!this.state.step2Data) {
            console.error('Step 2 data is required for transition');
            return false;
        }

        try {
            const transformedData = transformer(this.state.step2Data);

            const transition: StepTransition<Step2Session, Step3ActivityBundle> = {
                fromStep: 2,
                toStep: 3,
                data: this.state.step2Data,
                transformedData,
                timestamp: getTimestamp(),
                validationPassed: true,
            };

            this.state.step3Data = transformedData;
            this.state.transitions.push(transition);
            this.state.currentStep = 3;
            this.state.lastUpdated = getTimestamp();

            this.persist();
            this.notify();
            return true;
        } catch (error) {
            console.error('Transition to Step 3 failed:', error);
            return false;
        }
    }

    // 리스너 관리
    subscribe(listener: (state: GlobalState) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    // 상태 초기화
    reset(): void {
        this.state = this.getInitialState();
        this.persist();
        this.notify();
    }

    // 특정 스텝 데이터 클리어
    clearStepData(step: 1 | 2 | 3): void {
        switch (step) {
            case 1:
                this.state.step1Data = null;
                break;
            case 2:
                this.state.step2Data = null;
                break;
            case 3:
                this.state.step3Data = null;
                break;
        }
        this.state.lastUpdated = getTimestamp();
        this.persist();
        this.notify();
    }
}

// 싱글톤 인스턴스
export const stateManager = new StateManager();

export { StateManager };
export type { GlobalState };
