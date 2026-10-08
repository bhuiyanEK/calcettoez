/**
 * matchmaker.js – Enhanced with:
 *  - Captain selection (fixed to opposite teams)
 *  - Manual player swap (drag & drop + click-to-select)
 *  - Real-time balance meter
 *  - Smart swap suggestions
 *  - Player lock / Reset / Rigenera
 *  - Multiple formations per team size (dropdown)
 *  - Bigger stacked formation display
 *  - Out-of-role player management with role selector
 *  - Number trimming (max 1 decimal)
 *  - Griglia a card per la selezione giocatori
 *  - Giocatori liberamente trascinabili sul campo (anche tra squadre = scambio)
 *  - Esportazione formazione come immagine PNG (download / condivisione)
 */
import { PlayersAPI } from "./api.js";
import { esc, roleChip, ICON, ROLES } from "./ui.js";

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

// Swap / lock state
let selectedForSwap = null;
let lockedPlayerIds = new Set();
let dragSource      = null;

// Formation & role-override state per team
let formationA   = null;   // e.g. "1-2-1-1"
let formationB   = null;
let roleMappingA = {};     // { playerId: roleOverride }
let roleMappingB = {};

let pendingSwapFn = null;

// Posizioni libere sul campo: { A: { playerId: [x%, y%] }, B: {...} } + cache delle posizioni effettive
let customPos   = { A: {}, B: {} };
const layoutCache = { A: {}, B: {} };

// ── Constants ─────────────────────────────────
const FORMA_OPTIONS = [
  { value:"infortunato",  label:"Infortunato",  delta:-2.5 },
  { value:"scarsa_forma", label:"Scarsa forma", delta:-1.0 },
  { value:"normale",      label:"Normale",      delta:0    },
  { value:"in_forma",     label:"In forma",     delta:+1.0 },
  { value:"grande_forma", label:"Grande forma", delta:+2.0 },
];
const FORMA_CLS = {
  infortunato:"forma--red", scarsa_forma:"forma--orange",
  normale:"forma--grey",    in_forma:"forma--green", grande_forma:"forma--gold",
};
const ROLE_LABELS = { portiere:"Portiere", difensore:"Difensore", centrocampista:"Centrocampista", attaccante:"Attaccante" };
const ROLE_ORDER  = ["portiere","difensore","centrocampista","attaccante"];
const CHEMISTRY_BONUS = { 0:0, 1:0.3, 2:0.8, 3:2.0, 4:3.5 };
// L'intesa di coppia è la media dei due livelli asimmetrici → può essere frazionaria: bonus interpolato
const bonusOf = lv => {
  const lo = Math.floor(lv), hi = Math.ceil(lv);
  if (lo === hi) return CHEMISTRY_BONUS[lo] ?? 0;
  return CHEMISTRY_BONUS[lo] + (CHEMISTRY_BONUS[hi] - CHEMISTRY_BONUS[lo]) * (lv - lo);
};
const TEAM_COLORS = { A:"#6f95e8", B:"#e0705f" };
const FORMA_DOT = { infortunato:"#e0675a", scarsa_forma:"#e0a93b", in_forma:"#58c79a", grande_forma:"#e8c35a" };
const PITCH_W = 420, PITCH_H = 560;

// ── Number formatting ─────────────────────────
/** Round to 1 decimal, strip trailing ".0" */
const fmt = n => {
  if (n === null || n === undefined || isNaN(Number(n))) return "–";
  const r = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

// ── Formations catalogue ──────────────────────
const FORMATIONS_BY_SIZE = {
  5: {
    "1-2-1-1": { portiere:1, difensore:2, centrocampista:1, attaccante:1 },
    "1-1-2-1": { portiere:1, difensore:1, centrocampista:2, attaccante:1 },
    "1-1-1-2": { portiere:1, difensore:1, centrocampista:1, attaccante:2 },
    "1-3-0-1": { portiere:1, difensore:3, centrocampista:0, attaccante:1 },
  },
  6: {
    "1-2-2-1": { portiere:1, difensore:2, centrocampista:2, attaccante:1 },
    "1-1-2-2": { portiere:1, difensore:1, centrocampista:2, attaccante:2 },
    "1-2-1-2": { portiere:1, difensore:2, centrocampista:1, attaccante:2 },
    "1-3-1-1": { portiere:1, difensore:3, centrocampista:1, attaccante:1 },
    "1-1-3-1": { portiere:1, difensore:1, centrocampista:3, attaccante:1 },
  },
  7: {
    "1-2-3-1": { portiere:1, difensore:2, centrocampista:3, attaccante:1 },
    "1-3-2-1": { portiere:1, difensore:3, centrocampista:2, attaccante:1 },
    "1-2-2-2": { portiere:1, difensore:2, centrocampista:2, attaccante:2 },
    "1-1-3-2": { portiere:1, difensore:1, centrocampista:3, attaccante:2 },
    "1-3-1-2": { portiere:1, difensore:3, centrocampista:1, attaccante:2 },
  },
  8: {
    "1-3-3-1": { portiere:1, difensore:3, centrocampista:3, attaccante:1 },
    "1-2-3-2": { portiere:1, difensore:2, centrocampista:3, attaccante:2 },
    "1-3-2-2": { portiere:1, difensore:3, centrocampista:2, attaccante:2 },
    "1-2-4-1": { portiere:1, difensore:2, centrocampista:4, attaccante:1 },
    "1-4-2-1": { portiere:1, difensore:4, centrocampista:2, attaccante:1 },
  },
};

function getFormationsFor(n) {
  return FORMATIONS_BY_SIZE[n] || FORMATIONS_BY_SIZE[5];
}
function defaultFormation(n) {
  return Object.keys(getFormationsFor(n))[0];
}

// ── Build formation SVG positions ────────────
function buildFormationPositions(schema) {
  const active = ROLE_ORDER.filter(r => (schema[r] || 0) > 0);
  const nRows  = active.length;
  const result = {};
  active.forEach((role, idx) => {
    const count = schema[role];
    const yPct  = nRows === 1 ? 50 : 88 - idx * (74 / (nRows - 1));
    result[role] = Array.from({ length: count }, (_, i) => {
      const xPct = count === 1 ? 50 : ((i + 1) / (count + 1)) * 100;
      return [xPct, yPct];
    });
  });
  return result;
}

// ── Build slot assignment ────────────────────
function buildFormationSlots(players, formationName, n, roleMapping = {}) {
  const schemas = getFormationsFor(n);
  const schema  = schemas[formationName] || Object.values(schemas)[0];
  const pos     = buildFormationPositions(schema);

  // Flat slot list
  const slots = [];
  for (const role of ROLE_ORDER) {
    for (const [x, y] of (pos[role] || [])) {
      slots.push({ role, x, y, player: null, outOfRole: false });
    }
  }

  const assigned = new Set();
  const effRole  = p => roleMapping[p.id] || p.assignedRole || p.ruoloPreferito;

  // Pass 1: match by effective role
  for (const slot of slots) {
    const idx = players.findIndex(p => !assigned.has(p.id) && effRole(p) === slot.role);
    if (idx !== -1) {
      slot.player    = players[idx];
      slot.outOfRole = players[idx].ruoloPreferito !== slot.role;
      assigned.add(players[idx].id);
    }
  }

  // Pass 2: fill remaining empty slots with leftover players
  for (const slot of slots) {
    if (slot.player) continue;
    const idx = players.findIndex(p => !assigned.has(p.id));
    if (idx !== -1) {
      slot.player    = players[idx];
      slot.outOfRole = true;
      assigned.add(players[idx].id);
    }
  }

  return slots;
}

// ── Helpers ───────────────────────────────────
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className   = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

function updateCounter() {
  const n = checkedIds.size;
  selCount.textContent = `${n} selezionati`;
  const valid = n >= 10 && n % 2 === 0;
  selCount.className   = n===0?"":n>16?"counter--over":valid?"counter--ready":"counter--warn";
  btnGenerate.disabled = !valid;
  btnGenerate.textContent = valid ? `Genera ${n/2} contro ${n/2}` : "Genera squadre";
}

function effectiveOVR(p) {
  const vals = Object.values(p.ovr);
  const base = vals.reduce((s,v) => s+v, 0) / vals.length;
  const f    = FORMA_OPTIONS.find(o => o.value === p.formaAttuale) || FORMA_OPTIONS[2];
  return Math.min(10, Math.max(0, base + f.delta));
}

function computeStrength(team, chemPairs) {
  const base  = team.reduce((s, p) => s + effectiveOVR(p), 0);
  const bonus = (chemPairs||[]).reduce((s, c) => s + bonusOf(c.level), 0);
  return Math.round((base + bonus) * 10) / 10;
}

function filterChemPairs(pairs, team) {
  return (pairs||[]).filter(c =>
    team.find(p => p.nickname === c.a) && team.find(p => p.nickname === c.b)
  );
}

// ── Balance UI ────────────────────────────────
let prevStrA = null, prevStrB = null;

function updateBalanceUI(strA, strB, showDelta = false) {
  const total = strA + strB || 1;
  const pctA  = (strA / total * 100).toFixed(1);
  const pctB  = (strB / total * 100).toFixed(1);
  const diff  = Math.abs(strA - strB);
  const diffPct = (diff / total * 100).toFixed(0);

  document.getElementById("balance-fill-a").style.width = pctA + "%";
  document.getElementById("balance-fill-b").style.width = pctB + "%";
  ["str-a-bal","str-a","str-a-val"].forEach(id => document.getElementById(id).textContent = fmt(strA));
  ["str-b-bal","str-b","str-b-val"].forEach(id => document.getElementById(id).textContent = fmt(strB));
  document.getElementById("balance-diff-text").textContent = `Δ forza: ${fmt(diff)}`;

  const diffEl = document.getElementById("ovr-diff");
  diffEl.textContent = `Δ forza: ${fmt(diff)}`;
  diffEl.className   = `ovr-diff ${diff <= 5 ? "ovr-diff--ok" : "ovr-diff--warn"}`;

  const verdict = document.getElementById("balance-verdict");
  if (diff <= 2) {
    verdict.textContent = "Squadre perfettamente equilibrate";
    verdict.className   = "balance-verdict balance-verdict--great";
  } else if (diff <= 5) {
    verdict.textContent = "Squadre equilibrate";
    verdict.className   = "balance-verdict balance-verdict--ok";
  } else if (diff <= 10) {
    verdict.textContent = `${strA > strB ? "Squadra A" : "Squadra B"} più forte del ${diffPct}%`;
    verdict.className   = "balance-verdict balance-verdict--unbal";
  } else {
    verdict.textContent = `${strA > strB ? "Squadra A" : "Squadra B"} molto più forte (${diffPct}%)`;
    verdict.className   = "balance-verdict balance-verdict--bad";
  }

  const badge = document.getElementById("swap-delta-badge");
  if (showDelta && prevStrA !== null) {
    const improvement = Math.abs(prevStrA - prevStrB) - diff;
    if (Math.abs(improvement) > 0.1) {
      badge.style.display = "";
      badge.textContent   = improvement > 0
        ? `Più equilibrate (−${fmt(improvement)})`
        : `Meno equilibrate (+${fmt(-improvement)})`;
      badge.className = `swap-delta swap-delta--${improvement > 0 ? "better" : "worse"}`;
      setTimeout(() => { badge.style.display = "none"; }, 4000);
    } else {
      badge.style.display = "none";
    }
  }
  prevStrA = strA; prevStrB = strB;
}

// ── Captain UI ────────────────────────────────
function renderCaptainSlot(team, captainId) {
  const slotEl = document.getElementById(`captain-slot-${team}`);
  const player = captainId ? allPlayers.find(p => p.id === captainId) : null;
  if (player) {
    slotEl.classList.add("filled");
    slotEl.innerHTML = `
      <span class="team-dot ${team==="b"?"team-dot--b":""}"></span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">${esc(player.nickname)}</div>
        <div class="captain-slot__role">${ROLES[player.ruoloPreferito]?.label ?? ""}</div>
      </div>
      <button class="captain-slot__clear" data-team="${team}" type="button" aria-label="Rimuovi capitano ${team.toUpperCase()}">✕</button>`;
    slotEl.querySelector(".captain-slot__clear").addEventListener("click", e => {
      e.stopPropagation();
      if (team==="a") captainA=null; else captainB=null;
      renderCaptainSlot(team, null); renderList();
    });
  } else {
    slotEl.classList.remove("filled");
    slotEl.innerHTML = `
      <span class="team-dot ${team==="b"?"team-dot--b":""}"></span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">Nessun capitano ${team.toUpperCase()}</div>
        <div class="captain-slot__role">Premi "Cap ${team.toUpperCase()}" su un giocatore</div>
      </div>`;
  }
}

function setCaptain(playerId, team) {
  if (team==="a") {
    if (captainB===playerId) { showToast("È già capitano B.", "error"); return; }
    captainA = captainA===playerId ? null : playerId;
    renderCaptainSlot("a", captainA);
  } else {
    if (captainA===playerId) { showToast("È già capitano A.", "error"); return; }
    captainB = captainB===playerId ? null : playerId;
    renderCaptainSlot("b", captainB);
  }
  renderList();
}

// ── Player selection grid ─────────────────────
function togglePlayer(id, checked) {
  if (checked) checkedIds.add(id);
  else {
    checkedIds.delete(id);
    if (captainA===id) { captainA=null; renderCaptainSlot("a",null); }
    if (captainB===id) { captainB=null; renderCaptainSlot("b",null); }
  }
  updateCounter(); renderList();
}

function renderList() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = allPlayers.filter(p =>
    !q || p.nickname.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) || p.ruoloPreferito.toLowerCase().includes(q)
  );
  if (!filtered.length) {
    playerCheckboxList.innerHTML = `<p class="empty-state" style="grid-column:1/-1">Nessun giocatore trovato.</p>`; return;
  }
  // Ordine stabile (per partite): le card non "saltano" quando le selezioni
  filtered.sort((a,b) => b.storico.partite - a.storico.partite || a.nickname.localeCompare(b.nickname));

  playerCheckboxList.innerHTML = filtered.map(p => {
    const f      = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
    const vals   = Object.values(p.ovr);
    const base   = vals.reduce((s,v)=>s+v,0)/vals.length;
    const eff    = Math.min(10, Math.max(0, Math.round((base+f.delta)*10)/10));
    const delta  = f.delta !== 0
      ? `<small class="${f.delta>0?"up":"down"}">${f.delta>0?"+":""}${f.delta}</small>` : "";
    const sel    = checkedIds.has(p.id);
    const isCapA = captainA===p.id, isCapB = captainB===p.id;
    const tip    = `${p.name} · ${ROLE_LABELS[p.ruoloPreferito]||p.ruoloPreferito} · ${p.storico.partite} partite`;
    return `
    <div class="pcard ${sel?"is-selected":""}" data-id="${p.id}" role="checkbox" aria-checked="${sel}" tabindex="0" title="${esc(tip)}">
      <div class="pcard__top">
        <div class="pcard__id">
          <span class="pcard__name">${esc(p.nickname)}</span>
          <span style="display:flex;gap:.3rem;align-items:center">${roleChip(p.ruoloPreferito)}${p.isUnknown ? `<span class="badge badge--unknown" title="Giocatore sconosciuto: statistiche stimate">Stima</span>` : ""}</span>
        </div>
        <span class="pcard__ovr">${fmt(eff)}${delta}</span>
      </div>
      ${sel ? `<div class="pcard__cap">
        ${isCapA ? `<span style="color:var(--team-a)">Capitano A</span>` : ""}
        ${isCapB ? `<span style="color:var(--team-b)">Capitano B</span>` : ""}
        ${!isCapA && !isCapB ? `
          <button type="button" class="cb-captain-btn" data-pid="${p.id}" data-team="a">Cap A</button>
          <button type="button" class="cb-captain-btn" data-pid="${p.id}" data-team="b">Cap B</button>` : ""}
      </div>` : ""}
      <div class="pcard__bottom">
        <select class="pcard__forma forma-badge ${FORMA_CLS[p.formaAttuale]||"forma--grey"}" data-player-id="${p.id}" aria-label="Forma di ${esc(p.nickname)}">
          ${FORMA_OPTIONS.map(o=>`<option value="${o.value}" ${o.value===p.formaAttuale?"selected":""}>${o.label}</option>`).join("")}
        </select>
      </div>
    </div>`;
  }).join("");
}

// Delegation: il contenitore resta lo stesso, le card vengono ricreate
playerCheckboxList.addEventListener("click", e => {
  const capBtn = e.target.closest(".cb-captain-btn");
  if (capBtn) { setCaptain(capBtn.dataset.pid, capBtn.dataset.team); return; }
  if (e.target.closest("select")) return;
  const card = e.target.closest(".pcard");
  if (card) togglePlayer(card.dataset.id, !checkedIds.has(card.dataset.id));
});

playerCheckboxList.addEventListener("keydown", e => {
  if ((e.key !== "Enter" && e.key !== " ") || e.target.closest("select,button")) return;
  const card = e.target.closest(".pcard");
  if (!card) return;
  e.preventDefault();
  const id = card.dataset.id;
  togglePlayer(id, !checkedIds.has(id));
  playerCheckboxList.querySelector(`.pcard[data-id="${id}"]`)?.focus();   // mantiene il focus da tastiera
});

playerCheckboxList.addEventListener("change", async e => {
  const sel = e.target.closest(".pcard__forma");
  if (!sel) return;
  try {
    const res = await fetch(`/players/${sel.dataset.playerId}`, {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ formaAttuale: sel.value }),
    });
    if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    const p = allPlayers.find(p=>p.id===sel.dataset.playerId);
    if (p) p.formaAttuale = sel.value;
    renderList();
  } catch(err) { showToast(err.message,"error"); renderList(); }
});

// ── Formation SVG ─────────────────────────────
/** Piccolo badge tondo sull'angolo del nodo giocatore (capitano, fuori ruolo) */
function nodeBadge(x, y, fill, text, ink) {
  return `<circle cx="${x}" cy="${y}" r="8" fill="${fill}" stroke="#0c0e0b" stroke-width="1.5"/>
      <text x="${x}" y="${y+.5}" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="800" fill="${ink}" font-family="Geist,Segoe UI,Arial,sans-serif">${text}</text>`;
}

function renderFormationSVG(players, teamKey, chemPairs, captainId, formationName, roleMapping, exportMode = false) {
  const W = PITCH_W, H = PITCH_H;
  const col   = TEAM_COLORS[teamKey];
  const n     = players.length;
  const slots = buildFormationSlots(players, formationName, n, roleMapping);

  // Posizioni libere (drag) sovrascrivono quelle del modulo; la cache serve a drag/scambio
  layoutCache[teamKey] = {};
  for (const sl of slots) {
    if (!sl.player) continue;
    const custom = customPos[teamKey][sl.player.id];
    if (custom) [sl.x, sl.y] = custom;
    layoutCache[teamKey][sl.player.id] = [sl.x, sl.y];
  }

  // Chemistry lines (livello medio ≥ 3)
  const chemLines = (chemPairs||[]).filter(c=>c.level>=3).map(c=>{
    const pA = players.find(p=>p.nickname===c.a), pB = players.find(p=>p.nickname===c.b);
    if (!pA||!pB) return "";
    const sa = slots.find(s=>s.player?.id===pA.id), sb = slots.find(s=>s.player?.id===pB.id);
    if (!sa||!sb) return "";
    return `<line x1="${sa.x*W/100}" y1="${sa.y*H/100}" x2="${sb.x*W/100}" y2="${sb.y*H/100}"
      stroke="${col}" stroke-width="${c.level>=3.5?2.5:1.5}"
      stroke-dasharray="${c.level>=3.5?"none":"5,3"}" stroke-opacity="${c.level>=3.5?.75:.4}"/>`;
  }).join("");

  // Player nodes
  const nodes = slots.map(s => {
    const cx = s.x * W / 100, cy = s.y * H / 100;
    if (!s.player) {
      return `<g>
        <circle cx="${cx}" cy="${cy}" r="24" fill="rgba(255,255,255,.04)" stroke="${col}" stroke-width="1.5" stroke-dasharray="5,3"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
          font-size="11" font-weight="700" font-family="Geist Mono,monospace" fill="rgba(255,255,255,.28)">${ROLES[s.role]?.code||"?"}</text>
      </g>`;
    }
    const p      = s.player;
    // Nell'immagine esportata il nome è sempre completo (font ridotto se lungo)
    const nick   = exportMode ? p.nickname : (p.nickname.length > 8 ? p.nickname.slice(0,7)+"…" : p.nickname);
    const nickFs = exportMode ? Math.min(11, Math.max(6.5, 46 / (p.nickname.length * 0.62))) : 11;
    const forma  = FORMA_DOT[p.formaAttuale] || "";
    const isCap  = p.id === captainId;
    const isOut  = s.outOfRole;
    const stroke = isCap ? "#e8c35a" : isOut ? "#e0a93b" : "rgba(255,255,255,.8)";
    const fillBg = isOut ? (teamKey==="A" ? "#3b5aa3" : "#8d3a30") : col;
    const r      = isCap ? 26 : 23;
    const ovrVal = p.ovr?.[s.role] !== undefined ? fmt(p.ovr[s.role]) : fmt(effectiveOVR(p));

    return `<g class="formation-node" data-pid="${p.id}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fillBg}" fill-opacity="${isCap?.95:.88}"
        stroke="${stroke}" stroke-width="${isCap||isOut?3:1.5}"/>
      ${isCap?`<circle cx="${cx}" cy="${cy}" r="${r+6}" fill="none" stroke="#ffd70050" stroke-width="1.5" stroke-dasharray="4,3"/>`: ""}
      ${isOut&&!isCap?`<circle cx="${cx}" cy="${cy}" r="${r+5}" fill="none" stroke="#f5a62350" stroke-width="1.5" stroke-dasharray="4,3"/>`: ""}
      <text x="${cx}" y="${cy-3}" text-anchor="middle" dominant-baseline="middle"
        font-size="${nickFs}" font-weight="700" fill="white" font-family="Geist,Segoe UI,Arial,sans-serif">${esc(nick)}</text>
      <text x="${cx}" y="${cy+10}" text-anchor="middle" dominant-baseline="middle"
        font-size="9.5" fill="rgba(255,255,255,.7)" font-family="Geist,Segoe UI,Arial,sans-serif">${ovrVal}</text>
      ${isCap?nodeBadge(cx+r-3, cy-r+3, "#e8c35a", "C", "#2a2208"):""}
      ${isOut&&!isCap?nodeBadge(cx+r-3, cy-r+3, "#e0a93b", "!", "#241a04"):""}
      ${forma&&!isCap&&!isOut?`<circle cx="${cx+r-4}" cy="${cy-r+4}" r="5.5" fill="${forma}" stroke="#0c0e0b" stroke-width="1.5"/>`:""}
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="formation-svg" data-team="${teamKey}">
    <defs>
      <linearGradient id="grass-${teamKey}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#2d5a3a"/>
        <stop offset="100%" stop-color="#1e4529"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" rx="10" fill="url(#grass-${teamKey})"/>
    <!-- Pitch lines -->
    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>
    <circle cx="${W/2}" cy="${H/2}" r="50" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>
    <circle cx="${W/2}" cy="${H/2}" r="3" fill="rgba(255,255,255,.3)"/>
    <rect x="${W*.15}" y="6" width="${W*.7}" height="${H*.14}" rx="4" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>
    <rect x="${W*.15}" y="${H*.86}" width="${W*.7}" height="${H*.14-6}" rx="4" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1.5"/>
    <rect x="${W*.32}" y="6" width="${W*.36}" height="${H*.07}" rx="3" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
    <rect x="${W*.32}" y="${H*.93}" width="${W*.36}" height="${H*.07-6}" rx="3" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
    ${chemLines}
    ${nodes}
  </svg>`;
}

// ── Render team panel (stacked: selector → SVG → list) ──
function renderTeamPanel(containerId, players, teamKey, chemPairs) {
  const container   = document.getElementById(containerId);
  const captainId   = teamKey==="A" ? captainA : captainB;
  const roleMapping = teamKey==="A" ? roleMappingA : roleMappingB;
  const n           = players.length;
  const formations  = getFormationsFor(n);

  let curFormation = teamKey==="A" ? formationA : formationB;
  if (!curFormation || !formations[curFormation]) {
    curFormation = Object.keys(formations)[0];
    if (teamKey==="A") formationA = curFormation;
    else formationB = curFormation;
  }

  // ── Formation selector ──
  const formSelectHtml = `<div class="formation-selector">
    <span class="formation-selector__label">Modulo</span>
    <select class="formation-select-ctrl input input--sm" data-team="${teamKey}">
      ${Object.keys(formations).map(name =>
        `<option value="${name}" ${name===curFormation?"selected":""}>${name}</option>`
      ).join("")}
    </select>
    ${Object.keys(formations).length > 1 ? `<span class="formation-selector__note">${Object.keys(formations).length} moduli per ${n} giocatori</span>` : ""}
  </div>`;

  // ── Player list ──
  const listHtml = players
    .slice()
    .sort((a,b) => {
      const ar = ROLE_ORDER.indexOf(roleMapping[a.id]||a.assignedRole);
      const br = ROLE_ORDER.indexOf(roleMapping[b.id]||b.assignedRole);
      return ar - br;
    })
    .map(p => {
      const f           = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
      const effectRole  = roleMapping[p.id] || p.assignedRole || p.ruoloPreferito;
      const isOut       = p.ruoloPreferito !== effectRole;
      const isCap       = p.id === captainId;
      const isLocked    = lockedPlayerIds.has(p.id) || isCap;
      const isSelected  = selectedForSwap?.player.id === p.id;
      const ovrForRole  = p.ovr?.[effectRole] !== undefined ? fmt(p.ovr[effectRole]) : "–";

      return `<div class="team-player-card ${isOut?"team-player-card--diff":""} ${isCap?"is-captain":""} ${isLocked?"locked":""} ${isSelected?"selected":""}"
          data-player-id="${p.id}" data-team="${teamKey}" draggable="${!isLocked}">
        ${roleChip(effectRole)}
        <div class="tpc-info">
          <span class="tpc-name">${esc(p.nickname)}${isCap?`<span class="tpc-cap">CAP</span>`:""}</span>
          <div class="tpc-role-row">
            ${isOut
              ? `<span class="tpc-out-badge">Fuori ruolo</span>`
              : ""}
            <select class="role-override-select input input--xs" data-player-id="${p.id}" data-team="${teamKey}">
              ${ROLE_ORDER.map(r =>
                `<option value="${r}" ${r===effectRole?"selected":""}>${ROLE_LABELS[r]}</option>`
              ).join("")}
            </select>
          </div>
        </div>
        <div class="tpc-right">
          <span class="tpc-ovr-assigned">${ovrForRole}</span>
          <span class="forma-badge ${FORMA_CLS[p.formaAttuale]}">${f.label}</span>
        </div>
        <button type="button" class="lock-btn ${isLocked?"locked":""}" data-player-id="${p.id}" aria-label="${isLocked?"Sblocca":"Blocca"} ${esc(p.nickname)}" aria-pressed="${isLocked}">
          ${isLocked?ICON.lock:ICON.unlock}
        </button>
      </div>`;
    }).join("");

  // ── Chemistry ──
  let chemHtml = "";
  if (chemPairs?.length) {
    chemHtml = `<div class="chem-pairs-block">
      <div class="chem-pairs-title">Intesa in squadra</div>
      ${chemPairs.map(c=>{
        const lv    = Math.round(c.level);
        const stars = "★".repeat(lv)+"☆".repeat(4-lv);
        const cls   = c.level>=3?"chem-pair--high":c.level>=2?"chem-pair--mid":"chem-pair--low";
        return `<div class="chem-pair ${cls}">
          <span>${esc(c.a)} ↔ ${esc(c.b)}</span>
          <span><span class="chem-pair__level">${stars}</span> <span class="chem-bonus">+${fmt(c.bonus)}</span></span>
        </div>`;
      }).join("")}
    </div>`;
  }

  container.innerHTML = `
    ${formSelectHtml}
    <div class="formation-wrap">${renderFormationSVG(players, teamKey, chemPairs, captainId, curFormation, roleMapping)}</div>
    <div class="team-list-below">${listHtml}${chemHtml}</div>`;

  wirePitchDrag(container, containerId, players, teamKey, chemPairs);

  // Formation change
  container.querySelector(".formation-select-ctrl").addEventListener("change", e => {
    const nf = e.target.value;
    customPos[teamKey] = {};   // nuovo modulo = posizioni di default
    if (teamKey==="A") { formationA = nf; roleMappingA = {}; }
    else               { formationB = nf; roleMappingB = {}; }
    renderTeamPanel(containerId, players, teamKey, chemPairs);
  });

  // Role override change
  container.querySelectorAll(".role-override-select").forEach(sel => {
    sel.addEventListener("change", e => {
      e.stopPropagation();
      const pid = sel.dataset.playerId;
      if (teamKey==="A") roleMappingA[pid] = e.target.value;
      else               roleMappingB[pid] = e.target.value;
      renderTeamPanel(containerId, players, teamKey, chemPairs);
    });
  });

  // Lock buttons
  container.querySelectorAll(".lock-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const pid = btn.dataset.playerId;
      if (captainA===pid||captainB===pid) { showToast("I capitani sono sempre bloccati.", "error"); return; }
      if (lockedPlayerIds.has(pid)) lockedPlayerIds.delete(pid); else lockedPlayerIds.add(pid);
      renderBothPanels();
    });
  });

  // Click to select for swap
  container.querySelectorAll(".team-player-card").forEach(card => {
    card.addEventListener("click", e => {
      if (e.target.closest(".lock-btn") || e.target.closest("select")) return;
      const pid    = card.dataset.playerId;
      const tKey   = card.dataset.team;
      const player = tKey==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid);
      if (player) handleCardClick(player, tKey, card);
    });

    // Drag & drop
    card.addEventListener("dragstart", e => {
      const pid = card.dataset.playerId;
      if (lockedPlayerIds.has(pid)||captainA===pid||captainB===pid) { e.preventDefault(); return; }
      dragSource = { player: card.dataset.team==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid), team: card.dataset.team };
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend",  () => { card.classList.remove("dragging"); dragSource=null; });
    card.addEventListener("dragover", e => { e.preventDefault(); if (dragSource&&dragSource.team!==card.dataset.team) card.classList.add("drag-over"); });
    card.addEventListener("dragleave",() => card.classList.remove("drag-over"));
    card.addEventListener("drop", e => {
      e.preventDefault(); card.classList.remove("drag-over");
      if (!dragSource) return;
      const pid = card.dataset.playerId, tKey = card.dataset.team;
      if (dragSource.team===tKey) return;
      const target = tKey==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid);
      if (target) attemptSwap(dragSource.player, dragSource.team, target, tKey);
    });
  });
}

// ── Pitch: trascinamento libero dei giocatori ──
const clampPct = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function pitchSvgs() { return [...document.querySelectorAll("svg.formation-svg[data-team]")]; }

function pitchUnder(clientX, clientY) {
  return pitchSvgs().find(svg => {
    const r = svg.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }) || null;
}

function toPitchCoords(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/** Giocatore della squadra indicata più vicino al punto (coordinate SVG); null se troppo lontano */
function nearestNode(teamKey, x, y, maxDist = 70) {
  let best = null, bestD = maxDist;
  for (const [pid, [px, py]] of Object.entries(layoutCache[teamKey])) {
    const d = Math.hypot(px * PITCH_W / 100 - x, py * PITCH_H / 100 - y);
    if (d < bestD) { best = pid; bestD = d; }
  }
  return best;
}

function wirePitchDrag(container, containerId, players, teamKey, chemPairs) {
  const svg = container.querySelector("svg.formation-svg");
  if (!svg) return;
  const otherKey = teamKey === "A" ? "B" : "A";

  svg.querySelectorAll(".formation-node").forEach(node => {
    node.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();

      const pid    = node.dataset.pid;
      const origin = toPitchCoords(svg, e.clientX, e.clientY);
      let moved = false, targetPid = null;

      node.setPointerCapture(e.pointerId);

      const clearHover = () => {
        pitchSvgs().forEach(s => s.classList.remove("pitch-drop"));
        document.querySelectorAll(".formation-node.swap-target").forEach(n => n.classList.remove("swap-target"));
      };

      const onMove = ev => {
        const p  = toPitchCoords(svg, ev.clientX, ev.clientY);
        const dx = p.x - origin.x, dy = p.y - origin.y;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        if (!moved) { moved = true; node.classList.add("is-dragging"); }
        node.setAttribute("transform", `translate(${dx} ${dy})`);

        clearHover();
        const hoverSvg = pitchUnder(ev.clientX, ev.clientY);
        targetPid = null;
        if (hoverSvg && hoverSvg.dataset.team === otherKey) {
          hoverSvg.classList.add("pitch-drop");
          const q = toPitchCoords(hoverSvg, ev.clientX, ev.clientY);
          targetPid = nearestNode(otherKey, q.x, q.y);
          if (targetPid) hoverSvg.querySelector(`.formation-node[data-pid="${targetPid}"]`)?.classList.add("swap-target");
        }
      };

      const finish = ev => {
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerup", finish);
        node.removeEventListener("pointercancel", finish);
        clearHover();
        if (!moved) return;

        const rerender = () => renderTeamPanel(containerId, players, teamKey, chemPairs);
        if (ev.type === "pointercancel") { rerender(); return; }

        const dropSvg = pitchUnder(ev.clientX, ev.clientY);

        // Rilasciato sul proprio campo → nuova posizione libera
        if (dropSvg === svg) {
          const q = toPitchCoords(svg, ev.clientX, ev.clientY);
          customPos[teamKey][pid] = [
            clampPct(q.x / PITCH_W * 100, 8, 92),
            clampPct(q.y / PITCH_H * 100, 7, 93),
          ];
          rerender();
          return;
        }

        // Rilasciato sull'altro campo → scambio con il giocatore più vicino
        if (dropSvg && dropSvg.dataset.team === otherKey) {
          const from = (teamKey === "A" ? teamA : teamB).find(p => p.id === pid);
          const to   = targetPid ? (otherKey === "A" ? teamA : teamB).find(p => p.id === targetPid) : null;
          if (!from || !to) { showToast("Rilascia il giocatore sopra uno dell'altra squadra per scambiarli.", "error"); rerender(); return; }
          if (lockedPlayerIds.has(from.id) || lockedPlayerIds.has(to.id)) {
            showToast("Uno dei due giocatori è bloccato.", "error"); rerender(); return;
          }
          attemptSwap(from, teamKey, to, otherKey, { inheritPos: true });
          return;
        }

        rerender();   // fuori dai campi: torna al suo posto
      };

      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", finish);
      node.addEventListener("pointercancel", finish);
    });
  });
}

function renderBothPanels() {
  renderTeamPanel("team-a-panel", teamA, "A", chemistryA);
  renderTeamPanel("team-b-panel", teamB, "B", chemistryB);
  updateBalanceUI(computeStrength(teamA,chemistryA), computeStrength(teamB,chemistryB), false);
  computeSuggestions();
}

// ── Swap logic ────────────────────────────────
function handleCardClick(player, team) {
  if (!selectedForSwap) {
    selectedForSwap = { player, team };
    swapSelectedInfo.textContent = `Selezionato: ${player.nickname} (Squadra ${team})`;
    swapActionBar.classList.remove("hidden");
    renderBothPanels();
  } else {
    if (selectedForSwap.player.id === player.id) { cancelSwap(); return; }
    if (selectedForSwap.team === team) {
      selectedForSwap = { player, team };
      swapSelectedInfo.textContent = `Selezionato: ${player.nickname} (Squadra ${team})`;
      renderBothPanels(); return;
    }
    attemptSwap(selectedForSwap.player, selectedForSwap.team, player, team);
  }
}

function attemptSwap(playerFrom, teamFrom, playerTo, teamTo, opts = {}) {
  const fromCap = captainA===playerFrom.id||captainB===playerFrom.id;
  const toCap   = captainA===playerTo.id  ||captainB===playerTo.id;
  if (fromCap||toCap) {
    captainConfirmText.textContent = fromCap
      ? `"${playerFrom.nickname}" è il capitano. Vuoi procedere con lo scambio?`
      : `"${playerTo.nickname}" è il capitano. Vuoi procedere con lo scambio?`;
    captainConfirmOverlay.classList.remove("hidden");
    pendingSwapFn = () => executeSwap(playerFrom, teamFrom, playerTo, teamTo, opts);
  } else {
    executeSwap(playerFrom, teamFrom, playerTo, teamTo, opts);
  }
}

function executeSwap(playerFrom, teamFrom, playerTo, teamTo, opts = {}) {
  if (teamFrom==="A") {
    const iA=teamA.findIndex(p=>p.id===playerFrom.id), iB=teamB.findIndex(p=>p.id===playerTo.id);
    if (iA===-1||iB===-1) return;
    [teamA[iA], teamB[iB]] = [teamB[iB], teamA[iA]];
  } else {
    const iB=teamB.findIndex(p=>p.id===playerFrom.id), iA=teamA.findIndex(p=>p.id===playerTo.id);
    if (iA===-1||iB===-1) return;
    [teamA[iA], teamB[iB]] = [teamB[iB], teamA[iA]];
  }
  chemistryA = filterChemPairs([...chemistryA,...chemistryB], teamA);
  chemistryB = filterChemPairs([...chemistryA,...chemistryB], teamB);

  // Clear role overrides for swapped players
  [playerFrom.id, playerTo.id].forEach(id => {
    delete roleMappingA[id]; delete roleMappingB[id];
  });

  // Posizioni sul campo: con il drag ognuno prende il posto dell'altro, altrimenti si riparte dal modulo
  const fromPos = layoutCache[teamFrom][playerFrom.id];
  const toPos   = layoutCache[teamTo][playerTo.id];
  for (const id of [playerFrom.id, playerTo.id]) { delete customPos.A[id]; delete customPos.B[id]; }
  if (opts.inheritPos && fromPos && toPos) {
    customPos[teamTo][playerFrom.id] = [...toPos];
    customPos[teamFrom][playerTo.id] = [...fromPos];
  }

  cancelSwap();
  renderBothPanels();
  updateBalanceUI(computeStrength(teamA,chemistryA), computeStrength(teamB,chemistryB), true);
  showToast(`Scambio: ${playerFrom.nickname} ↔ ${playerTo.nickname}`);
  saveTeamsToSession();
}

function cancelSwap() {
  selectedForSwap = null;
  swapActionBar.classList.add("hidden");
  renderBothPanels();
}

// ── Smart suggestions ─────────────────────────
function computeSuggestions() {
  if (!teamA.length||!teamB.length) return;
  const curDiff = Math.abs(computeStrength(teamA,chemistryA) - computeStrength(teamB,chemistryB));
  const candidates = [];

  for (const pA of teamA) {
    if (lockedPlayerIds.has(pA.id)) continue;
    for (const pB of teamB) {
      if (lockedPlayerIds.has(pB.id)) continue;
      const sA = [...teamA.filter(p=>p.id!==pA.id),pB].reduce((s,p)=>s+effectiveOVR(p),0);
      const sB = [...teamB.filter(p=>p.id!==pB.id),pA].reduce((s,p)=>s+effectiveOVR(p),0);
      const improvement = curDiff - Math.abs(sA-sB);
      if (improvement > 0.5) candidates.push({ pA, pB, improvement });
    }
  }
  candidates.sort((a,b)=>b.improvement-a.improvement);
  const top = candidates.slice(0,3);
  if (!top.length) { suggestionsPanel.classList.add("hidden"); return; }

  suggestionsPanel.classList.remove("hidden");
  suggestionsList.innerHTML = top.map(c=>`
    <div class="suggestion-item" data-pa="${c.pA.id}" data-pb="${c.pB.id}">
      <span class="suggestion-item__text">Scambia <strong>${c.pA.nickname}</strong> (A) con <strong>${c.pB.nickname}</strong> (B)</span>
      <span class="suggestion-item__delta suggestion-item__delta--pos">↑ −${fmt(c.improvement)} Δ</span>
      <button class="btn btn--secondary btn--sm" data-pa="${c.pA.id}" data-pb="${c.pB.id}">Applica</button>
    </div>`).join("");

  suggestionsList.querySelectorAll("[data-pa]").forEach(el =>
    el.addEventListener("click", e => {
      e.stopPropagation();
      const pA=teamA.find(p=>p.id===el.dataset.pa), pB=teamB.find(p=>p.id===el.dataset.pb);
      if (pA&&pB) attemptSwap(pA,"A",pB,"B");
    })
  );
}

// ── Session storage ───────────────────────────
function saveTeamsToSession() {
  sessionStorage.setItem("lastTeams", JSON.stringify({
    teamA, teamB, chemistryA, chemistryB,
    strengthA: computeStrength(teamA,chemistryA),
    strengthB: computeStrength(teamB,chemistryB),
  }));
}

// ── Generate ──────────────────────────────────
async function generate() {
  if (checkedIds.size<10||checkedIds.size%2!==0) return;
  btnGenerate.disabled=true; btnGenerate.textContent="Ottimizzazione in corso…";
  prevStrA=null; prevStrB=null;
  try {
    const body = { playerIds:[...checkedIds] };
    if (captainA) body.captainA = captainA;
    if (captainB) body.captainB = captainB;

    const result = await fetch("/match",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
    if (result.error) throw new Error(result.error);

    teamA=[...result.teamA]; teamB=[...result.teamB];
    origTeamA=[...result.teamA]; origTeamB=[...result.teamB];
    chemistryA=result.chemistryA||[]; chemistryB=result.chemistryB||[];
    lastResult=result;

    // Reset formation & overrides
    customPos = { A: {}, B: {} };
    formationA = defaultFormation(teamA.length);
    formationB = defaultFormation(teamB.length);
    roleMappingA = {}; roleMappingB = {};

    renderBothPanels();
    document.getElementById("sa-energy").textContent = `E = ${fmt(result.saEnergy)}`;
    updateBalanceUI(computeStrength(teamA,chemistryA), computeStrength(teamB,chemistryB), false);

    teamsSection.classList.remove("hidden");
    teamsSection.scrollIntoView({ behavior:"smooth" });
    saveTeamsToSession();
    showToast("Squadre generate. Trascina i giocatori per modificarle.");
  } catch(err) { showToast(err.message,"error"); }
  finally {
    const n=checkedIds.size;
    btnGenerate.disabled=false;
    btnGenerate.textContent = n>=10&&n%2===0 ? `Genera ${n/2} contro ${n/2}` : "Genera squadre";
  }
}

// ── Export formazione come immagine ───────────
/** SVG autonomo (niente CSS esterno) con entrambi i campi, pronto per essere rasterizzato */
function buildExportSVG() {
  const PAD = 28, GAP = 24, HEAD = 84, TITLE = 46, FOOT = 44;
  const W = PAD * 2 + PITCH_W * 2 + GAP;
  const H = HEAD + TITLE + PITCH_H + FOOT;
  const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";

  const strA = computeStrength(teamA, chemistryA);
  const strB = computeStrength(teamB, chemistryB);
  const fA = formationA || defaultFormation(teamA.length);
  const fB = formationB || defaultFormation(teamB.length);

  const pitchY = HEAD + TITLE;
  const xA = PAD, xB = PAD + PITCH_W + GAP;
  const pitch = (team, key, chem, cap, form, map, x) =>
    renderFormationSVG(team, key, chem, cap, form, map, true)
      .replace("<svg ", `<svg x="${x}" y="${pitchY}" width="${PITCH_W}" height="${PITCH_H}" `);

  const date = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const n = teamA.length;
  const header = (x, label, str, col) => `
    <circle cx="${x + 7}" cy="${HEAD + 24}" r="7" fill="${col}"/>
    <text x="${x + 24}" y="${HEAD + 30}" font-family="${FONT}" font-size="20" font-weight="800" fill="${col}">${label}</text>
    <text x="${x + PITCH_W}" y="${HEAD + 30}" text-anchor="end" font-family="${FONT}" font-size="15" font-weight="700" fill="#a3a99a">Forza ${fmt(str)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="#0c0e0b"/>
    <text x="${W / 2}" y="40" text-anchor="middle" font-family="${FONT}" font-size="28" font-weight="800" fill="#eceee4">CalcettoEz · Formazioni</text>
    <text x="${W / 2}" y="66" text-anchor="middle" font-family="${FONT}" font-size="14" fill="#a3a99a">${esc(date)} · ${n} vs ${n}</text>
    ${header(xA, "Squadra A", strA, TEAM_COLORS.A)}
    ${header(xB, "Squadra B", strB, TEAM_COLORS.B)}
    ${pitch(teamA, "A", chemistryA, captainA, fA, roleMappingA, xA)}
    ${pitch(teamB, "B", chemistryB, captainB, fB, roleMappingB, xB)}
    <text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#a3a99a">Δ forza: ${fmt(Math.abs(strA - strB))}</text>
  </svg>`;
}

/** Rasterizza l'SVG in un PNG (2x per restare nitido su chat/schermi retina) */
async function teamsImageBlob(scale = 2) {
  const svg = buildExportSVG();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error("Impossibile generare l'immagine.")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width  = img.naturalWidth  * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Impossibile generare l'immagine.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const imageFilename = () => `formazioni-${new Date().toISOString().slice(0, 10)}.png`;

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.getElementById("btn-export-img").addEventListener("click", async () => {
  if (!teamA.length) return;
  try {
    downloadBlob(await teamsImageBlob(), imageFilename());
    showToast("Immagine scaricata.");
  } catch (err) { showToast(err.message, "error"); }
});

const btnShareImg = document.getElementById("btn-share-img");
// "Condividi" compare solo dove il browser sa condividere file (tipicamente smartphone)
if (navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] })) {
  btnShareImg.classList.remove("hidden");
  btnShareImg.addEventListener("click", async () => {
    if (!teamA.length) return;
    try {
      const blob = await teamsImageBlob();
      await navigator.share({
        files: [new File([blob], imageFilename(), { type: "image/png" })],
        title: "Formazioni CalcettoEz",
      });
    } catch (err) {
      if (err.name === "AbortError") return;   // l'utente ha chiuso il foglio di condivisione
      showToast("Condivisione non riuscita: usa «Scarica immagine».", "error");
    }
  });
}

// ── Event listeners ───────────────────────────
btnGenerate.addEventListener("click", generate);
document.getElementById("btn-regen").addEventListener("click", generate);

document.getElementById("btn-reset-teams").addEventListener("click", () => {
  if (!origTeamA.length) return;
  teamA=[...origTeamA]; teamB=[...origTeamB];
  chemistryA=lastResult.chemistryA||[]; chemistryB=lastResult.chemistryB||[];
  lockedPlayerIds.clear();
  customPos = { A: {}, B: {} };
  roleMappingA={}; roleMappingB={};
  formationA=defaultFormation(teamA.length);
  formationB=defaultFormation(teamB.length);
  cancelSwap();
  renderBothPanels();
  showToast("Squadre ripristinate.");
});

btnCancelSwap.addEventListener("click", cancelSwap);

btnClearSel.addEventListener("click",()=>{
  checkedIds.clear(); captainA=null; captainB=null;
  renderCaptainSlot("a",null); renderCaptainSlot("b",null);
  renderList(); updateCounter();
  teamsSection.classList.add("hidden");
});

btnAutoSelect?.addEventListener("click", () => {
  const available = allPlayers.filter(p => p.formaAttuale !== "infortunato");
  if (!available.length) { showToast("Nessun giocatore disponibile.", "error"); return; }
  checkedIds.clear(); captainA=null; captainB=null;
  available.sort((a,b)=>b.storico.partite-a.storico.partite).slice(0,10).forEach(p=>checkedIds.add(p.id));
  renderCaptainSlot("a",null); renderCaptainSlot("b",null);
  renderList(); updateCounter();
  showToast(`${Math.min(available.length,10)} giocatori auto-selezionati.`);
});

searchInput.addEventListener("input", renderList);

captainConfirmCancel.addEventListener("click", () => {
  captainConfirmOverlay.classList.add("hidden"); pendingSwapFn=null; cancelSwap();
});
captainConfirmOk.addEventListener("click", () => {
  captainConfirmOverlay.classList.add("hidden");
  if (pendingSwapFn) { pendingSwapFn(); pendingSwapFn=null; }
});

// ── Init ──────────────────────────────────────
async function loadPlayers() {
  try {
    allPlayers = await fetch("/players").then(r=>r.json());
    renderList(); updateCounter();
    renderCaptainSlot("a",null); renderCaptainSlot("b",null);
  } catch(err) { showToast(err.message,"error"); }
}
loadPlayers();
