/* Optional progressive enhancement: no content depends on animation. */
(() => {
  "use strict";
  if (!window.matchMedia || !("IntersectionObserver" in window)) return;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const targets = document.querySelectorAll(".section-heading,.method-intro,.score-model,.info-hero-grid,.policy-card-grid,.price-card,.contact-card,.week-toolbar,.weekly-pulse,.studio-intro,.account-card");
  let observer;
  function syncMotion() {
    observer?.disconnect();
    targets.forEach((target) => target.classList.remove("motion-enter"));
    if (preference.matches) return;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("motion-enter");
        observer.unobserve(entry.target);
      });
    }, {threshold: .12});
    targets.forEach((target) => observer.observe(target));
  }
  syncMotion();
  preference.addEventListener?.("change", syncMotion);
  window.addEventListener("pagehide", () => observer?.disconnect());
  window.addEventListener("pageshow", (event) => { if (event.persisted) syncMotion(); });
})();
