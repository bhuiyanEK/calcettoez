/**
 * home.js – Mini-classifiche (Top 3) calcolate dallo storico dei Report Partita.
 * Metriche: capocannoniere, miglior assistman, voto medio più alto.
 * Periodo: stagione intera (set–ago) oppure singolo mese.
 */
import { PlayersAPI, ReportAPI } from "./api.js";

// ── Config ─────────────────────────────────────
const METRICS = {
  goals:   { label: "Capocannoniere",   title: "Capocannoniere",   unit: "gol"    },
  assists: { label: "Assistman",        title: "Miglior Assistman", unit: "assist" },
  rating:  { label: "Voto medio",       title: "Voto medio più alto", unit: ""     },
};
const MEDALS = ["1", "2", "3"];
const MIN_GAMES_RATING = { season: 3, month: 2 };   // soglia anti "10 in una sola partita"
const MONTHS_IT = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];

// ── State ──────────────────────────────────────
let players = [];
let matches = [];
let mode    = "season";   // "season" | "month"
let period  = null;       // "2025" (anno d'inizio stagione) | "2025-10"
let metric  = "goals";

// ── DOM ────────────────────────────────────────
const elTabs   = document.getElementById("lb-tabs");
const elMode   = document.getElementById("lb-mode");
const elPeriod = document.getElementById("lb-period");
const elList   = document.getElementById("lb-list");
const elNote   = document.getElementById("lb-note");

// ── Helpers ────────────────────────────────────
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const seasonStart = d => (d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1);   // la stagione parte a settembre
const seasonLabel = y => `Stagione ${y}/${String((y + 1) % 100).padStart(2, "0")}`;
const monthKey    = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel  = k => { const [y, m] = k.split("-"); return `${MONTHS_IT[Number(m) - 1]} ${y}`; };

/** Voto di una partita: media di difesa/attacco/porta (porta esclusa se assente); supporta il formato legacy numerico */
function matchRating(r) {
  if (typeof r === "number") return r;
  if (!r || typeof r !== "object") return null;
  const vals = [r.difesa, r.attacco, r.porta]
    .filter(v => v !== null && v !== undefined && !isNaN(Number(v)))
    .map(Number);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);

function periodOptions() {
  const keys = new Set(matches.map(m => {
    const d = new Date(m.date);
    return mode === "season" ? String(seasonStart(d)) : monthKey(d);
  }));
  return [...keys].sort().reverse();
}

function inPeriod(m) {
  const d = new Date(m.date);
  return mode === "season" ? String(seasonStart(d)) === period : monthKey(d) === period;
}

// ── Stats ──────────────────────────────────────
function computeStats() {
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const acc  = {};
  for (const m of matches.filter(inPeriod)) {
    for (const id of [...(m.team_a || []), ...(m.team_b || [])]) {
      if (!byId[id]) continue;   // giocatore eliminato
      const s = (acc[id] ??= { player: byId[id], games: 0, goals: 0, assists: 0, voteSum: 0, votes: 0 });
      s.games++;
      s.goals   += Number(m.goals?.[id])   || 0;
      s.assists += Number(m.assists?.[id]) || 0;
      const v = matchRating(m.ratings?.[id]);
      if (v !== null) { s.voteSum += v; s.votes++; }
    }
  }
  return Object.values(acc);
}

function ranking(stats) {
  if (metric === "rating") {
    const maxGames = Math.max(0, ...stats.map(s => s.votes));
    const minGames = Math.min(MIN_GAMES_RATING[mode], maxGames);
    const rows = stats
      .filter(s => s.votes >= minGames && s.votes > 0)
      .map(s => ({ ...s, value: s.voteSum / s.votes }))
      .sort((a, b) => b.value - a.value || b.games - a.games);
    return { rows: rows.slice(0, 3), minGames };
  }
  const rows = stats
    .filter(s => s[metric] > 0)
    .map(s => ({ ...s, value: s[metric] }))
    .sort((a, b) => b.value - a.value || a.games - b.games);   // a parità, chi ha giocato meno
  return { rows: rows.slice(0, 3), minGames: 0 };
}

// ── Render ─────────────────────────────────────
function renderControls() {
  elTabs.querySelectorAll("button").forEach(b => {
    const on = b.dataset.metric === metric;
    b.classList.toggle("seg__btn--active", on);
    b.setAttribute("aria-selected", on);
  });
  elMode.querySelectorAll("button").forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle("seg__btn--active", on);
    b.setAttribute("aria-pressed", on);
  });

  const opts = periodOptions();
  if (!opts.includes(period)) period = opts[0] ?? null;
  elPeriod.innerHTML = opts.map(k =>
    `<option value="${k}" ${k === period ? "selected" : ""}>${mode === "season" ? seasonLabel(Number(k)) : monthLabel(k)}</option>`
  ).join("");
  elPeriod.disabled = !opts.length;
}

function render() {
  renderControls();

  if (!matches.length || period === null) {
    elList.innerHTML = `<p class="empty-state">Nessuna partita registrata. Compila un <a href="/report.html">report partita</a> per vedere le classifiche.</p>`;
    elNote.textContent = "";
    return;
  }

  const { rows, minGames } = ranking(computeStats());
  const m = METRICS[metric];

  elNote.textContent = metric === "rating"
    ? `Minimo ${minGames} ${minGames === 1 ? "partita" : "partite"} nel periodo`
    : "";

  if (!rows.length) {
    elList.innerHTML = `<p class="empty-state">Nessun dato per questo periodo.</p>`;
    return;
  }

  elList.innerHTML = rows.map((r, i) => {
    const value = metric === "rating" ? fmt(r.value) : r.value;
    const sub = metric === "rating"
      ? `${r.votes} ${r.votes === 1 ? "partita" : "partite"}`
      : `${r.games} ${r.games === 1 ? "partita" : "partite"} · ${(r.value / r.games).toFixed(2)} a partita`;
    return `
    <div class="lb-row lb-row--${i + 1}">
      <span class="lb-row__medal" aria-label="${i + 1}° posto">${MEDALS[i]}</span>
      <div class="lb-row__who">
        <div class="lb-row__nick">${esc(r.player.nickname)}</div>
        <div class="lb-row__sub">${sub}</div>
      </div>
      <div class="lb-row__value">${value}<small>${m.unit}</small></div>
    </div>`;
  }).join("");
}

// ── Events ─────────────────────────────────────
elTabs.addEventListener("click", e => {
  const b = e.target.closest("button[data-metric]");
  if (!b) return;
  metric = b.dataset.metric;
  render();
});

elMode.addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]");
  if (!b || b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  period = null;
  render();
});

elPeriod.addEventListener("change", () => { period = elPeriod.value; render(); });

// ── Init ───────────────────────────────────────
(async function init() {
  try {
    [players, matches] = await Promise.all([PlayersAPI.getAll(), ReportAPI.getHistory()]);
    render();
  } catch (err) {
    elList.innerHTML = `<p class="empty-state">Impossibile caricare le classifiche: ${esc(err.message)}</p>`;
  }
})();
