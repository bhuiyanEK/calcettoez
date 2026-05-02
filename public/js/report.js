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
const toast = document.getElementById("toast");
const historyList = document.getElementById("history-list");

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
let teamA = [];
let teamB = [];
let allPlayers = [];

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
  return allPlayers.find((p) => p.id === id);
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
            <span class="rating-icon">${getRoleIcon(player.role)}</span>
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
    if (matches.length === 0) {
      historyList.innerHTML = `<p class="empty-state">Nessuna partita registrata.</p>`;
      return;
    }

    historyList.innerHTML = matches
      .slice()
      .reverse()
      .map((m) => {
        const date = new Date(m.date).toLocaleDateString("it-IT", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `
        <div class="card history-card">
          <div class="history-card__score">
            <span>🔵 ${m.scoreA}</span>
            <span class="history-card__vs">–</span>
            <span>${m.scoreB} 🔴</span>
          </div>
          <div class="history-card__date">${date}</div>
        </div>`;
      })
      .join("");
  } catch (err) {
    historyList.innerHTML = `<p class="empty-state">Errore nel caricamento.</p>`;
  }
}

// ─────────────────────────────────────────────
// Team selection (manual)
// ─────────────────────────────────────────────
function populateMultiSelects(players) {
  const opts = players
    .sort((a, b) => b.ovr - a.ovr)
    .map((p) => `<option value="${p.id}">${p.name} (${p.role}, OVR ${p.ovr})</option>`)
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

  const { teamA: rawA, teamB: rawB } = JSON.parse(stored);

  // Enrich with full player data from allPlayers
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
// Submit report
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

  btnSubmitReport.disabled = true;
  btnSubmitReport.textContent = "Salvataggio...";

  try {
    await ReportAPI.save(payload);
    showToast("Report salvato! Statistiche aggiornate.");
    reportForm.classList.add("hidden");
    teamA = [];
    teamB = [];
    sessionStorage.removeItem("lastTeams");
    await loadHistory();
  } catch (err) {
    showToast(err.message, "error");
  } finally {
    btnSubmitReport.disabled = false;
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
  } catch (err) {
    showToast(err.message, "error");
  }
  await loadHistory();
}

init();
