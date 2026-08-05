'use server';

import { getAuthedClient } from '@/data/authed-client';

// T-235 (macrotask generation-ui, P2) — LETTURA del DOCUMENTO CONGELATO di un sito, per
// l'anteprima navigabile /preview. Eseguita solo server-side, usa il client Supabase legato
// alla SESSIONE (RLS attiva, is_account_member), MAI la service_role (R7): un site_id di un
// altro tenant filtra a insieme vuoto -> null, mai un errore che ne riveli l'esistenza — la
// stessa scelta di getGeneration (T-203), che conserva l'anti-enumerazione di P1-D21.
//
// T-304 (macrotask editor-core, P3) — READ-PATH "ultima revisione ELSE baseline". Introdotto
// l'editing post-scelta (site_document_revisions, T-301/T-302), il DOCUMENTO CORRENTE del sito
// non e' piu' la sola baseline congelata: e' la revisione con seq MASSIMO della generazione
// corrente, se esiste, altrimenti la baseline `site_generations.document` (comportamento
// pre-editing INVARIATO). Anteprima ed editor leggono cosi' il contenuto editato senza rompere
// il percorso pre-editing. Entrambe le letture — generazione corrente e sua revisione — girano
// sul MEDESIMO client di SESSIONE (RLS): un sito di un altro tenant e' gia' filtrato al primo
// passo e non arriva mai alle sue revisioni. La selezione del corrente usa `seq` (bigint
// monotono), NON created_at, quindi e' DETERMINISTICA anche a timestamp identici (AC-304-3).
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

/** Il documento CORRENTE del sito (ultima revisione else baseline), o `null` se mai generato. */
export type ReadGenerationDocumentResult =
  | { ok: true; document: unknown | null }
  | { ok: false; status: 401 | 500 };

/**
 * Il DOCUMENTO CORRENTE del sito: la revisione con seq MASSIMO della generazione corrente se
 * esiste (editing di T-302), altrimenti la baseline congelata (`site_generations.document`).
 *
 * La GENERAZIONE CORRENTE non e' la generazione piu' recente in assoluto: e' la piu' recente FRA
 * QUELLE CON UN DOCUMENTO (`document not null`). La distinzione e' AC-235-1 e la ragione e'
 * P2-D15: fra il congelamento di un sito e la sua anteprima l'utente puo' aver avviato una NUOVA
 * generazione, che nasce 'generating' con `document` null; se leggessimo la riga piu' recente in
 * assoluto, quella nuova riga NASCONDEREBBE il sito appena congelato e l'anteprima direbbe
 * 'unavailable' su un sito che c'e'. Solo le righe congelate portano un documento — 'chosen' (la
 * sola home) e 'complete' (multi-pagina) lo scrivono, 'generating'/'ready'/'failed'-di-fase-1 no
 * — quindi filtrare a `document not null` e' esattamente "trova l'ultima generazione congelata".
 * Fra le righe congelate resta l'ordinamento DETERMINISTICO di getGeneration (created_at desc, id
 * desc come spareggio).
 *
 * SULLA generazione corrente si legge poi la sua ULTIMA revisione, per seq MASSIMO (T-304): con
 * almeno una revisione vince il suo documento; con zero revisioni resta la baseline congelata
 * (AC-304-1, comportamento pre-editing invariato). L'ordinamento e' su `seq` — bigint monotono,
 * UNIQUE per (site_generation_id, seq) — e NON su created_at: cosi' a timestamp identici vince
 * comunque il seq maggiore, in modo deterministico (AC-304-3).
 *
 * Nessun filtro per account: la RLS di site_generations e di site_document_revisions vincola gia'
 * ogni lettura agli account di cui l'utente e' membro (stessa scelta di getGeneration/listSites),
 * e un site_id altrui filtra a null al primo passo — mai un errore, e non raggiunge mai le sue
 * revisioni (AC-304-4). `.not('document', 'is', null)` e `.eq('site_generation_id', …)` sono
 * metodi tipati con operandi letterali (nessun input interpolato): la disciplina A05:2025 del
 * modulo resta intatta.
 */
export async function readGenerationDocument(
  siteId: string,
): Promise<ReadGenerationDocumentResult> {
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  // 1) La GENERAZIONE CORRENTE: la piu' recente FRA QUELLE CONGELATE (document not null). Una nuova
  //    'generating' (document null) non deve nascondere il documento congelato (AC-235-1, P2-D15).
  const { data: gen, error: genErr } = await supabase
    .from('site_generations')
    .select('id, document, created_at')
    .eq('site_id', siteId)
    .not('document', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (genErr) return { ok: false, status: 500 };
  // Nessuna generazione congelata: il sito non e' mai stato generato (comportamento pre-editing
  // invariato, contratto T-235 preservato). Un sito di un altro tenant filtra qui a null (RLS).
  if (!gen) return { ok: true, document: null };
  const { id: siteGenerationId, document: baseline } = gen as { id: string; document: unknown };

  // 2) L'ULTIMA revisione della generazione corrente: seq MASSIMO. Ordinamento su `seq` (non
  //    created_at) -> deterministico a timestamp uguali (AC-304-3). Stesso client di SESSIONE:
  //    le revisioni di un altro tenant non sono visibili (e comunque il sito altrui e' gia'
  //    filtrato al passo 1, quindi non si arriva nemmeno qui).
  const { data: rev, error: revErr } = await supabase
    .from('site_document_revisions')
    .select('document')
    .eq('site_generation_id', siteGenerationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (revErr) return { ok: false, status: 500 };

  // "Ultima revisione ELSE baseline": con almeno una revisione vince il suo documento (seq
  // massimo); con zero revisioni resta la baseline congelata (AC-304-1).
  if (rev) return { ok: true, document: (rev as { document: unknown }).document };
  return { ok: true, document: baseline };
}
