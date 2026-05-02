/**
 * chemistry-page.js – Dedicated chemistry management page
 */

const CHEM_LEVELS = [
  { value:0, label:"0 · Nessuna",   cls:"chem-badge--0" },
  { value:1, label:"1 · Di vista",  cls:"chem-badge--1" },
  { value:2, label:"2 · Avversari", cls:"chem-badge--2" },
  { value:3, label:"3 · Compagni",  cls:"chem-badge--3" },
  { value:4, label:"4 · Perfetti",  cls:"chem-badge--4" },
];

const ROLE_ICON = { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" };

// ── State ──────────────────────────────────────
let allPlayers   = [];
let chemistry    = {};
let selectedId   = null;
let activeFilter = "all";

// ── DOM ───────────────────────────────────────
const playerSearch  = document.getElementById("player-search");
const playerPills   = document.getElementById("player-pills");
const chemPanel     = document.getElementById("chem-panel");
const noPlayerHint  = document.getElementById("no-player-hint");
const panelIcon     = document.getElementById("panel-icon");
const panelName     = document.getElementById("panel-name");
const panelMeta     = document.getElementById("panel-meta");
const panelStatus   = document.getElementById("panel-status");
const relSearch     = document.getElementById("rel-search");
const relGrid       = document.getElementById("rel-grid");
const toast         = document.getElementById("toast");

// ── Helpers ────────────────────────────────────
function showToast(msg, type="success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

function chemKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

function getLevel(idA, idB) { return chemistry[chemKey(idA, idB)] ?? 0; }

/** Count relations ≥1 for a given player */
function countRelations(playerId) {
  return allPlayers
    .filter(p => p.id !== playerId && getLevel(playerId, p.id) >= 1)
    .length;
}

/** Status object for the 3-relation requirement */
function getPlayerStatus(playerId) {
  const rels = allPlayers
    .filter(p => p.id !== playerId)
    .map(p => ({ player: p, level: getLevel(playerId, p.id) }))
    .filter(r => r.level >= 1);

  const total     = rels.length;
  const compagni  = rels.filter(r => r.level >= 3).length;
  const avversari = rels.filter(r => r.level === 2).length;

  // Rule: ≥3 relations total, at least 2 teammates (level≥3) + 1 opponent/acquaintance
  const ok = total >= 3 && compagni >= 2 && (avversari + compagni) >= 3;
  return { ok, total, compagni, avversari };
}

// ── Render player pills ────────────────────────
function renderPills() {
  const query = playerSearch.value.trim().toLowerCase();
  const filtered = allPlayers.filter(p =>
    !query || p.nickname.toLowerCase().includes(query) || p.name.toLowerCase().includes(query)
  );

  playerPills.innerHTML = filtered.map(p => {
    const { ok } = getPlayerStatus(p.id);
    return `
    <button
      class="player-pill ${p.id === selectedId ? "player-pill--active" : ""} ${!ok ? "player-pill--warn" : ""}"
      data-id="${p.id}"
      title="${p.name}${!ok ? " · Relazioni insufficienti" : ""}"
    >
      ${ROLE_ICON[p.ruoloPreferito] || "❓"} ${p.nickname}
      ${!ok ? `<span class="pill-warn">!</span>` : ""}
    </button>`;
  }).join("");

  playerPills.querySelectorAll(".player-pill").forEach(btn =>
    btn.addEventListener("click", () => selectPlayer(btn.dataset.id))
  );
}

// ── Select player ──────────────────────────────
function selectPlayer(id) {
  selectedId = id;
  const p = allPlayers.find(p => p.id === id);
  if (!p) return;

  panelIcon.textContent = ROLE_ICON[p.ruoloPreferito] || "❓";
  panelName.textContent = `${p.nickname}`;
  panelMeta.textContent = `${p.name} · ${p.ruoloPreferito} · 🏟️ ${p.storico.partite} partite`;

  chemPanel.classList.remove("hidden");
  noPlayerHint.classList.add("hidden");

  renderPills();
  renderStatus(p);
  renderRelGrid();
}

function renderStatus(p) {
  const { ok, total, compagni, avversari } = getPlayerStatus(p.id);
  panelStatus.innerHTML = ok
    ? `<span class="status-ok">✅ Requisiti soddisfatti (${total} relazioni)</span>`
    : `<span class="status-warn">⚠️ Serve: 3 relazioni (2 compagni + 1 avversario) · Hai: ${compagni} compagni, ${avversari} avversari</span>`;
}

// ── Render relation grid ───────────────────────
function renderRelGrid() {
  const query   = relSearch.value.trim().toLowerCase();
  const others  = allPlayers.filter(p => p.id !== selectedId);

  const filtered = others.filter(p => {
    const nameMatch = !query ||
      p.nickname.toLowerCase().includes(query) ||
      p.name.toLowerCase().includes(query);
    const level = getLevel(selectedId, p.id);
    if (activeFilter === "set")   return nameMatch && level >= 1;
    if (activeFilter === "unset") return nameMatch && level === 0;
    return nameMatch;
  });

  if (!filtered.length) {
    relGrid.innerHTML = `<p class="empty-state">Nessun giocatore trovato.</p>`;
    return;
  }

  // Sort: with relation first, then alpha
  filtered.sort((a, b) => {
    const la = getLevel(selectedId, a.id), lb = getLevel(selectedId, b.id);
    if (lb !== la) return lb - la;
    return a.nickname.localeCompare(b.nickname);
  });

  relGrid.innerHTML = filtered.map(p => {
    const level = getLevel(selectedId, p.id);
    const lbl   = CHEM_LEVELS.find(c => c.value === level);
    return `
    <div class="rel-card rel-card--${level}" data-id="${p.id}">
      <div class="rel-card__player">
        <span class="rel-card__icon">${ROLE_ICON[p.ruoloPreferito] || "❓"}</span>
        <div>
          <div class="rel-card__nick">${p.nickname}</div>
          <div class="rel-card__name">${p.name} · ${p.ruoloPreferito}</div>
        </div>
        <span class="chem-badge ${lbl.cls}" style="margin-left:auto">${lbl.label}</span>
      </div>
      <div class="rel-card__buttons">
        ${CHEM_LEVELS.map(c => `
          <button
            class="rel-level-btn ${level === c.value ? "rel-level-btn--active" : ""}"
            data-level="${c.value}" data-target="${p.id}"
            title="${c.label}"
          >${c.value}</button>
        `).join("")}
      </div>
    </div>`;
  }).join("");

  // Events
  relGrid.querySelectorAll(".rel-level-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const targetId = btn.dataset.target;
      const level    = Number(btn.dataset.level);
      await saveChemistry(selectedId, targetId, level);
    });
  });
}

// ── Save chemistry ─────────────────────────────
async function saveChemistry(idA, idB, level) {
  try {
    const res  = await fetch(`/chemistry/${idA}/${idB}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Update local state (symmetric)
    const key = chemKey(idA, idB);
    if (level === 0) delete chemistry[key]; else chemistry[key] = level;

    const p = allPlayers.find(p => p.id === selectedId);
    renderStatus(p);
    renderRelGrid();
    renderPills();
    showToast(`Intesa aggiornata a livello ${level}`);
  } catch (err) { showToast(err.message, "error"); }
}

// ── Filter buttons ─────────────────────────────
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderRelGrid();
  });
});

relSearch.addEventListener("input",    renderRelGrid);
playerSearch.addEventListener("input", renderPills);

// ── Init ───────────────────────────────────────
async function init() {
  try {
    const [players, { chemistry: chem }] = await Promise.all([
      fetch("/players").then(r => r.json()),
      fetch("/chemistry/matrix").then(r => r.json()),
    ]);
    allPlayers = players;
    chemistry  = chem;
    renderPills();
  } catch (err) { showToast(err.message, "error"); }
}

init();
