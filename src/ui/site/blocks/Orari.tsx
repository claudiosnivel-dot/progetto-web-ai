// T-237 (macrotask generation-ui, P2) — BLOCCO ORARI: la mappa `giorno -> orario` del brief,
// resa tale e quale (P2-D4). Dal modello viene solo la nota di accompagnamento (gli slot
// `hours_title`/`hours_intro`); gli orari veri sono un dato del brief e non si riscrivono qui.
//
// LA CHIAVE E IL VALORE di ogni voce passano dai figli di React ed sono ESCAPED: sono dati del
// brief e quindi testo NON FIDATO, anche se la forma della chiave e' gia' vincolata a monte
// (T-202). `Object.entries` legge le sole proprieta' PROPRIE, quindi una chiave portata dal
// prototipo della mappa non entra in gioco. Ogni voce e' resa una volta, con i propri valori
// (AC-237-3): nessuna chiave e' dedotta, deduplicata o omessa dal blocco.

import { SiteSection } from '@/ui/site/SiteSection';
import { siteBlockLabel } from '@/ui/site/labels';
import type { SiteBlockProps } from '@/ui/site/types';

export async function Orari({ block, locale }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const title = block.content.hours_title;
  const intro = block.content.hours_intro;
  const entries = Object.entries(block.data.hours ?? {});

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2
          className="site-hours__title"
          style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}
        >
          {title}
        </h2>
      ) : null}
      {intro ? (
        <p className="site-hours__intro" style={{ color: 'var(--site-color-text-muted)' }}>
          {intro}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <dl className="site-hours">
          {entries.map(([day, value]) => (
            <div key={day} className="site-hours__row" data-hours-key={day}>
              <dt className="site-hours__day" style={{ color: 'var(--site-color-text)' }}>
                {day}
              </dt>
              <dd className="site-hours__value" style={{ color: 'var(--site-color-text-muted)' }}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </SiteSection>
  );
}
