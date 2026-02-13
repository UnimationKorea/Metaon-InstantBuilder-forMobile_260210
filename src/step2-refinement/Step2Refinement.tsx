/**
 * =========================================
 * Step 2: 데이터 편집 및 AI 보강 모듈 (Content Refinement)
 * =========================================
 * CRUD 인터페이스 + GenAI 이미지/오디오 생성
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GoogleGenerativeAI } from '@google/generative-ai';
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
    validateSegmentMatch,
    cn,
    stateManager,
    savePageContent,
    fetchStorageMap,
    fetchGlobalConfig
} from '@/shared';

interface Step2RefinementProps {
    initialData?: Step1Output | null;
    workingSession?: Step2Session | null;
    onComplete: (data: Step2Session) => void;
    onUpdate?: (data: Step2Session) => void;
    geminiApiKey?: string;
    classificationConfig?: ClassificationConfig;
    onDirtyChange?: (dirty: boolean) => void;
}

export const Step2Refinement: React.FC<Step2RefinementProps> = ({
    initialData,
    workingSession,
    onComplete,
    onUpdate,
    geminiApiKey,
    classificationConfig = DEFAULT_CLASSIFICATION,
    onDirtyChange
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

    // [FIX] 무한 루프 방지를 위한 onUpdate Ref 관리
    const onUpdateRef = useRef(onUpdate);
    useEffect(() => {
        onUpdateRef.current = onUpdate;
    }, [onUpdate]);

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
        // [FIX] initialData(Step 1 신규 데이터)가 있으면 최우선 사용
        if (initialData?.aggregatedSet) {
            const agg = initialData.aggregatedSet;
            const allItems: ResourceData[] = [];

            // 추출 단어
            (agg.extractedVocabulary || []).forEach(item => {
                allItems.push({
                    id: generateId(),
                    text: item.text,
                    subText: item.reading || item.pronunciation,
                    translation: item.translation,
                    dataUnit: 'word' as DataUnit,
                    isDirectInput: false,
                    imageUrl: item.imageUrl,
                    audioUrl: item.audioUrl
                });
            });

            // 추출 문장
            (agg.extractedSentences || []).forEach(item => {
                allItems.push({
                    id: generateId(),
                    text: item.text,
                    subText: item.reading || item.pronunciation,
                    translation: item.translation,
                    dataUnit: 'sentence' as DataUnit,
                    isDirectInput: false,
                    imageUrl: item.imageUrl,
                    audioUrl: item.audioUrl
                });
            });

            // 관련 단어 (AI 추천)
            (agg.relatedVocabulary || []).forEach(item => {
                allItems.push({
                    id: generateId(),
                    text: item.text,
                    subText: item.reading || item.pronunciation,
                    translation: item.translation,
                    dataUnit: 'word' as DataUnit,
                    aiGenerated: true,
                    imageUrl: item.imageUrl,
                    audioUrl: item.audioUrl
                });
            });

            // 관련 문장 (AI 추천)
            (agg.relatedSentences || []).forEach(item => {
                allItems.push({
                    id: generateId(),
                    text: item.text,
                    subText: item.reading || item.pronunciation,
                    translation: item.translation,
                    dataUnit: 'sentence' as DataUnit,
                    aiGenerated: true,
                    imageUrl: item.imageUrl,
                    audioUrl: item.audioUrl
                });
            });

            const h = workingSession?.hierarchy || hierarchy;
            const dynamicSetKey = `${h.subject}-${h.level}-${h.set}`;
            return { [dynamicSetKey]: allItems } as Record<string, ResourceData[]>;
        }

        // [FIX] workingSession(기존 세션) 사용
        if (workingSession?.resources && Object.keys(workingSession.resources).length > 0) {
            return workingSession.resources;
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

    // 데이터 편집 감지 → 미저장 상태(dirty) 알림
    const isMountedRef = useRef(false);
    useEffect(() => {
        if (!isMountedRef.current) {
            isMountedRef.current = true;
            return;
        }
        onDirtyChange?.(true);
    }, [globalResources, pageStacks]);

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

        // [FIX] 실제로 데이터가 변경되었을 때만 업데이트 알림 (얕은 비교 등으로 루프 중단 보조)
        // onUpdateRef를 사용하여 dependency array에서 onUpdate를 제거함 (무한 루프 차단 핵심)
        onUpdateRef.current?.(session);
    }, [globalResources, allStacks, hierarchy, viewMode, workingSession?.sessionId, workingSession?.timestamp]);

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

    // AI 음색 설정 관리 (활성화된 하단 패널 ID)
    const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);

    // [변경] voiceModal 상태 제거 (ResourceData 내부 voiceSettings 사용)

    // [추가] 스택 클립보드 (아이템 재사용용)
    const [stackClipboard, setStackClipboard] = useState<ResourceData[]>([]);

    const copyStackItems = (items: ResourceData[]) => {
        setStackClipboard(items);
        // 간단한 알림 (Toast UI가 없으므로)
    };

    const pasteStackItems = (stackId: string) => {
        if (stackClipboard.length === 0) return;

        const newItems = stackClipboard.map(item => ({
            ...item,
            id: generateId() // 고유 ID 새로 생성
        }));

        setPageStacks(prev => prev.map(s =>
            s.id === stackId ? { ...s, items: [...s.items, ...newItems] } : s
        ));
    };

    const duplicateStack = (stack: StackData) => {
        const newStack: StackData = {
            ...stack,
            id: generateId(),
            index: pageStacks.length + 1,
            items: stack.items.map(item => ({ ...item, id: generateId() }))
        };
        setPageStacks(prev => [...prev, newStack]);
    };

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

        // [FIX] initialData(신규 수집 데이터)가 있는 경우, 외부 세션으로부터의 동기화(DB 로드 등)를 차단함
        // 단, 계층 정보(hierarchy)가 변경되었다면 사용자가 페이지를 이동한 것이므로 동기화를 허용해야 함
        const isHierarchyChanged = hierarchy && (
            workingSession.hierarchy.subject !== hierarchy.subject ||
            workingSession.hierarchy.level !== hierarchy.level ||
            workingSession.hierarchy.set !== hierarchy.set ||
            workingSession.hierarchy.page !== hierarchy.page
        );

        if (initialData && !isHierarchyChanged) {
            console.log('[Step2] initialData exists on same hierarchy. Blocking external session sync.');
            return;
        }

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
            let apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey) {
                const { data: remoteKey } = await fetchGlobalConfig('gemini_api_key');
                if (remoteKey) apiKey = remoteKey;
            }

            if (!apiKey) {
                apiKey = 'AIzaSyB2P8I8qiGOKwxov4JVlLoDOnbMpTuiae0';
            }

            if (!apiKey) {
                throw new Error('API Key가 설정되지 않았습니다. 설정이나 DB에서 API Key를 확인해주세요.');
            }
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
            // imagen is often separate, but we ensure the SDK initialization is standardized
            // For now, we standardize the SDK access to avoid 404 on initialization
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: `High-quality educational illustration: ${customPrompt}. No text, lettering, words, or characters in the image. Clean background.` }] }]
            });
            const response = await result.response;

            // Image generation response processing (placeholder for future actual implementation)
            const responseText = response.text();
            console.log('AI Response for image:', responseText);
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
        // [변경] 일본어 감지 우선순위 상향 (한자가 중국어로 오인되는 것 방지)
        if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja-JP';
        if (/[\u4e00-\u9fa5]/.test(text)) return 'zh-CN';
        if (/[가-힣]/.test(text)) return 'ko-KR';
        return 'en-US';
    };

    // 음성 설정 패널 토글 및 초기화
    const toggleVoiceStudio = (id: string) => {
        if (activeVoiceId === id) {
            setActiveVoiceId(null);
            return;
        }

        const resource = commonResources.find(r => r.id === id);
        if (!resource?.text) {
            alert('텍스트를 먼저 입력해주세요.');
            return;
        }

        // 이미 설정이 있으면 패널만 열기
        if (resource.voiceSettings) {
            setActiveVoiceId(id);
            return;
        }

        // 초기 설정 생성 (과목 기반 언어 맵 작성 - 소문자로 통일하여 비교)
        const subKey = hierarchy.subject.toLowerCase();
        const subjectLangMap: Record<string, string> = {
            'hanja': 'ko-KR',
            'chinese': 'zh-CN',
            'japanese': 'ja-JP',
            'english': 'en-US',
            'korean': 'ko-KR'
        };

        // 1순위: 선택된 과목 기반 언어, 2순위: 텍스트 기반 자동 감지, 3순위: 한국어(Default)
        const initialLang = subjectLangMap[subKey] || (resource.text ? detectLang(resource.text) : 'ko-KR');

        updateCommonResource(id, {
            voiceSettings: {
                lang: initialLang,
                voice: 'female',
                speed: 1.0,
                pitch: 1.0
            }
        });
        setActiveVoiceId(id);
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

    const generateAudioTTS = async (id: string) => {
        const resource = commonResources.find(r => r.id === id);
        if (!resource || !resource.text || !resource.voiceSettings) return;

        const { voice, speed, pitch, lang } = resource.voiceSettings;
        setLoadingId(id);
        const processedText = processFuriganaForTTS(resource.text);

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
                setActiveVoiceId(null); // 생성 완료 후 패널 닫기 (사용자 요청: 디폴트로 생성 기능 보완)
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
    const previewAudioTTS = (id: string) => {
        const resource = commonResources.find(r => r.id === id);
        if (!resource || !resource.text || !resource.voiceSettings) return;

        const { voice, speed, pitch, lang } = resource.voiceSettings;
        speechSynthesis.cancel();
        const processedText = processFuriganaForTTS(resource.text);
        const utterance = new SpeechSynthesisUtterance(processedText);
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
            let apiKey = geminiApiKey || import.meta.env.VITE_GEMINI_API_KEY;

            if (!apiKey) {
                const { data: remoteKey } = await fetchGlobalConfig('gemini_api_key');
                if (remoteKey) apiKey = remoteKey;
            }

            if (!apiKey) {
                apiKey = 'AIzaSyB2P8I8qiGOKwxov4JVlLoDOnbMpTuiae0';
            }

            if (!apiKey) {
                throw new Error('API Key가 설정되지 않았습니다. 설정이나 DB에서 API Key를 확인해주세요.');
            }
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const prompt = `
        언어 교육 전문가로서 텍스트와 발음을 슬래시('/')를 사용하여 논리적 단위로 분절해주세요.
        과목: ${hierarchy.subject}
        원본 텍스트: "${resource.text.replace(/\//g, '')}"
        현재 발음: "${(resource.subText || '').replace(/\//g, '')}"
        결과는 JSON 형식으로 반환하세요: { "segmentedText": "string", "segmentedSubText": "string" }
      `;

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            });

            const responseText = (await result.response).text() || '{}';
            const parsed = JSON.parse(responseText);
            updateCommonResource(id, {
                text: parsed.segmentedText || resource.text,
                subText: parsed.segmentedSubText || resource.subText
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
            onDirtyChange?.(false);
            alert('현재 편집 상태가 Supabase DB에 개별 저장되었습니다.');
        } catch (error: any) {
            console.error('Step2 Save Error:', error);
            alert(`저장 실패: ${error.message || 'Unknown error'}`);
        } finally {
            setIsSyncing(false);
        }
    };


    const subLabel = hierarchy.subject === 'chinese' ? '병음' :
        hierarchy.subject === 'japanese' ? '후리가나' : null;

    return (
        <div className="space-y-4 sm:space-y-8 animate-fade-in px-2 sm:px-0">
            {/* 헤더 - 액션 버튼 (포털을 통해 상단 헤더로 이동) */}
            {createPortal(
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleTempDBSave}
                        disabled={isSyncing}
                        className={cn(
                            "h-12 px-6 rounded-[1.5rem] bg-white text-slate-400 font-black text-xs uppercase tracking-widest shadow-sm hover:text-[#9B87F5] transition-all flex items-center gap-3",
                            isSyncing && "opacity-50 cursor-wait"
                        )}
                        title="저장"
                    >
                        <i className={cn("fas", isSyncing ? "fa-spinner fa-spin" : "fa-cloud-upload-alt")}></i>
                        {isSyncing ? "Saving..." : "Save Progress"}
                    </button>
                    <button
                        onClick={handleProceed}
                        className="h-12 px-10 rounded-[1.5rem] bg-slate-900 text-white font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.05] active:scale-[0.95] transition-all flex items-center justify-center gap-3"
                    >
                        <span>Analyze & Finish</span>
                        <i className="fas fa-magic text-[#9B87F5]"></i>
                    </button>
                </div>,
                document.getElementById('step2-header-actions')!
            )}

            {/* 뷰 모드 탭 (Tiimo Styled Navigation) */}
            <div className="flex bg-[#F8F9FF] p-2 rounded-[2.5rem] w-full sm:w-fit border border-slate-50 shadow-sm">
                <button
                    onClick={() => setViewMode('ASSET_POOL')}
                    className={cn(
                        'flex-1 sm:flex-initial px-8 py-3.5 rounded-[2rem] text-[10px] font-black tracking-[0.2em] transition-all flex items-center justify-center gap-3 uppercase',
                        viewMode === 'ASSET_POOL'
                            ? 'bg-slate-900 text-white shadow-xl scale-[1.02]'
                            : 'text-slate-400 hover:text-slate-600'
                    )}
                >
                    <i className="fas fa-database text-[10px]"></i>
                    Assets ({commonResources.length})
                </button>
                <button
                    onClick={() => setViewMode('PAGE_EDITOR')}
                    className={cn(
                        'flex-1 sm:flex-initial px-8 py-3.5 rounded-[2rem] text-[10px] font-black tracking-[0.2em] transition-all flex items-center justify-center gap-3 uppercase',
                        viewMode === 'PAGE_EDITOR'
                            ? 'bg-[#9B87F5] text-white shadow-xl scale-[1.02]'
                            : 'text-slate-400 hover:text-slate-600'
                    )}
                >
                    <i className="fas fa-edit text-[10px]"></i>
                    Page Editor
                </button>
            </div>

            {/* ASSET POOL 뷰 (Minimalist Library) */}
            {viewMode === 'ASSET_POOL' && (
                <div className="space-y-8 animate-fade-in">
                    <div className="flex items-center justify-between px-2">
                        <div className="space-y-1">
                            <h2 className="text-2xl font-serif font-black text-[#2D2D2D]">Resource Library</h2>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Manage your extracted learning assets</p>
                        </div>
                        <button
                            onClick={addCommonResource}
                            className="h-12 px-6 rounded-[1.5rem] bg-[#E0D7FF] text-[#8170FF] font-black text-xs uppercase tracking-widest shadow-sm hover:shadow-md transition-all flex items-center gap-3"
                        >
                            <i className="fas fa-plus"></i>
                            New Asset
                        </button>
                    </div>

                    {commonResources.length === 0 ? (
                        <div className="card !py-24 text-center bg-white/40 border-none shadow-none">
                            <div className="w-24 h-24 rounded-[2.5rem] bg-slate-50 flex items-center justify-center mx-auto mb-8">
                                <i className="fas fa-box-open text-4xl text-slate-200"></i>
                            </div>
                            <p className="text-[#2D2D2D] font-serif text-2xl mb-2">Library is Empty</p>
                            <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Start by adding your first educational asset</p>
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
                                    isActiveVoice={activeVoiceId === res.id}
                                    onVoiceToggle={() => toggleVoiceStudio(res.id)}
                                    onVoicePreview={() => previewAudioTTS(res.id)}
                                    onVoiceGenerate={() => generateAudioTTS(res.id)}
                                    onImageClick={(url, text) => setImageModal({ show: true, url, text, resourceId: res.id })}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* PAGE EDITOR 뷰 (Hierarchical Structuring) */}
            {viewMode === 'PAGE_EDITOR' && (
                <div className="space-y-10 animate-fade-in">
                    <div className="px-2 space-y-1">
                        <h2 className="text-2xl font-serif font-black text-[#2D2D2D]">Page Structure</h2>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sequence your assets into interactive learning stacks</p>
                    </div>

                    {/* 스택 목록 */}
                    <div className="space-y-10">
                        {pageStacks.map((stack, idx) => (
                            <div key={stack.id} className="card !p-0 overflow-hidden border-none bg-white shadow-xl shadow-slate-100/50 group">
                                <div className="bg-slate-900 px-8 py-5 flex items-center gap-6">
                                    <div className="w-10 h-10 rounded-[1.25rem] bg-[#9B87F5] flex items-center justify-center text-white font-serif font-black text-sm italic shadow-lg">
                                        {idx + 1}
                                    </div>
                                    <div className="flex-1">
                                        <select
                                            value={stack.activityType}
                                            onChange={(e) => updateStack(stack.id, { activityType: e.target.value as ActivityType })}
                                            className="bg-transparent border-none text-white text-xs font-black uppercase tracking-widest outline-none cursor-pointer focus:ring-0 w-full"
                                        >
                                            {ACTIVITY_TYPES.map(type => (
                                                <option key={type.id} value={type.id} className="text-slate-900 bg-white">
                                                    {type.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => copyStackItems(stack.items)}
                                            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-indigo-300 transition-all"
                                            title="아이템 복사"
                                        >
                                            <i className="fas fa-copy text-xs"></i>
                                        </button>
                                        {stackClipboard.length > 0 && (
                                            <button
                                                onClick={() => pasteStackItems(stack.id)}
                                                className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-emerald-300 transition-all"
                                                title="복사한 아이템 붙여넣기"
                                            >
                                                <i className="fas fa-paste text-xs"></i>
                                            </button>
                                        )}
                                        <button
                                            onClick={() => duplicateStack(stack)}
                                            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-[#9B87F5] transition-all"
                                            title="스택 복제"
                                        >
                                            <i className="fas fa-clone text-xs"></i>
                                        </button>
                                        <button
                                            onClick={() => deleteStack(stack.id)}
                                            className="w-10 h-10 rounded-full hover:bg-white/10 flex items-center justify-center text-white/30 hover:text-rose-400 transition-all ml-2"
                                            title="스택 삭제"
                                        >
                                            <i className="fas fa-trash-alt text-xs"></i>
                                        </button>
                                    </div>
                                </div>

                                <div
                                    className="p-8 space-y-6 min-h-[150px] bg-[#F8F9FF]/30"
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
                                        <div key={item.id} className="relative group/item">
                                            <div className="flex items-center gap-6 bg-white p-5 rounded-[2rem] border border-slate-50 shadow-sm hover:shadow-md transition-all">
                                                <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-[10px] font-black text-slate-300 shrink-0">
                                                    {i + 1}
                                                </div>

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
                                                        className="w-full bg-transparent border-none text-sm font-bold text-[#2D2D2D] focus:ring-0 p-0"
                                                    >
                                                        <option value="">Select from Library...</option>
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
                                                    className="w-8 h-8 rounded-full hover:bg-rose-50 flex items-center justify-center text-slate-200 hover:text-rose-400 transition-all"
                                                >
                                                    <i className="fas fa-minus-circle"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    {stack.items.length === 0 && (
                                        <div className="py-12 flex flex-col items-center justify-center border-2 border-dashed border-slate-100 rounded-[2.5rem]">
                                            <div className="w-16 h-16 rounded-[1.5rem] bg-slate-50 flex items-center justify-center mb-4">
                                                <i className="fas fa-plus text-slate-200 text-xl"></i>
                                            </div>
                                            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Drop assets here or add manually</p>
                                        </div>
                                    )}
                                </div>

                                <div className="px-8 py-5 bg-white border-t border-slate-50 flex justify-center">
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
                                        className="h-10 px-6 rounded-full bg-[#F8F9FF] text-[10px] font-black text-[#9B87F5] uppercase tracking-widest hover:bg-[#E0D7FF]/30 transition-all flex items-center gap-3"
                                    >
                                        <i className="fas fa-plus-circle"></i> Add New Item
                                    </button>
                                </div>
                            </div>
                        ))}

                        <button
                            onClick={addStack}
                            className="w-full py-10 border-2 border-dashed border-slate-100 rounded-[3rem] text-slate-400 hover:text-[#9B87F5] hover:border-[#E0D7FF] hover:bg-[#F8F9FF]/50 transition-all flex flex-col items-center gap-4 group"
                        >
                            <div className="w-16 h-16 rounded-[2rem] bg-slate-50 flex items-center justify-center group-hover:bg-[#E0D7FF]/30 group-hover:text-[#9B87F5] transition-all shadow-sm">
                                <i className="fas fa-layer-group text-2xl"></i>
                            </div>
                            <div className="text-center">
                                <span className="block font-black text-xs uppercase tracking-[0.2em] mb-1">New Activity Stack</span>
                                <span className="block text-[10px] text-slate-300 font-bold uppercase tracking-widest">Create another learning layer</span>
                            </div>
                        </button>
                    </div>
                </div>
            )}

            {/* AI 이미지 프롬프트 모달 (Visual AI Studio) */}
            {promptModal.show && (
                <div className="modal-overlay !bg-slate-900/40 backdrop-blur-md">
                    <div className="modal-content animate-slide-up !p-0 overflow-hidden border-none shadow-2xl" style={{ maxWidth: '500px' }}>
                        <div className="bg-slate-900 p-8 flex items-center justify-between">
                            <h3 className="text-xl font-serif font-black text-white italic">Visual AI Studio</h3>
                            <button onClick={() => setPromptModal({ ...promptModal, show: false })} className="text-white/30 hover:text-white transition-all">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        <div className="p-10 space-y-8 bg-white">
                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Base Concept</label>
                                <div className="bg-[#F8F9FF] px-6 py-4 rounded-[1.5rem] font-serif font-black text-[#2D2D2D] text-lg border border-slate-50">{promptModal.initial}</div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Artistic Style</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => setPromptModal({ ...promptModal, style: 'illustration' })}
                                        className={cn(
                                            'px-6 py-4 rounded-[1.5rem] border-2 font-black text-xs uppercase tracking-widest transition-all',
                                            promptModal.style === 'illustration' ? 'border-[#9B87F5] bg-[#F0EDFF] text-[#8170FF]' : 'border-slate-50 text-slate-300 hover:border-slate-100'
                                        )}
                                    >
                                        Illustration
                                    </button>
                                    <button
                                        onClick={() => setPromptModal({ ...promptModal, style: 'photo' })}
                                        className={cn(
                                            'px-6 py-4 rounded-[1.5rem] border-2 font-black text-xs uppercase tracking-widest transition-all',
                                            promptModal.style === 'photo' ? 'border-[#9B87F5] bg-[#F0EDFF] text-[#8170FF]' : 'border-slate-50 text-slate-300 hover:border-slate-100'
                                        )}
                                    >
                                        Realistic
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Extra Magic (Optional)</label>
                                <textarea
                                    value={promptModal.situation}
                                    onChange={(e) => setPromptModal({ ...promptModal, situation: e.target.value })}
                                    placeholder="Add more details to the scene..."
                                    className="w-full bg-[#F8F9FF] border-none rounded-[2rem] px-6 py-5 text-sm font-bold text-[#2D2D2D] focus:ring-2 focus:ring-[#E0D7FF] outline-none h-32 resize-none transition-all"
                                />
                            </div>

                            <div className="flex gap-4 pt-4">
                                <button
                                    onClick={() => generateImageAI(promptModal.id, `${promptModal.initial}, ${promptModal.style} style, ${promptModal.situation}`)}
                                    className={cn(
                                        "h-16 flex-1 rounded-[2rem] bg-gradient-to-r from-[#9B87F5] to-[#8170FF] text-white font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-[#9B87F5]/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3",
                                        loadingId === promptModal.id && "opacity-50 pointer-events-none"
                                    )}
                                    disabled={loadingId === promptModal.id}
                                >
                                    {loadingId === promptModal.id ? (
                                        <>
                                            <i className="fas fa-magic animate-spin"></i>
                                            Generating...
                                        </>
                                    ) : (
                                        <>
                                            <span>Create Vision</span>
                                            <i className="fas fa-magic"></i>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 이미지 확대 모달 (Cinematic View) */}
            {imageModal.show && (
                <div className="modal-overlay !bg-slate-900/60 backdrop-blur-xl" onClick={() => setImageModal({ ...imageModal, show: false })}>
                    <div className="modal-content !p-0 overflow-hidden rounded-[3rem] border-none shadow-2xl" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px', backgroundColor: 'transparent' }}>
                        <div className="relative aspect-square group">
                            <img src={imageModal.url} alt="" className="w-full h-full object-cover rounded-[3rem] shadow-2xl shadow-black/40" />
                            <div className="absolute inset-x-0 bottom-0 p-12 bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent">
                                <p className="text-white font-serif font-black text-4xl mb-4 italic leading-tight">{imageModal.text}</p>
                                <div className="flex items-center gap-8">
                                    <button
                                        onClick={() => {
                                            const link = document.createElement('a');
                                            link.href = imageModal.url;
                                            link.download = `tiimo_ai_${imageModal.text}.png`;
                                            link.click();
                                        }}
                                        className="text-white/60 hover:text-white transition-all text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-3"
                                    >
                                        <i className="fas fa-download"></i> Download Art
                                    </button>
                                    {imageModal.resourceId && (
                                        <button
                                            onClick={() => {
                                                setImageModal({ ...imageModal, show: false });
                                                setPromptModal({ show: true, id: imageModal.resourceId!, initial: imageModal.text, style: 'illustration', situation: '' });
                                            }}
                                            className="text-white/60 hover:text-[#9B87F5] transition-all text-[10px] font-black uppercase tracking-[0.2em] flex items-center gap-3"
                                        >
                                            <i className="fas fa-redo"></i> Re-imagine
                                        </button>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => setImageModal({ ...imageModal, show: false })}
                                className="absolute top-8 right-8 w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-lg text-white hover:bg-white/20 transition-all flex items-center justify-center border border-white/10"
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
    isActiveVoice: boolean;
    onVoiceToggle: () => void;
    onVoicePreview: () => void;
    onVoiceGenerate: () => void;
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
    isActiveVoice,
    onVoiceToggle,
    onVoicePreview,
    onVoiceGenerate,
    onImageClick
}) => {
    const isMismatch = data.text && data.subText ? !validateSegmentMatch(data.text, data.subText) : false;

    return (
        <div
            draggable
            onDragStart={(e) => e.dataTransfer.setData('resourceId', data.id)}
            className={cn(
                'card !p-0 flex flex-col group hover:shadow-2xl hover:shadow-[#E0D7FF]/20 transition-all duration-300 relative cursor-grab active:cursor-grabbing border-none bg-white overflow-hidden',
                isLoading && 'opacity-60 pointer-events-none'
            )}
        >
            <div className="flex items-center gap-10 p-8">
                <div className="w-12 flex flex-col items-center gap-2 shrink-0">
                    <div className="w-10 h-10 rounded-[1.25rem] bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-[#F8F9FF] group-hover:text-slate-500 transition-all">
                        <i className="fas fa-grip-vertical text-xs"></i>
                    </div>
                    <span className="text-[10px] font-black text-slate-200 group-hover:text-slate-400">#{index + 1}</span>
                </div>

                <div className="flex-1 space-y-8">
                    <div className="grid grid-cols-12 gap-8">
                        {/* 메인 텍스트 */}
                        <div className="col-span-12 lg:col-span-5 space-y-3">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Original Text</label>
                            <input
                                type="text"
                                value={data.text}
                                onChange={(e) => onUpdate({ text: e.target.value })}
                                className="w-full bg-[#F8F9FF] border-none rounded-[1.5rem] px-6 py-4 font-serif text-2xl font-black text-[#2D2D2D] focus:ring-2 focus:ring-[#E0D7FF] outline-none transition-all"
                                placeholder="Enter text..."
                            />
                        </div>

                        {/* 서브 텍스트 (병음/후리가나) */}
                        <div className="col-span-12 lg:col-span-4 space-y-3">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">{subLabel || 'Phonetic'}</label>
                                <button
                                    onClick={onAiSegment}
                                    className="text-[8px] font-black text-[#8170FF] hover:text-[#9B87F5] bg-[#E0D7FF]/30 px-3 py-1 rounded-full transition-all uppercase tracking-widest flex items-center gap-2"
                                >
                                    <i className="fas fa-magic"></i> AI Segment
                                </button>
                            </div>
                            <input
                                type="text"
                                value={data.subText || ''}
                                onChange={(e) => onUpdate({ subText: e.target.value })}
                                placeholder={subLabel ? `${subLabel}...` : '-'}
                                className={cn(
                                    "w-full bg-[#F8F9FF] border-none rounded-[1.5rem] px-6 py-4 text-sm font-bold text-slate-400 focus:ring-2 focus:ring-[#E0D7FF] outline-none transition-all",
                                    isMismatch && 'bg-rose-50/50 ring-1 ring-rose-100'
                                )}
                            />
                        </div>

                        {/* 번역 */}
                        <div className="col-span-12 lg:col-span-3 space-y-3">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Meaning</label>
                            <input
                                type="text"
                                value={data.translation}
                                onChange={(e) => onUpdate({ translation: e.target.value })}
                                className="w-full bg-[#F8F9FF] border-none rounded-[1.5rem] px-6 py-4 text-xs font-black text-[#9B87F5] focus:ring-2 focus:ring-[#E0D7FF] outline-none transition-all"
                                placeholder="Translation..."
                            />
                        </div>
                    </div>

                    {/* 하단 미디어 매직 바 */}
                    <div className="flex items-center justify-between pt-6 border-t border-slate-50">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => {
                                    if (data.imageUrl && onImageClick) {
                                        onImageClick(data.imageUrl, data.text);
                                    } else {
                                        onAiImage();
                                    }
                                }}
                                className={cn(
                                    'h-14 px-6 rounded-[1.5rem] flex items-center gap-3 transition-all font-black text-[10px] uppercase tracking-widest group/btn',
                                    data.imageUrl
                                        ? 'bg-[#F8F9FF] text-[#9B87F5] hover:bg-[#E0D7FF]/30 shadow-sm'
                                        : 'bg-[#F8F9FF] text-slate-300 hover:text-[#9B87F5] hover:bg-[#F0EDFF]'
                                )}
                            >
                                {data.imageUrl ? (
                                    <>
                                        <div className="w-8 h-8 rounded-xl overflow-hidden shadow-md">
                                            <img src={data.imageUrl} alt="" className="w-full h-full object-cover" />
                                        </div>
                                        <span>Visual AI</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="fas fa-image text-lg"></i>
                                        <span>Create Image</span>
                                    </>
                                )}
                            </button>

                            <button
                                onClick={onVoiceToggle}
                                className={cn(
                                    'h-14 px-6 rounded-[1.5rem] flex items-center gap-3 transition-all font-black text-[10px] uppercase tracking-widest',
                                    (data.audioUrl || isActiveVoice)
                                        ? 'bg-[#E0D7FF]/30 text-[#8170FF] shadow-sm'
                                        : 'bg-[#F8F9FF] text-slate-300 hover:text-[#8170FF] hover:bg-[#E0EBFF]'
                                )}
                            >
                                <i className={cn("text-lg", data.audioUrl ? 'fas fa-volume-up' : 'fas fa-microphone')}></i>
                                <span>{data.audioUrl ? 'Voice Ready' : isActiveVoice ? 'Configuring...' : 'Voice AI'}</span>
                            </button>
                        </div>

                        <button
                            onClick={onDelete}
                            className="w-14 h-14 rounded-[1.5rem] text-slate-200 hover:text-rose-400 hover:bg-rose-50 transition-all flex items-center justify-center"
                        >
                            <i className="fas fa-trash-alt text-lg"></i>
                        </button>
                    </div>
                </div>
            </div>

            {/* Vocal AI Studio Inline Panel */}
            {isActiveVoice && data.voiceSettings && (
                <div className="bg-[#FBFAFF] border-t border-[#E0D7FF]/30 p-8 space-y-8 animate-slide-up">
                    <div className="flex items-center gap-4 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-[#9B87F5] flex items-center justify-center text-white shadow-lg shadow-[#9B87F5]/20">
                            <i className="fas fa-microphone-alt text-lg"></i>
                        </div>
                        <div className="space-y-0.5">
                            <h3 className="text-xl font-serif font-black text-[#2D2D2D] italic">Vocal AI Studio</h3>
                            <p className="text-[8px] font-black text-slate-300 uppercase tracking-[0.2em]">Configure AI Narration</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-3">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Language</label>
                            <select
                                value={data.voiceSettings.lang}
                                onChange={(e) => onUpdate({ voiceSettings: { ...data.voiceSettings!, lang: e.target.value } })}
                                className="w-full bg-white border border-slate-100 rounded-[1.25rem] px-5 py-3 text-[9px] font-black uppercase tracking-widest text-[#2D2D2D] outline-none focus:ring-2 focus:ring-[#E0D7FF] h-12"
                            >
                                <option value="ko-KR">KOREAN</option>
                                <option value="en-US">US ENGLISH</option>
                                <option value="en-GB">UK ENGLISH</option>
                                <option value="zh-CN">CHINESE</option>
                                <option value="ja-JP">JAPANESE</option>
                                <option value="es-ES">SPANISH</option>
                            </select>
                        </div>
                        <div className="space-y-3">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] px-1">Persona</label>
                            <div className="grid grid-cols-2 gap-2 bg-white border border-slate-100 p-1 rounded-[1.25rem] h-12">
                                <button
                                    onClick={() => onUpdate({ voiceSettings: { ...data.voiceSettings!, voice: 'female' } })}
                                    className={cn(
                                        'rounded-lg text-[8px] font-black uppercase tracking-widest transition-all',
                                        data.voiceSettings.voice === 'female' ? 'bg-[#9B87F5] text-white shadow-sm' : 'text-slate-300 hover:text-slate-500'
                                    )}
                                >
                                    Female
                                </button>
                                <button
                                    onClick={() => onUpdate({ voiceSettings: { ...data.voiceSettings!, voice: 'male' } })}
                                    className={cn(
                                        'rounded-lg text-[8px] font-black uppercase tracking-widest transition-all',
                                        data.voiceSettings.voice === 'male' ? 'bg-[#9B87F5] text-white shadow-sm' : 'text-slate-300 hover:text-slate-500'
                                    )}
                                >
                                    Male
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Tempo</label>
                                <span className="text-[9px] font-black text-[#8170FF]">{data.voiceSettings.speed.toFixed(1)}x</span>
                            </div>
                            <input
                                type="range" min="0.5" max="2.0" step="0.1"
                                value={data.voiceSettings.speed}
                                onChange={(e) => onUpdate({ voiceSettings: { ...data.voiceSettings!, speed: parseFloat(e.target.value) } })}
                                className="w-full accent-[#9B87F5] h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center px-1">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">Pitch</label>
                                <span className="text-[9px] font-black text-[#9B87F5]">{data.voiceSettings.pitch.toFixed(1)}</span>
                            </div>
                            <input
                                type="range" min="0.5" max="2.0" step="0.1"
                                value={data.voiceSettings.pitch}
                                onChange={(e) => onUpdate({ voiceSettings: { ...data.voiceSettings!, pitch: parseFloat(e.target.value) } })}
                                className="w-full accent-[#9B87F5] h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    </div>

                    <div className="flex gap-4 pt-4">
                        <button
                            onClick={onVoicePreview}
                            className="h-14 px-8 rounded-[1.25rem] bg-white border border-slate-100 text-slate-400 font-black text-[9px] uppercase tracking-[0.2em] hover:bg-[#F8F9FF] hover:text-[#9B87F5] transition-all flex items-center justify-center gap-3"
                        >
                            <i className="fas fa-play text-[8px]"></i>
                            Preview
                        </button>
                        <button
                            onClick={onVoiceGenerate}
                            className={cn(
                                "h-14 flex-1 rounded-[1.25rem] bg-slate-900 text-white font-black text-[9px] uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-4",
                                isLoading && "opacity-50 pointer-events-none"
                            )}
                            disabled={isLoading}
                        >
                            <i className={cn("text-[10px] text-[#9B87F5]", isLoading ? "fas fa-spinner fa-spin" : "fas fa-magic")}></i>
                            <span>{isLoading ? 'Generating...' : 'Apply Vocal AI'}</span>
                        </button>
                    </div>
                </div>
            )}

            {/* AI Loading State Overlay (Only for non-voice actions if needed, otherwise panel handles it) */}
            {isLoading && !isActiveVoice && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md flex flex-col items-center justify-center z-20">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-[#E0D7FF] border-t-[#9B87F5] rounded-full animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <i className="fas fa-magic text-[#9B87F5] animate-pulse"></i>
                        </div>
                    </div>
                    <p className="mt-6 text-[10px] font-black text-[#9B87F5] uppercase tracking-[0.3em] animate-pulse">AI is working its magic...</p>
                </div>
            )}

            {/* Mismatch Alert Card */}
            {isMismatch && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#FF9E85] text-white text-[8px] font-black px-5 py-2 rounded-full shadow-xl flex items-center gap-2 uppercase tracking-widest animate-bounce z-10">
                    <i className="fas fa-exclamation-triangle"></i>
                    Segmentation Mismatch
                </div>
            )}
        </div>
    );
};

export default Step2Refinement;
