import { notFound } from 'next/navigation';
import { parseDocument } from '@/domain/generation/document';
import { readPublishedSiteForSitemap } from '@/data/public-sitemap';
import { buildSitemapXml, type SitemapUrlEntry } from '@/domain/generation/sitemap';
import { getSiteBaseUrl } from '@/config/env';

// T-411 (macrotask seo-base, P4) — LA SITEMAP PER-SITO /s/<slug>/sitemap.xml. Un Route Handler
// (GET) che serve, per uno slug PUBBLICATO, l'urlset del sito. Condivide la spina dorsale della
// rotta pubblica (T-405) e ne eredita le tre invarianti di sicurezza:
//
//  1. SOLO IL PUBBLICATO, ANON+RLS (A01:2025). readPublishedSiteForSitemap legge col client anon:
//     la RLS anon-published filtra a `null` lo slug inesistente e quello non pubblicato,
//     INDISTINGUIBILI (P1-D21). `null` -> notFound(): nessuna sitemap per una riga non pubblicata,
//     nessuna enumerazione di righe altrui (il match e' ESATTO su public_slug, mai prefisso/LIKE).
//     account_id / source_generation_id non sono nemmeno letti (GRANT column-level).
//
//  2. GATE PRIMA DI EMETTERE. L'URL si emette dalla COPIA validata da parseDocument, mai dal jsonb
//     opaco: uno snapshot che non passa il gate non produce sitemap (coerente con la rotta pubblica,
//     che per lo stesso snapshot risponderebbe notFound()) — non si liste un URL che poi e' un 404.
//
//  3. URL COSTRUITI DA NOI, VALORI ESCAPED (P2-D12 / A03:2025). La <loc> e' `<base>/s/<public_slug
//     della RIGA>` con base da config (getSiteBaseUrl) e lo slug DELLA RIGA — mai testo libero del
//     brief. buildSitemapXml (dominio puro) XML-escapa ogni valore inserito.
//
// UNA SOLA <url> PER SITO — e non e' una svista dell'enumerazione delle pagine. La rotta pubblica
// /s/<slug> serve l'INTERO documento a URL UNICO (tutte le pagine sono sezioni ancorate della stessa
// pagina; il canonical di T-409 e' proprio `<base>/s/<slug>`): non esiste una rotta per-pagina
// `/s/<slug>/<pageSlug>`, quindi emettere sotto-percorsi elencherebbe URL 404 (soft-404, danno di
// crawl). Il gate parseDocument resta per NON servire una sitemap di uno snapshot che la pagina
// stessa rifiuterebbe. Il <lastmod> e' published_at della publication (assente se, per qualunque
// ragione, la riga non lo porta).

type SitemapContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: SitemapContext): Promise<Response> {
  const { slug } = await context.params;

  // Lettura anon (RLS is_published=true, colonne pubbliche + published_at). Slug inesistente o non
  // pubblicato -> null -> notFound(), indistinguibili (P1-D21).
  const site = await readPublishedSiteForSitemap(slug);
  if (site === null) notFound();

  // GATE: si emette dalla copia validata. Uno snapshot che non passa parseDocument non produce
  // sitemap -> notFound() (coerente col gate del render della rotta pubblica).
  const parsed = parseDocument(site.document);
  if (!parsed.ok) notFound();

  // L'URL canonico del sito, dal public_slug DELLA RIGA e dalla base di config (mai testo libero).
  const entry: SitemapUrlEntry = {
    loc: `${getSiteBaseUrl()}/s/${site.public_slug}`,
    ...(site.published_at !== null ? { lastmod: site.published_at } : {}),
  };
  const xml = buildSitemapXml([entry]);

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
