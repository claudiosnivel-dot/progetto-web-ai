import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/data/supabase-ssr';
import {
  createGeneration,
  countGenerationsSince,
  writePool,
  markReady,
  markFailed,
  type GenerationFailureReason,
} from '@/data/generations';
import { getDailyGenerationCap } from '@/config/env';
import { guardMutatingRequest } from '@/app/api/_shared/request-guard';
import { guardOwnedSite, loadRouteBrief } from '@/app/api/_shared/route-guards';
import { generatable } from '@/domain/generation/generatable';
import { runGenerationPhase1 } from '@/data/generation-phase1';
import { RECIPES } from '@/domain/generation/recipes';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';

// T-230 (macrotask generation-ui, P2) — POST /api/generate: la FASE 1 della generazione.
// Catena _shared/request-guard (same-origin + tetto sui byte) → identita' → proprieta' del
// sito (P1-D21) → gate `generatable` → crea la riga 'generating' → stream NDJSON a DUE
// FLUSH. Vive sotto /api e NON sotto /[locale] per la stessa ragione dell'endpoint di turno
// (T-150): il matcher del middleware esclude /api del tutto, e un endpoint chiamato via
// fetch puo' rispondere 401/403 JSON invece di un 307 verso il login che un fetch non
// leggerebbe. Il siteId arriva nel BODY (non nel path): non c'e' segmento [siteId] qui.
//
// IL MODELLO DI GENERAZIONE (P2-D2): UNA sola chiamata al confine (`runGenerationTurn`,
// fase 'phase1') produce UN pool. Si scrive UN SOLO pool CONDIVISO — `writePool(id, 'home',
// null, pool, allowedSlugs)`, `variantIndex` null = condiviso fra le varianti (T-204) — NON
// cinque pool. Le CINQUE CORNICI del primo flush sono le 5 coppie {recipe_id, theme_id} di
// RECIPES (T-212): PURE, dichiarate da noi, ZERO testo del modello e ZERO rete. E' cio' che
// rende il primo chunk consegnabile PRIMA che il confine risolva (AC-230-5, AC-230-8).
//
// L'ORDINE DURABILE (P2-D15, meta' 'route' di AC-230-7): createGeneration('generating')
// PRIMA della chiamata al confine — la riga esiste e il sito e' protetto dall'indice UNIQUE
// parziale a prescindere dall'esito del trasporto — poi il confine, poi writePool del pool
// condiviso, poi `markReady`. Se il confine FALLISCE (esito nominato o eccezione) o writePool
// fallisce, si chiama `markFailed`: la riga NON resta MAI 'generating' in modo incoerente.
//
// SICUREZZA:
//  - A01:2025 CSRF/same-origin: la catena e' in _shared/request-guard, condivisa con
//    l'endpoint di onboarding (una sola sede per la difesa CSRF).
//  - A01:2025 cross-tenant (P1-D21): la proprieta' si accerta con listSites (RLS-backed);
//    un siteId non proprio riceve la STESSA risposta di uno inesistente (404), cosi'
//    l'endpoint non e' un oracolo di enumerazione.
//  - Contenimento del costo (AC-230-3): un brief non generabile e' respinto PRIMA di
//    spendere una chiamata a un modello a pagamento — nessuna riga, nessun confine.
//  - A07/A02:2025 (segreti): la chiave Anthropic resta dietro il confine server-only
//    (`@/data/anthropic`), che questa rotta NON importa (regola ESLint): lo raggiunge
//    attraverso l'orchestrazione di dominio `runGenerationPhase1`. Nulla di segreto
//    attraversa la risposta.
//  - R7: nessuna service_role; createGeneration/writePool/markReady/markFailed/listSites/
//    getBrief usano il client con sessione (RLS attiva).
//  - LIMITE DICHIARATO (security_note): nulla limita ancora la FREQUENZA delle generazioni
//    per account. L'indice UNIQUE parziale impedisce la concorrenza sul singolo sito, non la
//    raffica su siti diversi. Tetto complessivo: P5.

// Tetto sui BYTE del corpo. Il body legittimo e' un solo { siteId }, quindi il tetto e'
// piccolo: 1 KiB e' abbondante per un uuid dentro l'involucro JSON e rifiuta qualunque cosa
// assurda senza materializzarla. NON e' derivato da cap di collezione come in onboarding —
// qui non c'e' collezione — ma resta dichiarato accanto al suo uso.
const MAX_BODY_BYTES = 1024;

// maxPages a monte = il tetto di SICUREZZA del documento (P2-D13). I piani per-account sono
// P5: qui la fase 1 chiede sempre il massimo, e la fase 2 (T-234) applichera' il max_pages
// REGISTRATO sulla riga, non un ricalcolo.
const MAX_PAGES = DOCUMENT_LIMITS.max_pages;

// Il corpo: input NON FIDATO dal browser. Strict, un solo siteId non vuoto.
const RequestSchema = z.object({ siteId: z.string().min(1) }).strict();

// LE CINQUE CORNICI: le 5 coppie {recipe_id, theme_id} di RECIPES (P2-D1). Calcolate UNA
// VOLTA all'import perche' sono costanti e pure — non dipendono dal brief ne' dal modello.
const FRAMES: readonly { recipe_id: string; theme_id: string }[] = RECIPES.map((ricetta) => ({
  recipe_id: ricetta.id,
  theme_id: ricetta.theme_id,
}));

// La forma dei chunk NDJSON. `frames` e' il primo flush (le cornici pure); `pool` il
// secondo (il pool del confine); `error` sostituisce `pool` quando la fase 1 fallisce DOPO
// il primo flush, quando lo status HTTP e' gia' 200 e non c'e' altro canale.
type GenerateChunk =
  | { type: 'frames'; frames: readonly { recipe_id: string; theme_id: string }[] }
  | { type: 'pool'; pool: unknown }
  | { type: 'error'; reason: GenerationFailureReason };

const encoder = new TextEncoder();

// Motivi GENERICI: nessun dettaglio interno, e la stessa risposta per "sito non tuo" e
// "sito inesistente" (P1-D21).
function jsonError(status: number, reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status });
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1) Catena same-origin + tetto sui byte, PRIMA di qualunque lavoro (AC-230-6).
  const guardFailure = guardMutatingRequest(request, { maxBodyBytes: MAX_BODY_BYTES });
  if (guardFailure) return guardFailure;

  // 2) Identita' server-side VALIDATA (getUser rivalida il token), mai un flag client.
  const user = await getUser();
  if (!user) return jsonError(401, 'unauthorized');

  // 3) Body: input NON FIDATO. Il siteId serve alla proprieta', quindi si legge qui.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, 'invalid-body');
  }
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) return jsonError(400, 'invalid-body');
  const { siteId } = parsed.data;

  // 4) Proprieta' del sito (P1-D21): "non tuo" e "inesistente" ricevono lo STESSO 404. Catena
  //    condivisa con l'endpoint di onboarding (guardOwnedSite, _shared/route-guards).
  const ownership = await guardOwnedSite(siteId);
  if (ownership) return ownership;

  // 5) Il brief (RLS). Un GUASTO di lettura non e' un brief povero: e' 500/401. Un brief
  //    assente (sito proprio mai compilato) vale un brief vuoto, che il gate sotto respinge.
  const briefLoad = await loadRouteBrief(siteId);
  if (!briefLoad.ok) return briefLoad.response;
  const brief = briefLoad.brief;

  // 6) GATE `generatable` (AC-230-3): un brief che non puo' produrre un sito presentabile e'
  //    respinto QUI, PRIMA di creare la riga e PRIMA di spendere una chiamata a pagamento.
  if (!generatable(brief, { maxPages: MAX_PAGES }).ok) {
    return jsonError(422, 'not-generatable');
  }

  // 6b) (deploy pass) T-4 — CAP GIORNALIERO di costo: cintura SOFT oltre lo spending limit di
  //     Anthropic (il freno HARD, configurato sul dashboard, NON aggirabile da qui). Conta le
  //     generazioni dell'account nelle ultime 24h e, oltre il tetto, risponde 429 PRIMA di creare la
  //     riga e di spendere una chiamata al modello. FAIL-OPEN su errore di conteggio (backstop = cap
  //     Anthropic). LIMITI DICHIARATI (rilievi verifier): (M1) il conteggio poggia su site_generations,
  //     che il tenant potrebbe cancellare via PostgREST diretto per azzerare il conteggio — non un
  //     rischio nel pre-lancio invite-only (unico utente = il founder) e sostituito dal ledger crediti
  //     append-only di P5 per il pubblico; (M3) il cap copre la GENERAZIONE (modello TOP, il costo
  //     grosso), NON l'intervista di onboarding (Haiku, con cap per-conversazione a 40 turni) — anche
  //     l'intervista resta sotto lo spending cap Anthropic. Cap PER-ACCOUNT su tutte le righe (creare
  //     piu' siti non moltiplica il tetto).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await countGenerationsSince(since);
  if (recent.ok && recent.count >= getDailyGenerationCap()) {
    return jsonError(429, 'rate-limited');
  }

  // 7) LA RIGA 'generating', creata PRIMA della chiamata al confine (durabilita' dalla riga,
  //    non dal trasporto). Un fallimento qui e' uno status HTTP onesto: lo stream non e'
  //    ancora aperto.
  const created = await createGeneration(siteId, MAX_PAGES);
  if (!created.ok) return jsonError(created.status, 'generation-not-created');
  const generationId = created.id;

  // 8) STREAM NDJSON a DUE FLUSH. Il primo chunk (le cornici) esce PRIMA di attendere il
  //    confine: e' cio' che AC-230-5 misura con un doppio gated. Il secondo (il pool) esce
  //    solo al ritorno del confine, dopo la scrittura durabile. L'assemblaggio del turno e
  //    la chiamata al confine vivono in `runGenerationPhase1` (dominio), che la rotta non
  //    puo' importare direttamente.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: GenerateChunk) => {
        // NDJSON: una riga JSON per chunk, '\n' come separatore.
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };
      const fail = async (reason: GenerationFailureReason) => {
        // La riga non resta MAI 'generating' in modo incoerente (AC-230-7): CAS a 'failed'.
        await markFailed(generationId, reason);
        send({ type: 'error', reason });
        controller.close();
      };

      // FLUSH 1 — le cinque cornici, PURE, prima della chiamata al confine.
      send({ type: 'frames', frames: FRAMES });

      // LA FASE 1 (assemblaggio + confine T-224, nel dominio). Un'ECCEZIONE (rete/SDK) e un
      // esito NOMINATO di fallimento sono due cose distinte, ed entrambe portano la riga a
      // 'failed'.
      let phase1: Awaited<ReturnType<typeof runGenerationPhase1>>;
      try {
        phase1 = await runGenerationPhase1(brief);
      } catch {
        await fail('confine_in_errore');
        return;
      }
      if (!phase1.ok) {
        await fail(phase1.reason);
        return;
      }

      // IL POOL CONDIVISO: scope 'home', variantIndex null (una sola scrittura, NON cinque).
      // L'allowlist e' la STESSA con cui il pool e' stato validato, portata dalla fase 1.
      const written = await writePool(generationId, 'home', null, phase1.pool, phase1.allowedSlugs);
      if (!written.ok) {
        await fail('pool_non_scritto');
        return;
      }

      // 'generating' → 'ready': le cinque varianti sono pronte da mostrare (T-232). SI RISPETTA
      // IL RITORNO (finestra P2-D15): se il CAS 'generating'->'ready' e' PERSO — la riga e' stata
      // riconciliata a 'failed' durante la lunga chiamata al confine, oppure l'UPDATE e' fallito —
      // il pool e' scritto ma la generazione NON e' viva. Emettere il chunk 'pool' con 200 come
      // SUCCESSO mentirebbe. Si passa dal ramo di fallimento: `fail` chiama markFailed (sul CAS
      // perso e' un no-op innocuo; se la riga fosse ancora 'generating' per un guasto transitorio
      // la porta a 'failed', cosi' non resta MAI 'generating' — AC-230-7) ed emette 'error' al
      // posto di 'pool'. Simmetrico al fallimento di writePool: nessun successo dichiarato senza
      // la transizione durabile che lo regge.
      const ready = await markReady(generationId);
      if (!ready.ok) {
        await fail('ready_non_scritto');
        return;
      }

      // FLUSH 2 — il pool, al ritorno del modello e SOLO dopo la transizione durabile a 'ready'.
      send({ type: 'pool', pool: phase1.pool });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
