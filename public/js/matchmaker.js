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

// ── Constants ─────────────────────────────────
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
const ROLE_ICON   = { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" };
const ROLE_LABELS = { portiere:"Portiere", difensore:"Difensore", centrocampista:"Centrocampista", attaccante:"Attaccante" };
const ROLE_ORDER  = ["portiere","difensore","centrocampista","attaccante"];
const CHEMISTRY_BONUS = { 0:0, 1:0.3, 2:0.8, 3:2.0, 4:3.5 };
const TEAM_COLORS = { A:"#3d7eff", B:"#e74c3c" };

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
  btnGenerate.textContent = valid ? `⚡ Genera (${n/2}v${n/2})` : "⚡ Genera Squadre";
}

function effectiveOVR(p) {
  const vals = Object.values(p.ovr);
  const base = vals.reduce((s,v) => s+v, 0) / vals.length;
  const f    = FORMA_OPTIONS.find(o => o.value === p.formaAttuale) || FORMA_OPTIONS[2];
  return Math.min(10, Math.max(0, base + f.delta));
}

function computeStrength(team, chemPairs) {
  const base  = team.reduce((s, p) => s + effectiveOVR(p), 0);
  const bonus = (chemPairs||[]).reduce((s, c) => s + (CHEMISTRY_BONUS[c.level]||0), 0);
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
    verdict.textContent = "⚡ Squadre perfettamente equilibrate";
    verdict.className   = "balance-verdict balance-verdict--great";
  } else if (diff <= 5) {
    verdict.textContent = "✅ Squadre equilibrate";
    verdict.className   = "balance-verdict balance-verdict--ok";
  } else if (diff <= 10) {
    verdict.textContent = `⚠️ ${strA > strB ? "Squadra A" : "Squadra B"} più forte del ${diffPct}%`;
    verdict.className   = "balance-verdict balance-verdict--unbal";
  } else {
    verdict.textContent = `❌ ${strA > strB ? "Squadra A" : "Squadra B"} molto più forte (${diffPct}%)`;
    verdict.className   = "balance-verdict balance-verdict--bad";
  }

  const badge = document.getElementById("swap-delta-badge");
  if (showDelta && prevStrA !== null) {
    const improvement = Math.abs(prevStrA - prevStrB) - diff;
    if (Math.abs(improvement) > 0.1) {
      badge.style.display = "";
      badge.textContent   = improvement > 0
        ? `↑ Più equilibrate (−${fmt(improvement)})`
        : `↓ Meno equilibrate (+${fmt(-improvement)})`;
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
      <span class="captain-slot__badge">${team==="a"?"🔵":"🔴"}</span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">${player.nickname}</div>
        <div class="captain-slot__role">${player.ruoloPreferito}</div>
      </div>
      <button class="captain-slot__clear" data-team="${team}">✕</button>`;
    slotEl.querySelector(".captain-slot__clear").addEventListener("click", e => {
      e.stopPropagation();
      if (team==="a") captainA=null; else captainB=null;
      renderCaptainSlot(team, null); renderList();
    });
  } else {
    slotEl.classList.remove("filled");
    slotEl.innerHTML = `
      <span class="captain-slot__badge">${team==="a"?"🔵":"🔴"}</span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">Nessun capitano ${team.toUpperCase()}</div>
        <div class="captain-slot__role">Premi "Cap ${team.toUpperCase()}" su un giocatore</div>
      </div>`;
  }
}

function setCaptain(playerId, team) {
  if (team==="a") {
    if (captainB===playerId) { showToast("Già capitano B!", "error"); return; }
    captainA = captainA===playerId ? null : playerId;
    renderCaptainSlot("a", captainA);
  } else {
    if (captainA===playerId) { showToast("Già capitano A!", "error"); return; }
    captainB = captainB===playerId ? null : playerId;
    renderCaptainSlot("b", captainB);
  }
  renderList();
}

// ── Player selection list ─────────────────────
function renderList() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = allPlayers.filter(p =>
    !q || p.nickname.toLowerCase().includes(q) ||
    p.name.toLowerCase().includes(q) || p.ruoloPreferito.toLowerCase().includes(q)
  );
  if (!filtered.length) {
    playerCheckboxList.innerHTML = `<p class="empty-state">Nessun giocatore trovato.</p>`; return;
  }
  filtered.sort((a,b) => {
    const ac=checkedIds.has(a.id)?1:0, bc=checkedIds.has(b.id)?1:0;
    return bc!==ac ? bc-ac : b.storico.partite - a.storico.partite;
  });

  playerCheckboxList.innerHTML = filtered.map(p => {
    const f      = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
    const vals   = Object.values(p.ovr);
    const base   = vals.reduce((s,v)=>s+v,0)/vals.length;
    const eff    = Math.min(10, Math.max(0, Math.round((base+f.delta)*10)/10));
    const ds     = f.delta !== 0 ? ` (${f.delta>0?"+":""}${f.delta})` : "";
    const isCapA = captainA===p.id, isCapB = captainB===p.id;
    return `
    <div class="player-checkbox-item ${checkedIds.has(p.id)?"is-selected":""}" id="cb-item-${p.id}">
      <input type="checkbox" class="player-checkbox" id="cb-${p.id}" value="${p.id}" ${checkedIds.has(p.id)?"checked":""}/>
      <label for="cb-${p.id}" class="cb-label">
        <span class="checkbox-icon">${ROLE_ICON[p.ruoloPreferito]||"❓"}</span>
        <span class="checkbox-name">${p.nickname}${p.isUnknown?` <span class="badge badge--unknown" style="font-size:.65rem">👤</span>`:""}</span>
        <span class="cb-partite">🏟️ ${p.storico.partite}</span>
        <span class="checkbox-ovr">${fmt(eff)}${ds}</span>
      </label>
      <div class="forma-inline">
        ${isCapA ? `<span style="font-size:.75rem;font-weight:700;color:var(--accent)">🔵 Cap A</span>` : ""}
        ${isCapB ? `<span style="font-size:.75rem;font-weight:700;color:var(--danger)">🔴 Cap B</span>` : ""}
        ${checkedIds.has(p.id) && !isCapA && !isCapB ? `
          <button class="cb-captain-btn" data-pid="${p.id}" data-team="a">Cap A</button>
          <button class="cb-captain-btn" data-pid="${p.id}" data-team="b">Cap B</button>
        ` : ""}
        <span class="forma-badge ${FORMA_CLS[p.formaAttuale]||"forma--grey"}" style="font-size:.72rem">${f.label}</span>
        <select class="forma-select input input--sm" data-player-id="${p.id}">
          ${FORMA_OPTIONS.map(o=>`<option value="${o.value}" ${o.value===p.formaAttuale?"selected":""}>${o.label}</option>`).join("")}
        </select>
      </div>
    </div>`;
  }).join("");

  playerCheckboxList.querySelectorAll(".player-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) checkedIds.add(cb.value);
      else {
        checkedIds.delete(cb.value);
        if (captainA===cb.value) { captainA=null; renderCaptainSlot("a",null); }
        if (captainB===cb.value) { captainB=null; renderCaptainSlot("b",null); }
      }
      document.getElementById(`cb-item-${cb.value}`)?.classList.toggle("is-selected", cb.checked);
      updateCounter(); renderList();
    });
  });

  playerCheckboxList.querySelectorAll(".cb-captain-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.preventDefault(); setCaptain(btn.dataset.pid, btn.dataset.team); });
  });

  playerCheckboxList.querySelectorAll(".forma-select").forEach(sel =>
    sel.addEventListener("change", async e => {
      try {
        await fetch(`/players/${e.target.dataset.playerId}`, {
          method:"PUT", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ formaAttuale: e.target.value }),
        });
        const p = allPlayers.find(p=>p.id===e.target.dataset.playerId);
        if (p) p.formaAttuale = e.target.value;
        renderList();
      } catch(err) { showToast(err.message,"error"); }
    })
  );
}

// ── Formation SVG ─────────────────────────────
function renderFormationSVG(players, teamKey, chemPairs, captainId, formationName, roleMapping) {
  const W = 420, H = 560;
  const col   = TEAM_COLORS[teamKey];
  const n     = players.length;
  const slots = buildFormationSlots(players, formationName, n, roleMapping);

  // Chemistry lines (level ≥ 3)
  const chemLines = (chemPairs||[]).filter(c=>c.level>=3).map(c=>{
    const pA = players.find(p=>p.nickname===c.a), pB = players.find(p=>p.nickname===c.b);
    if (!pA||!pB) return "";
    const sa = slots.find(s=>s.player?.id===pA.id), sb = slots.find(s=>s.player?.id===pB.id);
    if (!sa||!sb) return "";
    return `<line x1="${sa.x*W/100}" y1="${sa.y*H/100}" x2="${sb.x*W/100}" y2="${sb.y*H/100}"
      stroke="${col}" stroke-width="${c.level===4?2.5:1.5}"
      stroke-dasharray="${c.level===4?"none":"5,3"}" stroke-opacity="${c.level===4?.75:.4}"/>`;
  }).join("");

  // Player nodes
  const nodes = slots.map(s => {
    const cx = s.x * W / 100, cy = s.y * H / 100;
    if (!s.player) {
      return `<g>
        <circle cx="${cx}" cy="${cy}" r="24" fill="rgba(255,255,255,.04)" stroke="${col}" stroke-width="1.5" stroke-dasharray="5,3"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
          font-size="13" fill="rgba(255,255,255,.2)">${ROLE_ICON[s.role]||"?"}</text>
      </g>`;
    }
    const p      = s.player;
    const nick   = p.nickname.length > 8 ? p.nickname.slice(0,7)+"…" : p.nickname;
    const forma  = {infortunato:"🩹",scarsa_forma:"😕",normale:"",in_forma:"💪",grande_forma:"🔥"}[p.formaAttuale]||"";
    const isCap  = p.id === captainId;
    const isOut  = s.outOfRole;
    const stroke = isCap ? "#ffd700" : isOut ? "#f5a623" : "rgba(255,255,255,.8)";
    const fillBg = isOut ? (teamKey==="A" ? "#2a52b0" : "#8c2a22") : col;
    const r      = isCap ? 26 : 23;
    const ovrVal = p.ovr?.[s.role] !== undefined ? fmt(p.ovr[s.role]) : fmt(effectiveOVR(p));

    return `<g class="formation-node" data-pid="${p.id}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fillBg}" fill-opacity="${isCap?.95:.88}"
        stroke="${stroke}" stroke-width="${isCap||isOut?3:1.5}"/>
      ${isCap?`<circle cx="${cx}" cy="${cy}" r="${r+6}" fill="none" stroke="#ffd70050" stroke-width="1.5" stroke-dasharray="4,3"/>`: ""}
      ${isOut&&!isCap?`<circle cx="${cx}" cy="${cy}" r="${r+5}" fill="none" stroke="#f5a62350" stroke-width="1.5" stroke-dasharray="4,3"/>`: ""}
      <text x="${cx}" y="${cy-3}" text-anchor="middle" dominant-baseline="middle"
        font-size="11" font-weight="700" fill="white" font-family="Inter,sans-serif">${nick}</text>
      <text x="${cx}" y="${cy+10}" text-anchor="middle" dominant-baseline="middle"
        font-size="9.5" fill="rgba(255,255,255,.7)" font-family="Inter,sans-serif">${ovrVal}</text>
      ${isCap?`<text x="${cx+r-2}" y="${cy-r+2}" font-size="13">🏅</text>`: ""}
      ${isOut&&!isCap?`<text x="${cx+r-3}" y="${cy-r+3}" font-size="11">⚠️</text>`: ""}
      ${forma&&!isCap&&!isOut?`<text x="${cx+r-3}" y="${cy-r+3}" font-size="12">${forma}</text>`: ""}
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="formation-svg">
    <defs>
      <linearGradient id="grass-${teamKey}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e5c1e"/>
        <stop offset="100%" stop-color="#145214"/>
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
    <span class="formation-selector__label">⚽ Modulo</span>
    <select class="formation-select-ctrl input input--sm" data-team="${teamKey}">
      ${Object.keys(formations).map(name =>
        `<option value="${name}" ${name===curFormation?"selected":""}>${name}</option>`
      ).join("")}
    </select>
    ${Object.keys(formations).length > 1 ? `<span style="font-size:.72rem;color:var(--text-muted)">— ${n} giocatori, ${Object.keys(formations).length} moduli disponibili</span>` : ""}
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
        <span class="tpc-assigned-role">${ROLE_ICON[effectRole]||"❓"}</span>
        <div class="tpc-info">
          <span class="tpc-name">${p.nickname}${isCap?` <span style="font-size:.75rem">🏅</span>`:""}</span>
          <div class="tpc-role-row">
            ${isOut
              ? `<span class="tpc-out-badge">⚠️ fuori ruolo</span>`
              : ""}
            <select class="role-override-select input input--xs" data-player-id="${p.id}" data-team="${teamKey}">
              ${ROLE_ORDER.map(r =>
                `<option value="${r}" ${r===effectRole?"selected":""}>${ROLE_ICON[r]} ${ROLE_LABELS[r]}</option>`
              ).join("")}
            </select>
          </div>
        </div>
        <div class="tpc-right">
          <span class="tpc-ovr-assigned">${ovrForRole}</span>
          <span class="forma-badge ${FORMA_CLS[p.formaAttuale]}" style="font-size:.6rem;padding:.08rem .3rem">${f.label}</span>
        </div>
        <button class="lock-btn ${isLocked?"locked":""}" data-player-id="${p.id}">
          ${isLocked?"🔒":"🔓"}
        </button>
      </div>`;
    }).join("");

  // ── Chemistry ──
  let chemHtml = "";
  if (chemPairs?.length) {
    chemHtml = `<div class="chem-pairs-block">
      <div class="chem-pairs-title">🤝 Intesa</div>
      ${chemPairs.map(c=>{
        const stars = "★".repeat(c.level)+"☆".repeat(4-c.level);
        const cls   = c.level>=3?"chem-pair--high":c.level===2?"chem-pair--mid":"chem-pair--low";
        return `<div class="chem-pair ${cls}">
          <span>${c.a} ↔ ${c.b}</span>
          <span>${stars} <span class="chem-bonus">+${fmt(c.bonus)}</span></span>
        </div>`;
      }).join("")}
    </div>`;
  }

  container.innerHTML = `
    ${formSelectHtml}
    <div class="formation-wrap">${renderFormationSVG(players, teamKey, chemPairs, captainId, curFormation, roleMapping)}</div>
    <div class="team-list-below">${listHtml}${chemHtml}</div>`;

  // Formation change
  container.querySelector(".formation-select-ctrl").addEventListener("change", e => {
    const nf = e.target.value;
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
    swapSelectedInfo.textContent = `✓ ${player.nickname} (Squadra ${team})`;
    swapActionBar.classList.remove("hidden");
    renderBothPanels();
  } else {
    if (selectedForSwap.player.id === player.id) { cancelSwap(); return; }
    if (selectedForSwap.team === team) {
      selectedForSwap = { player, team };
      swapSelectedInfo.textContent = `✓ ${player.nickname} (Squadra ${team})`;
      renderBothPanels(); return;
    }
    attemptSwap(selectedForSwap.player, selectedForSwap.team, player, team);
  }
}

function attemptSwap(playerFrom, teamFrom, playerTo, teamTo) {
  const fromCap = captainA===playerFrom.id||captainB===playerFrom.id;
  const toCap   = captainA===playerTo.id  ||captainB===playerTo.id;
  if (fromCap||toCap) {
    captainConfirmText.textContent = fromCap
      ? `"${playerFrom.nickname}" è il capitano. Vuoi procedere con lo scambio?`
      : `"${playerTo.nickname}" è il capitano. Vuoi procedere con lo scambio?`;
    captainConfirmOverlay.classList.remove("hidden");
    pendingSwapFn = () => executeSwap(playerFrom, teamFrom, playerTo, teamTo);
  } else {
    executeSwap(playerFrom, teamFrom, playerTo, teamTo);
  }
}

function executeSwap(playerFrom, teamFrom, playerTo, teamTo) {
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

  cancelSwap();
  renderBothPanels();
  updateBalanceUI(computeStrength(teamA,chemistryA), computeStrength(teamB,chemistryB), true);
  showToast(`⇄ ${playerFrom.nickname} ↔ ${playerTo.nickname}`);
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
      <span>💡</span>
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
  btnGenerate.disabled=true; btnGenerate.textContent="⏳ Ottimizzazione…";
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
    formationA = defaultFormation(teamA.length);
    formationB = defaultFormation(teamB.length);
    roleMappingA = {}; roleMappingB = {};

    renderBothPanels();
    document.getElementById("sa-energy").textContent = `E = ${fmt(result.saEnergy)}`;
    updateBalanceUI(computeStrength(teamA,chemistryA), computeStrength(teamB,chemistryB), false);

    teamsSection.classList.remove("hidden");
    teamsSection.scrollIntoView({ behavior:"smooth" });
    saveTeamsToSession();
    showToast("Squadre generate! Modifica con drag&drop o selezione.");
  } catch(err) { showToast(err.message,"error"); }
  finally {
    const n=checkedIds.size;
    btnGenerate.disabled=false;
    btnGenerate.textContent = n>=10&&n%2===0 ? `⚡ Genera (${n/2}v${n/2})` : "⚡ Genera Squadre";
  }
}

// ── Event listeners ───────────────────────────
btnGenerate.addEventListener("click", generate);
document.getElementById("btn-regen").addEventListener("click", generate);

document.getElementById("btn-reset-teams").addEventListener("click", () => {
  if (!origTeamA.length) return;
  teamA=[...origTeamA]; teamB=[...origTeamB];
  chemistryA=lastResult.chemistryA||[]; chemistryB=lastResult.chemistryB||[];
  lockedPlayerIds.clear();
  roleMappingA={}; roleMappingB={};
  formationA=defaultFormation(teamA.length);
  formationB=defaultFormation(teamB.length);
  cancelSwap();
  renderBothPanels();
  showToast("Squadre ripristinate!");
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
  if (!available.length) { showToast("Nessun giocatore disponibile!", "error"); return; }
  checkedIds.clear(); captainA=null; captainB=null;
  available.sort((a,b)=>b.storico.partite-a.storico.partite).slice(0,10).forEach(p=>checkedIds.add(p.id));
  renderCaptainSlot("a",null); renderCaptainSlot("b",null);
  renderList(); updateCounter();
  showToast(`${Math.min(available.length,10)} giocatori auto-selezionati!`);
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
