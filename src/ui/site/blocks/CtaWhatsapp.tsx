// T-231 (macrotask generation-ui, P2) — BLOCCO CTA WHATSAPP: la riga di invito (prosa dello
// slot `whatsapp_cta_title`) e un bottone verso WhatsApp. Il solo campo del brief che dichiara
// di rendere e' `whatsapp` (T-210), usato come DESTINAZIONE del link: nessun altro campo
// compare (AC-231-5). L'href e' costruito da `safeWhatsappHref`, che valida la forma del
// numero e non produce mai uno schema 'javascript:'; un numero non valido non rende alcun
// link (resta la sola riga di invito). L'ETICHETTA del bottone viene dal catalogo del locale
// (P2-D10), mai dal modello: e' cio' che tiene la CTA fra i valori del codice e non del testo
// non fidato. Ogni stringa di prosa passa dai figli di React ed e' ESCAPED (AC-231-1).

import { getTranslations } from 'next-intl/server';
import { SiteSection } from '@/ui/site/SiteSection';
import { SiteText } from '@/ui/site/SiteText';
import { siteBlockLabel } from '@/ui/site/labels';
import { safeWhatsappHref } from '@/ui/site/blocks/whatsapp';
import type { SiteBlockProps } from '@/ui/site/types';

export async function CtaWhatsapp({ block, locale, editable }: SiteBlockProps) {
  // `t` serve ANCHE per l'etichetta del bottone (`actions.whatsapp`), non solo per il landmark:
  // il catalogo 'site' resta caricato qui, e `siteBlockLabel` risolve la sola etichetta di sezione.
  const t = await getTranslations({ locale, namespace: 'site' });
  const label = await siteBlockLabel(block, locale);

  const invite = block.content.whatsapp_cta_title;
  const href = safeWhatsappHref(block.data.whatsapp);

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {invite ? (
        <p style={{ color: 'var(--site-color-text)' }}>
          <SiteText editable={editable} block={block.id} slot="content.whatsapp_cta_title">
            {invite}
          </SiteText>
        </p>
      ) : null}
      {href ? (
        <a
          className="site-cta__button"
          href={href}
          style={{
            backgroundColor: 'var(--site-color-accent)',
            color: 'var(--site-color-accent-contrast)',
            borderRadius: 'var(--site-radius-pill)',
            fontFamily: 'var(--site-font-body)',
            padding: 'var(--site-space-sm) var(--site-space-lg)',
          }}
        >
          {t('actions.whatsapp')}
        </a>
      ) : null}
    </SiteSection>
  );
}
