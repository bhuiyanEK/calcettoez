/**
 * matchmaker.js – Enhanced with:
 *  - Captain selection (fixed to opposite teams)
 *  - Manual player swap (drag & drop + click-to-select)
 *  - Real-time balance meter
 *  - Smart swap suggestions
 *  - Player lock
 *  - Reset / Rigenera
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
let captainA     = null; // player id
let captainB     = null;

// Teams state (after generation)
let teamA        = []; // array of player objects (with assignedRole etc.)
let teamB        = [];
let chemistryA   = [];
let chemistryB   = [];
let origTeamA    = [];
let origTeamB    = [];
let lastResult   = null;

// Swap state
let selectedForSwap   = null; // { player, team: 'A'|'B' }
let lockedPlayerIds   = new Set();
let dragSource        = null; // { player, team }

// Captain confirm queue
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
const ROLE_ICON = { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" };
const CHEMISTRY_BONUS = { 0:0, 1:0.3, 2:0.8, 3:2.0, 4:3.5 };

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
  selCount.className   = n===0?"":n>16?"counter--over":valid?"counter--ready":"counter--warn";
  btnGenerate.disabled = !valid;
  btnGenerate.textContent = valid ? `⚡ Genera (${n/2}v${n/2})` : "⚡ Genera Squadre";
}

function effectiveOVR(p) {
  const base = Object.values(p.ovr).reduce((s,v)=>s+v,0)/4;
  const f = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
  return Math.min(10, Math.max(0, base + f.delta));
}

// Simple client-side strength (sum of player OVRs + chemistry bonuses)
function computeStrength(team, chemPairs) {
  const base  = team.reduce((s,p) => s + effectiveOVR(p), 0);
  const bonus = (chemPairs||[]).reduce((s,c) => s + (CHEMISTRY_BONUS[c.level]||0), 0);
  return Math.round((base + bonus) * 10) / 10;
}

// Recompute chemistry pairs for a team after swap (simplified: use existing pairs filtered to new members)
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

  const diff  = Math.abs(strA - strB);
  const diffPct = total > 0 ? (diff / total * 100).toFixed(0) : 0;
  document.getElementById("balance-diff-text").textContent = `Δ forza: ${diff.toFixed(1)}`;

  const diffEl = document.getElementById("ovr-diff");
  diffEl.textContent = `Δ forza: ${diff.toFixed(1)}`;
  diffEl.className   = `ovr-diff ${diff <= 5 ? "ovr-diff--ok" : "ovr-diff--warn"}`;

  const verdict   = document.getElementById("balance-verdict");
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

  // Delta badge
  const badge = document.getElementById("swap-delta-badge");
  if (showDelta && prevStrA !== null) {
    const prevDiff = Math.abs(prevStrA - prevStrB);
    const newDiff  = diff;
    const improvement = prevDiff - newDiff;
    if (Math.abs(improvement) > 0.1) {
      badge.style.display = "";
      if (improvement > 0) {
        badge.textContent = `↑ Più equilibrate (−${improvement.toFixed(1)})`;
        badge.className   = "swap-delta swap-delta--better";
      } else {
        badge.textContent = `↓ Meno equilibrate (+${(-improvement).toFixed(1)})`;
        badge.className   = "swap-delta swap-delta--worse";
      }
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
  const player = captainId ? allPlayers.find(p=>p.id===captainId) : null;
  if (player) {
    slotEl.classList.add("filled");
    slotEl.innerHTML = `
      <span class="captain-slot__badge">${team==="a"?"🔵":"🔴"}</span>
      <div class="captain-slot__info">
        <div class="captain-slot__name">${player.nickname}</div>
        <div class="captain-slot__role">${player.ruoloPreferito}</div>
      </div>
      <button class="captain-slot__clear" data-team="${team}" title="Rimuovi capitano">✕</button>`;
    slotEl.querySelector(".captain-slot__clear").addEventListener("click", (e) => {
      e.stopPropagation();
      if (team==="a") captainA=null; else captainB=null;
      renderCaptainSlot(team, null);
      renderList();
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
    if (captainB === playerId) { showToast("Questo giocatore è già capitano B!", "error"); return; }
    captainA = (captainA === playerId) ? null : playerId;
    renderCaptainSlot("a", captainA);
  } else {
    if (captainA === playerId) { showToast("Questo giocatore è già capitano A!", "error"); return; }
    captainB = (captainB === playerId) ? null : playerId;
    renderCaptainSlot("b", captainB);
  }
  renderList();
}

// ── Render player list ─────────────────────────
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = allPlayers.filter(p =>
    !query || p.nickname.toLowerCase().includes(query) ||
    p.name.toLowerCase().includes(query) || p.ruoloPreferito.toLowerCase().includes(query)
  );
  if (!filtered.length) {
    playerCheckboxList.innerHTML = `<p class="empty-state">Nessun giocatore trovato.</p>`; return;
  }
  filtered.sort((a,b) => {
    const ac=checkedIds.has(a.id)?1:0, bc=checkedIds.has(b.id)?1:0;
    if (bc!==ac) return bc-ac;
    return b.storico.partite - a.storico.partite;
  });

  playerCheckboxList.innerHTML = filtered.map(p => {
    const f    = FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
    const base = Object.values(p.ovr).reduce((s,v)=>s+v,0)/4;
    const eff  = Math.min(10, Math.max(0, Math.round((base+f.delta)*10)/10));
    const ds   = f.delta!==0 ? ` (${f.delta>0?"+":""}${f.delta})` : "";
    const isCapA = captainA === p.id;
    const isCapB = captainB === p.id;
    const canSelectA = !isCapB && checkedIds.has(p.id);
    const canSelectB = !isCapA && checkedIds.has(p.id);
    return `
    <div class="player-checkbox-item ${checkedIds.has(p.id)?"is-selected":""}" id="cb-item-${p.id}">
      <input type="checkbox" class="player-checkbox" id="cb-${p.id}" value="${p.id}"
        ${checkedIds.has(p.id)?"checked":""}/>
      <label for="cb-${p.id}" class="cb-label">
        <span class="checkbox-icon">${ROLE_ICON[p.ruoloPreferito]||"❓"}</span>
        <span class="checkbox-name">${p.nickname}${p.isUnknown?` <span class="badge badge--unknown" style="font-size:.65rem">👤</span>`:""}</span>
        <span class="cb-partite">🏟️ ${p.storico.partite}</span>
        <span class="checkbox-ovr">${eff}${ds}</span>
      </label>
      <div class="forma-inline">
        ${isCapA ? `<span style="font-size:.75rem;font-weight:700;color:var(--accent)">🔵 Cap A</span>` : ""}
        ${isCapB ? `<span style="font-size:.75rem;font-weight:700;color:var(--danger)">🔴 Cap B</span>` : ""}
        ${checkedIds.has(p.id) && !isCapA && !isCapB ? `
          <button class="cb-captain-btn ${isCapA?"active-a":""}" data-pid="${p.id}" data-team="a">Cap A</button>
          <button class="cb-captain-btn ${isCapB?"active-b":""}" data-pid="${p.id}" data-team="b">Cap B</button>
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
      if (cb.checked) checkedIds.add(cb.value); else {
        checkedIds.delete(cb.value);
        // Remove captain if unchecked
        if (captainA === cb.value) { captainA=null; renderCaptainSlot("a",null); }
        if (captainB === cb.value) { captainB=null; renderCaptainSlot("b",null); }
      }
      document.getElementById(`cb-item-${cb.value}`)?.classList.toggle("is-selected",cb.checked);
      updateCounter();
      renderList();
    });
  });

  playerCheckboxList.querySelectorAll(".cb-captain-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      setCaptain(btn.dataset.pid, btn.dataset.team);
    });
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
      } catch(err){ showToast(err.message,"error"); }
    })
  );
}

// ── Formation SVG ─────────────────────────────
const FORMATION_POSITIONS = {
  5: { portiere:[[50,88]], difensore:[[50,68]], centrocampista:[[28,45],[72,45]], attaccante:[[50,18]] },
  6: { portiere:[[50,88]], difensore:[[28,68],[72,68]], centrocampista:[[28,42],[72,42]], attaccante:[[50,18]] },
  7: { portiere:[[50,88]], difensore:[[22,68],[50,68],[78,68]], centrocampista:[[28,44],[72,44]], attaccante:[[28,18],[72,18]] },
  8: { portiere:[[50,88]], difensore:[[20,68],[50,68],[80,68]], centrocampista:[[20,46],[50,44],[80,46]], attaccante:[[28,18],[72,18]] },
};
const TEAM_COLORS = { A:"#3d7eff", B:"#e74c3c" };

function buildFormationSlots(players) {
  const byRole = {};
  for (const p of players) {
    const r = p.assignedRole || p.ruoloPreferito;
    if (!byRole[r]) byRole[r] = [];
    byRole[r].push(p);
  }
  const n   = players.length;
  const pos = FORMATION_POSITIONS[n] || FORMATION_POSITIONS[5];
  const slots = [];
  for (const [role, positions] of Object.entries(pos)) {
    const rolePlayers = byRole[role] || [];
    positions.forEach(([x,y], i) => slots.push({ x, y, player: rolePlayers[i]||null, role }));
  }
  return slots;
}

function renderFormationSVG(players, teamKey, chemPairs, captainId) {
  const W = 300, H = 420;
  const col   = TEAM_COLORS[teamKey];
  const slots = buildFormationSlots(players);

  const chemLines = (chemPairs||[]).filter(c=>c.level>=3).map(c=>{
    const pA=players.find(p=>p.nickname===c.a), pB=players.find(p=>p.nickname===c.b);
    if(!pA||!pB) return "";
    const sa=slots.find(s=>s.player?.id===pA.id), sb=slots.find(s=>s.player?.id===pB.id);
    if(!sa||!sb) return "";
    const x1=sa.x*W/100,y1=sa.y*H/100,x2=sb.x*W/100,y2=sb.y*H/100;
    const opacity=c.level===4?"0.7":"0.4";
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="${col}" stroke-width="${c.level===4?2:1.5}" stroke-dasharray="${c.level===4?"none":"4,3"}"
      stroke-opacity="${opacity}"/>`;
  }).join("");

  const nodes = slots.map(s=>{
    const cx=s.x*W/100, cy=s.y*H/100;
    if(!s.player) return `<circle cx="${cx}" cy="${cy}" r="18" fill="rgba(255,255,255,.05)" stroke="${col}" stroke-width="1" stroke-dasharray="4,3"/>`;
    const p    = s.player;
    const nick = p.nickname.length>7 ? p.nickname.slice(0,6)+"…" : p.nickname;
    const forma= {infortunato:"🩹",scarsa_forma:"😕",normale:"",in_forma:"💪",grande_forma:"🔥"}[p.formaAttuale]||"";
    const isCap= p.id === captainId;
    return `<g class="formation-node">
      <circle cx="${cx}" cy="${cy}" r="${isCap?24:22}" fill="${col}" fill-opacity="${isCap?0.95:0.85}"
        stroke="${isCap?"#ffd700":"white"}" stroke-width="${isCap?2.5:1.5}"/>
      ${isCap?`<circle cx="${cx}" cy="${cy}" r="28" fill="none" stroke="#ffd70060" stroke-width="1.5" stroke-dasharray="4,3"/>`:""}
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
        font-size="10" font-weight="700" fill="white" font-family="Inter,sans-serif">${nick}</text>
      ${isCap?`<text x="${cx+16}" y="${cy-16}" font-size="12">🏅</text>`:""}
      ${forma&&!isCap?`<text x="${cx+14}" y="${cy-14}" font-size="11">${forma}</text>`:""}
      <text x="${cx}" y="${cy+34}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.55)"
        font-family="Inter,sans-serif">${p.assignedRoleOVR??""}</text>
    </g>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="formation-svg">
    <rect width="${W}" height="${H}" rx="8" fill="#1a4a1a"/>
    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <circle cx="${W/2}" cy="${H/2}" r="35" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <rect x="${W*.25}" y="4" width="${W*.5}" height="${H*.15}" rx="3" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
    <rect x="${W*.25}" y="${H*.85-4}" width="${W*.5}" height="${H*.15}" rx="3" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
    ${chemLines}
    ${nodes}
  </svg>`;
}

// ── Render team panels (interactive) ──────────
function renderTeamPanel(containerId, players, teamKey, chemPairs) {
  const container = document.getElementById(containerId);
  const captainId = teamKey==="A" ? captainA : captainB;
  const ROLE_ORDER = ["portiere","difensore","centrocampista","attaccante"];

  const listHtml = players
    .slice()
    .sort((a,b)=>ROLE_ORDER.indexOf(a.assignedRole)-ROLE_ORDER.indexOf(b.assignedRole))
    .map(p=>{
      const f=FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
      const diffRole=p.ruoloPreferito!==p.assignedRole;
      const isCap=p.id===captainId;
      const isLocked=lockedPlayerIds.has(p.id)||isCap;
      const isSelected=selectedForSwap?.player.id===p.id;
      return `<div class="team-player-card ${diffRole?"team-player-card--diff":""} ${isCap?"is-captain":""} ${isLocked?"locked":""} ${isSelected?"selected":""}"
          data-player-id="${p.id}" data-team="${teamKey}"
          draggable="${!isLocked}">
        <span class="tpc-assigned-role">${ROLE_ICON[p.assignedRole]||"❓"}</span>
        <div class="tpc-info">
          <span class="tpc-name">${p.nickname}${isCap?` <span style="font-size:.75rem">🏅</span>`:""}</span>
          <span class="tpc-role-label">${p.assignedRole}${diffRole?` <span style="color:var(--warning)">(pref. ${p.ruoloPreferito})</span>`:""}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.15rem">
          <span class="tpc-ovr-assigned">${p.assignedRoleOVR}</span>
          <span class="forma-badge ${FORMA_CLS[p.formaAttuale]}" style="font-size:.62rem;padding:.1rem .35rem">${f.label}</span>
        </div>
        <button class="lock-btn ${isLocked?"locked":""}" data-player-id="${p.id}" title="${isLocked?"Sblocca":"Blocca"} giocatore">
          ${isLocked?"🔒":"🔓"}
        </button>
      </div>`;
    }).join("");

  let chemHtml = "";
  if (chemPairs?.length) {
    chemHtml = `<div class="chem-pairs-block">
      <div class="chem-pairs-title">🤝 Intesa</div>
      ${chemPairs.map(c=>{
        const stars="★".repeat(c.level)+"☆".repeat(4-c.level);
        const cls=c.level>=3?"chem-pair--high":c.level===2?"chem-pair--mid":"chem-pair--low";
        return `<div class="chem-pair ${cls}">
          <span>${c.a} ↔ ${c.b}</span>
          <span>${stars} <span class="chem-bonus">+${c.bonus}</span></span>
        </div>`;
      }).join("")}
    </div>`;
  }

  container.innerHTML = `
    <div class="formation-wrap">${renderFormationSVG(players, teamKey, chemPairs, captainId)}</div>
    <div class="team-list-side">${listHtml}${chemHtml}</div>`;

  // Lock buttons
  container.querySelectorAll(".lock-btn").forEach(btn=>{
    btn.addEventListener("click", e=>{
      e.stopPropagation();
      const pid=btn.dataset.playerId;
      const isCap=(captainA===pid||captainB===pid);
      if(isCap){ showToast("I capitani sono sempre bloccati.","error"); return; }
      if(lockedPlayerIds.has(pid)) lockedPlayerIds.delete(pid); else lockedPlayerIds.add(pid);
      renderBothPanels();
    });
  });

  // Click to select for swap
  container.querySelectorAll(".team-player-card").forEach(card=>{
    card.addEventListener("click", e=>{
      if(e.target.classList.contains("lock-btn")) return;
      const pid   = card.dataset.playerId;
      const tKey  = card.dataset.team;
      const player= tKey==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid);
      if(!player) return;
      handleCardClick(player, tKey, card);
    });

    // Drag & drop
    card.addEventListener("dragstart", e=>{
      const pid = card.dataset.playerId;
      if(lockedPlayerIds.has(pid)||captainA===pid||captainB===pid){ e.preventDefault(); return; }
      dragSource={ player: card.dataset.team==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid), team: card.dataset.team };
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed="move";
    });
    card.addEventListener("dragend",  ()=>{ card.classList.remove("dragging"); dragSource=null; });
    card.addEventListener("dragover", e=>{ e.preventDefault(); if(dragSource&&dragSource.team!==card.dataset.team) card.classList.add("drag-over"); });
    card.addEventListener("dragleave",()=>card.classList.remove("drag-over"));
    card.addEventListener("drop", e=>{
      e.preventDefault();
      card.classList.remove("drag-over");
      if(!dragSource) return;
      const pid   = card.dataset.playerId;
      const tKey  = card.dataset.team;
      if(dragSource.team===tKey) return;
      const target= tKey==="A" ? teamA.find(p=>p.id===pid) : teamB.find(p=>p.id===pid);
      if(!target) return;
      attemptSwap(dragSource.player, dragSource.team, target, tKey);
    });
  });
}

function renderBothPanels() {
  renderTeamPanel("team-a-panel", teamA, "A", chemistryA);
  renderTeamPanel("team-b-panel", teamB, "B", chemistryB);
  const strA=computeStrength(teamA,chemistryA);
  const strB=computeStrength(teamB,chemistryB);
  updateBalanceUI(strA, strB, false);
  computeSuggestions();
}

// ── Swap logic ────────────────────────────────
function handleCardClick(player, team, card) {
  if(!selectedForSwap) {
    // First selection
    if(lockedPlayerIds.has(player.id)&&captainA!==player.id&&captainB!==player.id) {
      showToast("Giocatore bloccato 🔒", "error"); return;
    }
    // Captains can be selected but will prompt
    selectedForSwap = { player, team };
    swapSelectedInfo.textContent = `✓ ${player.nickname} (Squadra ${team})`;
    swapActionBar.classList.remove("hidden");
    renderBothPanels();
  } else {
    // Second selection
    if(selectedForSwap.player.id === player.id) {
      // Deselect
      cancelSwap(); return;
    }
    if(selectedForSwap.team === team) {
      // Same team: re-select
      selectedForSwap = { player, team };
      swapSelectedInfo.textContent = `✓ ${player.nickname} (Squadra ${team})`;
      renderBothPanels(); return;
    }
    // Cross-team: execute swap
    attemptSwap(selectedForSwap.player, selectedForSwap.team, player, team);
  }
}

function attemptSwap(playerFrom, teamFrom, playerTo, teamTo) {
  const fromIsCap = captainA===playerFrom.id||captainB===playerFrom.id;
  const toIsCap   = captainA===playerTo.id  ||captainB===playerTo.id;

  if(fromIsCap||toIsCap) {
    // Show confirm dialog
    captainConfirmText.textContent = fromIsCap
      ? `"${playerFrom.nickname}" è il capitano. Sei sicuro di voler procedere con lo scambio?`
      : `"${playerTo.nickname}" è il capitano. Sei sicuro di voler procedere con lo scambio?`;
    captainConfirmOverlay.classList.remove("hidden");
    pendingSwapFn = ()=>executeSwap(playerFrom, teamFrom, playerTo, teamTo);
  } else {
    executeSwap(playerFrom, teamFrom, playerTo, teamTo);
  }
}

function executeSwap(playerFrom, teamFrom, playerTo, teamTo) {
  const prevStrA=computeStrength(teamA,chemistryA);
  const prevStrB=computeStrength(teamB,chemistryB);

  // Swap in arrays
  if(teamFrom==="A") {
    const idxA=teamA.findIndex(p=>p.id===playerFrom.id);
    const idxB=teamB.findIndex(p=>p.id===playerTo.id);
    if(idxA===-1||idxB===-1) return;
    [teamA[idxA], teamB[idxB]] = [teamB[idxB], teamA[idxA]];
  } else {
    const idxB=teamB.findIndex(p=>p.id===playerFrom.id);
    const idxA=teamA.findIndex(p=>p.id===playerTo.id);
    if(idxA===-1||idxB===-1) return;
    [teamA[idxA], teamB[idxB]] = [teamB[idxB], teamA[idxA]];
  }

  // Update captain assignment if captain was swapped
  if(captainA===playerFrom.id) captainA=playerFrom.id; // stays same player, just new team
  if(captainB===playerFrom.id) captainB=playerFrom.id;

  // Refilter chem pairs
  chemistryA = filterChemPairs([...chemistryA,...chemistryB], teamA);
  chemistryB = filterChemPairs([...chemistryA,...chemistryB], teamB);

  cancelSwap();
  renderBothPanels();

  const newStrA=computeStrength(teamA,chemistryA);
  const newStrB=computeStrength(teamB,chemistryB);
  updateBalanceUI(newStrA, newStrB, true);

  showToast(`⇄ ${playerFrom.nickname} ↔ ${playerTo.nickname}`);
  // Save to sessionStorage
  saveTeamsToSession();
}

function cancelSwap() {
  selectedForSwap = null;
  swapActionBar.classList.add("hidden");
  renderBothPanels();
}

// ── Smart suggestions ─────────────────────────
function computeSuggestions() {
  if(!teamA.length||!teamB.length) return;
  const curStrA=computeStrength(teamA,chemistryA);
  const curStrB=computeStrength(teamB,chemistryB);
  const curDiff=Math.abs(curStrA-curStrB);

  const candidates=[];
  for(const pA of teamA) {
    if(lockedPlayerIds.has(pA.id)) continue;
    for(const pB of teamB) {
      if(lockedPlayerIds.has(pB.id)) continue;
      // Simulate swap
      const newA=[...teamA.filter(p=>p.id!==pA.id),pB];
      const newB=[...teamB.filter(p=>p.id!==pB.id),pA];
      const sA=newA.reduce((s,p)=>s+effectiveOVR(p),0);
      const sB=newB.reduce((s,p)=>s+effectiveOVR(p),0);
      const newDiff=Math.abs(sA-sB);
      const improvement=curDiff-newDiff;
      if(improvement>0.5) candidates.push({ pA, pB, improvement, newDiff });
    }
  }

  candidates.sort((a,b)=>b.improvement-a.improvement);
  const top=candidates.slice(0,3);

  if(!top.length) { suggestionsPanel.classList.add("hidden"); return; }

  suggestionsPanel.classList.remove("hidden");
  suggestionsList.innerHTML=top.map((c,i)=>`
    <div class="suggestion-item" data-pa="${c.pA.id}" data-pb="${c.pB.id}">
      <span style="font-size:1rem">💡</span>
      <span class="suggestion-item__text">
        Scambia <strong>${c.pA.nickname}</strong> (A) con <strong>${c.pB.nickname}</strong> (B)
      </span>
      <span class="suggestion-item__delta suggestion-item__delta--pos">↑ −${c.improvement.toFixed(1)} Δ</span>
      <button class="btn btn--secondary btn--sm" data-pa="${c.pA.id}" data-pb="${c.pB.id}">Applica</button>
    </div>`).join("");

  suggestionsList.querySelectorAll("[data-pa]").forEach(el=>{
    el.addEventListener("click", e=>{
      e.stopPropagation();
      const paId=el.dataset.pa, pbId=el.dataset.pb;
      const pA=teamA.find(p=>p.id===paId), pB=teamB.find(p=>p.id===pbId);
      if(pA&&pB) attemptSwap(pA,"A",pB,"B");
    });
  });
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
  if(checkedIds.size<10||checkedIds.size%2!==0) return;
  btnGenerate.disabled=true; btnGenerate.textContent="⏳ Ottimizzazione…";
  prevStrA=null; prevStrB=null;

  try {
    const body = { playerIds:[...checkedIds] };
    if(captainA) body.captainA=captainA;
    if(captainB) body.captainB=captainB;

    const result = await fetch("/match",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());
    if(result.error) throw new Error(result.error);

    teamA=[...result.teamA]; teamB=[...result.teamB];
    origTeamA=[...result.teamA]; origTeamB=[...result.teamB];
    chemistryA=result.chemistryA||[]; chemistryB=result.chemistryB||[];
    lastResult=result;

    renderBothPanels();
    document.getElementById("sa-energy").textContent=`E = ${result.saEnergy}`;

    const strA=computeStrength(teamA,chemistryA);
    const strB=computeStrength(teamB,chemistryB);
    updateBalanceUI(strA, strB, false);

    teamsSection.classList.remove("hidden");
    teamsSection.scrollIntoView({behavior:"smooth"});
    saveTeamsToSession();
    showToast("Squadre generate! Modifica con drag&drop o selezione.");
  } catch(err){ showToast(err.message,"error"); }
  finally {
    const n=checkedIds.size;
    btnGenerate.disabled=false;
    btnGenerate.textContent=n>=10&&n%2===0?`⚡ Genera (${n/2}v${n/2})`:"⚡ Genera Squadre";
  }
}

// ── Event listeners ───────────────────────────
btnGenerate.addEventListener("click", generate);

document.getElementById("btn-regen").addEventListener("click", generate);

document.getElementById("btn-reset-teams").addEventListener("click", ()=>{
  if(!origTeamA.length) return;
  teamA=[...origTeamA]; teamB=[...origTeamB];
  chemistryA=lastResult.chemistryA||[]; chemistryB=lastResult.chemistryB||[];
  lockedPlayerIds.clear();
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
  // 1. Filtriamo i giocatori (escludiamo solo gli infortunati)
  const availablePlayers = allPlayers.filter(p => p.formaAttuale !== "infortunato");

  if (availablePlayers.length === 0) {
    showToast("Nessun giocatore disponibile!", "error");
    return;
  }

  // 2. Puliamo la selezione precedente
  checkedIds.clear();
  captainA = null;
  captainB = null;

  // 3. Ordiniamo per partite giocate (decrescente).
  // Mettiamo un limite di 10 (o il numero massimo che vuoi pre-selezionare).
  // Se ce ne sono di meno (es. 4), prenderà semplicemente quelli.
  const topPlayers = availablePlayers
    .sort((a, b) => b.storico.partite - a.storico.partite)
    .slice(0, 10); 

  // 4. Aggiungiamo i giocatori trovati alla selezione
  topPlayers.forEach(p => checkedIds.add(p.id));

  // 5. Aggiorniamo l'interfaccia
  renderCaptainSlot("a", null); 
  renderCaptainSlot("b", null);
  renderList(); 
  updateCounter();
  
  showToast(`${topPlayers.length} giocatori auto-selezionati!`);
});

searchInput.addEventListener("input", renderList);

// Captain confirm modal
captainConfirmCancel.addEventListener("click",()=>{
  captainConfirmOverlay.classList.add("hidden");
  pendingSwapFn=null;
  cancelSwap();
});
captainConfirmOk.addEventListener("click",()=>{
  captainConfirmOverlay.classList.add("hidden");
  if(pendingSwapFn){ pendingSwapFn(); pendingSwapFn=null; }
});

// ── Init ──────────────────────────────────────
async function loadPlayers() {
  try {
    allPlayers=await fetch("/players").then(r=>r.json());
    renderList(); updateCounter();
    renderCaptainSlot("a",null); renderCaptainSlot("b",null);
  } catch(err){ showToast(err.message,"error"); }
}
loadPlayers();
