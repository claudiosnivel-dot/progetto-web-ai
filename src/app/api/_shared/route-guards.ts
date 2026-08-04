import { NextResponse } from 'next/server';
import { getBrief } from '@/data/briefs';
import { listSites } from '@/data/sites';
import { emptyBrief, type Brief } from '@/domain/onboarding/brief';
import { routing } from '@/i18n/routing';

// macrotask generation-ui, P2 — DUE PASSI di rotta condivisi da POST /api/generate (T-230) e da
// POST /api/onboarding/[siteId]/turn (T-150): la PROPRIETA' del sito (P1-D21) e il CARICAMENTO del
// brief, con la STESSA risposta generica in caso di guasto/altrui. Entrambi i route handler li
// scrivevano verbatim (misurato come duplicazione dal controllo dead-code del checkpoint). Vivono
// qui accanto a `request-guard` (la catena same-origin), perche' sono la stessa disciplina — cio'
// che le due rotte che MUTANO STATO devono fare IDENTICO prima del lavoro proprio.
//
// A01:2025 (cross-tenant, P1-D21): "sito non tuo" e "sito inesistente" ricevono lo STESSO 404 —
// l'endpoint non e' un oracolo di enumerazione. R7: `listSites`/`getBrief` usano il client con
// sessione (RLS attiva), MAI la service_role. Il brief mancante (sito proprio mai compilato) vale
// un brief VUOTO col locale di default del routing; un GUASTO di lettura e' invece 500/401.

/** Il motivo GENERICO del rifiuto: nessun dettaglio interno, stessa forma nelle due rotte. */
function jsonError(status: number, reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status });
}

/**
 * Accerta che `siteId` appartenga all'utente (RLS-backed via `listSites`). Ritorna la
 * `NextResponse` di rifiuto (500/401 su guasto, 404 se non proprio/inesistente) oppure `null` se
 * la proprieta' e' verificata e il chiamante puo' proseguire.
 */
export async function guardOwnedSite(siteId: string): Promise<NextResponse | null> {
  const sitesResult = await listSites();
  if (!sitesResult.ok) {
    return jsonError(sitesResult.status === 401 ? 401 : 500, 'unavailable');
  }
  if (!sitesResult.sites.some((site) => site.id === siteId)) {
    return jsonError(404, 'not-found');
  }
  return null;
}

/**
 * Carica il brief del sito per una rotta: un GUASTO di lettura e' 500/401 (`response`), un brief
 * assente (sito proprio mai compilato) vale un brief VUOTO col locale di default. Non e' un brief
 * "povero": il gate a valle (`generatable`, o l'orchestrazione dell'intervista) decide.
 */
export async function loadRouteBrief(
  siteId: string,
): Promise<{ ok: true; brief: Brief } | { ok: false; response: NextResponse }> {
  const briefResult = await getBrief(siteId);
  if (!briefResult.ok) {
    return { ok: false, response: jsonError(briefResult.status === 401 ? 401 : 500, 'unavailable') };
  }
  return { ok: true, brief: briefResult.brief ?? emptyBrief(routing.defaultLocale) };
}
