// T-231 (macrotask generation-ui, P2) — IL RENDERER CONDIVISO del sito generato (P2-D8: "un
// solo renderer per card e anteprima"). `SitePageView` rende UNA pagina del documento
// congelato; `SiteView` rende l'intero documento. Entrambi impostano ALLA RADICE le custom
// property del tema (`siteThemeStyle`), l'unico punto in cui i valori del tema diventano
// stile: i blocchi da qui in giu' riferiscono solo `var(--site-...)`.
//
// CONSUMATORE DI PRODUZIONE (P2-D26): in WF1 questo renderer non ha ancora una rotta che lo
// monti — la card (T-232) e l'anteprima (T-235) di WF2 lo importeranno. Non e' dead-code:
// e' l'interfaccia esportata su cui quei task poggiano, e non si aggiunge una rotta finta per
// "usarlo" (PIN di T-231). `data-block-id` sui blocchi espone la sequenza che AC-232-1
// confrontera' fra card e anteprima.
//
// I blocchi sono RISOLTI prima di comporre l'albero: `renderBlock` e' atteso e il suo
// risultato inserito come elemento gia' pronto, cosi' l'albero non contiene componenti
// asincroni annidati. Un blocco senza componente (un blocco di dati prima di T-237) rende
// `null` ed e' saltato.

import type { ReactElement } from 'react';
import type { SiteDocument, SitePage } from '@/domain/generation/document';
import type { SiteTheme } from '@/domain/generation/themes';
import { siteThemeStyle } from '@/ui/site/theme-style';
import { renderBlock } from '@/ui/site/registry';

export async function SitePageView({
  page,
  theme,
  locale,
  editable,
}: {
  page: SitePage;
  theme: SiteTheme;
  locale: string;
  editable?: boolean;
}) {
  const rendered = await Promise.all(
    page.blocks.map((block) => renderBlock(block, locale, editable)),
  );

  return (
    <div className="site-page" data-site-page={page.slug} style={siteThemeStyle(theme)}>
      {rendered.map((element, index) =>
        element ? (
          <div key={index} className="site-block">
            {element}
          </div>
        ) : null,
      )}
    </div>
  );
}

export async function SiteView({
  document: siteDocument,
  theme,
  locale,
  editable,
}: {
  document: SiteDocument;
  theme: SiteTheme;
  locale: string;
  /**
   * Modalita EDITABLE (T-305, P3): inoltrata a ogni pagina e blocco. Quando true gli slot di
   * testo diventano isole client <EditableText>; quando falsy (default) il render e' identico a
   * quello read-only di P2. Il TEMA e la struttura non cambiano fra le due modalita: cambia solo
   * l'involucro attorno al testo. Renderer UNICO — nessuna copia client dei blocchi (P2-D8).
   */
  editable?: boolean;
}) {
  const pages: ReactElement[] = await Promise.all(
    siteDocument.pages.map((page) => SitePageView({ page, theme, locale, editable })),
  );

  return (
    <div className="site-view" style={siteThemeStyle(theme)}>
      {pages.map((element, index) => (
        <div key={index}>{element}</div>
      ))}
    </div>
  );
}
