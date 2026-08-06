'use server';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthedClient } from '@/data/authed-client';
import { readGenerationDocument } from '@/data/generation-document';
import { parseDocument, type SiteDocument } from '@/domain/generation/document';
import { generateUniquePublicSlug } from '@/domain/sites/public-slug';

// T-403 (macrotask publish-core, P4) — PUBLISH: congela il documento CORRENTE di un sito posseduto
// in uno snapshot pubblico (site_publications) dietro il gate `parseDocument`, gli assegna l'identita'
// pubblica (public_slug) e lo porta is_published=true. E' la prima porta con cui un artefatto di
// Belora diventa leggibile da `anon` (via la RLS anon-published di T-401), quindi ogni disciplina di
// sicurezza del progetto passa da qui:
//
//  - A05:2025 — GATE IN SCRITTURA. `parseDocument(document)` gira PRIMA di qualunque scrittura dello
//    snapshot. Il documento corrente e' jsonb OPACO (il DB non lo valida) e potrebbe essere stato
//    piantato da una chiamata PostgREST diretta fuori dal gate applicativo; cio' che raggiunge la
//    colonna `document` di site_publications e' la COPIA validata (`parsed.document`), MAI il
//    riferimento letto. Un documento che rompe un invariante (slug duplicato, nessuna home, oltre gli
//    8 MiB) e' RIFIUTATO (400) senza scrivere nulla — la stessa disciplina di saveRevision (T-302).
//
//  - A01:2025 — CLIENT DI SESSIONE, MAI service_role. Lettura e scrittura passano dal client con
//    SESSIONE (`getAuthedClient` -> RLS `is_account_member`): la generazione CORRENTE del sito e'
//    leggibile solo se appartiene all'utente, e un site_id di un altro tenant filtra a insieme vuoto
//    -> 404 (anti-enumerazione P1-D21), mai un errore che ne riveli l'esistenza. `account_id` NON
//    arriva dal client: e' DERIVATO dalla riga di site_generations letta sotto RLS, cosi' la WITH
//    CHECK della tabella e le FK composite non possono che vedere l'account proprio.
//
//  - SNAPSHOT CONGELATO, DISACCOPPIATO dalla potatura FIFO (P4-D2). La publication vive in una
//    tabella DIVERSA da site_document_revisions (T-301): la potatura FIFO delle revisioni (T-303) non
//    la nomina mai, quindi lo snapshot pubblicato resta invariato anche quando la revisione da cui
//    proviene viene potata. E' una COPIA per valore, non un riferimento.
//
//  - IDENTITA' PUBBLICA ASSEGNATA DAL SERVER. Al PRIMO publish il public_slug e' GENERATO dal server
//    (generateUniquePublicSlug, T-402: derivato dal business_name, dedup, mai un riservato), poi
//    ancorato dal UNIQUE GLOBALE del DB (T-401) contro la race: il generatore e' cortesia, il VINCOLO
//    e' il gate. La SELECT del dedup gira sotto RLS e vede solo il proprio account, quindi uno slug
//    gia' occupato da un ALTRO tenant e' invisibile al generatore: e' l'INSERT a prendere 23505 sullo
//    UNIQUE globale, e la ritentiamo bumpando il suffisso. Al RE-publish il public_slug esistente e'
//    PRESERVATO (identita' stabile): si aggiorna solo il documento/lo stato, mai lo slug.
//
//  - GRATIS (0 crediti) in v1 (P4-D5): publish non consuma la quota di generazione.

/** L'esito di una pubblicazione: lo slug pubblico e l'URL /s/<slug>, oppure un esito d'errore. */
export type PublishSiteResult =
  | { ok: true; public_slug: string; url: string }
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

// Tetto dei tentativi di dedup sullo UNIQUE globale al primo publish: ogni 23505 bumpa il suffisso
// (base -> base-2 -> base-3 -> …), ma un numero PATOLOGICO di collisioni globali non deve girare
// all'infinito. Esaurito il tetto -> 409 (conflitto onesto, non un falso successo).
const MAX_SLUG_ATTEMPTS = 25;

/** La generazione CORRENTE di un sito: id e account_id derivati sotto RLS (mai dal client). */
type CurrentGeneration = { id: string; account_id: string };

/**
 * La GENERAZIONE CORRENTE del sito — la piu' recente FRA QUELLE CONGELATE (`document not null`), la
 * stessa selezione deterministica di readGenerationDocument (T-304, con `id` come spareggio a
 * timestamp uguali), da cui derivano `source_generation_id` e `account_id`. Sotto RLS
 * `is_account_member`: un sito di un altro tenant (o inesistente) filtra a `null` (anti-enumerazione
 * P1-D21), mai un errore che ne riveli l'esistenza.
 *
 * @returns `{ ok: true, value }` con la riga, o `value: null` se il sito non ha alcuna generazione
 *   congelata (mai generato, oppure di un altro tenant); `{ ok: false }` su guasto di lettura, che il
 *   chiamante traduce in 500.
 */
async function readCurrentGeneration(
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ ok: true; value: CurrentGeneration | null } | { ok: false }> {
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
  return { ok: true, value: (data as CurrentGeneration | null) ?? null };
}

/**
 * Pubblica un sito posseduto: congela il documento corrente in uno snapshot pubblico dietro il gate
 * `parseDocument` e gli assegna/conferma un public_slug unico e non riservato.
 *
 * @param siteId il sito da pubblicare (RLS-backed: serve a RITROVARE la generazione corrente sotto
 *   RLS; un id di un altro tenant filtra a 404).
 * @returns `{ ok: true, public_slug, url }` con l'identita' pubblica; un `{ ok: false, status }`
 *   altrimenti — 400 documento corrente non valido (gate), 401 senza sessione, 404 nessuna
 *   generazione corrente (o sito altrui/inesistente, anti-enumerazione), 409 dedup dello slug non
 *   risolto entro il tetto di tentativi, 500 guasto di lettura/scrittura.
 */
export async function publishSite(siteId: string): Promise<PublishSiteResult> {
  // Client di SESSIONE (RLS attiva, mai service_role — A01:2025). L'assenza di sessione -> 401.
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  // La generazione CORRENTE sotto RLS: `source_generation_id` e `account_id` DERIVATI da qui, mai dal
  // client. Un sito di un altro tenant (o inesistente) filtra a null -> 404 (anti-enumerazione P1-D21).
  const current = await readCurrentGeneration(supabase, siteId);
  if (!current.ok) return { ok: false, status: 500 };
  if (!current.value) return { ok: false, status: 404 };
  const { id: sourceGenerationId, account_id: accountId } = current.value;

  // Il DOCUMENTO CORRENTE via read-path "ultima revisione else baseline" (T-304), riusato tale quale.
  // Sotto la stessa sessione, quindi la stessa generazione corrente appena risolta.
  const read = await readGenerationDocument(siteId);
  if (!read.ok) return read;
  // Difensivo: trovata la generazione corrente (document not null), il read-path non puo' che
  // restituire un documento; un null qui sarebbe un'incoerenza, trattata come "niente da pubblicare".
  if (read.document === null) return { ok: false, status: 404 };

  // GATE A05 — PRIMA di ogni scrittura. Cio' che si persiste e' la COPIA validata (`parsed.document`),
  // mai il jsonb opaco letto: un documento non valido e' 400 senza toccare la tabella.
  const parsed = parseDocument(read.document);
  if (!parsed.ok) return { ok: false, status: 400 };
  const document: SiteDocument = parsed.document;

  // RE-PUBLISH: una publication esistente per QUESTO sito (RLS, proprio account). UNIQUE(site_id) ->
  // al piu' una riga. Se c'e', il public_slug e' PRESERVATO (identita' stabile) e si aggiorna solo lo
  // snapshot e lo stato — il brief non serve qui (slug e locale restano quelli del primo publish).
  const { data: existing, error: existingErr } = await supabase
    .from('site_publications')
    .select('public_slug')
    .eq('site_id', siteId)
    .maybeSingle();
  if (existingErr) return { ok: false, status: 500 };

  if (existing) {
    const publicSlug = (existing as { public_slug: string }).public_slug;
    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('site_publications')
      .update({
        document,
        source_generation_id: sourceGenerationId,
        is_published: true,
        published_at: now,
        updated_at: now,
      })
      .eq('site_id', siteId);
    if (updErr) return { ok: false, status: 500 };
    return { ok: true, public_slug: publicSlug, url: `/s/${publicSlug}` };
  }

  // PRIMO publish: il locale e il business_name del sito dal brief (T-120): il locale finisce nello
  // snapshot pubblico, il business_name e' la sorgente dello slug. Un sito con una generazione
  // congelata ha sempre un brief (l'onboarding lo precede); la sua assenza e' un'incoerenza -> 500.
  const { data: brief, error: briefErr } = await supabase
    .from('site_briefs')
    .select('business_name, locale')
    .eq('site_id', siteId)
    .maybeSingle();
  if (briefErr || !brief) return { ok: false, status: 500 };
  const businessName = ((brief as { business_name: string | null }).business_name) ?? '';
  const locale = (brief as { locale: string }).locale;

  // Lo slug e' GENERATO (T-402) e ancorato dal UNIQUE globale del DB (T-401). Il
  // predicato `exists` gira sotto RLS e vede SOLO il proprio account (cortesia di dedup intra-tenant);
  // il dedup GLOBALE autorevole e' l'INSERT che prende 23505 sullo UNIQUE. `tried` accumula gli slug
  // gia' respinti da un 23505 cosi' che il generatore, alla prossima passata, li salti e proponga il
  // successivo libero e NON riservato (isReservedSlug e' gia' dentro generateUniquePublicSlug).
  const existsSameAccount = async (candidate: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from('site_publications')
      .select('id')
      .eq('public_slug', candidate)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  };
  const tried = new Set<string>();
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const publicSlug = await generateUniquePublicSlug(
      businessName,
      async (candidate) => tried.has(candidate) || (await existsSameAccount(candidate)),
    );
    const { error: insErr } = await supabase.from('site_publications').insert({
      account_id: accountId,
      site_id: siteId,
      source_generation_id: sourceGenerationId,
      document,
      public_slug: publicSlug,
      locale,
      is_published: true,
      published_at: new Date().toISOString(),
    });
    if (!insErr) return { ok: true, public_slug: publicSlug, url: `/s/${publicSlug}` };
    // 23505 = corsa persa sullo UNIQUE globale di public_slug (un ALTRO tenant lo detiene, invisibile
    // al dedup sotto RLS): lo slug e' occupato, lo si marca e si ritenta col successivo. Ogni altro
    // codice e' un guasto -> 500.
    if (insErr.code !== '23505') return { ok: false, status: 500 };
    tried.add(publicSlug);
  }
  // Tetto esaurito: troppe collisioni globali consecutive. Conflitto onesto, non un falso successo.
  return { ok: false, status: 409 };
}

// T-404 (macrotask publish-core, P4) — UNPUBLISH: ritira dalla pubblicazione un sito posseduto
// portando is_published=false, senza distruggere lo snapshot ne' l'identita' pubblica. E' l'inverso
// NON distruttivo di publishSite, e ne condivide la disciplina di sicurezza:
//
//  - A01:2025 — CLIENT DI SESSIONE, MAI service_role. La publication e' ritrovata sotto la RLS
//    `is_account_member`: un site_id di un altro tenant (o inesistente, o privo di publication)
//    filtra a insieme vuoto -> 404 (anti-enumerazione P1-D21), mai un errore che ne riveli
//    l'esistenza. La WITH CHECK della policy di UPDATE (account_id invariato) impedisce comunque di
//    spostare la riga verso un account non proprio.
//
//  - NON DISTRUTTIVO. Solo `is_published` passa a false: `document` (lo snapshot congelato) e
//    `public_slug` (l'identita' pubblica) restano INTATTI, la riga NON e' cancellata. Un publishSite
//    successivo trova la riga esistente e ne PRESERVA lo slug (identita' stabile al re-publish).
//
//  - A01:2025 / RLS anon-published. Portato is_published=false, la policy `select_anon`
//    (using is_published = true) smette di restituire la riga ad `anon`: il contenuto non e' alterato,
//    la riga semplicemente sparisce dalla vista pubblica.

/** L'esito di un ritiro dalla pubblicazione: il solo `ok`, oppure un esito d'errore con status. */
export type UnpublishSiteResult =
  | { ok: true }
  | { ok: false; status: 401 | 404 | 500 };

/**
 * Ritira dalla pubblicazione un sito posseduto: porta is_published=false SENZA cancellare la riga,
 * preservando lo snapshot (`document`) e l'identita' pubblica (`public_slug`), cosi' che un
 * publishSite successivo ripubblichi con lo STESSO public_slug.
 *
 * @param siteId il sito da ritirare (RLS-backed: la publication e' ritrovata sotto RLS; un sito di un
 *   altro tenant, inesistente o privo di publication filtra a 404, anti-enumerazione P1-D21).
 * @returns `{ ok: true }` a ritiro avvenuto; un `{ ok: false, status }` altrimenti — 401 senza
 *   sessione, 404 sito altrui/inesistente o senza publication, 500 guasto di lettura/scrittura.
 */
export async function unpublishSite(siteId: string): Promise<UnpublishSiteResult> {
  // Client di SESSIONE (RLS attiva, mai service_role — A01:2025). L'assenza di sessione -> 401.
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  // La publication del sito sotto RLS (proprio account): UNIQUE(site_id) -> al piu' una riga. Un sito
  // di un altro tenant, inesistente o privo di publication filtra a null -> 404 (anti-enumerazione
  // P1-D21), mai un errore che ne riveli l'esistenza.
  const { data: existing, error: existingErr } = await supabase
    .from('site_publications')
    .select('id')
    .eq('site_id', siteId)
    .maybeSingle();
  if (existingErr) return { ok: false, status: 500 };
  if (!existing) return { ok: false, status: 404 };

  // Ritiro NON distruttivo: SOLO is_published passa a false; `document` (lo snapshot) e `public_slug`
  // (l'identita' pubblica) restano INTATTI, la riga non e' cancellata. Il filtro per site_id esatto
  // tocca la sola riga del sito, mai un sibling.
  const { error: updErr } = await supabase
    .from('site_publications')
    .update({ is_published: false, updated_at: new Date().toISOString() })
    .eq('site_id', siteId);
  if (updErr) return { ok: false, status: 500 };
  return { ok: true };
}
