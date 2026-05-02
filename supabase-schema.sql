-- ═══════════════════════════════════════════════════════
--  FantaCalcetto Manager – Supabase SQL Schema
--  Esegui questo script nel SQL Editor di Supabase
--  (supabase.com → tuo progetto → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════

-- ── Players ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  nickname            TEXT NOT NULL,
  ruolo_preferito     TEXT CHECK (ruolo_preferito IN ('portiere','difensore','centrocampista','attaccante')),
  is_unknown          BOOLEAN DEFAULT false,
  livello             TEXT,
  forma_attuale       TEXT DEFAULT 'normale',
  presente            BOOLEAN DEFAULT false,
  ovr                 JSONB NOT NULL DEFAULT '{}',
  stats               JSONB NOT NULL DEFAULT '{}',
  spirito_sacrificio  INTEGER CHECK (spirito_sacrificio BETWEEN 1 AND 10),
  storico             JSONB NOT NULL DEFAULT '{"partite":0,"goal":0,"assist":0,"mediaVoto":0}',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── Matches ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  score_a     INTEGER NOT NULL,
  score_b     INTEGER NOT NULL,
  team_a      TEXT[]  NOT NULL DEFAULT '{}',
  team_b      TEXT[]  NOT NULL DEFAULT '{}',
  ratings     JSONB   NOT NULL DEFAULT '{}',
  goals       JSONB   NOT NULL DEFAULT '{}',
  assists     JSONB   NOT NULL DEFAULT '{}'
);

-- ── Chemistry pairs ───────────────────────────────────
-- key = "smallerId:largerId"  (always sorted so A:B = B:A)
CREATE TABLE IF NOT EXISTS chemistry (
  key    TEXT PRIMARY KEY,
  level  INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4)
);

-- ── Chemistry suggestions ─────────────────────────────
CREATE TABLE IF NOT EXISTS suggestions (
  id              TEXT PRIMARY KEY,
  id_a            TEXT NOT NULL,
  id_b            TEXT NOT NULL,
  nickname_a      TEXT NOT NULL,
  nickname_b      TEXT NOT NULL,
  current_level   INTEGER,
  suggested_level INTEGER,
  reason          TEXT,
  games_together  INTEGER DEFAULT 0,
  games_against   INTEGER DEFAULT 0,
  created_at      TEXT,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed'))
);

-- ── Row Level Security: disabilita (il server usa service key) ──
ALTER TABLE players     DISABLE ROW LEVEL SECURITY;
ALTER TABLE matches     DISABLE ROW LEVEL SECURITY;
ALTER TABLE chemistry   DISABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions DISABLE ROW LEVEL SECURITY;
