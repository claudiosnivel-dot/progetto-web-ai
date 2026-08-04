// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, within } from '@testing-library/react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-237 (macrotask generation-ui, P2) — blocchi di DATI, meta' NON ostile:
// AC-237-3 (cinque offerte DISCORDANTI e orari con piu' di una chiave: tutte rese, coi propri
// valori, nessuna duplicata ne omessa) e AC-237-5 (la variante del blocco offerte segue il
// vertical del brief: etichetta e layout DIFFERISCONO, e l'etichetta viene dal catalogo i18n,
// non da una stringa inline). I blocchi sono Server Component asincroni, invocati come funzione
// e il risultato passato a `render`. Le etichette sono lette dal catalogo REALE via il mock di
// next-intl/server (stessa tecnica dei test di T-231).

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = (cat[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

import { Offerte } from '@/ui/site/blocks/Offerte';
import { Orari } from '@/ui/site/blocks/Orari';
import { Recensioni } from '@/ui/site/blocks/Recensioni';
import type { Brief } from '@/domain/onboarding/brief';
import type { SiteBlock } from '@/domain/generation/document';

afterEach(() => cleanup());

// ── fixture builder (LOCALI al file, nessun helper condiviso) ─────────────────

type Offerta = NonNullable<SiteBlock['data']['offerings']>[number];

// CINQUE offerte DISCORDANTI (AC-237-3), con la trappola del PREFISSO: 'Bruschetta' e' prefisso
// di 'Bruschetta al tartufo' e le due condividono la stessa sezione, cosi' un raggruppamento
// scritto con un confronto lasco perderebbe una delle due. Una voce senza prezzo (Tiramisu),
// una senza sezione (Acqua): nomi, prezzi e sezioni tutti diversi.
const OFFERINGS: readonly Offerta[] = [
  { name: 'Bruschetta', price: '5,00 EUR', section: 'Antipasti' },
  { name: 'Bruschetta al tartufo', price: '12,00 EUR', section: 'Antipasti' },
  { name: 'Tagliatelle al ragu', price: '10,00 EUR', section: 'Primi' },
  { name: 'Tiramisu della casa', section: 'Dolci' },
  { name: 'Acqua naturale', price: '2,00 EUR' },
];

function offerteBlock(vertical: Brief['vertical'], offerings: readonly Offerta[]): SiteBlock {
  return {
    id: 'offerte',
    content: { offerings_title: 'La nostra offerta', offerings_intro: 'Prodotti di stagione' },
    data: { vertical, offerings: [...offerings] },
    brief_fields_rendered: ['offerings'],
    images: [{ source: 'theme-placeholder', token: 'offerte' }],
  };
}

describe('T-237 AC-237-3 — tutte le offerte e tutte le chiavi orario rese, coi propri valori', () => {
  it('cinque offerte discordanti: ognuna resa una volta col proprio nome, prezzo e sezione', async () => {
    const block = offerteBlock('ristorazione', OFFERINGS);
    const container = render(await Offerte({ block, locale: 'it' })).container;
    const scope = within(container);

    // Ogni nome e' reso ESATTAMENTE una volta e nell'ordine del brief: nessuna voce omessa,
    // nessuna duplicata. Il confronto e' sull'intero elenco, non su una voce sola.
    const names = [...container.querySelectorAll('.site-offerings__name')].map((n) => n.textContent);
    expect(names).toEqual([
      'Bruschetta',
      'Bruschetta al tartufo',
      'Tagliatelle al ragu',
      'Tiramisu della casa',
      'Acqua naturale',
    ]); // covers: AC-237-3

    // La trappola del prefisso: 'Bruschetta' NON assorbe 'Bruschetta al tartufo'.
    expect(scope.getAllByText('Bruschetta')).toHaveLength(1); // covers: AC-237-3
    expect(scope.getAllByText('Bruschetta al tartufo')).toHaveLength(1); // covers: AC-237-3

    // I prezzi presenti sono resi coi propri valori (ristorazione mostra il prezzo); la voce
    // senza prezzo (Tiramisu) non ne inventa uno: quattro prezzi per cinque voci.
    const prices = [...container.querySelectorAll('.site-offerings__price')].map((p) => p.textContent);
    expect(prices).toEqual(['5,00 EUR', '12,00 EUR', '10,00 EUR', '2,00 EUR']); // covers: AC-237-3

    // Le due voci nella stessa sezione la portano entrambe; la voce senza sezione non la finge.
    const sectioned = [...container.querySelectorAll('[data-offering-section="Antipasti"]')];
    expect(sectioned).toHaveLength(2); // covers: AC-237-3
    expect(container.querySelector('[data-offering-section="Primi"]')).not.toBeNull(); // covers: AC-237-3
    expect(container.querySelectorAll('.site-offerings__item')).toHaveLength(5); // covers: AC-237-3
  });

  it('orari con piu di una chiave: ogni giorno reso col proprio orario, nessuno duplicato ne omesso', async () => {
    // PIU DI UNA chiave, valori DISCORDANTI, e la trappola del prefisso: 'sab' e' prefisso di
    // 'sabato' — un confronto lasco fonderebbe le due voci.
    const hours = { 'lun-ven': '09:00-19:00', sab: '09:00-13:00', sabato: 'Chiuso' };
    const block: SiteBlock = {
      id: 'orari',
      content: { hours_title: 'Quando siamo aperti', hours_intro: 'Orario continuato' },
      data: { hours },
      brief_fields_rendered: ['hours'],
      images: [{ source: 'theme-placeholder', token: 'orari' }],
    };
    const container = render(await Orari({ block, locale: 'it' })).container;

    const rows = [...container.querySelectorAll('.site-hours__row')];
    // Tutte e tre le chiavi rese, una riga per chiave: nessuna omessa, nessuna duplicata.
    const rendered = Object.fromEntries(
      rows.map((row) => [
        row.getAttribute('data-hours-key'),
        row.querySelector('.site-hours__value')?.textContent,
      ]),
    );
    expect(rendered).toEqual({
      'lun-ven': '09:00-19:00',
      sab: '09:00-13:00',
      sabato: 'Chiuso',
    }); // covers: AC-237-3
    expect(rows).toHaveLength(3); // covers: AC-237-3
    // 'sab' e 'sabato' sono due voci DISTINTE, entrambe presenti coi propri valori.
    expect(container.querySelector('[data-hours-key="sab"] .site-hours__value')?.textContent).toBe(
      '09:00-13:00',
    ); // covers: AC-237-3
    expect(container.querySelector('[data-hours-key="sabato"] .site-hours__value')?.textContent).toBe(
      'Chiuso',
    ); // covers: AC-237-3
  });
});

describe('T-237 AC-237-5 — la variante offerte segue il vertical, etichetta dal catalogo', () => {
  it('ristorazione vs salone_studio: etichetta e layout differiscono e vengono dal catalogo', async () => {
    // Due documenti IDENTICI tranne il vertical (stesse cinque offerte), montati nello stesso locale.
    const ristBlock = offerteBlock('ristorazione', OFFERINGS);
    const saloneBlock = offerteBlock('salone_studio', OFFERINGS);

    const rist = render(await Offerte({ block: ristBlock, locale: 'it' })).container;
    const ristLabel = rist.querySelector('.site-offerings__variant')?.textContent;
    const ristLayout = rist.querySelector('.site-offerings__items')?.getAttribute('data-offerings-layout');
    cleanup();
    const salone = render(await Offerte({ block: saloneBlock, locale: 'it' })).container;
    const saloneLabel = salone.querySelector('.site-offerings__variant')?.textContent;
    const saloneLayout = salone
      .querySelector('.site-offerings__items')
      ?.getAttribute('data-offerings-layout');

    // L'etichetta DIFFERISCE fra i due vertical e proviene dal catalogo i18n (T-210: menu vs servizi).
    expect(ristLabel).toBe(itMessages.site.offerings.menu); // covers: AC-237-5
    expect(saloneLabel).toBe(itMessages.site.offerings.services); // covers: AC-237-5
    expect(ristLabel).not.toBe(saloneLabel); // covers: AC-237-5

    // Il LAYOUT segue la variante dichiarata in T-210 e differisce.
    expect(ristLayout).toBe('menu-sections'); // covers: AC-237-5
    expect(saloneLayout).toBe('service-list'); // covers: AC-237-5
    expect(ristLayout).not.toBe(saloneLayout); // covers: AC-237-5
  });

  it('l etichetta della variante e locale-driven dal catalogo, non una stringa inline (it vs es)', async () => {
    const block = offerteBlock('ristorazione', OFFERINGS);
    const itContainer = render(await Offerte({ block, locale: 'it' })).container;
    const itLabel = itContainer.querySelector('.site-offerings__variant')?.textContent;
    cleanup();
    const esContainer = render(await Offerte({ block, locale: 'es' })).container;
    const esLabel = esContainer.querySelector('.site-offerings__variant')?.textContent;

    expect(itLabel).toBe(itMessages.site.offerings.menu); // covers: AC-237-5
    expect(esLabel).toBe(esMessages.site.offerings.menu); // covers: AC-237-5
    expect(itLabel).not.toBe(esLabel); // covers: AC-237-5
  });
});

// T-237 RECENSIONI — il blocco e' REGISTRATO ma finora esercitato SOLO da `typeof` (il pin del
// registry in site-blocks-narrative): il suo RENDER non era mai stato invocato, quindi qualunque
// mutazione al corpo di Recensioni (slot sbagliato, etichetta cambiata) sarebbe passata. Qui lo
// si RENDE su una fixture sintetica — l'unica strada, perche' la voce di catalogo ha
// `precondition: () => false` e nessun documento di produzione la porta — e si pinnano titolo,
// introduzione ed etichetta i18n.
describe('T-237 recensioni — il blocco RESO: titolo, introduzione ed etichetta i18n dal catalogo', () => {
  function recensioniBlock(): SiteBlock {
    return {
      id: 'recensioni',
      content: {
        reviews_title: 'Cosa dicono i clienti',
        reviews_intro: 'Le testimonianze di chi ci ha scelto',
      },
      data: {},
      brief_fields_rendered: [],
      images: [{ source: 'theme-placeholder', token: 'recensioni' }],
    };
  }

  it('rende reviews_title e reviews_intro nei propri slot, con l etichetta blocks.recensioni', async () => {
    const container = render(await Recensioni({ block: recensioniBlock(), locale: 'it' })).container;

    // Titolo e intro escono dai LORO slot (valori DISCORDANTI): uno scambio di slot li rende
    // visibili l'uno al posto dell'altro.
    expect(container.querySelector('.site-reviews__title')?.textContent).toBe(
      'Cosa dicono i clienti',
    ); // covers: T-237 recensioni
    expect(container.querySelector('.site-reviews__intro')?.textContent).toBe(
      'Le testimonianze di chi ci ha scelto',
    ); // covers: T-237 recensioni

    // L'etichetta del landmark viene dal catalogo (blockLabelKey('recensioni') -> blocks.recensioni),
    // non da una stringa inline ne dal fallback all'id: cambiare la labelKey la fa divergere.
    const label = container.querySelector('[data-block-id="recensioni"]')?.getAttribute('aria-label');
    expect(label).toBe(itMessages.site.blocks.recensioni); // covers: T-237 recensioni
    expect(label).not.toBe('recensioni'); // covers: T-237 recensioni  (non e' il fallback all'id)
  });

  it('l etichetta e locale-driven dal catalogo (it vs es), non una stringa inline', async () => {
    const itContainer = render(await Recensioni({ block: recensioniBlock(), locale: 'it' })).container;
    const itLabel = itContainer.querySelector('[data-block-id="recensioni"]')?.getAttribute('aria-label');
    cleanup();
    const esContainer = render(await Recensioni({ block: recensioniBlock(), locale: 'es' })).container;
    const esLabel = esContainer.querySelector('[data-block-id="recensioni"]')?.getAttribute('aria-label');

    expect(itLabel).toBe(itMessages.site.blocks.recensioni); // covers: T-237 recensioni
    expect(esLabel).toBe(esMessages.site.blocks.recensioni); // covers: T-237 recensioni
    expect(itLabel).not.toBe(esLabel); // covers: T-237 recensioni
  });
});
