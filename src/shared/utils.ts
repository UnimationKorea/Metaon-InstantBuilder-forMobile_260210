/**
 * =========================================
 * 공용 유틸리티 함수
 * =========================================
 */

/**
 * UUID 생성
 */
export const generateId = (): string => {
    return crypto.randomUUID();
};

/**
 * 타임스탬프 생성 (ISO 형식)
 */
export const getTimestamp = (): string => {
    return new Date().toISOString();
};

/**
 * Base64 디코딩 (오디오용)
 */
export const decodeBase64 = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

/**
 * PCM to WAV 변환
 */
export const pcmToWav = (pcmData: Int16Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + pcmData.length * 2);
    const view = new DataView(buffer);

    // WAV 헤더 작성
    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcmData.length * 2, true);

    for (let i = 0; i < pcmData.length; i++) {
        view.setInt16(44 + i * 2, pcmData[i], true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
};

/**
 * 파일을 Base64로 변환
 */
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // data:...;base64, 부분 제거
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * CSV 파싱 (따옴표 및 쉼표 처리)
 */
export const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            currentField += '"';
            i++;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
        } else if ((char === '\r' || char === '\n') && !inQuotes) {
            if (currentField || currentRow.length > 0) {
                currentRow.push(currentField.trim());
                rows.push(currentRow);
            }
            currentRow = [];
            currentField = '';
            if (char === '\r' && nextChar === '\n') i++;
        } else {
            currentField += char;
        }
    }

    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }

    return rows;
};

/**
 * 세그먼트 개수 일치 검증 (슬래시 기준)
 */
export const validateSegmentMatch = (text: string, subText: string): boolean => {
    if (!text || !subText) return true;
    return text.split('/').length === subText.split('/').length;
};

/**
 * 데이터 유닛 자동 감지
 */
export const detectDataUnit = (text: string): 'word' | 'phrase' | 'sentence' | 'paragraph' => {
    if (!text) return 'word';

    const trimmed = text.trim();
    const hasMultipleSentences = (trimmed.match(/[.!?。！？]/g) || []).length > 1;
    const hasPeriod = /[.!?。！？]$/.test(trimmed);
    const hasSpaces = trimmed.includes(' ') || trimmed.includes('/');
    const length = trimmed.length;

    if (hasMultipleSentences) return 'paragraph';
    if (hasPeriod && length > 10) return 'sentence';
    if (hasSpaces && length > 5) return 'phrase';
    return 'word';
};

/**
 * 언어 자동 감지 (간단 버전)
 */
export const detectLanguage = (text: string): 'zh' | 'ja' | 'ko' | 'en' => {
    // 중국어 간체/한자
    const chinesePattern = /[\u4e00-\u9fff]/;
    // 일본어 히라가나/카타카나
    const japanesePattern = /[\u3040-\u309f\u30a0-\u30ff]/;
    // 한국어 한글
    const koreanPattern = /[\uac00-\ud7af\u1100-\u11ff]/;

    if (japanesePattern.test(text)) return 'ja';
    if (koreanPattern.test(text)) return 'ko';
    if (chinesePattern.test(text)) return 'zh';
    return 'en';
};

/**
 * 로컬 스토리지 래퍼 (타입 안전)
 */
export const storage = {
    get: <T>(key: string): T | null => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch {
            return null;
        }
    },

    set: <T>(key: string, value: T): void => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error('Storage error:', error);
        }
    },

    remove: (key: string): void => {
        localStorage.removeItem(key);
    },

    clear: (): void => {
        localStorage.clear();
    },
};

/**
 * 딜레이 유틸리티
 */
export const delay = (ms: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * 디바운스
 */
export const debounce = <T extends (...args: unknown[]) => unknown>(
    fn: T,
    ms: number
): ((...args: Parameters<T>) => void) => {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), ms);
    };
};

/**
 * 클래스명 병합
 */
export const cn = (...classes: (string | undefined | null | false)[]): string => {
    return classes.filter(Boolean).join(' ');
};
