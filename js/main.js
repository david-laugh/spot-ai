// @ts-check
/* SPOT AI 홈페이지 — 모바일 메뉴, 현재 섹션 메뉴 표시, 사양서 다운로드 안내 */

(function () {
  "use strict";

  // ----- 모바일 메뉴 열기/닫기 -----
  const toggle = /** @type {HTMLButtonElement | null} */ (document.querySelector(".menu-toggle"));
  const mobileNav = /** @type {HTMLElement | null} */ (document.getElementById("mobile-nav"));

  /** @param {boolean} open */
  function setMenu(open) {
    if (!toggle || !mobileNav) return;
    mobileNav.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    const icon = toggle.querySelector(".icon");
    if (icon) icon.textContent = open ? "close" : "menu";
  }

  if (toggle && mobileNav) {
    toggle.addEventListener("click", function () {
      setMenu(toggle.getAttribute("aria-expanded") !== "true");
    });
    mobileNav.addEventListener("click", function (e) {
      if (e.target instanceof Element && e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !mobileNav.hidden) {
        setMenu(false);
        toggle.focus();
      }
    });
    window.matchMedia("(min-width: 1024px)").addEventListener("change", function (e) {
      if (e.matches) setMenu(false);
    });
  }

  // ----- 스크롤 위치에 맞춰 현재 메뉴 강조 -----
  const navLinks = /** @type {HTMLAnchorElement[]} */ (Array.from(document.querySelectorAll("[data-nav]")));
  const sections = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll("[data-section]")));

  /** @param {string} id */
  function setActive(id) {
    navLinks.forEach(function (link) {
      if (link.dataset.nav === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  }

  function updateActive() {
    // 헤더(64px) 바로 아래 기준선을 지난 마지막 섹션이 현재 섹션
    const offset = 160;
    let current = sections.length ? sections[0].id : "";
    sections.forEach(function (section) {
      if (section.getBoundingClientRect().top <= offset) current = section.id;
    });
    // 페이지 끝에 도달하면 마지막 섹션을 활성화
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && sections.length) {
      current = sections[sections.length - 1].id;
    }
    setActive(current);
  }

  let ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      updateActive();
      ticking = false;
    });
  }, { passive: true });
  updateActive();

  // ----- 모바일 대시보드 목업: 휴대폰 크기 맞춤, 화면 스크롤 진행률, 요약표 ↔ 화면 연동 -----
  const mdDevice = /** @type {HTMLElement | null} */ (document.querySelector("[data-md-device]"));
  const mdFrame = /** @type {HTMLIFrameElement | null} */ (document.querySelector("[data-md-frame]"));

  if (mdDevice && mdFrame) {
    const PHONE_W = 414; // 390 × 844 화면 + 베젤
    const PHONE_H = 868;
    const FRAME_HEADER = 64; // Stitch 화면의 고정 상단 바 높이
    const showcase = mdDevice.closest(".md-showcase");
    const progress = /** @type {HTMLElement | null} */ (mdDevice.querySelector("[data-md-progress]"));
    const rows = /** @type {HTMLTableRowElement[]} */ (Array.from(document.querySelectorAll("[data-md-target]")));
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    // 영역 너비와 창 높이 안에 휴대폰 전체가 들어오도록 축소 (최대 실제 크기)
    function fitPhone() {
      if (!mdDevice) return;
      const style = getComputedStyle(mdDevice);
      const width = mdDevice.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = window.innerHeight - 160; // 사이트 헤더 + 여백 + 안내 문구
      const scale = Math.max(0.6, Math.min(1, width / PHONE_W, height / PHONE_H));
      mdDevice.style.setProperty("--md-scale", scale.toFixed(3));
    }
    fitPhone();
    if ("ResizeObserver" in window) new ResizeObserver(fitPhone).observe(mdDevice);
    window.addEventListener("resize", fitPhone);

    /** 표의 data-md-target 번호 = Stitch 화면 본문(main > div)의 n번째 블록 */
    /** @param {Document} doc */
    function frameBlocks(doc) {
      return Array.from(doc.querySelectorAll("main > div > *"));
    }

    /** @param {number} index */
    function setActiveRow(index) {
      rows.forEach(function (row) {
        row.classList.toggle("is-active", Number(row.dataset.mdTarget) === index);
      });
    }

    function connectFrame() {
      if (!mdFrame) return;
      /** @type {Document | null} */
      let doc = null;
      try {
        doc = mdFrame.contentDocument; // file:// 로 열면 다른 출처로 취급되어 접근 불가
      } catch (e) {
        doc = null;
      }
      const win = mdFrame.contentWindow;
      if (!doc || !win || doc.URL === "about:blank") {
        if (showcase) showcase.classList.add("is-static");
        rows.forEach(function (row) {
          const btn = row.querySelector("[data-md-jump]");
          if (btn instanceof HTMLButtonElement) btn.disabled = true;
        });
        return;
      }
      const frameDoc = doc;

      function onFrameScroll() {
        if (!win) return;
        const max = frameDoc.documentElement.scrollHeight - win.innerHeight;
        const ratio = max > 0 ? Math.min(1, win.scrollY / max) : 0;
        if (progress) progress.style.transform = "scaleX(" + ratio.toFixed(3) + ")";

        // 상단 바 바로 아래를 지난 마지막 블록이 현재 영역, 끝까지 내리면 마지막 블록
        const blocks = frameBlocks(frameDoc);
        let current = 0;
        blocks.forEach(function (block, i) {
          if (block.getBoundingClientRect().top <= FRAME_HEADER + 48) current = i;
        });
        if (ratio > 0.98) current = blocks.length - 1;
        setActiveRow(current);
      }

      let frameTicking = false;
      win.addEventListener("scroll", function () {
        if (frameTicking) return;
        frameTicking = true;
        window.requestAnimationFrame(function () {
          onFrameScroll();
          frameTicking = false;
        });
      }, { passive: true });
      onFrameScroll();

      rows.forEach(function (row) {
        const btn = row.querySelector("[data-md-jump]");
        if (!btn) return;
        btn.addEventListener("click", function () {
          const index = Number(row.dataset.mdTarget);
          const block = frameBlocks(frameDoc)[index];
          if (!block) return;
          const top = index === 0 ? 0 : block.getBoundingClientRect().top + win.scrollY - FRAME_HEADER - 12;
          win.scrollTo({ top: top, behavior: reduceMotion.matches ? "auto" : "smooth" });
          setActiveRow(index);
        });
      });
    }

    mdFrame.addEventListener("load", connectFrame, { once: true });
    // 스크립트보다 iframe이 먼저 로드된 경우 (해시로 바로 진입 등)
    try {
      const early = mdFrame.contentDocument;
      if (early && early.readyState === "complete" && early.URL !== "about:blank") connectFrame();
    } catch (e) { /* 다른 출처 — load 이벤트에서 처리 */ }
  }

  // ----- 토스트 알림 -----
  const toast = /** @type {HTMLElement | null} */ (document.querySelector(".toast"));
  /** @type {number | undefined} */
  let toastTimer;

  /** @param {string} message */
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 3200);
  }

  // ----- 기술 사양서 PDF: 파일이 있으면 다운로드, 없으면 안내 -----
  document.querySelectorAll("[data-spec-pdf]").forEach(function (el) {
    const link = /** @type {HTMLAnchorElement} */ (el);
    link.addEventListener("click", function (e) {
      e.preventDefault();
      fetch(link.href, { method: "HEAD" })
        .then(function (res) {
          if (!res.ok) throw new Error(String(res.status));
          const a = document.createElement("a");
          a.href = link.href;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast("SPOT AI 기술 사양서(PDF) 다운로드가 시작됩니다.");
        })
        .catch(function () {
          showToast("기술 사양서(PDF)는 현재 준비 중입니다.");
        });
    });
  });
})();
