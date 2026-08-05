// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { THEMES } from '@/domain/generation/themes';
import type { SiteBlock, SiteDocument } from '@/domain/generation/document';
import { SiteText } from '@/ui/site/SiteText';

// T-305 (macrotask editor-core, P3) — SiteView in modalita EDITABLE. Le asserzioni derivano
// dagli acceptance_criteria di 01-editor-core.md (AC-305-1..3), taggate `// covers:` sulla
// riga dell'EXPECT. Test HERMETIC (jsdom): nessuna auth Supabase, nessun DB — si monta il
// RENDERER UNICO (SiteView) su un documento in memoria e si guarda l'albero reso.
//
// Cosa si mocka e perche' non e' hollow: solo `next-intl/server` getTranslations, risolto dal
// catalogo REALE it (namespace 'site'), cosi' le etichette dei landmark sono autentiche e
// l'escaping del testo resta quello vero di React. SiteView, il registry, i blocchi e
// EditableText NON sono mockati: rendono per davvero.

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

import { SiteView } from '@/ui/site/SiteView';

const THEME = THEMES[0];

afterEach(() => cleanup());

// ── payload OSTILI distinti ───────────────────────────────────────────────────
// Un tag script e un tag img con un attributo di evento: se la superficie editor iniettasse
// HTML grezzo il primo creerebbe un <script>, il secondo un <img onerror> nell'albero.
const SCRIPT_PAYLOAD = '<script>window.__belora_pwned = 1</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__belora_pwned = 2">';

// ── fixture di dominio ────────────────────────────────────────────────────────
// Disciplina fixture (P1, ripetuta in P3-D9 §9): PIU' DI UN blocco, valori DISCORDANTI, e uno
// slot id che e' il PREFISSO di un altro. Hero porta 'hero_title' e 'hero_title_kicker': lo slot
// id 'content.hero_title' e' prefisso di 'content.hero_title_kicker', la trappola con cui un
// lookup per prefisso confonderebbe due campi distinti.
function heroBlock(): SiteBlock {
  return {
    id: 'hero',
    content: {
      hero_title_kicker: 'Forno dal 1980',
      hero_title: SCRIPT_PAYLOAD,
      hero_subtitle: 'Lievito madre e farine locali',
    },
    data: { business_name: 'Panificio Aurora' },
    brief_fields_rendered: ['business_name'],
    images: [],
  };
}

function chiSiamoBlock(): SiteBlock {
  return {
    id: 'chi-siamo',
    content: {
      about_title: 'La nostra storia',
      about_body: IMG_PAYLOAD,
      about_points: ['Farine del territorio', 'Impastiamo a mano ogni giorno'],
    },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

function hostileDocument(): SiteDocument {
  return {
    recipe_id: 'ricetta-uno@1',
    theme_id: THEME.id,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Panificio Aurora',
        meta_description: 'Pane fresco ogni mattina',
        blocks: [heroBlock(), chiSiamoBlock()],
      },
    ],
  };
}

/**
 * Le isole EditableText sotto `root`. Le coordinate dell'isola sono `data-editable-block-id` /
 * `data-editable-slot-id` — NON `data-block-id`/`data-slot-id` (fix T-305/D4): il primo
 * COLLIDEREBBE col `data-block-id` che <SiteSection> mette su ogni <section>. Solo le isole portano
 * `data-editable-slot-id`, quindi questo selettore le prende senza raccogliere le sezioni.
 */
function islands(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll('[data-editable-slot-id]')].map((el) => el as HTMLElement);
}

async function renderSiteView(editable: boolean): Promise<HTMLElement> {
  const ui = await SiteView({ document: hostileDocument(), theme: THEME, locale: 'it', editable });
  return render(ui).container;
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-305-1 — testo ostile reso come TESTO (escaping React), mai come markup.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-305-1 — in modalita editable il testo ostile e reso come testo', () => {
  it('script e img ostili compaiono come TESTO e non generano elementi ne eventi', async () => {
    const container = await renderSiteView(true);

    // I due payload compaiono VERBATIM come testo nell'albero reso.
    expect(container.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-305-1
    expect(container.textContent).toContain(IMG_PAYLOAD); // covers: AC-305-1

    // Nessun elemento nasce dal payload: il documento non ha immagini reali e il testo non
    // apre tag — quindi zero <script> e zero <img> nell'albero.
    expect(container.querySelectorAll('script')).toHaveLength(0); // covers: AC-305-1
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-305-1

    // Nessun attributo di evento e' nato dal payload img (onerror resta testo).
    expect(container.querySelector('[onerror]')).toBeNull(); // covers: AC-305-1
    // Lo script non e' stato eseguito (jsdom non esegue un tag che non esiste come elemento).
    expect((window as unknown as Record<string, unknown>).__belora_pwned).toBeUndefined(); // covers: AC-305-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-305-2 — parita read-only vs editable: l'editabilita non cambia cosa si vede.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-305-2 — parita del contenuto testuale fra read-only ed editable', () => {
  it('il contenuto testuale reso coincide fra le due modalita', async () => {
    const readOnly = await renderSiteView(false);
    const editable = await renderSiteView(true);

    // Anti-vacuita': c'e' davvero del testo da confrontare (il documento non e' vuoto).
    expect(readOnly.textContent?.length ?? 0).toBeGreaterThan(0);

    // Il contenuto testuale e' identico: le isole aggiungono involucri, non testo.
    expect(editable.textContent).toBe(readOnly.textContent); // covers: AC-305-2

    // Read-only NON introduce alcuna isola (parita col render P2): le isole sono solo editable.
    expect(islands(readOnly)).toHaveLength(0); // covers: AC-305-2
    expect(islands(editable).length).toBeGreaterThan(1); // covers: AC-305-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-305-3 — ogni isola espone block id e slot id che identificano il campo.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-305-3 — le isole EditableText espongono block id e slot id', () => {
  it('ogni isola porta un block id e uno slot id non vuoti', async () => {
    const container = await renderSiteView(true);
    const found = islands(container);

    // Disciplina fixture: PIU' DI UNA isola.
    expect(found.length).toBeGreaterThan(1); // covers: AC-305-3

    for (const isola of found) {
      expect(isola.getAttribute('data-editable-block-id')).toBeTruthy(); // covers: AC-305-3
      expect(isola.getAttribute('data-editable-slot-id')).toBeTruthy(); // covers: AC-305-3
    }
  });

  it('block id + slot id identificano UNIVOCAMENTE il campo (trappola del prefisso)', async () => {
    const container = await renderSiteView(true);

    // Match ESATTO, non per prefisso: 'content.hero_title' e prefisso di
    // 'content.hero_title_kicker' — due campi distinti dello stesso blocco. Le coordinate dell'isola
    // sono `data-editable-*`, disgiunte dal `data-block-id` delle sezioni (fix T-305/D4).
    const titolo = container.querySelectorAll('[data-editable-block-id="hero"][data-editable-slot-id="content.hero_title"]');
    const occhiello = container.querySelectorAll('[data-editable-block-id="hero"][data-editable-slot-id="content.hero_title_kicker"]');

    expect(titolo).toHaveLength(1); // covers: AC-305-3
    expect(occhiello).toHaveLength(1); // covers: AC-305-3

    // Ciascuna isola porta il testo del PROPRIO campo, non quello dell'altro: la coppia
    // (block, slot) e' una mappa univoca al campo del documento.
    expect((titolo[0] as HTMLElement).textContent).toBe(SCRIPT_PAYLOAD); // covers: AC-305-3
    expect((occhiello[0] as HTMLElement).textContent).toBe('Forno dal 1980'); // covers: AC-305-3
    expect(titolo[0]).not.toBe(occhiello[0]); // covers: AC-305-3
  });

  it('le coordinate dell isola NON collidono col data-block-id delle sezioni (fix T-305/D4)', async () => {
    const container = await renderSiteView(true);

    // La SEZIONE (<section> di SiteSection) porta `data-block-id`; l'ISOLA porta `data-editable-*`.
    // Nessuna isola porta `data-block-id` (era la collisione: un selettore `[data-block-id="hero"]`
    // avrebbe pescato SIA la sezione hero SIA le sue isole). Ora i due insiemi sono disgiunti.
    for (const isola of islands(container)) {
      expect(isola.hasAttribute('data-block-id')).toBe(false); // covers: AC-305-3
      expect(isola.hasAttribute('data-slot-id')).toBe(false); // covers: AC-305-3
    }
    // `[data-block-id="hero"]` seleziona ORA solo la sezione hero (una), mai le isole.
    const perBlockId = container.querySelectorAll('[data-block-id="hero"]');
    expect(perBlockId).toHaveLength(1); // covers: AC-305-3
    expect((perBlockId[0] as HTMLElement).tagName).toBe('SECTION'); // covers: AC-305-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D2 — ISOLA ATTIVA: con `onEdit` lo slot diventa contentEditable e ogni edit inline chiama
// onEdit(block, path, testo). Il renderer reale monta le isole PASSIVE (SiteView non riceve
// ancora una callback): l'attivazione si prova al livello del seam <SiteText>, montato
// direttamente (createElement — questo file e' .ts, niente JSX). Il testo ostile resta TESTO anche
// nell'isola attiva: la edit legge textContent, mai innerHTML.
// ─────────────────────────────────────────────────────────────────────────────

describe('D2 — isola attiva: onEdit riceve (block, path, testo) su edit inline', () => {
  it('con onEdit lo slot e contentEditable e chiama onEdit col testo modificato; il payload ostile resta TESTO', () => {
    const calls: Array<{ block: string; path: readonly string[]; text: string }> = [];
    const { container } = render(
      createElement(SiteText, {
        editable: true,
        block: 'hero',
        slot: 'content.hero_title',
        onEdit: (block: string, path: readonly string[], text: string) => {
          calls.push({ block, path, text });
        },
        children: SCRIPT_PAYLOAD,
      }),
    );

    const isola = container.querySelector('[data-editable-slot-id="content.hero_title"]') as HTMLElement;
    expect(isola).not.toBeNull();
    // Il payload ostile e' reso come TESTO anche nell'isola attiva (escaping, nessun <script>).
    expect(isola.textContent).toBe(SCRIPT_PAYLOAD);
    expect(container.querySelectorAll('script')).toHaveLength(0);
    // L'isola e' ATTIVA: contentEditable.
    expect(isola.getAttribute('contenteditable')).toBe('true');

    // Una edit inline: il DOM del contentEditable cambia, onInput scatta e onEdit riceve il testo.
    isola.textContent = 'Pane caldo';
    fireEvent.input(isola);
    expect(calls).toHaveLength(1);
    expect(calls[0].block).toBe('hero');
    expect(calls[0].path).toEqual(['content', 'hero_title']);
    expect(calls[0].text).toBe('Pane caldo');
  });

  it('senza onEdit l isola resta PASSIVA (nessun contentEditable): parita col render read-only', () => {
    const { container } = render(
      createElement(SiteText, {
        editable: true,
        block: 'hero',
        slot: 'content.hero_title',
        children: 'Pane vero',
      }),
    );
    const isola = container.querySelector('[data-editable-slot-id="content.hero_title"]') as HTMLElement;
    expect(isola).not.toBeNull();
    expect(isola.hasAttribute('contenteditable')).toBe(false);
  });

  it('una chiave di orari col punto: il path STRUTTURATO passato dal blocco sopravvive al punto (fix T-307)', () => {
    const paths: Array<readonly string[]> = [];
    const { container } = render(
      createElement(SiteText, {
        editable: true,
        block: 'orari',
        slot: 'data.hours.lun.ven',
        // Il blocco passa i segmenti gia' separati: 'lun.ven' resta UN segmento, non due.
        path: ['data', 'hours', 'lun.ven'],
        onEdit: (_block: string, path: readonly string[]) => {
          paths.push(path);
        },
        children: '8:00-13:00',
      }),
    );
    const isola = container.querySelector('[data-editable-slot-id="data.hours.lun.ven"]') as HTMLElement;
    expect(isola).not.toBeNull();
    isola.textContent = '9:00-13:00';
    fireEvent.input(isola);
    // La coordinata risalita al draft e' l'array integro: il punto NON e' stato spezzato.
    expect(paths[0]).toEqual(['data', 'hours', 'lun.ven']);
  });
});
