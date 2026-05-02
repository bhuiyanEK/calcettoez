/**
 * chemistry-engine.js
 * Generates chemistry suggestions after each match report.
 *
 * Rules:
 *  - Teammates: players in same team → tendency to increase chemistry
 *  - Opponents: players in opposite teams → suggests level 2 if lower
 *  - Both performed poorly together (avg vote < 5) → suggests decrease
 *  - Triggers after every match; deduplicates against existing suggestions
 */
"use strict";

const TEAMMATE_THRESHOLDS = [
  // { gamesTogethers: N, suggestLevel: L, reason }
  { games: 1, level: 3, reason: "Hanno giocato insieme per la prima volta" },
  { games: 3, level: 4, reason: "Hanno giocato insieme 3+ volte" },
];
const OPPONENT_LEVEL   = 2;
const POOR_PERFORMANCE = 5.0; // avg vote below this → suggest decrease

function chemKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

/**
 * Build co-occurrence counts from match history.
 * Returns { "idA:idB": { together: N, against: N } }
 */
function buildCoOccurrence(matches) {
  const map = {};

  for (const match of matches) {
    const teamA = match.teamA || [];
    const teamB = match.teamB || [];

    // Teammates
    for (const team of [teamA, teamB]) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const k = chemKey(team[i], team[j]);
          if (!map[k]) map[k] = { together: 0, against: 0, avgVotesTogether: [] };
          map[k].together++;
          // Track average vote of the pair when together
          const va = Number(match.ratings?.[team[i]]) || 0;
          const vb = Number(match.ratings?.[team[j]]) || 0;
          if (va && vb) map[k].avgVotesTogether.push((va + vb) / 2);
        }
      }
    }

    // Opponents
    for (const pA of teamA) {
      for (const pB of teamB) {
        const k = chemKey(pA, pB);
        if (!map[k]) map[k] = { together: 0, against: 0, avgVotesTogether: [] };
        map[k].against++;
      }
    }
  }

  return map;
}

/**
 * Generate suggestions given current chemistry map and match history.
 * Returns array of suggestion objects (not already in existingSuggestions).
 */
function generateSuggestions(matches, currentChemistry, existingSuggestions, players) {
  const coOcc = buildCoOccurrence(matches);
  const playerMap = Object.fromEntries(players.map(p => [p.id, p]));
  const suggestions = [];
  const existingKeys = new Set(existingSuggestions.map(s => `${s.idA}:${s.idB}:${s.suggestedLevel}`));

  for (const [key, data] of Object.entries(coOcc)) {
    const [idA, idB] = key.split(":");
    if (!playerMap[idA] || !playerMap[idB]) continue;

    const currentLevel = currentChemistry[key] ?? 0;
    let suggestedLevel = currentLevel;
    let reason = null;

    // Teammates logic
    if (data.together > 0) {
      const avgVote = data.avgVotesTogether.length
        ? data.avgVotesTogether.reduce((s, v) => s + v, 0) / data.avgVotesTogether.length
        : null;

      // Find the highest applicable threshold
      for (const t of TEAMMATE_THRESHOLDS) {
        if (data.together >= t.games && t.level > suggestedLevel) {
          suggestedLevel = t.level;
          reason = t.reason;
        }
      }

      // Override: if they consistently performed poorly together → suggest decrease
      if (avgVote !== null && avgVote < POOR_PERFORMANCE && data.together >= 2) {
        const decreased = Math.max(0, currentLevel - 1);
        if (decreased < suggestedLevel) {
          suggestedLevel = decreased;
          reason = `Media voto bassa insieme (${avgVote.toFixed(1)}) — potrebbero non essere compatibili`;
        }
      }
    }

    // Opponents only (never played together)
    if (data.together === 0 && data.against >= 2 && currentLevel < OPPONENT_LEVEL) {
      suggestedLevel = OPPONENT_LEVEL;
      reason = `Hanno giocato ${data.against} volte come avversari`;
    }

    // Emit suggestion only if there's a real change
    if (suggestedLevel !== currentLevel && reason) {
      const dedupeKey = `${key}:${suggestedLevel}`;
      if (!existingKeys.has(dedupeKey)) {
        suggestions.push({
          id:             `sug-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          idA, idB,
          nicknameA:      playerMap[idA].nickname,
          nicknameB:      playerMap[idB].nickname,
          currentLevel,
          suggestedLevel,
          reason,
          gamesTogther:   data.together,
          gamesAgainst:   data.against,
          createdAt:      new Date().toISOString(),
          status:         "pending",   // pending | accepted | dismissed
        });
      }
    }
  }

  return suggestions;
}

module.exports = { generateSuggestions, buildCoOccurrence, chemKey };
