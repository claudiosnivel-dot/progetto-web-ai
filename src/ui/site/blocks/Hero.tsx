// T-231 (macrotask generation-ui, P2) — BLOCCO HERO: l'apertura della home. La prosa
// (occhiello, titolo, sottotitolo) viene dagli slot del pool; il NOME dell'attivita' e' il
// solo campo del brief che questo blocco dichiara di rendere (`brief_fields_rendered:
// ['business_name']`, T-210). Rende SOLO quello dei dati del brief: nessun altro campo, anche
// se il documento lo portasse (AC-231-5). Ogni stringa passa dai figli di React, quindi il
// testo non fidato e' ESCAPED e non puo' aprire elementi (AC-231-1). Le etichette (il nome
// del landmark) vengono dal catalogo del locale (P2-D10), i colori da `var(--site-...)`.

import { SiteSection } from '@/ui/site/SiteSection';
import { SiteText } from '@/ui/site/SiteText';
import { siteBlockLabel } from '@/ui/site/labels';
import type { SiteBlockProps } from '@/ui/site/types';

export async function Hero({ block, locale, editable }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const kicker = block.content.hero_title_kicker;
  const title = block.content.hero_title;
  const subtitle = block.content.hero_subtitle;
  const businessName = block.data.business_name;

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {businessName ? (
        <p
          className="site-hero__brand"
          style={{ color: 'var(--site-color-accent)', fontFamily: 'var(--site-font-heading)' }}
        >
          <SiteText editable={editable} block={block.id} slot="data.business_name">
            {businessName}
          </SiteText>
        </p>
      ) : null}
      {kicker ? (
        <p className="site-hero__kicker" style={{ color: 'var(--site-color-text-muted)' }}>
          <SiteText editable={editable} block={block.id} slot="content.hero_title_kicker">
            {kicker}
          </SiteText>
        </p>
      ) : null}
      {title ? (
        <h1
          className="site-hero__title"
          style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}
        >
          <SiteText editable={editable} block={block.id} slot="content.hero_title">
            {title}
          </SiteText>
        </h1>
      ) : null}
      {subtitle ? (
        <p className="site-hero__subtitle" style={{ color: 'var(--site-color-text-muted)' }}>
          <SiteText editable={editable} block={block.id} slot="content.hero_subtitle">
            {subtitle}
          </SiteText>
        </p>
      ) : null}
    </SiteSection>
  );
}
