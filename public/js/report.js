/**
 * report.js – Inserimento risultato e statistiche partita
 */
import { PlayersAPI, ReportAPI } from "./api.js";

// ─────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────
const btnLoadTeams = document.getElementById("btn-load-teams");
const btnManualSetup = document.getElementById("btn-manual-setup");
const playerSelectSection = document.getElementById("player-select-section");
const teamASelect = document.getElementById("team-a-select");
const teamBSelect = document.getElementById("team-b-select");
const btnConfirmTeams = document.getElementById("btn-confirm-teams");

const reportForm = document.getElementById("report-form");
const scoreAInput = document.getElementById("score-a");
const scoreBInput = document.getElementById("score-b");
const ratingsSection = document.getElementById("ratings-section");

const btnSubmitReport = document.getElementById("btn-submit-report");
const btnCancelEdit = document.getElementById("btn-cancel-edit");
const toast = document.getElementById("toast");
const historyList = document.getElementById("history-list");

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let teamA = [];
let teamB = [];
let allPlayers = [];
let matchHistory = []; // Salva lo storico in memoria
let editingMatchId = null; // Memorizza l'ID della partita in modifica

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function showToast(msg, type = "success") {
  toast.textContent = msg;
  toast.className = `toast toast--${type} toast--visible`;
  setTimeout(() => toast.classList.remove("toast--visible"), 3000);
}

function getRoleIcon(role) {
  const icons = { portiere: "🧤", difensore: "🛡️", attaccante: "⚽", jolly: "⭐" };
  return icons[role] || "❓";
}

function getPlayerById(id) {
  return allPlayers.find((p) => String(p.id) === String(id));
}

function resetForm() {
  reportForm.classList.add("hidden");
  teamA = [];
  teamB = [];
  editingMatchId = null;
  btnSubmitReport.textContent = "💾 Salva Report";
  btnCancelEdit.classList.add("hidden");
  sessionStorage.removeItem("lastTeams");
  scoreAInput.value = "0";
  scoreBInput.value = "0";
}

// ─────────────────────────────────────────────
// Render ratings rows
// ─────────────────────────────────────────────
function renderRatingsSection() {
  const allSelected = [...teamA, ...teamB];
  if (allSelected.length === 0) {
    ratingsSection.innerHTML = `<p class="empty-state">Seleziona i giocatori prima.</p>`;
    return;
  }

  const makeTeamBlock = (players, label, side) => `
    <div class="ratings-team">
      <h4 class="ratings-team__title">${label}</h4>
      ${players
        .map((p) => {
          const player = typeof p === "object" ? p : getPlayerById(p);
          if (!player) return "";
          return `
          <div class="rating-row" data-id="${player.id}">
            <span class="rating-icon">${getRoleIcon(player.ruoloPreferito)}</span>
            <span class="rating-name">${player.name}</span>
            <label class="rating-field">
              Voto
              <input
                type="number"
                class="input input--sm rating-input"
                data-field="rating"
                data-player="${player.id}"
                min="1" max="10" step="0.5"
                placeholder="1–10"
                required
              />
            </label>
            <label class="rating-field">
              ⚽ Goal
              <input
                type="number"
                class="input input--sm goal-input"
                data-field="goal"
                data-player="${player.id}"
                min="0" value="0"
              />
            </label>
            <label class="rating-field">
              🎯 Assist
              <input
                type="number"
                class="input input--sm assist-input"
                data-field="assist"
                data-player="${player.id}"
                min="0" value="0"
              />
            </label>
          </div>`;
        })
        .join("")}
    </div>`;

  ratingsSection.innerHTML =
    makeTeamBlock(teamA, "🔵 Squadra A", "a") +
    makeTeamBlock(teamB, "🔴 Squadra B", "b");
}

// ─────────────────────────────────────────────
// History
// ─────────────────────────────────────────────
async function loadHistory() {
  try {
    const matches = await ReportAPI.getHistory();
    matchHistory = matches; // Salviamo nello state

    if (matches.length === 0) {
      historyList.innerHTML = `<p class="empty-state">Nessuna partita registrata.</p>`;
      return;
    }

    historyList.innerHTML = matches
      .slice()
      .reverse()
      .map((m) => {
        const scoreA = m.scoreA ?? m.score_a ?? 0;
        const scoreB = m.scoreB ?? m.score_b ?? 0;
        const dateRaw = m.date ?? m.created_at;
        const matchId = m.id ?? m._id;

        const date = new Date(dateRaw).toLocaleDateString("it-IT", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        return `
        <div class="card history-card" data-match-id="${matchId}" title="Clicca per visualizzare/modificare">
          <div class="history-card__score">
            <span>🔵 ${scoreA}</span>
            <span class="history-card__vs">–</span>
            <span>${scoreB} 🔴</span>
          </div>
          <div class="history-card__date">${date}</div>
        </div>`;
      })
      .join("");

    // Aggiungiamo i listener per la modalità Edit
    document.querySelectorAll(".history-card").forEach((card) => {
      card.addEventListener("click", () => editMatch(card.dataset.matchId));
    });

  } catch (err) {
    historyList.innerHTML = `<p class="empty-state">Errore nel caricamento.</p>`;
  }
}

// ─────────────────────────────────────────────
// View / Edit Match
// ─────────────────────────────────────────────
function editMatch(matchId) {
  const match = matchHistory.find((m) => String(m.id ?? m._id) === String(matchId));
  if (!match) return;

  editingMatchId = match.id ?? match._id;

  // Normalizza chiavi in base a come API le restituisce (camelCase o snake_case)
  const mScoreA = match.scoreA ?? match.score_a ?? 0;
  const mScoreB = match.scoreB ?? match.score_b ?? 0;
  const mTeamA = match.teamA ?? match.team_a ?? [];
  const mTeamB = match.teamB ?? match.team_b ?? [];
  const mRatings = match.ratings ?? {};
  const mGoals = match.goals ?? {};
  const mAssists = match.assists ?? {};

  // Popoliamo il tabellone
  scoreAInput.value = mScoreA;
  scoreBInput.value = mScoreB;

  // Popoliamo le squadre (assumiamo che teamA sia un array di ID o oggetti con .id)
  teamA = mTeamA.map((p) => getPlayerById(p.id ?? p)).filter(Boolean);
  teamB = mTeamB.map((p) => getPlayerById(p.id ?? p)).filter(Boolean);

  renderRatingsSection();

  // Inseriamo i valori negli input appena generati
  document.querySelectorAll(".rating-input").forEach((input) => {
    const pid = input.dataset.player;
    if (mRatings[pid] !== undefined) input.value = mRatings[pid];
  });
  document.querySelectorAll(".goal-input").forEach((input) => {
    const pid = input.dataset.player;
    if (mGoals[pid] !== undefined) input.value = mGoals[pid];
  });
  document.querySelectorAll(".assist-input").forEach((input) => {
    const pid = input.dataset.player;
    if (mAssists[pid] !== undefined) input.value = mAssists[pid];
  });

  reportForm.classList.remove("hidden");
  btnSubmitReport.textContent = "🔄 Aggiorna Report";
  btnCancelEdit.classList.remove("hidden");
  
  // Scorri la pagina fino al form
  window.scrollTo({ top: reportForm.offsetTop - 50, behavior: "smooth" });
  showToast("Visualizzazione partita: puoi modificarla e aggiornare.");
}

btnCancelEdit.addEventListener("click", () => {
  resetForm();
  showToast("Modifica annullata.", "info");
});

// ─────────────────────────────────────────────
// Team selection (manual)
// ─────────────────────────────────────────────
function populateMultiSelects(players) {
  const opts = players
    .sort((a, b) => {
      const ovrA = a.ovr[a.ruoloPreferito] || 0;
      const ovrB = b.ovr[b.ruoloPreferito] || 0;
      return ovrB - ovrA;
    })
    .map((p) => {
      const playerOvr = p.ovr[p.ruoloPreferito] || 0;
      return `<option value="${p.id}">${p.name} (${p.ruoloPreferito}, OVR ${playerOvr})</option>`;
    })
    .join("");
    
  teamASelect.innerHTML = opts;
  teamBSelect.innerHTML = opts;
}

btnManualSetup.addEventListener("click", () => {
  playerSelectSection.classList.toggle("hidden");
});

btnConfirmTeams.addEventListener("click", () => {
  const selectedA = [...teamASelect.selectedOptions].map((o) => o.value);
  const selectedB = [...teamBSelect.selectedOptions].map((o) => o.value);

  if (selectedA.length !== 5 || selectedB.length !== 5) {
    showToast("Seleziona esattamente 5 giocatori per squadra.", "error");
    return;
  }

  const overlap = selectedA.filter((id) => selectedB.includes(id));
  if (overlap.length > 0) {
    showToast("Un giocatore non può essere in entrambe le squadre.", "error");
    return;
  }

  // Se stai impostando una nuova partita manualmente, esci dalla modalità modifica
  editingMatchId = null;
  btnSubmitReport.textContent = "💾 Salva Report";
  btnCancelEdit.classList.add("hidden");

  teamA = selectedA.map((id) => getPlayerById(id));
  teamB = selectedB.map((id) => getPlayerById(id));

  playerSelectSection.classList.add("hidden");
  renderRatingsSection();
  reportForm.classList.remove("hidden");
  showToast("Squadre configurate.");
});

// ─────────────────────────────────────────────
// Load teams from matchmaker (sessionStorage)
// ─────────────────────────────────────────────
btnLoadTeams.addEventListener("click", () => {
  const stored = sessionStorage.getItem("lastTeams");
  if (!stored) {
    showToast("Nessuna squadra generata. Vai al Matchmaker.", "error");
    return;
  }

  editingMatchId = null; // Usciamo dalla modalità edit
  btnSubmitReport.textContent = "💾 Salva Report";
  btnCancelEdit.classList.add("hidden");

  const { teamA: rawA, teamB: rawB } = JSON.parse(stored);

  teamA = rawA.map((p) => {
    const full = getPlayerById(p.id);
    return full ? { ...full, _goalkeeperSub: p._goalkeeperSub } : p;
  });
  teamB = rawB.map((p) => {
    const full = getPlayerById(p.id);
    return full ? { ...full, _goalkeeperSub: p._goalkeeperSub } : p;
  });

  renderRatingsSection();
  reportForm.classList.remove("hidden");
  showToast("Squadre caricate dal Matchmaker.");
});

// ─────────────────────────────────────────────
// Submit or Update report
// ─────────────────────────────────────────────
btnSubmitReport.addEventListener("click", async () => {
  const scoreA = Number(scoreAInput.value);
  const scoreB = Number(scoreBInput.value);

  if (isNaN(scoreA) || isNaN(scoreB) || scoreA < 0 || scoreB < 0) {
    showToast("Inserisci un risultato valido.", "error");
    return;
  }

  const ratings = {};
  const goals = {};
  const assists = {};
  let valid = true;

  document.querySelectorAll(".rating-input").forEach((input) => {
    const id = input.dataset.player;
    const val = Number(input.value);
    if (!val || val < 1 || val > 10) {
      input.classList.add("input--error");
      valid = false;
    } else {
      input.classList.remove("input--error");
      ratings[id] = val;
    }
  });

  document.querySelectorAll(".goal-input").forEach((input) => {
    goals[input.dataset.player] = Number(input.value) || 0;
  });

  document.querySelectorAll(".assist-input").forEach((input) => {
    assists[input.dataset.player] = Number(input.value) || 0;
  });

  if (!valid) {
    showToast("Compila tutti i voti (1–10) prima di salvare.", "error");
    return;
  }

  const payload = {
    scoreA,
    scoreB,
    teamA: teamA.map((p) => p.id),
    teamB: teamB.map((p) => p.id),
    ratings,
    goals,
    assists,
  };

  // Se stiamo modificando, chiedi conferma
  if (editingMatchId) {
    if (!confirm("Sei sicuro di voler modificare questa partita? Le statistiche storiche verranno ricalcolate.")) {
      return;
    }
  }

  btnSubmitReport.disabled = true;
  btnSubmitReport.textContent = "Salvataggio...";

  try {
    if (editingMatchId) {
      // Affinché funzioni, devi avere ReportAPI.update() nel tuo file api.js!
      if (typeof ReportAPI.update !== 'function') {
        throw new Error("Manca la funzione ReportAPI.update in api.js");
      }
      await ReportAPI.update(editingMatchId, payload);
      showToast("Report aggiornato con successo!");
    } else {
      await ReportAPI.save(payload);
      showToast("Report salvato! Statistiche aggiornate.");
    }
    
    resetForm();
    await loadHistory();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btnSubmitReport.disabled = false;
    btnSubmitReport.textContent = editingMatchId ? "🔄 Aggiorna Report" : "💾 Salva Report";
  }
});

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
async function init() {
  try {
    allPlayers = await PlayersAPI.getAll();
    populateMultiSelects(allPlayers);
  } catch (err) {
    showToast(err.message, "error");
  }
  await loadHistory();
}

init();
console.log("PLAYERS:", allPlayers);
