import type Anthropic from '@anthropic-ai/sdk';
import { runGenerationTurn } from '@/data/anthropic';
import type { Brief } from '@/domain/onboarding/brief';
import type { Pool } from '@/domain/generation/pool';
import { blocksFor, slotsForBlocks } from '@/domain/generation/blocks';
import type { PageSpec } from '@/domain/generation/pages';
import { briefProjection } from '@/domain/generation/projection';
import { buildGenerationPayload, type GenerationPayload } from '@/domain/generation/prompt';
import { buildPoolTool } from '@/domain/generation/tool';
import type { SlotId } from '@/domain/generation/slots';

// T-234 (macrotask generation-ui, P2) — L'ORCHESTRAZIONE DELLA FASE 2 A CHUNK (P2-D13,
// EMENDAMENTO "A" = P2-D32): assembla il turno delle PAGINE INTERNE e chiama il confine unico
// (T-224). Vive nel layer di DOMINIO e non nella rotta/azione per la stessa ragione di
// `phase1.ts`: src/app NON puo' importare @/data/anthropic (il confine e' server-only e detiene
// il segreto Anthropic, regola ESLint), e la fase 2 dev'essere richiamabile dall'azione di
// scrittura (src/data/generation-phase2.ts) attraverso un orchestratore, non importando il
// confine di la'. La PROIEZIONE 'inner' (T-220) e' la difesa in ingresso: al confine arriva la
// sola porzione ammessa del brief — la fase 2 NON riapre l'allowlist (T-220/AC-220-5).
//
// ── IL PREFISSO STABILE E' IDENTICO FRA I CHUNK (AC-234-2), ED E' UNA SCELTA CON UN COSTO ────
// L'API rende il prompt nell'ordine tools -> system -> messages e il prompt caching e' un
// confronto di PREFISSO: perche' il colpo di cache avvenga FRA i chunk della stessa fase 2, il
// TOOL e il SYSTEM prompt devono essere identici byte per byte, e solo il messaggio utente puo'
// variare. Per questo il tool NON e' costruito sulle pagine DEL CHUNK — che cambierebbero il
// prefisso a ogni chunk e romperebbero la cache — ma sull'INTERO set di pagine interne della
// fase 2 (`innerPages`), che e' lo stesso per tutti i chunk. Le pagine del chunk stanno nella
// sola parte VOLATILE, come una consegna `<pagine>` in coda al messaggio.
//
// COSTO DICHIARATO, e va detto invece di nasconderlo: `buildPoolTool` (T-222) rende OBBLIGATORIA
// ogni pagina che enumera. Con il tool costruito sull'intero set interno, lo schema chiede al
// modello TUTTE le pagine interne a ogni chunk, mentre la consegna `<pagine>` gli indica su
// quali concentrarsi in questo passaggio; il chunking resta quindi la granularita' della
// PERSISTENZA (ogni chunk estende il documento e un troncamento del successivo non lo disfa,
// AC-234-3) e della CACHE, non un ritaglio dell'uscita del modello. Ridurre l'uscita per chunk
// vorrebbe dire un tool per-chunk, cioe' un prefisso diverso a ogni chunk: e' il verso che la
// DoD di T-234 ha scelto di non prendere ("Il prefisso stabile ... e' identico fra i chunk,
// perche' sia cacheabile"). L'effetto sul modello non e' oracolabile senza chiave (P1 §6-bis
// p.2), quindi qui e' un limite DICHIARATO e non un fatto misurato.

/** I motivi di fallimento NOMINATI del confine (T-224), derivati e non riscritti. */
type Phase2ChunkFailure = Extract<
  Awaited<ReturnType<typeof runGenerationTurn>>,
  { ok: false }
>['reason'];

/**
 * L'esito di UN chunk della fase 2. Il fallimento e' TERMINALE e NOMINATO (stesso contratto di
 * T-224): nessun pool parziale. In caso di successo porta anche l'allowlist degli slug con cui
 * il pool e' stato validato — la STESSA che l'azione passa a `writePool`, senza ricalcolarla.
 */
export type Phase2ChunkResult =
  | { readonly ok: true; readonly pool: Pool; readonly allowedSlugs: readonly string[] }
  | { readonly ok: false; readonly reason: Phase2ChunkFailure };

/** La consegna che nomina, nella parte VOLATILE, le pagine di QUESTO chunk. */
const APERTURA_DELLE_PAGINE = '<pagine>';
const CHIUSURA_DELLE_PAGINE = '</pagine>';

/**
 * Gli slot che TUTTE le pagine interne della fase 2 possono richiedere, nell'ordine di prima
 * comparizione. E' l'unione (per uguaglianza, mai per prefisso) degli slot dei blocchi di ogni
 * ruolo interno: entra nel tool STABILE, quindi non deve dipendere dal chunk.
 */
function slotDelleInterne(brief: Brief, innerPages: readonly PageSpec[]): readonly SlotId[] {
  const visti = new Set<SlotId>();
  const unione: SlotId[] = [];
  for (const pagina of innerPages) {
    for (const slot of slotsForBlocks(blocksFor(brief, pagina.role))) {
      if (visti.has(slot)) continue;
      visti.add(slot);
      unione.push(slot);
    }
  }
  return unione;
}

/**
 * Il contenuto del messaggio utente, `string` per costruzione (T-223 lo assembla cosi'): la
 * guardia sul tipo tiene il typecheck onesto sull'unione `string | ContentBlockParam[]` dell'SDK
 * senza un cast, e il ramo array e' irraggiungibile finche' `buildGenerationPayload` produce una
 * stringa.
 */
function testoDelMessaggio(content: Anthropic.MessageParam['content']): string {
  return typeof content === 'string' ? content : '';
}

/**
 * COSTRUISCE IL PAYLOAD di un chunk della fase 2. La parte STABILE (tool + system) e' derivata
 * dall'INTERO set interno `innerPages` — identica per ogni chunk della fase (AC-234-2) — mentre
 * le pagine DEL CHUNK stanno nella parte volatile, aggiunte in coda al messaggio.
 *
 * PURA: non legge il DB ne' l'orologio ne' il random. Gli stessi argomenti danno lo stesso
 * payload byte per byte, ed e' su questo che poggia la prova del prefisso cacheabile.
 *
 * @param brief il brief CONFERMATO del sito (gia' passato dal gate `generatable`, T-215).
 * @param innerPages TUTTE le pagine interne della fase 2 (la home e' esclusa): dimensionano il
 *   tool stabile. Devono essere le STESSE fra i chunk perche' il prefisso lo sia.
 * @param chunk le pagine da scrivere in QUESTO passaggio: entrano nella sola parte volatile.
 */
export function buildPhase2ChunkPayload(
  brief: Brief,
  innerPages: readonly PageSpec[],
  chunk: readonly PageSpec[],
): GenerationPayload {
  const slotIds = slotDelleInterne(brief, innerPages);
  const pageSlugs = innerPages.map((pagina) => pagina.slug);
  const tool = buildPoolTool(slotIds, pageSlugs);
  const base = buildGenerationPayload(briefProjection(brief, 'inner'), tool, 'inner');

  // Le pagine del chunk sono i NOSTRI slug (T-213, derivati dai ruoli), mai testo del brief:
  // aggiungerle qui non riapre alcun canale di iniezione, e la busta <scheda> di T-223 resta
  // aperta e chiusa una volta sola (la consegna del chunk usa delimitatori propri).
  const chunkSlugs = chunk.map((pagina) => pagina.slug);
  const consegnaDelChunk = `${APERTURA_DELLE_PAGINE}${chunkSlugs.join(', ')}${CHIUSURA_DELLE_PAGINE}`;
  const content = `${testoDelMessaggio(base.messages[0].content)}\n\n${consegnaDelChunk}`;

  return {
    system: base.system,
    tools: base.tools,
    messages: [{ role: 'user', content }],
  };
}

/**
 * Assembla e ESEGUE il turno di UN chunk della fase 2 sul confine, restituendo il pool delle
 * pagine di quel chunk. L'allowlist passata a `parsePool` (via `runGenerationTurn`) e' quella
 * dell'INTERO set interno — la stessa su cui e' costruito il tool stabile — cosi' un pool che
 * portasse una pagina non prevista dalla fase 2 cade per intero (T-201), e le pagine del chunk
 * ne sono comunque un sottoinsieme.
 *
 * @returns il pool validato con la sua allowlist, oppure il motivo nominato del fallimento.
 */
export async function runGenerationPhase2Chunk(
  brief: Brief,
  innerPages: readonly PageSpec[],
  chunk: readonly PageSpec[],
): Promise<Phase2ChunkResult> {
  const allowedSlugs = innerPages.map((pagina) => pagina.slug);
  const payload = buildPhase2ChunkPayload(brief, innerPages, chunk);

  const turn = await runGenerationTurn({ payload, phase: 'phase2_chunk', allowedSlugs });
  if (!turn.ok) return { ok: false, reason: turn.reason };
  return { ok: true, pool: turn.pool, allowedSlugs };
}
