# SPOT AI — 스마트 화초 케어 소개 페이지

AI 화초 상태 인식 및 자동 급수 시스템 **SPOT AI**를 소개하는 정적 홈페이지입니다.
Stitch 디자인(「AI 화초 상태 인식 및 자동 급수 시스템 제품 소개서」)을 기준으로 HTML/CSS/JS로 구현했습니다.

## 폴더 구성

```
spot-ai/
├── index.html          ← 홈페이지 (GitHub Pages 시작 파일)
├── ai-models.html      ← 범용 비전 AI(YOLOE·DINO-X·SAM 3 등) 대비 모델 선택 근거 비교 페이지
├── css/style.css       ← 디자인 토큰 및 반응형 스타일
├── js/main.js          ← 모바일 메뉴, 현재 섹션 표시, PDF 다운로드 안내
├── js/chatbot.js       ← SPOT AI 챗봇 위젯 (우측 하단 버튼 + 채팅 패널)
├── css/chatbot.css     ← 챗봇 위젯 스타일 (chatbot.js가 불러옴)
├── images/             ← 이미지 (hero-spot.jpg)
├── docs/               ← (예정) 기술 사양서 PDF
├── scripts/            ← 챗봇 지식 데이터 동기화 (npm run sync:knowledge)
└── supabase/           ← 챗봇 백엔드: Edge Functions · DB 마이그레이션
```

## 실행 방법

빌드 과정이 없습니다. `index.html`을 브라우저로 열거나, 로컬 서버로 확인합니다.

```bash
npx serve .
```

## 페이지 구성

1. 히어로 · 핵심 지표
2. 01 배경 & 가설
3. 02 6단계 작동 사이클 & Fail-Safe
4. 03 성능 지표 (KPI)
5. 04 하드웨어 & 소프트웨어 스택
6. 05 MVP 검증 기준 & 사양서 다운로드

별도 페이지 `ai-models.html`: YOLOE · DINO-X · SAM 3 · SigLIP2 · OCR · MediaPipe를 쓰지 않고 실측 데이터 기반 MobileNetV3-Small을 선택한 이유와 비교표 (메인 「모델 선정」 섹션에서 이동)

## SPOT AI 챗봇 (RAG)

웹사이트 우측 하단의 챗봇은 **이 사이트에 실제로 적힌 내용만** 근거로 답합니다.
GitHub Pages는 정적 호스팅이므로 서버 로직은 Supabase Edge Function에서 실행합니다.

```
브라우저(chatbot.js) ──POST──▶ Edge Function spot-ai-chat
                                 ├─ 후속 질문이면 검색 질의 재작성 (gemini-3.5-flash-lite)
                                 ├─ 질문 임베딩 (gemini-embedding-2, 1536차원)
                                 ├─ Supabase 하이브리드 검색 RPC match_spot_ai_knowledge (pgvector + PGroonga)
                                 └─ 답변 생성·스트리밍 (gemini-3.5-flash-lite, 실패 시 gemini-3.1-flash-lite)
```

| 구성 | 위치 |
|---|---|
| 위젯 | `js/chatbot.js`, `css/chatbot.css` — 두 HTML의 `<script ... data-endpoint>` 한 줄로 연결 |
| 챗봇 API | `supabase/functions/spot-ai-chat` (CORS 허용 Origin + IP별 요청 제한) |
| 동기화 API | `supabase/functions/spot-ai-sync` (`x-sync-token` 인증) |
| 모델·검색 설정 | `supabase/functions/_shared/config.ts` |
| DB 스키마 | `supabase/migrations/*.sql` (테이블 `spot_ai_knowledge` 등, RLS로 공개 접근 차단) |
| 지식 추출 규칙 | `scripts/knowledge/config.mjs` (청크 단위 · 카테고리 · 제외 요소) |

### 사이트 내용을 수정했을 때

```bash
npm install                 # 최초 1회
npm run knowledge:preview   # 추출될 청크 확인 (네트워크 없음)
npm run sync:knowledge:dry  # 신규/수정/삭제 예정 건수만 확인
npm run sync:knowledge      # 변경된 청크만 임베딩해 Supabase에 반영
```

- 내용이 같은 청크는 다시 임베딩하지 않습니다(`content_hash`). 몇 번 실행해도 중복이 생기지 않습니다.
- 페이지에서 사라진 섹션은 비활성화(soft delete)되며, `-- --prune`을 붙이면 영구 삭제합니다.
- 청크 수가 기존의 절반 미만으로 줄면 추출 오류로 보고 중단합니다(의도한 경우 `-- --force`).
- 새 섹션은 `id`가 있는 `section` / `.pp-block` / `article`이면 자동으로 별도 청크가 됩니다. 카테고리는 `CATEGORY_RULES`에서 지정합니다.

### 환경변수

| 이름 | 위치 | 용도 |
|---|---|---|
| `GEMINI_API_KEY` | `.env`, Supabase Edge Function Secret | Gemini 임베딩·생성 (서버에서만 사용) |
| `SPOT_AI_SUPABASE_URL` | `.env` | 동기화 스크립트가 호출할 Supabase 주소 |
| `SPOT_AI_SYNC_TOKEN` | `.env` | 동기화 API 인증 토큰 (DB에는 sha256 해시만 저장) |
| `SPOT_AI_ALLOWED_ORIGINS` | (선택) Edge Function Secret | CORS 허용 Origin을 바꿀 때 (쉼표 구분, `http://localhost:*` 형식 지원) |

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에 자동 주입되며 브라우저로 나가지 않습니다.

### Edge Function 배포

```bash
npx supabase login
npx supabase functions deploy spot-ai-chat spot-ai-sync --project-ref wwyshswirjwnsetltiqb --use-api
```

- 사이트 주소(도메인)가 바뀌면 `_shared/config.ts`의 `allowedOrigins` 또는 `SPOT_AI_ALLOWED_ORIGINS`를 수정해야 브라우저 호출이 허용됩니다.
- 요청 제한: IP당 분당 10회 · 일 150회, 전체 일 3,000회 (`_shared/config.ts`).
- 동기화 토큰 교체: 새 토큰을 `.env`에 넣고 `spot_ai_sync_tokens`에 sha256 해시를 추가한 뒤 이전 행의 `revoked_at`을 설정합니다.

## 참고

- 기술 사양서는 `docs/spot-ai-tech-spec.pdf`에 넣으면 다운로드 버튼이 동작합니다. 파일이 없으면 "준비 중" 안내가 표시됩니다.
- 글꼴(Inter, Pretendard)과 아이콘(Material Symbols)은 CDN에서 불러오므로 인터넷 연결이 필요합니다.
- GitHub Pages: 저장소 Settings → Pages에서 배포 브랜치를 지정하면 바로 배포됩니다.
