import type { CSSProperties } from 'react';
import { getTranslations } from 'next-intl/server';

// T-408 (macrotask public-serving, P4) — IL BADGE "Made with Belora" del sito pubblicato (P4-D5:
// integrita' free-tier, pre-billing). Reso dalla SERVING (src/app), MAI dal documento del sito:
// per questo non e' ne rimovibile ne spoofabile modificando il documento nell'editor. La rotta lo
// monta ACCANTO a SiteView, FUORI dall'albero del documento — nessun contenuto del documento puo'
// toccarlo.
//
// href E ATTRIBUTI STATICI (A03:2025 / P2-D12). L'href e' una COSTANTE del modulo, mai derivata da
// testo libero del documento: non c'e' il posto dove un javascript: del brief possa diventare
// l'href del badge. Il testo del badge e' un figlio React (escaping preservato, A03:2025): niente
// HTML grezzo iniettato. `rel` chiude la finestra aperta (noopener) e non passa il referrer.
//
// TESTO NEL LOCALE DELLA RIGA. L'etichetta viene da getTranslations({ locale }) sui cataloghi
// (namespace 'site', chiave 'badge'), col locale della RIGA pubblicata passato dalla rotta — mai
// il locale negoziato col browser: un sito italiano mostra il badge in italiano a chiunque.

/** L'URL di destinazione del badge: costante statica, mai derivata da input del documento. */
const BELORA_BADGE_URL = 'https://belora.app';

// Stile inline STATICO: la rotta /s/* non ha una pipeline CSS propria (il layout rende solo
// <html>/<body>), quindi il badge porta il proprio stile, tutto da valori letterali — nessun
// valore proviene dal documento.
const BADGE_STYLE: CSSProperties = {
  position: 'fixed',
  right: '12px',
  bottom: '12px',
  zIndex: 2147483647,
  margin: 0,
};

const LINK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '6px 12px',
  borderRadius: '9999px',
  background: '#111827',
  color: '#ffffff',
  font: '600 13px/1 system-ui, -apple-system, sans-serif',
  textDecoration: 'none',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
};

/**
 * Il badge "Made with Belora" della serving pubblica. Unico input: il `locale` della RIGA
 * pubblicata (per il testo). Nessun input dal documento del sito — href e stile sono costanti.
 */
export async function BeloraBadge({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'site' });
  return (
    <aside data-belora-badge="" style={BADGE_STYLE}>
      <a
        href={BELORA_BADGE_URL}
        target="_blank"
        rel="noopener noreferrer nofollow"
        style={LINK_STYLE}
      >
        {t('badge')}
      </a>
    </aside>
  );
}
