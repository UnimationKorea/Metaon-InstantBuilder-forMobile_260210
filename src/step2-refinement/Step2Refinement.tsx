/**
 * =========================================
 * Step 2: 데이터 편집 및 AI 보강 모듈 (Content Refinement)
 * =========================================
 * CRUD 인터페이스 + GenAI 이미지/오디오 생성
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import {
    Step1Output,
    Step2Session,
    ResourceData,
    StackData,
    PageHierarchy,
    ActivityType,
    DataUnit,
    ACTIVITY_TYPES,
    ClassificationConfig,
    DEFAULT_CLASSIFICATION,
    generateId,
    getTimestamp,
    parseCSV,
    validateSegmentMatch,
    detectDataUnit,
    cn,
    stateManager,
    savePageContent,
    fetchStorageMap
} from '@/shared';

interface Step2RefinementProps {
    initialData?: Step1Output | null;
    workingSession?: Step2Session | null;
    onComplete: (data: Step2Session) => void;
    onUpdate?: (data: Step2Session) => void;
    onBack?: () => void;
    engineModel?: string;
    geminiApiKey?: string;
    classificationConfig?: ClassificationConfig;
}

export const Step2Refinement: React.FC<Step2RefinementProps> = ({
    initialData,
    workingSession,
    onComplete,
    onUpdate,
    onBack,
    engineModel = 'gemini-2.0-flash-exp',
    geminiApiKey,
    classificationConfig = DEFAULT_CLASSIFICATION
}) => {
    // 뷰 모드
    const [viewMode, setViewMode] = useState<'ASSET_POOL' | 'PAGE_EDITOR'>(workingSession?.config?.viewMode || 'ASSET_POOL');

    // [FIX] hierarchy 초기화 시 workingSession.hierarchy를 우선 참조
    const [hierarchy, setHierarchy] = useState<PageHierarchy>(
        workingSession?.hierarchy ||
        workingSession?.config?.hierarchy || {
            subject: 'Chinese',
            level: '1',
            set: '1',
            page: '1'
        }
    );

    // 분류 설정 변경 시 계층 구조 유효성 체크 및 동기화
    useEffect(() => {
        const checkAndReset = (val: string, max: number) => {
            const num = parseInt(val);
            return isNaN(num) || num < 1 || num > max;
        };

        let changed = false;
        const newHierarchy = { ...hierarchy };

        const SUBJECT_LIST = ['Hanja', 'Chinese', 'Japanese', 'English', 'Korean'];
        const currentSubjects = SUBJECT_LIST.slice(0, classificationConfig.subjectCount || 5);

        if (!currentSubjects.includes(hierarchy.subject)) {
            newHierarchy.subject = currentSubjects[0] || 'Chinese';
            changed = true;
        }
        if (checkAndReset(hierarchy.level, classificationConfig.label1Count)) {
            newHierarchy.level = '1';
            changed = true;
        }
        if (checkAndReset(hierarchy.set, classificationConfig.label2Count)) {
            newHierarchy.set = '1';
            changed = true;
        }
        if (checkAndReset(hierarchy.page, classificationConfig.label3Count)) {
            newHierarchy.page = '1';
            changed = true;
        }

        if (changed) {
            setHierarchy(newHierarchy);
        }
    }, [classificationConfig]);

    // 글로벌 리소스 (Set 단위)
    const [globalResources, setGlobalResources] = useState<Record<string, ResourceData[]>>(() => {
        // [FIX] workingSession.resources가 존재하고 비어있지 않을 때만 사용
        if (workingSession?.resources && Object.keys(workingSession.resources).length > 0) {
            return workingSession.resources;
        }

        // 메타정보 필터링 패턴
        const metaPatterns = [
            /^(name|date|time|이름|날짜|시간):?\s*$/i,
            /^\d+[a-z]\s*\d*$/i,
            /^(level|page|단원|페이지)/i,
            /따라.*읽/,
            /write.*answer/i,
            /구몬|kefl|kumon/i,
        ];
        const isMetaContent = (text: string) =>
            metaPatterns.some(p => p.test(text.trim()));

        if (initialData?.results) {
            const seenTexts = new Set<string>();
            const resources: ResourceData[] = initialData.results
                .filter(block => block.type !== 'meta' && block.type !== 'title')
                .filter(block => !isMetaContent(block.original))
                .filter(block => {
                    const normalizedText = block.original.trim().toLowerCase();
                    if (seenTexts.has(normalizedText)) return false;
                    seenTexts.add(normalizedText);
                    return true;
                })
                .map(block => ({
                    id: generateId(),
                    text: block.original,
                    subText: block.reading,
                    translation: block.translation,
                    dataUnit: (block.type as DataUnit) || detectDataUnit(block.original),
                    sourceBlockId: block.id,
                    isDirectInput: block.type === 'word' || block.type === 'sentence',
                    imageUrl: block.imageUrl,
                    audioUrl: block.audioUrl
                }));
            // [FIX] 동적 setKey 생성 (hierarchy 기반)
            // workingSession의 hierarchy를 사용하거나, 없으면 기본값 사용
            const h = workingSession?.hierarchy || { subject: 'Chinese', level: '1', set: '1', page: '1' };
            const dynamicSetKey = `${h.subject}-${h.level}-${h.set}`;
            return { [dynamicSetKey]: resources } as Record<string, ResourceData[]>;
        }
        return {} as Record<string, ResourceData[]>;
    });

    // 현재 페이지 고유 키 (예: chinese-3A-Set 1-Page 1)
    const setPageKey = useMemo(() =>
        `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}-${hierarchy.page}`,
        [hierarchy]
    );

    // 전체 페이지 스택 데이터 (전역 저장용)
    const [allStacks, setAllStacks] = useState<Record<string, StackData[]>>(workingSession?.stacks || {});

    // 현재 페이지의 스택 (편집용)
    const [pageStacks, setPageStacks] = useState<StackData[]>(workingSession?.stacks?.[setPageKey] || []);

    // 페이지 변경 시 스택 동기화
    useEffect(() => {
        // 이전 페이지 데이터를 allStacks에 저장 (이미 handleProceed 등에서 반영되지만, 즉시성 확보)
        // 여기서는 페이지가 바뀔 때 current pageStacks를 allStacks에 백업하고 새 페이지 데이터를 로드함
        setPageStacks(allStacks[setPageKey] || []);
    }, [setPageKey]);

    // pageStacks가 변경될 때마다 allStacks에 반영
    useEffect(() => {
        setAllStacks(prev => ({
            ...prev,
            [setPageKey]: pageStacks
        }));
    }, [pageStacks, setPageKey]);

    // 후리가나 처리 유틸리티
    const processFuriganaForTTS = (text: string) => {
        // "漢字(かんじ)" 형태를 "かんじ"로 변환
        return text.replace(/([^\s(（]+)[(（]([^)）]+)[)）]/g, '$2');
    };

    // 데이터 변경 시 상위 컴포넌트 알림
    // 루프 방지를 위한 Ref
    const lastPushedHierarchy = useRef<PageHierarchy | null>(null);

    useEffect(() => {
        const session: Step2Session = {
            sessionId: workingSession?.sessionId || generateId(),
            timestamp: workingSession?.timestamp || getTimestamp(),
            subject: hierarchy.subject,
            hierarchy,
            resources: globalResources,
            stacks: allStacks,
            config: {
                hierarchy,
                viewMode
            },
            validationStatus: { isValid: true, errors: [], warnings: [] }
        };

        lastPushedHierarchy.current = hierarchy;
        onUpdate?.(session);
    }, [globalResources, allStacks, hierarchy, viewMode, onUpdate, workingSession?.sessionId, workingSession?.timestamp]);

    // AI 처리 상태
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [promptModal, setPromptModal] = useState<{
        show: boolean;
        id: string;
        initial: string;
        style: 'illustration' | 'photo';
        situation: string;
    }>({
        show: false,
        id: '',
        initial: '',
        style: 'illustration',
        situation: ''
    });

    // 이미지 확대 모달 (재생성용 resourceId 포함)
    const [imageModal, setImageModal] = useState<{ show: boolean; url: string; text: string; resourceId?: string }>({
        show: false,
        url: '',
        text: ''
    });

    // 음성 생성 모달 (확장된 옵션)
    const [voiceModal, setVoiceModal] = useState<{
        show: boolean;
        id: string;
        text: string;
        voice: 'female' | 'male';
        speed: number;
        pitch: number;
        lang: string;
    }>({
        show: false,
        id: '',
        text: '',
        voice: 'female',
        speed: 1.0,
        pitch: 1.0,
        lang: 'en-US'
    });

    // [CMS 추가] 저장된 페이지 맵 상태
    const [storageMap, setStorageMap] = useState<any[]>([]);

    // 초기 로딩 시와 저장 완료 시 맵 갱신
    const refreshStorageMap = useCallback(async () => {
        const { data } = await fetchStorageMap();
        if (data) setStorageMap(data);
    }, []);

    useEffect(() => {
        refreshStorageMap();
    }, [refreshStorageMap]);

    // 위치 기반 데이터 존재 여부 확인 유틸
    const hasDataAt = (s: string, l: string, sn: string, pn: string) => {
        return storageMap.some(m =>
            m.subject === s && m.level === l && m.set_num === sn && m.page_num === pn
        );
    };

    // [CMS 추가] 외부 세션 데이터(DB 로드 등) 동기화 효과
    // [FIX] sessionId 변경 시에만 동기화하여 무한 루프 방지
    const lastSyncedSessionId = useRef<string | null>(null);

    useEffect(() => {
        if (!workingSession) return;

        // 이미 동기화한 세션이면 스킵 (무한 루프 방지)
        if (lastSyncedSessionId.current === workingSession.sessionId) {
            return;
        }

        console.log('[Step2] Session sync triggered. sessionId:', workingSession.sessionId);
        lastSyncedSessionId.current = workingSession.sessionId;

        // workingSession의 데이터를 로컬 상태로 복원
        if (workingSession.stacks && Object.keys(workingSession.stacks).length > 0) {
            console.log('[Step2] Syncing stacks. setPageKey:', setPageKey);
            console.log('[Step2] Available stack keys:', Object.keys(workingSession.stacks));
            setAllStacks(workingSession.stacks);
            setPageStacks(workingSession.stacks[setPageKey] || []);
        }

        if (workingSession.resources && Object.keys(workingSession.resources).length > 0) {
            setGlobalResources(workingSession.resources);
        }

        if (workingSession.hierarchy) {
            setHierarchy(workingSession.hierarchy);
        }
    }, [workingSession?.sessionId]); // sessionId 변경 시에만 실행

    const csvInputRef = useRef<HTMLInputElement>(null);

    // 현재 Set 키
    const setKey = useMemo(() =>
        `${hierarchy.subject}-${hierarchy.level}-${hierarchy.set}`,
        [hierarchy]
    );

    // 메타정보 필터링 패턴 (공용)
    const metaPatterns = useMemo(() => [
        /^(name|date|time|이름|날짜|시간):?\s*$/i,
        /^\d+[a-z]\s*\d*$/i,
        /^(level|page|단원|페이지)/i,
        /따라.*읽/,
        /write.*answer/i,
        /구몬|kefl|kumon/i,
    ], []);

    const isMetaContent = useCallback((text: string) =>
        metaPatterns.some(p => p.test(text.trim())), [metaPatterns]);

    // 현재 Set의 공용 리소스 (메타정보 필터링)
    const commonResources = useMemo(() =>
        (globalResources[setKey] || []).filter(r =>
            r.dataUnit !== 'meta' && r.dataUnit !== 'title' && !isMetaContent(r.text)
        ),
        [globalResources, setKey, isMetaContent]
    );

    // [Step 2에서는 계층 변경 불가 - Step 3에서만 가능]
    // handleHierarchyChange 함수 제거됨 (읽기 전용 UI로 변경)

    // CSV 임포트
    const handleImportCSV = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target?.result as string;
            const rows = parseCSV(content);

            if (rows.length < 2) {
                alert('데이터가 없거나 잘못된 형식의 CSV 파일입니다.');
                return;
            }

            const headers = rows[0].map(h => h.toLowerCase());
            const textIdx = headers.indexOf('text');
            const pinyinIdx = headers.indexOf('pinyin');
            const transIdx = headers.indexOf('translation');

            if (textIdx === -1 || transIdx === -1) {
                alert("CSV 파일에 'text'와 'translation' 컬럼이 필요합니다.");
                return;
            }

            const newResources: ResourceData[] = rows.slice(1)
                .map(row => ({
                    id: generateId(),
                    text: row[textIdx] || '',
                    subText: pinyinIdx !== -1 ? row[pinyinIdx] : '',
                    translation: row[transIdx] || '',
                    dataUnit: detectDataUnit(row[textIdx] || ''),
                    isDirectInput: true
                }))
                .filter(r => r.text !== '');

            setGlobalResources(prev => ({
                ...prev,
                [setKey]: [...(prev[setKey] || []), ...newResources]
            }));

            alert(`${newResources.length}개의 리소스가 임포트되었습니다.`);
            if (csvInputRef.current) csvInputRef.current.value = '';
        };
        reader.readAsText(file, 'UTF-8');
    }, [setKey]);

    // 리소스 CRUD
    const addCommonResource = useCallback(() => {
        const newRes: ResourceData = {
            id: generateId(),
            text: '',
            translation: '',
            dataUnit: 'word',
            isDirectInput: true
        };
        setGlobalResources(prev => ({
            ...prev,
            [setKey]: [...(prev[setKey] || []), newRes]
        }));
    }, [setKey]);

    const updateCommonResource = useCallback((id: string, updates: Partial<ResourceData>) => {
        setGlobalResources(prev => ({
            ...prev,
            [setKey]: (prev[setKey] || []).map(r => r.id === id ? { ...r, ...updates } : r)
        }));
    }, [setKey]);

    const deleteCommonResource = useCallback((id: string) => {
        setGlobalResources(prev => ({
            ...prev,
            [setKey]: (prev[setKey] || []).filter(r => r.id !== id)
        }));
    }, [setKey]);

    // 스택 관리
    const addStack = useCallback(() => {
        setPageStacks(prev => [...prev, {
            id: generateId(),
            index: prev.length + 1,
            activityType: 'voice_recognition',
            items: []
        }]);
    }, []);

    const updateStack = useCallback((id: string, updates: Partial<StackData>) => {
        setPageStacks(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    }, []);

    const deleteStack = useCallback((id: string) => {
        setPageStacks(prev => prev.filter(s => s.id !== id));
    }, []);

    // AI 이미지 생성
    const generateImageAI = async (id: string, customPrompt: string) => {
        setLoadingId(id);
        try {
            const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyB2P8I8qiGOKwxov4JVlLoDOnbMpTuiae0';
            if (!apiKey) {
                throw new Error('API Key가 설정되지 않았습니다. 설정에서 API Key를 입력해주세요.');
            }
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: `High-quality educational illustration: ${customPrompt}. No text, lettering, words, or characters in the image. Clean background.`,
                config: {
                    numberOfImages: 1,
                    aspectRatio: '1:1'
                }
            });

            if (response.generatedImages?.[0]?.image?.imageBytes) {
                const base64 = response.generatedImages[0].image.imageBytes;
                updateCommonResource(id, { imageUrl: `data:image/png;base64,${base64}`, aiGenerated: true });
            }
        } catch (error) {
            console.error('Image generation failed:', error);
            alert('AI 이미지 생성에 실패했습니다.');
        } finally {
            setLoadingId(null);
            setPromptModal({ show: false, id: '', initial: '', style: 'illustration', situation: '' });
        }
    };

    // 언어 자동 감지 헬퍼
    const detectLang = (text: string): string => {
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN';
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja-JP';
        if (/[가-힣]/.test(text)) return 'ko-KR';
        return 'en-US';
    };

    // 음성 생성 모달 열기
    const openVoiceModal = (id: string) => {
        const resource = commonResources.find(r => r.id === id);
        if (!resource?.text) {
            alert('텍스트를 먼저 입력해주세요.');
            return;
        }
        const detectedLang = detectLang(resource.text);
        setVoiceModal({
            show: true,
            id,
            text: resource.text,
            voice: 'female',
            speed: 1.0,
            pitch: 1.0,
            lang: detectedLang
        });
    };

    // 최적의 목소리 선택 (언어 및 성별 기준)
    const selectBestVoice = (lang: string, gender: 'female' | 'male') => {
        const voices = speechSynthesis.getVoices();
        if (voices.length === 0) return null;

        let langVoices = voices.filter(v => v.lang.replace('_', '-') === lang);
        if (langVoices.length === 0) {
            langVoices = voices.filter(v => v.lang.startsWith(lang.split('-')[0]));
        }

        if (langVoices.length === 0) return null;

        const femaleKeywords = [
            'female', '여성', '여자', 'zira', 'samantha', 'kyoko', 'ayumi', 'haruka',
            'yuna', 'mei-jia', 'sin-ji', 'ting-ting', 'xiaoxiao', 'yuri', 'shizuka', 'karena'
        ];
        const maleKeywords = [
            'male', '남성', '남자', 'david', 'mark', 'ichiro', 'kanta', 'zhi-yu',
            'liang', 'yunxi', 'da-wei', 'shinji', 'takashi'
        ];

        const keywords = gender === 'female' ? femaleKeywords : maleKeywords;
        const match = langVoices.find(v =>
            keywords.some(k => v.name.toLowerCase().includes(k))
        );

        if (match) return match;
        return gender === 'female' ? langVoices[0] : (langVoices[1] || langVoices[0]);
    };

    const generateAudioTTS = async () => {
        const { id, text, voice, speed, pitch, lang } = voiceModal;
        if (!text) return;

        setLoadingId(id);
        const processedText = processFuriganaForTTS(text);

        try {
            const utterance = new SpeechSynthesisUtterance(processedText);
            const bestVoice = selectBestVoice(lang, voice);
            if (bestVoice) utterance.voice = bestVoice;

            utterance.rate = speed;
            utterance.pitch = pitch;
            utterance.lang = lang;

            const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
            const audioContext = new AudioContextClass();
            const destination = audioContext.createMediaStreamDestination();
            const mediaRecorder = new MediaRecorder(destination.stream);
            const chunks: Blob[] = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const url = URL.createObjectURL(blob);
                updateCommonResource(id, { audioUrl: url, aiGenerated: true });
            };

            mediaRecorder.start();
            speechSynthesis.speak(utterance);

            utterance.onend = () => {
                setTimeout(() => {
                    mediaRecorder.stop();
                    audioContext.close();
                }, 100);
            };

            utterance.onerror = () => {
                mediaRecorder.stop();
                audioContext.close();
                updateCommonResource(id, { aiGenerated: true });
                alert('음성이 생성되었습니다.');
            };

        } catch (error) {
            console.error('TTS generation failed:', error);
            alert('음성 생성에 실패했습니다.');
        } finally {
            setLoadingId(null);
        }
    };

    // 음성 미리듣기
    const previewAudioTTS = () => {
        const { text, voice, speed, pitch, lang } = voiceModal;
        if (!text) return;
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const bestVoice = selectBestVoice(lang, voice);
        if (bestVoice) utterance.voice = bestVoice;
        utterance.rate = speed;
        utterance.pitch = pitch;
        utterance.lang = lang;
        speechSynthesis.speak(utterance);
    };

    // AI 스마트 분절
    const handleAiSmartSegment = async (id: string) => {
        const resource = commonResources.find(r => r.id === id);
        if (!resource?.text) return;

        setLoadingId(id);
        try {
            const apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY || 'AIzaSyB2P8I8qiGOKwxov4JVlLoDOnbMpTuiae0';
            if (!apiKey) throw new Error('API Key가 필요합니다.');
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `
        언어 교육 전문가로서 텍스트와 발음을 슬래시('/')를 사용하여 논리적 단위로 분절해주세요.
        과목: ${hierarchy.subject}
        원본 텍스트: "${resource.text.replace(/\//g, '')}"
        현재 발음: "${(resource.subText || '').replace(/\//g, '')}"
        결과는 JSON 형식으로 반환하세요: { "segmentedText": "string", "segmentedSubText": "string" }
      `;

            const response = await ai.models.generateContent({
                model: engineModel || 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });

            const result = JSON.parse(response.text || '{}');
            updateCommonResource(id, {
                text: result.segmentedText || resource.text,
                subText: result.segmentedSubText || resource.subText
            });
        } catch (error) {
            console.error('AI Smart Segment Error:', error);
            alert('AI 스마트 분절 중 오류가 발생했습니다.');
        } finally {
            setLoadingId(null);
        }
    };

    // 데이터 검증
    const validateData = (): { isValid: boolean; errors: string[] } => {
        const errors: string[] = [];
        if (pageStacks.length === 0) errors.push('최소 하나의 스택이 필요합니다.');
        pageStacks.forEach((stack, i) => {
            if (stack.items.length === 0) errors.push(`스택 ${i + 1}에 학습 데이터가 없습니다.`);
            stack.items.forEach((item, j) => {
                if (!item.text) errors.push(`스택 ${i + 1}, 항목 ${j + 1}: 텍스트가 비어있습니다.`);
            });
        });
        return { isValid: errors.length === 0, errors };
    };

    // 다음 단계로 진행
    const handleProceed = async () => {
        const validation = validateData();
        if (!validation.isValid) {
            alert('다음 오류를 수정해주세요:\n\n' + validation.errors.join('\n'));
            return;
        }

        // [CMS] 다음 단계 이동 전 자동 저장
        try {
            await savePageContent(
                hierarchy.subject,
                hierarchy.level,
                hierarchy.set,
                hierarchy.page,
                {
                    stacks: allStacks[setPageKey] || [],
                    resources: globalResources[setKey] || []
                }
            );
            console.log('[CMS] Auto-saved page content before proceeding:', setPageKey);
        } catch (err) {
            console.error('[CMS] Auto-save failed:', err);
            // 자동 저장 실패해도 진행은 허용 (선택적)
        }

        const session: Step2Session = {
            sessionId: workingSession?.sessionId || generateId(),
            timestamp: getTimestamp(),
            subject: hierarchy.subject,
            hierarchy,
            resources: globalResources,
            stacks: allStacks,
            config: {
                viewMode,
                hierarchy
            },
            validationStatus: { isValid: true, errors: [], warnings: [] }
        };
        onComplete(session);
    };

    const [isSyncing, setIsSyncing] = useState(false);

    // [추가] 임시 DB 저장 핸들러
    const handleTempDBSave = async () => {
        setIsSyncing(true);
        try {
            // 현재 상태 갈무리하여 stateManager 업데이트
            const session: Step2Session = {
                sessionId: workingSession?.sessionId || generateId(),
                timestamp: getTimestamp(),
                subject: hierarchy.subject,
                hierarchy,
                resources: globalResources,
                stacks: allStacks,
                config: {
                    viewMode,
                    hierarchy
                },
                validationStatus: { isValid: true, errors: [], warnings: [] }
            };

            stateManager.setStep2Data(session);

            // [CMS 추가] 현재 위치에 데이터가 있는지 확인하고 덮어쓰기 경고
            if (hasDataAt(hierarchy.subject, hierarchy.level, hierarchy.set, hierarchy.page)) {
                if (!window.confirm(`${setPageKey} 위치에 이미 데이터가 존재합니다. 덮어쓰시겠습니까?`)) {
                    setIsSyncing(false);
                    return;
                }
            }

            // 개별 페이지 저장 호출
            console.log('[Step2 DB Save] setKey:', setKey, 'setPageKey:', setPageKey);
            console.log('[Step2 DB Save] globalResources keys:', Object.keys(globalResources));
            console.log('[Step2 DB Save] globalResources[setKey] count:', (globalResources[setKey] || []).length);
            console.log('[Step2 DB Save] stacks[setPageKey] count:', (allStacks[setPageKey] || []).length);

            const { error: dbError } = await savePageContent(
                hierarchy.subject,
                hierarchy.level,
                hierarchy.set,
                hierarchy.page,
                {
                    stacks: allStacks[setPageKey] || [],
                    resources: globalResources[setKey] || []
                }
            );

            if (dbError) throw dbError;

            // 저장 후 맵 갱신
            await refreshStorageMap();
            alert('현재 편집 상태가 Supabase DB에 개별 저장되었습니다.');
        } catch (error: any) {
            console.error('Step2 Save Error:', error);
            alert(`저장 실패: ${error.message || 'Unknown error'}`);
        } finally {
            setIsSyncing(false);
        }
    };

    // JSON 다운로드
    const exportJSON = () => {
        const data = { exportedAt: getTimestamp(), hierarchy, globalResources, pageStacks };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `edu_architect_${setKey}_P${hierarchy.page}.json`;
        link.click();
    };

    // CSV 다운로드
    const exportCSV = () => {
        const isAssetPool = viewMode === 'ASSET_POOL';
        const labels = classificationConfig || DEFAULT_CLASSIFICATION;

        const headers = isAssetPool
            ? ['ID', 'Unit', 'Text', 'SubText', 'Translation']
            : [labels.subject || 'Subject', labels.label1, labels.label2, labels.label3, 'Stack_Idx', 'Activity', 'Unit', 'Text', 'SubText', 'Translation'];

        const rows: string[][] = [];
        if (isAssetPool) {
            commonResources.forEach((res, idx) => {
                rows.push([String(idx + 1), res.dataUnit.toUpperCase(), `"${res.text}"`, `"${res.subText || ''}"`, `"${res.translation}"`]);
            });
        } else {
            pageStacks.forEach((stack, sIdx) => {
                stack.items.forEach(item => {
                    rows.push([
                        hierarchy.subject,
                        hierarchy.level,
                        hierarchy.set,
                        hierarchy.page,
                        String(sIdx + 1),
                        stack.activityType,
                        item.dataUnit.toUpperCase(),
                        `"${item.text}"`,
                        `"${item.subText || ''}"`,
                        `"${item.translation}"`
                    ]);
                });
            });
        }

        if (rows.length === 0) {
            alert(isAssetPool ? '내보낼 어셋 데이터가 없습니다.' : '내보낼 페이지 데이터가 없습니다.');
            return;
        }

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = isAssetPool ? `edu_asset_pool_${setKey}.csv` : `edu_page_data_${setKey}_P${hierarchy.page}.csv`;
        link.click();
    };

    const subLabel = hierarchy.subject === 'chinese' ? '병음' :
        hierarchy.subject === 'japanese' ? '후리가나' : null;

    return (
        <div className="space-y-8 animate-fade-in">
            {/* 헤더 */}
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-lg shadow-lg shadow-blue-200">
                            2
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 tracking-tight">데이터 편집</h2>
                    </div>
                    <p className="text-slate-500 font-medium ml-13">
                        추출된 데이터를 검수하고 AI로 보강합니다
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {onBack && (
                        <button onClick={onBack} className="btn-secondary">
                            <i className="fas fa-arrow-left mr-2"></i>
                            이전
                        </button>
                    )}
                    <button onClick={exportJSON} className="p-3 hover:bg-slate-100 rounded-xl transition-all" title="JSON 다운로드">
                        <i className="fas fa-file-code text-slate-500"></i>
                    </button>
                    <button onClick={exportCSV} className="p-3 hover:bg-slate-100 rounded-xl transition-all" title="CSV 다운로드">
                        <i className="fas fa-file-csv text-slate-500"></i>
                    </button>
                    <button
                        onClick={handleTempDBSave}
                        disabled={isSyncing}
                        className={cn(
                            "flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-sm transition-all shadow-lg",
                            isSyncing
                                ? "bg-slate-100 text-slate-400 cursor-wait"
                                : "bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.02] active:scale-[0.98]"
                        )}
                        title="Supabase DB에 현재 상태 저장"
                    >
                        <i className={cn("fas", isSyncing ? "fa-spinner fa-spin" : "fa-database")}></i>
                        {isSyncing ? "저장 중..." : "DB 저장"}
                    </button>
                    <button onClick={handleProceed} className="btn-success flex items-center gap-2">
                        <i className="fas fa-check"></i>
                        검증 완료 & 다음
                    </button>
                </div>
            </div>

            {/* 뷰 모드 탭 */}
            <div className="flex bg-slate-100 p-1 rounded-2xl w-fit">
                <button
                    onClick={() => setViewMode('ASSET_POOL')}
                    className={cn(
                        'px-8 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2',
                        viewMode === 'ASSET_POOL'
                            ? 'bg-emerald-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700'
                    )}
                >
                    <i className="fas fa-database"></i>
                    ASSET POOL ({commonResources.length})
                </button>
                <button
                    onClick={() => setViewMode('PAGE_EDITOR')}
                    className={cn(
                        'px-8 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2',
                        viewMode === 'PAGE_EDITOR'
                            ? 'bg-indigo-600 text-white shadow-md'
                            : 'text-slate-500 hover:text-slate-700'
                    )}
                >
                    <i className="fas fa-edit"></i>
                    PAGE EDITOR
                </button>
            </div>

            {/* ASSET POOL 뷰 */}
            {viewMode === 'ASSET_POOL' && (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-2xl font-black text-slate-900">Set Asset Pool</h3>
                            <p className="text-slate-500 text-sm font-medium">
                                범위: <span className="text-emerald-600 font-bold">{setKey}</span>
                            </p>
                        </div>
                        <div className="flex gap-3">
                            <input type="file" ref={csvInputRef} className="hidden" accept=".csv" onChange={handleImportCSV} />
                            <button
                                onClick={() => csvInputRef.current?.click()}
                                className="btn-secondary flex items-center gap-2"
                            >
                                <i className="fas fa-file-upload"></i>
                                CSV 임포트
                            </button>
                            <button onClick={addCommonResource} className="btn-success flex items-center gap-2">
                                <i className="fas fa-plus"></i>
                                새 어셋
                            </button>
                        </div>
                    </div>

                    {commonResources.length === 0 ? (
                        <div className="card p-16 text-center">
                            <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-database text-4xl text-slate-300"></i>
                            </div>
                            <p className="text-slate-400 font-bold">어셋 풀이 비어있습니다</p>
                            <p className="text-slate-300 text-sm mt-1">CSV를 임포트하거나 새 어셋을 추가하세요</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {commonResources.map((res, idx) => (
                                <ResourceCard
                                    key={res.id}
                                    index={idx}
                                    data={res}
                                    subLabel={subLabel}
                                    isLoading={loadingId === res.id}
                                    onUpdate={(updates) => updateCommonResource(res.id, updates)}
                                    onDelete={() => deleteCommonResource(res.id)}
                                    onAiSegment={() => handleAiSmartSegment(res.id)}
                                    onAiImage={() => setPromptModal({ show: true, id: res.id, initial: res.text, style: 'illustration', situation: '' })}
                                    onAiAudio={() => openVoiceModal(res.id)}
                                    onImageClick={(url, text) => setImageModal({ show: true, url, text, resourceId: res.id })}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* PAGE EDITOR 뷰 */}
            {viewMode === 'PAGE_EDITOR' && (
                <div className="space-y-6">
                    {/* 계층 선택 (읽기 전용) */}
                    <div className="card p-6 flex flex-wrap items-center gap-6 bg-slate-900 text-white">
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-white/50 uppercase tracking-wider block mb-2">{classificationConfig.subject}</label>
                            <div className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 text-sm font-bold text-white/90 flex items-center justify-between">
                                <span>{hierarchy.subject}</span>
                                <i className="fas fa-lock text-white/30 text-xs"></i>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-white/50 uppercase tracking-wider block mb-2">{classificationConfig.label1}</label>
                            <div className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 text-sm font-bold text-white/90 flex items-center justify-between">
                                <span>{hierarchy.level}</span>
                                <i className="fas fa-lock text-white/30 text-xs"></i>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-white/50 uppercase tracking-wider block mb-2">{classificationConfig.label2}</label>
                            <div className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 text-sm font-bold text-white/90 flex items-center justify-between">
                                <span>{hierarchy.set}</span>
                                <i className="fas fa-lock text-white/30 text-xs"></i>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="text-[10px] font-black text-white/50 uppercase tracking-wider block mb-2">{classificationConfig.label3}</label>
                            <div className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 text-sm font-bold text-white/90 flex items-center justify-between">
                                <span>{hierarchy.page}</span>
                                <i className="fas fa-lock text-white/30 text-xs"></i>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black text-white/30 uppercase">Live Workspace</p>
                            <p className="text-sm font-black text-blue-400">{setKey} {hierarchy.page}</p>
                            <p className="text-[9px] text-amber-400/70 mt-1 flex items-center gap-1">
                                <i className="fas fa-info-circle"></i>
                                <span>Step 3에서 위치 변경 가능</span>
                            </p>
                        </div>
                    </div>

                    {/* 스택 목록 */}
                    <div className="space-y-6">
                        {pageStacks.map((stack, idx) => (
                            <div key={stack.id} className="card overflow-hidden">
                                <div className="card-header flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white font-black text-xl">
                                        {idx + 1}
                                    </div>
                                    <select
                                        value={stack.activityType}
                                        onChange={(e) => updateStack(stack.id, { activityType: e.target.value as ActivityType })}
                                        className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none min-w-[200px]"
                                    >
                                        {ACTIVITY_TYPES.map(type => (
                                            <option key={type.id} value={type.id}>
                                                {type.label}
                                            </option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => deleteStack(stack.id)}
                                        className="ml-auto p-2 text-slate-300 hover:text-red-500 transition-colors"
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                </div>

                                <div
                                    className="divide-y divide-slate-100 min-h-[100px]"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        const resourceId = e.dataTransfer.getData('resourceId');
                                        if (!resourceId) return;
                                        const res = commonResources.find(r => r.id === resourceId);
                                        if (!res) return;
                                        const newItem = {
                                            id: generateId(),
                                            text: res.text,
                                            subText: res.subText || '',
                                            translation: res.translation,
                                            dataUnit: res.dataUnit
                                        };
                                        updateStack(stack.id, { items: [...stack.items, newItem] });
                                    }}
                                >
                                    {stack.items.map((item, i) => (
                                        <div key={item.id} className="p-6 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <span className="text-sm font-bold text-slate-400">#{i + 1}</span>

                                                {/* Asset Pool 드롭다운 선택 */}
                                                <div className="flex-1">
                                                    <select
                                                        value={item.text}
                                                        onChange={(e) => {
                                                            const selectedText = e.target.value;
                                                            const selectedResource = commonResources.find(r => r.text === selectedText);
                                                            const newItems = [...stack.items];
                                                            newItems[i] = {
                                                                ...newItems[i],
                                                                text: selectedText,
                                                                subText: selectedResource?.subText || '',
                                                                translation: selectedResource?.translation || item.translation,
                                                                dataUnit: selectedResource?.dataUnit || item.dataUnit
                                                            };
                                                            updateStack(stack.id, { items: newItems });
                                                        }}
                                                        className="input-field w-full"
                                                    >
                                                        <option value="">-- Asset Pool에서 선택 --</option>
                                                        {commonResources.map(res => (
                                                            <option key={res.id} value={res.text}>
                                                                {res.text} {res.subText ? `(${res.subText})` : ''}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        const newItems = stack.items.filter(it => it.id !== item.id);
                                                        updateStack(stack.id, { items: newItems });
                                                    }}
                                                    className="p-2 text-slate-300 hover:text-red-500 transition-all"
                                                >
                                                    <i className="fas fa-times-circle"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {stack.items.length === 0 && (
                                        <div className="p-8 text-center bg-slate-50/50">
                                            <p className="text-slate-400 text-sm font-medium">학습 데이터가 없습니다. 아래 버튼으로 추가하거나 어셋에서 끌어오세요.</p>
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 bg-slate-50 flex justify-center gap-4">
                                    <button
                                        onClick={() => {
                                            const newItem = {
                                                id: generateId(),
                                                text: '',
                                                subText: '',
                                                translation: '',
                                                dataUnit: 'word' as DataUnit
                                            };
                                            updateStack(stack.id, { items: [...stack.items, newItem] });
                                        }}
                                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
                                    >
                                        <i className="fas fa-plus-circle"></i> 항목 직접 추가
                                    </button>
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={addStack}
                            className="w-full py-6 border-2 border-dashed border-slate-200 rounded-3xl text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all flex flex-col items-center gap-2 group"
                        >
                            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-all">
                                <i className="fas fa-layer-group text-xl"></i>
                            </div>
                            <span className="font-black text-sm">새 활동 스택 추가</span>
                        </button>
                    </div>
                </div>
            )}

            {/* AI 이미지 프롬프트 모달 */}
            {promptModal.show && (
                <div className="modal-overlay">
                    <div className="modal-content animate-slide-up" style={{ maxWidth: '500px' }}>
                        <div className="p-8">
                            <h3 className="text-2xl font-black text-slate-900 mb-6">AI 이미지 생성</h3>
                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Base Text</label>
                                    <div className="bg-slate-50 px-4 py-3 rounded-xl font-bold text-slate-700">{promptModal.initial}</div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Style</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => setPromptModal({ ...promptModal, style: 'illustration' })}
                                            className={cn(
                                                'px-4 py-3 rounded-xl border-2 font-bold text-sm transition-all',
                                                promptModal.style === 'illustration' ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-slate-100 text-slate-400 hover:border-slate-200'
                                            )}
                                        >
                                            Illustration
                                        </button>
                                        <button
                                            onClick={() => setPromptModal({ ...promptModal, style: 'photo' })}
                                            className={cn(
                                                'px-4 py-3 rounded-xl border-2 font-bold text-sm transition-all',
                                                promptModal.style === 'photo' ? 'border-indigo-600 bg-indigo-50 text-indigo-600' : 'border-slate-100 text-slate-400 hover:border-slate-200'
                                            )}
                                        >
                                            Realistic
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Extra Situation (Optional)</label>
                                    <textarea
                                        value={promptModal.situation}
                                        onChange={(e) => setPromptModal({ ...promptModal, situation: e.target.value })}
                                        placeholder="e.g. A happy children playing in the park..."
                                        className="input-field w-full h-24 resize-none"
                                    />
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <button onClick={() => setPromptModal({ ...promptModal, show: false })} className="btn-secondary flex-1">취소</button>
                                    <button
                                        onClick={() => generateImageAI(promptModal.id, `${promptModal.initial}, ${promptModal.style} style, ${promptModal.situation}`)}
                                        className={cn("btn-primary flex-1 gradient-indigo", loadingId === promptModal.id && "opacity-50 pointer-events-none")}
                                        disabled={loadingId === promptModal.id}
                                    >
                                        {loadingId === promptModal.id ? '생성 중...' : '생성하기'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* AI 음성 생성 모달 (확장) */}
            {voiceModal.show && (
                <div className="modal-overlay" onClick={() => setVoiceModal({ ...voiceModal, show: false })}>
                    <div className="modal-content relative animate-slide-up" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
                        {/* 우측 상단 나가기 버튼 */}
                        <button
                            onClick={() => setVoiceModal({ ...voiceModal, show: false })}
                            className="absolute top-4 right-4 w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all z-10"
                        >
                            <i className="fas fa-times text-xl"></i>
                        </button>

                        <div className="p-8">
                            <h3 className="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3">
                                <i className="fas fa-microphone-alt text-blue-500"></i>
                                AI 음성 설정
                            </h3>

                            <div className="space-y-6">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">대상 텍스트</label>
                                    <p className="bg-slate-50 p-4 rounded-xl font-bold text-slate-800 border border-slate-100">{voiceModal.text}</p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">언어 (Speech Language)</label>
                                        <select
                                            value={voiceModal.lang}
                                            onChange={(e) => setVoiceModal({ ...voiceModal, lang: e.target.value })}
                                            className="input-field w-full"
                                        >
                                            <option value="ko-KR">한국어 (Korean)</option>
                                            <option value="en-US">영어 (US English)</option>
                                            <option value="en-GB">영어 (UK English)</option>
                                            <option value="zh-CN">중국어 (Chinese Simplified)</option>
                                            <option value="ja-JP">일본어 (Japanese)</option>
                                            <option value="es-ES">스페인어 (Spanish)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">성별</label>
                                        <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                                            <button
                                                onClick={() => setVoiceModal({ ...voiceModal, voice: 'female' })}
                                                className={cn(
                                                    'py-2 px-3 rounded-lg text-xs font-bold transition-all',
                                                    voiceModal.voice === 'female' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'
                                                )}
                                            >
                                                여성
                                            </button>
                                            <button
                                                onClick={() => setVoiceModal({ ...voiceModal, voice: 'male' })}
                                                className={cn(
                                                    'py-2 px-3 rounded-lg text-xs font-bold transition-all',
                                                    voiceModal.voice === 'male' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'
                                                )}
                                            >
                                                남성
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">속도 (Speed)</label>
                                            <span className="text-xs font-bold text-blue-600">{voiceModal.speed.toFixed(1)}x</span>
                                        </div>
                                        <input
                                            type="range" min="0.5" max="2.0" step="0.1"
                                            value={voiceModal.speed}
                                            onChange={(e) => setVoiceModal({ ...voiceModal, speed: parseFloat(e.target.value) })}
                                            className="w-full accent-blue-600"
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">피치 (Pitch)</label>
                                            <span className="text-xs font-bold text-blue-600">{voiceModal.pitch.toFixed(1)}</span>
                                        </div>
                                        <input
                                            type="range" min="0.5" max="2.0" step="0.1"
                                            value={voiceModal.pitch}
                                            onChange={(e) => setVoiceModal({ ...voiceModal, pitch: parseFloat(e.target.value) })}
                                            className="w-full accent-indigo-600"
                                        />
                                    </div>
                                </div>

                                <div className="flex gap-3 pt-4">
                                    <button onClick={previewAudioTTS} className="btn-secondary flex-1 flex items-center justify-center gap-2">
                                        <i className="fas fa-play"></i>
                                        미리듣기
                                    </button>
                                    <button
                                        onClick={generateAudioTTS}
                                        className={cn("btn-primary flex-1 bg-blue-600 hover:bg-blue-700 shadow-blue-100 flex items-center justify-center gap-2", loadingId === voiceModal.id && "opacity-50 pointer-events-none")}
                                        disabled={loadingId === voiceModal.id}
                                    >
                                        <i className={loadingId === voiceModal.id ? "fas fa-spinner fa-spin" : "fas fa-save"}></i>
                                        {loadingId === voiceModal.id ? '생성 중...' : '음성 생성 & 저장'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 이미지 확대 모달 */}
            {imageModal.show && (
                <div className="modal-overlay" onClick={() => setImageModal({ ...imageModal, show: false })}>
                    <div className="modal-content overflow-hidden rounded-3xl" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', backgroundColor: 'transparent', boxShadow: 'none' }}>
                        <div className="relative group">
                            <img src={imageModal.url} alt="" className="w-full aspect-square object-cover rounded-3xl shadow-2xl" />
                            <div className="absolute inset-x-0 bottom-0 p-8 bg-gradient-to-t from-black/80 to-transparent">
                                <p className="text-white font-black text-2xl mb-2">{imageModal.text}</p>
                                <div className="flex items-center gap-4">
                                    <button
                                        onClick={() => {
                                            const link = document.createElement('a');
                                            link.href = imageModal.url;
                                            link.download = `edu_img_${imageModal.text}.png`;
                                            link.click();
                                        }}
                                        className="text-white/70 hover:text-white transition-colors text-sm font-bold flex items-center gap-2"
                                    >
                                        <i className="fas fa-download"></i> 이미지 다운로드
                                    </button>
                                    {imageModal.resourceId && (
                                        <button
                                            onClick={() => {
                                                setImageModal({ ...imageModal, show: false });
                                                setPromptModal({ show: true, id: imageModal.resourceId!, initial: imageModal.text, style: 'illustration', situation: '' });
                                            }}
                                            className="text-white/70 hover:text-white transition-colors text-sm font-bold flex items-center gap-2"
                                        >
                                            <i className="fas fa-redo"></i> 다시 생성하기
                                        </button>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setImageModal({ ...imageModal, show: false })}
                                className="absolute top-4 right-4 w-12 h-12 rounded-2xl bg-black/20 backdrop-blur-md text-white hover:bg-black/40 transition-all flex items-center justify-center"
                            >
                                <i className="fas fa-times text-xl"></i>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- Sub Components ---

interface ResourceCardProps {
    index: number;
    data: ResourceData;
    subLabel: string | null;
    isLoading: boolean;
    onUpdate: (updates: Partial<ResourceData>) => void;
    onDelete: () => void;
    onAiSegment: () => void;
    onAiImage: () => void;
    onAiAudio: () => void;
    onImageClick?: (url: string, text: string) => void;
}

const ResourceCard: React.FC<ResourceCardProps> = ({
    index,
    data,
    subLabel,
    isLoading,
    onUpdate,
    onDelete,
    onAiSegment,
    onAiImage,
    onAiAudio,
    onImageClick
}) => {
    const isMismatch = data.text && data.subText ? !validateSegmentMatch(data.text, data.subText) : false;
    const imageInputRef = useRef<HTMLInputElement>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);

    return (
        <div
            draggable
            onDragStart={(e) => e.dataTransfer.setData('resourceId', data.id)}
            className={cn(
                'card p-6 flex items-center gap-6 group hover:shadow-xl hover:shadow-slate-200/50 transition-all relative cursor-grab active:cursor-grabbing',
                isLoading && 'opacity-60 pointer-events-none'
            )}
        >
            <div className="w-12 text-center flex flex-col items-center gap-1">
                <i className="fas fa-grip-vertical text-slate-200 group-hover:text-slate-400 transition-colors"></i>
                <span className="text-xs font-black text-slate-300">#{index + 1}</span>
            </div>

            <div className="flex-1 grid grid-cols-12 gap-4">
                {/* 메인 텍스트 */}
                <div className="col-span-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Text</label>
                    <input
                        type="text"
                        value={data.text}
                        onChange={(e) => onUpdate({ text: e.target.value })}
                        className="w-full bg-white border border-slate-100 rounded-xl px-4 py-2 font-serif text-lg font-bold text-slate-800 focus:border-indigo-500 outline-none transition-all shadow-input"
                    />
                </div>

                {/* 서브 텍스트 (병음/후리가나) */}
                <div className="col-span-4">
                    <div className="flex justify-between items-center mb-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{subLabel || 'SubText'}</label>
                        <button
                            onClick={onAiSegment}
                            className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full transition-all"
                        >
                            <i className="fas fa-magic mr-1"></i> AI 분절
                        </button>
                    </div>
                    <input
                        type="text"
                        value={data.subText || ''}
                        onChange={(e) => onUpdate({ subText: e.target.value })}
                        placeholder={subLabel ? `${subLabel} 입력...` : '-'}
                        className={cn(
                            "w-full bg-white border rounded-xl px-4 py-2 text-sm text-slate-500 focus:border-indigo-500 outline-none transition-all shadow-input",
                            isMismatch ? 'border-amber-300 bg-amber-50/30' : 'border-slate-100'
                        )}
                    />
                </div>

                {/* 번역 */}
                <div className="col-span-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Translation</label>
                    <input
                        type="text"
                        value={data.translation}
                        onChange={(e) => onUpdate({ translation: e.target.value })}
                        className="w-full bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-sm font-bold text-slate-600 focus:border-indigo-500 outline-none transition-all"
                    />
                </div>
            </div>

            {/* 액션 컨트롤 */}
            <div className="flex items-center gap-2 pl-4 border-l border-slate-100">
                <div className="flex items-center gap-1">
                    {/* 이미지 */}
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                const url = URL.createObjectURL(file);
                                onUpdate({ imageUrl: url, imageFile: file.name });
                            }
                        }}
                    />
                    <button
                        onClick={() => {
                            if (data.imageUrl && onImageClick) {
                                onImageClick(data.imageUrl, data.text);
                            } else {
                                onAiImage();
                            }
                        }}
                        className={cn(
                            'w-11 h-11 rounded-xl border flex items-center justify-center transition-all',
                            data.imageUrl
                                ? 'bg-emerald-600 border-emerald-600 text-white cursor-zoom-in'
                                : 'bg-white text-slate-300 border-slate-200 hover:border-indigo-400 hover:text-indigo-500'
                        )}
                        title={data.imageUrl ? "이미지 크게 보기 (길게 누르면 재생성)" : "AI 이미지 생성"}
                    >
                        {data.imageUrl ? (
                            <img src={data.imageUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                        ) : (
                            <i className="fas fa-image"></i>
                        )}
                    </button>

                    {/* 오디오 */}
                    <input
                        ref={audioInputRef}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                                const url = URL.createObjectURL(file);
                                onUpdate({ audioUrl: url, audioFile: file.name });
                            }
                        }}
                    />
                    <button
                        onClick={onAiAudio}
                        className={cn(
                            'w-11 h-11 rounded-xl border flex items-center justify-center transition-all',
                            data.audioUrl
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white text-slate-300 border-slate-200 hover:border-blue-400 hover:text-blue-500'
                        )}
                        title="AI 음성 생성"
                    >
                        <i className={data.audioUrl ? 'fas fa-volume-up' : 'fas fa-microphone'}></i>
                    </button>

                    {/* 삭제 */}
                    <button
                        onClick={onDelete}
                        className="w-11 h-11 rounded-xl text-slate-200 hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center"
                    >
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            </div>

            {/* 로딩 오버레이 */}
            {isLoading && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-3xl">
                    <div className="flex flex-col items-center gap-2">
                        <div className="spinner"></div>
                        <span className="text-xs font-bold text-indigo-600">AI 처리 중...</span>
                    </div>
                </div>
            )}

            {/* 세그먼트 불일치 경고 */}
            {isMismatch && (
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[9px] font-bold px-4 py-1 rounded-full shadow-lg flex items-center gap-2">
                    <i className="fas fa-exclamation-circle"></i>
                    원문과 발음의 세그먼트(/) 개수가 일치하지 않습니다
                </div>
            )}
        </div>
    );
};

export default Step2Refinement;
