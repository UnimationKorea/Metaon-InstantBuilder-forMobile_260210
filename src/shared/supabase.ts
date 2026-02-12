import { createClient } from '@supabase/supabase-js';
import { stateManager } from './stateManager';

let supabaseClient: any = null;

const getClient = () => {
    if (supabaseClient) return supabaseClient;

    const state = stateManager.getState();

    // 1. 전역 상태(수동 설정) 확인
    let url = state.supabaseConfig.url;
    let key = state.supabaseConfig.anonKey;

    // 2. 환경 변수 확인 (Vite 정적 접근)
    const envUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eskuiiuvxgyrciwurtms.supabase.co';
    const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_udvX1DeGFMTSnbPtBDAr9g_6J68bt5i';

    if (!url) url = envUrl;
    if (!key) key = envKey;

    if (url && key) {
        try {
            supabaseClient = createClient(url, key);
            return supabaseClient;
        } catch (e) {
            console.error('Failed to create Supabase client:', e);
            return null;
        }
    }

    console.group('Supabase Configuration Check');
    console.log('State URL:', !!state.supabaseConfig.url);
    console.log('Env URL:', !!envUrl, envUrl ? 'Found' : 'Missing');
    console.log('Env Key exists:', !!envKey);
    console.groupEnd();

    return null;
};

// 프록시 역할을 하는 객체를 내보내어 실제 호출 시점에 클라이언트를 확인하도록 함
export const supabase = {
    from: (table: string) => {
        const client = getClient();
        if (client) return client.from(table);

        console.warn('Supabase client is not initialized. Using dummy object.');

        // 모든 호출을 무시하고 최종적으로 에러를 반환하는 체이닝 가능한 더미 객체
        const dummy = {
            select: () => dummy,
            upsert: () => dummy,
            insert: () => dummy,
            update: () => dummy,
            delete: () => dummy,
            eq: () => dummy,
            neq: () => dummy,
            gt: () => dummy,
            lt: () => dummy,
            gte: () => dummy,
            lte: () => dummy,
            like: () => dummy,
            ilike: () => dummy,
            is: () => dummy,
            in: () => dummy,
            contains: () => dummy,
            containedBy: () => dummy,
            rangeGt: () => dummy,
            rangeGte: () => dummy,
            rangeLt: () => dummy,
            rangeLte: () => dummy,
            rangeAdjacent: () => dummy,
            overlaps: () => dummy,
            match: () => dummy,
            not: () => dummy,
            or: () => dummy,
            filter: () => dummy,
            order: () => dummy,
            limit: () => dummy,
            range: () => dummy,
            abortSignal: () => dummy,
            single: () => Promise.resolve({ data: null, error: new Error('Supabase configuration missing or invalid.') }),
            then: (onfulfilled: any) => Promise.resolve({ data: null, error: new Error('Supabase configuration missing or invalid.') }).then(onfulfilled)
        } as any;

        return dummy;
    }
} as any;

/**
 * 특정 위치의 콘텐츠 저장 (CMS 방식)
 */
export const savePageContent = async (
    subject: string,
    level: string,
    setNum: string,
    pageNum: string,
    contentData: any
) => {
    const state = stateManager.getState();
    const userId = state.auth.userId;
    if (!userId) throw new Error('로그인이 필요합니다.');

    const { error } = await supabase
        .from('edu_page_content')
        .upsert({
            user_id: userId,
            subject,
            level,
            set_num: setNum,
            page_num: pageNum,
            content_data: contentData,
            last_saved_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,subject,level,set_num,page_num'
        });

    return { error };
};

/**
 * 특정 위치의 콘텐츠 조회
 */
export const fetchPageContent = async (
    subject: string,
    level: string,
    setNum: string,
    pageNum: string
) => {
    const state = stateManager.getState();
    const userId = state.auth.userId;
    console.log(`[CMS] Fetching from Table: edu_page_content for ${subject}-${level}-${setNum}-${pageNum}`);
    if (!userId) return { data: null, error: null };

    const { data, error } = await supabase
        .from('edu_page_content')
        .select('*')
        .match({ user_id: userId, subject, level, set_num: setNum, page_num: pageNum })
        .maybeSingle();

    return { data, error };
};

/**
 * 사용자가 저장한 모든 페이지 목록(Map) 조회 (UI 표시용)
 */
export const fetchStorageMap = async () => {
    const state = stateManager.getState();
    const userId = state.auth.userId;
    if (!userId) return { data: [], error: null };

    const { data, error } = await supabase
        .from('edu_page_content')
        .select('subject, level, set_num, page_num')
        .eq('user_id', userId);

    return { data, error };
};

/**
 * 앱 전체 상태 저장 (기존 방식 유지 - 백업용)
 */
export const saveAppState = async () => {
    const state = stateManager.getState();
    const userId = state.auth.userId;

    if (!state.auth.isAuthenticated || !userId) {
        return { error: new Error('로그인이 필요합니다.') };
    }

    const client = getClient();
    if (!client) {
        const envUrl = import.meta.env.VITE_SUPABASE_URL;
        return { error: new Error(`Supabase 설정이 누락되었습니다. (Env: ${envUrl ? 'OK' : 'Missing'})`) };
    }

    try {
        const syncData = {
            user_id: userId,
            app_state: {
                currentStep: state.currentStep,
                step1Data: state.step1Data,
                step2Data: state.step2Data,
                step3Data: state.step3Data
            },
            hierarchy: state.step2Data?.config?.hierarchy || {},
            classification_config: state.classificationConfig,
            last_saved_at: new Date().toISOString()
        };

        const { error } = await client
            .from('edu_page_data')
            .upsert(syncData, { onConflict: 'user_id' });

        return { error };
    } catch (err: any) {
        console.error('saveAppState Error:', err);
        return { error: err };
    }
};

/**
 * 전역 설정값 조회 (Gemini API Key 등)
 */
export const fetchGlobalConfig = async (key: string) => {
    const { data, error } = await supabase
        .from('edu_system_config')
        .select('value')
        .eq('key', key)
        .maybeSingle();

    return { data: data?.value || null, error };
};
