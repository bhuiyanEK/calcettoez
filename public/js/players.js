/**
 * players.js – CRUD giocatori con nickname, sconosciuto, livello
 */
import { PlayersAPI, MetaAPI } from "./api.js";

// ── State ──────────────────────────────────────
let players     = [];
let editingId   = null;
let roleWeights = null;

// ── DOM ────────────────────────────────────────
const playerList   = document.getElementById("player-list");
const formSection  = document.getElementById("form-section");
const formTitle    = document.getElementById("form-title");
const playerForm   = document.getElementById("player-form");
const btnAdd       = document.getElementById("btn-add-player");
const btnCancel    = document.getElementById("btn-cancel");
const toast        = document.getElementById("toast");

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

const FORMA_LABEL = {
  infortunato:  { label:"🩹 Infortunato",   cls:"forma--red"    },
  scarsa_forma: { label:"😕 Scarsa forma",  cls:"forma--orange" },
  normale:      { label:"😐 Normale",        cls:"forma--grey"   },
  in_forma:     { label:"💪 In forma",       cls:"forma--green"  },
  grande_forma: { label:"🔥 Grande forma",  cls:"forma--gold"   },
};

const LIVELLO_LABEL = { scarso:"Scarso", discreto:"Discreto", buono:"Buono", ottimo:"Ottimo", fenomeno:"Fenomeno" };

function roleIcon(r) {
  return { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" }[r] || "❓";
}

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
  formTitle.textContent = "Aggiungi Giocatore";
  formSection.classList.add("hidden");
  toggleUnknownMode(false);
  updateOVRPreviews();
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
function renderPlayers(list) {
  if (!list.length) {
    playerList.innerHTML = `<p class="empty-state">Nessun giocatore. Aggiungine uno o importa un CSV!</p>`;
    return;
  }
  playerList.innerHTML = list.map(p => {
    const f    = FORMA_LABEL[p.formaAttuale] || FORMA_LABEL.normale;
    const unknownBadge = p.isUnknown
      ? `<span class="badge badge--unknown">👤 Sconosciuto · ${LIVELLO_LABEL[p.livello] || p.livello}</span>` : "";

    return `
    <div class="card player-card ${p.isUnknown ? 'player-card--unknown' : ''}">
      <div class="player-card__header">
        <span class="player-card__icon">${roleIcon(p.ruoloPreferito)}</span>
        <div style="flex:1;min-width:0">
          <h3 class="player-card__name">${p.nickname} <span class="player-card__fullname">${p.name}</span></h3>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.25rem">
            <span class="badge badge--role">${p.ruoloPreferito}</span>
            ${unknownBadge}
          </div>
        </div>
        <span class="forma-badge ${f.cls}">${f.label}</span>
      </div>

      <div class="ovr-grid">
        ${renderOVRPill("🧤","POR", p.ovr.portiere,       p.formaAttuale)}
        ${renderOVRPill("🛡️","DIF", p.ovr.difensore,      p.formaAttuale)}
        ${renderOVRPill("🔵","CEN", p.ovr.centrocampista,  p.formaAttuale)}
        ${renderOVRPill("⚽","ATT", p.ovr.attaccante,      p.formaAttuale)}
      </div>

      ${!p.isUnknown ? `
      <div class="player-card__stats">
        ${["velocita","tiro","passaggio","difesa","fisico","dribbling","porta"].map(k =>
          renderStatBar(k==="porta"?"POR":k.slice(0,3).toUpperCase(), p.stats[k])).join("")}
      </div>` : `<p class="unknown-hint">📝 Stats stimate dal livello — si aggiornano dopo le partite</p>`}

      <div class="player-card__storico">
        <span>🏟️ ${p.storico.partite}</span>
        <span>⚽ ${p.storico.goal}</span>
        <span>🎯 ${p.storico.assist}</span>
        <span>⭐ ${p.storico.mediaVoto}</span>
        <span>💪 ${p.spiritoSacrificio}</span>
      </div>

      <div class="player-card__actions">
        <button class="btn btn--secondary btn--sm" onclick="handleEdit('${p.id}')">✏️ Modifica</button>
        <button class="btn btn--danger btn--sm" onclick="handleDelete('${p.id}','${p.nickname.replace(/'/g,"\\'")}')">🗑️</button>
      </div>
    </div>`;
  }).join("");
}

const FORMA_DELTA = { infortunato:-2.5, scarsa_forma:-1.0, normale:0, in_forma:1.0, grande_forma:2.0 };

function renderOVRPill(icon, label, base, forma) {
  const delta   = FORMA_DELTA[forma] ?? 0;
  const display = Math.min(10, Math.max(0, Math.round((base + delta) * 10) / 10));
  const cls     = display >= 8 ? "ovr-pill__value--high" : display >= 6 ? "ovr-pill__value--mid" : "ovr-pill__value--low";
  const suffix  = delta !== 0 ? `<span class="ovr-pill__delta" style="color:${delta > 0 ? 'var(--success)':'var(--danger)'}">${delta > 0 ? '+':''}${delta}</span>` : "";
  return `<div class="ovr-pill">
    <span class="ovr-pill__icon">${icon}</span>
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
    renderPlayers(players);
  } catch (err) { showToast(err.message, "error"); }
}

window.handleEdit = async (id) => {
  try {
    const p = await PlayersAPI.getById(id);
    editingId = id;
    formTitle.textContent = `Modifica – ${p.nickname}`;
    populateForm(p);
    formSection.classList.remove("hidden");
    formSection.scrollIntoView({ behavior: "smooth" });
  } catch (err) { showToast(err.message, "error"); }
};

window.handleDelete = async (id, nick) => {
  if (!confirm(`Eliminare "${nick}"?`)) return;
  try {
    await PlayersAPI.remove(id);
    showToast(`"${nick}" eliminato.`);
    await loadPlayers();
  } catch (err) { showToast(err.message, "error"); }
};

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
    if (editingId) { await PlayersAPI.update(editingId, payload); showToast("Aggiornato!"); }
    else           { await PlayersAPI.create(payload);            showToast("Giocatore aggiunto!"); }
    resetForm();
    await loadPlayers();
  } catch (err) { showToast(err.message, "error"); }
});

// CSV import
btnImport.addEventListener("click", async () => {
  const file = csvFile.files[0];
  if (!file) { showToast("Seleziona un file CSV.", "error"); return; }
  const text = await file.text();
  importStatus.innerHTML = "⏳ Importazione in corso...";
  try {
    const result = await PlayersAPI.importCSV(text);
    let html = "";
    if (result.imported.length)
      html += `<p class="import-ok">✅ Importati: ${result.imported.map(p => p.nickname).join(", ")}</p>`;
    if (result.errors.length)
      html += result.errors.map(e =>
        `<p class="import-err">❌ Riga ${e.line}: ${e.messages.join(" · ")}</p>`
      ).join("");
    importStatus.innerHTML = html || "Nessun giocatore importato.";
    if (result.imported.length) await loadPlayers();
  } catch (err) { importStatus.innerHTML = `<p class="import-err">❌ ${err.message}</p>`; }
});

btnTemplate.addEventListener("click", () => window.open(PlayersAPI.templateURL(), "_blank"));

// form events
btnAdd.addEventListener("click",    () => { resetForm(); formSection.classList.remove("hidden"); formSection.scrollIntoView({ behavior:"smooth" }); });
btnCancel.addEventListener("click", resetForm);
fSpirit.addEventListener("input",   () => fSpiritV.textContent = fSpirit.value);
fUnknown.addEventListener("change", () => toggleUnknownMode(fUnknown.checked));
Object.values(statInputs).forEach(el => el.addEventListener("input", updateOVRPreviews));

// ── Init ───────────────────────────────────────
async function init() {
  try { roleWeights = await MetaAPI.getRoleWeights(); } catch {}
  updateOVRPreviews();
  await loadPlayers();
}
init();
