// T-237 (macrotask generation-ui, P2) — BLOCCO OFFERTE: menu, corsi, servizi, catalogo o
// elenco generico secondo il VERTICAL del brief. Le voci NON passano dal modello (P2-D4): sono
// dati del brief (`block.data.offerings`) e il blocco le rende tali e quali; dal modello viene
// solo la cornice (titolo e introduzione, dagli slot). Ogni stringa passa dai figli di React ed
// e' ESCAPED: un nome con un tag <script> o una descrizione con un <iframe> compaiono come
// TESTO, mai come elemento (AC-237-4).
//
// LA VARIANTE (etichetta, layout, se il prezzo si mostra) viene da `resolveOfferings` (T-210),
// la SOLA sede della tabella vertical -> variante: riscriverla qui la farebbe divergere. Il
// vertical arriva da `block.data.vertical` (campo consultato, non reso: P2-D10) — assente,
// l'unica lettura onesta e' la variante generica. L'ETICHETTA della variante e' una CHIAVE
// i18n del catalogo del locale ('site.offerings.*'), mai una stringa inline (AC-237-5).
//
// NESSUN href/src nasce da un campo: la voce dell'offerta nel documento non ha `photo_ref`
// (irrappresentabile, T-202/P2-D12) e non porta alcun link; l'unica immagine e' lo slot del
// tema reso da SiteSection (un riquadro decorativo, mai un <img>), che copre AC-237-2.

import { getTranslations } from 'next-intl/server';
import { SiteSection } from '@/ui/site/SiteSection';
import { siteBlockLabel } from '@/ui/site/labels';
import { resolveOfferings } from '@/domain/generation/blocks';
import type { Brief } from '@/domain/onboarding/brief';
import type { SiteBlockProps } from '@/ui/site/types';

/**
 * La chiave RELATIVA (namespace 'site') dell'etichetta di variante, dalla chiave ASSOLUTA che
 * `resolveOfferings` dichiara ('site.offerings.*'). Il tipo della chiave e' legato al ritorno
 * del dominio: se T-210 aggiungesse una variante, questo record diventerebbe non esaustivo e
 * il typecheck cadrebbe qui — la mappa non puo' divergere in silenzio dalla tabella di monte.
 */
const OFFERINGS_LABEL: Record<
  ReturnType<typeof resolveOfferings>['label_key'],
  'offerings.menu' | 'offerings.courses' | 'offerings.services' | 'offerings.catalog' | 'offerings.generic'
> = {
  'site.offerings.menu': 'offerings.menu',
  'site.offerings.courses': 'offerings.courses',
  'site.offerings.services': 'offerings.services',
  'site.offerings.catalog': 'offerings.catalog',
  'site.offerings.generic': 'offerings.generic',
};

export async function Offerte({ block, locale }: SiteBlockProps) {
  // `t` serve ANCHE per l'etichetta di variante (`OFFERINGS_LABEL[...]`), non solo per il landmark:
  // il catalogo 'site' resta caricato qui, e `siteBlockLabel` risolve la sola etichetta di sezione.
  const t = await getTranslations({ locale, namespace: 'site' });
  const label = await siteBlockLabel(block, locale);

  const title = block.content.offerings_title;
  const intro = block.content.offerings_intro;

  const items = block.data.offerings ?? [];
  // `resolveOfferings` legge SOLO `vertical` e `content.offerings` (T-210): un brief minimo
  // basta, e il locale, richiesto dal tipo Brief ma non usato dalla funzione, e' quello del sito.
  const brief: Brief = {
    vertical: block.data.vertical ?? 'altro',
    locale: locale === 'es' ? 'es' : 'it',
    content: { offerings: items, social_links: [], highlights: [] },
  };
  const variant = resolveOfferings(brief);
  const variantLabel = t(OFFERINGS_LABEL[variant.label_key]);

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2
          className="site-offerings__title"
          style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}
        >
          {title}
        </h2>
      ) : null}
      <p
        className="site-offerings__variant"
        style={{ color: 'var(--site-color-accent)', fontFamily: 'var(--site-font-heading)' }}
      >
        {variantLabel}
      </p>
      {intro ? (
        <p className="site-offerings__intro" style={{ color: 'var(--site-color-text-muted)' }}>
          {intro}
        </p>
      ) : null}
      <ul className="site-offerings__items" data-offerings-layout={variant.layout}>
        {items.map((item, index) => (
          <li
            key={index}
            className="site-offerings__item"
            data-offering-section={item.section ?? undefined}
            style={{ color: 'var(--site-color-text)' }}
          >
            <span className="site-offerings__name" style={{ fontFamily: 'var(--site-font-heading)' }}>
              {item.name}
            </span>
            {item.description ? (
              <span className="site-offerings__description" style={{ color: 'var(--site-color-text-muted)' }}>
                {item.description}
              </span>
            ) : null}
            {variant.show_price && item.price ? (
              <span className="site-offerings__price" style={{ color: 'var(--site-color-accent)' }}>
                {item.price}
              </span>
            ) : null}
            {item.section ? (
              <span className="site-offerings__section" style={{ color: 'var(--site-color-text-muted)' }}>
                {item.section}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </SiteSection>
  );
}
