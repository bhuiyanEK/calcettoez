/**
 * matchmaker.js – Versione Aggiornata
 * - Schemi tattici multipli (1-2-1, 2-1-1, etc.)
 * - Formazioni SVG ingrandite con selezione ruolo interattiva
 * - Gestione decimali (trim) per energia e OVR
 * - Drag & Drop e Smart Suggestions
 */
import { PlayersAPI } from "./api.js";

// ── DOM ──────────────────────────────────────
const searchInput        = document.getElementById("player-search");
const playerCheckboxList = document.getElementById("player-checkbox-list");
const btnGenerate        = document.getElementById("btn-generate");
const btnClearSel        = document.getElementById("btn-clear-sel");
const btnAutoSelect      = document.getElementById("btn-autoselect");
const selCount           = document.getElementById("sel-count");
const teamsSection       = document.getElementById("teams-section");
const toast              = document.getElementById("toast");
const swapActionBar      = document.getElementById("swap-action-bar");
const swapSelectedInfo   = document.getElementById("swap-selected-info");
const btnCancelSwap      = document.getElementById("btn-cancel-swap");
const suggestionsPanel   = document.getElementById("suggestions-panel");
const suggestionsList    = document.getElementById("suggestions-list");
const captainConfirmOverlay = document.getElementById("captain-confirm-overlay");
const captainConfirmText    = document.getElementById("captain-confirm-text");
const captainConfirmCancel  = document.getElementById("captain-confirm-cancel");
const captainConfirmOk      = document.getElementById("captain-confirm-ok");

// ── State ─────────────────────────────────────
let allPlayers   = [];
let checkedIds   = new Set();
let captainA     = null;
let captainB     = null;

let teamA        = []; 
let teamB        = [];
let chemistryA   = [];
let chemistryB   = [];
let origTeamA    = [];
let origTeamB    = [];
let lastResult   = null;

let schemaA      = "1-2-1";
let schemaB      = "1-2-1";

let selectedForSwap   = null; 
let lockedPlayerIds   = new Set();
let dragSource        = null; 
let pendingSwapFn     = null;

// ── Constants & Formations ────────────────────
const FORMA_OPTIONS = [
  { value:"infortunato",  label:"🩹 Infort.",    delta:-2.5 },
  { value:"scarsa_forma", label:"😕 Scarsa",     delta:-1.0 },
  { value:"normale",      label:"😐 Normale",    delta:0    },
  { value:"in_forma",     label:"💪 In forma",   delta:+1.0 },
  { value:"grande_forma", label:"🔥 Grande",     delta:+2.0 },
];
const FORMA_CLS = {
  infortunato:"forma--red", scarsa_forma:"forma--orange",
  normale:"forma--grey",    in_forma:"forma--green", grande_forma:"forma--gold",
};
const ROLE_ICON = { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" };
const CHEMISTRY_BONUS = { 0:0, 1:0.3, 2:0.8, 3:2.0, 4:3.5 };
const TEAM_COLORS = { A:"#3d7eff", B:"#e74c3c" };

const FORMATIONS = {
  5: { 
    "1-2-1": { portiere:[[50,88]], difensore:[[50,68]], centrocampista:[[25,40],[75,40]], attaccante:[[50,18]] },
    "2-1-1": { portiere:[[50,88]], difensore:[[30,70],[70,70]], centrocampista:[[50,45]], attaccante:[[50,18]] },
    "1-1-2": { portiere:[[50,88]], difensore:[[50,70]], centrocampista:[[50,45]], attaccante:[[30,18],[70,18]] }
  },
  6: { 
    "2-2-1": { portiere:[[50,88]], difensore:[[30,72],[70,72]], centrocampista:[[30,42],[70,42]], attaccante:[[50,18]] },
    "3-1-1": { portiere:[[50,88]], difensore:[[20,70],[50,72],[80,70]], centrocampista:[[50,45]], attaccante:[[50,18]] },
    "2-1-2": { portiere:[[50,88]], difensore:[[30,72],[70,72]], centrocampista:[[50,45]], attaccante:[[30,18],[70,18]] }
  },
  7: { 
    "2-3-1": { portiere:[[50,88]], difensore:[[30,72],[70,72]], centrocampista:[[20,44],[50,44],[80,44]], attaccante:[[50,18]] },
    "3-2-1": { portiere:[[50,88]], difensore:[[20,70],[50,72],[80,70]], centrocampista:[[30,42],[70,42]], attaccante:[[50,18]] }
  },
  8: {
    "3-3-1": { portiere:[[50,88]], difensore:[[20,70],[50,72],[80,70]], centrocampista:[[20,42],[50,44],[80,42]], attaccante:[[50,18]] },
    "3-2-2": { portiere:[[50,88]], difensore:[[20,70],[50,72],[80,70]], centrocampista:[[30,42],[70,42]], attaccante:[[30,18],[70,18]] }
  }
};

// ── Helpers ───────────────────────────────────
function showToast(msg, type="success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

function updateCounter() {
  const n = checkedIds.size;
  selCount.textContent = `${n} selezionati`;
  const valid = n >= 10 && n % 2 === 0;
  selCount.className = n===0?"":n>20?"counter--over":valid?"counter--ready":"counter--warn";
  btnGenerate.disabled = !valid;
  btnGenerate.textContent = valid ? `⚡ Genera (${n/2}v${n/2})` : "⚡ Genera Squadre";
}

function effectiveOVR(p) {
  const base = Object.values(p.ovr).reduce((s,v)=>s+v,0)/4;
  const f = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
  return Math.min(10, Math.max(0, base + f.delta));
}

function computeStrength(team, chemPairs) {
  const base  = team.reduce((s,p) => s + effectiveOVR(p), 0);
  const bonus = (chemPairs||[]).reduce((s,c) => s + (CHEMISTRY_BONUS[c.level]||0), 0);
  return Math.round((base + bonus) * 10) / 10;
}

function filterChemPairs(pairs, team) {
  const ids = new Set(team.map(p=>p.id));
  return (pairs||[]).filter(c => {
    const pA = team.find(p=>p.nickname===c.a);
    const pB = team.find(p=>p.nickname===c.b);
    return pA && pB;
  });
}

// ── Balance UI ────────────────────────────────
let prevStrA = null, prevStrB = null;

function updateBalanceUI(strA, strB, showDelta=false) {
  const total = strA + strB || 1;
  const pctA  = (strA / total * 100).toFixed(1);
  const pctB  = (strB / total * 100).toFixed(1);

  document.getElementById("balance-fill-a").style.width = pctA + "%";
  document.getElementById("balance-fill-b").style.width = pctB + "%";
  document.getElementById("str-a-bal").textContent = strA.toFixed(1);
  document.getElementById("str-b-bal").textContent = strB.toFixed(1);
  document.getElementById("str-a").textContent     = strA.toFixed(1);
  document.getElementById("str-b").textContent     = strB.toFixed(1);
  document.getElementById("str-a-val").textContent = strA.toFixed(1);
  document.getElementById("str-b-val").textContent = strB.toFixed(1);

  const diff = Math.abs(strA - strB);
  document.getElementById("balance-diff-text").textContent = `Δ forza: ${diff.toFixed(1)}`;

  const diffEl = document.getElementById("ovr-diff");
  diffEl.textContent = `Δ forza: ${diff.toFixed(1)}`;
  diffEl.className = `ovr-diff ${diff <= 5 ? "ovr-diff--ok" : "ovr-diff--warn"}`;
}

// ── Captain UI ────────────────────────────────
function renderCaptainSlot(team, captainId) {
  const slotEl = document.getElementById(`captain-slot-${team}`);
  const player = captainId ? allPlayers.find(p=>p.id===captainId) : null;
  if (player) {
    slotEl.classList.add("filled");
    slotEl.innerHTML = `
      <span class="captain-slot__badge">${team==="a"?"🔵":"🔴"}</span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">${player.nickname}</div>
        <div class="captain-slot__role">${player.ruoloPreferito}</div>
      </div>
      <button class="captain-slot__clear" data-team="${team}" title="Rimuovi">✕</button>`;
    slotEl.querySelector(".captain-slot__clear").addEventListener("click", () => {
      if (team==="a") captainA=null; else captainB=null;
      renderCaptainSlot(team, null);
      renderList();
    });
  } else {
    slotEl.classList.remove("filled");
    slotEl.innerHTML = `<span class="captain-slot__badge">${team==="a"?"🔵":"🔴"}</span>
      <div class="captain-slot__info"><div class="captain-slot__name">Nessun Cap ${team.toUpperCase()}</div></div>`;
  }
}

// ── Formation SVG Logic ───────────────────────
function buildFormationSlots(players, teamKey) {
  const byRole = { portiere:[], difensore:[], centrocampista:[], attaccante:[] };
  players.forEach(p => {
    const r = p.assignedRole || p.ruoloPreferito;
    if (byRole[r]) byRole[r].push(p);
  });
  
  const n = players.length;
  const availableSchemas = FORMATIONS[n] || FORMATIONS[5];
  let activeSchema = teamKey === "A" ? schemaA : schemaB;
  
  if (!availableSchemas[activeSchema]) activeSchema = Object.keys(availableSchemas)[0];

  const pos = availableSchemas[activeSchema];
  const slots = [];
  Object.entries(pos).forEach(([role, positions]) => {
    const rolePlayers = byRole[role] || [];
    positions.forEach(([x,y], i) => slots.push({ x, y, player: rolePlayers[i]||null, role }));
  });
  return slots;
}

function renderFormationSVG(players, teamKey, chemPairs, captainId) {
  const W = 350, H = 480;
  const col = TEAM_COLORS[teamKey];
  const slots = buildFormationSlots(players, teamKey);

  const nodes = slots.map(s => {
    const cx = s.x * W / 100, cy = s.y * H / 100;
    if(!s.player) return `<circle cx="${cx}" cy="${cy}" r="20" fill="rgba(255,255,255,.05)" stroke="${col}" stroke-dasharray="4,3"/>`;
    
    const p = s.player;
    const nick = p.nickname.length > 9 ? p.nickname.slice(0,8)+"…" : p.nickname;
    const isCap = p.id === captainId;
    const fuoriRuolo = p.assignedRole !== p.ruoloPreferito;
    
    const roleSelect = `
      <foreignObject x="${cx-35}" y="${cy+16}" width="70" height="24">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex; justify-content:center; width:100%;">
          <select class="node-role-select" data-pid="${p.id}" data-team="${teamKey}" 
                  style="font-size:9px; height:18px; background:rgba(0,0,0,0.8); color:white; border:1px solid ${fuoriRuolo ? 'var(--warning)' : '#ffffff40'}; border-radius:3px;">
            <option value="portiere" ${p.assignedRole==='portiere'?'selected':''}>POR</option>
            <option value="difensore" ${p.assignedRole==='difensore'?'selected':''}>DIF</option>
            <option value="centrocampista" ${p.assignedRole==='centrocampista'?'selected':''}>CEN</option>
            <option value="attaccante" ${p.assignedRole==='attaccante'?'selected':''}>ATT</option>
          </select>
        </div>
      </foreignObject>
    `;

    return `<g class="formation-node">
      <circle cx="${cx}" cy="${cy}" r="${isCap?24:22}" fill="${col}" fill-opacity="${isCap?0.95:0.85}"
        stroke="${fuoriRuolo ? 'var(--warning)' : (isCap?'#ffd700':'white')}" stroke-width="${fuoriRuolo?2.5:1.5}"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="white">${nick}</text>
      ${isCap ? `<text x="${cx+16}" y="${cy-16}" font-size="12">🏅</text>` : ""}
      ${roleSelect}
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="formation-svg">
    <rect width="${W}" height="${H}" rx="8" fill="#1a4a1a"/>
    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="rgba(255,255,255,.2)"/>
    <circle cx="${W/2}" cy="${H/2}" r="40" fill="none" stroke="rgba(255,255,255,.2)"/>
    ${nodes}
  </svg>`;
}

// ── Rendering Panels ──────────────────────────
function renderTeamPanel(containerId, players, teamKey, chemPairs) {
  const container = document.getElementById(containerId);
  const captainId = teamKey==="A" ? captainA : captainB;
  
  const n = players.length;
  const availableSchemas = FORMATIONS[n] || FORMATIONS[5];
  const activeSchema = teamKey === "A" ? schemaA : schemaB;
  const schemaOptions = Object.keys(availableSchemas).map(k => `<option value="${k}" ${k===activeSchema?'selected':''}>${k}</option>`).join("");

  const listHtml = players.map(p => {
    const isCap = p.id === captainId;
    const isLocked = lockedPlayerIds.has(p.id) || isCap;
    const isSelected = selectedForSwap?.player.id === p.id;
    return `<div class="team-player-card ${isLocked?"locked":""} ${isSelected?"selected":""}" data-player-id="${p.id}" data-team="${teamKey}" draggable="${!isLocked}">
      <span class="tpc-assigned-role">${ROLE_ICON[p.assignedRole]}</span>
      <div class="tpc-info"><span class="tpc-name">${p.nickname}</span></div>
      <div class="tpc-ovrs"><span class="tpc-ovr-assigned">${p.assignedRoleOVR}</span></div>
      <button class="lock-btn ${isLocked?"locked":""}" data-player-id="${p.id}">${isLocked?"🔒":"🔓"}</button>
    </div>`;
  }).join("");

  container.innerHTML = `
    <div style="margin-bottom:1rem; display:flex; justify-content:center;">
      <select class="schema-select input input--sm" data-team="${teamKey}">${schemaOptions}</select>
    </div>
    <div class="formation-wrap">${renderFormationSVG(players, teamKey, chemPairs, captainId)}</div>
    <div class="team-list-side">${listHtml}</div>`;

  // Listeners
  container.querySelector(".schema-select").addEventListener("change", (e) => {
    if (teamKey === "A") schemaA = e.target.value; else schemaB = e.target.value;
    renderBothPanels();
  });

  container.querySelectorAll(".node-role-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const pid = e.target.dataset.pid;
      const p = (teamKey === "A" ? teamA : teamB).find(x => x.id === pid);
      if (p) { p.assignedRole = e.target.value; renderBothPanels(); }
    });
  });

  container.querySelectorAll(".team-player-card").forEach(card => {
    card.addEventListener("click", e => {
      if(e.target.classList.contains("lock-btn")) return;
      const p = (teamKey==="A"?teamA:teamB).find(x=>x.id===card.dataset.playerId);
      handleCardClick(p, teamKey);
    });
  });
}

function renderBothPanels() {
  renderTeamPanel("team-a-panel", teamA, "A", chemistryA);
  renderTeamPanel("team-b-panel", teamB, "B", chemistryB);
  updateBalanceUI(computeStrength(teamA, chemistryA), computeStrength(teamB, chemistryB));
  computeSuggestions();
}

// ── Swap Logic ────────────────────────────────
function handleCardClick(player, team) {
  if(!selectedForSwap) {
    if(lockedPlayerIds.has(player.id)) { showToast("Bloccato 🔒", "error"); return; }
    selectedForSwap = { player, team };
    swapActionBar.classList.remove("hidden");
    swapSelectedInfo.textContent = `✓ ${player.nickname} (${team})`;
    renderBothPanels();
  } else {
    if(selectedForSwap.player.id === player.id) { cancelSwap(); return; }
    if(selectedForSwap.team === team) { selectedForSwap = { player, team }; renderBothPanels(); return; }
    executeSwap(selectedForSwap.player, selectedForSwap.team, player, team);
  }
}

function executeSwap(p1, t1, p2, t2) {
  const idx1 = (t1==="A"?teamA:teamB).findIndex(x=>x.id===p1.id);
  const idx2 = (t2==="A"?teamA:teamB).findIndex(x=>x.id===p2.id);
  if (t1 === "A") [teamA[idx1], teamB[idx2]] = [teamB[idx2], teamA[idx1]];
  else [teamB[idx1], teamA[idx2]] = [teamA[idx2], teamB[idx1]];
  cancelSwap();
  renderBothPanels();
  showToast("Scambio effettuato!");
}

function cancelSwap() { selectedForSwap = null; swapActionBar.classList.add("hidden"); renderBothPanels(); }

// ── Core Actions ──────────────────────────────
async function generate() {
  if(checkedIds.size < 10) return;
  btnGenerate.disabled = true;
  try {
    const body = { playerIds:[...checkedIds], captainA, captainB };
    const result = await fetch("/match", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}).then(r=>r.json());
    
    teamA = [...result.teamA]; teamB = [...result.teamB];
    origTeamA = [...result.teamA]; origTeamB = [...result.teamB];
    chemistryA = result.chemistryA||[]; chemistryB = result.chemistryB||[];
    
    document.getElementById("sa-energy").textContent = `E = ${parseFloat(result.saEnergy).toFixed(2)}`;
    teamsSection.classList.remove("hidden");
    renderBothPanels();
    showToast("Squadre generate!");
  } catch(err) { showToast(err.message, "error"); }
  finally { btnGenerate.disabled = false; updateCounter(); }
}

// ── Init ──────────────────────────────────────
btnGenerate.addEventListener("click", generate);
btnClearSel.addEventListener("click", () => { checkedIds.clear(); updateCounter(); renderList(); });
searchInput.addEventListener("input", renderList);

async function load() {
  allPlayers = await fetch("/players").then(r=>r.json());
  renderList();
}

function renderList() {
  const q = searchInput.value.toLowerCase();
  const filtered = allPlayers.filter(p => p.nickname.toLowerCase().includes(q));
  playerCheckboxList.innerHTML = filtered.map(p => `
    <div class="player-checkbox-item ${checkedIds.has(p.id)?"is-selected":""}">
      <input type="checkbox" id="cb-${p.id}" ${checkedIds.has(p.id)?"checked":""} onchange="toggleP('${p.id}')">
      <label for="cb-${p.id}" class="cb-label"><span>${ROLE_ICON[p.ruoloPreferito]}</span> <strong>${p.nickname}</strong></label>
    </div>`).join("");
}

window.toggleP = (id) => { if(checkedIds.has(id)) checkedIds.delete(id); else checkedIds.add(id); updateCounter(); renderList(); };

load();
