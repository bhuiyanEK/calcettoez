/**
 * sa-matchmaker.js
 * Simulated Annealing team balancer with chemistry constraints.
 *
 * Model:
 *   E(x) = |S(A) - S(B)| + M * violations(x) + γ * separation_penalty(x)
 *
 * Neighbourhood: swap one player from each team (preserves team sizes).
 * Incremental ΔE evaluation: O(n) per move instead of O(n²).
 */

"use strict";

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
const CHEMISTRY_BONUS = { 0: 0, 1: 0.3, 2: 0.8, 3: 2.0, 4: 3.5 };
const M     = 100;    // hard-constraint penalty weight
const GAMMA = 1.5;    // soft-constraint penalty weight (keep high-intesa together)
const HIGH_INTESA_THRESHOLD = 3;
const LOW_INTESA_LEVEL      = 1;
const MAX_LOW_INTESA_PAIRS  = 2;

// SA schedule
const T0    = 10.0;   // initial temperature
const ALPHA = 0.97;   // cooling rate
const STEPS = 180;    // temperature steps
const ITER_PER_STEP_FACTOR = 4; // iterations = factor * n

// ─────────────────────────────────────────────
// Chemistry helpers
// ─────────────────────────────────────────────
function chemKey(idA, idB) {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

function getChem(chemMap, idA, idB) {
  return chemMap[chemKey(idA, idB)] ?? 0;
}

// ─────────────────────────────────────────────
// Team quality (full recompute — used once at init)
// ─────────────────────────────────────────────
function teamStrength(team, ovrFn, chemMap) {
  const base  = team.reduce((s, p) => s + ovrFn(p), 0);
  let   bonus = 0;
  for (let i = 0; i < team.length; i++)
    for (let j = i + 1; j < team.length; j++)
      bonus += CHEMISTRY_BONUS[getChem(chemMap, team[i].id, team[j].id)];
  return base + bonus;
}

function lowIntesaCount(team, chemMap) {
  let count = 0;
  for (let i = 0; i < team.length; i++)
    for (let j = i + 1; j < team.length; j++)
      if (getChem(chemMap, team[i].id, team[j].id) === LOW_INTESA_LEVEL) count++;
  return count;
}

function separationPenalty(team, otherTeam, chemMap) {
  // Penalty for each high-intesa pair split across teams
  let pen = 0;
  for (const p of team)
    for (const q of otherTeam) {
      const c = getChem(chemMap, p.id, q.id);
      if (c >= HIGH_INTESA_THRESHOLD) pen += CHEMISTRY_BONUS[c];
    }
  return pen;
}

function energy(sA, sB, lowA, lowB, sepPenalty) {
  const balance   = Math.abs(sA - sB);
  const violation = Math.max(0, lowA - MAX_LOW_INTESA_PAIRS)
                  + Math.max(0, lowB - MAX_LOW_INTESA_PAIRS);
  return balance + M * violation + GAMMA * sepPenalty;
}

// ─────────────────────────────────────────────
// Incremental delta when swapping player iA (in A) with iB (in B)
// Returns { dsA, dsB, dLowA, dLowB, dSep }
// ─────────────────────────────────────────────
function deltaSwap(teamA, teamB, iA, iB, ovrFn, chemMap) {
  const pA = teamA[iA]; // leaving A, entering B
  const pB = teamB[iB]; // leaving B, entering A

  const ovrA = ovrFn(pA), ovrB = ovrFn(pB);

  // Base OVR delta
  let dsA = -ovrA + ovrB;   // A loses pA, gains pB
  let dsB = -ovrB + ovrA;   // B loses pB, gains pA

  // Chemistry bonus delta for team A
  let dBonusA = 0, dLowA = 0;
  for (let k = 0; k < teamA.length; k++) {
    if (k === iA) continue;
    const other = teamA[k];
    const cOld = getChem(chemMap, pA.id, other.id);
    const cNew = getChem(chemMap, pB.id, other.id);
    dBonusA += CHEMISTRY_BONUS[cNew] - CHEMISTRY_BONUS[cOld];
    if (cOld === LOW_INTESA_LEVEL) dLowA--;
    if (cNew === LOW_INTESA_LEVEL) dLowA++;
  }
  dsA += dBonusA;

  // Chemistry bonus delta for team B
  let dBonusB = 0, dLowB = 0;
  for (let k = 0; k < teamB.length; k++) {
    if (k === iB) continue;
    const other = teamB[k];
    const cOld = getChem(chemMap, pB.id, other.id);
    const cNew = getChem(chemMap, pA.id, other.id);
    dBonusB += CHEMISTRY_BONUS[cNew] - CHEMISTRY_BONUS[cOld];
    if (cOld === LOW_INTESA_LEVEL) dLowB--;
    if (cNew === LOW_INTESA_LEVEL) dLowB++;
  }
  dsB += dBonusB;

  // Cross-pair chemistry change between pA and pB themselves
  // pA moves A→B: now in same team as pB (was opposite)
  // pB moves B→A: now in same team as pA (was opposite)
  const cAB = getChem(chemMap, pA.id, pB.id);
  dsA += -CHEMISTRY_BONUS[cAB]; // pB was not in A; now it is, but so was pA—now pA is gone. Net: they swap.
  dsB += -CHEMISTRY_BONUS[cAB]; // same logic for B

  // Separation penalty delta: pairs (pA, q) where q is in B and pA moves to B
  // Before: pA in A, each q in B → cross-pair (penalised if high intesa)
  // After:  pA in B, each q in B → same team (no longer penalised)
  // Similarly pB moves from B to A.
  let dSep = 0;
  for (let k = 0; k < teamB.length; k++) {
    if (k === iB) continue;
    const c = getChem(chemMap, pA.id, teamB[k].id);
    if (c >= HIGH_INTESA_THRESHOLD) dSep -= CHEMISTRY_BONUS[c]; // resolved
  }
  for (let k = 0; k < teamA.length; k++) {
    if (k === iA) continue;
    const c = getChem(chemMap, pB.id, teamA[k].id);
    if (c >= HIGH_INTESA_THRESHOLD) dSep -= CHEMISTRY_BONUS[c]; // resolved
  }
  // New separations: pA leaves A (now pA might be separated from A members)
  for (let k = 0; k < teamA.length; k++) {
    if (k === iA) continue;
    const c = getChem(chemMap, pA.id, teamA[k].id);
    if (c >= HIGH_INTESA_THRESHOLD) dSep += CHEMISTRY_BONUS[c]; // new separation
  }
  // pB leaves B
  for (let k = 0; k < teamB.length; k++) {
    if (k === iB) continue;
    const c = getChem(chemMap, pB.id, teamB[k].id);
    if (c >= HIGH_INTESA_THRESHOLD) dSep += CHEMISTRY_BONUS[c];
  }

  return { dsA, dsB, dLowA, dLowB, dSep };
}

// ─────────────────────────────────────────────
// Simulated Annealing
// ─────────────────────────────────────────────
function simulatedAnnealing(players, ovrFn, chemMap) {
  const n = players.length;
  const k = n / 2;

  // ── Seeded initial solution: greedy by avgOVR ──
  const sorted  = [...players].sort((a, b) => ovrFn(b) - ovrFn(a));
  let teamA = [], teamB = [];
  for (const p of sorted) {
    const sA = teamA.reduce((s, q) => s + ovrFn(q), 0);
    const sB = teamB.reduce((s, q) => s + ovrFn(q), 0);
    (teamA.length < k && (teamB.length >= k || sA <= sB) ? teamA : teamB).push(p);
  }

  // ── Initial state ──
  let sA   = teamStrength(teamA, ovrFn, chemMap);
  let sB   = teamStrength(teamB, ovrFn, chemMap);
  let lowA = lowIntesaCount(teamA, chemMap);
  let lowB = lowIntesaCount(teamB, chemMap);
  let sep  = separationPenalty(teamA, teamB, chemMap);
  let E    = energy(sA, sB, lowA, lowB, sep);

  let bestE    = E;
  let bestA    = [...teamA];
  let bestB    = [...teamB];

  let T        = T0;
  const ITERS  = Math.max(50, ITER_PER_STEP_FACTOR * n * n);

  for (let step = 0; step < STEPS; step++) {
    for (let iter = 0; iter < ITERS; iter++) {
      // Pick random swap
      const iA = Math.floor(Math.random() * k);
      const iB = Math.floor(Math.random() * k);

      const { dsA, dsB, dLowA, dLowB, dSep } =
        deltaSwap(teamA, teamB, iA, iB, ovrFn, chemMap);

      const newE = energy(sA + dsA, sB + dsB,
                          lowA + dLowA, lowB + dLowB,
                          sep + dSep);
      const dE   = newE - E;

      if (dE < 0 || Math.random() < Math.exp(-dE / T)) {
        // Accept move
        [teamA[iA], teamB[iB]] = [teamB[iB], teamA[iA]];
        sA   += dsA;  sB   += dsB;
        lowA += dLowA; lowB += dLowB;
        sep  += dSep;
        E     = newE;

        if (E < bestE) {
          bestE = E;
          bestA = [...teamA];
          bestB = [...teamB];
        }
      }
    }
    T *= ALPHA;
  }

  return { teamA: bestA, teamB: bestB, energy: bestE };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────
module.exports = { simulatedAnnealing, teamStrength, getChem, chemKey, CHEMISTRY_BONUS };
