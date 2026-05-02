/**
 * matchmaker.js – con formazione grafica SVG
 */
import { PlayersAPI, MatchAPI } from "./api.js";

// ── DOM ──────────────────────────────────────
const searchInput        = document.getElementById("player-search");
const playerCheckboxList = document.getElementById("player-checkbox-list");
const btnGenerate        = document.getElementById("btn-generate");
const btnClearSel        = document.getElementById("btn-clear-sel");
const btnAutoSelect      = document.getElementById("btn-autoselect");
const selCount           = document.getElementById("sel-count");
const teamsSection       = document.getElementById("teams-section");
const toast              = document.getElementById("toast");

let allPlayers = [];
let checkedIds = new Set();

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

// ── Helpers ──────────────────────────────────
function showToast(msg, type="success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(()=>toast.classList.remove("toast--visible"),3000);
}

function updateCounter() {
  const n = checkedIds.size;
  selCount.textContent = `${n} selezionati`;
  const valid = n >= 10 && n % 2 === 0;
  selCount.className   = n===0?"":n>16?"counter--over":valid?"counter--ready":"counter--warn";
  btnGenerate.disabled = !valid;
  btnGenerate.textContent = valid ? `⚡ Genera (${n/2}v${n/2})` : "⚡ Genera Squadre";
}

async function handleFormaChange(playerId, forma) {
  try {
    await fetch(`/players/${playerId}`, {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ formaAttuale: forma }),
    });
    const p = allPlayers.find(p=>p.id===playerId);
    if (p) p.formaAttuale = forma;
    renderList();
  } catch(err){ showToast(err.message,"error"); }
}

// ── Render player list ────────────────────────
function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const filtered = allPlayers.filter(p =>
    !query || p.nickname.toLowerCase().includes(query) ||
    p.name.toLowerCase().includes(query) || p.ruoloPreferito.toLowerCase().includes(query)
  );
  if (!filtered.length) { playerCheckboxList.innerHTML=`<p class="empty-state">Nessun giocatore trovato.</p>`; return; }

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
    return `
    <div class="player-checkbox-item ${checkedIds.has(p.id)?"is-selected":""}" id="cb-item-${p.id}">
      <input type="checkbox" class="player-checkbox" id="cb-${p.id}" value="${p.id}"
        ${checkedIds.has(p.id)?"checked":""}/>
      <label for="cb-${p.id}" class="cb-label">
        <span class="checkbox-icon">${ROLE_ICON[p.ruoloPreferito]||"❓"}</span>
        <span class="checkbox-name">${p.nickname}
          ${p.isUnknown?`<span class="badge badge--unknown" style="font-size:.65rem">👤</span>`:""}
        </span>
        <span class="cb-partite">🏟️ ${p.storico.partite}</span>
        <span class="checkbox-ovr">${eff}${ds}</span>
      </label>
      <div class="forma-inline">
        <span class="forma-badge ${FORMA_CLS[p.formaAttuale]||"forma--grey"}" style="font-size:.72rem">${f.label}</span>
        <select class="forma-select input input--sm" data-player-id="${p.id}">
          ${FORMA_OPTIONS.map(o=>`<option value="${o.value}" ${o.value===p.formaAttuale?"selected":""}>${o.label}</option>`).join("")}
        </select>
      </div>
    </div>`;
  }).join("");

  playerCheckboxList.querySelectorAll(".player-checkbox").forEach(cb => {
    cb.addEventListener("change",()=>{
      if(cb.checked) checkedIds.add(cb.value); else checkedIds.delete(cb.value);
      document.getElementById(`cb-item-${cb.value}`)?.classList.toggle("is-selected",cb.checked);
      updateCounter();
    });
  });
  playerCheckboxList.querySelectorAll(".forma-select").forEach(sel =>
    sel.addEventListener("change",e=>handleFormaChange(e.target.dataset.playerId, e.target.value))
  );
}

// ─────────────────────────────────────────────
// Formation SVG renderer
// ─────────────────────────────────────────────
const FORMATION_POSITIONS = {
  // 5-a-side 1-1-2-1  (x% from left, y% from top of pitch)
  5: {
    portiere:       [[50, 88]],
    difensore:      [[50, 68]],
    centrocampista: [[28, 45], [72, 45]],
    attaccante:     [[50, 18]],
  },
  6: {
    portiere:       [[50, 88]],
    difensore:      [[28, 68],[72, 68]],
    centrocampista: [[28, 42],[72, 42]],
    attaccante:     [[50, 18]],
  },
  7: {
    portiere:       [[50, 88]],
    difensore:      [[22, 68],[50, 68],[78, 68]],
    centrocampista: [[28, 44],[72, 44]],
    attaccante:     [[28, 18],[72, 18]],
  },
  8: {
    portiere:       [[50, 88]],
    difensore:      [[20, 68],[50, 68],[80, 68]],
    centrocampista: [[20, 46],[50, 44],[80, 46]],
    attaccante:     [[28, 18],[72, 18]],
  },
};

function buildFormationSlots(players) {
  // group by assignedRole
  const byRole = {};
  for (const p of players) {
    const r = p.assignedRole || p.ruoloPreferito;
    if (!byRole[r]) byRole[r] = [];
    byRole[r].push(p);
  }
  const n = players.length;
  const pos = FORMATION_POSITIONS[n] || FORMATION_POSITIONS[5];
  const slots = [];
  for (const [role, positions] of Object.entries(pos)) {
    const rolePlayers = byRole[role] || [];
    positions.forEach(([x,y], i) => {
      slots.push({ x, y, player: rolePlayers[i] || null, role });
    });
  }
  return slots;
}

const TEAM_COLORS = { A: "#3d7eff", B: "#e74c3c" };

function renderFormationSVG(players, teamKey, chemPairs) {
  const W = 300, H = 420;
  const col = TEAM_COLORS[teamKey];
  const slots = buildFormationSlots(players);

  // Chemistry line pairs (only level ≥ 3)
  const chemLines = (chemPairs || [])
    .filter(c => c.level >= 3)
    .map(c => {
      const pA = players.find(p=>p.nickname===c.a);
      const pB = players.find(p=>p.nickname===c.b);
      if (!pA || !pB) return "";
      const sa = slots.find(s=>s.player?.id===pA.id);
      const sb = slots.find(s=>s.player?.id===pB.id);
      if (!sa || !sb) return "";
      const x1=sa.x*W/100, y1=sa.y*H/100, x2=sb.x*W/100, y2=sb.y*H/100;
      const opacity = c.level===4?"0.7":"0.4";
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${col}" stroke-width="${c.level===4?2:1.5}" stroke-dasharray="${c.level===4?"none":"4,3"}"
        stroke-opacity="${opacity}"/>`;
    }).join("");

  const nodes = slots.map(s => {
    const cx = s.x*W/100, cy = s.y*H/100;
    if (!s.player) {
      return `<circle cx="${cx}" cy="${cy}" r="18" fill="rgba(255,255,255,.05)" stroke="${col}" stroke-width="1" stroke-dasharray="4,3"/>`;
    }
    const p   = s.player;
    const nick = p.nickname.length > 7 ? p.nickname.slice(0,6)+"…" : p.nickname;
    const forma = { infortunato:"🩹",scarsa_forma:"😕",normale:"",in_forma:"💪",grande_forma:"🔥" }[p.formaAttuale]||"";
    return `
      <g class="formation-node">
        <circle cx="${cx}" cy="${cy}" r="22" fill="${col}" fill-opacity="0.85" stroke="white" stroke-width="1.5"/>
        <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle"
          font-size="10" font-weight="700" fill="white" font-family="Inter,sans-serif">${nick}</text>
        ${forma ? `<text x="${cx+14}" y="${cy-14}" font-size="11">${forma}</text>` : ""}
        <text x="${cx}" y="${cy+34}" text-anchor="middle" font-size="9" fill="rgba(255,255,255,.55)"
          font-family="Inter,sans-serif">${p.assignedRoleOVR ?? ""}</text>
      </g>`;
  }).join("");

  return `
  <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="formation-svg">
    <!-- Pitch -->
    <rect width="${W}" height="${H}" rx="8" fill="#1a4a1a"/>
    <!-- Centre line -->
    <line x1="0" y1="${H/2}" x2="${W}" y2="${H/2}" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <!-- Centre circle -->
    <circle cx="${W/2}" cy="${H/2}" r="35" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
    <!-- Penalty areas -->
    <rect x="${W*.25}" y="4" width="${W*.5}" height="${H*.15}" rx="3"
      fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
    <rect x="${W*.25}" y="${H*.85-4}" width="${W*.5}" height="${H*.15}" rx="3"
      fill="none" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
    <!-- Chemistry lines -->
    ${chemLines}
    <!-- Player nodes -->
    ${nodes}
  </svg>`;
}

// ── Render team panels ────────────────────────
function renderTeamPanel(containerId, players, teamKey, chemPairs) {
  const container = document.getElementById(containerId);

  const listHtml = players
    .slice()
    .sort((a,b) => {
      const order=["portiere","difensore","centrocampista","attaccante"];
      return order.indexOf(a.assignedRole)-order.indexOf(b.assignedRole);
    })
    .map(p => {
      const f=FORMA_OPTIONS.find(o=>o.value===p.formaAttuale)||FORMA_OPTIONS[2];
      const diffRole=p.ruoloPreferito!==p.assignedRole;
      return `<div class="team-player-card ${diffRole?"team-player-card--diff":""}">
        <span class="tpc-assigned-role">${ROLE_ICON[p.assignedRole]||"❓"}</span>
        <div class="tpc-info">
          <span class="tpc-name">${p.nickname}</span>
          <span class="tpc-role-label">${p.assignedRole}${diffRole?` <span style="color:var(--warning)">(pref. ${p.ruoloPreferito})</span>`:""}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.15rem">
          <span class="tpc-ovr-assigned">${p.assignedRoleOVR}</span>
          <span class="forma-badge ${FORMA_CLS[p.formaAttuale]}" style="font-size:.62rem;padding:.1rem .35rem">${f.label}</span>
        </div>
      </div>`;
    }).join("");

  let chemHtml = "";
  if (chemPairs?.length) {
    chemHtml = `<div class="chem-pairs-block"><div class="chem-pairs-title">🤝 Intesa</div>
    ${chemPairs.map(c=>{
      const stars="★".repeat(c.level)+"☆".repeat(4-c.level);
      const cls=c.level>=3?"chem-pair--high":c.level===2?"chem-pair--mid":"chem-pair--low";
      return `<div class="chem-pair ${cls}"><span>${c.a} ↔ ${c.b}</span><span>${stars} <span class="chem-bonus">+${c.bonus}</span></span></div>`;
    }).join("")}</div>`;
  }

  container.innerHTML = `
    <div class="formation-wrap">${renderFormationSVG(players, teamKey, chemPairs)}</div>
    <div class="team-list-side">${listHtml}${chemHtml}</div>`;
}

// ── Handlers ─────────────────────────────────
async function loadPlayers() {
  try {
    allPlayers = await fetch("/players").then(r=>r.json());
    renderList(); updateCounter();
  } catch(err){ showToast(err.message,"error"); }
}

btnGenerate.addEventListener("click", async () => {
  if (checkedIds.size<10||checkedIds.size%2!==0) return;
  btnGenerate.disabled=true; btnGenerate.textContent="⏳ Ottimizzazione…";
  try {
    const result = await fetch("/match",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerIds:[...checkedIds]})}).then(r=>r.json());
    if (result.error) throw new Error(result.error);

    renderTeamPanel("team-a-panel", result.teamA, "A", result.chemistryA);
    renderTeamPanel("team-b-panel", result.teamB, "B", result.chemistryB);

    document.getElementById("str-a").textContent = result.strengthA;
    document.getElementById("str-b").textContent = result.strengthB;
    const diff=Math.abs(result.strengthA-result.strengthB).toFixed(1);
    const diffEl=document.getElementById("ovr-diff");
    diffEl.textContent=`Δ forza: ${diff}`;
    diffEl.className=`ovr-diff ${Number(diff)<=5?"ovr-diff--ok":"ovr-diff--warn"}`;
    document.getElementById("sa-energy").textContent=`E = ${result.saEnergy}`;

    teamsSection.classList.remove("hidden");
    teamsSection.scrollIntoView({behavior:"smooth"});
    sessionStorage.setItem("lastTeams", JSON.stringify(result));
    showToast("Squadre generate!");
  } catch(err){ showToast(err.message,"error"); }
  finally {
    const n=checkedIds.size;
    btnGenerate.disabled=false;
    btnGenerate.textContent=n>=10&&n%2===0?`⚡ Genera (${n/2}v${n/2})`:"⚡ Genera Squadre";
  }
});

btnClearSel.addEventListener("click",()=>{
  checkedIds.clear(); renderList(); updateCounter();
  teamsSection.classList.add("hidden");
});

btnAutoSelect?.addEventListener("click", async () => {
  try {
    const res  = await fetch("/match/autoselect").then(r=>r.json());
    if (res.error) { showToast(res.error,"error"); return; }
    checkedIds = new Set(res.selected);
    renderList(); updateCounter();
    if (res.dropped?.length) showToast(`Selezionati ${res.count} giocatori. Esclusi: ${res.dropped.map(p=>p.nickname).join(", ")}`,"success");
    else showToast(`${res.count} giocatori presenti selezionati!`);
  } catch(err){ showToast(err.message,"error"); }
});

searchInput.addEventListener("input", renderList);
loadPlayers();
