// @ts-check
/* SPOT AI 챗봇 지식 데이터 추출 설정
 * - 웹사이트 HTML이 유일한 원본입니다. 콘텐츠를 추가/수정하면 `npm run sync:knowledge`만 다시 실행하세요.
 * - 새 섹션에 id를 붙이면 자동으로 청크 단위가 되며, 아래 CATEGORY_RULES로 카테고리를 지정합니다. */

/** 지식 원본 페이지 (프로젝트 루트 기준 경로) */
export const SOURCES = [
  { file: "index.html", page: "SPOT AI 제품 소개" },
  { file: "ai-models.html", page: "범용 비전 AI 비교" },
];

/** 청크 단위가 되는 요소: id가 있는 섹션 · 블록 · 카드 */
export const UNIT_SELECTOR = "section[id], .pp-block[id], article[id], [role=group][id]";

/** 텍스트에서 제외할 요소: 아이콘 글리프, 네비게이션, 인터랙티브 UI, 숨김 요소 */
export const IGNORE_SELECTOR = [
  "script", "style", "noscript", "svg", "template",
  "header.site-header", "footer.site-footer", "nav",
  "button", "input", "select", "textarea",
  ".icon", "[aria-hidden=true]", "[hidden]",
  ".btn", ".pp-try", ".pp-flow__legend", ".bar",
  "[data-chatbot-ignore]",
].join(", ");

/** 청크 크기 (문자 수). 목표 크기를 넘는 단위는 소제목(###) 경계로 나눕니다. 한국어 기준 약 300~600 토큰 */
export const CHUNK_TARGET = 900;
export const CHUNK_MAX = 1400;
/** 이보다 짧은 단위는 바로 앞 청크(같은 섹션)에 합칩니다 */
export const CHUNK_MIN = 120;

/**
 * 블록 id → 카테고리. 위에서부터 처음 일치하는 규칙을 사용합니다.
 * @type {Array<[RegExp, string]>}
 */
export const CATEGORY_RULES = [
  [/^product-overview$/, "project_overview"],
  [/^challenges-and-hypotheses$/, "problem_and_hypothesis"],
  [/^operational-cycle$/, "automation"],
  [/^(pp-raw|pp-meta|pp-quality|pp-roi|pp-transform|pp-resize|pp-rgb|pp-norm|pp-augment|pp-preserve|pp-split|pp-dataset|image-pipeline)$/, "preprocessing"],
  [/^(pp-training|pp-deploy)$/, "ai_models"],
  [/^(pp-compare|pp-try)$/, "soil_moisture"],
  [/^ms-data$/, "data_collection"],
  [/^(ms-eval|ms-edge)$/, "validation"],
  [/^(model-selection|ms-)/, "ai_models"],
  [/^performance-and-metrics$/, "performance"],
  [/^hardware-specs$/, "system_architecture"],
  [/^mobile-dashboard$/, "dashboard"],
  [/^validation$/, "roadmap"],
  [/^am-refs$/, "references"],
  [/^am-/, "model_comparison"],
];

export const DEFAULT_CATEGORY = "general";
