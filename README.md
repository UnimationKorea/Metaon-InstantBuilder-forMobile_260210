# 🚀 메타온 인스턴트 콘텐츠 빌더 (Metaon ICB)

<div align="center">
  <img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="Banner" width="800" />
  
  **교사를 위한 AI 기반 즉석 학습 자료 생성 시스템**
  
  [![React](https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react)](https://reactjs.org/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?style=flat-square&logo=vite)](https://vitejs.dev/)
  [![Gemini AI](https://img.shields.io/badge/Gemini-AI-4285F4?style=flat-square&logo=google)](https://ai.google.dev/)
</div>

---

## 📋 프로젝트 개요

메타온 인스턴트 콘텐츠 빌더(ICB)는 교사가 현장에서 **즉석으로 PDF, 이미지, 텍스트 등 외부 자료를 업로드**하여 메타온의 학습 액티비티로 전환하는 것을 목표로 합니다.

각 단계는 **독립적인 샌드박스(Sandbox)** 환경에서 구동되어 상호 간섭을 최소화하며, 최종 데이터는 메타온 커리큘럼에 통합 가능한 표준 규격을 따릅니다.

---

## ✨ 최근 업데이트 (2026.02.05)

- **� 전역 데이터 보존 시스템**: 단계별 이동(Step 1 ↔ 2 ↔ 3) 시 수집된 데이터가 초기화되지 않도록 App.tsx 수준의 상태 캐싱 메커니즘을 구현했습니다.
- **⚠️ 페이지 이탈 방지**: 작업 중 데이터 유실을 막기 위해 브라우저 종료/새로고침 시 사용자 경고 알림(`beforeunload`)을 추가했습니다.
- **�️ 이미지 생성 품질 고도화**: Imagen 4.0 생성 시 이미지 내 텍스트 포함을 방지하는 프롬프트 최적화 및 생성 중 중복 클릭 방지 기능을 적용했습니다.
- **🇯🇵 언어 특화 TTS 처리**: 일본어 후리가나(`漢字(かんじ)`) 등 괄호가 포함된 텍스트에서 발음 정보만 스마트하게 추출하여 읽어주는 논리 구조를 추가했습니다.
- **📈 UX 레이아웃 최적화**: 원고 수집 단계의 탭 순서를 학습 중요도 순으로 조정하고, 데이터 편집 시 '어셋 툴'을 기본 뷰로 설정하여 접근성을 높였습니다.

---

## 🏗️ 시스템 아키텍처 (3단계 모듈화)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Metaon Instant Content Builder                   │
├─────────────────┬─────────────────┬─────────────────────────────────┤
│   Step 1        │   Step 2        │   Step 3                        │
│   📤 원고 수집   │   ✏️ 데이터 편집 │   🎮 액티비티 런타임             │
│                 │                 │                                 │
│   • OCR 엔진    │   • CRUD UI     │   • Activity Selector           │
│   • PDF/이미지   │   • AI 이미지   │   • Sandbox Runtime             │
│   • 컨텍스트파싱 │   • AI 오디오   │   • Metaon Integration          │
└────────┬────────┴────────┬───────┴──────────┬────────────────────────┘
         │                 │                  │
         ▼                 ▼                  ▼
    [JSON Schema]    [JSON Schema]     [Activity Bundle]
```

---

## 📁 폴더 구조

```
/metaon-instant-content-builder
│
├── 📂 src/
│   ├── 📂 shared/                    # 공용 모듈
│   │   ├── types.ts                  # 타입 정의
│   │   ├── utils.ts                  # 유틸리티 함수
│   │   ├── stateManager.ts           # 상태 관리자
│   │   └── index.ts
│   │
│   ├── 📂 step1-acquisition/         # Step 1: 원고 수집
│   │   ├── Step1Acquisition.tsx
│   │   └── index.ts
│   │
│   ├── 📂 step2-refinement/          # Step 2: 데이터 편집
│   │   ├── Step2Refinement.tsx
│   │   └── index.ts
│   │
│   ├── 📂 step3-activity-runtime/    # Step 3: 액티비티 런타임
│   │   ├── Step3Runtime.tsx
│   │   └── index.ts
│   │
│   ├── App.tsx                       # 메인 애플리케이션
│   ├── main.tsx                      # 진입점
│   └── index.css                     # 전역 스타일
│
├── 📂 public/
│   └── favicon.svg
│
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## 🔧 주요 기능

### Step 1: 원고 수집 (Data Acquisition)
- **OCR 엔진**: Gemini AI를 활용한 PDF 및 이미지 내 텍스트 추출
- **Context 파싱**: 추출된 텍스트를 문제, 정답, 설명 등으로 자동 분류
- **스마트 필터링**: 레벨 정보, 지시어 등 학습 외 요소 자동 제외 기능 강화
- **비용 계산**: 처리 건별 토큰 사용량 기반 실시간 비용 추계
- **다국어 지원**: 중국어, 일본어, 한국어, 영어 텍스트 인식
- **신뢰도 표시**: 각 추출 결과의 OCR 정확도 표시

### Step 2: 데이터 편집 (Content Refinement)
- **CRUD 인터페이스**: 직관적인 리소스 관리 UI
- **AI 스마트 분절**: 텍스트를 학습 단위로 자동 분절
- **GenAI 이미지 생성**: Imagen 4.0 기반 교육용 이미지 생성 (Text-Free 프롬프트 최적화)
- **고도화된 AI TTS**: 
  - Web Speech API 기반 다국어 TTS 자동 매칭 및 **언어 자동 감지(Detector)**
  - **후리가나/병음 필터링**: 괄호 안의 발음 정보만 추출하여 읽어주는 발화 논리 적용
  - **미리듣기(Preview)** 및 생성 중 상태 관리 지원
- **데이터 검증**: 무결성 체크 및 단계 간 데이터 캐싱을 통한 안전한 내비게이션 지원

### Step 3: 액티비티 런타임 (Activity Engine)
- **Activity Selector**: 8가지 액티비티 타입 지원
  - 객관식 퀴즈
  - 빈칸채우기
  - 매칭 게임
  - 음성인식
  - 필기연습
  - 플래시카드
  - 드래그앤드롭
  - 메타버스 탐험
- **Sandbox Runtime**: iframe 기반 독립 실행 환경
- **Metaon Integration**: 메타온 커리큘럼 DB와 동기화

---

## 🛡️ 샌드박스 처리 원칙 (Anti-Interference)

| 원칙 | 설명 |
|------|------|
| **Scope Isolation** | 각 단계별 독립된 State Management 유지 |
| **Resource Cleanup** | 액티비티 종료 시 메모리 및 이벤트 리스너 해제 |
| **Variable Shadowing 방지** | 글로벌 변수 금지, 모듈 캡슐화 |
| **JSON Schema 통신** | 단계 간 데이터 이동은 정의된 스키마로만 진행 |

---

## 🚀 시작하기

### 사전 요구사항
- Node.js 18.x 이상
- npm 또는 yarn

### 설치

```bash
# 저장소 클론
cd metaon-instant-content-builder

# 의존성 설치
npm install
```

### 환경 설정

`.env.local` 파일에 Gemini API 키를 설정합니다:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

### 실행

```bash
# 개발 서버 시작
npm run dev
```

브라우저에서 `http://localhost:5173`으로 접속합니다.

---

## 📊 데이터 스키마

### Step 1 → Step 2 전환 데이터

```typescript
interface Step1Output {
  sessionId: string;
  timestamp: string;
  sourceFile: { name: string; type: string; size: number };
  results: RawOCRBlock[];
  metadata: {
    totalBlocks: number;
    pageCount: number;
    languages: Language[];
    processingTime: number;
  };
}
```

### Step 2 → Step 3 전환 데이터

```typescript
interface Step2Session {
  sessionId: string;
  hierarchy: PageHierarchy;
  resources: Record<string, ResourceData[]>; // setKey 기반 리소스 맵
  stacks: Record<string, StackData[]>;    // pageKey 기반 스택 맵
  config: {
    viewMode: 'ASSET_POOL' | 'PAGE_EDITOR';
    hierarchy: PageHierarchy;
  };
}
```

---

## 🎨 UI/UX 특징

- **글래스모피즘**: 모던한 반투명 UI
- **네온 글로우**: 액센트 요소에 빛나는 효과
- **스무스 애니메이션**: 부드러운 전환 효과
- **반응형 디자인**: 모바일/태블릿/데스크톱 지원
- **다크 모드 대응**: 시스템 설정 연동 (예정)

---

## 🗺️ 로드맵

- [x] **Phase 1**: 3단계 모듈 기본 구조 구현
- [ ] **Phase 2**: 단계별 샌드박스 통신 프로토콜 고도화
- [ ] **Phase 3**: 메타온 메인 엔진과의 API 연동
- [ ] **Phase 4**: 오프라인 지원 (PWA)
- [ ] **Phase 5**: 협업 기능 (실시간 동시 편집)

---

## 📜 라이선스

MIT License

---

## 🙏 크레딧

- **Google Gemini AI** - OCR, 이미지 생성, TTS
- **React** - UI 프레임워크
- **TailwindCSS** - 스타일링
- **Vite** - 빌드 도구

---

<div align="center">
  <p><strong>Made with ❤️ for Teachers</strong></p>
  <p>© 2026 Metaon Education Technology</p>
</div>
