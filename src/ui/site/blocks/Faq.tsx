// T-231 (macrotask generation-ui, P2) — BLOCCO FAQ: domande e risposte. Non rende alcun
// campo del brief (`brief_fields_rendered: []`, T-210): domande e risposte sono prosa del
// modello (slot `faq_items`, kind 'qa'). Ogni stringa passa dai figli di React ed e' ESCAPED
// (AC-231-1); nessun marcatore di campo del brief compare (AC-231-5). Il nome del landmark
// viene dal catalogo del locale (P2-D10), i colori da `var(--site-...)`.

import { SiteSection } from '@/ui/site/SiteSection';
import { SiteText } from '@/ui/site/SiteText';
import { siteBlockLabel } from '@/ui/site/labels';
import type { SiteBlockProps } from '@/ui/site/types';

export async function Faq({ block, locale, editable }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const title = block.content.faq_title;
  const items = block.content.faq_items;

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2 style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}>
          <SiteText editable={editable} block={block.id} slot="content.faq_title">
            {title}
          </SiteText>
        </h2>
      ) : null}
      {items && items.length > 0 ? (
        <dl className="site-faq__items">
          {items.map((item, index) => (
            <div key={index} className="site-faq__item">
              <dt style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}>
                <SiteText editable={editable} block={block.id} slot={`content.faq_items.${index}.question`}>
                  {item.question}
                </SiteText>
              </dt>
              <dd style={{ color: 'var(--site-color-text-muted)' }}>
                <SiteText editable={editable} block={block.id} slot={`content.faq_items.${index}.answer`}>
                  {item.answer}
                </SiteText>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </SiteSection>
  );
}
