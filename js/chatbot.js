// @ts-check
/* SPOT AI 챗봇 위젯 — 우측 하단 플로팅 버튼 + 채팅 패널
 *
 * 사용: <script src="js/chatbot.js" data-endpoint="https://<project>.supabase.co/functions/v1/spot-ai-chat" defer></script>
 * - 답변은 Supabase Edge Function(spot-ai-chat)이 RAG로 생성해 SSE로 스트리밍합니다. 이 파일에는 어떤 키도 없습니다.
 * - 패널 DOM은 처음 열 때 만듭니다. 대화는 sessionStorage에 저장해 페이지를 옮겨도 이어집니다.
 * - 답변 Markdown은 HTML을 모두 이스케이프한 뒤 허용된 태그만 만들어 표시합니다. */

(function () {
  "use strict";

  const script = /** @type {HTMLScriptElement | null} */ (document.currentScript);
  const ENDPOINT = script?.dataset.endpoint ?? "";
  if (!ENDPOINT) { console.warn("[SPOT AI 챗봇] data-endpoint가 없어 비활성화합니다."); return; }

  const STORAGE_KEY = "spot-ai-chat:v1";
  const MAX_INPUT = 800;
  const HISTORY_FOR_API = 6;
  const SUGGESTIONS = [
    "SPOT AI는 무엇인가요?",
    "어떤 AI 모델을 사용하나요?",
    "토양 수분은 어떻게 분석하나요?",
    "자동 급수는 어떤 방식으로 동작하나요?",
  ];
  const WELCOME = "안녕하세요! SPOT AI 어시스턴트입니다.\n\nSPOT AI의 주요 기능, AI 모델, 식물 상태 인식, 토양 수분 분석 및 자동 급수 기술에 관해 궁금한 내용을 질문해 주세요.\n\n웹사이트에 공개된 프로젝트 정보를 바탕으로 답변해 드립니다.";

  /** @typedef {{ title: string, section: string | null, url: string | null }} Source */
  /** @typedef {{ role: "user" | "assistant", content: string, sources?: Source[], error?: boolean }} Message */

  // ───────────────────────── 상태 ─────────────────────────
  /** @type {{ messages: Message[], open: boolean }} */
  let state = { messages: [], open: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.messages)) state = { messages: saved.messages.slice(-40), open: !!saved.open };
  } catch { /* 저장소를 쓸 수 없으면 새 대화로 시작 */ }
  const persist = () => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: state.messages.filter((m) => !m.error).slice(-40), open: state.open })); } catch { /* 무시 */ }
  };

  /** @type {AbortController | null} */
  let inflight = null;

  // ───────────────────────── 스타일 · 버튼 ─────────────────────────
  const cssHref = new URL("../css/chatbot.css", script?.src || location.href).href;
  if (!document.querySelector(`link[href="${cssHref}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssHref;
    document.head.appendChild(link);
  }

  /** @param {string} tag @param {Record<string, string>} [attrs] @param {(Node | string)[]} [children] */
  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v);
    }
    children.forEach((c) => el.append(c));
    return el;
  }
  const icon = (/** @type {string} */ name) => h("span", { class: "icon", "aria-hidden": "true", text: name });

  const fab = /** @type {HTMLButtonElement} */ (h("button", {
    class: "cb-fab", type: "button", "aria-label": "SPOT AI 챗봇 열기", "aria-expanded": "false", "aria-controls": "cb-panel", "aria-haspopup": "dialog",
  }, [icon("forum")]));
  document.body.appendChild(fab);

  // ───────────────────────── 패널 (지연 생성) ─────────────────────────
  /** @type {{ panel: HTMLElement, log: HTMLElement, input: HTMLTextAreaElement, send: HTMLButtonElement, form: HTMLFormElement } | null} */
  let ui = null;

  function buildPanel() {
    const closeBtn = h("button", { class: "cb-iconbtn", type: "button", "aria-label": "챗봇 닫기" }, [icon("close")]);
    const resetBtn = h("button", { class: "cb-iconbtn", type: "button", "aria-label": "새 대화 시작", title: "새 대화" }, [icon("refresh")]);
    const head = h("div", { class: "cb-head" }, [
      closeBtn,
      h("span", { class: "cb-avatar", "aria-hidden": "true" }, [icon("potted_plant")]),
      h("div", { class: "cb-title" }, [
        h("span", { class: "cb-title__name", id: "cb-title", text: "SPOT AI" }),
        h("span", { class: "cb-title__sub" }, [h("span", { class: "dot", "aria-hidden": "true" }), "AI Assistant"]),
      ]),
      resetBtn,
    ]);
    const log = h("div", { class: "cb-log", role: "log", "aria-live": "polite", "aria-relevant": "additions", "aria-label": "대화 내용", tabindex: "0" });
    const input = /** @type {HTMLTextAreaElement} */ (h("textarea", {
      class: "cb-input", rows: "1", maxlength: String(MAX_INPUT), placeholder: "SPOT AI에게 질문해 주세요.", "aria-label": "질문 입력", enterkeyhint: "send",
    }));
    const send = /** @type {HTMLButtonElement} */ (h("button", { class: "cb-send", type: "submit", "aria-label": "질문 보내기", disabled: "" }, [icon("arrow_upward")]));
    const form = /** @type {HTMLFormElement} */ (h("form", { class: "cb-form" }, [input, send]));
    const foot = h("div", { class: "cb-foot" }, [
      form,
      h("p", { class: "cb-note", text: "AI 답변은 SPOT AI 프로젝트 정보를 기반으로 생성되며, 일부 내용은 추가 확인이 필요할 수 있습니다." }),
    ]);
    const panel = h("section", { class: "cb-panel", id: "cb-panel", role: "dialog", "aria-modal": "false", "aria-labelledby": "cb-title", hidden: "" }, [head, log, foot]);
    document.body.appendChild(panel);

    closeBtn.addEventListener("click", () => setOpen(false));
    resetBtn.addEventListener("click", resetConversation);
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } });

    input.addEventListener("input", () => { autoGrow(); syncSend(); });
    input.addEventListener("keydown", (e) => {
      // 한글 조합 중 Enter는 글자 확정이므로 전송하지 않습니다.
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (inflight) { inflight.abort(); return; } // 응답 중에는 '중지' 버튼
      ask(input.value);
    });

    ui = { panel, log, input, send, form };
    renderAll();
  }

  function autoGrow() {
    if (!ui) return;
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 120) + "px";
  }

  function syncSend() {
    if (!ui) return;
    const busy = !!inflight;
    ui.send.dataset.busy = String(busy);
    ui.send.disabled = !busy && !ui.input.value.trim();
    ui.send.setAttribute("aria-label", busy ? "답변 생성 중지" : "질문 보내기");
    const ic = ui.send.querySelector(".icon");
    if (ic) ic.textContent = busy ? "stop" : "arrow_upward";
    ui.log.setAttribute("aria-busy", String(busy));
    ui.log.querySelectorAll(".cb-chip").forEach((c) => { /** @type {HTMLButtonElement} */ (c).disabled = busy; });
  }

  // ───────────────────────── 열기/닫기 ─────────────────────────
  function setOpen(/** @type {boolean} */ open) {
    if (open && !ui) buildPanel();
    if (!ui) return;
    state.open = open;
    persist();
    ui.panel.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "SPOT AI 챗봇 닫기" : "SPOT AI 챗봇 열기");
    if (open) {
      updateViewport();
      scrollToBottom(true);
      // 모바일에서 열자마자 키보드가 올라오지 않도록 데스크톱에서만 입력창에 포커스
      if (window.matchMedia("(min-width: 480px)").matches) ui.input.focus({ preventScroll: true });
      else /** @type {HTMLElement | null} */ (ui.panel.querySelector(".cb-iconbtn"))?.focus({ preventScroll: true });
    } else {
      fab.focus({ preventScroll: true });
    }
  }
  fab.addEventListener("click", () => setOpen(fab.getAttribute("aria-expanded") !== "true"));

  // 모바일 키보드가 열리면 보이는 영역 높이에 맞춰 패널 크기를 조정합니다.
  function updateViewport() {
    const vv = window.visualViewport;
    if (!ui || !vv) return;
    ui.panel.style.setProperty("--cb-vvh", vv.height + "px");
    ui.panel.style.setProperty("--cb-vvt", vv.offsetTop + "px");
  }
  window.visualViewport?.addEventListener("resize", () => { updateViewport(); scrollToBottom(false); });
  window.visualViewport?.addEventListener("scroll", updateViewport);

  // ───────────────────────── 렌더링 ─────────────────────────
  function isNearBottom() {
    if (!ui) return true;
    const { scrollTop, scrollHeight, clientHeight } = ui.log;
    return scrollHeight - scrollTop - clientHeight < 80;
  }
  function scrollToBottom(/** @type {boolean} */ force) {
    if (!ui || (!force && !isNearBottom())) return;
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function botRow(/** @type {HTMLElement} */ bubble) {
    return h("div", { class: "cb-msg cb-msg--bot" }, [h("span", { class: "cb-avatar cb-avatar--sm", "aria-hidden": "true" }, [icon("potted_plant")]), bubble]);
  }

  /** @param {Message} m */
  function messageEl(m) {
    if (m.role === "user") return h("div", { class: "cb-msg cb-msg--user" }, [h("div", { class: "cb-bubble", text: m.content })]);
    const bubble = h("div", { class: "cb-bubble" });
    const body = h("div", { class: "cb-md" + (m.error ? " cb-error" : "") });
    body.innerHTML = renderMarkdown(m.content);
    bubble.append(body);
    if (m.sources?.length) bubble.append(sourcesEl(m.sources));
    if (m.error) {
      const retry = h("button", { class: "cb-retry", type: "button" }, [icon("refresh"), "다시 시도"]);
      retry.addEventListener("click", retryLast);
      bubble.append(retry);
    }
    return botRow(bubble);
  }

  /** @param {Source[]} sources */
  function sourcesEl(sources) {
    const wrap = h("div", { class: "cb-sources" }, [h("span", { class: "cb-sources__label", text: "참고한 웹사이트 섹션" })]);
    for (const s of sources) {
      const href = safeUrl(s.url ?? "");
      if (!href) continue;
      const label = s.title.split(" › ").pop() || s.title;
      const a = h("a", { class: "cb-source", href, title: s.title }, [icon("link"), h("span", { text: label })]);
      a.addEventListener("click", () => { if (window.matchMedia("(max-width: 479px)").matches) setOpen(false); });
      wrap.append(a);
    }
    return wrap;
  }

  function renderAll() {
    if (!ui) return;
    ui.log.replaceChildren();
    const welcome = h("div", { class: "cb-md" });
    welcome.innerHTML = renderMarkdown(WELCOME);
    ui.log.append(botRow(h("div", { class: "cb-bubble" }, [welcome])));
    if (!state.messages.length) {
      const list = h("div", { class: "cb-suggest", role: "group", "aria-label": "추천 질문" });
      SUGGESTIONS.forEach((q) => {
        const chip = h("button", { class: "cb-chip", type: "button", text: q });
        chip.addEventListener("click", () => ask(q));
        list.append(chip);
      });
      ui.log.append(list);
    }
    state.messages.forEach((m) => ui?.log.append(messageEl(m)));
    syncSend();
    scrollToBottom(true);
  }

  function resetConversation() {
    inflight?.abort();
    state.messages = [];
    persist();
    renderAll();
    ui?.input.focus();
  }

  function retryLast() {
    const lastUser = [...state.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // 실패한 질문과 오류 메시지를 지우고 다시 보냅니다.
    const idx = state.messages.lastIndexOf(lastUser);
    state.messages = state.messages.slice(0, idx);
    renderAll();
    ask(lastUser.content);
  }

  // ───────────────────────── 질문 전송 ─────────────────────────
  async function ask(/** @type {string} */ raw) {
    const text = raw.trim().slice(0, MAX_INPUT);
    if (!text || inflight || !ui) return;
    const view = ui;

    const history = state.messages
      .filter((m) => !m.error)
      .slice(-HISTORY_FOR_API)
      .map((m) => ({ role: m.role, content: m.content }));

    state.messages.push({ role: "user", content: text });
    persist();
    view.log.querySelector(".cb-suggest")?.remove();
    view.log.append(messageEl(state.messages[state.messages.length - 1]));
    view.input.value = "";
    autoGrow();

    const bubble = h("div", { class: "cb-bubble" });
    const body = h("div", { class: "cb-md" });
    const typing = h("div", { class: "cb-typing", role: "status", "aria-label": "답변을 생성하고 있습니다" }, [h("span"), h("span"), h("span")]);
    bubble.append(typing);
    const row = botRow(bubble);
    view.log.append(row);
    scrollToBottom(true);

    const controller = new AbortController();
    inflight = controller;
    syncSend();

    let answer = "";
    /** @type {Source[]} */
    let sources = [];
    let frame = 0;
    const paint = () => {
      frame = 0;
      body.innerHTML = renderMarkdown(answer);
      scrollToBottom(false);
    };

    try {
      const timeout = window.setTimeout(() => controller.abort("timeout"), 60_000);
      let res;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, history, stream: true }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err.message === "string" ? err.message : "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }

      typing.replaceWith(body);
      body.classList.add("cb-streaming");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const dataLine = /^data: (.*)$/m.exec(block)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if ((event === "meta" || event === "done") && Array.isArray(data.sources)) sources = data.sources;
          else if (event === "delta") { answer += data.text ?? ""; if (!frame) frame = requestAnimationFrame(paint); }
          else if (event === "error") throw new Error(data.message || "답변 생성 중 오류가 발생했습니다.");
        }
      }
      if (frame) cancelAnimationFrame(frame);
      paint();
      body.classList.remove("cb-streaming");
      if (!answer.trim()) throw new Error("답변을 생성하지 못했습니다. 질문을 바꿔 다시 시도해 주세요.");
      if (sources.length) {
        const stick = isNearBottom();
        bubble.append(sourcesEl(sources));
        if (stick) scrollToBottom(true);
      }
      state.messages.push({ role: "assistant", content: answer, sources });
    } catch (err) {
      if (frame) cancelAnimationFrame(frame);
      const stopped = controller.signal.aborted && controller.signal.reason !== "timeout";
      if (stopped && answer.trim()) {
        // 사용자가 중지한 경우 받은 부분까지 보존합니다.
        paint();
        body.classList.remove("cb-streaming");
        state.messages.push({ role: "assistant", content: answer + "\n\n_(답변 생성을 중지했습니다)_", sources });
        row.replaceWith(messageEl(state.messages[state.messages.length - 1]));
      } else {
        const message = stopped ? "답변 생성을 중지했습니다."
          : controller.signal.reason === "timeout" ? "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
          : err instanceof TypeError ? "네트워크 연결을 확인한 뒤 다시 시도해 주세요."
          : err instanceof Error ? err.message : "답변을 가져오지 못했습니다.";
        const failed = /** @type {Message} */ ({ role: "assistant", content: message, error: !stopped });
        state.messages.push(failed);
        row.replaceWith(messageEl(failed));
      }
    } finally {
      inflight = null;
      persist();
      syncSend();
      scrollToBottom(false);
    }
  }

  // ───────────────────────── 안전한 Markdown ─────────────────────────
  /** @param {string} s */
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
  }

  /** 외부 http(s), 페이지 내 앵커, 사이트 내 .html 경로만 허용합니다. @param {string} url */
  function safeUrl(url) {
    const u = url.trim();
    if (/^https?:\/\/[^\s]+$/i.test(u) || /^#[\w-]+$/.test(u) || /^[\w-]+\.html(#[\w-]+)?$/.test(u)) return u;
    return "";
  }

  /** 이미 이스케이프된 문자열에 인라인 서식을 적용합니다. @param {string} s */
  function inline(s) {
    const codes = /** @type {string[]} */ ([]);
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, rawUrl) => {
      const url = safeUrl(rawUrl.replace(/&amp;/g, "&"));
      if (!url) return label;
      const external = /^https?:/i.test(url);
      return `<a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
    });
    s = s.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\n]+?)_(?![_\w])/g, "$1<em>$2</em>");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
  }

  /** @param {string} src */
  function renderMarkdown(src) {
    const lines = escapeHtml(src.replace(/\r\n?/g, "\n")).split("\n");
    const out = /** @type {string[]} */ ([]);
    /** @type {string[]} */
    let para = [];
    /** @type {{ type: "ul" | "ol", items: string[] } | null} */
    let list = null;
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`); list = null; };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        flushPara(); flushList();
        const code = [];
        while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
        out.push(`<pre><code>${code.join("\n")}</code></pre>`);
        continue;
      }
      const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (!line.trim()) { flushPara(); flushList(); }
      else if (heading) { flushPara(); flushList(); out.push(`<p class="cb-md-h">${inline(heading[1])}</p>`); }
      else if (bullet || ordered) {
        flushPara();
        const type = bullet ? "ul" : "ol";
        if (list && list.type !== type) flushList();
        if (!list) list = { type, items: [] };
        list.items.push((bullet || ordered)?.[1] ?? "");
      } else if (list && /^\s{2,}\S/.test(line)) {
        list.items[list.items.length - 1] += " " + line.trim();
      } else {
        flushList();
        para.push(line.trim());
      }
    }
    flushPara(); flushList();
    return out.join("");
  }

  if (state.open) setOpen(true);
})();
