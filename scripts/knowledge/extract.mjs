// @ts-check
/* 웹사이트 HTML → 의미 단위 청크
 * 1) id가 있는 섹션/블록/카드를 "단위"로 보고, 하위 단위는 별도로 분리합니다.
 * 2) 아이콘 글리프·메뉴·버튼 등 UI 문구는 제외하고 제목 구조(##, ###)를 보존한 텍스트로 변환합니다.
 * 3) 단위가 길면 소제목 경계 → 줄 경계 → 문장 경계 순으로 나누고, 이어지는 청크에는 단위 제목을 다시 붙여 문맥을 유지합니다. */

import { createHash } from "node:crypto";
import { parse, NodeType } from "node-html-parser";
import {
  UNIT_SELECTOR, IGNORE_SELECTOR, CHUNK_TARGET, CHUNK_MAX, CHUNK_MIN,
  CATEGORY_RULES, DEFAULT_CATEGORY,
} from "./config.mjs";

/** @typedef {import("node-html-parser").HTMLElement} El */
/** @typedef {import("node-html-parser").Node} N */
/** @typedef {{ text: string, level?: number }} Line  level가 있으면 제목 */
/** @typedef {{ id: string, parentId: string | null, topId: string, lines: Line[] }} Unit */

const BLOCK_TAGS = new Set([
  "p", "div", "li", "ul", "ol", "dl", "article", "section", "main", "figure", "figcaption",
  "blockquote", "pre", "caption", "h1", "h2", "h3", "h4", "h5", "h6", "table", "tr", "br",
]);
/** 자식 사이에 공백을 넣지 않는 문장형 요소 */
const INLINE_TEXT_TAGS = new Set(["p", "strong", "em", "b", "i", "a", "code", "sup", "sub"]);
const HEADING_CLASSES = { "t-headline-md": 3, "t-headline-sm": 4 };
/** 형제가 여러 개일 때 각각 목록 항목으로 펼칠 인라인 요소 */
const ITEM_CLASSES = ["chip", "pp-param", "pp-node", "pp-legend"];
/** 의미가 있는 아이콘 글리프만 기호로 남깁니다 */
const ICON_SYMBOLS = { arrow_forward: "→", arrow_downward: "↓", east: "→", south: "↓" };

const clean = (/** @type {string} */ s) => s.replace(/[\s ]+/g, " ").trim();

/** @param {El} el */
function headingLevel(el) {
  const m = /^h([1-6])$/.exec(el.rawTagName?.toLowerCase() ?? "");
  if (m) return Math.max(2, Number(m[1]));
  for (const [cls, lvl] of Object.entries(HEADING_CLASSES)) if (el.classList?.contains(cls)) return lvl;
  return 0;
}

/** @param {El} el */
function isItem(el) {
  if (!ITEM_CLASSES.some((c) => el.classList?.contains(c))) return false;
  const p = el.parentNode;
  return !!p && p.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE && ITEM_CLASSES.some((k) => /** @type {El} */ (c).classList?.contains(k))).length > 1;
}

/** 표는 "열 제목: 값" 형식의 행 단위 문장으로 변환합니다. @param {El} table */
function tableLines(table) {
  /** @type {Line[]} */
  const out = [];
  const caption = table.querySelector("caption");
  if (caption) out.push({ text: clean(caption.text) });
  const headers = table.querySelectorAll("thead th").map((th) => clean(th.text));
  for (const tr of table.querySelectorAll("tbody tr")) {
    const cells = tr.querySelectorAll("th, td").map((c) => clean(inlineText(c)));
    out.push({ text: "- " + cells.map((v, i) => (headers[i] ? `${headers[i]}: ${v}` : v)).join(" / ") });
  }
  return out;
}

/** 블록 구분 없이 요소의 텍스트만 이어 붙입니다(무시 요소 제외). @param {N} node */
function inlineText(node) {
  if (node.nodeType === NodeType.TEXT_NODE) return node.text;
  if (node.nodeType !== NodeType.ELEMENT_NODE) return "";
  const el = /** @type {El} */ (node);
  if (el.matches?.(IGNORE_SELECTOR)) return el.classList?.contains("icon") ? (ICON_SYMBOLS[clean(el.text)] ? ` ${ICON_SYMBOLS[clean(el.text)]} ` : " ") : " ";
  if (el.rawTagName?.toLowerCase() === "br") return " ";
  return el.childNodes.map(inlineText).join(el.rawTagName?.toLowerCase() === "span" ? " " : "");
}

/**
 * 페이지를 단위별 줄 목록으로 변환합니다.
 * @param {El} root
 * @returns {Unit[]}
 */
function collectUnits(root) {
  /** @type {Unit[]} */
  const units = [];
  /** @type {Unit[]} */
  const stack = [];
  let buf = "";

  const current = () => stack[stack.length - 1];
  const flush = () => {
    const t = clean(buf);
    // 목록 기호만 있는 경우(li 안에 블록 요소가 있는 구조)는 다음 줄 앞에 붙입니다
    if (t === "-") { buf = "- "; return; }
    buf = "";
    if (t && current()) current().lines.push({ text: t });
  };

  /** @param {N} node */
  function walk(node) {
    if (node.nodeType === NodeType.TEXT_NODE) { buf += node.text; return; }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const el = /** @type {El} */ (node);
    const tag = el.rawTagName?.toLowerCase() ?? "";

    if (el.matches?.(IGNORE_SELECTOR)) {
      if (el.classList?.contains("icon")) buf += ICON_SYMBOLS[clean(el.text)] ? ` ${ICON_SYMBOLS[clean(el.text)]} ` : " ";
      return;
    }

    const startsUnit = el.id && el.matches?.(UNIT_SELECTOR);
    if (startsUnit) {
      flush();
      const parent = current();
      const unit = { id: el.id, parentId: parent?.id ?? null, topId: parent?.topId ?? el.id, lines: [] };
      units.push(unit);
      stack.push(unit);
    }

    const level = headingLevel(el);
    if (level) {
      flush();
      const t = clean(inlineText(el));
      if (t && current()) current().lines.push({ text: t, level });
    } else if (tag === "table") {
      flush();
      if (current()) current().lines.push(...tableLines(el));
    } else if (tag === "pre") {
      flush();
      const rows = el.text.split(/\r?\n/).map(clean).filter(Boolean);
      // 코드는 한 줄로 잇고, 필드 목록(image_id, pot_id …)은 쉼표로 나열합니다
      const t = rows.join(/[()=]/.test(el.text) ? " " : ", ").replace(/\( /g, "(").replace(/ \)/g, ")");
      if (t && current()) current().lines.push({ text: t });
    } else if (isItem(el)) {
      flush();
      const t = clean(inlineText(el));
      if (t && current()) current().lines.push({ text: "- " + t });
    } else {
      const block = BLOCK_TAGS.has(tag);
      if (block) flush();
      if (tag === "li") buf += "- ";
      el.childNodes.forEach((c, i) => {
        // 인라인 요소 사이 공백 보장 (예: <span>A</span><span>B</span>)
        if (i > 0 && !INLINE_TEXT_TAGS.has(tag)) buf += " ";
        walk(c);
      });
      if (tag === "dt") buf += ": ";
      if (block) flush();
    }

    if (startsUnit) { flush(); stack.pop(); }
  }

  walk(root);
  flush();
  // 단위 밖 텍스트는 버립니다(헤더·푸터는 IGNORE 대상)
  return units.filter((u) => u.lines.length);
}

/** @param {string} id */
function categoryOf(id) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(id)) return cat;
  return DEFAULT_CATEGORY;
}

/** @param {Line} l */
const render = (l) => (l.level ? `${"#".repeat(l.level)} ${l.text}` : l.text);
/** @param {Line[]} ls */
const size = (ls) => ls.reduce((n, l) => n + render(l).length + 1, 0);

/** 긴 줄은 문장 경계에서 나눕니다. @param {Line} line @returns {Line[]} */
function splitLongLine(line) {
  if (render(line).length <= CHUNK_TARGET || line.level) return [line];
  const sentences = line.text.match(/[^.!?。]+(?:[.!?。]+|$)\s*/g) ?? [line.text];
  /** @type {Line[]} */
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length > CHUNK_TARGET) { out.push({ text: cur.trim() }); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push({ text: cur.trim() });
  return out;
}

/**
 * 단위 줄 목록을 청크 본문들로 나눕니다.
 * @param {Line[]} lines
 * @param {Line | undefined} contextHeading 이어지는 청크 앞에 반복할 단위 제목
 */
function splitUnit(lines, contextHeading) {
  const flat = lines.flatMap(splitLongLine);
  // 목표 크기 이하면 그대로 둡니다. 넘으면 소제목 단위로 나눠 서로 다른 주제(예: 하드웨어 / 소프트웨어)가
  // 한 임베딩에 섞여 검색 정확도가 떨어지지 않게 합니다.
  if (size(flat) <= CHUNK_TARGET) return [flat];

  // 소제목(###) 경계로 구간을 만든 뒤 목표 크기까지 묶습니다. ####는 상위 소제목에 포함됩니다.
  /** @type {Line[][]} */
  const segments = [];
  for (const l of flat) {
    if (!segments.length || l.level === 3) segments.push([]);
    segments[segments.length - 1].push(l);
  }
  /** @type {Line[][]} */
  const chunks = [];
  let cur = /** @type {Line[]} */ ([]);
  const push = () => { if (cur.length) chunks.push(cur); cur = []; };
  for (const seg of segments) {
    if (cur.length && size(cur) + size(seg) > CHUNK_TARGET) push();
    if (size(seg) > CHUNK_MAX) {
      // 구간 하나가 너무 길면 줄 단위로 묶고, 구간 제목을 각 조각에 반복합니다.
      const head = seg[0].level ? seg[0] : undefined;
      for (const l of seg) {
        if (cur.length && size(cur) + render(l).length > CHUNK_TARGET) { push(); if (head && l !== head) cur.push(head); }
        cur.push(l);
      }
      push();
    } else {
      cur.push(...seg);
    }
  }
  push();
  // 마지막 조각이 너무 짧으면 앞 조각에 합칩니다
  if (chunks.length > 1 && size(chunks[chunks.length - 1]) < CHUNK_MIN) {
    const tail = /** @type {Line[]} */ (chunks.pop());
    chunks[chunks.length - 1].push(...tail);
  }
  return chunks.map((c, i) => (i > 0 && contextHeading && c[0] !== contextHeading ? [contextHeading, ...c] : c));
}

/** @param {unknown} v */
export const sha256 = (v) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

/**
 * @param {string} html
 * @param {{ file: string, page: string }} source
 */
export function extractChunks(html, source) {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, noscript: true } });
  const body = root.querySelector("body") ?? root;
  const units = collectUnits(body);
  const byId = new Map(units.map((u) => [u.id, u]));

  // 너무 짧은 단위(예: 하위 카드만 있는 블록의 제목)는 같은 최상위 섹션의 다음 단위 앞에 붙여 문맥으로 씁니다.
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (size(u.lines) >= CHUNK_MIN) continue;
    const next = units[i + 1];
    const prev = units[i - 1];
    if (next && next.topId === u.topId) { next.lines.unshift(...u.lines); u.lines = []; }
    else if (prev && prev.topId === u.topId) { prev.lines.push(...u.lines); u.lines = []; }
  }

  const firstHeading = (/** @type {Unit} */ u) => u.lines.find((l) => l.level);
  /** @param {Unit | undefined} u @returns {string[]} */
  const crumbs = (u) => {
    /** @type {string[]} */
    const out = [];
    for (let cur = u; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      const h = firstHeading(cur);
      if (h && !out.includes(h.text)) out.unshift(h.text);
    }
    return out;
  };

  const chunks = [];
  let index = 0;
  for (const u of units) {
    if (!u.lines.length) continue;
    const top = byId.get(u.topId);
    const section = (top && firstHeading(top)?.text) || source.page;
    const path = crumbs(u);
    const title = path.length > 1 ? path.slice(-2).join(" › ") : path[0] || section;
    const own = categoryOf(u.id);
    const category = own === DEFAULT_CATEGORY ? categoryOf(u.topId) : own;
    const parts = splitUnit(u.lines, firstHeading(u));
    parts.forEach((lines, part) => {
      const content = lines.map(render).join("\n");
      const url = `${source.file}#${u.id}`;
      // 나뉜 청크는 자기 소제목(###)을 제목에 덧붙여 구분합니다 (예: "… › 소프트웨어 스택")
      const sub = parts.length > 1 ? lines.find((l) => l.level === 3)?.text : undefined;
      const base = path[path.length - 1] || section;
      const partTitle = sub && sub !== base ? `${base} › ${sub}` : title;
      const record = { title: partTitle, section, category, content, url };
      chunks.push({
        chunk_key: `${source.file}#${u.id}#${part}`,
        category,
        title: partTitle,
        content,
        source: source.file,
        section,
        anchor: u.id,
        url,
        chunk_index: index++,
        content_hash: sha256(record),
        metadata: {
          page: source.page,
          breadcrumb: path,
          part,
          parts: parts.length,
          parent_anchor: u.parentId,
          chars: content.length,
        },
      });
    });
  }
  return chunks;
}
