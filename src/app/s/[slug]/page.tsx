import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parseDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SiteView } from '@/ui/site/SiteView';
import { readPublishedSite } from '@/data/public-site';
import { BeloraBadge } from '@/app/s/[slug]/Badge';
import { extractBusinessInfo, seoTitle, seoDescription } from '@/domain/generation/site-seo';
import { buildLocalBusinessJsonLd, serializeJsonLdSafe } from '@/domain/generation/jsonld';
import { getSiteBaseUrl } from '@/config/env';
import { getBrandName } from '@/config/brand';
import { assetPublicUrl } from '@/config/storage';

// T-405 (macrotask public-serving, P4) — LA ROTTA PUBBLICA /s/<slug>: rende A PIENA PAGINA, per un
// visitatore SENZA sessione, lo snapshot pubblicato del sito. E' la variante anon+standalone
// dell'anteprima /{locale}/preview (T-235), e ne condivide la spina dorsale — leggi -> parseDocument
// -> THEMES.find -> SiteView (un solo renderer, P2-D8) — ma con tre differenze di sicurezza:
//
//  1. LETTURA ANON, RLS-BACKED (A01:2025). Il documento arriva da readPublishedSite (client SSR ad
//     anon key, RLS anon-published + GRANT column-level su document/public_slug/locale). L'anteprima
//     era protetta e localizzata; qui non c'e' sessione, e le difese vivono nel DB (T-401).
//
//  2. ANTI-ENUMERAZIONE (P1-D21). Slug INESISTENTE e slug NON PUBBLICATO sono INDISTINGUIBILI: la
//     lettura anon li filtra entrambi a `null` (la RLS non restituisce il non pubblicato, il column
//     GRANT non permette nemmeno di nominare is_published), e `null` -> notFound() (404). Nessun
//     403, nessun corpo che riveli che la riga esiste ma non e' pubblicata.
//
//  3. LANG DALLA RIGA. Il locale del render (e il lang del documento, nel layout) e' quello dello
//     snapshot pubblicato, MAI il locale negoziato col browser: un sito italiano si serve in
//     italiano a chiunque.
//
// GATE IN RENDER (A05:2025). Cio' che si rende e' `parsed.document`, la COPIA validata da
// parseDocument — mai il jsonb opaco letto dal DB. Un documento che non passa il gate (uno snapshot
// piantato fuori dal percorso applicativo, o un tema fuori catalogo) -> notFound(): niente di non
// validato raggiunge SiteView. Il testo non fidato del brief esce SOLO come figli di React (escaping
// di SiteView, renderer unico): nessun dangerouslySetInnerHTML, nessun src/href da testo libero.

type PublicSitePageProps = {
  params: Promise<{ slug: string }>;
};

// T-409 (macrotask seo-base, P4) — I METADATI della pagina pubblica, dallo STESSO snapshot pubblicato
// che rende la page (readPublishedSite, cache()d e condiviso: nessuna seconda query, nessuna lettura
// di bozze/revisioni). Tre invarianti di sicurezza, gli stessi della page:
//
//  1. SOLO IL PUBBLICATO. La lettura anon+RLS filtra a `null` lo slug inesistente e quello non
//     pubblicato, INDISTINGUIBILI (P1-D21): `null` -> notFound(), nessun metadato di una riga non
//     pubblicata. account_id / source_generation_id non sono nemmeno letti (GRANT column-level).
//
//  2. GATE PRIMA DI DERIVARE. I metadati nascono dalla COPIA validata da parseDocument, mai dal jsonb
//     opaco: uno snapshot che non passa il gate non produce metadati (coerente col gate del render).
//
//  3. URL COSTRUITI DA NOI, MAI DA TESTO LIBERO (P2-D12). canonical e og:url sono `<base>/s/<slug>`
//     con base da config (getSiteBaseUrl) e lo slug DELLA RIGA; og:image e' assetPublicUrl(asset_id)
//     e compare SOLO per un hero uploaded — mai un token del tema ne testo del brief come indirizzo.
//     og:locale e' il locale DELLA RIGA (site.locale), come il <html lang> del layout: un sito
//     italiano si annuncia in italiano a chiunque, non nel locale negoziato col browser.
export async function generateMetadata({ params }: PublicSitePageProps): Promise<Metadata> {
  const { slug } = await params;

  const site = await readPublishedSite(slug);
  if (site === null) notFound();

  const parsed = parseDocument(site.document);
  if (!parsed.ok) notFound();

  // Estrazione PURA (dominio): nome/tagline/hero dai blocchi. L'hero e' il PRIMO ImageSlot uploaded
  // (home prima, poi il resto): un placeholder del tema non e' un hero.
  const info = extractBusinessInfo(parsed.document);

  const canonical = `${getSiteBaseUrl()}/s/${site.public_slug}`;
  const title = seoTitle(info, getBrandName());
  const description = seoDescription(info);
  // og:image SOLO per un hero uploaded, costruito dall'asset_id: mai un token del tema ne testo libero.
  const image = info.heroAssetId !== undefined ? assetPublicUrl(info.heroAssetId) : undefined;

  const metadata: Metadata = {
    title,
    ...(description !== undefined ? { description } : {}),
    alternates: { canonical },
    openGraph: {
      title,
      ...(description !== undefined ? { description } : {}),
      type: 'website',
      url: canonical,
      locale: site.locale,
      ...(image !== undefined ? { images: [image] } : {}),
    },
    twitter: { card: 'summary_large_image' },
  };
  return metadata;
}

export default async function PublicSitePage({ params }: PublicSitePageProps) {
  const { slug } = await params;

  // Lettura anon (RLS is_published=true, colonne pubbliche), condivisa col layout via cache(). Uno
  // slug inesistente o non pubblicato filtra a null -> notFound(), indistinguibili (P1-D21).
  const site = await readPublishedSite(slug);
  if (site === null) notFound();

  // GATE: cio' che si rende e' la copia validata. Uno snapshot che non passa parseDocument non
  // raggiunge il renderer -> notFound() (nessun render fuori dal gate).
  const parsed = parseDocument(site.document);
  if (!parsed.ok) notFound();
  const document = parsed.document;

  // Il tema del documento per UGUAGLIANZA ESATTA dell'id versionato (mai per prefisso). Un tema
  // fuori dal catalogo e' un'anomalia di uno snapshot pubblicato: notFound(), mai un render parziale.
  const theme = THEMES.find((candidate) => candidate.id === document.theme_id);
  if (theme === undefined) notFound();

  // T-410 (macrotask seo-base, P4) — JSON-LD LocalBusiness dallo STESSO documento validato che rende
  // la pagina. I campi del brief (nome/indirizzo/telefono/orari) sono NON FIDATI: la stringa
  // iniettata e' GIA' ESCAPED da serializeJsonLdSafe (< > & U+2028 U+2029 -> \uXXXX) e va nel
  // <script> come FIGLIO TESTUALE, mai innerHTML grezzo — cosi' la sequenza di chiusura del tag non
  // e' rappresentabile e nessun testo del brief diventa markup attivo (A03:2025). L'immagine del
  // JSON-LD nasce dallo stesso hero uploaded dei metadati: assetPublicUrl(asset_id), URL nostro dello
  // Storage costruito dall'id (P2-D12), mai testo libero; assente se non c'e' un hero uploaded.
  const info = extractBusinessInfo(document);
  const heroImage = info.heroAssetId !== undefined ? assetPublicUrl(info.heroAssetId) : undefined;
  const jsonLd = serializeJsonLdSafe(buildLocalBusinessJsonLd(info, { image: heroImage }));

  // SiteView e' un Server Component ASINCRONO: lo si esegue e si incorpora l'albero gia' pronto, come
  // nell'anteprima. Locale = quello della RIGA (site.locale), mai del browser. Read-only (editable
  // falsy di default): render identico a P2, nessuna isola client.
  const view = await SiteView({ document, theme, locale: site.locale });

  // BADGE "Made with Belora" (T-408, P4-D5): montato dalla SERVING, FUORI dall'albero del documento
  // (fratello del <main>, mai dentro SiteView). Non e' ne rimovibile ne spoofabile dal documento;
  // href e attributi sono costanti statiche, il testo e' nel locale della RIGA. Server Component
  // asincrono: eseguito e incorporato come elemento gia' pronto, come SiteView.
  const badge = await BeloraBadge({ locale: site.locale });

  return (
    <>
      <main className="site-public">{view}</main>
      {/* JSON-LD LocalBusiness: figlio TESTUALE gia' escaped (T-410), mai innerHTML grezzo. Fuori
          dall'albero del documento (fratello del <main>), come il badge. */}
      <script type="application/ld+json">{jsonLd}</script>
      {badge}
    </>
  );
}
