import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import type { SitePage } from '@/domain/generation/document';
import type { PageRole } from '@/domain/generation/slots';

// T-235 (macrotask generation-ui, P2) — LA NAVIGAZIONE dell'anteprima, DERIVATA dalle pagine del
// documento congelato: una voce per ciascuna pagina e per NESSUN'ALTRA, e ogni destinazione e'
// uno slug PRESENTE nel documento (AC-235-2). E' una PROIEZIONE del set di pagine, la stessa
// forma di navigationFor (T-213): la destinazione e' COPIATA dallo slug della pagina, quindi non
// esiste modo di emettere una voce verso una pagina che il documento non contiene. Non deduplica
// e non riordina: riproduce l'ordine delle pagine del documento.
//
// UN DOCUMENTO ONE-PAGER (una sola pagina) NON RENDE NAVIGAZIONE (AC-235-4): non c'e' un secondo
// indirizzo dove andare, quindi si restituisce `null` invece di un menu con una voce sola — la
// stessa logica per cui il set di T-213 collassa nella sola home sotto PAGES_MIN.
//
// LE ETICHETTE VENGONO DAL CATALOGO (P2-D10), non dal titolo che il modello ha scritto negli
// slot: il RUOLO della pagina -> chiave i18n 'nav.<ruolo>' del namespace 'site', gli stessi
// label_key che T-213 assegna alle voci di navigazione. La mappa e' TOTALE su PageRole
// (`satisfies`): un ruolo nuovo in T-201 non compila finche' non gli si assegna un'etichetta,
// invece di nascere come una voce senza nome.
//
// LA DESTINAZIONE E' UN'ANCORA #<slug>: l'anteprima rende l'INTERO documento in un'unica pagina
// (SiteView), quindi la navigazione e' un indice interno alle sezioni. Lo slug e' gia' passato
// dalla forma di PageSlugSchema (T-202) quando il documento e' stato congelato — non e' testo
// libero. Gli URL PUBBLICI per pagina sono una decisione di P4 (pubblicazione), non di qui.

// Ruolo di pagina -> chiave dell'etichetta di navigazione, relativa al namespace 'site'. Le
// chiavi coincidono coi label_key di T-213 (una stessa navigazione, qui RESA). TOTALE su
// PageRole: il typecheck obbliga a nominare ogni ruolo del vocabolario di T-201.
const NAV_LABEL_KEY = {
  home: 'nav.home',
  offerings: 'nav.offerings',
  hours: 'nav.hours',
  contact: 'nav.contact',
  reviews: 'nav.reviews',
  faq: 'nav.faq',
} as const satisfies Record<PageRole, string>;

/**
 * L'indice delle pagine del documento reso. `null` per un one-pager (AC-235-4). Le destinazioni
 * sono ancore #<slug> verso le sezioni del documento reso a piena pagina.
 */
export async function PreviewNavigation({
  pages,
  locale,
}: {
  pages: readonly SitePage[];
  locale: string;
}): Promise<ReactElement | null> {
  // ONE-PAGER: nessuna navigazione fra pagine (AC-235-4).
  if (pages.length <= 1) return null;

  const t = await getTranslations({ locale, namespace: 'site' });

  return (
    <nav data-preview-nav className="site-preview-nav">
      <ul>
        {pages.map((page) => (
          <li key={page.slug}>
            <a data-preview-nav-item href={`#${page.slug}`}>
              {t(NAV_LABEL_KEY[page.role])}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
