import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// T-240 (macrotask generation-e2e, P2) — carica .env.local in process.env per i processi
// Node dell'end-to-end: il globalSetup (che provisiona l'utente e cattura i cookie) e i
// worker degli spec (che seminano via service_role). L'APPLICAZIONE sotto test lo carica da
// sola (`next start`); questo modulo serve al CODICE DI TEST che costruisce i client Supabase
// da env, ed e' importato da tutti quei moduli cosi' che ogni processo lo veda. Rispecchia
// tests/setup.env.ts: stesse variabili (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL), stessa politica del "mai sovrascrivere cio' che
// e' gia' nell'ambiente". Anchor su process.cwd() (radice del repo) invece di import.meta.url:
// il loader di Playwright tratta questi file come CommonJS. Se .env.local non c'e', le variabili
// restano assenti e il globalSetup fallira' in modo dichiarato invece di produrre un verde finto.

const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim();
    }
  }
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
