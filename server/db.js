/**
 * db.js – Supabase client singleton
 * Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from environment.
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../env.env") });

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("❌  SUPABASE_URL e SUPABASE_SERVICE_KEY sono obbligatori.");
  console.error("    Copia .env.example in .env e compila i valori.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

module.exports = supabase;
