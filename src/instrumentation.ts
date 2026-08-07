import { assertProductionEnv } from '@/config/env';

// (deploy pass) T-2 — HOOK DI STARTUP di Next.js. `register()` gira UNA volta all'avvio
// del server. Sul DEPLOY VERCEL (production/preview) valida la config critica al BOOT
// (assertProductionEnv): se manca una variabile essenziale (chiavi Supabase, chiave Anthropic,
// URL pubblico del sito, allowlist dei signup) l'errore emerge SUBITO e in chiaro, non a meta'
// di una richiesta. I NOMI esatti delle variabili vivono solo in src/config/env.ts (accessor
// unici); qui si descrivono in prosa per non spargere il nome del segreto Anthropic nel sorgente.
//
// SI GATE SU `VERCEL_ENV` (production O preview), NON su NODE_ENV. Motivo: `next start` in
// locale (e l'end-to-end) gira comunque in NODE_ENV=production ma NON e' un deploy reale e non
// deve esigere la config di produzione — gatare su NODE_ENV romperebbe ogni run locale in
// modalita' produzione. `VERCEL_ENV` e' impostata dalla PIATTAFORMA (il founder non puo'
// dimenticarla). Si valida su ENTRAMBI 'production' e 'preview' perche' anche i deploy PREVIEW
// hanno un URL PUBBLICO raggiungibile: un preview pre-lancio senza SIGNUP_ALLOWLIST lascerebbe i
// signup email/password aperti (l'allowlist vuota apre in dev). Solo 'development' (vercel dev,
// locale) e' escluso. Cambiando host un domani, questo e' il punto da adeguare.
export function register(): void {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === 'production' || vercelEnv === 'preview') {
    assertProductionEnv();
  }
}
