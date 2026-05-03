/**
 * report.js – Report partita con dettaglio e modifica storico
 */
import { PlayersAPI, MatchesAPI, SuggestionsAPI } from "./api.js";
import { generateSuggestions } from "./chemistry-browser.js";
import { requireAuth } from "./auth.js";

requireAuth();

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const STAT_KEYS   = ["velocita","tiro","passaggio","difesa","fisico","dribbling"];
const VALID_ROLES = ["portiere","difensore","centrocampista","attaccante"];
const ROLE_WEIGHTS = {
  portiere:       { velocita:.10, tiro:.05, passaggio:.15, difesa:.45, fisico:.20, dribbling:.05 },
  difensore:      { velocita:.15, tiro:.05, passaggio:.15, difesa:.35, fisico:.20, dribbling:.10 },
  centrocampista: { velocita:.15, tiro:.15, passaggio:.25, difesa:.15, fisico:.15, dribbling:.15 },
  attaccante:     { velocita:.20, tiro:.30, passaggio:.10, difesa:.05, fisico:.15, dribbling:.20 },
};

const clamp        = v => Math.min(10, Math.max(0, Math.round(v * 10) / 10));
const calcRoleOVR  = (stats, r) => Math.round(STAT_KEYS.reduce((s,k) => s + ROLE_WEIGHTS[r][k] * (stats[k]??0), 0) * 10) / 10;
const calcAllOVR   = stats => Object.fromEntries(VALID_ROLES.map(r => [r, calcRoleOVR(stats, r)]));

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const btnLoadTeams        = document.getElementById("btn-load-teams");
const btnManualSetup      = document.getElementById("btn-manual-setup");
const playerSelectSection = document.getElementById("player-select-section");
const teamASelect         = document.getElementById("team-a-select");
const teamBSelect         = document.getElementById("team-b-select");
const btnConfirmTeams     = document.getElementById("btn-confirm-teams");
const reportForm          = document.getElementById("report-form");
const scoreAInput         = document.getElementById("score-a");
const scoreBInput         = document.getElementById("score-b");
const ratingsSection      = document.getElementById("ratings-section");
const btnSubmitReport     = document.getElementById("btn-submit-report");
const toast               = document.getElementById("toast");
const historyList         = document.getElementById("history-list");

// Detail overlay
const overlay             = document.getElementById("match-detail-overlay");
const detailContent       = document.getElementById("detail-content");
const detailScoreA        = document.getElementById("detail-score-a-display");
const detailScoreB        = document.getElementById("detail-score-b-display");
const detailDate          = document.getElementById("detail-date");
const editingBanner       = document.getElementById("editing-banner");
const btnEditMatch        = document.getElementById("btn-edit-match");
const btnSaveMatch        = document.getElementById("btn-save-match");
const btnCancelEdit       = document.getElementById("btn-cancel-edit");
const btnCloseDetail      = document.getElementById("btn-close-detail");

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let teamA       = [];
let teamB       = [];
let allPlayers  = [];
let allMatches  = [];
let activeMatch = null;   // match currently shown in overlay
let isEditing   = false;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3200);
}

const ROLE_ICON = { portiere:"🧤", difensore:"🛡️", centrocampista:"🔵", attaccante:"⚽" };

function getRoleIcon(role) { return ROLE_ICON[role] || "❓"; }

function getPlayerById(id) { return allPlayers.find(p => p.id === id); }

function voteClass(v) {
  if (v > 7.5) return "high";
  if (v < 5)   return "low";
  return "";
}

// ─────────────────────────────────────────────
// New report – ratings form
// ─────────────────────────────────────────────
function renderRatingsSection() {
  if (!teamA.length && !teamB.length) {
    ratingsSection.innerHTML = `<p class="empty-state">Seleziona i giocatori prima.</p>`;
    return;
  }

  const makeTeamBlock = (players, label) => `
    <div class="ratings-team">
      <h4 class="ratings-team__title">${label}</h4>
      ${players.map(p => {
        const player = typeof p === "object" ? p : getPlayerById(p);
        if (!player) return "";
        return `
        <div class="rating-row" data-id="${player.id}">
          <span class="rating-icon">${getRoleIcon(player.ruoloPreferito)}</span>
          <span class="rating-name">${player.nickname || player.name}</span>
          <label class="rating-field">Voto
            <input type="number" class="input input--sm rating-input"
              data-player="${player.id}" min="1" max="10" step="0.5" placeholder="1–10" required/>
          </label>
          <label class="rating-field">⚽ Goal
            <input type="number" class="input input--sm goal-input"
              data-player="${player.id}" min="0" value="0"/>
          </label>
          <label class="rating-field">🎯 Assist
            <input type="number" class="input input--sm assist-input"
              data-player="${player.id}" min="0" value="0"/>
          </label>
        </div>`;
      }).join("")}
    </div>`;

  ratingsSection.innerHTML =
    makeTeamBlock(teamA, "🔵 Squadra A") +
    makeTeamBlock(teamB, "🔴 Squadra B");
}

// ─────────────────────────────────────────────
// History list
// ─────────────────────────────────────────────
async function loadHistory() {
  try {
    allMatches = await MatchesAPI.getAll();

    if (!allMatches.length) {
      historyList.innerHTML = `<p class="empty-state">Nessuna partita registrata.</p>`;
      return;
    }

    historyList.innerHTML = allMatches.map(m => {
      const scoreA  = m.score_a ?? m.scoreA;
      const scoreB  = m.score_b ?? m.scoreB;
      const teamA   = m.team_a  ?? m.teamA ?? [];
      const teamB   = m.team_b  ?? m.teamB ?? [];
      const total   = teamA.length + teamB.length;
      const dateStr = new Date(m.date ?? m.created_at).toLocaleDateString("it-IT", {
        day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit",
      });

      return `
      <div class="card history-card" data-match-id="${m.id}" onclick="openMatchDetail('${m.id}')">
        <div class="history-card__score">
          <span>🔵 ${scoreA}</span>
          <span class="history-card__vs">–</span>
          <span>${scoreB} 🔴</span>
        </div>
        <div class="history-card__meta">${dateStr} · ${total} giocatori</div>
      </div>`;
    }).join("");

  } catch {
    historyList.innerHTML = `<p class="empty-state">Errore nel caricamento.</p>`;
  }
}

// ─────────────────────────────────────────────
// Match detail overlay — VIEW mode
// ─────────────────────────────────────────────
window.openMatchDetail = function(matchId) {
  const match = allMatches.find(m => m.id === matchId);
  if (!match) return;

  activeMatch  = match;
  isEditing    = false;

  const scoreA = match.score_a ?? match.scoreA;
  const scoreB = match.score_b ?? match.scoreB;

  detailScoreA.textContent = scoreA;
  detailScoreB.textContent = scoreB;
  detailDate.textContent   = new Date(match.date ?? match.created_at).toLocaleDateString("it-IT", {
    weekday:"long", day:"2-digit", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit",
  });

  renderDetailContent(match, false);
  setEditingUI(false);
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

function renderDetailContent(match, editing) {
  const teamAIds = match.team_a ?? match.teamA ?? [];
  const teamBIds = match.team_b ?? match.teamB ?? [];
  const ratings  = match.ratings  || {};
  const goals    = match.goals    || {};
  const assists  = match.assists  || {};

  const makeTeamSection = (ids, label) => {
    if (!ids.length) return "";
    return `
    <div class="detail-team-title">${label}</div>
    ${ids.map(id => {
      const p    = getPlayerById(id);
      const nick = p ? (p.nickname || p.name) : id.slice(0,8)+"…";
      const icon = p ? getRoleIcon(p.ruoloPreferito) : "❓";
      const vote = Number(ratings[id]) || 0;
      const g    = Number(goals[id])   || 0;
      const a    = Number(assists[id]) || 0;

      if (editing) {
        return `
        <div class="detail-player-row">
          <span>${icon}</span>
          <span class="detail-player-nick">${nick}</span>
          <div class="detail-stat">
            <span class="detail-stat__label">Voto</span>
            <input class="detail-input edit-rating" data-player="${id}"
              type="number" min="1" max="10" step="0.5" value="${vote || ""}"/>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__label">⚽ Goal</span>
            <input class="detail-input edit-goal" data-player="${id}"
              type="number" min="0" value="${g}"/>
          </div>
          <div class="detail-stat">
            <span class="detail-stat__label">🎯 Assist</span>
            <input class="detail-input edit-assist" data-player="${id}"
              type="number" min="0" value="${a}"/>
          </div>
        </div>`;
      }

      return `
      <div class="detail-player-row">
        <span>${icon}</span>
        <span class="detail-player-nick">${nick}</span>
        <div class="detail-stat">
          <span class="detail-stat__label">Voto</span>
          <span class="detail-stat__value detail-stat__value--vote ${voteClass(vote)}">${vote || "–"}</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat__label">⚽ Goal</span>
          <span class="detail-stat__value">${g}</span>
        </div>
        <div class="detail-stat">
          <span class="detail-stat__label">🎯 Assist</span>
          <span class="detail-stat__value">${a}</span>
        </div>
      </div>`;
    }).join("")}`;
  };

  // Score inputs in edit mode
  const scoreSection = editing ? `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
      <span style="font-weight:700">🏆 Risultato</span>
      <div style="display:flex;align-items:center;gap:.75rem">
        <input class="detail-input" id="edit-score-a" type="number" min="0"
          value="${match.score_a ?? match.scoreA ?? 0}" style="width:60px;font-size:1.2rem;font-weight:800"/>
        <span style="color:var(--text-muted);font-weight:700">–</span>
        <input class="detail-input" id="edit-score-b" type="number" min="0"
          value="${match.score_b ?? match.scoreB ?? 0}" style="width:60px;font-size:1.2rem;font-weight:800"/>
      </div>
    </div>` : "";

  detailContent.innerHTML =
    scoreSection +
    makeTeamSection(teamAIds, "🔵 Squadra A") +
    makeTeamSection(teamBIds, "🔴 Squadra B");
}

// ─────────────────────────────────────────────
// Match detail overlay — EDIT mode
// ─────────────────────────────────────────────
function setEditingUI(editing) {
  isEditing = editing;
  editingBanner.classList.toggle("show", editing);
  btnEditMatch.classList.toggle("hidden", editing);
  btnSaveMatch.classList.toggle("hidden", !editing);
  btnCancelEdit.classList.toggle("hidden", !editing);
}

btnEditMatch.addEventListener("click", () => {
  renderDetailContent(activeMatch, true);
  setEditingUI(true);
});

btnCancelEdit.addEventListener("click", () => {
  renderDetailContent(activeMatch, false);
  setEditingUI(false);
});

btnSaveMatch.addEventListener("click", async () => {
  if (!confirm("Sei sicuro di voler modificare questa partita?\n\nAttenzione: le statistiche dei giocatori verranno ricalcolate.")) return;

  // Collect edited values
  const newRatings = {}, newGoals = {}, newAssists = {};
  let valid = true;

  document.querySelectorAll(".edit-rating").forEach(input => {
    const id  = input.dataset.player;
    const val = Number(input.value);
    if (!val || val < 1 || val > 10) { input.style.borderColor = "var(--danger)"; valid = false; }
    else { input.style.borderColor = ""; newRatings[id] = val; }
  });
  document.querySelectorAll(".edit-goal").forEach(input => {
    newGoals[input.dataset.player] = Number(input.value) || 0;
  });
  document.querySelectorAll(".edit-assist").forEach(input => {
    newAssists[input.dataset.player] = Number(input.value) || 0;
  });

  if (!valid) { showToast("Controlla i voti (1–10).", "error"); return; }

  const newScoreA = Number(document.getElementById("edit-score-a")?.value ?? (activeMatch.score_a ?? activeMatch.scoreA));
  const newScoreB = Number(document.getElementById("edit-score-b")?.value ?? (activeMatch.score_b ?? activeMatch.scoreB));

  btnSaveMatch.disabled    = true;
  btnSaveMatch.textContent = "Salvataggio…";

  try {
    await saveMatchEdit(activeMatch, newScoreA, newScoreB, newRatings, newGoals, newAssists);

    // Update local state
    activeMatch.score_a  = newScoreA;
    activeMatch.score_b  = newScoreB;
    activeMatch.ratings  = newRatings;
    activeMatch.goals    = newGoals;
    activeMatch.assists  = newAssists;

    detailScoreA.textContent = newScoreA;
    detailScoreB.textContent = newScoreB;

    renderDetailContent(activeMatch, false);
    setEditingUI(false);
    showToast("Partita aggiornata!");
    await loadHistory();
  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btnSaveMatch.disabled    = false;
    btnSaveMatch.textContent = "💾 Salva modifiche";
  }
});

// ─────────────────────────────────────────────
// Save match edit — core logic
// Stats diff: reverse old effect, apply new effect
// ─────────────────────────────────────────────
async function saveMatchEdit(match, newScoreA, newScoreB, newRatings, newGoals, newAssists) {
  const oldRatings = match.ratings  || {};
  const oldGoals   = match.goals    || {};
  const oldAssists = match.assists  || {};
  const allIds     = [...(match.team_a ?? match.teamA ?? []), ...(match.team_b ?? match.teamB ?? [])];

  const players = await PlayersAPI.getAll();
  const updates = [];

  for (const pid of allIds) {
    const player = players.find(p => p.id === pid);
    if (!player) continue;

    const oldRating = Number(oldRatings[pid]) || 0;
    const newRating = Number(newRatings[pid])  || 0;
    if (!newRating) continue;

    let newStats   = { ...player.stats };
    let newStorico = { ...player.storico };

    // Reverse old stat effect
    let oldDelta = 0;
    if (oldRating > 7.5) oldDelta = 0.2; else if (oldRating < 5) oldDelta = -0.2;
    if (oldDelta !== 0) {
      for (const k of STAT_KEYS)
        newStats[k] = clamp(newStats[k] - oldDelta);
    }

    // Apply new stat effect
    let newDelta = 0;
    if (newRating > 7.5) newDelta = 0.2; else if (newRating < 5) newDelta = -0.2;
    if (newDelta !== 0) {
      for (const k of STAT_KEYS)
        newStats[k] = clamp(newStats[k] + newDelta);
    }

    // Fix goals/assists in storico
    newStorico.goal   = Math.max(0, (newStorico.goal   - (Number(oldGoals[pid])   || 0)) + (Number(newGoals[pid])   || 0));
    newStorico.assist = Math.max(0, (newStorico.assist - (Number(oldAssists[pid]) || 0)) + (Number(newAssists[pid]) || 0));

    // Recalculate mediaVoto: remove old, add new
    // mediaVoto = (old_avg * partite - old_rating + new_rating) / partite
    const partite = newStorico.partite || 1;
    const oldAvg  = newStorico.mediaVoto || 0;
    newStorico.mediaVoto = Math.round(
      ((oldAvg * partite - oldRating + newRating) / partite) * 10
    ) / 10;

    updates.push({
      id:     pid,
      stats:  newStats,
      ovr:    calcAllOVR(newStats),
      storico: newStorico,
    });
  }

  // Update match record in Supabase
  const { db, check } = await import("./supabase-client.js");
  check(await db.from("matches").update({
    score_a:  newScoreA,
    score_b:  newScoreB,
    ratings:  newRatings,
    goals:    newGoals,
    assists:  newAssists,
  }).eq("id", match.id));

  // Update all players
  await Promise.all(updates.map(u =>
    db.from("players").update({
      stats:  u.stats,
      ovr:    u.ovr,
      storico: u.storico,
    }).eq("id", u.id)
  ));
}

// ─────────────────────────────────────────────
// Close overlay
// ─────────────────────────────────────────────
btnCloseDetail.addEventListener("click", closeDetail);
overlay.addEventListener("click", e => { if (e.target === overlay) closeDetail(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeDetail(); });

function closeDetail() {
  if (isEditing && !confirm("Hai modifiche non salvate. Uscire?")) return;
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
  activeMatch = null;
  isEditing   = false;
}

// ─────────────────────────────────────────────
// New report — team selection
// ─────────────────────────────────────────────
function populateMultiSelects(players) {
  const opts = players
    .sort((a,b) => (b.ovr[b.ruoloPreferito]||0) - (a.ovr[a.ruoloPreferito]||0))
    .map(p => {
      const ovr = p.ovr[p.ruoloPreferito] || 0;
      return `<option value="${p.id}">${p.nickname||p.name} (${p.ruoloPreferito}, OVR ${ovr})</option>`;
    }).join("");
  teamASelect.innerHTML = opts;
  teamBSelect.innerHTML = opts;
}

btnManualSetup.addEventListener("click", () => {
  playerSelectSection.classList.toggle("hidden");
});

btnConfirmTeams.addEventListener("click", () => {
  const selectedA = [...teamASelect.selectedOptions].map(o => o.value);
  const selectedB = [...teamBSelect.selectedOptions].map(o => o.value);

  if (!selectedA.length || !selectedB.length) {
    showToast("Seleziona almeno un giocatore per squadra.", "error"); return;
  }
  if (selectedA.filter(id => selectedB.includes(id)).length) {
    showToast("Un giocatore non può essere in entrambe le squadre.", "error"); return;
  }

  teamA = selectedA.map(id => getPlayerById(id)).filter(Boolean);
  teamB = selectedB.map(id => getPlayerById(id)).filter(Boolean);
  playerSelectSection.classList.add("hidden");
  renderRatingsSection();
  reportForm.classList.remove("hidden");
  showToast("Squadre configurate.");
});

btnLoadTeams.addEventListener("click", () => {
  const stored = sessionStorage.getItem("lastTeams");
  if (!stored) { showToast("Nessuna squadra generata. Vai al Matchmaker.", "error"); return; }
  const { teamA: rawA, teamB: rawB } = JSON.parse(stored);
  teamA = rawA.map(p => getPlayerById(p.id) ?? p).filter(Boolean);
  teamB = rawB.map(p => getPlayerById(p.id) ?? p).filter(Boolean);
  renderRatingsSection();
  reportForm.classList.remove("hidden");
  showToast("Squadre caricate dal Matchmaker.");
});

// ─────────────────────────────────────────────
// Submit new report
// ─────────────────────────────────────────────
btnSubmitReport.addEventListener("click", async () => {
  const scoreA = Number(scoreAInput.value);
  const scoreB = Number(scoreBInput.value);
  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    showToast("Inserisci un risultato valido.", "error"); return;
  }

  const ratings = {}, goals = {}, assists = {};
  let valid = true;

  document.querySelectorAll(".rating-input").forEach(input => {
    const val = Number(input.value);
    if (!val || val < 1 || val > 10) { input.classList.add("input--error"); valid = false; }
    else { input.classList.remove("input--error"); ratings[input.dataset.player] = val; }
  });
  document.querySelectorAll(".goal-input").forEach(input => {
    goals[input.dataset.player] = Number(input.value) || 0;
  });
  document.querySelectorAll(".assist-input").forEach(input => {
    assists[input.dataset.player] = Number(input.value) || 0;
  });

  if (!valid) { showToast("Compila tutti i voti (1–10).", "error"); return; }

  btnSubmitReport.disabled    = true;
  btnSubmitReport.textContent = "Salvataggio…";

  try {
    const { db, check } = await import("./supabase-client.js");
    const allIds = [...teamA, ...teamB].map(p => p.id);

    // Update each player's stats and storico
    for (const p of [...teamA, ...teamB]) {
      const rating = Number(ratings[p.id]);
      const { partite: pp, mediaVoto: pm } = p.storico;
      const np = pp + 1;

      const newStorico = {
        partite:   np,
        goal:      p.storico.goal   + (Number(goals[p.id])   || 0),
        assist:    p.storico.assist + (Number(assists[p.id]) || 0),
        mediaVoto: Math.round(((pm * pp + rating) / np) * 10) / 10,
      };

      let newStats = { ...p.stats };
      let delta = 0;
      if (rating > 7.5) delta = 0.2; else if (rating < 5) delta = -0.2;
      if (delta !== 0) {
        for (const k of STAT_KEYS) newStats[k] = clamp(newStats[k] + delta);
      }
      const newIsUnknown = p.isUnknown && np >= 3 ? false : p.isUnknown;

      // Auto-forma from last 2 matches
      const recentMatches = allMatches.slice(0, 2);
      const votes = recentMatches
        .filter(m => [...(m.team_a||[]), ...(m.team_b||[])].includes(p.id))
        .map(m => Number(m.ratings?.[p.id]))
        .filter(Boolean);
      votes.push(rating);
      const avg = votes.reduce((s,v) => s+v, 0) / votes.length;
      const formaAttuale = avg >= 7.5 ? "in_forma" : avg < 5 ? "scarsa_forma" : "normale";

      check(await db.from("players").update({
        stats: newStats, ovr: calcAllOVR(newStats),
        storico: newStorico, is_unknown: newIsUnknown, forma_attuale: formaAttuale,
      }).eq("id", p.id));

      // Update local state too
      p.stats = newStats; p.ovr = calcAllOVR(newStats);
      p.storico = newStorico; p.isUnknown = newIsUnknown; p.formaAttuale = formaAttuale;
    }

    // Save match record
    const matchRecord = {
      id:      crypto.randomUUID(),
      date:    new Date().toISOString(),
      score_a: scoreA, score_b: scoreB,
      team_a:  teamA.map(p => p.id),
      team_b:  teamB.map(p => p.id),
      ratings, goals, assists,
    };
    check(await db.from("matches").insert(matchRecord));

    // Chemistry suggestions
    const { ChemistryAPI } = await import("./api.js");
    const [chemMap, existingSuggs] = await Promise.all([
      ChemistryAPI.getMap(),
      db.from("suggestions").select("*").then(r => check(r)),
    ]);
    const matchesForSugg = [matchRecord, ...allMatches.slice(0,19)].map(m => ({
      team_a: m.team_a ?? m.teamA ?? [],
      team_b: m.team_b ?? m.teamB ?? [],
      ratings: m.ratings || {},
    }));
    const existingPlain = existingSuggs.map(s => ({
      idA: s.id_a, idB: s.id_b, suggestedLevel: s.suggested_level, status: s.status,
    }));
    const newSuggs = generateSuggestions(matchesForSugg, chemMap, existingPlain, allPlayers);
    if (newSuggs.length) {
      await SuggestionsAPI.insertMany(newSuggs);
    }

    showToast(`Report salvato!${newSuggs.length ? ` ${newSuggs.length} suggerimenti intesa generati.` : ""}`);
    reportForm.classList.add("hidden");
    teamA = []; teamB = [];
    scoreAInput.value = "0"; scoreBInput.value = "0";
    sessionStorage.removeItem("lastTeams");
    await Promise.all([PlayersAPI.getAll().then(p => allPlayers = p), loadHistory()]);

  } catch(err) {
    showToast(err.message, "error");
  } finally {
    btnSubmitReport.disabled    = false;
    btnSubmitReport.textContent = "💾 Salva Report";
  }
});

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
async function init() {
  try {
    allPlayers = await PlayersAPI.getAll();
    populateMultiSelects(allPlayers);
  } catch(err) {
    showToast(err.message, "error");
  }
  await loadHistory();
}

init();
