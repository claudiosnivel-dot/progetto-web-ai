import { describe, it, expect, vi } from 'vitest';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import type { SiteBlock, SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-314 (macrotask editor-blocks, P3) — ORACOLO del PERCORSO DI PRODUZIONE dell'offerta
// (`composeAddableBlocks`, src/app): compone l'offerta reale brief + baseline + label i18n, SCARTANDO i
// blocchi offerti privi di ISTANZA RISOLTA (model-free, P2-D7) e portando la label di CATALOGO (mai l'id
// grezzo). Chiude il varco di copertura del percorso app rilevato in verifica: le funzioni pure di
// dominio (addableBlocks/findResolvedBlock) erano coperte da editor-add-block.test.ts, ma lo skip e il
// loop delle label nella composizione app non lo erano.
//
// COSA SI MOCKA (solo i SEAM): getBrief e readGenerationDocument (client di sessione/RLS) e
// next-intl/server (catalogo REALE it). addableBlocks, findResolvedBlock, siteBlockLabel e parseDocument
// sono REALI: e' la composizione vera che passa dal gate e attinge le istanze per uguaglianza esatta.

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { locale: string; namespace: string }) => {
    const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

// Gli esiti dei due seam sono pilotati per-test da questi holder (hoisted), letti LAZY a ogni chiamata.
const { briefHolder, docHolder } = vi.hoisted(() => ({
  briefHolder: { current: null as unknown },
  docHolder: { current: null as unknown },
}));
vi.mock('@/data/briefs', () => ({ getBrief: async () => briefHolder.current }));
vi.mock('@/data/generation-document', () => ({ readGenerationDocument: async () => docHolder.current }));

import { composeAddableBlocks } from '@/app/[locale]/editor/[siteId]/addable-blocks';

const THEME = THEMES[0];

/** La label i18n di SEZIONE del catalogo it, per id di blocco (namespace 'site' -> 'blocks.*'). */
function itBlockLabel(key: string): string {
  const blocks = (
    (itMessages as Record<string, unknown>).site as { blocks: Record<string, string> }
  ).blocks;
  return blocks[key];
}

// Un brief RICCO (passa dal validatore vero): tutte le precondizioni della home sono soddisfatte, quindi
// blocksFor(brief, 'home') offre i sette blocchi non-recensioni.
const BASE_PATCH: Record<string, unknown> = {
  business_name: 'Osteria del Ponte',
  vertical: 'ristorazione',
  description: 'Osteria di quartiere, cucina di stagione.',
  address: 'Via dei Mille 4, Bologna',
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@osteriadelponte.it',
  primary_goal: 'prenota',
  highlights: ['Pasta fatta in casa'],
  offerings: [
    { name: 'Tagliere', price: '12,00' },
    { name: 'Zuppa di ceci', price: '9,50' },
  ],
  hours: { 'lun-ven': '9:00-13:00' },
};
function makeBrief() {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), BASE_PATCH);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

/** Un blocco minimo e VALIDO per il gate (content/data vuoti, forma corretta). */
function minimalBlock(id: string): SiteBlock {
  return { id, content: {}, data: {}, brief_fields_rendered: [], images: [] };
}

// Sorgente MULTI-PAGINA valida per parseDocument: la home porta 'hero'; una pagina 'contatti' (ruolo
// contact) porta l'istanza risolta 'contatti'. Cosi' per la home 'contatti' e' OFFERTO (blocksFor:
// precondition vera, e non presente sulla home) E ha un'istanza risolta ALTROVE nel documento -> viene
// incluso; gli altri offerti (offerte/chi-siamo/orari/faq/cta-whatsapp) non hanno istanza nel documento
// -> vengono SCARTATI (model-free, nessuna prosa fabbricata).
function sourceDocument(): SiteDocument {
  return {
    recipe_id: 'ricetta-test@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Home',
        meta_description: 'Meta della home',
        blocks: [minimalBlock('hero')],
      },
      {
        slug: 'contatti',
        role: 'contact',
        title: 'Contatti',
        meta_description: 'Meta dei contatti',
        blocks: [minimalBlock('contatti')],
      },
    ],
  };
}

describe('composeAddableBlocks — offerta di produzione: skip model-free + label di catalogo', () => {
  it('include SOLO i blocchi offerti con un istanza risolta, con la label i18n di catalogo', async () => {
    briefHolder.current = { ok: true, brief: makeBrief() };
    docHolder.current = { ok: true, document: sourceDocument() };

    const offer = await composeAddableBlocks('site-1', 'home', 'it');

    // 'contatti' e' offerto per la home E ha un'istanza risolta (sulla pagina contatti) -> incluso.
    // Gli altri offerti non hanno istanza nel documento -> SCARTATI: l'offerta contiene ESATTAMENTE uno.
    expect(offer.map((o) => o.id)).toEqual(['contatti']);
    // La label e' quella di CATALOGO i18n (pinnata per valore reale), mai l'id grezzo.
    expect(offer[0].label).toBe(itBlockLabel('contatti'));
    expect(offer[0].label).not.toBe('contatti');
    // L'istanza portata e' quella risolta, per id esatto.
    expect(offer[0].block.id).toBe('contatti');
    // Lo skip agisce: blocchi offerti ma privi di istanza NON compaiono (niente prosa fabbricata).
    expect(offer.map((o) => o.id)).not.toContain('offerte');
    expect(offer.map((o) => o.id)).not.toContain('orari');
  });

  it('brief assente (o senza sessione) -> offerta vuota', async () => {
    briefHolder.current = { ok: true, brief: null };
    docHolder.current = { ok: true, document: sourceDocument() };
    expect(await composeAddableBlocks('site-1', 'home', 'it')).toEqual([]);
  });

  it('documento assente (sito mai generato) -> offerta vuota', async () => {
    briefHolder.current = { ok: true, brief: makeBrief() };
    docHolder.current = { ok: true, document: null };
    expect(await composeAddableBlocks('site-1', 'home', 'it')).toEqual([]);
  });
});
