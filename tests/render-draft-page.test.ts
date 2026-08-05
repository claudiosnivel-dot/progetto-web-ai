// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import type { SiteBlock, SiteDocument } from '@/domain/generation/document';

// T-313 (macrotask editor-blocks, P3) — ORACOLO di `renderDraftPage`: l'ANTEPRIMA STRUTTURALE
// server di un DRAFT sul RENDERER UNICO. Le asserzioni derivano dagli acceptance_criteria
// AC-313-1..4, taggate `// covers: AC-313-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next-intl/server getTranslations: risolto dal catalogo REALE it (namespace 'site'), cosi'
//    le etichette dei landmark sono autentiche e l'escaping del testo resta quello vero di React.
//  - @/data/generations getGeneration: il SEAM di OWNERSHIP (RLS, client di sessione). E' il solo
//    confine di sicurezza mockato — restituisce 'posseduto' (generation non-null), 'non posseduto'
//    (generation null, anti-enumerazione P1-D21) o 'senza sessione' (ok:false 401). parseDocument,
//    THEMES, SitePageView, il registry, i blocchi e EditableText NON sono mockati: renderDraftPage
//    valida e rende col RENDERER UNICO reale (P2-D8 / P3-D5), mai una ri-implementazione client.
//
// DISCIPLINA FIXTURE (lezione P1/P2): il documento ha PIU' DI UNA pagina e PIU' DI UN blocco per
// pagina, con contenuti DISCORDANTI (un marcatore distintivo per pagina). La TRAPPOLA DEL PREFISSO
// e' sull'asse su cui renderDraftPage SELEZIONA davvero — lo slug di PAGINA: 'chi-siamo' e' prefisso
// di 'chi-siamo-team', ed e' messo PRIMA nel documento, cosi' un `find(pageSlug.startsWith(p.slug))`
// pescherebbe la pagina sbagliata mentre l'uguaglianza esatta no. Dentro il blocco hero c'e' anche
// la coppia di slot in cui uno e' prefisso dell'altro (hero_title / hero_title_kicker, la trappola
// dichiarata dal catalogo in slots.ts). Gli id di blocco del registry sono dispacciati per
// UGUAGLIANZA ESATTA (Object.hasOwn, registry.ts) e non hanno coppie-prefisso di catalogo.

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

// L'esito di getGeneration e' pilotato per-test da questo holder (hoisted): il mock lo legge LAZY
// a ogni chiamata, cosi' ownership e assenza-sessione si scelgono dentro il singolo `it`.
const { genHolder } = vi.hoisted(() => ({ genHolder: { current: null as unknown } }));
vi.mock('@/data/generations', () => ({ getGeneration: async () => genHolder.current }));

import { renderDraftPage } from '@/app/[locale]/editor/[siteId]/render-draft-page';

const THEME = THEMES[0];

afterEach(() => cleanup());

// ── esiti di ownership ────────────────────────────────────────────────────────
// 'posseduto': getGeneration vede una generazione (RLS l'ha lasciata leggere a questa identita').
// renderDraftPage legge solo la NON-nullita' di `generation`, quindi un oggetto minimo basta.
const OWNED = { ok: true, generation: { id: 'gen-1', site_id: 'site-1', status: 'chosen' } };
// 'non posseduto/inesistente': la generazione filtra a null sotto la RLS (anti-enumerazione).
const NOT_OWNED = { ok: true, generation: null };
// 'senza sessione': getGeneration fallisce 401 (la porta non e' aperta all'anonimo).
const NO_SESSION = { ok: false, status: 401 };

// ── payload OSTILI distinti (stessi di siteview-editable) ─────────────────────
// Uno script e un img con attributo di evento: se il render iniettasse HTML grezzo il primo
// creerebbe un <script>, il secondo un <img onerror> nell'albero.
const SCRIPT_PAYLOAD = '<script>window.__belora_pwned = 1</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__belora_pwned = 2">';

// ── mattoni della fixture ─────────────────────────────────────────────────────
// `sig` e' il marcatore distintivo della pagina: compare nel TESTO reso, cosi' selezione e
// identita' sono osservabili (una fixture con un solo elemento non proverebbe nulla).
function heroBlock(sig: string): SiteBlock {
  return {
    id: 'hero',
    content: {
      // hero_title e' PREFISSO di hero_title_kicker: la trappola del prefisso a livello di slot.
      hero_title_kicker: `occhiello ${sig}`,
      hero_title: `titolo ${sig}`,
      hero_subtitle: `sottotitolo ${sig}`,
    },
    data: { business_name: `Attivita ${sig}` },
    brief_fields_rendered: ['business_name'],
    images: [],
  };
}

function chiSiamoBlock(sig: string): SiteBlock {
  return {
    id: 'chi-siamo',
    content: {
      about_title: `storia ${sig}`,
      about_body: `racconto ${sig}`,
      about_points: [`punto uno ${sig}`, `punto due ${sig}`],
    },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

// Un documento VALIDO per il gate: tre pagine con marcatori discordanti (MARK-HOME / MARK-CHISIAMO
// / MARK-TEAM) e la trappola del prefisso sugli slug ('chi-siamo' prima di 'chi-siamo-team'). Ogni
// pagina ha due blocchi discordanti. theme_id per uguaglianza esatta con un tema di catalogo.
function validDocument(): SiteDocument {
  return {
    recipe_id: 'ricetta-aurora@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Titolo home',
        meta_description: 'Meta della home',
        blocks: [heroBlock('MARK-HOME'), chiSiamoBlock('MARK-HOME')],
      },
      {
        slug: 'chi-siamo',
        role: 'faq',
        title: 'Titolo chi siamo',
        meta_description: 'Meta di chi siamo',
        blocks: [heroBlock('MARK-CHISIAMO'), chiSiamoBlock('MARK-CHISIAMO')],
      },
      {
        slug: 'chi-siamo-team',
        role: 'contact',
        title: 'Titolo team',
        meta_description: 'Meta del team',
        blocks: [heroBlock('MARK-TEAM'), chiSiamoBlock('MARK-TEAM')],
      },
    ],
  };
}

// Come validDocument, ma la pagina 'chi-siamo' porta i payload ostili in due slot di testo.
function hostileDocument(): SiteDocument {
  const doc = validDocument();
  doc.pages[1].blocks[0].content.hero_title = SCRIPT_PAYLOAD;
  doc.pages[1].blocks[1].content.about_body = IMG_PAYLOAD;
  return doc;
}

// Rompe un invariante del gate: slug 'home' DUPLICATO su due pagine (parseDocument lo rifiuta).
function documentSlugDuplicato(): SiteDocument {
  const doc = validDocument();
  doc.pages[1].slug = 'home';
  return doc;
}

// Rompe un invariante del gate: NESSUNA pagina di ruolo 'home' (parseDocument lo rifiuta).
function documentSenzaHome(): SiteDocument {
  const doc = validDocument();
  doc.pages[0].role = 'faq';
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-313-1 — draft valido di un sito posseduto + slug: rende QUELLA pagina col SiteView reale.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-313-1 — rende la pagina selezionata col renderer unico reale', () => {
  it('rende la pagina scelta (SitePageView) e SOLO quella, non l intero documento', async () => {
    genHolder.current = OWNED;

    const element = await renderDraftPage('site-1', validDocument(), 'chi-siamo', 'it');
    expect(element).not.toBeNull(); // covers: AC-313-1

    const container = render(element as ReactElement).container;

    // La pagina resa e' proprio 'chi-siamo': il wrapper del renderer unico porta lo slug esatto.
    expect(container.querySelector('[data-site-page="chi-siamo"]')).not.toBeNull(); // covers: AC-313-1
    // Il suo marcatore distintivo compare nel testo reso.
    expect(container.textContent).toContain('MARK-CHISIAMO'); // covers: AC-313-1
    // E SOLO quella pagina: renderDraftPage rende UNA pagina (SitePageView), non SiteView intero —
    // i marcatori delle altre pagine NON compaiono, ne' i loro wrapper.
    expect(container.textContent).not.toContain('MARK-HOME'); // covers: AC-313-1
    expect(container.textContent).not.toContain('MARK-TEAM'); // covers: AC-313-1
    expect(container.querySelector('[data-site-page="home"]')).toBeNull(); // covers: AC-313-1
    expect(container.querySelector('[data-site-page="chi-siamo-team"]')).toBeNull(); // covers: AC-313-1

    // Entrambi i blocchi discordanti della pagina sono resi (non un solo elemento): titolo hero +
    // titolo della sezione chi-siamo, distinti.
    expect(container.textContent).toContain('titolo MARK-CHISIAMO'); // covers: AC-313-1
    expect(container.textContent).toContain('storia MARK-CHISIAMO'); // covers: AC-313-1
  });

  it('seleziona la pagina per UGUAGLIANZA ESATTA dello slug, mai per prefisso', async () => {
    genHolder.current = OWNED;

    // 'chi-siamo' e' PREFISSO di 'chi-siamo-team' ed e' PRIMA nel documento: un lookup per prefisso
    // (find pageSlug.startsWith(p.slug)) renderebbe 'chi-siamo' invece del team. L'uguaglianza no.
    const element = await renderDraftPage('site-1', validDocument(), 'chi-siamo-team', 'it');
    const container = render(element as ReactElement).container;

    expect(container.querySelector('[data-site-page="chi-siamo-team"]')).not.toBeNull(); // covers: AC-313-1
    expect(container.textContent).toContain('MARK-TEAM'); // covers: AC-313-1
    expect(container.textContent).not.toContain('MARK-CHISIAMO'); // covers: AC-313-1
  });

  it('uno slug di pagina ASSENTE dal documento e rifiutato (nulla reso) — decisione 4', async () => {
    genHolder.current = OWNED;
    const element = await renderDraftPage('site-1', validDocument(), 'pagina-inesistente', 'it');
    expect(element).toBeNull(); // covers: AC-313-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-313-2 — un draft che NON supera parseDocument e' rifiutato: NULLA e' reso.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-313-2 — draft invalido: il gate parseDocument rifiuta prima di rendere', () => {
  it('slug di pagina DUPLICATI -> null (nessun render)', async () => {
    genHolder.current = OWNED;
    // Lo slug passato ESISTE nel draft: il null viene dal gate, non da una pagina assente.
    const element = await renderDraftPage('site-1', documentSlugDuplicato(), 'home', 'it');
    expect(element).toBeNull(); // covers: AC-313-2
  });

  it('NESSUNA pagina di ruolo home -> null', async () => {
    genHolder.current = OWNED;
    const element = await renderDraftPage('site-1', documentSenzaHome(), 'home', 'it');
    expect(element).toBeNull(); // covers: AC-313-2
  });

  it('input che non e un oggetto semplice (stringa) -> null', async () => {
    genHolder.current = OWNED;
    const element = await renderDraftPage('site-1', 'non-un-documento', 'home', 'it');
    expect(element).toBeNull(); // covers: AC-313-2
  });

  it('e FALSIFICABILE: lo STESSO slug su un draft VALIDO rende (il null viene dal gate)', async () => {
    genHolder.current = OWNED;
    const element = await renderDraftPage('site-1', validDocument(), 'home', 'it');
    expect(element).not.toBeNull(); // covers: AC-313-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-313-3 — testo OSTILE reso come TESTO: escaping React preservato, nessuna iniezione.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-313-3 — testo ostile reso come testo (escaping preservato)', () => {
  it('script e img-onerror compaiono ESCAPED come testo, nessun elemento ne evento nasce', async () => {
    genHolder.current = OWNED;

    const element = await renderDraftPage('site-1', hostileDocument(), 'chi-siamo', 'it');
    expect(element).not.toBeNull();
    const container = render(element as ReactElement).container;

    // I due payload compaiono VERBATIM come testo nell'albero reso (asserzione non vacua).
    expect(container.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-313-3
    expect(container.textContent).toContain(IMG_PAYLOAD); // covers: AC-313-3

    // ESCAPED nel markup reso: '&lt;script&gt;' presente, nessun tag <script> letterale.
    expect(container.innerHTML).toContain('&lt;script&gt;'); // covers: AC-313-3
    expect(container.innerHTML).not.toContain('<script>'); // covers: AC-313-3

    // Nessun elemento nasce dal payload: zero <script>, zero <img> (lo slot immagine e' vuoto e in
    // ogni caso e' un riquadro decorativo, non un <img> con src).
    expect(container.querySelectorAll('script')).toHaveLength(0); // covers: AC-313-3
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-313-3

    // Nessun attributo di evento vivo (onerror resta testo), e lo script non e' stato eseguito.
    expect(container.querySelector('[onerror]')).toBeNull(); // covers: AC-313-3
    expect((window as unknown as Record<string, unknown>).__belora_pwned).toBeUndefined(); // covers: AC-313-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-313-4 — sito NON posseduto (o senza sessione): rifiutato per ownership, nulla reso.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-313-4 — ownership sotto RLS: sito non posseduto rifiutato', () => {
  it('getGeneration -> generation null (non posseduto/inesistente): null anche con draft VALIDO', async () => {
    genHolder.current = NOT_OWNED;
    const element = await renderDraftPage('site-1', validDocument(), 'home', 'it');
    expect(element).toBeNull(); // covers: AC-313-4
  });

  it('senza sessione (getGeneration ok:false 401): null', async () => {
    genHolder.current = NO_SESSION;
    const element = await renderDraftPage('site-1', validDocument(), 'home', 'it');
    expect(element).toBeNull(); // covers: AC-313-4
  });

  it('e FALSIFICABILE: lo STESSO draft valido con sito POSSEDUTO rende (il null viene dall ownership)', async () => {
    genHolder.current = OWNED;
    const element = await renderDraftPage('site-1', validDocument(), 'home', 'it');
    expect(element).not.toBeNull(); // covers: AC-313-4
  });
});
