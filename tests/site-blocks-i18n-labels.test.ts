// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { flattenKeys } from '@/i18n/keys';
import { BLOCKS, resolveOfferings } from '@/domain/generation/blocks';
import type { Brief } from '@/domain/onboarding/brief';

// T-231 (macrotask generation-ui, P2) — AC-231-2 (ogni blocco del catalogo T-210 ha la sua
// etichetta in ENTRAMBI i cataloghi i18n) e AC-231-3 (le etichette rese dai blocchi narrativi
// vengono dal catalogo del locale attivo e differiscono fra le due lingue). P2-D10 diventa
// qui una proprieta' verificabile: le etichette sono nostre e vengono dai cataloghi, non dal
// modello.
//
// AC-231-2 e' TOTALE sul catalogo (stessa forma di P1-D24): itera i BLOCCHI veri e, per
// ciascuno, pretende la chiave in it E in es. Un blocco aggiunto a T-210 senza la sua chiave
// fa restituire `undefined` a `blockLabelKey` e rende rosso il controllo.

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

import { blockLabelKey } from '@/ui/site/labels';
import { Hero } from '@/ui/site/blocks/Hero';
import { ChiSiamo } from '@/ui/site/blocks/ChiSiamo';
import { Faq } from '@/ui/site/blocks/Faq';
import { CtaWhatsapp } from '@/ui/site/blocks/CtaWhatsapp';
import type { SiteBlock } from '@/domain/generation/document';
import type { SiteBlockProps } from '@/ui/site/types';

const itKeys = flattenKeys(itMessages);
const esKeys = flattenKeys(esMessages);

afterEach(() => cleanup());

describe('T-231 AC-231-2 — etichette i18n totali sul catalogo dei blocchi', () => {
  it('ogni blocco del catalogo T-210 ha la sua chiave etichetta in it E in es', () => {
    // Piu' di un elemento: il catalogo ha otto blocchi.
    expect(BLOCKS.length).toBeGreaterThan(1);

    for (const block of BLOCKS) {
      const relative = blockLabelKey(block.id);
      expect(relative, `blocco senza chiave etichetta: ${block.id}`).toBeDefined(); // covers: AC-231-2
      const full = `site.${relative}`;
      expect(itKeys.has(full), `manca nel catalogo it: ${full}`).toBe(true); // covers: AC-231-2
      expect(esKeys.has(full), `manca nel catalogo es: ${full}`).toBe(true); // covers: AC-231-2
    }
  });

  it('le etichette delle varianti offerte (una per vertical) esistono in it E in es', () => {
    const verticals = ['ristorazione', 'fitness', 'salone_studio', 'negozio_artigiano', 'altro'] as const;
    // Derivate dal codice del catalogo (resolveOfferings), non inventate: cinque chiavi DISCORDANTI.
    const keys = new Set(
      verticals.map(
        (vertical) =>
          // resolveOfferings legge solo vertical e content.offerings: un brief minimo basta.
          resolveOfferings({ vertical, content: { offerings: [] } } as unknown as Brief).label_key,
      ),
    );
    expect(keys.size).toBe(5);
    for (const key of keys) {
      expect(itKeys.has(key), `manca nel catalogo it: ${key}`).toBe(true); // covers: AC-231-2
      expect(esKeys.has(key), `manca nel catalogo es: ${key}`).toBe(true); // covers: AC-231-2
    }
  });

  it('le etichette di navigazione (un ruolo di pagina, una chiave) esistono in it E in es', () => {
    const navKeys = [
      'site.nav.home',
      'site.nav.offerings',
      'site.nav.hours',
      'site.nav.contact',
      'site.nav.reviews',
      'site.nav.faq',
    ];
    for (const key of navKeys) {
      expect(itKeys.has(key), `manca nel catalogo it: ${key}`).toBe(true); // covers: AC-231-2
      expect(esKeys.has(key), `manca nel catalogo es: ${key}`).toBe(true); // covers: AC-231-2
    }
  });

  it('il controllo e FALSIFICABILE: un blocco senza chiave non e mappato e la chiave non esiste', () => {
    expect(blockLabelKey('blocco-nuovo-non-mappato')).toBeUndefined(); // covers: AC-231-2
    expect(itKeys.has('site.blocks.blocco-nuovo-non-mappato')).toBe(false); // covers: AC-231-2
    expect(esKeys.has('site.blocks.blocco-nuovo-non-mappato')).toBe(false); // covers: AC-231-2
  });
});

describe('T-231 AC-231-3 — etichette dal catalogo del locale, diverse fra it ed es', () => {
  type NarrativeCase = {
    readonly id: string;
    readonly Component: (props: SiteBlockProps) => Promise<ReactElement>;
    readonly block: SiteBlock;
    readonly labelKey: 'hero' | 'chiSiamo' | 'faq' | 'ctaWhatsapp';
  };

  // PIU DI UN blocco narrativo, con contenuti DISCORDANTI.
  const cases: readonly NarrativeCase[] = [
    {
      id: 'hero',
      Component: Hero,
      block: {
        id: 'hero',
        content: { hero_title_kicker: 'Dal 1980', hero_title: 'Pane caldo', hero_subtitle: 'Ogni mattina' },
        data: { business_name: 'Panificio Aurora' },
        brief_fields_rendered: ['business_name'],
        images: [],
      },
      labelKey: 'hero',
    },
    {
      id: 'chi-siamo',
      Component: ChiSiamo,
      block: {
        id: 'chi-siamo',
        content: { about_title: 'La nostra storia', about_body: 'Un forno di quartiere', about_points: ['A mano', 'Ogni giorno'] },
        data: {},
        brief_fields_rendered: [],
        images: [],
      },
      labelKey: 'chiSiamo',
    },
    {
      id: 'faq',
      Component: Faq,
      block: {
        id: 'faq',
        content: { faq_title: 'Domande frequenti', faq_items: [{ question: 'Aperti a pranzo?', answer: 'Si' }] },
        data: {},
        brief_fields_rendered: [],
        images: [],
      },
      labelKey: 'faq',
    },
    {
      id: 'cta-whatsapp',
      Component: CtaWhatsapp,
      block: {
        id: 'cta-whatsapp',
        content: { whatsapp_cta_title: 'Scrivici' },
        data: { whatsapp: '+390551234567' },
        brief_fields_rendered: ['whatsapp'],
        images: [],
      },
      labelKey: 'ctaWhatsapp',
    },
  ];

  const itBlocks = itMessages.site.blocks as Record<string, string>;
  const esBlocks = esMessages.site.blocks as Record<string, string>;

  it('il nome del landmark di ogni blocco narrativo viene dal catalogo del locale e differisce it vs es', async () => {
    for (const testCase of cases) {
      const itContainer = render(await testCase.Component({ block: testCase.block, locale: 'it' })).container;
      const itLabel = itContainer.querySelector(`[data-block-id="${testCase.id}"]`)?.getAttribute('aria-label');
      cleanup();
      const esContainer = render(await testCase.Component({ block: testCase.block, locale: 'es' })).container;
      const esLabel = esContainer.querySelector(`[data-block-id="${testCase.id}"]`)?.getAttribute('aria-label');
      cleanup();

      expect(itLabel).toBe(itBlocks[testCase.labelKey]); // covers: AC-231-3
      expect(esLabel).toBe(esBlocks[testCase.labelKey]); // covers: AC-231-3
      expect(itLabel).not.toBe(esLabel); // covers: AC-231-3
    }
  });

  it('la CTA rende un etichetta di bottone VISIBILE dal catalogo, diversa fra it ed es', async () => {
    const block = cases[3].block;
    const itContainer = render(await CtaWhatsapp({ block, locale: 'it' })).container;
    const itButton = itContainer.querySelector('a.site-cta__button')?.textContent;
    cleanup();
    const esContainer = render(await CtaWhatsapp({ block, locale: 'es' })).container;
    const esButton = esContainer.querySelector('a.site-cta__button')?.textContent;

    expect(itButton).toBe(itMessages.site.actions.whatsapp); // covers: AC-231-3
    expect(esButton).toBe(esMessages.site.actions.whatsapp); // covers: AC-231-3
    expect(itButton).not.toBe(esButton); // covers: AC-231-3
    // Nessuna etichetta e' una stringa inline: quella it non compare quando il locale e' es.
    expect(esButton).not.toBe(itMessages.site.actions.whatsapp); // covers: AC-231-3
  });
});
