// T-231 (macrotask generation-ui, P2) — l'INVOLUCRO condiviso di ogni blocco: un landmark
// <section> col nome i18n della sezione, gli slot immagine, e i figli del blocco. Vive una
// volta sola cosi' che il landmark, il nome accessibile e la resa delle immagini non siano
// riscritti da ogni blocco (e da ogni blocco di dati che T-237 aggiungera').
//
// IL NOME DEL LANDMARK E' L'ETICHETTA i18n (P2-D10), non la prosa del modello: la sezione
// porta come `aria-label` l'etichetta del catalogo del locale, mentre il titolo VISIBILE
// resta la prosa che il modello ha scritto nello slot. Il `data-block-id` espone la sequenza
// dei blocchi resi, che e' cio' su cui T-232 verifichera' che card e anteprima passino dallo
// stesso renderer (AC-232-1).
//
// TUTTI i colori arrivano da `var(--site-...)`, impostate alla radice del render da
// `siteThemeStyle`: nessun valore letterale, come pretende AC-231-4 su tutta la directory.

import type { ReactNode } from 'react';
import type { ImageSlot } from '@/domain/generation/document';
import { SiteImage } from '@/ui/site/SiteImage';

type SiteSectionProps = {
  readonly blockId: string;
  readonly label: string;
  readonly images: readonly ImageSlot[];
  readonly children: ReactNode;
};

export function SiteSection({ blockId, label, images, children }: SiteSectionProps) {
  return (
    <section
      aria-label={label}
      data-block-id={blockId}
      className="site-section"
      style={{
        backgroundColor: 'var(--site-color-surface)',
        color: 'var(--site-color-text)',
        borderColor: 'var(--site-color-border)',
        fontFamily: 'var(--site-font-body)',
        padding: 'var(--site-space-xl)',
      }}
    >
      {images.map((image, index) => (
        <SiteImage key={index} image={image} />
      ))}
      {children}
    </section>
  );
}
