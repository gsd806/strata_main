const groups = {
  chest: {
    name: "Chest", description: "Pressing, adduction, and protraction across the pectorals and serratus.",
    subs: ["Upper chest", "Mid / lower chest", "Serratus anterior"]
  },
  back: {
    name: "Back", description: "Vertical and horizontal pulling for lats, scapular retractors, and spinal extensors.",
    subs: ["Latissimus dorsi", "Upper back", "Spinal erectors"]
  },
  shoulders: {
    name: "Shoulders", description: "Raise, press, and rotate through all three deltoid regions and the cuff.",
    subs: ["Front delts", "Side delts", "Rear delts", "Rotator cuff"]
  },
  arms: {
    name: "Arms", description: "Elbow flexion and extension for biceps, brachialis, triceps, and forearms.",
    subs: ["Biceps", "Brachialis", "Triceps long head", "Triceps lateral / medial", "Forearms"]
  },
  legs: {
    name: "Legs", description: "Knee- and hip-dominant patterns for thighs and adductors.",
    subs: ["Quadriceps", "Hamstrings", "Adductors"]
  },
  glutes: {
    name: "Glutes", description: "Hip extension and abduction for glute max, medius, and minimus.",
    subs: ["Glute max", "Glute med / min"]
  },
  calves: {
    name: "Lower leg", description: "Straight- and bent-knee plantar flexion plus active dorsiflexion.",
    subs: ["Gastrocnemius", "Soleus", "Tibialis anterior"]
  },
  core: {
    name: "Core", description: "Spinal flexion plus anti-extension and anti-rotation trunk control.",
    subs: ["Rectus abdominis", "Obliques", "Deep core"]
  }
};

let exercises = [];

const metricWeights = {
  stimulus:.3, stability:.2, progression:.2, range:.2, fatigue:.1
};

function normalizeExercise(exercise) {
  if (!exercise || typeof exercise !== "object" || !groups[exercise.group]) {
    throw new Error("The exercise catalog contains an unsupported entry.");
  }

  const metrics = {};
  for (const key of Object.keys(metricWeights)) {
    const value = Number(exercise.metrics?.[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`The exercise catalog contains an invalid ${key} score.`);
    }
    metrics[key] = value;
  }

  const score = Number(exercise.score);
  if (!exercise.id || !exercise.name || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("The exercise catalog contains incomplete scoring data.");
  }

  const weightedBaseline = Math.round(
    Object.entries(metricWeights).reduce((total,[key,weight]) => total + metrics[key] * weight,0)
  );

  return {
    ...exercise,
    score,
    metrics,
    youtube:exercise.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} exercise form tutorial`)}`,
    weightedBaseline,
    editorialAdjustment:score - weightedBaseline
  };
}

function normalizeCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error("The exercise catalog is empty or unavailable.");
  }
  const normalized = catalog.map(normalizeExercise);
  const ids = new Set(normalized.map((exercise) => exercise.id));
  if (ids.size !== normalized.length) throw new Error("The exercise catalog contains duplicate IDs.");
  return normalized;
}

const groupOrder = Object.keys(groups);
const state = {
  group:"chest", sub:"all", query:"", equipment:"all", level:"all", sort:"score",
  compare:[], user:null, catalogStatus:"loading"
};

const el = (id) => document.getElementById(id);
const groupTabs = el("groupTabs");
const musclePanel = el("musclePanel");
const submuscleFilters = el("submuscleFilters");
const exerciseList = el("exerciseList");
const detailDialog = el("detailDialog");
const compareDialog = el("compareDialog");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

async function api(path, options = {}) {
  const headers = { Accept:"application/json", ...(options.body ? {"Content-Type":"application/json"} : {}), ...(options.headers || {}) };
  const response = await fetch(path, {...options, headers, credentials:"same-origin"});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function renderTabs() {
  groupTabs.innerHTML = groupOrder.map((key) => {
    const selected = state.group === key;
    return `<button class="group-tab" id="group-tab-${key}" type="button" role="tab" aria-selected="${selected}" aria-controls="rankingsPanel" tabindex="${selected ? "0" : "-1"}" data-group="${key}">${groups[key].name}</button>`;
  }).join("");
  el("rankingsPanel").setAttribute("aria-labelledby", `group-tab-${state.group}`);
}

function renderPanel() {
  const group = groups[state.group];
  const count = state.catalogStatus === "ready" ? exercises.filter((exercise) => exercise.group === state.group).length : "—";
  const index = String(groupOrder.indexOf(state.group) + 1).padStart(2,"0");
  musclePanel.innerHTML = `<div class="panel-index"><span>REGION ${index}</span><span>TARGET LAYERS</span></div><div class="panel-number">${index}</div><h3>${group.name}</h3><p>${group.description}</p><div class="target-matrix">${group.subs.map((sub,i) => `<span><i>${String(i+1).padStart(2,"0")}</i>${sub}</span>`).join("")}</div><div class="panel-stat"><span>Targets <b>${group.subs.length}</b></span><span>Movements <b>${count}</b></span></div>`;
}

function renderSubfilters() {
  const chips = ["all", ...groups[state.group].subs];
  submuscleFilters.innerHTML = chips.map((sub) => {
    const active = state.sub === sub;
    return `<button type="button" class="filter-chip ${active ? "active" : ""}" aria-pressed="${active}" data-sub="${sub}">${sub === "all" ? "All targets" : sub}</button>`;
  }).join("");
}

function updateEquipmentOptions() {
  const select = el("equipmentFilter");
  const values = [...new Set(exercises.filter((exercise) => exercise.group === state.group).map((exercise) => exercise.equipment))].sort();
  if (state.equipment !== "all" && !values.includes(state.equipment)) state.equipment = "all";
  select.innerHTML = `<option value="all">All equipment</option>${values.map((value) => `<option value="${value}">${value}</option>`).join("")}`;
  select.value = state.equipment;
}

function filteredExercises() {
  const query = state.query.trim().toLowerCase();
  const metric = state.sort === "score" ? "score" : state.sort;
  return exercises.filter((exercise) => exercise.group === state.group)
    .filter((exercise) => state.sub === "all" || exercise.sub === state.sub)
    .filter((exercise) => state.equipment === "all" || exercise.equipment === state.equipment)
    .filter((exercise) => state.level === "all" || exercise.level === state.level)
    .filter((exercise) => !query || `${exercise.name} ${exercise.sub} ${exercise.equipment} ${exercise.pattern}`.toLowerCase().includes(query))
    .sort((a,b) => state.sort === "score" ? b.score-a.score : b.metrics[metric]-a.metrics[metric]);
}

function setEmptyStateCopy(title,message,buttonLabel,buttonHidden) {
  const heading = el("emptyState").querySelector("h3");
  const description = el("emptyState").querySelector("p");
  const button = el("clearFilters");
  if (heading) heading.textContent = title;
  if (description) description.textContent = message;
  button.textContent = buttonLabel;
  button.hidden = buttonHidden;
}

function renderExercises() {
  if (state.catalogStatus !== "ready") {
    const failed = state.catalogStatus === "error";
    el("resultCount").textContent = "0";
    el("resultNoun").textContent = "exercises";
    el("activeTarget").textContent = failed ? "Library unavailable" : "Loading library";
    exerciseList.innerHTML = "";
    el("emptyState").hidden = false;
    setEmptyStateCopy(
      failed ? "Exercise library unavailable." : "Loading exercise library…",
      failed ? "Check your connection, then try loading the library again." : "Preparing the latest rankings and exercise details.",
      failed ? "Try again" : "Reset filters",
      !failed
    );
    return;
  }

  setEmptyStateCopy("No movement found.","Clear a filter or search another exercise.","Reset filters",false);
  const rows = filteredExercises();
  el("resultCount").textContent = rows.length;
  el("resultNoun").textContent = rows.length === 1 ? "exercise" : "exercises";
  el("activeTarget").textContent = state.sub === "all" ? "All targets" : state.sub;
  el("emptyState").hidden = rows.length !== 0;
  exerciseList.innerHTML = rows.map((exercise,index) => {
    const compared = state.compare.includes(exercise.id);
    return `<article class="exercise-row" role="listitem">
    <div class="rank-number">${String(index+1).padStart(2,"0")}</div>
    <div class="exercise-title"><button type="button" data-detail="${exercise.id}"><h3>${exercise.name}</h3><p>${exercise.pattern} · ${exercise.level}</p><span class="details-cue">View details ↘</span></button></div>
    <div><span class="target-pill">${exercise.sub}</span></div>
    <div class="exercise-cell"><small>Equipment</small><strong>${exercise.equipment}</strong></div>
    <div class="score-badge ${exercise.score >= 94 ? "top" : ""}" aria-label="FitScore ${exercise.score} out of 100"><strong>${exercise.score}</strong><span aria-hidden="true">/100</span></div>
    <div class="row-actions">
      <a class="action-icon youtube-action" href="${exercise.youtube}" target="_blank" rel="noreferrer" aria-label="Find ${exercise.name} tutorials on YouTube">▶</a>
      <button class="action-icon ${compared ? "active" : ""}" data-compare="${exercise.id}" type="button" aria-pressed="${compared}" aria-label="${compared ? "Remove" : "Add"} ${exercise.name} ${compared ? "from" : "to"} comparison">⇄</button>
      <button class="action-icon" data-add-planner="${exercise.id}" type="button" aria-label="${state.user ? "Add to weekly planner" : "Sign in to add to weekly planner"}">+</button>
    </div>
  </article>`;
  }).join("");
}

function updateAccountUI() {
  const button = el("accountButton");
  const signup = el("signupButton");
  const discoveryButton = el("discoverButton");
  const discoveryActive = state.user?.discovery?.active === true;
  button.textContent = state.user ? `${state.user.name.split(/\s+/)[0]} profile` : "Log in";
  button.href = state.user ? "/account.html" : "/account.html?mode=login";
  button.classList.toggle("signed-in", Boolean(state.user));
  signup.hidden = Boolean(state.user);
  discoveryButton.hidden = !state.user;
  discoveryButton.href = discoveryActive ? "/discover.html" : "/pricing";
  discoveryButton.textContent = discoveryActive ? "Strata+" : "Unlock Strata+";
  el("planCount").textContent = state.user ? (state.user.planCount || 0) : "0";
  el("planButton").href = state.user ? "/planner.html" : "/account.html?mode=login&next=planner";
}

function renderAll() {
  renderTabs(); renderPanel(); renderSubfilters(); updateEquipmentOptions(); renderExercises(); updateCompareDock(); updateAccountUI();
}

function focusRenderedControl(container, attribute, value) {
  requestAnimationFrame(() => {
    const control = [...container.querySelectorAll(`[${attribute}]`)].find((item) => item.getAttribute(attribute) === value);
    control?.focus();
  });
}

function selectGroup(group, restoreFocus = true) {
  if (!groups[group]) return;
  state.group = group;
  state.sub = "all";
  state.equipment = "all";
  state.query = "";
  el("searchInput").value = "";
  renderAll();
  if (restoreFocus) focusRenderedControl(groupTabs, "data-group", group);
}

function selectSubfilter(sub, restoreFocus = true) {
  state.sub = sub;
  renderSubfilters();
  renderExercises();
  if (restoreFocus) focusRenderedControl(submuscleFilters, "data-sub", sub);
}

function metricMarkup(exercise) {
  const labels = {stimulus:"Stimulus",stability:"Stability",progression:"Progression",range:"Useful range",fatigue:"Low fatigue"};
  return Object.entries(exercise.metrics).map(([key,value]) => `<div class="metric"><div class="metric-head"><span>${labels[key]}</span><b>${value}</b></div><div class="metric-track"><i style="width:${value}%"></i></div></div>`).join("");
}

function adjustmentLabel(value) {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function syncDialogState() {
  document.body.classList.toggle("dialog-open", detailDialog.open || compareDialog.open);
}

function openModal(dialog) {
  if (!dialog.open) dialog.showModal();
  syncDialogState();
}

function openDetail(id) {
  const exercise = exercises.find((item) => item.id === id);
  if (!exercise) return;
  const compared = state.compare.includes(id);
  el("detailContent").innerHTML = `<div class="detail-hero">
    <button class="icon-button detail-close" data-close-dialog="detailDialog" type="button" aria-label="Close details">×</button>
    <div class="detail-hero-copy"><p class="kicker">${groups[exercise.group].name} / ${exercise.sub}</p><h2 id="detailTitle">${exercise.name}</h2><p>${exercise.why}</p></div>
    <div class="detail-score" aria-label="FitScore ${exercise.score} out of 100"><span>FIT SCORE</span><strong>${exercise.score}</strong><span>OUT OF 100</span></div>
  </div><div class="detail-body">
    <div class="detail-meta"><div><span>Sets</span><strong>${exercise.sets}</strong></div><div><span>Reps</span><strong>${exercise.reps}</strong></div><div><span>Rest</span><strong>${exercise.rest}</strong></div><div><span>Level</span><strong>${exercise.level}</strong></div></div>
    <div class="metric-grid">${metricMarkup(exercise)}</div>
    <p class="detail-score-build"><strong>Score build</strong><span>Weighted baseline ${exercise.weightedBaseline}</span><span>Editorial adjustment ${adjustmentLabel(exercise.editorialAdjustment)}</span></p>
    <div class="detail-columns"><div><h3>Execution notes</h3><ul>${exercise.cues.map((cue) => `<li>${cue}</li>`).join("")}</ul></div><div><h3>Why it ranks here</h3><p class="detail-rationale">${exercise.why}</p><p class="detail-note"><strong>Watch for:</strong> ${exercise.caution}</p></div></div>
    <div class="detail-footer"><button class="button button-dark" data-add-planner="${exercise.id}" type="button">${state.user ? "Add to weekly planner" : "Sign in to plan"}<span>+</span></button><a class="button detail-youtube" href="${exercise.youtube}" target="_blank" rel="noreferrer">YouTube tutorials <span>▶</span></a><button class="button" style="border-color:var(--ink)" data-compare="${exercise.id}" type="button" aria-pressed="${compared}">${compared ? "Remove comparison" : "Compare exercise"}<span>⇄</span></button></div>
  </div>`;
  openModal(detailDialog);
}

function plannerUrl(exerciseId = null) {
  return exerciseId ? `/planner.html?add=${encodeURIComponent(exerciseId)}` : "/planner.html";
}

function addToPlanner(id) {
  if (state.user) { window.location.assign(plannerUrl(id)); return; }
  window.location.assign(`/account.html?mode=login&next=planner&add=${encodeURIComponent(id)}`);
}

async function initializeAccount() {
  try { const result = await api("/api/me"); state.user = result.user; } catch { state.user = null; }
  updateAccountUI(); renderExercises();
  if (new URLSearchParams(location.search).get("signin") === "1") {
    history.replaceState({},"","/");
    if (state.user) window.location.assign("/planner.html");
    else window.location.assign("/account.html?mode=login");
  }
}

async function initializeCatalog() {
  state.catalogStatus = "loading";
  renderAll();
  try {
    exercises = normalizeCatalog(await api("/exercises.json?v=6.9.0"));
    state.catalogStatus = "ready";
    el("catalogTotal").textContent = exercises.length;
  } catch {
    exercises = [];
    state.compare = [];
    state.catalogStatus = "error";
  }
  renderAll();
}

function toggleCompare(id) {
  const detailWasOpen = detailDialog.open;
  const index = state.compare.indexOf(id);
  if (index >= 0) state.compare.splice(index,1);
  else if (state.compare.length < 2) state.compare.push(id);
  else { showToast("Comparison tray is full"); return; }
  updateCompareDock(); renderExercises();
  if (detailWasOpen) {
    detailDialog.close();
    requestAnimationFrame(() => {
      openDetail(id);
      focusRenderedControl(detailDialog, "data-compare", id);
    });
  } else {
    focusRenderedControl(exerciseList, "data-compare", id);
  }
}

function updateCompareDock() {
  el("compareDock").hidden = state.compare.length === 0;
  el("compareCount").textContent = `${state.compare.length}/2`;
  el("openCompare").disabled = state.compare.length !== 2;
  el("compareNames").textContent = state.compare.length ? state.compare.map((id) => exercises.find((exercise) => exercise.id === id)?.name).join(" vs ") : "Choose two exercises";
}

function openComparison() {
  const [a,b] = state.compare.map((id) => exercises.find((exercise) => exercise.id === id));
  if (!a || !b) return;
  const row = (label,left,right,className="") => `<tr><th scope="row">${label}</th><td class="${className}">${left}</td><td class="${className}">${right}</td></tr>`;
  el("compareContent").innerHTML = `<div class="compare-table-wrap"><table class="compare-table">
    <caption class="sr-only">Comparison of ${escapeHtml(a.name)} and ${escapeHtml(b.name)}</caption>
    <thead><tr><th scope="col">Measure</th><th scope="col" class="compare-name">${escapeHtml(a.name)}</th><th scope="col" class="compare-name">${escapeHtml(b.name)}</th></tr></thead>
    <tbody>
      ${row("FitScore",a.score,b.score,"compare-score")}
      ${row("Weighted baseline",a.weightedBaseline,b.weightedBaseline)}
      ${row("Editorial adjustment",adjustmentLabel(a.editorialAdjustment),adjustmentLabel(b.editorialAdjustment))}
      ${row("Target",escapeHtml(a.sub),escapeHtml(b.sub))}
      ${row("Equipment",escapeHtml(a.equipment),escapeHtml(b.equipment))}
      ${row("Level",escapeHtml(a.level),escapeHtml(b.level))}
      ${row("Stimulus",`${a.metrics.stimulus}/100`,`${b.metrics.stimulus}/100`)}
      ${row("Stability",`${a.metrics.stability}/100`,`${b.metrics.stability}/100`)}
      ${row("Useful range",`${a.metrics.range}/100`,`${b.metrics.range}/100`)}
      ${row("Progression",`${a.metrics.progression}/100`,`${b.metrics.progression}/100`)}
      ${row("Low fatigue",`${a.metrics.fatigue}/100`,`${b.metrics.fatigue}/100`)}
    </tbody>
  </table></div>`;
  openModal(compareDialog);
}

let toastTimer;
function showToast(message) {
  const toast = el("toast"); toast.textContent = message; toast.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"),1800);
}

document.addEventListener("click", (event) => {
  const groupButton=event.target.closest("[data-group]"), subButton=event.target.closest("[data-sub]"), detailButton=event.target.closest("[data-detail]"), addButton=event.target.closest("[data-add-planner]"), compareButton=event.target.closest("[data-compare]"), closeButton=event.target.closest("[data-close-dialog]");
  if (groupButton) selectGroup(groupButton.dataset.group);
  else if (subButton) selectSubfilter(subButton.dataset.sub);
  else if (detailButton) openDetail(detailButton.dataset.detail);
  else if (addButton) addToPlanner(addButton.dataset.addPlanner);
  else if (compareButton) toggleCompare(compareButton.dataset.compare);
  else if (closeButton) document.getElementById(closeButton.dataset.closeDialog)?.close();
});

groupTabs.addEventListener("keydown", (event) => {
  if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
  const currentButton = event.target.closest("[data-group]");
  if (!currentButton) return;
  event.preventDefault();
  const current = groupOrder.indexOf(currentButton.dataset.group);
  let next = current;
  if (event.key === "ArrowRight") next = (current + 1) % groupOrder.length;
  if (event.key === "ArrowLeft") next = (current - 1 + groupOrder.length) % groupOrder.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = groupOrder.length - 1;
  selectGroup(groupOrder[next]);
});

el("searchInput").addEventListener("input", (event) => { state.query=event.target.value; renderExercises(); });
el("equipmentFilter").addEventListener("change", (event) => { state.equipment=event.target.value; renderExercises(); });
el("levelFilter").addEventListener("change", (event) => { state.level=event.target.value; renderExercises(); });
el("sortSelect").addEventListener("change", (event) => { state.sort=event.target.value; renderExercises(); });
el("clearFilters").addEventListener("click", () => {
  if (state.catalogStatus === "error") { initializeCatalog(); return; }
  state.sub="all";state.equipment="all";state.level="all";state.query="";el("searchInput").value="";el("levelFilter").value="all";renderAll();requestAnimationFrame(()=>el("searchInput").focus());
});
el("clearCompare").addEventListener("click", () => { state.compare=[];updateCompareDock();renderExercises();requestAnimationFrame(()=>el("searchInput").focus()); });
el("openCompare").addEventListener("click", openComparison);
[detailDialog,compareDialog].forEach((dialog) => {
  dialog.addEventListener("close", syncDialogState);
  dialog.addEventListener("click", (event) => {
    const rect=dialog.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();
  });
});

initializeCatalog();
initializeAccount();
