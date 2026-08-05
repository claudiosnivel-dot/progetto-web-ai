// T-231 (macrotask generation-ui, P2) — BLOCCO CHI-SIAMO: il racconto dell'attivita'. Non
// rende ALCUN campo del brief direttamente (`brief_fields_rendered: []`, T-210): `description`
// e `highlights` entrano nella proiezione verso il modello (spec §8) e tornano come PROSA
// negli slot `about_body` e `about_points`. E' proprio quella prosa la superficie del testo
// non fidato che AC-231-1 esercita: qui passa dai figli di React ed e' ESCAPED, mai iniettato
// come HTML grezzo. Nessun marcatore di campo del brief compare (AC-231-5), perche' questo
// blocco non legge `block.data`.

import { SiteSection } from '@/ui/site/SiteSection';
import { SiteText } from '@/ui/site/SiteText';
import { siteBlockLabel } from '@/ui/site/labels';
import type { SiteBlockProps } from '@/ui/site/types';

export async function ChiSiamo({ block, locale, editable }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const title = block.content.about_title;
  const body = block.content.about_body;
  const points = block.content.about_points;

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2 style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}>
          <SiteText editable={editable} block={block.id} slot="content.about_title">
            {title}
          </SiteText>
        </h2>
      ) : null}
      {body ? (
        <p style={{ color: 'var(--site-color-text)' }}>
          <SiteText editable={editable} block={block.id} slot="content.about_body">
            {body}
          </SiteText>
        </p>
      ) : null}
      {points && points.length > 0 ? (
        <ul className="site-about__points">
          {points.map((point, index) => (
            <li key={index} style={{ color: 'var(--site-color-text-muted)' }}>
              <SiteText editable={editable} block={block.id} slot={`content.about_points.${index}`}>
                {point}
              </SiteText>
            </li>
          ))}
        </ul>
      ) : null}
    </SiteSection>
  );
}
