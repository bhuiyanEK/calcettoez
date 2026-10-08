/**
 * players.js – CRUD giocatori con nickname, sconosciuto, livello
 */
import { PlayersAPI, MetaAPI } from "./api.js";
import { esc, roleChip, FORMA } from "./ui.js";

// ── State ──────────────────────────────────────
let players     = [];
let editingId   = null;
let roleWeights = null;
let roleFilter  = "all";
const expanded  = new Set();   // id dei giocatori con gli attributi dettagliati visibili

// ── DOM ────────────────────────────────────────
const playerList   = document.getElementById("player-list");
const formSection  = document.getElementById("form-section");   // <dialog>
const formTitle    = document.getElementById("form-title");
const playerForm   = document.getElementById("player-form");
const btnAdd       = document.getElementById("btn-add-player");
const btnCancel    = document.getElementById("btn-cancel");
const btnDelete    = document.getElementById("btn-delete");
const toast        = document.getElementById("toast");
const searchInput  = document.getElementById("player-search");
const roleFilterEl = document.getElementById("role-filter");
const sortSelect   = document.getElementById("sort-by");
const playersCount = document.getElementById("players-count");

// form fields
const fName       = document.getElementById("f-name");
const fNickname   = document.getElementById("f-nickname");
const fRuolo      = document.getElementById("f-ruolo");
const fSpirit     = document.getElementById("f-spirit");
const fSpiritV    = document.getElementById("f-spirit-val");
const fUnknown    = document.getElementById("f-unknown");
const statsBlock  = document.getElementById("stats-block");
const unknownBlock= document.getElementById("unknown-block");
const fLivello    = document.getElementById("f-livello");

const statInputs = {
  velocita:   document.getElementById("f-velocita"),
  tiro:       document.getElementById("f-tiro"),
  passaggio:  document.getElementById("f-passaggio"),
  difesa:     document.getElementById("f-difesa"),
  fisico:     document.getElementById("f-fisico"),
  dribbling:  document.getElementById("f-dribbling"),
  porta:      document.getElementById("f-porta"),
};

const ovrPreviews = {
  portiere:       document.getElementById("ovr-portiere"),
  difensore:      document.getElementById("ovr-difensore"),
  centrocampista: document.getElementById("ovr-centrocampista"),
  attaccante:     document.getElementById("ovr-attaccante"),
};

// CSV
const csvFile      = document.getElementById("csv-file");
const btnImport    = document.getElementById("btn-import");
const importStatus = document.getElementById("import-status");
const btnTemplate  = document.getElementById("btn-template");

// ── Helpers ────────────────────────────────────
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3200);
}

const LIVELLO_LABEL = { scarso:"Scarso", discreto:"Discreto", buono:"Buono", ottimo:"Ottimo", fenomeno:"Fenomeno" };

function calcLiveOVR(role) {
  if (!roleWeights?.[role]) return "–";
  const w   = roleWeights[role];
  const raw = Object.keys(w).reduce((s, k) => s + w[k] * (Number(statInputs[k]?.value) || 0), 0);
  return (Math.round(raw * 10) / 10).toFixed(1);
}

function updateOVRPreviews() {
  for (const role of Object.keys(ovrPreviews)) {
    const val = calcLiveOVR(role);
    ovrPreviews[role].textContent = val;
    const num = Number(val);
    ovrPreviews[role].className = "ovr-pill__value " + (
      isNaN(num)  ? "" :
      num >= 8    ? "ovr-pill__value--high" :
      num >= 6    ? "ovr-pill__value--mid"  : "ovr-pill__value--low"
    );
  }
}

function toggleUnknownMode(unknown) {
  statsBlock.classList.toggle("hidden",  unknown);
  unknownBlock.classList.toggle("hidden", !unknown);
  document.getElementById("ovr-preview-row").classList.toggle("hidden", unknown);
  if (!unknown) updateOVRPreviews();
}

function resetForm() {
  playerForm.reset();
  fSpiritV.textContent = "5";
  fUnknown.checked = false;
  editingId = null;
  formTitle.textContent = "Aggiungi giocatore";
  btnDelete.classList.add("hidden");
  toggleUnknownMode(false);
  updateOVRPreviews();
}

function openForm() {
  if (!formSection.open) formSection.showModal();
  fName.focus();
}

function closeForm() {
  if (formSection.open) formSection.close();
  resetForm();
}

function populateForm(p) {
  fName.value      = p.name;
  fNickname.value  = p.nickname;
  fRuolo.value     = p.ruoloPreferito;
  fSpirit.value    = p.spiritoSacrificio;
  fSpiritV.textContent = p.spiritoSacrificio;
  fUnknown.checked = !!p.isUnknown;

  if (p.isUnknown) {
    fLivello.value = p.livello || "discreto";
  } else {
    for (const [k, el] of Object.entries(statInputs)) el.value = p.stats[k];
    updateOVRPreviews();
  }
  toggleUnknownMode(!!p.isUnknown);
}

// ── Render ─────────────────────────────────────
const avgOvr = p => { const v = Object.values(p.ovr); return v.reduce((s, x) => s + x, 0) / v.length; };

function visiblePlayers() {
  const q = searchInput.value.trim().toLowerCase();
  const list = players.filter(p =>
    (roleFilter === "all" || p.ruoloPreferito === roleFilter) &&
    (!q || p.nickname.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.ruoloPreferito.startsWith(q))
  );
  const sorters = {
    nickname: (a, b) => a.nickname.localeCompare(b.nickname, "it", { sensitivity: "base" }),
    ovr:      (a, b) => avgOvr(b) - avgOvr(a),
    partite:  (a, b) => b.storico.partite - a.storico.partite,
  };
  return list.sort(sorters[sortSelect.value] || sorters.nickname);
}

function renderPlayers() {
  const list = visiblePlayers();
  playersCount.textContent = players.length ? `${list.length} / ${players.length}` : "";

  if (!players.length) {
    playerList.innerHTML = `<p class="empty-state">Nessun giocatore in rosa. Aggiungine uno o importa un CSV.</p>`;
    return;
  }
  if (!list.length) {
    playerList.innerHTML = `<p class="empty-state">Nessun giocatore corrisponde alla ricerca.</p>`;
    return;
  }

  playerList.innerHTML = list.map(p => {
    const f    = FORMA[p.formaAttuale] || FORMA.normale;
    const open = expanded.has(p.id);
    const unknownBadge = p.isUnknown
      ? `<span class="badge badge--unknown">Sconosciuto · ${LIVELLO_LABEL[p.livello] || esc(p.livello)}</span>` : "";

    return `
    <div class="card player-card ${p.isUnknown ? 'player-card--unknown' : ''}">
      <div class="player-card__header">
        ${roleChip(p.ruoloPreferito, "role-chip--lg")}
        <div style="flex:1;min-width:0">
          <h3 class="player-card__name">${esc(p.nickname)}<span class="player-card__fullname">${esc(p.name)}</span></h3>
          ${unknownBadge ? `<div style="margin-top:.3rem">${unknownBadge}</div>` : ""}
        </div>
        <span class="forma-badge ${f.cls}">${f.label}</span>
      </div>

      <div class="ovr-grid">
        ${renderOVRPill("POR", p.ovr.portiere,       p.formaAttuale)}
        ${renderOVRPill("DIF", p.ovr.difensore,      p.formaAttuale)}
        ${renderOVRPill("CEN", p.ovr.centrocampista,  p.formaAttuale)}
        ${renderOVRPill("ATT", p.ovr.attaccante,      p.formaAttuale)}
      </div>

      <div class="player-card__storico">
        ${miniStat(p.storico.partite, "Partite")}
        ${miniStat(p.storico.goal, "Gol")}
        ${miniStat(p.storico.assist, "Assist")}
        ${miniStat(p.storico.mediaVoto, "Voto medio")}
        ${miniStat(p.spiritoSacrificio, "Sacrificio")}
      </div>

      <div class="player-card__details ${open ? "" : "hidden"}">
        ${!p.isUnknown ? `
        <div class="player-card__stats">
          ${["velocita","tiro","passaggio","difesa","fisico","dribbling","porta"].map(k =>
            renderStatBar(k==="porta"?"POR":k.slice(0,3).toUpperCase(), p.stats[k])).join("")}
        </div>` : `<p class="unknown-hint">Statistiche stimate dal livello: si aggiornano dopo le partite.</p>`}
      </div>

      <div class="player-card__actions">
        <button class="btn btn--secondary btn--sm" data-action="edit" data-id="${p.id}">Modifica</button>
        <button class="btn btn--secondary btn--sm" data-action="toggle-details" data-id="${p.id}" aria-expanded="${open}">
          ${open ? "Nascondi attributi" : "Mostra dettagli attributi"}
        </button>
      </div>
    </div>`;
  }).join("");
}

const FORMA_DELTA = { infortunato:-2.5, scarsa_forma:-1.0, normale:0, in_forma:1.0, grande_forma:2.0 };

function miniStat(value, label) {
  return `<div class="mini-stat"><span class="mini-stat__v">${value}</span><span class="mini-stat__l">${label}</span></div>`;
}

function renderOVRPill(label, base, forma) {
  const delta   = FORMA_DELTA[forma] ?? 0;
  const display = Math.min(10, Math.max(0, Math.round((base + delta) * 10) / 10));
  const cls     = display >= 8 ? "ovr-pill__value--high" : display >= 6 ? "ovr-pill__value--mid" : "ovr-pill__value--low";
  const suffix  = delta !== 0 ? `<span class="ovr-pill__delta" style="color:${delta > 0 ? 'var(--success)':'var(--danger)'}">${delta > 0 ? '+':''}${delta}</span>` : "";
  return `<div class="ovr-pill">
    <span class="ovr-pill__label">${label}</span>
    <span class="ovr-pill__value ${cls}">${display}</span>${suffix}
  </div>`;
}

function renderStatBar(label, value) {
  return `<div class="stat-row">
    <span class="stat-label">${label}</span>
    <div class="stat-bar"><div class="stat-bar__fill" style="width:${value * 10}%"></div></div>
    <span class="stat-value">${value}</span>
  </div>`;
}

// ── Handlers ───────────────────────────────────
async function loadPlayers() {
  try {
    players = await PlayersAPI.getAll();
    renderPlayers();
  } catch (err) { showToast(err.message, "error"); }
}

async function handleEdit(id) {
  try {
    const p = await PlayersAPI.getById(id);
    resetForm();
    editingId = id;
    formTitle.textContent = `Modifica – ${p.nickname}`;
    populateForm(p);
    btnDelete.classList.remove("hidden");
    openForm();
  } catch (err) { showToast(err.message, "error"); }
}

// L'eliminazione vive solo nella schermata di modifica
async function handleDelete() {
  if (!editingId) return;
  const p    = players.find(x => x.id === editingId);
  const nick = p ? p.nickname : "questo giocatore";
  if (!confirm(`Eliminare "${nick}"? L'operazione non si può annullare.`)) return;
  try {
    await PlayersAPI.remove(editingId);
    expanded.delete(editingId);
    closeForm();
    showToast(`"${nick}" eliminato.`);
    await loadPlayers();
  } catch (err) { showToast(err.message, "error"); }
}

playerList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === "edit") { handleEdit(id); return; }

  if (btn.dataset.action === "toggle-details") {
    // Aggiorna solo la card interessata: niente re-render, la lista non salta
    const nowOpen = !expanded.has(id);
    if (nowOpen) expanded.add(id); else expanded.delete(id);
    btn.closest(".player-card").querySelector(".player-card__details").classList.toggle("hidden", !nowOpen);
    btn.setAttribute("aria-expanded", nowOpen);
    btn.textContent = nowOpen ? "Nascondi attributi" : "Mostra dettagli attributi";
  }
});

playerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const unknown = fUnknown.checked;
  const payload = {
    name: fName.value.trim(),
    nickname: fNickname.value.trim(),
    ruoloPreferito: fRuolo.value,
    spiritoSacrificio: Number(fSpirit.value),
    isUnknown: unknown,
    livello: unknown ? fLivello.value : null,
    stats: unknown ? undefined : Object.fromEntries(
      Object.entries(statInputs).map(([k, el]) => [k, Number(el.value)])
    ),
  };
  try {
    if (editingId) { await PlayersAPI.update(editingId, payload); showToast("Giocatore aggiornato."); }
    else           { await PlayersAPI.create(payload);            showToast("Giocatore aggiunto."); }
    closeForm();
    await loadPlayers();
  } catch (err) { showToast(err.message, "error"); }
});

// CSV import
btnImport.addEventListener("click", async () => {
  const file = csvFile.files[0];
  if (!file) { showToast("Seleziona un file CSV.", "error"); return; }
  const text = await file.text();
  importStatus.textContent = "Importazione in corso…";
  try {
    const result = await PlayersAPI.importCSV(text);
    let html = "";
    if (result.imported.length)
      html += `<p class="import-ok">Importati: ${result.imported.map(p => esc(p.nickname)).join(", ")}</p>`;
    if (result.errors.length)
      html += result.errors.map(e =>
        `<p class="import-err">Riga ${e.line}: ${e.messages.join(" · ")}</p>`
      ).join("");
    importStatus.innerHTML = html || "Nessun giocatore importato.";
    if (result.imported.length) await loadPlayers();
  } catch (err) { importStatus.innerHTML = `<p class="import-err">${esc(err.message)}</p>`; }
});

btnTemplate.addEventListener("click", () => window.open(PlayersAPI.templateURL(), "_blank"));

// form / modale
btnAdd.addEventListener("click",    () => { resetForm(); openForm(); });
btnCancel.addEventListener("click", closeForm);
btnDelete.addEventListener("click", handleDelete);
formSection.addEventListener("close", resetForm);                                                   // chiusura con Esc
formSection.addEventListener("click", (e) => { if (e.target === formSection) closeForm(); });       // click sul backdrop
fSpirit.addEventListener("input",   () => fSpiritV.textContent = fSpirit.value);
fUnknown.addEventListener("change", () => toggleUnknownMode(fUnknown.checked));
Object.values(statInputs).forEach(el => el.addEventListener("input", updateOVRPreviews));

// ricerca / filtri / ordinamento
searchInput.addEventListener("input", renderPlayers);
sortSelect.addEventListener("change", renderPlayers);
roleFilterEl.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-role]");
  if (!b) return;
  roleFilter = b.dataset.role;
  roleFilterEl.querySelectorAll("button").forEach(x => x.classList.toggle("seg__btn--active", x === b));
  renderPlayers();
});

// ── Init ───────────────────────────────────────
async function init() {
  try { roleWeights = await MetaAPI.getRoleWeights(); } catch {}
  updateOVRPreviews();
  await loadPlayers();
}
init();
