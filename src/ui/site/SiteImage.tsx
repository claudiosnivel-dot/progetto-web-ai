// T-231 (macrotask generation-ui, P2) — lo slot immagine reso SENZA un indirizzo di rete.
//
// Lo slot immagine del documento (T-202) e' un'unione discriminata su `source` e NESSUNA
// delle due varianti ha un campo url/src/href: e' irrappresentabile per tipo (P2-D12). Qui
// quella proprieta' diventa rendering: un `theme-placeholder` e' un riquadro decorativo
// riempito con un colore del tema (via `var(--site-...)`) e nominato dal suo token in un
// data-attribute; un `uploaded` (da P4) e' un riquadro neutro nominato dall'id dell'asset.
// In nessun ramo nasce un elemento <img> ne un attributo src/href, quindi il payload di un
// brief NON puo' diventare una richiesta di rete da questa strada (la prova sull'EFFETTO e'
// T-241). Il riquadro e' decorativo: `aria-hidden` lo toglie all'albero di accessibilita'.

import type { ImageSlot } from '@/domain/generation/document';

export function SiteImage({ image }: { image: ImageSlot }) {
  const style = {
    backgroundColor: 'var(--site-color-border)',
    borderRadius: 'var(--site-radius-lg)',
  } as const;

  if (image.source === 'theme-placeholder') {
    return (
      <div className="site-image" data-image-token={image.token} aria-hidden="true" style={style} />
    );
  }
  return (
    <div className="site-image" data-image-asset={image.asset_id} aria-hidden="true" style={style} />
  );
}
