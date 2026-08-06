import { cache } from 'react';
import { createServerSupabaseClient } from '@/data/supabase-ssr';

// T-405 (macrotask public-serving, P4) — LA LETTURA PUBBLICA di uno snapshot pubblicato, per la
// rotta standalone /s/<slug>. E' la PRIMA lettura del progetto eseguita per un visitatore SENZA
// sessione: il client e' quello SSR ad anon key + cookie (createServerSupabaseClient), che per un
// visitatore senza cookie opera come ruolo Postgres `anon`, MAI la service_role (A01:2025). Su
// quel ruolo agiscono insieme, senza che questo modulo le ripeta, le due difese di T-401:
//
//  - RLS anon-published — la policy `site_publications_select_anon` (using is_published = true)
//    restituisce ad `anon` SOLO le righe pubblicate. Il filtro is_published NON e' scritto qui e
//    NON e' scrivibile qui: la colonna `is_published` non e' fra quelle concesse ad anon dal GRANT
//    column-level (public_slug, document, locale), quindi nominarla in un `.eq(...)` la
//    interrogherebbe come colonna e prenderebbe un permission denied. E' la RLS a imporre il
//    published-only, in modo trasparente al ruolo — ed e' esattamente cio' che rende
//    INDISTINGUIBILI, da questa strada, uno slug inesistente e uno slug non pubblicato (P1-D21):
//    entrambi filtrano a `null`, mai un errore che riveli l'esistenza della riga.
//
//  - GRANT column-level — anon puo' leggere SOLO (public_slug, document, locale). La `select` qui
//    proietta esattamente quelle tre colonne: account_id / site_id / source_generation_id non sono
//    nominati e non sarebbero comunque leggibili nemmeno interrogandoli. Nessun dato privato del
//    tenant lascia il DB su questa strada (A01:2025).
//
// UGUAGLIANZA ESATTA sullo slug: `.eq('public_slug', slug)` — mai `.like`/`.ilike`/`.filter` con
// input interpolato (A03:2025). Lo UNIQUE globale su public_slug (T-401) garantisce al piu' una
// riga, quindi `.maybeSingle()`. Uno slug che e' PREFISSO di uno esistente non seleziona nulla:
// non e' quello slug.
//
// React `cache()`: layout (che legge `locale` per <html lang>) e page (che legge `document` per il
// render) chiamano questa funzione nello stesso passaggio di render della richiesta; il cache la
// DEDUPLICA a una sola query per richiesta, cosi' la riga non viene letta due volte.
//
// Il `document` restituito e' `unknown`: NON e' validato qui. Il gate e' `parseDocument` (T-202),
// che gira nel consumatore (la page) PRIMA di rendere, come ovunque nel progetto — cio' che si
// rende e' la copia validata, mai il jsonb opaco letto dal DB.

/**
 * Uno snapshot pubblicato leggibile da `anon`: le SOLE colonne pubbliche. `document` e' opaco
 * (`unknown`) finche' non passa da `parseDocument`.
 */
export type PublishedSite = {
  readonly document: unknown;
  readonly public_slug: string;
  readonly locale: string;
};

/**
 * Lo snapshot pubblicato per un public_slug, oppure `null` se nessuno corrisponde. `null` copre in
 * modo INDISTINGUIBILE lo slug inesistente, lo slug non pubblicato (filtrato dalla RLS anon) e un
 * guasto di lettura (fail-closed): nessun caso rivela l'esistenza di una riga (P1-D21). Il
 * chiamante traduce `null` in `notFound()`.
 *
 * Deduplicata per richiesta con React `cache()`: layout e page condividono un'unica query.
 *
 * @param slug il public_slug richiesto dall'URL, confrontato per UGUAGLIANZA ESATTA (mai prefisso).
 */
export const readPublishedSite = cache(async (slug: string): Promise<PublishedSite | null> => {
  const supabase = await createServerSupabaseClient();
  // Proiezione delle SOLE colonne pubbliche; is_published NON e' selezionato (non concesso ad anon)
  // ed e' la RLS anon-published a filtrare il non pubblicato. Uguaglianza esatta su public_slug.
  const { data, error } = await supabase
    .from('site_publications')
    .select('document, public_slug, locale')
    .eq('public_slug', slug)
    .maybeSingle();
  if (error) return null;
  return (data as PublishedSite | null) ?? null;
});
