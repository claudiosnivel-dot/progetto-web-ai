'use server';

import { loadOwnBrief, loadOwnGeneration } from '@/data/generation-action-reads';
import {
  appendPages,
  failGenerationPhase2,
  writePool,
  type GenerationFailureReason,
  type TransitionResult,
} from '@/data/generations';
import { GENERATION_BUDGET } from '@/domain/generation/budget';
import { pagesFor, type PageSpec } from '@/domain/generation/pages';
import { runGenerationPhase2Chunk, type Phase2ChunkResult } from '@/domain/generation/phase2';
import { RECIPES } from '@/domain/generation/recipes';
import { resolve } from '@/domain/generation/resolve';
import { THEMES } from '@/domain/generation/themes';

// T-234 (macrotask generation-ui, P2) — L'AZIONE DI FASE 2: dopo la scelta, genera le PAGINE
// INTERNE della variante scelta, a CHUNK (P2-D13, EMENDAMENTO "A" = P2-D32). Gira SOLO su
// status='chosen' e SOLO per la variante scelta (scope='inner', variant_index = chosen_variant).
//
// Vive in src/data/ e raggiunge il confine ATTRAVERSO l'orchestrazione di dominio
// `runGenerationPhase2Chunk`, mai importando @/data/anthropic direttamente — la stessa forma con
// cui la rigenerazione (T-232) e la rotta di fase 1 (T-230) tengono il segreto Anthropic dietro
// il confine server-only. Il client con SESSIONE (RLS attiva) e' quello di
// `getBrief`/`getGeneration`/`writePool`/`appendPages`; nessuna service_role (R7), e l'account
// non arriva mai dal client (writePool lo deriva dalla riga, decisione (e) di T-204).
//
// L'ORDINE DURABILE, e perche' e' quello (AC-234-3, "onesta' dello stato"):
//   pagine derivate col max_pages REGISTRATO (AC-234-6) -> chunk di pages_per_chunk ->
//   per ogni chunk: confine -> resolve -> appendPages(chunk, {final: e' l'ultimo?}).
// Ogni chunk NON finale porta appendPages({final:false}), che ESTENDE il documento e LASCIA la
// riga 'chosen': cosi' un troncamento del chunk successivo perde quel chunk e non le pagine
// gia' scritte. Al fallimento di un chunk: `failGenerationPhase2` (chosen->failed) e STOP — il
// documento resta con la home piu' i chunk riusciti, e la generazione NON dichiara mai
// 'complete'. Solo l'ULTIMO appendPages({final:true}) porta a 'complete'.
//
// UN SOLO POOL 'inner' PER VARIANTE, non uno per chunk: l'UNIQUE (generation_id, scope,
// variant_index) di T-200 ammette una sola riga ('inner', chosen_variant), quindi i pool dei
// chunk si ACCUMULANO in un solo pool che `writePool` scrive UNA volta, prima dell'append che
// chiude. E' anche cio' che rende irrappresentabile la RI-fase2 (AC-234-5): una seconda
// esecuzione trova lo stato 'complete' (rifiuto qui) e, difesa in profondita', l'UNIQUE sul
// pool 'inner' gia' scritto. Il profilo di proiezione 'inner' NON allarga l'allowlist in
// ingresso (T-220/AC-220-5): la fase 2 non riapre la superficie che la fase 1 chiude.

/** Il ruolo della home: la sola pagina che la fase 1 ha gia' congelato e che la fase 2 non tocca. */
const RUOLO_HOME = 'home';

/**
 * L'esito della fase 2. Il fallimento e' NOMINATO e distinto: 'confine_fallito' e' un chunk che
 * non ha prodotto un pool (troncamento o altro esito terminale del confine, gia' persistito a
 * 'failed'), 'conflitto' e' la RI-fase2 respinta (stato non 'chosen' sul CAS, o UNIQUE sul pool
 * 'inner'), 'brief_assente'/'non_leggibile' sono i due esiti della lettura del brief (un guasto
 * non e' un brief mancante, P2-D16), 'stato_non_valido' e' una generazione che non e' in 'chosen'.
 */
export type RunPhase2Result =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'non_autorizzato'
        | 'brief_non_leggibile'
        | 'brief_assente'
        | 'generazione_non_leggibile'
        | 'generazione_assente'
        | 'stato_non_valido'
        | 'confine_fallito'
        | 'conflitto'
        | 'non_scritto';
    };

/** Spezza le pagine in chunk di al piu' `size`, nell'ordine ricevuto (mai riordinate). */
function inChunk(pages: readonly PageSpec[], size: number): readonly (readonly PageSpec[])[] {
  const chunks: PageSpec[][] = [];
  for (let i = 0; i < pages.length; i += size) chunks.push([...pages.slice(i, i + size)]);
  return chunks;
}

/**
 * Il motivo NOMINATO da scrivere in `failure_reason` quando un chunk fallisce. Il troncamento e'
 * il caso proprio della fase 2 (AC-234-3) e ha il suo nome; gli altri esiti del confine
 * riusano il vocabolario chiuso di T-224 (gia' in `FAILURE_REASONS`).
 */
function motivoDelFallimento(reason: Extract<Phase2ChunkResult, { ok: false }>['reason']): GenerationFailureReason {
  return reason === 'risposta_troncata' ? 'fase2_troncata' : reason;
}

/** Traduce lo status di `writePool` nel motivo NOMINATO dell'azione. */
function esitoWritePool(status: 400 | 401 | 404 | 409 | 500): RunPhase2Result {
  if (status === 401) return { ok: false, reason: 'non_autorizzato' };
  // 409 = l'UNIQUE sul pool 'inner' (una fase 2 gia' passata per l'ultimo chunk) o uno stato
  // terminale: in entrambi i casi non si riscrive.
  if (status === 409) return { ok: false, reason: 'conflitto' };
  return { ok: false, reason: 'non_scritto' };
}

/** Traduce lo status di una transizione (`appendPages`) nel motivo NOMINATO dell'azione. */
function esitoTransizione(written: Extract<TransitionResult, { ok: false }>): RunPhase2Result {
  switch (written.status) {
    case 401:
      return { ok: false, reason: 'non_autorizzato' };
    case 404:
      return { ok: false, reason: 'generazione_assente' };
    case 409:
      return { ok: false, reason: 'conflitto' };
    default:
      return { ok: false, reason: 'non_scritto' };
  }
}

/**
 * ESEGUE la fase 2 di una generazione: genera le pagine interne della variante scelta, a chunk,
 * e le persiste estendendo il documento congelato fino a 'complete'.
 *
 * @param input `siteId` per leggere brief e stato (RLS), `generationId` per le scritture. Gli id
 *   sono derivati server-side (dalla rotta/dashboard), non dal browser.
 */
export async function runPhase2(input: {
  readonly siteId: string;
  readonly generationId: string;
}): Promise<RunPhase2Result> {
  // IL BRIEF: un GUASTO di lettura non e' un brief assente (P2-D16). Serve a derivare le pagine
  // e a scrivere il copy delle interne. Lettura condivisa con scegli/rigenera (loadOwnBrief).
  const briefResult = await loadOwnBrief(input.siteId);
  if (!briefResult.ok) return briefResult;
  const brief = briefResult.brief;

  // LO STATO CORRENTE, dalla lettura AUTOREVOLE condivisa (loadOwnGeneration -> getGeneration, che
  // applica la riconciliazione di P2-D15/P2-D32): una 'chosen' stantia e' gia' riportata 'failed'
  // qui, e la fase 2 non parte su una generazione abbandonata. La variante scelta e il max_pages
  // REGISTRATO vengono da qui.
  const gen = await loadOwnGeneration(input.siteId, input.generationId, 'generazione_assente');
  if (!gen.ok) return gen;
  const g = gen.generation;
  // SOLO da 'chosen': una fase 2 su 'ready'/'generating'/'complete'/'failed' non ha senso, e su
  // 'complete' e' la RI-fase2 di AC-234-5, respinta qui prima di ogni chiamata al confine.
  if (g.status !== 'chosen' || g.chosen_variant === null) {
    return { ok: false, reason: 'stato_non_valido' };
  }
  const chosenVariant = g.chosen_variant;

  // LA RICETTA E IL TEMA della variante scelta: gli STESSI con cui la fase 1 ha congelato la home
  // (RECIPES[i] + il tema della ricetta). Il ramo `undefined` e' la difesa dichiarata contro un
  // chosen_variant fuori dai cinque o un tema che nessuna ricetta porta — non un caso vivo.
  const recipe = RECIPES[chosenVariant];
  const theme = recipe === undefined ? undefined : THEMES.find((t) => t.id === recipe.theme_id);
  if (recipe === undefined || theme === undefined) return { ok: false, reason: 'stato_non_valido' };

  // IL SET DI PAGINE col max_pages REGISTRATO (AC-234-6), MENO la home (che esiste gia'): mai un
  // ricalcolo dai piani correnti. Se non ci sono pagine interne (one-pager), la fase 2 chiude
  // subito con un append vuoto, senza spendere una chiamata al confine.
  const innerPages = pagesFor(brief, { maxPages: g.max_pages }).filter((p) => p.role !== RUOLO_HOME);
  if (innerPages.length === 0) {
    const written = await appendPages(input.generationId, [], { final: true });
    return written.ok ? { ok: true } : esitoTransizione(written);
  }

  const chunks = inChunk(innerPages, GENERATION_BUDGET.pages_per_chunk);
  // I pool dei chunk si ACCUMULANO in un solo pool 'inner' (un solo slot UNIQUE per variante).
  const mergedPages: Record<string, unknown> = {};

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;

    // LA CHIAMATA AL CONFINE. Un'ECCEZIONE (rete/SDK) e un esito NOMINATO di fallimento sono due
    // cose distinte: entrambe chiudono la fase 2 a 'failed' (document intatto) e fermano il ciclo.
    let turn: Phase2ChunkResult;
    try {
      turn = await runGenerationPhase2Chunk(brief, innerPages, chunk);
    } catch {
      await failGenerationPhase2(input.generationId, 'confine_in_errore');
      return { ok: false, reason: 'confine_fallito' };
    }
    if (!turn.ok) {
      await failGenerationPhase2(input.generationId, motivoDelFallimento(turn.reason));
      return { ok: false, reason: 'confine_fallito' };
    }

    for (const [slug, contenuto] of Object.entries(turn.pool.pages ?? {})) {
      mergedPages[slug] = contenuto;
    }

    // RESOLVE le sole pagine del chunk: il documento le porta nell'ordine del set derivato
    // (AC-234-4). resolve NON e' un gate — il documento esteso passera' comunque da parseDocument
    // dentro `appendPages` (T-204), che e' anche dove valgono il max_pages della riga e la home
    // unica.
    const { document } = resolve(turn.pool, recipe, theme, brief, chunk);

    // L'ULTIMO chunk: scrivi il pool 'inner' ACCUMULATO (una sola volta, PRIMA dell'append che
    // porta a 'complete' — writePool rifiuta gli stati terminali, decisione (g) di T-204), poi
    // chiudi. I chunk non finali estendono e tengono aperta la riga.
    if (isLast) {
      const writtenPool = await writePool(
        input.generationId,
        'inner',
        chosenVariant,
        { pages: mergedPages },
        turn.allowedSlugs,
      );
      if (!writtenPool.ok) return esitoWritePool(writtenPool.status);
    }

    const written = await appendPages(input.generationId, document.pages, { final: isLast });
    if (!written.ok) return esitoTransizione(written);
  }

  return { ok: true };
}
