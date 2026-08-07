import { assertProductionEnv } from '@/config/env';

// (deploy pass) — HOOK DI STARTUP di Next.js. `register()` gira UNA volta all'avvio
// del server (Node runtime e, se presente, edge). In PRODUZIONE valida la config
// critica al BOOT (assertProductionEnv): se manca una variabile essenziale
// (chiavi Supabase, ANTHROPIC_API_KEY, NEXT_PUBLIC_SITE_URL https pubblica,
// SIGNUP_ALLOWLIST) l'errore emerge SUBITO e in chiaro, non a meta' di una richiesta.
// In sviluppo non si valida (bastano i default locali, come loadEnv): il boot locale
// non deve esigere una config di produzione.
export function register(): void {
  if (process.env.NODE_ENV === 'production') {
    assertProductionEnv();
  }
}
