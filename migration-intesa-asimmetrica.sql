-- ═══════════════════════════════════════════════════════
--  Migrazione: intesa asimmetrica
--  Prima: una riga per coppia, key = "idMinore:idMaggiore" (simmetrica)
--  Ora:   una riga per direzione, key = "da:a" = livello che `da` assegna ad `a`
--
--  Esegui UNA SOLA VOLTA nel SQL Editor di Supabase.
--  Duplica ogni riga esistente nella direzione opposta, così i dati attuali
--  restano invariati per entrambi i giocatori della coppia.
-- ═══════════════════════════════════════════════════════
INSERT INTO chemistry (key, level)
SELECT split_part(key, ':', 2) || ':' || split_part(key, ':', 1), level
FROM chemistry
ON CONFLICT (key) DO NOTHING;
