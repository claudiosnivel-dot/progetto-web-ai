import { assertProductionEnv } from '@/config/env';

// (deploy pass) T-2 — HOOK DI STARTUP di Next.js. `register()` gira UNA volta all'avvio
// del server. Sul DEPLOY DI PRODUZIONE VERCEL valida la config critica al BOOT
// (assertProductionEnv): se manca una variabile essenziale (chiavi Supabase,
// ANTHROPIC_API_KEY, NEXT_PUBLIC_SITE_URL https pubblica, SIGNUP_ALLOWLIST) l'errore emerge
// SUBITO e in chiaro, non a meta' di una richiesta.
//
// SI GATE SU `VERCEL_ENV === 'production'`, NON su NODE_ENV. Motivo: `next start` in locale
// (e l'end-to-end) gira comunque in NODE_ENV=production ma NON e' un deploy reale e non deve
// esigere la config di produzione — gatare su NODE_ENV romperebbe ogni run locale in modalita'
// produzione. `VERCEL_ENV` e' impostata dalla PIATTAFORMA sul deploy Vercel di produzione (il
// founder non puo' dimenticarla), quindi il check scatta ESATTAMENTE dove serve — il deploy
// pubblico — e non altrove. Cambiando host un domani, questo e' il punto da adeguare.
export function register(): void {
  if (process.env.VERCEL_ENV === 'production') {
    assertProductionEnv();
  }
}
