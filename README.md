# SPOT AI — 스마트 화초 케어 소개 페이지

AI 화초 상태 인식 및 자동 급수 시스템 **SPOT AI**를 소개하는 정적 홈페이지입니다.
Stitch 디자인(「AI 화초 상태 인식 및 자동 급수 시스템 제품 소개서」)을 기준으로 HTML/CSS/JS로 구현했습니다.

## 폴더 구성

```
spot-ai/
├── index.html          ← 홈페이지 (GitHub Pages 시작 파일)
├── css/style.css       ← 디자인 토큰 및 반응형 스타일
├── js/main.js          ← 모바일 메뉴, 현재 섹션 표시, PDF 다운로드 안내
├── images/             ← 이미지 (hero-spot.jpg)
└── docs/               ← (예정) 기술 사양서 PDF
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

## 참고

- 기술 사양서는 `docs/spot-ai-tech-spec.pdf`에 넣으면 다운로드 버튼이 동작합니다. 파일이 없으면 "준비 중" 안내가 표시됩니다.
- 글꼴(Inter, Pretendard)과 아이콘(Material Symbols)은 CDN에서 불러오므로 인터넷 연결이 필요합니다.
- GitHub Pages: 저장소 Settings → Pages에서 배포 브랜치를 지정하면 바로 배포됩니다.
