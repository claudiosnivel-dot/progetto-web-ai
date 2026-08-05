'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthedClient } from '@/data/authed-client';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';

// T-302 (macrotask editor-core, P3) — SAVE-REVISION: la scrittura post-scelta di una nuova
// revisione 'edited' del documento editato, DIETRO il gate `parseDocument`. E' l'unica porta con
// cui l'editor persiste il lavoro dell'utente sulla tabella append-only site_document_revisions
// (T-301), e ogni disciplina di sicurezza del progetto passa da qui:
//
//  - A05:2025 — GATE IN SCRITTURA. `parseDocument(draft)` gira PRIMA di qualunque round-trip e
//    PRIMA di qualunque scrittura: il draft e input NON FIDATO (incorpora la prosa del modello via
//    il pool e i dati del brief che possono venire da `fromUrl`/`update_brief`), e cio' che
//    raggiunge la colonna jsonb OPACA e' la COPIA validata dal gate (riallineata e RI-gated prima
//    dell'insert, vedi sotto), mai l'ingresso. Un
//    draft che rompe un invariante (slug duplicato, nessuna home, oltre gli 8 MiB, forma non
//    valida) e RIFIUTATO senza scrivere nulla — la stessa disciplina di T-204/T-233.
//    Nota sul vocabolario del gate: `parseDocument` impone ALMENO UNA home (non esattamente una,
//    vedi document.ts), gli slug UNIVOCI e il tetto di byte; e' cio' che decide, non piu'.
//
//  - A01:2025 — CLIENT DI SESSIONE, MAI service_role. La scrittura passa dal client con SESSIONE
//    (`getAuthedClient` -> RLS `is_account_member`), quindi l'isolamento per tenant non poggia sul
//    codice applicativo: la generazione CORRENTE del sito e' leggibile solo se appartiene
//    all'utente, e un site_id di un altro tenant filtra a insieme vuoto -> 404 (anti-enumerazione
//    P1-D21), mai un errore che ne riveli l'esistenza. `account_id` NON arriva dal client: e'
//    DERIVATO dalla riga di site_generations letta sotto RLS, cosi' la WITH CHECK della tabella e
//    la FK composita (account_id, site_generation_id) non possono che vedere l'account proprio.
//
//  - brief_fields_rendered SINCRONIZZATO (carry-over T-241). `brief_fields_rendered` e' il
//    CONTRATTO dei campi non fidati che un blocco rende: T-231/T-237 sanificano cio' che vi e
//    elencato. Un draft editato puo' averlo lasciato divergere dai `data` realmente presenti (un
//    campo elencato ma svuotato). Prima di scrivere lo RIALLINEAMO ai campi effettivamente
//    presenti in `data`, cosi' il contratto resta onesto: la stessa invariante che `resolve`
//    (T-214) mantiene alla nascita del documento (`brief_fields_rendered` === chiavi di `data`).
//
//  - Nessun src/href da testo libero (AC-204-11): lo slot immagine e un'unione discriminata senza
//    alcun campo che possa contenere un indirizzo, e `parseDocument` lo impone. Passando dal gate,
//    il draft non puo' introdurre un `src`/`href` travestito — l'irrappresentabilita' di P2-D12 e
//    preservata per costruzione.

/** L'esito della scrittura di una revisione. Il documento corrente e' la revisione appena scritta. */
export type SaveRevisionResult =
  | { ok: true; document: SiteDocument }
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

// T-303 (macrotask editor-core, P3) — CAP e POTATURA FIFO. Il `document` e' jsonb che puo' pesare
// megabyte (P3-D2): una storia illimitata di snapshot pieni non e' dimensionabile. Teniamo al piu'
// REVISION_CAP revisioni PER GENERAZIONE, potando in FIFO le piu' vecchie (seq minore) a ogni
// nuova scrittura oltre il tetto.
const REVISION_CAP = 20;

/**
 * RIALLINEA `brief_fields_rendered` di ogni blocco ai campi di `data` EFFETTIVAMENTE presenti.
 *
 * Le chiavi di `data` sono per costruzione un sottoinsieme del vocabolario di
 * `brief_fields_rendered` (entrambi derivano da BRIEF_FIELD_NAMES in document.ts), quindi il cast
 * e' sano: cio' che si scrive e' esattamente l'elenco dei campi che il blocco porta davvero. Il
 * riallineamento va in DUE direzioni: un campo elencato ma assente in `data` CADE, e un campo
 * presente in `data` ma non elencato viene AGGIUNTO (entrambe coperte da AC-302-4). L'invariante
 * ristabilita e' la stessa che `resolve` produce alla nascita del documento.
 *
 * L'elenco resta sempre entro il vocabolario e il suo tetto di lunghezza, quindi la FORMA resta
 * valida; ma la direzione ADD ALLUNGA la serializzazione, e il chiamante RI-ATTRAVERSA percio' il
 * gate sul documento riallineato per riverificare il tetto di BYTE (chiusura A05, vedi saveRevision).
 */
function realignBriefFields(document: SiteDocument): SiteDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => ({
        ...block,
        brief_fields_rendered: Object.keys(block.data) as SiteBlock['brief_fields_rendered'],
      })),
    })),
  };
}

/**
 * Persiste una nuova revisione 'edited' del documento del sito, dietro il gate `parseDocument`.
 *
 * @param siteId il sito di cui salvare il documento editato (RLS-backed, mai un id dal client per
 *   scrivere: serve solo a RITROVARE la generazione corrente sotto RLS).
 * @param draft il documento editato, input NON FIDATO: validato da `parseDocument` PRIMA di ogni
 *   scrittura. Cio' che si scrive e' la copia validata e con `brief_fields_rendered` riallineato.
 * @returns `{ ok: true, document }` col documento corrente (la revisione appena scritta); un
 *   `{ ok: false, status }` altrimenti — 400 draft non valido, 401 senza sessione, 404 nessuna
 *   generazione corrente (o sito altrui, anti-enumerazione), 409 corsa persa sullo UNIQUE, 500
 *   guasto di lettura/scrittura.
 */
export async function saveRevision(siteId: string, draft: unknown): Promise<SaveRevisionResult> {
  // GATE A05 — PRIMA di ogni round-trip e di ogni scrittura. Un draft non valido non costa nemmeno
  // una lettura e non puo' toccare la tabella.
  const parsed = parseDocument(draft);
  if (!parsed.ok) return { ok: false, status: 400 };

  // Il contratto dei campi non fidati resi, riallineato ai `data` realmente presenti (T-241). Il
  // riallineamento puo' AGGIUNGERE un nome a brief_fields_rendered (un campo presente in `data` ma
  // non elencato), quindi il documento riallineato puo' PESARE PIU' del draft gia' passato dal gate:
  // lo RI-ATTRAVERSIAMO da `parseDocument` (chiusura del buco A05, D4/T-302). Cosi' cio' che
  // raggiunge la colonna jsonb OPACA e' ESATTAMENTE la copia che il gate ha benedetto — tetto di
  // byte incluso — e un riallineamento che sforasse gli 8 MiB e' 400 senza scrivere nulla.
  const revalidato = parseDocument(realignBriefFields(parsed.document));
  if (!revalidato.ok) return { ok: false, status: 400 };
  const document = revalidato.document;

  // Client di SESSIONE + generazione CORRENTE sotto RLS (openCurrentGeneration, condivisa con
  // restore/list): `account_id` e `site_generation_id` sono DERIVATI da qui, mai dal client; un sito
  // di un altro tenant filtra a null -> 404 (anti-enumerazione P1-D21), l'assenza di sessione -> 401.
  const opened = await openCurrentGeneration(siteId);
  if (!opened.ok) return opened;
  const { supabase, gen } = opened;
  const { id: siteGenerationId, account_id: accountId } = gen;

  // La scrittura 'edited' (writer condiviso persistRevision): seq = max+1 PER GENERAZIONE, poi insert
  // della COPIA validata (mai il draft). Lo UNIQUE (site_generation_id, seq) rende sicura la corsa —
  // la scrittura perdente prende 23505 -> 409.
  const persisted = await persistRevision(supabase, siteGenerationId, accountId, document, 'edited');
  if (!persisted.ok) return persisted;

  // ── POTATURA FIFO oltre REVISION_CAP (T-303) ───────────────────────────────────────────────
  // La revisione e' scritta e DURABILE. Da qui teniamo al piu' REVISION_CAP revisioni per QUESTA
  // generazione, eliminando le piu' vecchie (seq minore). La cancellazione passa dal client di
  // SESSIONE, quindi sotto la RLS DELETE di T-301 (is_account_member): puo' toccare SOLO righe del
  // proprio tenant, mai di un altro — e lo scoping esplicito la vincola a questa sola generazione.
  // `site_generations.document` (la baseline congelata) e' un'ALTRA tabella: la potatura non la
  // nomina mai, quindi resta intatta come fallback del read-path (T-304).
  //
  // Confine: la (REVISION_CAP+1)-esima revisione piu' recente. Se esiste, c'e' overflow e il suo
  // seq e' il PIU' ALTO da eliminare — tutte le piu' vecchie (seq <=) cadono, il che regge anche a
  // un overflow di piu' di una riga. Se non esiste, siamo entro il cap e non si tocca nulla.
  const { data: overflow, error: boundaryErr } = await supabase
    .from('site_document_revisions')
    .select('seq')
    .eq('site_generation_id', siteGenerationId)
    .order('seq', { ascending: false })
    .range(REVISION_CAP, REVISION_CAP)
    .maybeSingle();

  // La potatura e' MANUTENZIONE su una scrittura gia' andata a buon fine: un suo guasto NON annulla
  // il salvataggio dell'utente. Un 500 qui spingerebbe un retry a scrivere una revisione DUPLICATA
  // (nuovo seq), gonfiando la storia invece di potarla; il cap si auto-ripara alla prossima
  // scrittura riuscita. Perche' l'eliminazione superi la RLS DELETE serve solo che account_id sia
  // il proprio — vero per costruzione, essendo derivato dalla riga letta sotto RLS.
  if (!boundaryErr && overflow) {
    const highestSeqToPrune = Number((overflow as { seq: number | string }).seq);
    await supabase
      .from('site_document_revisions')
      .delete()
      .eq('site_generation_id', siteGenerationId)
      .lte('seq', highestSeqToPrune);
  }

  return { ok: true, document };
}

// T-318 (macrotask editor-core, P3) — RIPRISTINO DA STORIA (append-only) + ELENCO REVISIONI. La
// storia delle revisioni (T-301/T-302) diventa NAVIGABILE e RIPRISTINABILE cross-sessione: si sceglie
// una revisione passata e la si riporta a corrente. La disciplina e' la stessa append-only del resto
// del modulo, e ogni difesa passa da qui:
//
//  - APPEND-ONLY, MAI DISTRUTTIVO (AC-318-2). Ripristinare NON riscrive ne elimina la revisione
//    target: scrive una NUOVA revisione (seq massimo+1) COPIA del suo documento, cosi' "l'ultima
//    vince" (read-path T-304) senza toccare cio' che c'era. Nessun UPDATE (la tabella non ha
//    nemmeno la policy, T-301) e nessun DELETE: a differenza di saveRevision NON c'e' potatura FIFO
//    qui — il ripristino e' per contratto non distruttivo, e il cap si riallinea alla prossima
//    saveRevision riuscita. La storia resta INTERA e leggibile.
//
//  - A05:2025 — GATE ANCHE IN RIPRISTINO. Il `document` di una revisione e' jsonb OPACO: il DB non
//    lo valida, e una revisione potrebbe essere stata piantata da una chiamata PostgREST diretta
//    senza passare dal gate applicativo. Prima di riscriverlo lo RI-VALIDIAMO con `parseDocument`, e
//    cio' che raggiunge la nuova riga e' la COPIA validata (`parsed.document`), mai il jsonb grezzo
//    letto. Un documento ripristinato non valido e RIFIUTATO (400) senza scrivere nulla.
//
//  - A01:2025 — CLIENT DI SESSIONE, MAI service_role; OWNERSHIP e SCOPING. Lettura e scrittura
//    passano dal client con SESSIONE (RLS `is_account_member`). La revisione target si cerca per
//    (generazione CORRENTE, revisionSeq): un revisionSeq che vive in un'ALTRA generazione, o in
//    quella di un ALTRO tenant, non e' fra le righe di questa generazione e filtra a null -> 404,
//    nulla scritto (AC-318-3). Un siteId altrui filtra gia' al primo passo (readCurrentGeneration
//    sotto RLS -> null -> 404, anti-enumerazione P1-D21). `account_id` NON arriva dal client: e'
//    DERIVATO dalla riga di site_generations letta sotto RLS.

/** La generazione CORRENTE di un sito: id e account_id derivati sotto RLS (mai dal client). */
type CurrentGeneration = { id: string; account_id: string };

/**
 * La GENERAZIONE CORRENTE del sito — la piu' recente FRA QUELLE CONGELATE (`document not null`), la
 * stessa selezione deterministica di saveRevision e di readGenerationDocument (T-235/T-304, con
 * `id` come spareggio a timestamp uguali). Sotto RLS `is_account_member`: un sito di un altro tenant
 * filtra a `null` (anti-enumerazione P1-D21), mai un errore che ne riveli l'esistenza.
 *
 * @returns `{ ok: true, gen }` con la riga, o `gen: null` se il sito non ha alcuna generazione
 *   congelata (mai generato, oppure di un altro tenant); `{ ok: false }` su guasto di lettura, che
 *   il chiamante traduce in 500.
 */
async function readCurrentGeneration(
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ ok: true; gen: CurrentGeneration | null } | { ok: false }> {
  const { data, error } = await supabase
    .from('site_generations')
    .select('id, account_id')
    .eq('site_id', siteId)
    .not('document', 'is', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, gen: (data as CurrentGeneration | null) ?? null };
}

// ── HELPER CONDIVISI (save / restore / list) ──────────────────────────────────────────────────
// Estratti perche' le tre porte della storia ripetevano lo stesso preambolo di sessione+generazione
// e la stessa disciplina di scrittura: una sola sede per ciascuno, cosi' non possono divergere.

/**
 * IL PREAMBOLO CONDIVISO: apre il client di SESSIONE (RLS attiva, mai service_role — A01:2025) e
 * risolve la generazione CORRENTE del sito sotto RLS. `siteGenerationId` e `account_id` sono DERIVATI
 * dalla riga letta sotto RLS, MAI dal client, cosi' la WITH CHECK e la FK composita non possono che
 * vedere l'account proprio.
 *
 * @returns `{ ok:true, supabase, gen }`; oppure `{ ok:false, status }` — 401 senza sessione, 404
 *   nessuna generazione congelata (o sito di un altro tenant, anti-enumerazione P1-D21), 500 guasto.
 */
async function openCurrentGeneration(
  siteId: string,
): Promise<
  | { ok: true; supabase: SupabaseClient; gen: CurrentGeneration }
  | { ok: false; status: 401 | 404 | 500 }
> {
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  const current = await readCurrentGeneration(supabase, siteId);
  if (!current.ok) return { ok: false, status: 500 };
  if (!current.gen) return { ok: false, status: 404 };
  return { ok: true, supabase, gen: current.gen };
}

/**
 * IL WRITER CONDIVISO di una revisione — l'unica sede in cui si calcola il seq e si inserisce, per
 * saveRevision (source 'edited') E restoreRevision (source 'restored'): comportamento IDENTICO, cosi'
 * la disciplina della corsa vive in un posto solo e non puo' divergere.
 *
 * seq = max(seq)+1 PER GENERAZIONE, letto sotto RLS (solo le revisioni del proprio tenant); con zero
 * revisioni la baseline vale seq 0 e la prima prende 1. La lettura-poi-scrittura NON e' sotto lock:
 * e' lo UNIQUE (site_generation_id, seq) a rendere sicura la corsa — due scritture concorrenti che
 * calcolano lo stesso seq collidono e la perdente prende 23505. Scrive la COPIA gia' validata dal
 * gate (mai un draft) e `account_id` DERIVATO (mai dal client).
 *
 * @param source la provenienza, vincolata dal CHECK di T-301 ('edited' | 'restored' | ...).
 * @returns `{ ok:true }`; oppure `{ ok:false, status }` — 409 corsa persa sullo UNIQUE, 500 guasto.
 */
async function persistRevision(
  supabase: SupabaseClient,
  siteGenerationId: string,
  accountId: string,
  document: SiteDocument,
  source: string,
): Promise<{ ok: true } | { ok: false; status: 409 | 500 }> {
  const { data: ultima, error: seqErr } = await supabase
    .from('site_document_revisions')
    .select('seq')
    .eq('site_generation_id', siteGenerationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seqErr) return { ok: false, status: 500 };
  const seq = (ultima ? Number((ultima as { seq: number | string }).seq) : 0) + 1;

  const { error: insErr } = await supabase.from('site_document_revisions').insert({
    account_id: accountId,
    site_generation_id: siteGenerationId,
    source,
    seq,
    document,
  });
  // 23505 = corsa persa sullo UNIQUE (un altro save ha preso questo seq): conflitto, non guasto.
  if (insErr) return { ok: false, status: insErr.code === '23505' ? 409 : 500 };
  return { ok: true };
}

/** L'esito di un ripristino. Il documento corrente e' la NUOVA revisione appena scritta. */
export type RestoreRevisionResult =
  | { ok: true; document: SiteDocument }
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

/**
 * Ripristina una revisione passata scrivendo una NUOVA revisione (seq massimo+1) copia del suo
 * documento, senza mai distruggere le revisioni esistenti (append-only, "l'ultima vince").
 *
 * @param siteId il sito la cui storia si ripristina (serve solo a RITROVARE la generazione corrente
 *   sotto RLS; un id di un altro tenant filtra a 404).
 * @param revisionSeq il seq della revisione da ripristinare, cercato NELLA SOLA generazione corrente
 *   e per uguaglianza esatta: un seq di un'altra generazione o di un altro tenant non e' raggiungibile.
 * @returns `{ ok: true, document }` col documento corrente (la revisione appena scritta); un
 *   `{ ok: false, status }` altrimenti — 400 documento ripristinato non valido (gate), 401 senza
 *   sessione, 404 nessuna generazione corrente o revisione inesistente/altrui, 409 corsa persa sullo
 *   UNIQUE, 500 guasto di lettura/scrittura.
 */
export async function restoreRevision(
  siteId: string,
  revisionSeq: number,
): Promise<RestoreRevisionResult> {
  // Client di SESSIONE + generazione CORRENTE sotto RLS (openCurrentGeneration): `account_id` e
  // `site_generation_id` DERIVATI, un sito altrui -> null -> 404 (anti-enumerazione), niente sessione -> 401.
  const opened = await openCurrentGeneration(siteId);
  if (!opened.ok) return opened;
  const { supabase, gen } = opened;
  const { id: siteGenerationId, account_id: accountId } = gen;

  // La revisione TARGET: (generazione corrente, revisionSeq), per UGUAGLIANZA ESATTA su seq. Lo
  // scoping alla SOLA generazione corrente, piu' la RLS, e' cio' che rifiuta un revisionSeq di
  // un'ALTRA generazione o di un ALTRO tenant: non essendo fra le righe di questa generazione,
  // filtra a null -> 404, e NULLA e' scritto (AC-318-3). Il confronto e' `.eq` (mai un prefisso):
  // un seq che sia PREFISSO di un altro (1 vs 10) non apre la revisione sbagliata. UNIQUE
  // (site_generation_id, seq) -> al piu' una riga, quindi `maybeSingle`.
  const { data: target, error: targetErr } = await supabase
    .from('site_document_revisions')
    .select('document')
    .eq('site_generation_id', siteGenerationId)
    .eq('seq', revisionSeq)
    .maybeSingle();
  if (targetErr) return { ok: false, status: 500 };
  if (!target) return { ok: false, status: 404 };

  // GATE A05 — il documento della revisione target e' RI-VALIDATO prima di riscriverlo (il jsonb e'
  // opaco, potrebbe essere stato piantato fuori dal gate). Cio' che si riscrive e' la COPIA validata.
  const parsed = parseDocument((target as { document: unknown }).document);
  if (!parsed.ok) return { ok: false, status: 400 };
  const document = parsed.document;

  // APPEND-ONLY: una NUOVA revisione (writer condiviso persistRevision) copia del documento
  // ripristinato — seq = max+1 PER GENERAZIONE, poi insert. Nessun UPDATE e nessun DELETE: le
  // revisioni esistenti restano intatte e leggibili (AC-318-2), e non c'e' potatura FIFO qui. Lo
  // UNIQUE (site_generation_id, seq) rende sicura la corsa (perdente -> 409). `account_id` DERIVATO;
  // `source` fissato a 'restored' (D4): la provenienza di un ripristino e' DISTINTA da un edit
  // manuale, cosi' il picker (listRevisions ritorna source) la mostra per cio' che e' — il CHECK di
  // T-301 include ora 'restored'.
  const persisted = await persistRevision(supabase, siteGenerationId, accountId, document, 'restored');
  if (!persisted.ok) return persisted;

  return { ok: true, document };
}

/**
 * Una voce della storia per la scelta di ripristino: il numero di sequenza, la provenienza
 * (`generated` | `edited` | `rechosen` | `restored`, vincolata dal CHECK di T-301) e l'istante di
 * scrittura. `source` e' tipizzato `string` di proposito: il vocabolario e' imposto dal DB, e
 * ridichiararlo qui sarebbe un secondo elenco capace solo di divergere in silenzio.
 */
export type RevisionSummary = { seq: number; source: string; created_at: string };

export type ListRevisionsResult =
  | { ok: true; revisions: RevisionSummary[] }
  | { ok: false; status: 401 | 404 | 500 };

/**
 * L'elenco delle revisioni della generazione corrente del sito (seq, source, created_at), ordinato
 * per `seq` crescente (cronologico e deterministico), su client di SESSIONE (RLS): la storia da cui
 * l'editor sceglie cosa ripristinare. La baseline `site_generations.document` NON e' una revisione e
 * non compare qui — con zero revisioni l'elenco e' vuoto. Un sito senza generazione congelata (o di
 * un altro tenant, filtrato dalla RLS) -> 404.
 */
export async function listRevisions(siteId: string): Promise<ListRevisionsResult> {
  const opened = await openCurrentGeneration(siteId);
  if (!opened.ok) return opened;
  const { supabase, gen } = opened;

  const { data, error } = await supabase
    .from('site_document_revisions')
    .select('seq, source, created_at')
    .eq('site_generation_id', gen.id)
    .order('seq', { ascending: true });
  if (error) return { ok: false, status: 500 };

  const revisions = (data ?? []).map((row) => {
    const r = row as { seq: number | string; source: string; created_at: string };
    return { seq: Number(r.seq), source: r.source, created_at: r.created_at };
  });
  return { ok: true, revisions };
}
