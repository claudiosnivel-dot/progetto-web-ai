import type Anthropic from '@anthropic-ai/sdk';
import type { Brief } from '@/domain/onboarding/brief';
import { blocksFor, slotsForBlocks } from '@/domain/generation/blocks';
import type { PageSpec } from '@/domain/generation/pages';
import { briefProjection } from '@/domain/generation/projection';
import { buildGenerationPayload, type GenerationPayload } from '@/domain/generation/prompt';
import { buildPoolTool } from '@/domain/generation/tool';
import type { SlotId } from '@/domain/generation/slots';

// T-234 / architecture-hardening (T-AH5) — LA COSTRUZIONE PURA DEL PAYLOAD della fase 2 a chunk
// (P2-D13, EMENDAMENTO "A" = P2-D32). Questo modulo di DOMINIO resta PURO: non importa @/data.
// L'ESECUZIONE del turno (runGenerationPhase2Chunk, che chiama il confine unico @/data/anthropic)
// e' stata spostata in src/data/generation-phase2-chunk.ts, accanto al suo chiamante — cosi' il
// dominio non dipende dal confine (contratto di altitudine). La PROIEZIONE 'inner' (T-220) e' la
// difesa in ingresso: al confine arriva la sola porzione ammessa del brief — la fase 2 NON riapre
// l'allowlist (T-220/AC-220-5).
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
