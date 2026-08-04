'use server';

import { getAuthedClient } from '@/data/authed-client';

// T-235 (macrotask generation-ui, P2) — LETTURA del DOCUMENTO CONGELATO di un sito, per
// l'anteprima navigabile /preview. Eseguita solo server-side, usa il client Supabase legato
// alla SESSIONE (RLS attiva, is_account_member), MAI la service_role (R7): un site_id di un
// altro tenant filtra a insieme vuoto -> null, mai un errore che ne riveli l'esistenza — la
// stessa scelta di getGeneration (T-203), che conserva l'anti-enumerazione di P1-D21.
//
// PERCHE' UNA LETTURA A PARTE E NON getGeneration (P2-D5, DoD di T-235): l'anteprima rende il
// DOCUMENTO e non il pool — se leggesse il pool, il sito del cliente ricambierebbe al primo
// ritocco di una ricetta (AC-235-1). getGeneration e' la lettura di STATO (id, status,
// max_pages, failure_reason, updated_at) e NON restituisce la colonna `document`, che e' jsonb
// e puo' pesare megabyte: trascinarla in ogni lettura di stato — la dashboard di T-236 compresa
// — sarebbe uno spreco. Qui si legge la SOLA colonna che serve all'anteprima, e nient'altro.
// La tabella dei pool NON e' toccata (DoD: "non legge generation_pools").
//
// A05:2025 — solo metodi tipati .eq()/.order()/.limit()/.select(); mai .or()/.filter() con
// input interpolato. Il documento restituito e' `unknown`: il gate e' `parseDocument` (T-202),
// che gira nel consumatore PRIMA di rendere, come ovunque nel progetto.

/** Il documento congelato del sito, o `null` se il sito non e' mai stato generato. */
export type ReadGenerationDocumentResult =
  | { ok: true; document: unknown | null }
  | { ok: false; status: 401 | 500 };

/**
 * Il DOCUMENTO CONGELATO piu' recente del sito. NON la generazione piu' recente in assoluto: la
 * piu' recente FRA QUELLE CON UN DOCUMENTO (`document not null`). La distinzione e' AC-235-1 e
 * la ragione e' P2-D15: fra il congelamento di un sito e la sua anteprima l'utente puo' aver
 * avviato una NUOVA generazione, che nasce 'generating' con `document` null; se leggessimo la
 * riga piu' recente in assoluto, quella nuova riga NASCONDEREBBE il sito appena congelato e
 * l'anteprima direbbe 'unavailable' su un sito che c'e'. Solo le righe congelate portano un
 * documento — 'chosen' (la sola home) e 'complete' (multi-pagina) lo scrivono, 'generating'/
 * 'ready'/'failed'-di-fase-1 no — quindi filtrare a `document not null` e' esattamente "mostra
 * l'ultimo documento congelato". Fra le righe congelate resta l'ordinamento DETERMINISTICO di
 * getGeneration (created_at desc, id desc come spareggio).
 *
 * Nessun filtro per account: la RLS di site_generations vincola gia' il risultato agli account
 * di cui l'utente e' membro (stessa scelta di getGeneration/listSites), e un site_id altrui
 * filtra a null — mai un errore. `.not('document', 'is', null)` e' un metodo tipato con operando
 * letterale (nessun input interpolato): la disciplina A05:2025 del modulo resta intatta.
 */
export async function readGenerationDocument(
  siteId: string,
): Promise<ReadGenerationDocumentResult> {
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from('site_generations')
    .select('id, document, created_at')
    .eq('site_id', siteId)
    // SOLO le righe congelate: una nuova 'generating' (document null) non deve nascondere il
    // documento appena congelato (AC-235-1, finestra P2-D15).
    .not('document', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: true, document: null };

  return { ok: true, document: (data as { document: unknown }).document };
}
