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
