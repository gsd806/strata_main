/* Optional progressive enhancement: no content depends on animation. */
(() => {
  "use strict";
  if (!window.matchMedia || !("IntersectionObserver" in window)) return;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const selector = [
    "[data-reveal]",
    ".home-page .section-heading",
    ".method-intro",
    ".score-model",
    ".editorial-grid",
    ".source-grid",
    ".week-toolbar",
    ".plus-studio .feature-hub-heading",
    ".plus-studio .feature-grid",
    ".account-intro",
    ".account-access",
    ".info-hero-grid",
    ".pricing-grid",
    ".contact-grid",
    ".policy-card-grid",
    ".policy-founder",
    ".device-grid",
    ".help-grid",
    ".offline-shell",
    ".workout-page .start-panel",
    ".workout-page .history-section",
    ".admin-hero",
    ".admin-section"
  ].join(",");
  const root = document.documentElement;
  let targets=[];
  let observer;
  if (!preference.matches) root.classList.add("motion-ready");
  function syncMotion() {
    observer?.disconnect();
    if (preference.matches) {
      root.classList.remove("motion-ready");
      return;
    }
    root.classList.add("motion-ready");
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("motion-enter");
        observer.unobserve(entry.target);
      });
    }, {threshold: .08, rootMargin: "0px 0px -6%"});
    targets.forEach((target) => {
      if (!target.classList.contains("motion-enter")) observer.observe(target);
    });
  }
  function initialize() {
    targets=[...document.querySelectorAll(selector)];
    syncMotion();
  }
  if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",initialize,{once:true});
  else initialize();
  preference.addEventListener?.("change", syncMotion);
  window.addEventListener("pagehide", () => observer?.disconnect());
  window.addEventListener("pageshow", (event) => { if (event.persisted) syncMotion(); });
})();
