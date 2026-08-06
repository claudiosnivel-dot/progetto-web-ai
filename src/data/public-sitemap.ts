import { cache } from 'react';
import { createServerSupabaseClient } from '@/data/supabase-ssr';

// T-411 (macrotask seo-base, P4) — LA LETTURA PUBBLICA per la sitemap per-sito. E' la sorella di
// readPublishedSite (T-405), con l'UNICA differenza che serve alla sitemap: proietta anche
// `published_at` (il <lastmod> della sitemap), concesso ad anon dalla migrazione T-411
// (site_publications_grant_published_at_anon). Le difese sono le stesse di T-405, e per le stesse
// ragioni:
//
//  - CLIENT ANON, RLS-BACKED (A01:2025). createServerSupabaseClient per un visitatore senza cookie
//    opera come ruolo Postgres `anon`, MAI la service_role. La RLS anon-published
//    (using is_published = true) restituisce ad anon SOLO le righe pubblicate: il filtro is_published
//    NON e' scritto qui (la colonna non e' concessa ad anon) ed e' la RLS a imporlo, il che rende
//    INDISTINGUIBILI (P1-D21) uno slug inesistente e uno non pubblicato — entrambi -> `null`.
//
//  - GRANT column-level. anon puo' leggere (public_slug, document, locale) da T-401 e ORA anche
//    published_at (T-411). La `select` qui proietta esattamente quelle quattro colonne:
//    account_id / site_id / source_generation_id non sono nominati e non sarebbero comunque leggibili
//    (permission denied). Nessun dato privato del tenant lascia il DB su questa strada.
//
//  - UGUAGLIANZA ESATTA sullo slug: `.eq('public_slug', slug)` — mai `.like`/`.ilike`/prefisso
//    (A03:2025). Lo UNIQUE globale su public_slug garantisce al piu' una riga -> `.maybeSingle()`.
//    Uno slug che e' PREFISSO di uno esistente non seleziona nulla: non e' quello slug.
//
// `document` resta `unknown`: NON e' validato qui. Il gate e' `parseDocument` (T-202), che gira nel
// consumatore (la rotta sitemap) PRIMA di emettere alcun URL — come ovunque nel progetto.

/**
 * Le colonne pubbliche necessarie alla sitemap. `published_at` e' il <lastmod> (nullable: una riga
 * pubblicata lo porta valorizzato, T-403). `document` e' opaco finche' non passa da `parseDocument`.
 */
export type PublishedSiteForSitemap = {
  readonly document: unknown;
  readonly public_slug: string;
  readonly published_at: string | null;
};

/**
 * Lo snapshot pubblicato (colonne per la sitemap) per un public_slug, oppure `null` se nessuno
 * corrisponde — `null` copre in modo INDISTINGUIBILE lo slug inesistente, quello non pubblicato
 * (filtrato dalla RLS anon) e un guasto di lettura (fail-closed): nessun caso rivela l'esistenza di
 * una riga (P1-D21). Il chiamante traduce `null` in `notFound()`.
 *
 * @param slug il public_slug richiesto dall'URL, confrontato per UGUAGLIANZA ESATTA (mai prefisso).
 */
export const readPublishedSiteForSitemap = cache(
  async (slug: string): Promise<PublishedSiteForSitemap | null> => {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('site_publications')
      .select('document, public_slug, published_at')
      .eq('public_slug', slug)
      .maybeSingle();
    if (error) return null;
    return (data as PublishedSiteForSitemap | null) ?? null;
  },
);
