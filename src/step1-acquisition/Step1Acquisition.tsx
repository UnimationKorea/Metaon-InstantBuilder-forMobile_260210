/**
 * =========================================
 * Step 1: 원고 수집 모듈 (Data Acquisition)
 * =========================================
 * OCR 엔진을 통한 PDF/이미지 텍스트 추출 (Build Trigger: Vercel Sync)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
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
    engineModel = 'gemini-2.5-flash',
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

    // 오디오 임시 저장 상태 (ID -> { url, file })
    const [tempAudios, setTempAudios] = useState<Record<string, { url: string; file: File }>>({});

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
            const apiKey = geminiApiKey || process.env.API_KEY;
            if (!apiKey) {
                throw new Error('API Key가 설정되지 않았습니다. 설정에서 API Key를 입력해주세요.');
            }
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: engineModel || 'gemini-2.5-flash' });
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
        - learningDirection: 학습 방향 설명 (2-3문장). 예: "시간을 영어로 정확하게 말할 수 있다. What time is it? 질문에 It is ___. 형식으로 답할 수 있다"
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

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { inlineData: { data: base64Data, mimeType: currentFile.type } },
                            { text: prompt }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            results: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        id: { type: SchemaType.STRING },
                                        original: { type: SchemaType.STRING },
                                        reading: { type: SchemaType.STRING },
                                        translation: { type: SchemaType.STRING },
                                        language: { type: SchemaType.STRING },
                                        type: { type: SchemaType.STRING },
                                        page: { type: SchemaType.INTEGER },
                                        confidence: { type: SchemaType.NUMBER }
                                    },
                                    required: ['id', 'original', 'reading', 'translation', 'language', 'type', 'confidence']
                                }
                            },
                            pageSummaries: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        page: { type: SchemaType.INTEGER },
                                        topic: { type: SchemaType.STRING },
                                        learningGoal: { type: SchemaType.STRING },
                                        learningDirection: { type: SchemaType.STRING },
                                        keyPoints: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                                    },
                                    required: ['page', 'topic', 'learningGoal', 'learningDirection', 'keyPoints']
                                }
                            },
                            extractedVocabulary: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text: { type: SchemaType.STRING },
                                        reading: { type: SchemaType.STRING },
                                        translation: { type: SchemaType.STRING }
                                    },
                                    required: ['text', 'reading', 'translation']
                                }
                            },
                            extractedSentences: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text: { type: SchemaType.STRING },
                                        reading: { type: SchemaType.STRING },
                                        translation: { type: SchemaType.STRING }
                                    },
                                    required: ['text', 'reading', 'translation']
                                }
                            },
                            relatedVocabulary: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text: { type: SchemaType.STRING },
                                        reading: { type: SchemaType.STRING },
                                        translation: { type: SchemaType.STRING }
                                    },
                                    required: ['text', 'reading', 'translation']
                                }
                            },
                            relatedSentences: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        text: { type: SchemaType.STRING },
                                        reading: { type: SchemaType.STRING },
                                        translation: { type: SchemaType.STRING }
                                    },
                                    required: ['text', 'reading', 'translation']
                                }
                            },
                            summary: {
                                type: SchemaType.OBJECT,
                                properties: {
                                    totalBlocks: { type: SchemaType.INTEGER },
                                    pageCount: { type: SchemaType.INTEGER }
                                }
                            }
                        },
                        required: ['results', 'pageSummaries', 'extractedVocabulary', 'extractedSentences', 'relatedVocabulary', 'relatedSentences', 'summary']
                    }
                }
            });

            const response = await result.response;

            // 비용 계산 및 업데이트
            if (onCostUpdate) {
                // usageMetadata가 있으면 사용, 없으면 추정 (대략 글자수/4)
                const usage = response.usageMetadata;
                if (usage) {
                    onCostUpdate(engineModel || 'gemini-2.5-flash', usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
                } else {
                    // Fallback estimation
                    const inputEst = (prompt.length + base64Data.length * 0.5) / 4;
                    const outputEst = (response.text?.length || 1000) / 4;
                    onCostUpdate(engineModel || 'gemini-2.5-flash', Math.round(inputEst), Math.round(outputEst));
                }
            }

            setProgress(80);

            // JSON 파싱 (오류 복구 포함)
            let data: Record<string, unknown> = {};
            const responseText = response.text() || '{}';

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

                // 앞 번호 제거 유틸 (①②③, ⑴⑵, 1. 2. 등)
                const stripLeadingNumber = (text: string): string =>
                    text.replace(/^[\s]*([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩ⓐⓑⓒⓓⓔ]|\d+[.)\s]|[a-zA-Z][.)\s])\s*/, '').trim();

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
                        text: stripLeadingNumber(b.original),
                        reading: b.reading || '',
                        translation: b.translation || ''
                    }));
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
                        text: stripLeadingNumber(b.original),
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
            setActiveTab('summary');  // OCR 완료 후 페이지 요약을 기본으로 표시

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
        <div className="max-w-2xl mx-auto w-full px-4 py-6 space-y-6 animate-fade-up">
            {/* 입력 모드 선택 */}
            <div className="tab-bar">
                <button
                    onClick={() => setInputMode('file')}
                    disabled={manualEntries.length > 0}
                    className={cn('tab-item', inputMode === 'file' && 'active', manualEntries.length > 0 && 'opacity-40 pointer-events-none')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    OCR 업로드
                </button>
                <button
                    onClick={() => setInputMode('manual')}
                    disabled={!!currentFile}
                    className={cn('tab-item', inputMode === 'manual' && 'active', !!currentFile && 'opacity-40 pointer-events-none')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                    직접 입력
                </button>
            </div>

            {/* 파일 업로드 / 카메라 촬영 영역 (Tiimo Style) */}
            {inputMode === 'file' && !currentFile && (
                <div
                    ref={dropZoneRef}
                    className="dropzone p-10 flex flex-col items-center justify-center"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="w-14 h-14 step1-gradient rounded-2xl flex items-center justify-center mb-4 float-animation" style={{ boxShadow: '0 4px 14px rgba(249,115,22,0.25)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                    </div>
                    <h3 className="font-bold text-slate-900 text-lg mb-1 text-center">파일 업로드 또는 드래그</h3>
                    <p className="text-slate-400 text-sm mb-5 text-center">AI OCR로 학습 데이터를 자동 추출합니다</p>

                    <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
                        <button type="button" onClick={() => fileInputRef.current?.click()} className="btn btn-primary flex-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            파일 선택
                        </button>
                        <button type="button" onClick={() => cameraInputRef.current?.click()} className="btn btn-step1 flex-1">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                            촬영
                        </button>
                    </div>

                    <p className="text-slate-400 text-xs mt-5">PDF · JPG · PNG · WEBP</p>

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

            {/* 직접 입력 영역 (Soft Action Tabs) */}
            {inputMode === 'manual' && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex gap-4">
                        <button
                            onClick={() => { setManualSubTab('word'); addManualEntry('word'); }}
                            className={cn(
                                "flex-1 p-5 rounded-[2rem] font-black text-sm transition-all duration-300 flex items-center justify-center gap-3 shadow-lg",
                                manualSubTab === 'word'
                                    ? "bg-[#FFF7ED] text-[#F97316] ring-4 ring-[#F97316]/5"
                                    : "bg-white text-slate-400 border border-slate-50"
                            )}
                        >
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <i className="fas fa-plus text-[10px]"></i>
                            </div>
                            Add Vocabulary
                        </button>
                        <button
                            onClick={() => { setManualSubTab('sentence'); addManualEntry('sentence'); }}
                            className={cn(
                                "flex-1 p-5 rounded-[2rem] font-black text-sm transition-all duration-300 flex items-center justify-center gap-3 shadow-lg",
                                manualSubTab === 'sentence'
                                    ? "bg-[#F0FDFA] text-[#14B8A6] ring-4 ring-[#14B8A6]/5"
                                    : "bg-white text-slate-400 border border-slate-50"
                            )}
                        >
                            <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <i className="fas fa-plus text-[10px]"></i>
                            </div>
                            Add Sentence
                        </button>
                    </div>

                    {/* 입력된 항목 목록 (Minimalist Cards) */}
                    {manualEntries.length === 0 ? (
                        <div className="card p-20 text-center bg-white/40">
                            <div className="w-24 h-24 rounded-[2.5rem] bg-[#EEF2FF]/30 flex items-center justify-center mx-auto mb-6 float-animation">
                                <i className="fas fa-feather text-4xl text-[#6366F1]"></i>
                            </div>
                            <p className="text-[#0F172A] font-serif text-xl">Empty pocket</p>
                            <p className="text-slate-400 text-xs font-bold mt-2 uppercase tracking-widest">Add your first magic content above</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {manualEntries.map((entry, idx) => (
                                <div key={entry.id} className="card !p-8 animate-slide-up relative group">
                                    {/* 삭제 버튼 */}
                                    <button
                                        onClick={() => deleteManualEntry(entry.id)}
                                        className="absolute -top-3 -right-3 w-10 h-10 rounded-full bg-white text-rose-400 shadow-lg flex items-center justify-center hover:bg-rose-50 transition-all opacity-0 group-hover:opacity-100"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>

                                    {/* 상단 표시기 */}
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 font-serif font-black">
                                                {String(idx + 1).padStart(2, '0')}
                                            </div>
                                            <span className={cn(
                                                "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest",
                                                entry.type === 'word' ? "bg-[#FFF7ED] text-[#F97316]" : "bg-[#F0FDFA] text-[#14B8A6]"
                                            )}>
                                                {entry.type === 'word' ? 'Vocabulary' : 'Sentence'}
                                            </span>
                                        </div>
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

                                        {/* 오디오 업로드 + 적용 로직 수정 */}
                                        <div className="flex-1">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                                                오디오
                                            </label>
                                            <div className="flex items-center gap-2">
                                                {entry.audioUrl ? (
                                                    <div className="space-y-2">
                                                        <audio src={entry.audioUrl} controls className="h-10 w-full" />
                                                        <div className="flex gap-2">
                                                            <span className="flex-1 text-center text-sm font-bold text-emerald-600 cursor-default flex items-center justify-center gap-1">
                                                                <i className="fas fa-check-circle"></i> 적용됨
                                                            </span>
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
                                                ) : tempAudios[entry.id] ? (
                                                    <div className="space-y-2 w-full">
                                                        <div className="flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-200">
                                                            <span className="text-[10px] text-slate-500 truncate max-w-[80px]">
                                                                {tempAudios[entry.id].file.name}
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    const newTemps = { ...tempAudios };
                                                                    delete newTemps[entry.id];
                                                                    setTempAudios(newTemps);
                                                                }}
                                                                className="text-slate-400 hover:text-red-500"
                                                            >
                                                                <i className="fas fa-times"></i>
                                                            </button>
                                                        </div>
                                                        <button
                                                            onClick={() => {
                                                                const temp = tempAudios[entry.id];
                                                                updateManualEntry(entry.id, { audioUrl: temp.url, audioFile: temp.file });
                                                                const newTemps = { ...tempAudios };
                                                                delete newTemps[entry.id];
                                                                setTempAudios(newTemps);
                                                            }}
                                                            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-black hover:bg-indigo-700 transition-all shadow-md active:scale-95"
                                                        >
                                                            적용하기
                                                        </button>
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
                                                                    setTempAudios({ ...tempAudios, [entry.id]: { url, file } });
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

            {/* 파일 미리보기 및 처리 과정 (Tiimo Aesthetic) */}
            {inputMode === 'file' && currentFile && !results && (
                <div className="card overflow-hidden animate-fade-in !p-0">
                    <div className="p-8 flex flex-col items-center">
                        <div className="w-20 h-20 rounded-[2rem] bg-slate-50 flex items-center justify-center mb-6 shadow-inner">
                            {currentFile.type.startsWith('image/') ? (
                                <i className="fas fa-image text-3xl text-slate-300"></i>
                            ) : (
                                <i className="fas fa-file-pdf text-3xl text-rose-300"></i>
                            )}
                        </div>
                        <h4 className="text-2xl font-serif text-[#0F172A] mb-1">{currentFile.name}</h4>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-8">
                            {(currentFile.size / (1024 * 1024)).toFixed(2)} MB • {currentFile.type.split('/')[1].toUpperCase()}
                        </p>

                        {/* 이미지 미리보기 썸네일 */}
                        {currentFile.type.startsWith('image/') && (
                            <div className="w-full max-w-sm aspect-video rounded-[2.5rem] overflow-hidden bg-slate-100 mb-10 shadow-lg ring-8 ring-white/50">
                                <img
                                    src={URL.createObjectURL(currentFile)}
                                    alt="Preview"
                                    className="w-full h-full object-cover"
                                />
                            </div>
                        )}

                        {/* 액션 버튼 */}
                        <div className="flex flex-col gap-4 w-full max-w-xs">
                            <button
                                onClick={processOCR}
                                disabled={isProcessing}
                                className="btn-primary !h-16 !rounded-full !text-base"
                            >
                                {isProcessing ? (
                                    <div className="flex items-center gap-3">
                                        <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                        <span>Analyzing... {progress}%</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <i className="fas fa-wand-magic-sparkles text-lg"></i>
                                        <span>Start Magic Search</span>
                                    </div>
                                )}
                            </button>
                            <button
                                onClick={handleReset}
                                disabled={isProcessing}
                                className="h-16 rounded-full font-black text-slate-400 hover:text-[#6366F1] transition-all uppercase tracking-widest text-xs"
                            >
                                <i className="fas fa-redo mr-2 text-[10px]"></i>
                                Change File
                            </button>
                        </div>
                    </div>

                    {/* 정교한 프로그레스 정보 (Processing State) */}
                    {isProcessing && (
                        <div className="bg-[#F8F9FF] p-8 space-y-6">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-[#EEF2FF] text-[#6366F1] flex items-center justify-center shadow-sm">
                                        <i className={cn(
                                            "fas text-xs",
                                            progress <= 30 ? "fa-file-import" :
                                                progress <= 50 ? "fa-brain" :
                                                    progress <= 80 ? "fa-puzzle-piece" : "fa-check"
                                        )}></i>
                                    </div>
                                    <p className="text-sm font-bold text-[#0F172A]">
                                        {progress <= 30 ? "Reading document..." :
                                            progress <= 50 ? "Thinking with AI..." :
                                                progress <= 80 ? "Structuring content..." : "Almost there!"}
                                    </p>
                                </div>
                                <span className="font-black text-[#6366F1] text-sm tabular-nums">{progress}%</span>
                            </div>

                            <div className="h-3 w-full bg-white rounded-full overflow-hidden shadow-inner">
                                <div
                                    className="h-full bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] transition-all duration-700 relative overflow-hidden"
                                    style={{ width: `${progress}%` }}
                                >
                                    <div className="absolute inset-0 bg-[#ffffff30] animate-shimmer" />
                                </div>
                            </div>

                            <div className="flex justify-between px-1">
                                {['Reading', 'AI Analysis', 'Structuring', 'Finalizing'].map((step, i) => (
                                    <span key={step} className={cn(
                                        "text-[9px] font-black uppercase tracking-widest transition-colors",
                                        progress >= (i + 1) * 25 ? "text-[#6366F1]" : "text-slate-300"
                                    )}>{step}</span>
                                ))}
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

            {/* 결과 표시 (Tiimo Content View) */}
            {results && (
                <div className="space-y-12 animate-fade-in pb-20">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="card !p-6 flex items-center gap-5 bg-white/60">
                            <div className="w-14 h-14 rounded-2xl bg-[#EEF2FF]/40 text-[#6366F1] flex items-center justify-center shadow-sm">
                                <i className="fas fa-cubes text-xl"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total Blocks</p>
                                <p className="text-2xl font-serif text-[#0F172A]">{results.metadata.totalBlocks}</p>
                            </div>
                        </div>
                        <div className="card !p-6 flex items-center gap-5 bg-white/60">
                            <div className="w-14 h-14 rounded-2xl bg-[#F0FDFA]/40 text-[#14B8A6] flex items-center justify-center shadow-sm">
                                <i className="fas fa-copy text-xl"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Total Pages</p>
                                <p className="text-2xl font-serif text-[#0F172A]">{results.metadata.pageCount}</p>
                            </div>
                        </div>
                        <div className="card !p-6 flex items-center gap-5 bg-white/60">
                            <div className="w-14 h-14 rounded-2xl bg-[#FFF7ED]/40 text-[#F97316] flex items-center justify-center shadow-sm">
                                <i className="fas fa-globe text-xl"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Languages</p>
                                <p className="text-2xl font-serif text-[#0F172A]">{results.metadata.languages.length}</p>
                            </div>
                        </div>
                        <div className="card !p-6 flex items-center gap-5 bg-white/60">
                            <div className="w-14 h-14 rounded-2xl bg-[#F8F9FF] text-[#6366F1] flex items-center justify-center shadow-sm">
                                <i className="fas fa-bolt text-xl"></i>
                            </div>
                            <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Time taken</p>
                                <p className="text-2xl font-serif text-[#0F172A]">{(results.metadata.processingTime / 1000).toFixed(1)}s</p>
                            </div>
                        </div>
                    </div>

                    {/* 탭 및 동기화 버튼 (Tiimo Navigation) */}
                    <div className="flex flex-col gap-6">
                        <div className="flex p-2 bg-white/40 backdrop-blur-md rounded-[2.5rem] border border-white/40 shadow-sm overflow-x-auto no-scrollbar">
                            {[
                                { id: 'summary' as const, label: 'Summary', icon: 'fa-star' },
                                { id: 'set' as const, label: 'Smart Set', icon: 'fa-wand-magic-sparkles' },
                                { id: 'raw' as const, label: 'Raw Blocks', icon: 'fa-list-ul' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={cn(
                                        'flex-1 min-w-[100px] py-4 rounded-full font-black text-xs transition-all duration-500 flex items-center justify-center gap-3',
                                        activeTab === tab.id
                                            ? 'bg-white text-[#6366F1] shadow-md'
                                            : 'text-slate-400 hover:bg-white/40'
                                    )}
                                >
                                    <i className={`fas ${tab.icon} text-[10px]`}></i>
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={handleTempDBSync}
                            disabled={isSyncing}
                            className={cn(
                                "btn-primary !h-16 !from-emerald-400 !to-teal-500 !shadow-emerald-50",
                                isSyncing && "opacity-50 cursor-wait"
                            )}
                        >
                            <i className={cn("fas mr-3", isSyncing ? "fa-spinner fa-spin" : "fa-cloud-arrow-up")}></i>
                            {isSyncing ? "Syncing magic..." : "Save to Cloud DB"}
                        </button>
                    </div>

                    {/* 원본 블록 탭 (Minimalist Feed) */}
                    {activeTab === 'raw' && (
                        <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 no-scrollbar">
                            {results.results.map((item) => {
                                const langInfo = getLanguageLabel(item.language);
                                return (
                                    <div
                                        key={item.id}
                                        className="card !p-8 border-none bg-white hover:bg-[#F8F9FF] transition-all duration-300 relative group"
                                    >
                                        <div className="flex items-start gap-8">
                                            <div className="w-12 h-12 rounded-[1.25rem] bg-slate-900 flex items-center justify-center text-white shrink-0 shadow-lg">
                                                <span className="font-serif font-black text-xs">P{item.page || 1}</span>
                                            </div>
                                            <div className="flex-1 space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <span className={cn(
                                                        "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
                                                        langInfo.className
                                                    )}>
                                                        {langInfo.label}
                                                    </span>
                                                    <div className="flex items-center gap-1.5 opacity-30">
                                                        <i className="fas fa-bullseye text-[10px]"></i>
                                                        <span className="text-[10px] font-black">{Math.round(item.confidence * 100)}%</span>
                                                    </div>
                                                </div>
                                                <p className="text-2xl font-serif text-[#0F172A] leading-relaxed">{item.original}</p>
                                                {item.reading && (
                                                    <p className="text-sm font-bold text-slate-400 italic bg-slate-50/50 p-3 rounded-2xl border border-slate-50 inline-block">
                                                        {item.reading}
                                                    </p>
                                                )}
                                                <div className="bg-[#EEF2FF]/30 p-5 rounded-[1.5rem] border border-[#EEF2FF]/20">
                                                    <div className="flex items-center gap-2 mb-1 opacity-40">
                                                        <i className="fas fa-language text-[10px]"></i>
                                                        <span className="text-[9px] font-black uppercase tracking-widest">Translation</span>
                                                    </div>
                                                    <p className="text-base font-black text-[#8B5CF6]">{item.translation}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* 페이지 요약 탭 (Elegant Storyboard) */}
                    {activeTab === 'summary' && (
                        <div className="space-y-8 max-h-[60vh] overflow-y-auto pr-2 no-scrollbar">
                            {results.pageSummaries?.map((pSum, idx) => (
                                <div key={idx} className="card !p-0 overflow-hidden border-none bg-white">
                                    <div className="bg-[#0F172A] px-8 py-4 flex items-center justify-between">
                                        <h3 className="text-white font-serif font-black text-sm italic">
                                            Page {pSum.page} Analysis
                                        </h3>
                                        <div className="w-2 h-2 rounded-full bg-[#6366F1] animate-pulse"></div>
                                    </div>
                                    <div className="p-8 space-y-8">
                                        {/* 주요 주제 */}
                                        {pSum.topic && (
                                            <div className="space-y-3">
                                                <p className="text-[10px] font-black text-[#6366F1] uppercase tracking-[0.2em]">Primary Topic</p>
                                                <p className="text-3xl font-serif text-[#0F172A] leading-tight">
                                                    {pSum.topic}
                                                </p>
                                            </div>
                                        )}

                                        {/* 학습 목표 & 방향 */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {pSum.learningGoal && (
                                                <div className="bg-[#F8F9FF] p-6 rounded-[2rem] border border-slate-50">
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                        <i className="fas fa-bullseye text-[#6366F1]"></i> Learning Goal
                                                    </p>
                                                    <p className="text-sm font-bold text-[#0F172A]">
                                                        {pSum.learningGoal}
                                                    </p>
                                                </div>
                                            )}
                                            {pSum.learningDirection && (
                                                <div className="bg-[#F8F9FF] p-6 rounded-[2rem] border border-slate-50">
                                                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                                        <i className="fas fa-compass text-[#F97316]"></i> Roadmap
                                                    </p>
                                                    <p className="text-sm font-bold text-[#0F172A]">
                                                        {pSum.learningDirection}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* 핵심 포인트 */}
                                        {pSum.keyPoints && pSum.keyPoints.length > 0 && (
                                            <div className="bg-[#0F172A] p-8 rounded-[2.5rem] shadow-xl text-white">
                                                <p className="text-[9px] font-black text-[#6366F1] uppercase tracking-widest mb-6 block">Key Learning Points</p>
                                                <ul className="space-y-4">
                                                    {pSum.keyPoints.map((point, i) => (
                                                        <li key={i} className="flex items-start gap-4">
                                                            <span className="font-serif italic text-[#6366F1] text-lg font-black leading-none pt-0.5">
                                                                {i + 1}.
                                                            </span>
                                                            <span className="text-sm font-medium leading-relaxed opacity-90">
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

                            {(!results.pageSummaries || results.pageSummaries.length === 0) && (
                                <div className="card p-20 text-center bg-white/40">
                                    <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                        <i className="fas fa-file-circle-question text-3xl text-slate-200"></i>
                                    </div>
                                    <p className="text-[#0F172A] font-serif text-xl">No insights yet</p>
                                    <p className="text-slate-400 text-xs font-bold mt-2 uppercase tracking-widest">AI hasn't generated summary for this file</p>
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

                            {/* 1. 추출 단어 (Essential Vocabulary) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#FFF7ED] text-[#F97316] flex items-center justify-center">
                                            <i className="fas fa-spell-check text-[10px]"></i>
                                        </div>
                                        <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-widest">Essential Vocabulary</h3>
                                    </div>
                                    <button
                                        onClick={() => addAggregatedItem('extractedVocabulary')}
                                        className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-300 hover:text-[#6366F1] transition-all"
                                    >
                                        <i className="fas fa-plus text-[10px]"></i>
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {results.aggregatedSet?.extractedVocabulary?.map((item, i) => (
                                        <div key={i} className="card !p-6 bg-white hover:shadow-xl transition-all duration-300 group relative">
                                            <div className="flex flex-col gap-4">
                                                <div className="flex gap-3">
                                                    <input
                                                        value={item.text}
                                                        onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { text: e.target.value })}
                                                        className="flex-[2] bg-slate-50 border-none rounded-2xl px-4 py-3 text-lg font-serif font-black text-[#0F172A] focus:ring-2 focus:ring-[#FFF7ED]"
                                                        placeholder="Magic Word"
                                                    />
                                                    <input
                                                        value={item.reading || ''}
                                                        onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { reading: e.target.value })}
                                                        className="flex-1 bg-white border border-slate-100 rounded-2xl px-4 py-3 text-[10px] font-black text-slate-400 text-center uppercase tracking-widest"
                                                        placeholder="Phonetic"
                                                    />
                                                </div>
                                                <div className="bg-[#FFF7ED]/40 p-4 rounded-2xl border border-[#FFF7ED]/20">
                                                    <input
                                                        value={item.translation || ''}
                                                        onChange={(e) => updateAggregatedItem('extractedVocabulary', i, { translation: e.target.value })}
                                                        className="w-full bg-transparent border-none p-0 text-sm font-black text-[#F97316] focus:ring-0 placeholder-[#F97316]/50"
                                                        placeholder="Add Translation"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('extractedVocabulary', i)}
                                                className="absolute -top-2 -right-2 w-7 h-7 bg-white text-rose-300 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                                            >
                                                <i className="fas fa-times text-[10px]"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.extractedVocabulary || results.aggregatedSet.extractedVocabulary.length === 0) && (
                                        <div className="col-span-full py-10 text-center bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                                            <p className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No vocabulary found</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 2. 추출 문장 (Smart Sentences) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#F0FDFA] text-[#14B8A6] flex items-center justify-center">
                                            <i className="fas fa-quote-left text-[10px]"></i>
                                        </div>
                                        <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-widest">Smart Sentences</h3>
                                    </div>
                                    <button
                                        onClick={() => addAggregatedItem('extractedSentences')}
                                        className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-300 hover:text-[#6366F1] transition-all"
                                    >
                                        <i className="fas fa-plus text-[10px]"></i>
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {results.aggregatedSet?.extractedSentences?.map((item, i) => (
                                        <div key={i} className="card !p-8 bg-white border-2 border-slate-50 hover:border-[#F0FDFA] transition-all duration-300 group relative">
                                            <div className="space-y-6">
                                                <textarea
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('extractedSentences', i, { text: e.target.value })}
                                                    className="w-full bg-transparent border-none p-0 text-xl font-serif font-black text-[#0F172A] focus:ring-0 resize-none h-auto min-h-[60px]"
                                                    placeholder="Enter Magic Sentence..."
                                                />
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <input
                                                        value={item.reading || ''}
                                                        onChange={(e) => updateAggregatedItem('extractedSentences', i, { reading: e.target.value })}
                                                        className="bg-slate-50/50 border-none rounded-2xl px-5 py-3 text-xs font-bold text-slate-400 italic"
                                                        placeholder="Phonetic reading..."
                                                    />
                                                    <div className="bg-[#F0FDFA]/40 px-5 py-3 rounded-2xl">
                                                        <input
                                                            value={item.translation || ''}
                                                            onChange={(e) => updateAggregatedItem('extractedSentences', i, { translation: e.target.value })}
                                                            className="w-full bg-transparent border-none p-0 text-sm font-black text-[#14B8A6] focus:ring-0"
                                                            placeholder="Translation..."
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('extractedSentences', i)}
                                                className="absolute -top-3 -right-3 w-10 h-10 bg-white text-rose-300 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-rose-50"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.extractedSentences || results.aggregatedSet.extractedSentences.length === 0) && (
                                        <div className="py-10 text-center bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                                            <p className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No sentences captured</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 3. 관련 단어 (AI Insights: Vocabulary) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#EEF2FF] text-[#6366F1] flex items-center justify-center">
                                            <i className="fas fa-magic text-[10px]"></i>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-widest">AI Insights</h3>
                                            <span className="px-2 py-0.5 rounded-full bg-[#6366F1] text-white text-[8px] font-black uppercase">Magic</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => addAggregatedItem('relatedVocabulary')}
                                        className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-300 hover:text-[#6366F1] transition-all"
                                    >
                                        <i className="fas fa-plus text-[10px]"></i>
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {results.aggregatedSet?.relatedVocabulary?.map((item, i) => (
                                        <div key={i} className="card !p-6 bg-[#F8F9FF] border-none hover:shadow-xl transition-all duration-300 group relative">
                                            <div className="flex flex-col gap-4">
                                                <div className="flex gap-3">
                                                    <input
                                                        value={item.text}
                                                        onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { text: e.target.value })}
                                                        className="flex-[2] bg-white border-none rounded-2xl px-4 py-3 text-lg font-serif font-black text-[#0F172A] focus:ring-2 focus:ring-[#EEF2FF]"
                                                        placeholder="AI Word"
                                                    />
                                                    <input
                                                        value={item.reading || ''}
                                                        onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { reading: e.target.value })}
                                                        className="flex-1 bg-white border border-slate-50 rounded-2xl px-4 py-3 text-[10px] font-black text-slate-400 text-center uppercase tracking-widest"
                                                        placeholder="AI Phonetic"
                                                    />
                                                </div>
                                                <div className="bg-white/60 p-4 rounded-2xl border border-white">
                                                    <input
                                                        value={item.translation || ''}
                                                        onChange={(e) => updateAggregatedItem('relatedVocabulary', i, { translation: e.target.value })}
                                                        className="w-full bg-transparent border-none p-0 text-sm font-black text-[#6366F1] focus:ring-0 placeholder-[#6366F1]/50"
                                                        placeholder="Add Translation"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('relatedVocabulary', i)}
                                                className="absolute -top-2 -right-2 w-7 h-7 bg-white text-rose-300 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center"
                                            >
                                                <i className="fas fa-times text-[10px]"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.relatedVocabulary || results.aggregatedSet.relatedVocabulary.length === 0) && (
                                        <div className="col-span-full py-10 text-center bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                                            <p className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No related words suggested</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 4. 관련 문장 (AI Lessons: Sentences) */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between px-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#FFE2E2] text-[#FF8585] flex items-center justify-center">
                                            <i className="fas fa-lightbulb text-[10px]"></i>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-sm font-black text-[#0F172A] uppercase tracking-widest">AI Lessons</h3>
                                            <span className="px-2 py-0.5 rounded-full bg-[#FF8585] text-white text-[8px] font-black uppercase">Dynamic</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => addAggregatedItem('relatedSentences')}
                                        className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-300 hover:text-[#6366F1] transition-all"
                                    >
                                        <i className="fas fa-plus text-[10px]"></i>
                                    </button>
                                </div>

                                <div className="space-y-4">
                                    {results.aggregatedSet?.relatedSentences?.map((item, i) => (
                                        <div key={i} className="card !p-8 bg-white border-2 border-slate-50 hover:border-[#FFE2E2] transition-all duration-300 group relative">
                                            <div className="space-y-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="px-2 py-1 rounded bg-[#FFE2E2] text-[#FF8585] text-[8px] font-black uppercase tracking-widest leading-none">AI Suggestion</div>
                                                </div>
                                                <textarea
                                                    value={item.text}
                                                    onChange={(e) => updateAggregatedItem('relatedSentences', i, { text: e.target.value })}
                                                    className="w-full bg-transparent border-none p-0 text-xl font-serif font-black text-[#0F172A] focus:ring-0 resize-none h-auto min-h-[60px]"
                                                    placeholder="AI Generated Sentence..."
                                                />
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <input
                                                        value={item.reading || ''}
                                                        onChange={(e) => updateAggregatedItem('relatedSentences', i, { reading: e.target.value })}
                                                        className="bg-slate-50/50 border-none rounded-2xl px-5 py-3 text-xs font-bold text-slate-400 italic"
                                                        placeholder="How to read this?"
                                                    />
                                                    <div className="bg-[#FFE2E2]/40 px-5 py-3 rounded-2xl">
                                                        <input
                                                            value={item.translation || ''}
                                                            onChange={(e) => updateAggregatedItem('relatedSentences', i, { translation: e.target.value })}
                                                            className="w-full bg-transparent border-none p-0 text-sm font-black text-[#FF8585] focus:ring-0"
                                                            placeholder="Meaning..."
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => deleteAggregatedItem('relatedSentences', i)}
                                                className="absolute -top-3 -right-3 w-10 h-10 bg-white text-rose-300 rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center hover:bg-rose-50"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                        </div>
                                    ))}
                                    {(!results.aggregatedSet?.relatedSentences || results.aggregatedSet.relatedSentences.length === 0) && (
                                        <div className="py-10 text-center bg-slate-50/50 rounded-[2.5rem] border-2 border-dashed border-slate-100">
                                            <p className="text-slate-300 font-black text-[10px] uppercase tracking-widest">No related sentences at the moment</p>
                                        </div>
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

                    {/* 하단 액션 (Floating Magic Bar Concept) */}
                    <div className="flex gap-4 pt-10 mt-10 border-t border-slate-50">
                        <button
                            onClick={handleReset}
                            className="flex-1 h-16 rounded-[2rem] bg-white text-slate-400 font-black text-xs uppercase tracking-widest shadow-lg hover:text-[#F97316] transition-all"
                        >
                            <i className="fas fa-redo-alt mr-3"></i>
                            Start Over
                        </button>
                        <button
                            onClick={handleProceed}
                            className="btn-primary flex-[2] !h-16 !from-[#6366F1] !to-[#8B5CF6] !rounded-[2rem] !text-sm"
                        >
                            <span>Confirm & Continue</span>
                            <i className="fas fa-magic ml-3"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Step1Acquisition;
