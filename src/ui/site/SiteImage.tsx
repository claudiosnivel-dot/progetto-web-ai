// T-231 (macrotask generation-ui, P2) / T-415 (macrotask media-editor-render, P4) — lo slot
// immagine reso.
//
// Lo slot immagine del documento (T-202) e' un'unione discriminata su `source` e NESSUNA delle
// due varianti ha un campo url/src/href: e' irrappresentabile per tipo (P2-D12). Qui quella
// proprieta' diventa rendering. Un `theme-placeholder` e' un riquadro decorativo riempito con un
// colore del tema (via `var(--site-...)`) e nominato dal suo token in un data-attribute: NON nasce
// alcun <img> ne alcun src da questa variante, quindi il testo libero di un brief non puo' diventare
// una richiesta di rete per questa strada (la prova sull'EFFETTO e' T-241).
//
// Un `uploaded` (da P4) rende un <img> VERO, ma il suo `src` NON viene da testo libero: lo COSTRUIAMO
// noi dal solo `asset_id` (un uuid) tramite l'unico builder `assetPublicUrl` (P4-D6a, src/config), mai
// da un campo del documento — l'unione non ha un campo indirizzo in cui una stringa ostile possa
// entrare (P2-D12). L'<img> e' un elemento React (escaping preservato, nessun HTML grezzo). Il
// riquadro/immagine e' decorativo: `aria-hidden` lo toglie all'albero di accessibilita', `alt=""`.

import type { ImageSlot } from '@/domain/generation/document';
import { assetPublicUrl } from '@/config/storage';

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
    <img
      className="site-image"
      data-image-asset={image.asset_id}
      src={assetPublicUrl(image.asset_id)}
      alt=""
      aria-hidden="true"
      style={style}
    />
  );
}
