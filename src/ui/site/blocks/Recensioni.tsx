// T-237 (macrotask generation-ui, P2) — BLOCCO RECENSIONI: titolo e introduzione delle
// testimonianze, dagli slot del pool. Ogni stringa passa dai figli di React ed e' ESCAPED.
//
// IL NODO, dichiarato invece che aggirato (T-210): il blocco ha `precondition: () => false` —
// il brief v1 NON porta alcun campo di recensione (ne testo, ne autore, ne voto), quindi
// `blocksFor` non lo attiva MAI da un brief reale e `resolve` non lo mette in alcun documento
// di produzione. Il componente esiste comunque perche' la DoD di T-237 lo elenca e perche' la
// voce resta nel catalogo: e' esercitabile SOLO da fixture sintetiche (che gli danno gli slot a
// mano). Il giorno in cui una sorgente di recensioni entrera' nel brief, la precondizione
// cambiera' a monte e questo componente sara' gia' pronto a renderla, senza inventare nulla.

import { SiteSection } from '@/ui/site/SiteSection';
import { siteBlockLabel } from '@/ui/site/labels';
import type { SiteBlockProps } from '@/ui/site/types';

export async function Recensioni({ block, locale }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const title = block.content.reviews_title;
  const intro = block.content.reviews_intro;

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2
          className="site-reviews__title"
          style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}
        >
          {title}
        </h2>
      ) : null}
      {intro ? (
        <p className="site-reviews__intro" style={{ color: 'var(--site-color-text-muted)' }}>
          {intro}
        </p>
      ) : null}
    </SiteSection>
  );
}
