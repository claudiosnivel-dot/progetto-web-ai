import { NextResponse, type NextRequest } from 'next/server';

// T-230 (macrotask generation-ui, P2) — LA CATENA DI GUARDIE same-origin + tetto sui byte,
// in UNA sola sede. Prima viveva INLINE nel route handler di onboarding (T-150); T-230 la
// estrae perche' una seconda rotta che MUTA STATO (POST /api/generate) deve applicare la
// STESSA catena, e due copie di una difesa CSRF sono il modo classico in cui una delle due,
// alla prossima modifica, perde un controllo senza che nessuno se ne accorga (misurato come
// duplicazione jscpd fra i due route handler). E' la stessa de-duplicazione fatta in T-121
// per i tetti di P1-D17 e in guard.ts per la catena di ingresso alle pagine: togliere copie
// di una proprieta' che DEVE essere una sola.
//
// PERCHE' un route handler custom ne ha bisogno (A01:2025 / CSRF): NON eredita il controllo
// d'origine che Next applica alle Server Action, e i cookie Supabase sono SameSite=Lax —
// una POST cross-site partirebbe AUTENTICATA. Per un endpoint che muta stato la same-origin
// va quindi verificata ESPLICITAMENTE, prima di qualunque lavoro.
//
// LE TRE CITAZIONI DELL'ORIENTAMENTO, nell'ordine in cui devono stare:
//  1. `Sec-Fetch-Site` PRETESO uguale a 'same-origin', FAIL-CLOSED sull'assenza: assente
//     → 403, non "controllalo se c'e'". Trattare l'assenza come permesso era un fail-OPEN
//     (bastava NON mandare l'header per scavalcare il gate). E' l'unico dei due gate
//     indipendente da `nextUrl.origin`, che Next RICOSTRUISCE dalla richiesta.
//     COSTO REALE dichiarato: i metadata Fetch non sono in ogni browser (Chrome 76+,
//     Firefox 90+, Safari 16.4+); un browser piu' vecchio si vede rifiutare pur essendo
//     legittimo. Baratto accettato: e' un endpoint che muta stato.
//  2. `Origin` confrontato con l'origin della richiesta; i browser lo inviano sempre su
//     POST, quindi assente = 403. Baseline non canonica: `nextUrl.origin` e' ricostruito
//     (host/x-forwarded-*), quindi dietro un proxy mal configurato puo' divergere da quello
//     reale — per questo il gate 1 e' indipendente da esso.
//  3. Tetto sui BYTE del body, PRIMA di leggere il corpo: `await request.json()`
//     materializza in memoria qualunque cosa il client spedisca, e un route handler NON ha
//     il `bodySizeLimit` delle Server Action. Il confronto e' su Content-Length: costa
//     quanto leggere un header invece del corpo.
//     NESSUN `Number.isFinite` nella condizione, ed e' voluto: un header assente da' NaN e
//     `NaN > cap` e' falso (passa, come il LIMITE dichiarato qui sotto), mentre 'Infinity'
//     da' Infinity e `Infinity > cap` e' VERO (413). Filtrare i non-finiti prima del
//     confronto farebbe passare proprio 'Infinity'.
//     LIMITE DICHIARATO (non una guardia che non e'): un client che OMETTE Content-Length —
//     una POST in Transfer-Encoding: chunked, che nessun browser produce per un body di
//     stringa ma un client scritto a mano si' — NON e' fermato da questa guardia e resta
//     limitato dai soli cap del validatore, dopo la lettura. Fermarlo davvero vorrebbe dire
//     contare i byte mentre si consuma lo stream, che e' un'altra forma della route.
//
// IL TETTO E' UN PARAMETRO, non una costante del modulo: le due rotte hanno corpi legittimi
// di taglia diversa (l'onboarding rigioca la history, /generate porta un solo siteId),
// quindi ognuna passa il PROPRIO `maxBodyBytes`, derivato dai propri cap accanto ad essi. Un
// tetto unico qui direbbe a una delle due un limite che non le appartiene.

/** Il motivo GENERICO del rifiuto: nessun dettaglio interno, stessa forma delle due rotte. */
function jsonError(status: number, reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status });
}

/**
 * Applica la catena same-origin + tetto sui byte a una richiesta che MUTA STATO.
 *
 * @param request la richiesta in ingresso (input non fidato).
 * @param options `maxBodyBytes` — il tetto sui byte del corpo di QUESTA rotta, derivato dai
 *   suoi cap. Il confronto avviene su Content-Length, PRIMA di leggere il corpo.
 * @returns la `NextResponse` di rifiuto (403 o 413) se un controllo non passa, oppure `null`
 *   se la richiesta supera la catena e il chiamante puo' proseguire.
 */
export function guardMutatingRequest(
  request: NextRequest,
  options: { readonly maxBodyBytes: number },
): NextResponse | null {
  // Gate 1 — Sec-Fetch-Site PRETESO, fail-CLOSED sull'assenza.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return jsonError(403, 'forbidden');
  }
  // Gate 2 — Origin confrontato con l'origin (ricostruito) della richiesta.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return jsonError(403, 'forbidden');
  }
  // Gate 3 — tetto sui BYTE del body, prima di leggerlo.
  if (Number(request.headers.get('content-length')) > options.maxBodyBytes) {
    return jsonError(413, 'payload-too-large');
  }
  return null;
}
