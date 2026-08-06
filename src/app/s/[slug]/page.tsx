import { notFound } from 'next/navigation';
import { parseDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SiteView } from '@/ui/site/SiteView';
import { readPublishedSite } from '@/data/public-site';
import { BeloraBadge } from '@/app/s/[slug]/Badge';

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
      {badge}
    </>
  );
}
