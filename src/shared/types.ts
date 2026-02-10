/**
 * =========================================
 * 메타온 인스턴트 콘텐츠 빌더 - 공용 타입 정의
 * =========================================
 * 모든 모듈 간 데이터 교환에 사용되는 표준 타입
 */

// ===== 기본 데이터 유닛 =====
export type DataUnit = 'word' | 'phrase' | 'sentence' | 'paragraph' | 'title' | 'meta';
export type Language = 'zh' | 'ja' | 'ko' | 'en';
export type Subject = string; // 기존: 'chinese' | 'japanese' | 'hanja' | 'english' | 'korean'

// ===== Step 1: 원고 수집 데이터 스키마 =====
export interface RawOCRBlock {
    id: string;
    original: string;          // 원본 텍스트
    reading?: string;          // 발음 (병음/후리가나/로마자)
    translation: string;       // 번역
    language: Language;
    type: DataUnit;
    page?: number;
    confidence: number;        // OCR 신뢰도 (0-1)
    boundingBox?: BoundingBox;
    imageUrl?: string;         // 직접 입력 시 이미지 URL
    audioUrl?: string;         // 직접 입력 시 오디오 URL
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Step1Output {
    sessionId: string;
    timestamp: string;
    sourceFile: {
        name: string;
        type: string;
        size: number;
    };
    results: RawOCRBlock[];
    pageSummaries?: PageSummary[];
    aggregatedSet?: AggregatedSet;
    metadata: {
        totalBlocks: number;
        pageCount: number;
        languages: Language[];
        processingTime: number;
    };
}

// 고유 세트 구조
export interface AggregatedSet {
    extractedVocabulary: LinguisticItem[];    // 추출 단어: 원본에서 추출된 모든 단어
    extractedSentences: LinguisticItem[];     // 추출 문장: 원본에서 추출된 문장
    relatedVocabulary: LinguisticItem[];      // 관련 단어: AI가 주제에 맞게 추천 (최대 4개)
    relatedSentences: LinguisticItem[];       // 관련 문장: AI가 추천하는 연관 문장
}

export interface PageSummary {
    page: number;
    topic?: string;               // 주요 주제
    learningGoal?: string;        // 학습 목표
    learningDirection?: string;   // 학습 방향
    keyPoints?: string[];         // 핵심 학습 포인트
}

export interface LinguisticItem {
    text: string;
    reading?: string;
    translation: string;
}

// ===== Step 2: 데이터 편집 스키마 =====
export interface ResourceData {
    id: string;
    text: string;              // 원문 (슬래시 분절 지원)
    subText?: string;          // 발음/병음 (슬래시 동기화)
    translation: string;
    dataUnit: DataUnit;

    // 미디어 첨부
    audioFile?: string;
    audioUrl?: string;
    imageFile?: string;
    imageUrl?: string;

    // 메타데이터
    isDirectInput?: boolean;   // AI 생성 vs 직접 입력
    aiGenerated?: boolean;
    validated?: boolean;
    sourceBlockId?: string;    // Step 1에서 가져온 경우 원본 ID
}

export interface Step2Session {
    sessionId: string;
    timestamp: string;
    subject: Subject;
    hierarchy: PageHierarchy;
    resources: Record<string, ResourceData[]>; // 전역 리소스 저장소 (setKey -> resources)
    stacks: Record<string, StackData[]>;     // 전역 스택 저장소 (pageKey -> stacks)
    config: {
        viewMode: 'ASSET_POOL' | 'PAGE_EDITOR';
        hierarchy: PageHierarchy;
    };
    validationStatus: ValidationStatus;
}

export interface ClassificationConfig {
    subject: string;      // 과목 레이블 (예: Subject)
    subjectCount: number; // 과목 개수
    label1: string;       // 분류 1 레이블 (예: Package)
    label1Count: number;  // 분류 1 개수
    label2: string;       // 분류 2 레이블 (예: Book)
    label2Count: number;  // 분류 2 개수
    label3: string;       // 분류 3 레이블 (예: Page)
    label3Count: number;  // 분류 3 개수
}

export const DEFAULT_CLASSIFICATION: ClassificationConfig = {
    subject: 'Subject',
    subjectCount: 5,
    label1: 'Package',
    label1Count: 10,
    label2: 'Book',
    label2Count: 20,
    label3: 'Page',
    label3Count: 20,
};

export interface PageHierarchy {
    subject: Subject;
    level: string;
    set: string;
    page: string;
}

export interface StackData {
    id: string;
    index: number;
    activityType: ActivityType;
    items: ResourceData[];
}

export interface ValidationStatus {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

export interface ValidationError {
    type: 'missing_field' | 'segment_mismatch' | 'empty_content';
    itemId: string;
    message: string;
}

export interface ValidationWarning {
    type: 'low_confidence' | 'unverified' | 'ai_generated';
    itemId: string;
    message: string;
}

// ===== Step 3: 액티비티 런타임 스키마 =====
export type ActivityType =
    | 'quiz_multiple'      // 객관식 퀴즈
    | 'quiz_fill_blank'    // 빈칸채우기
    | 'matching_game'      // 매칭 게임
    | 'voice_recognition'  // 음성인식
    | 'handwriting'        // 필기연습
    | 'flashcard'          // 플래시카드
    | 'drag_drop'          // 드래그앤드롭
    | 'metaverse_explore'; // 메타버스 탐험

export interface ActivityConfig {
    id: string;
    type: ActivityType;
    title: string;
    description?: string;
    timeLimit?: number;       // 초 단위
    shuffleItems?: boolean;
    showHints?: boolean;
    difficultyLevel?: 1 | 2 | 3;
}

export interface Step3ActivityBundle {
    sessionId: string;
    bundleId: string;
    timestamp: string;
    hierarchy: PageHierarchy;
    activities: ActivityInstance[];
    metaonIntegration: MetaonIntegration;
}

export interface ActivityInstance {
    config: ActivityConfig;
    data: ResourceData[];
    sandboxId: string;
    state: ActivityState;
}

export interface ActivityState {
    status: 'idle' | 'loading' | 'running' | 'paused' | 'completed' | 'error';
    progress: number;         // 0-100
    score?: number;
    attempts?: number;
    timeSpent?: number;
    errorMessage?: string;
}

export interface MetaonIntegration {
    targetCurriculum: string;
    targetUnit: string;
    syncEnabled: boolean;
    lastSyncTime?: string;
    syncStatus: 'pending' | 'syncing' | 'synced' | 'error';
}

// ===== 모듈 간 통신 프로토콜 =====
export interface StepTransition<TFrom, TTo> {
    fromStep: number;
    toStep: number;
    data: TFrom;
    transformedData: TTo;
    timestamp: string;
    validationPassed: boolean;
}

export type Step1ToStep2 = StepTransition<Step1Output, Step2Session>;
export type Step2ToStep3 = StepTransition<Step2Session, Step3ActivityBundle>;

// ===== PostMessage 통신 프로토콜 =====
export interface SandboxMessage {
    type: 'ACTIVITY_READY' | 'ACTIVITY_COMPLETE' | 'ACTIVITY_ERROR' | 'DATA_REQUEST' | 'STATE_UPDATE';
    sandboxId: string;
    payload: unknown;
    timestamp: string;
}

export interface ActivityCompleteEvent {
    activityId: string;
    score: number;
    timeSpent: number;
    answers: ActivityAnswer[];
}

export interface ActivityAnswer {
    questionId: string;
    userAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
}

// ===== 상수 정의 =====
// 하위 호환성을 위한 기본 데이터 (실제 데이터는 ClassificationConfig 기반으로 동적 생성 권장)
export const SUBJECTS: Subject[] = ['chinese', 'japanese', 'hanja', 'english', 'korean'];
export const LEVELS_DEFAULT = ['3A', '2A', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const ACTIVITY_TYPES: { id: ActivityType; label: string; icon: string }[] = [
    { id: 'quiz_multiple', label: '객관식 퀴즈', icon: 'fa-list-check' },
    { id: 'quiz_fill_blank', label: '빈칸채우기', icon: 'fa-pen-to-square' },
    { id: 'matching_game', label: '매칭 게임', icon: 'fa-puzzle-piece' },
    { id: 'voice_recognition', label: '음성인식', icon: 'fa-microphone' },
    { id: 'handwriting', label: '필기연습', icon: 'fa-pen-nib' },
    { id: 'flashcard', label: '플래시카드', icon: 'fa-clone' },
    { id: 'drag_drop', label: '드래그앤드롭', icon: 'fa-hand-pointer' },
    { id: 'metaverse_explore', label: '메타버스 탐험', icon: 'fa-vr-cardboard' },
];

export const DATA_UNIT_LABELS: Record<DataUnit, string> = {
    word: '단어',
    phrase: '구문',
    sentence: '문장',
    paragraph: '문단',
    title: '제목',
    meta: '메타정보',
};

export const LANGUAGE_LABELS: Record<Language, string> = {
    zh: '중국어',
    ja: '일본어',
    ko: '한국어',
    en: '영어',
};
