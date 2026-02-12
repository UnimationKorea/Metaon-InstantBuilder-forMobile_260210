/**
 * =========================================
 * Step 1: 원고 수집 모듈 (Data Acquisition)
 * =========================================
 * OCR 엔진을 통한 PDF/이미지 텍스트 추출
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import {
    RawOCRBlock,
    Step1Output,
    Language,
    PageSummary,
    AggregatedSet,
    generateId,
    getTimestamp,
    fileToBase64,
    cn,
    saveAppState,
    stateManager
} from '@/shared';

interface Step1AcquisitionProps {
    initialData?: Step1Output | null;
    onComplete: (data: Step1Output) => void;
    onUpdate?: (data: Step1Output) => void;
    engineModel?: string;
    geminiApiKey?: string;
    onCostUpdate?: (model: string, inputTokens: number, outputTokens: number) => void;
}

interface ManualEntry {
    id: string;
    type: 'word' | 'sentence';
    text: string;
    reading: string;
    translation: string;
    imageUrl?: string;
    imageFile?: File;
    audioUrl?: string;
    audioFile?: File;
}

export const Step1Acquisition: React.FC<Step1AcquisitionProps> = ({
    initialData,
    onComplete,
    onUpdate,
    engineModel = 'gemini-2.0-flash-exp',
    geminiApiKey,
    onCostUpdate
}) => {
    // 입력 모드: 'file' = 파일 업로드, 'manual' = 직접 입력
    const [inputMode, setInputMode] = useState<'file' | 'manual'>('file');

    // 파일 업로드 관련
    const [currentFile, setCurrentFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<Step1Output | null>(initialData || null);
    const [activeTab, setActiveTab] = useState<'raw' | 'summary' | 'set'>(initialData ? 'summary' : 'raw');
    const [isSyncing, setIsSyncing] = useState(false);

    // 직접 입력 관련
    const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
    const [manualSubTab, setManualSubTab] = useState<'word' | 'sentence'>('word');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);

    // 상위 컴포넌트로 데이터 동기화 (OCR 결과)
    useEffect(() => {
        if (results) {
            onUpdate?.(results);
        }
    }, [results, onUpdate]);

    // 직접 입력 데이터 → 상위 컴포넌트로 자동 동기화
    useEffect(() => {
        if (inputMode === 'manual' && manualEntries.length > 0) {
            const output: Step1Output = {
                sessionId: generateId(),
                timestamp: getTimestamp(),
                sourceFile: { name: 'manual-input', type: 'text/plain', size: 0 },
                results: manualEntries.map(entry => ({
                    id: entry.id,
                    original: entry.text,
                    reading: entry.reading,
                    translation: entry.translation,
                    type: entry.type,
                    confidence: 1.0,
                    language: 'zh' as Language,
                    boundingBox: undefined,
                    pageIndex: 0,
                    imageUrl: entry.imageUrl,
                    audioUrl: entry.audioUrl
                })),
                pageSummaries: [{
                    page: 0,
                    topic: '직접 입력한 학습 자료',
                    learningGoal: '입력한 단어와 문장 학습',
                    keyPoints: manualEntries.map(e => e.text)
                }],
                aggregatedSet: {
                    extractedVocabulary: manualEntries.filter(e => e.type === 'word').map(e => ({
                        text: e.text, pronunciation: e.reading, translation: e.translation,
                        imageUrl: e.imageUrl, audioUrl: e.audioUrl
                    })),
                    extractedSentences: manualEntries.filter(e => e.type === 'sentence').map(e => ({
                        text: e.text, pronunciation: e.reading, translation: e.translation,
                        imageUrl: e.imageUrl, audioUrl: e.audioUrl
                    })),
                    relatedVocabulary: [],
                    relatedSentences: []
                },
                metadata: {
                    totalBlocks: manualEntries.length,
                    pageCount: 1,
                    languages: ['zh'] as Language[],
                    processingTime: 0
                }
            };
            onUpdate?.(output);
        } else if (inputMode === 'manual' && manualEntries.length === 0) {
            onUpdate?.(null as any);
        }
    }, [manualEntries, inputMode]);

    // 파일 유효성 검사
    const validateFile = (file: File): boolean => {
        const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            setError('지원하지 않는 형식입니다. PDF, JPG, PNG, WebP 파일을 업로드해주세요.');
            return false;
        }
        if (file.size > 20 * 1024 * 1024) {
            setError('파일 크기가 20MB를 초과합니다.');
            return false;
        }
        return true;
    };

    // 파일 처리
    const handleFile = useCallback((file: File) => {
        if (!validateFile(file)) return;
        setCurrentFile(file);
        setError(null);
        setResults(null);
    }, []);

    // 드래그 앤 드롭 이벤트
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        dropZoneRef.current?.classList.add('active');
    };

    const handleDragLeave = () => {
        dropZoneRef.current?.classList.remove('active');
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dropZoneRef.current?.classList.remove('active');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    // OCR 처리
    const processOCR = async () => {
        if (!currentFile) return;

        setIsProcessing(true);
        setProgress(10);
        setError(null);

        const startTime = Date.now();

        try {
            const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyB2P8I8qiGOKwxov4JVlLoDOnbMpTuiae0';
            if (!apiKey) {
                throw new Error('API Key가 설정되지 않았습니다. 설정에서 API Key를 입력해주세요.');
            }
            const ai = new GoogleGenAI({ apiKey });
            const base64Data = await fileToBase64(currentFile);
            setProgress(30);

            const prompt = `
        당신은 세계 최고의 언어 교육 전문가입니다.
        제공된 이미지/문서를 분석하여 학습 콘텐츠를 구조화해주세요.
        
        ⚠️ 중요: 학습 콘텐츠 추출 시 다음 항목은 절대 포함하지 마십시오.
        1. 메타 데이터: 교재명, 로고 텍스트, 페이지 번호, 레벨/단계 표시 (예: 3A, 20b, Level 1, Unit 5)
        2. 지시어 및 안내문: "따라 쓰세요", "큰 소리로 읽으세요", "Write formatting", "Listen and repeat"
        3. 양식 필드: "Name:", "Date:", "Score:", "이름", "날짜"
        
        [Task 1: 원본 블록 추출 - OCR]
        이미지에서 학습 콘텐츠(단어, 문장)만 추출하십시오. 메타 데이터나 지시어는 'meta' 타입으로 분류하거나 아예 제외하십시오.
        1. 'original': 원본 텍스트
        2. 'reading': 발음 표기
        3. 'translation': 한국어 번역
        4. 'language': 언어 코드 (zh/ja/ko/en)
        5. 'type': 유형 (sentence/word/phrase/title/meta)
           - 교재 레벨(3A 등), 페이지 번호 등은 반드시 'meta'로 분류
        
        [Task 2: 페이지 요약 - 종합 분석]
        본문의 학습 주제를 파악하여 다음을 제공:
        - topic: 학습 주제 (예: "시간 묻고 답하기", "숫자와 시간 표현")
        - learningGoal: 학생이 달성할 구체적 목표
        - learningDirection: 학습 방향 설명 (2-3문장)시간을 영어로 정확하게 말할 수 있다"
          예: "What time is it? 질문에 It is ___. 형식으로 답할 수 있다"
        - learningDirection: 학습 방향 설명 (2-3문장)
        - keyPoints: 핵심 학습 포인트 (3-5개)
          예: ["숫자 1-12 영어 표현", "It is ___. 문장 구조", "시간 묻는 표현"]
        
        [Task 3: 고유 세트 - 4가지 카테고리]
        
        1. extractedVocabulary (추출 단어):
           - 본문에 나오는 학습 대상 단어만 추출
           - 예: ten, nine, clock, time 등 학습해야 할 단어
           - ❌ 제외: 교재명, 지시어, 양식 필드 텍스트
           - 각 단어에 text, reading, translation 포함
        
        2. extractedSentences (추출 문장):
           - 본문에 나오는 학습 예문만 추출
           - 예: "It is ten.", "What time is it?"
           - ❌ 제외: 지시문, 설명문
           - 각 문장에 text, reading, translation 포함
        
        3. relatedVocabulary (관련 단어):
           - 학습 주제와 관련된 추가 단어 추천 (최대 4개)
           - 예: 시간 주제면 → eight, seven, eleven, twelve
           - 본문에 없지만 학습에 도움되는 단어
           - 각 단어에 text, reading, translation 포함
        
        4. relatedSentences (관련 문장):
           - 학습 주제와 관련된 추가 예문 추천
           - 예: "It is eight.", "What time is it now?"
           - 추출 문장과 패턴이 비슷하거나 연관된 문장
           - 각 문장에 text, reading, translation 포함
        
        출력은 반드시 유효한 JSON이어야 합니다.
      `;

            setProgress(50);

            const response = await ai.models.generateContent({
                model: engineModel || 'gemini-2.0-flash-exp',
                contents: {
                    parts: [
                        { inlineData: { data: base64Data, mimeType: currentFile.type } },
                        { text: prompt }
                    ]
                },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            results: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        id: { type: Type.STRING },
                                        original: { type: Type.STRING },
                                        reading: { type: Type.STRING },
                                        translation: { type: Type.STRING },
                                        language: { type: Type.STRING },
                                        type: { type: Type.STRING },
                                        page: { type: Type.INTEGER },
                                        confidence: { type: Type.NUMBER }
                                    },
                                    required: ['id', 'original', 'reading', 'translation', 'language', 'type', 'confidence']
                                }
                            },
                            pageSummaries: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        page: { type: Type.INTEGER },
                                        topic: { type: Type.STRING },
                                        learningGoal: { type: Type.STRING },
                                        learningDirection: { type: Type.STRING },
                                        keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } }
                                    },
                                    required: ['page', 'topic', 'learningGoal', 'learningDirection', 'keyPoints']
                                }
                            },
                            aggregatedSet: {
                                type: Type.OBJECT,
                                properties: {
                                    extractedVocabulary: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                text: { type: Type.STRING },
                                                reading: { type: Type.STRING },
                                                translation: { type: Type.STRING }
                                            },
                                            required: ['text', 'reading', 'translation']
                                        }
                                    },
                                    extractedSentences: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                text: { type: Type.STRING },
                                                reading: { type: Type.STRING },
                                                translation: { type: Type.STRING }
                                            },
                                            required: ['text', 'reading', 'translation']
                                        }
                                    },
                                    relatedVocabulary: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                text: { type: Type.STRING },
                                                reading: { type: Type.STRING },
                                                translation: { type: Type.STRING }
                                            },
                                            required: ['text', 'reading', 'translation']
                                        }
                                    },
                                    relatedSentences: {
                                        type: Type.ARRAY,
                                        items: {
                                            type: Type.OBJECT,
                                            properties: {
                                                text: { type: Type.STRING },
                                                reading: { type: Type.STRING },
                                                translation: { type: Type.STRING }
                                            },
                                            required: ['text', 'reading', 'translation']
                                        }
                                    }
                                },
                                required: ['extractedVocabulary', 'extractedSentences', 'relatedVocabulary', 'relatedSentences']
                            },
                            summary: {
                                type: Type.OBJECT,
                                properties: {
                                    totalBlocks: { type: Type.INTEGER },
                                    pageCount: { type: Type.INTEGER }
                                }
                            }
                        }
                    }
                }
            });

            // 비용 계산 및 업데이트
            if (onCostUpdate) {
                // usageMetadata가 있으면 사용, 없으면 추정 (대략 글자수/4)
                // @ts-ignore - SDK 버전에 따라 타이핑이 다를 수 있음
                const usage = response.usageMetadata;
                if (usage) {
                    onCostUpdate(engineModel || 'gemini-2.0-flash-exp', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
                } else {
                    // Fallback estimation
                    const inputEst = (prompt.length + base64Data.length * 0.5) / 4;
                    const outputEst = (response.text?.length || 1000) / 4;
                    onCostUpdate(engineModel || 'gemini-2.0-flash-exp', Math.round(inputEst), Math.round(outputEst));
                }
            }

            setProgress(80);

            // JSON 파싱 (오류 복구 포함)
            let data: Record<string, unknown> = {};
            const responseText = response.text || '{}';

            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                console.warn('JSON 파싱 오류, 복구 시도 중...', parseError);

                // 잘린 JSON 복구 시도
                let fixedText = responseText;

                // 열린 문자열 닫기
                const lastQuoteIdx = fixedText.lastIndexOf('"');
                const afterLastQuote = fixedText.slice(lastQuoteIdx + 1);
                if (!afterLastQuote.includes('"') && lastQuoteIdx > 0) {
                    fixedText = fixedText.slice(0, lastQuoteIdx + 1) + '"';
                }

                // 열린 배열/객체 닫기
                let openBrackets = 0;
                let openBraces = 0;
                for (const char of fixedText) {
                    if (char === '[') openBrackets++;
                    if (char === ']') openBrackets--;
                    if (char === '{') openBraces++;
                    if (char === '}') openBraces--;
                }

                // 닫는 괄호 추가
                while (openBrackets > 0) { fixedText += ']'; openBrackets--; }
                while (openBraces > 0) { fixedText += '}'; openBraces--; }

                try {
                    data = JSON.parse(fixedText);
                    console.log('JSON 복구 성공');
                } catch {
                    // 최소한의 기본 구조만 사용
                    console.error('JSON 복구 실패, 기본 구조 사용');
                    data = { results: [], pageSummaries: [], aggregatedSet: null };
                }
            }

            // [추가된 필터링 로직] 원치 않는 항목 (지시문, 메타데이터) 제거
            if (data?.results && Array.isArray(data.results)) {
                const ignorePatterns = [
                    /^\d+[a-zA-Z\s]*$/i, // 예: 3A, 9b, 10 C
                    /^(Unit|Level|Chapter|Lesson|Track)\s*\d+/i, // 예: Unit 1, Level 2, Track 15
                    /^(Listen|Repeat|Read|Write|Answer|Match|Circle|Trace|Look|Let's|Check|Question).*/i, // 영어 지시문
                    /^(듣고|따라|읽으|쓰세|보세|연결|질문|보기).*/, // 한글 지시문
                    /^(Date|Name|Class|Score):/i // 양식 필드
                ];

                data.results = data.results.filter((item: any) => {
                    if (!item.original) return false;
                    const text = item.original.trim();

                    // 1. 너무 짧고 의미 없는 텍스트 제외 (특수문자만 있거나 숫자만 있는 경우 등)
                    if (text.length < 2 && !/[a-zA-Z\u4e00-\u9fa5\uac00-\ud7a3]/.test(text)) return false;

                    // 2. 필터링 패턴 매칭 (original 텍스트 기준)
                    if (ignorePatterns.some(pattern => pattern.test(text))) return false;

                    // 3. translation이 '지시문'이나 '설명'인 경우 제외 (AI가 그렇게 분석했을 수 있음)
                    if (item.translation && (item.translation.includes('지시') || item.translation.includes('설명'))) return false;

                    return true;
                });
            }

            const rawResults: RawOCRBlock[] = (data.results as RawOCRBlock[]) || [];

            // === 원본 블록에서 페이지 요약 자동 생성 ===
            let pageSummaries: PageSummary[] = (data.pageSummaries as PageSummary[]) || [];
            if (pageSummaries.length === 0 && rawResults.length > 0) {
                // 페이지별로 그룹화
                const pageGroups = rawResults.reduce((acc: Record<number, RawOCRBlock[]>, block) => {
                    const page = block.page || 1;
                    if (!acc[page]) acc[page] = [];
                    acc[page].push(block);
                    return acc;
                }, {});

                pageSummaries = Object.entries(pageGroups).map(([pageNum, blocks]) => {
                    // 학습 내용 분석
                    const sentences = blocks.filter(b => b.type === 'sentence' || (b.original && b.original.length > 10));
                    const vocabulary = blocks.filter(b => b.type === 'word' || (b.original && b.original.length <= 10 && b.original.length > 0));

                    // 주요 주제 추출 (제목이나 가장 긴 문장에서)
                    const titleBlock = blocks.find(b => b.type === 'title');
                    const topic = titleBlock?.original || (vocabulary.length > 0 ? `${vocabulary[0].original} 관련 학습` : '언어 학습');

                    // 학습 목표 자동 생성
                    const learningGoal = vocabulary.length > 0
                        ? `${vocabulary.slice(0, 3).map(v => v.original).join(', ')} 등 핵심 어휘와 표현 익히기`
                        : (sentences.length > 0 ? '주요 문장 패턴 이해 및 활용' : '내용 이해');

                    // 핵심 포인트 생성
                    const keyPoints: string[] = [];
                    if (vocabulary.length > 0) keyPoints.push(`${vocabulary.length}개의 핵심 단어 학습`);
                    if (sentences.length > 0) keyPoints.push(`${sentences.length}개의 예문을 통한 문형 익히기`);
                    keyPoints.push('발음과 의미를 함께 학습');
                    if (vocabulary.length > 3) keyPoints.push('관련 어휘 확장');

                    return {
                        page: parseInt(pageNum),
                        topic,
                        learningGoal,
                        learningDirection: `본 페이지에서는 ${vocabulary.length}개의 어휘와 ${sentences.length}개의 문장을 학습합니다. 각 항목의 발음과 뜻을 익히고 실제 문맥에서 활용해보세요.`,
                        keyPoints
                    };
                });
            }

            // === 원본 블록에서 고유 세트 자동 생성 ===
            const defaultAggregatedSet = {
                extractedVocabulary: [],
                extractedSentences: [],
                relatedVocabulary: [],
                relatedSentences: []
            };
            let aggregatedSet: AggregatedSet = (data.aggregatedSet as AggregatedSet) || defaultAggregatedSet;

            // AI 응답이 비어있으면 원본 블록에서 추출
            const isEmpty = !aggregatedSet.extractedVocabulary?.length && !aggregatedSet.extractedSentences?.length;
            if (isEmpty && rawResults.length > 0) {
                // 중복 제거를 위한 Set (원문 기준)
                const seenSentences = new Set<string>();
                const seenVocabulary = new Set<string>();

                // 메타정보 필터링 패턴
                const metaPatterns = [
                    /^(name|date|time|이름|날짜|시간):?\s*$/i,
                    /^\d+[a-z]\s*\d*$/i,  // 3A 2 같은 레벨 표시
                    /^(level|page|단원|페이지)/i,
                    /따라.*읽/,  // 지시문
                    /write.*answer/i,
                ];
                const isMetaContent = (text: string) =>
                    metaPatterns.some(p => p.test(text.trim()));

                // 추출 문장 (LinguisticItem 구조) - meta 타입 제외
                const extractedSentences = rawResults
                    .filter(b => b.type !== 'meta' && b.type !== 'title')
                    .filter(b => b.type === 'sentence' || (b.original && b.original.length > 10))
                    .filter(b => !isMetaContent(b.original))
                    .filter(b => {
                        if (seenSentences.has(b.original)) return false;
                        seenSentences.add(b.original);
                        return true;
                    })
                    .map(b => ({
                        text: b.original,
                        reading: b.reading || '',
                        translation: b.translation || ''
                    }));

                // 추출 단어 (LinguisticItem 구조) - meta 타입 제외
                const extractedVocabulary = rawResults
                    .filter(b => b.type !== 'meta' && b.type !== 'title')
                    .filter(b => b.type === 'word' || (b.original && b.original.length <= 10 && b.original.length > 0))
                    .filter(b => !isMetaContent(b.original))
                    .filter(b => {
                        if (seenVocabulary.has(b.original)) return false;
                        seenVocabulary.add(b.original);
                        return true;
                    })
                    .map(b => ({
                        text: b.original,
                        reading: b.reading || '',
                        translation: b.translation || ''
                    }));

                aggregatedSet = {
                    extractedVocabulary,
                    extractedSentences,
                    relatedVocabulary: aggregatedSet.relatedVocabulary || [],  // AI가 생성한 경우 유지
                    relatedSentences: aggregatedSet.relatedSentences || []     // AI가 생성한 경우 유지
                };
            }

            const output: Step1Output = {
                sessionId: generateId(),
                timestamp: getTimestamp(),
                sourceFile: {
                    name: currentFile.name,
                    type: currentFile.type,
                    size: currentFile.size
                },
                results: rawResults,
                pageSummaries,
                aggregatedSet,
                metadata: {
                    totalBlocks: (data.summary as { totalBlocks?: number })?.totalBlocks || rawResults.length || 0,
                    pageCount: (data.summary as { pageCount?: number })?.pageCount || Math.max(...rawResults.map(r => r.page || 1), 1),
                    languages: [...new Set(rawResults.map((r: RawOCRBlock) => r.language))] as Language[],
                    processingTime: Date.now() - startTime
                }
            };

            setProgress(100);
            setResults(output);

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
            setError(errorMessage);
        } finally {
            setIsProcessing(false);
        }
    };

    // 리셋
    const handleReset = () => {
        setCurrentFile(null);
        setResults(null);
        setError(null);
        setProgress(0);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    // 다음 단계로 진행
    const handleProceed = () => {
        if (results) {
            // [중요] 1단계에서 새 원고를 수집했으므로, 기존에 혹시 남아있을 수 있는 2, 3단계 데이터를 클리어
            stateManager.clearStepData(2);
            stateManager.clearStepData(3);

            onComplete(results);
        }
    };


    // 임시 DB 동기화 (Supabase edu_page_data 연동)
    const handleTempDBSync = async () => {
        const state = stateManager.getState();
        if (!state.auth.isAuthenticated || !state.auth.userId) {
            alert('로그인이 필요합니다.');
            return;
        }

        setIsSyncing(true);
        try {
            // 전역 상태에 현재 결과물 반영
            if (results) stateManager.setStep1Data(results);

            // 공통 저장 유틸리티 호출
            const { error: dbError } = await saveAppState();

            if (dbError) throw dbError;

            alert('Supabase DB(edu_page_data) 동기화가 완료되었습니다.');
        } catch (error: any) {
            console.error('Supabase Sync Error:', error);
            alert(`Supabase DB 동기화에 실패했습니다: ${error.message || 'Unknown error'}`);
        } finally {
            setIsSyncing(false);
        }
    };

    // 직접 입력 - 새 항목 추가
    const addManualEntry = (type: 'word' | 'sentence') => {
        setManualEntries([...manualEntries, {
            id: generateId(),
            type,
            text: '',
            reading: '',
            translation: ''
        }]);
    };

    // 직접 입력 - 항목 업데이트
    const updateManualEntry = (id: string, updates: Partial<ManualEntry>) => {
        setManualEntries(manualEntries.map(e => e.id === id ? { ...e, ...updates } : e));
    };

    // 고유 세트 항목 수정
    const updateAggregatedItem = (type: keyof AggregatedSet, index: number, updates: Partial<any>) => {
        if (!results || !results.aggregatedSet) return;
        const newSet = { ...results.aggregatedSet };
        const list = [...(newSet[type] || [])];
        if (list[index]) {
            list[index] = { ...list[index], ...updates };
            newSet[type] = list;
            setResults({ ...results, aggregatedSet: newSet });
        }
    };

    // 고유 세트 항목 삭제
    const deleteAggregatedItem = (type: keyof AggregatedSet, index: number) => {
        if (!results || !results.aggregatedSet) return;
        const newSet = { ...results.aggregatedSet };
        const list = [...(newSet[type] || [])];
        list.splice(index, 1);
        newSet[type] = list;
        setResults({ ...results, aggregatedSet: newSet });
    };

    // 고유 세트 항목 추가
    const addAggregatedItem = (type: keyof AggregatedSet) => {
        if (!results || !results.aggregatedSet) return;
        const newSet = { ...results.aggregatedSet };
        const list = [...(newSet[type] || [])];
        list.push({ text: '', reading: '', translation: '' });
        newSet[type] = list;
        setResults({ ...results, aggregatedSet: newSet });
    };

    // 직접 입력 - 항목 삭제 (경고창 포함)
    const deleteManualEntry = (id: string) => {
        if (!window.confirm('Sure to delete?')) return;
        setManualEntries(manualEntries.filter(e => e.id !== id));
    };


    // 언어 라벨
    const getLanguageLabel = (lang: string) => {
        const labels: Record<string, { label: string; className: string }> = {
            'zh': { label: '중국어', className: 'bg-amber-50 text-amber-700 border-amber-200' },
            'ja': { label: '일본어', className: 'bg-blue-50 text-blue-700 border-blue-200' },
            'ko': { label: '한국어', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            'en': { label: '영어', className: 'bg-purple-50 text-purple-700 border-purple-200' }
        };
        return labels[lang] || { label: lang, className: 'bg-slate-50 text-slate-700 border-slate-200' };
    };

    return (
        <div className="space-y-4 sm:space-y-8 animate-fade-in px-2 sm:px-0">
            {/* 입력 모드 선택 탭 — 선택 시 fill-in 동일 색상 */}
            <div className="flex gap-2 sm:gap-2">
                <button
                    onClick={() => setInputMode('file')}
                    className={cn(
                        'flex-1 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 sm:gap-3',
                        inputMode === 'file'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : 'bg-white border-2 border-slate-200 text-slate-400 hover:border-slate-300'
                    )}
                >
                    <i className="fas fa-file-upload"></i>
                    파일 업로드 (OCR)
                </button>
                <button
                    onClick={() => setInputMode('manual')}
                    className={cn(
                        'flex-1 py-3 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 sm:gap-3',
                        inputMode === 'manual'
                            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200'
                            : 'bg-white border-2 border-slate-200 text-slate-400 hover:border-slate-300'
                    )}
                >
                    <i className="fas fa-keyboard"></i>
                    직접입력
                </button>
            </div>

            {/* 파일 업로드 / 카메라 촬영 영역 */}
            {inputMode === 'file' && !currentFile && (
                <div
                    ref={dropZoneRef}
                    className="dropzone p-8 sm:p-16 flex flex-col items-center justify-center bg-white min-h-[220px] sm:min-h-[300px]"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center mb-4 sm:mb-6 float-animation">
                        <i className="fas fa-cloud-upload-alt text-3xl sm:text-4xl text-amber-500"></i>
                    </div>
                    <h3 className="text-lg sm:text-2xl font-black text-slate-700 mb-2 text-center">원고를 업로드하세요</h3>
                    <p className="text-slate-400 text-xs sm:text-sm font-medium mb-6 text-center">PDF, JPG, PNG, WebP (최대 20MB)</p>

                    {/* 파일 선택 + 카메라 촬영 버튼 */}
                    <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold text-sm rounded-2xl shadow-lg shadow-amber-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
                        >
                            <i className="fas fa-folder-open text-lg"></i>
                            파일 선택
                        </button>
                        <button
                            type="button"
                            onClick={() => cameraInputRef.current?.click()}
                            className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold text-sm rounded-2xl shadow-lg shadow-indigo-200 hover:scale-[1.02] active:scale-[0.98] transition-all"
                        >
                            <i className="fas fa-camera text-lg"></i>
                            카메라 촬영
                        </button>
                    </div>

                    <p className="text-slate-300 text-[11px] mt-4 hidden sm:block">
                        <i className="fas fa-info-circle mr-1"></i>
                        데스크톱에서는 파일 드래그&드롭도 가능합니다
                    </p>

                    {/* 기존 파일 선택 input (숨김) */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                    {/* 카메라 촬영 input (숨김) - 모바일에서 카메라 앱 직접 실행 */}
                    <input
                        ref={cameraInputRef}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                    />
                </div>
            )}

            {/* 직접 입력 영역 */}
            {inputMode === 'manual' && (
                <div className="space-y-6">
                    {/* 하위 메뉴 — 선택 시 외곽선 색상, 미선택 시 회색 */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => { setManualSubTab('word'); addManualEntry('word'); }}
                            className={cn(
                                'flex-1 py-3 rounded-xl font-bold text-sm border-2 transition-all flex items-center justify-center gap-2',
                                manualSubTab === 'word'
                                    ? 'border-indigo-500 text-indigo-600 bg-white'
                                    : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300'
                            )}
                        >
                            + 단어 추가
                        </button>
                        <button
                            onClick={() => { setManualSubTab('sentence'); addManualEntry('sentence'); }}
                            className={cn(
                                'flex-1 py-3 rounded-xl font-bold text-sm border-2 transition-all flex items-center justify-center gap-2',
                                manualSubTab === 'sentence'
                                    ? 'border-indigo-500 text-indigo-600 bg-white'
                                    : 'border-slate-200 text-slate-400 bg-white hover:border-slate-300'
                            )}
                        >
                            + 문장 추가
                        </button>
                    </div>

                    {/* 입력된 항목 목록 */}
                    {manualEntries.length === 0 ? (
                        <div className="card p-16 text-center">
                            <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-keyboard text-4xl text-slate-300"></i>
                            </div>
                            <p className="text-slate-400 font-bold">항목이 없습니다</p>
                            <p className="text-slate-300 text-sm mt-1">위 버튼을 클릭하여 단어나 문장을 추가하세요</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {manualEntries.map((entry, idx) => (
                                <div key={entry.id} className="card p-6 relative">
                                    {/* 삭제 버튼 */}
                                    <button
                                        onClick={() => deleteManualEntry(entry.id)}
                                        className="absolute top-3 right-3 w-9 h-9 sm:w-8 sm:h-8 rounded-full bg-red-100 text-red-500 hover:bg-red-200 hover:text-red-700 transition-all flex items-center justify-center"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>

                                    {/* 타입 배지 */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="text-lg font-black text-slate-300">#{idx + 1}</span>
                                        <span className={cn(
                                            'px-3 py-1 rounded-full text-xs font-bold',
                                            entry.type === 'word'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-blue-100 text-blue-700'
                                        )}>
                                            {entry.type === 'word' ? '단어' : '문장'}
                                        </span>
                                    </div>

                                    {/* 입력 필드들 */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                {entry.type === 'word' ? '단어' : '문장'}
                                            </label>
                                            <input
                                                type="text"
                                                value={entry.text}
                                                onChange={(e) => updateManualEntry(entry.id, { text: e.target.value })}
                                                placeholder={entry.type === 'word' ? '예: apple, 苹果' : '예: I like apples, 我喜欢吃苹果'}
                                                className="input-field text-xl font-bold"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                발음/읽기
                                            </label>
                                            <input
                                                type="text"
                                                value={entry.reading}
                                                onChange={(e) => updateManualEntry(entry.id, { reading: e.target.value })}
                                                placeholder="예: píngguǒ"
                                                className="input-field"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                번역
                                            </label>
                                            <input
                                                type="text"
                                                value={entry.translation}
                                                onChange={(e) => updateManualEntry(entry.id, { translation: e.target.value })}
                                                placeholder="예: 사과"
                                                className="input-field"
                                            />
                                        </div>
                                    </div>

                                    {/* 미디어 업로드 */}
                                    <div className="flex gap-4">
                                        {/* 이미지 업로드 */}
                                        <div className="flex-1">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                이미지
                                            </label>
                                            <div className="flex items-center gap-2">
                                                {entry.imageUrl ? (
                                                    <div className="relative">
                                                        <img src={entry.imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg" />
                                                        <button
                                                            onClick={() => updateManualEntry(entry.id, { imageUrl: undefined, imageFile: undefined })}
                                                            className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <label className="cursor-pointer">
                                                        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 hover:border-indigo-400 hover:text-indigo-400 transition-all">
                                                            <i className="fas fa-image text-xl"></i>
                                                        </div>
                                                        <input
                                                            type="file"
                                                            accept="image/*"
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) {
                                                                    const url = URL.createObjectURL(file);
                                                                    updateManualEntry(entry.id, { imageUrl: url, imageFile: file });
                                                                }
                                                            }}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        </div>

                                        {/* 오디오 업로드 + AI TTS */}
                                        <div className="flex-1">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                오디오
                                            </label>
                                            <div className="flex items-center gap-2">
                                                {entry.audioUrl ? (
                                                    <div className="space-y-2">
                                                        <audio src={entry.audioUrl} controls className="h-10 w-full" />
                                                        <div className="flex gap-2">
                                                            <span className="flex-1 text-center text-sm font-bold text-indigo-600 cursor-default">적용</span>
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm('Sure to delete?')) {
                                                                        updateManualEntry(entry.id, { audioUrl: undefined, audioFile: undefined });
                                                                    }
                                                                }}
                                                                className="w-7 h-7 bg-red-100 text-red-500 hover:bg-red-200 hover:text-red-700 rounded-full flex items-center justify-center transition-all"
                                                            >
                                                                <i className="fas fa-times text-xs"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <label className="cursor-pointer">
                                                        <div className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 hover:border-indigo-400 hover:text-indigo-400 transition-all">
                                                            <i className="fas fa-microphone text-xl"></i>
                                                        </div>
                                                        <input
                                                            type="file"
                                                            accept="audio/*"
                                                            className="hidden"
                                                            onChange={(e) => {
                                                                const file = e.target.files?.[0];
                                                                if (file) {
                                                                    const url = URL.createObjectURL(file);
                                                                    updateManualEntry(entry.id, { audioUrl: url, audioFile: file });
                                                                }
                                                            }}
                                                        />
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 파일 미리보기 */}
            {inputMode === 'file' && currentFile && !results && (
                <div className="card overflow-hidden">
                    <div className="card-header flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
                                {currentFile.type.startsWith('image/') ? (
                                    <i className="fas fa-image text-2xl text-slate-400"></i>
                                ) : (
                                    <i className="fas fa-file-pdf text-2xl text-red-400"></i>
                                )}
                            </div>
                            <div>
                                <h4 className="font-bold text-slate-800 text-lg">{currentFile.name}</h4>
                                <p className="text-sm text-slate-400">
                                    {(currentFile.size / (1024 * 1024)).toFixed(2)} MB • {currentFile.type.split('/')[1].toUpperCase()}
                                </p>
                            </div>
                        </div>
                        <button onClick={handleReset} className="p-3 hover:bg-slate-100 rounded-xl transition-colors">
                            <i className="fas fa-times text-slate-400"></i>
                        </button>
                    </div>

                    {/* 이미지 미리보기 */}
                    {currentFile.type.startsWith('image/') && (
                        <div className="p-8 bg-slate-50 flex justify-center">
                            <img
                                src={URL.createObjectURL(currentFile)}
                                alt="Preview"
                                className="max-h-[400px] rounded-2xl shadow-xl"
                            />
                        </div>
                    )}

                    {/* 액션 버튼 */}
                    <div className="p-6 flex justify-center gap-4">
                        <button onClick={handleReset} className="btn-secondary">
                            <i className="fas fa-redo mr-2"></i>
                            다시 선택
                        </button>
                        <button
                            onClick={processOCR}
                            disabled={isProcessing}
                            className="btn-warning min-w-[200px]"
                        >
                            {isProcessing ? (
                                <>
                                    <i className="fas fa-spinner fa-spin mr-2"></i>
                                    분석 중... {progress}%
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-magic mr-2"></i>
                                    AI 텍스트 추출
                                </>
                            )}
                        </button>
                    </div>

                    {/* 프로그레스 바 */}
                    {isProcessing && (
                        <div className="px-8 pb-6 space-y-3">
                            {/* 단계별 텍스트 */}
                            <div className="flex items-center justify-between text-sm">
                                <span className="font-bold text-slate-600 flex items-center gap-2">
                                    <i className={cn(
                                        'fas',
                                        progress <= 10 ? 'fa-file-import text-amber-500' :
                                            progress <= 30 ? 'fa-cog fa-spin text-blue-500' :
                                                progress <= 50 ? 'fa-brain text-purple-500' :
                                                    progress <= 80 ? 'fa-puzzle-piece text-emerald-500' :
                                                        'fa-check-circle text-green-500'
                                    )}></i>
                                    {progress <= 10 ? '파일 읽는 중...' :
                                        progress <= 30 ? '데이터 인코딩 중...' :
                                            progress <= 50 ? 'AI 분석 요청 중...' :
                                                progress <= 80 ? '결과 구조화 중...' :
                                                    '완료!'}
                                </span>
                                <span className="font-black text-indigo-600">{progress}%</span>
                            </div>
                            {/* 프로그레스 바 (그라데이션) */}
                            <div className="progress-bar">
                                <div
                                    className="progress-bar-fill"
                                    style={{
                                        width: `${progress}%`,
                                        background: `linear-gradient(90deg, #6366f1, #8b5cf6, #a855f7)`,
                                        transition: 'width 0.5s ease-in-out'
                                    }}
                                ></div>
                            </div>
                            {/* 4단계 미니 스텝 */}
                            <div className="flex justify-between text-[10px] font-bold text-slate-300">
                                <span className={progress >= 10 ? 'text-amber-500' : ''}>읽기</span>
                                <span className={progress >= 30 ? 'text-blue-500' : ''}>인코딩</span>
                                <span className={progress >= 50 ? 'text-purple-500' : ''}>AI 분석</span>
                                <span className={progress >= 80 ? 'text-emerald-500' : ''}>구조화</span>
                                <span className={progress >= 100 ? 'text-green-500' : ''}>완료</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 에러 메시지 */}
            {error && (
                <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                        <i className="fas fa-exclamation-triangle text-red-500"></i>
                    </div>
                    <div>
                        <h4 className="font-bold text-red-700">오류 발생</h4>
                        <p className="text-red-600 text-sm">{error}</p>
                    </div>
                </div>
            )}

            {/* 결과 표시 */}
            {results && (
                <div className="space-y-6">
                    {/* 결과 요약 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
                        <div className="card p-6 text-center">
                            <p className="text-4xl font-black text-indigo-600 mb-1">{results.metadata.totalBlocks}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">총 블록</p>
                        </div>
                        <div className="card p-6 text-center">
                            <p className="text-4xl font-black text-emerald-600 mb-1">{results.metadata.pageCount}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">페이지</p>
                        </div>
                        <div className="card p-6 text-center">
                            <p className="text-4xl font-black text-amber-600 mb-1">{results.metadata.languages.length}</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">언어</p>
                        </div>
                        <div className="card p-6 text-center">
                            <p className="text-4xl font-black text-purple-600 mb-1">{(results.metadata.processingTime / 1000).toFixed(1)}s</p>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">처리시간</p>
                        </div>
                    </div>

                    {/* 탭 및 동기화 버튼 */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
                        <div className="flex bg-slate-100 p-1 rounded-2xl flex-1">
                            {[
                                { id: 'summary' as const, label: '페이지 요약', icon: 'fa-file-alt', desc: '학습 목표/내용' },
                                { id: 'set' as const, label: '고유 세트', icon: 'fa-layer-group', desc: '단어/문장 정리' },
                                { id: 'raw' as const, label: '원본 블록', icon: 'fa-list', desc: 'OCR 추출 원본' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'flex-1 py-3 px-6 rounded-xl text-sm font-bold transition-all flex flex-col items-center justify-center gap-1',
                                        activeTab === tab.id
                                            ? 'bg-white text-indigo-600 shadow-md'
                                            : 'text-slate-500 hover:text-slate-700'
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <i className={`fas ${tab.icon}`}></i>
                                        {tab.label}
                                    </div>
                                    <span className="text-[10px] font-medium opacity-60">{tab.desc}</span>
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={handleTempDBSync}
                            disabled={isSyncing}
                            className={cn(
                                "flex items-center gap-2 px-6 py-4 rounded-2xl font-black text-sm transition-all shadow-lg",
                                isSyncing
                                    ? "bg-slate-100 text-slate-400 cursor-wait"
                                    : "bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.02] active:scale-[0.98]"
                            )}
                        >
                            <i className={cn("fas", isSyncing ? "fa-spinner fa-spin" : "fa-database")}></i>
                            {isSyncing ? "동기화 중..." : "임시 DB 동기화"}
                        </button>
                    </div>

                    {/* 원본 블록 탭 */}
                    {activeTab === 'raw' && (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                            {results.results.map((item) => {
                                const langInfo = getLanguageLabel(item.language);
                                return (
                                    <div
                                        key={item.id}
                                        className="card p-6 hover:border-indigo-300 transition-all border-l-4 border-l-transparent hover:border-l-indigo-500"
                                    >
                                        <div className="flex items-start gap-6">
                                            <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                                P{item.page || 1}
                                            </div>
                                            <div className="flex-1 space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <span className={cn('text-[10px] font-bold uppercase px-2 py-1 rounded border', langInfo.className)}>
                                                        {langInfo.label}
                                                    </span>
                                                    <span className="text-[10px] font-mono text-slate-400">
                                                        신뢰도: {Math.round(item.confidence * 100)}%
                                                    </span>
                                                </div>
                                                <p className="text-2xl font-bold text-slate-900 font-serif">{item.original}</p>
                                                {item.reading && (
                                                    <div className="text-sm font-medium text-slate-400 italic bg-slate-50 p-2 rounded-lg border border-slate-100">
                                                        {item.reading}
                                                    </div>
                                                )}
                                                <div className="text-base font-bold text-indigo-700 bg-indigo-50/50 p-3 rounded-xl border border-indigo-100/50">
                                                    <i className="fas fa-language mr-2 opacity-50"></i>
                                                    {item.translation}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* 페이지 요약 탭 */}
                    {activeTab === 'summary' && (
                        <div className="space-y-6 max-h-[60vh] overflow-y-auto">
                            {/* 탭 설명 */}
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white">
                                        <i className="fas fa-bullseye"></i>
                                    </div>
                                    <div>
                                        <h3 className="font-black text-slate-900">페이지 요약</h3>
                                        <p className="text-xs text-slate-500">문서 내용을 종합 분석한 주요 주제와 학습 목표</p>
                                    </div>
                                </div>
                            </div>

                            {results.pageSummaries?.map((pSum, idx) => (
                                <div key={idx} className="card overflow-hidden">
                                    <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4">
                                        <h3 className="text-white font-black text-xs uppercase tracking-widest">
                                            Page {pSum.page} - 종합 분석
                                        </h3>
                                    </div>
                                    <div className="p-6 space-y-5">
                                        {/* 주요 주제 */}
                                        {pSum.topic && (
                                            <div className="bg-gradient-to-r from-purple-50 to-pink-50 p-5 rounded-2xl border border-purple-200">
                                                <p className="text-[10px] font-black text-purple-500 uppercase flex items-center gap-2 mb-2">
                                                    <i className="fas fa-bookmark"></i> 주요 주제
                                                </p>
                                                <p className="text-xl font-black text-slate-900">
                                                    {pSum.topic}
                                                </p>
                                            </div>
                                        )}

                                        {/* 학습 목표 */}
                                        {pSum.learningGoal && (
                                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-5 rounded-2xl border border-blue-200">
                                                <p className="text-[10px] font-black text-blue-500 uppercase flex items-center gap-2 mb-2">
                                                    <i className="fas fa-bullseye"></i> 학습 목표
                                                </p>
                                                <p className="text-lg font-bold text-slate-800">
                                                    {pSum.learningGoal}
                                                </p>
                                            </div>
                                        )}

                                        {/* 학습 방향 */}
                                        {pSum.learningDirection && (
                                            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 p-5 rounded-2xl border border-emerald-200">
                                                <p className="text-[10px] font-black text-emerald-500 uppercase flex items-center gap-2 mb-2">
                                                    <i className="fas fa-compass"></i> 학습 방향
                                                </p>
                                                <p className="text-sm text-slate-700 leading-relaxed">
                                                    {pSum.learningDirection}
                                                </p>
                                            </div>
                                        )}

                                        {/* 핵심 포인트 */}
                                        {pSum.keyPoints && pSum.keyPoints.length > 0 && (
                                            <div className="bg-gradient-to-r from-amber-50 to-orange-50 p-5 rounded-2xl border border-amber-200">
                                                <p className="text-[10px] font-black text-amber-600 uppercase flex items-center gap-2 mb-3">
                                                    <i className="fas fa-star"></i> 핵심 학습 포인트
                                                </p>
                                                <ul className="space-y-2">
                                                    {pSum.keyPoints.map((point, i) => (
                                                        <li key={i} className="flex items-start gap-3">
                                                            <span className="w-6 h-6 bg-amber-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                                {i + 1}
                                                            </span>
                                                            <span className="text-sm text-slate-700 font-medium">
                                                                {point}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* 데이터 없음 */}
                            {(!results.pageSummaries || results.pageSummaries.length === 0) && (
                                <div className="card p-12 text-center">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <i className="fas fa-file-alt text-2xl text-slate-300"></i>
                                    </div>
                                    <p className="text-slate-400 font-bold">페이지 요약이 없습니다</p>
                                    <p className="text-slate-300 text-sm mt-1">OCR 처리 후 AI가 분석한 내용이 표시됩니다</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 고유 세트 탭 */}
                    {activeTab === 'set' && (
                        <div className="space-y-6 max-h-[60vh] overflow-y-auto">
                            {/* 탭 설명 */}
                            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-6 border border-emerald-100">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white">
                                        <i className="fas fa-layer-group"></i>
                                    </div>
                                    <div>
                                        <h3 className="font-black text-slate-900">고유 세트</h3>
                                        <p className="text-xs text-slate-500">원본에서 추출 및 AI 추천 학습 자료 (수정/삭제/추가 가능)</p>
                                    </div>
                                </div>
                            </div>

                            {/* 1. 추출 단어 */}
                            <div className="card overflow-hidden">
                                <div className="bg-gradient-to-r from-indigo-500 to-purple-500 px-6 py-4 flex justify-between items-center">
                                    <h3 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <i className="fas fa-spell-check"></i>
                                        추출 단어 ({results.aggregatedSet?.extractedVocabulary?.length || 0})
                                    </h3>
                                    <button
                                        onClick={() => addAggregatedItem('extractedVocabulary')}
                                        className="bg-white/20 hover:bg-white/40 text-white text-[10px] font-bold px-3 py-1 rounded-full transition-all"
                                    >
                                        <i className="fas fa-plus mr-1"></i> 추가
                                    </button>
                                </div>
                                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {results.aggregatedSet?.extractedVocabulary?.map((item, i) => (
                                        <div key={i} className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 hover:border-indigo-300 transition-colors group relative space-y-2">
                                            <div className="flex gap-2">
                                                <input
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { text: e.target.value })}
                                                    className="flex-1 bg-white border border-indigo-100 rounded px-2 py-1 text-sm font-bold"
                                                    placeholder="단어"
                                                />
                                                <input
                                                    value={item.reading || ''}
                                                    onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { reading: e.target.value })}
                                                    className="w-1/3 bg-white border border-indigo-100 rounded px-2 py-1 text-[10px]"
                                                    placeholder="발음"
                                                />
                                            </div>
                                            <input
                                                value={item.translation || ''}
                                                onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { translation: e.target.value })}
                                                className="w-full bg-indigo-100/50 border border-indigo-200 rounded px-2 py-1 text-xs font-bold text-indigo-700"
                                                placeholder="번역"
                                            />
                                            <button
                                                onClick={() => deleteAggregatedItem('extractedVocabulary', i)}
                                                className="absolute -top-2 -right-2 w-7 h-7 sm:w-6 sm:h-6 bg-red-500 text-white rounded-full text-[10px] shadow-lg z-10"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.extractedVocabulary || results.aggregatedSet.extractedVocabulary.length === 0) && (
                                        <span className="text-slate-300 italic text-xs col-span-full text-center py-4">추출된 단어 없음</span>
                                    )}
                                </div>
                            </div>

                            {/* 2. 추출 문장 */}
                            <div className="card overflow-hidden">
                                <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex justify-between items-center">
                                    <h3 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <i className="fas fa-quote-left"></i>
                                        추출 문장 ({results.aggregatedSet?.extractedSentences?.length || 0})
                                    </h3>
                                    <button
                                        onClick={() => addAggregatedItem('extractedSentences')}
                                        className="bg-white/20 hover:bg-white/40 text-white text-[10px] font-bold px-3 py-1 rounded-full transition-all"
                                    >
                                        <i className="fas fa-plus mr-1"></i> 추가
                                    </button>
                                </div>
                                <div className="p-4 space-y-3">
                                    {results.aggregatedSet?.extractedSentences?.map((item, i) => (
                                        <div key={i} className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 hover:border-amber-300 transition-colors group relative space-y-2">
                                            <div className="flex gap-2">
                                                <input
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('extractedSentences', i, { text: e.target.value })}
                                                    className="flex-1 bg-white border border-amber-100 rounded px-3 py-2 font-serif text-lg text-slate-800"
                                                    placeholder="문장"
                                                />
                                            </div>
                                            <div className="flex gap-2">
                                                <input
                                                    value={item.reading || ''}
                                                    onChange={(e) => updateAggregatedItem('extractedSentences', i, { reading: e.target.value })}
                                                    className="flex-1 bg-white border border-amber-100 rounded px-2 py-1 text-xs text-slate-400"
                                                    placeholder="발음"
                                                />
                                                <input
                                                    value={item.translation || ''}
                                                    onChange={(e) => updateAggregatedItem('extractedSentences', i, { translation: e.target.value })}
                                                    className="flex-1 bg-amber-100/50 border border-amber-200 rounded px-2 py-1 text-sm font-bold text-amber-700"
                                                    placeholder="번역"
                                                />
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('extractedSentences', i)}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.extractedSentences || results.aggregatedSet.extractedSentences.length === 0) && (
                                        <span className="text-slate-300 italic text-xs text-center block py-4">추출된 문장 없음</span>
                                    )}
                                </div>
                            </div>

                            {/* 3. 관련 단어 (AI 추천) */}
                            <div className="card overflow-hidden">
                                <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4 flex justify-between items-center">
                                    <h3 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <i className="fas fa-magic"></i>
                                        관련 단어 ({results.aggregatedSet?.relatedVocabulary?.length || 0}/4)
                                    </h3>
                                    <button
                                        onClick={() => addAggregatedItem('relatedVocabulary')}
                                        className="bg-white/20 hover:bg-white/40 text-white text-[10px] font-bold px-3 py-1 rounded-full transition-all"
                                    >
                                        <i className="fas fa-plus mr-1"></i> 추가
                                    </button>
                                </div>
                                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {results.aggregatedSet?.relatedVocabulary?.map((item, i) => (
                                        <div key={i} className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 hover:border-emerald-300 transition-colors group relative space-y-2">
                                            <div className="flex gap-2">
                                                <input
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { text: e.target.value })}
                                                    className="flex-1 bg-white border border-emerald-100 rounded px-2 py-1 text-sm font-bold"
                                                    placeholder="단어"
                                                />
                                                <input
                                                    value={item.reading || ''}
                                                    onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { reading: e.target.value })}
                                                    className="w-1/3 bg-white border border-emerald-100 rounded px-2 py-1 text-[10px]"
                                                    placeholder="발음"
                                                />
                                            </div>
                                            <input
                                                value={item.translation || ''}
                                                onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { translation: e.target.value })}
                                                className="w-full bg-emerald-100/50 border border-emerald-200 rounded px-2 py-1 text-xs font-bold text-emerald-600"
                                                placeholder="번역"
                                            />
                                            <div className="absolute top-1 left-1">
                                                <span className="text-[8px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">AI</span>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('relatedVocabulary', i)}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.relatedVocabulary || results.aggregatedSet.relatedVocabulary.length === 0) && (
                                        <span className="text-slate-300 italic text-xs col-span-full text-center py-4">AI 추천 단어 없음</span>
                                    )}
                                </div>
                            </div>

                            {/* 4. 관련 문장 (AI 추천) */}
                            <div className="card overflow-hidden">
                                <div className="bg-gradient-to-r from-pink-500 to-rose-500 px-6 py-4 flex justify-between items-center">
                                    <h3 className="text-white font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <i className="fas fa-lightbulb"></i>
                                        관련 문장 ({results.aggregatedSet?.relatedSentences?.length || 0})
                                    </h3>
                                    <button
                                        onClick={() => addAggregatedItem('relatedSentences')}
                                        className="bg-white/20 hover:bg-white/40 text-white text-[10px] font-bold px-3 py-1 rounded-full transition-all"
                                    >
                                        <i className="fas fa-plus mr-1"></i> 추가
                                    </button>
                                </div>
                                <div className="p-4 space-y-3">
                                    {results.aggregatedSet?.relatedSentences?.map((item, i) => (
                                        <div key={i} className="bg-pink-50/50 p-4 rounded-xl border border-pink-100 hover:border-pink-300 transition-colors group relative space-y-2">
                                            <div className="flex gap-2 pl-8">
                                                <input
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('relatedSentences', i, { text: e.target.value })}
                                                    className="flex-1 bg-white border border-pink-100 rounded px-3 py-2 font-serif text-lg text-slate-800"
                                                    placeholder="문장"
                                                />
                                            </div>
                                            <div className="flex gap-2 pl-8">
                                                <input
                                                    value={item.reading || ''}
                                                    onChange={(e) => updateAggregatedItem('relatedSentences', i, { reading: e.target.value })}
                                                    className="flex-1 bg-white border border-pink-100 rounded px-2 py-1 text-xs text-slate-400"
                                                    placeholder="발음"
                                                />
                                                <input
                                                    value={item.translation || ''}
                                                    onChange={(e) => updateAggregatedItem('relatedSentences', i, { translation: e.target.value })}
                                                    className="flex-1 bg-pink-100/50 border border-pink-200 rounded px-2 py-1 text-sm font-bold text-pink-700"
                                                    placeholder="번역"
                                                />
                                            </div>
                                            <div className="absolute top-2 left-2">
                                                <span className="text-[8px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full">AI</span>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('relatedSentences', i)}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-10"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.relatedSentences || results.aggregatedSet.relatedSentences.length === 0) && (
                                        <span className="text-slate-300 italic text-xs text-center block py-4">AI 추천 문장 없음</span>
                                    )}
                                </div>
                            </div>

                            {/* 전체 데이터 없음 */}
                            {(!results.aggregatedSet || (
                                !results.aggregatedSet.extractedVocabulary?.length &&
                                !results.aggregatedSet.extractedSentences?.length &&
                                !results.aggregatedSet.relatedVocabulary?.length &&
                                !results.aggregatedSet.relatedSentences?.length
                            )) && (
                                    <div className="card p-12 text-center">
                                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <i className="fas fa-inbox text-2xl text-slate-300"></i>
                                        </div>
                                        <p className="text-slate-400 font-bold">추출된 학습 자료가 없습니다</p>
                                        <p className="text-slate-300 text-sm mt-1">OCR 처리 후 AI가 추출/추천한 학습 자료가 표시됩니다</p>
                                    </div>
                                )}
                        </div>
                    )}

                    {/* 하단 액션 */}
                    <div className="flex justify-between items-center pt-6 border-t border-slate-100">
                        <button onClick={handleReset} className="btn-secondary">
                            <i className="fas fa-redo mr-2"></i>
                            새로운 파일 처리
                        </button>
                        <button onClick={handleProceed} className="btn-success">
                            결과 확정 & 다음 단계
                            <i className="fas fa-arrow-right ml-2"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Step1Acquisition;
