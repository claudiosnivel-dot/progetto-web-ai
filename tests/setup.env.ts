import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Setup di test: carica .env.local (se presente) in process.env, così i test che
// richiedono l'istanza Supabase locale trovano le connessioni. Se .env.local non
// esiste (es. CI senza DB), le variabili restano assenti e quei test si SKIPPANO
// in modo dichiarato (mai un verde finto).
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim();
    }
  }
}
