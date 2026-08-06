import type { Metadata } from 'next';
import { readGenerationDocument } from '@/data/generation-document';
import { parseDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SiteView } from '@/ui/site/SiteView';
import { enterPreview } from './guard';
import { PreviewNavigation } from './PreviewNavigation';

// T-411 (macrotask seo-base, P4) — NOINDEX. L'anteprima e' una superficie protetta dell'app (il
// sito NON ancora pubblicato), non una pagina pubblica: non deve MAI finire nell'indice di un motore
// di ricerca. `robots: noindex` (index=false, follow=false) e' difesa in profondita' col Disallow di
// robots.txt (src/app/robots.ts): il robots scoraggia il crawl, questo meta lo impedisce anche se la
// rotta viene raggiunta. Statico (non dipende dai params): la direttiva vale per ogni siteId/locale.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// T-235 (macrotask generation-ui, P2) — ROTTA PROTETTA /{locale}/preview/{siteId}: l'ANTEPRIMA
// NAVIGABILE che rende a PIENA PAGINA il documento CONGELATO.
//
// RENDE IL DOCUMENTO, MAI IL POOL (P2-D5, AC-235-1). Il documento e' l'artefatto che T-233 ha
// congelato e che P3 modifichera'/P4 pubblichera': leggere il pool riporterebbe il sito a essere
// DERIVATO, e ricambierebbe al primo ritocco di una ricetta. La lettura e' `readGenerationDocument`
// (site_generations.document, RLS-backed) — nessuna riga di generation_pools e' toccata. Il
// documento passa SEMPRE da `parseDocument` (T-202) prima di essere reso, come ovunque.
//
// UN SOLO RENDERER (P2-D8): `SiteView` (T-231) sull'INTERO documento — lo STESSO modulo che le
// card del selettore (T-232, via VariantCard) montano. Non esiste un secondo renderer che possa
// divergere da quello che l'utente ha scelto.
//
// LA NAVIGAZIONE e' DERIVATA dalle pagine del documento (PreviewNavigation): una voce per pagina,
// destinazione = uno slug presente (AC-235-2); un one-pager non ne rende alcuna (AC-235-4).
//
// Sicurezza (A01:2025): la rotta e' protetta a DUE livelli — la guardia di route nel middleware
// (/preview e' fra i PROTECTED_SEGMENTS) e il getUser server-side dentro ./guard, che e' l'UNICA
// difesa per un siteId con un punto (il matcher esclude quei pathname). L'anti-enumerazione di
// P1-D21 vive nel guard (AC-235-3). Nessun testo del brief finisce in un href: le destinazioni le
// costruisce PreviewNavigation dallo slug (gia' validato in forma), col '#' davanti.

type PreviewPageProps = {
  params: Promise<{ locale: string; siteId: string }>;
};

export default async function PreviewPage({ params }: PreviewPageProps) {
  const { locale: rawLocale, siteId } = await params;
  const { locale, t } = await enterPreview({ locale: rawLocale, siteId });

  // IL DOCUMENTO da site_generations (mai i pool, DoD/AC-235-1). Il gate e' `parseDocument`.
  const result = await readGenerationDocument(siteId);
  const parsed = result.ok && result.document !== null ? parseDocument(result.document) : null;
  const document = parsed && parsed.ok ? parsed.document : null;
  // Il tema del documento congelato, per UGUAGLIANZA ESATTA dell'id versionato (mai per prefisso):
  // e' cio' che SiteView proietta in var(--site-...). Il ramo `undefined` e' una difesa
  // dichiarata — AC-212-1 pinna che ogni recipe.theme_id esista in THEMES, quindi per un
  // documento reale il tema c'e' sempre; resta per un futuro disallineamento fra i cataloghi.
  const theme = document ? THEMES.find((candidate) => candidate.id === document.theme_id) : undefined;

  // NESSUN documento valido (sito non ancora generato, tema fuori catalogo): stato ESPLICITO, mai
  // un notFound — il sito esiste ed e' tuo, la guardia l'ha gia' accertato.
  if (document === null || theme === undefined) {
    return (
      <main className="site-preview">
        <p data-preview-empty>{t('unavailable')}</p>
      </main>
    );
  }

  // SiteView e' un Server Component ASINCRONO: lo si esegue e si incorpora l'albero gia' pronto,
  // cosi' la pagina non annida un componente asincrono (stessa tecnica di VariantCard).
  const nav = await PreviewNavigation({ pages: document.pages, locale });
  const view = await SiteView({ document, theme, locale });

  return (
    <main className="site-preview">
      {nav}
      {view}
    </main>
  );
}
