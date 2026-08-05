// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createElement } from 'react';
import { render, cleanup, fireEvent, act, within } from '@testing-library/react';
import { THEMES } from '@/domain/generation/themes';
import { siteThemeStyle } from '@/ui/site/theme-style';
import type { SiteDocument } from '@/domain/generation/document';
import type { SaveRevisionResult } from '@/data/site-document-revisions';

// FX-EDITOR-2 (T-319, macrotask editor-core, P3) — ORACOLO DI INTEGRAZIONE dell'editor composto
// END-TO-END. Prova, HERMETIC (jsdom), i tre cicli del design §4 sul RENDERER UNICO reale (SiteView
// editable, registry, blocchi, EditableText — NON mockati):
//   1) isola -> editSlot -> anteprima: editare un'isola porta il testo al draft (T-307) e la scrittura
//      di save-point riceve il documento editato; l'anteprima e' lo STESSO nodo che l'utente edita
//      (renderer unico, nessuna copia client dei blocchi).
//   2) switch tema che restila DAVVERO i blocchi: scegliere un altro dei 5 temi scambia le --site-*
//      sull'elemento che SiteView stila (.site-page), cioe' l'antenato da cui i blocchi leggono
//      var(--site-...) — l'effetto reale sui blocchi, non su un div vuoto (T-308/D2).
//   3) save-point: il pulsante Salva persiste subito, l'autosave con debounce persiste dopo la pausa
//      (T-309) — sempre dall'unica porta saveRevision (T-302).
// E il chiamante di PRODUZIONE della RISCELTA soft (T-310/D3): il controllo di riscelta consegna la
// conferma RASSICURANTE che nomina la conservazione delle modifiche in storia e invoca selectVariant
// col percorso fromEditor.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW: solo i SEAM DI I/O (le server action DB-backed e il router).
// Il renderer, il draft, l'autosave, lo switch tema e l'attivazione delle isole sono i moduli REALI —
// e' il loro cablaggio che qui si verifica. La scrittura reale (RLS/parseDocument dentro saveRevision,
// T-302) e' DEFERITA al checkpoint; qui si prova che OGNI persistenza passa dalla funzione iniettata.

// ── mock dei seam di I/O (hoisted) ────────────────────────────────────────────
const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshSpy }) }));

// next-intl/server: le etichette di sezione dei blocchi (siteBlockLabel) le risolve QUI il renderer
// reale. Torna una funzione che rende la chiave: basta un'etichetta non vuota per il landmark.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const { saveRevisionSpy, restoreRevisionSpy, listRevisionsSpy } = vi.hoisted(() => ({
  saveRevisionSpy: vi.fn(),
  restoreRevisionSpy: vi.fn(),
  listRevisionsSpy: vi.fn(),
}));
vi.mock('@/data/site-document-revisions', () => ({
  saveRevision: saveRevisionSpy,
  restoreRevision: restoreRevisionSpy,
  listRevisions: listRevisionsSpy,
}));

const { selectVariantSpy } = vi.hoisted(() => ({ selectVariantSpy: vi.fn() }));
vi.mock('@/data/generation-choose', () => ({ selectVariant: selectVariantSpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { SiteView } from '@/ui/site/SiteView';
import { EditorClient } from '@/ui/editor/EditorClient';

const START_THEME = THEMES[0];
const OTHER_THEME = THEMES[2]; // valori DISCORDANTI dal primo (l'unico scuro): l'accent cambia.
const DEBOUNCE = 1000;
const SITE_ID = 'site-di-a';

const LABELS = {
  revisionsTitle: 'Storia delle revisioni',
  restore: 'Ripristina',
  rechoose: 'Cambia proposta',
  rechooseConfirm:
    'Le tue modifiche restano salvate nella storia delle revisioni e potrai ripristinarle in qualsiasi momento.',
  rechooseConfirmYes: 'Sì, riscegli',
  rechooseCancel: 'Annulla',
};

// ── fixture di dominio ────────────────────────────────────────────────────────
// Un documento minimo con un blocco hero che rende il proprio titolo: in modalita editable quel
// titolo diventa un'isola EditableText. Soddisfa il tipo SiteDocument (non passa dal gate qui).
function heroDoc(themeId: string, title: string): SiteDocument {
  return {
    recipe_id: 'ricetta-uno@1',
    theme_id: themeId,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Panificio Aurora',
        meta_description: 'Pane fresco ogni mattina',
        blocks: [
          {
            id: 'hero',
            content: { hero_title: title },
            data: {},
            brief_fields_rendered: [],
            images: [],
          },
        ],
      },
    ],
  };
}

// Un documento con un blocco ORARI la cui mappa hours ha una chiave contenente un '.' ('lun.ven',
// ammessa da HoursKeySchema): prova che la coordinata STRUTTURATA (data-editable-path) sopravvive al
// punto lungo tutta la catena REALE isola -> EditorClient -> editSlot (fix T-307/D4), dove uno split
// sull'attributo joinato produrrebbe un no-op silenzioso e la perdita dell'edit.
function hoursDoc(themeId: string, hours: Record<string, string>): SiteDocument {
  return {
    recipe_id: 'ricetta-uno@1',
    theme_id: themeId,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Panificio Aurora',
        meta_description: 'Orari di apertura',
        blocks: [
          {
            id: 'orari',
            content: { hours_title: 'Orari di apertura' },
            data: { hours },
            brief_fields_rendered: [],
            images: [],
          },
        ],
      },
    ],
  };
}

let saveRevision: Mock;

beforeEach(() => {
  vi.useFakeTimers();
  saveRevision = saveRevisionSpy;
  saveRevisionSpy.mockReset();
  saveRevisionSpy.mockImplementation(
    async (_siteId: string, document: SiteDocument): Promise<SaveRevisionResult> => ({
      ok: true,
      document,
    }),
  );
  restoreRevisionSpy.mockReset();
  restoreRevisionSpy.mockResolvedValue({ ok: true, document: heroDoc(START_THEME.id, 'x') });
  listRevisionsSpy.mockReset();
  listRevisionsSpy.mockResolvedValue({ ok: true, revisions: [] });
  selectVariantSpy.mockReset();
  selectVariantSpy.mockResolvedValue(undefined);
  refreshSpy.mockReset();
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// Rende l'editor completo: SiteView editable (renderer UNICO, atteso) affidato a EditorClient come
// children, esattamente come la pagina server lo compone. Flusha gli effetti (attivazione isole +
// caricamento revisioni).
async function renderEditor(
  document: SiteDocument,
  options: { rechoose?: { generationId: string; variantIndex: number } } = {},
) {
  const view = await SiteView({ document, theme: themeOf(document.theme_id), locale: 'it', editable: true });
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(
      createElement(EditorClient, {
        document,
        siteId: SITE_ID,
        locale: 'it',
        labels: LABELS,
        rechoose: options.rechoose,
        debounceMs: DEBOUNCE,
        // Il children (anteprima del RENDERER UNICO) va nelle props: createElement non lo inferisce
        // dal terzo argomento quando `children` e' una prop richiesta.
        children: view,
      }),
    );
  });
  return utils;
}

function themeOf(themeId: string) {
  const theme = THEMES.find((candidate) => candidate.id === themeId);
  if (theme === undefined) throw new Error(`tema di test assente: ${themeId}`);
  return theme;
}

async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1) isola -> editSlot -> anteprima, e il save-point che ne riceve il documento editato.
// ─────────────────────────────────────────────────────────────────────────────

describe('editor composto — ciclo isola -> editSlot -> anteprima', () => {
  it('editare l isola del titolo porta il testo al draft e il save-point riceve il documento editato', async () => {
    const { container } = await renderEditor(heroDoc(START_THEME.id, 'Titolo originale'));

    // L'isola del titolo hero e' resa dal RENDERER REALE, DENTRO la pagina (anteprima), non una copia.
    const isle = container.querySelector(
      '[data-editable-block-id="hero"][data-editable-slot-id="content.hero_title"]',
    ) as HTMLElement;
    expect(isle).not.toBeNull();
    expect(isle.textContent).toBe('Titolo originale');
    // E' DENTRO l'anteprima (la pagina del renderer unico), cio' che prova "l'anteprima e' il sito".
    expect(container.querySelector('[data-editor-preview] [data-site-page="home"]')).not.toBeNull();
    expect(within(container.querySelector('[data-editor-preview]') as HTMLElement).getByText('Titolo originale')).toBeTruthy();

    // L'utente digita DENTRO il nodo editabile (aggiornamento nativo del DOM) e il draft cattura.
    isle.textContent = 'Titolo modificato';
    await act(async () => {
      fireEvent.input(isle);
    });

    // Il save-point riceve il draft EDITATO (nuova reference dal reducer) alla pausa (autosave).
    expect(saveRevision).not.toHaveBeenCalled(); // ancora dentro il debounce
    await tick(DEBOUNCE);
    expect(saveRevision).toHaveBeenCalledTimes(1);
    const [siteIdArg, documentArg] = saveRevision.mock.calls[0] as [string, SiteDocument];
    expect(siteIdArg).toBe(SITE_ID);
    expect(documentArg.pages[0].blocks[0].content.hero_title).toBe('Titolo modificato');
    // L'anteprima riflette la modifica: e' lo STESSO nodo che l'utente ha editato (renderer unico).
    expect(isle.textContent).toBe('Titolo modificato');
  });

  it('editare un valore di ORARI con chiave contenente un punto (lun.ven) aggiorna il campo giusto via data-editable-path, non un no-op silenzioso (fix T-307/D4)', async () => {
    const { container } = await renderEditor(hoursDoc(START_THEME.id, { 'lun.ven': '8:00-13:00' }));

    // L'isola del valore orari porta la coordinata STRUTTURATA come JSON (data-editable-path), oltre
    // allo slot joinato: ['data','hours','lun.ven'] — cosi' il punto nella chiave non e' ambiguo.
    const isle = container.querySelector(
      '[data-editable-block-id="orari"][data-editable-slot-id="data.hours.lun.ven"]',
    ) as HTMLElement;
    expect(isle).not.toBeNull();
    expect(isle.textContent).toBe('8:00-13:00');
    expect(JSON.parse(isle.getAttribute('data-editable-path') ?? 'null')).toEqual([
      'data',
      'hours',
      'lun.ven',
    ]);

    // L'utente edita il valore: EditorClient ricostruisce il path dal JSON (mai split('.')).
    isle.textContent = '9:00-13:00';
    await act(async () => {
      fireEvent.input(isle);
    });
    await tick(DEBOUNCE);

    // Il save-point riceve il documento con la chiave PUNTATA aggiornata: la edit NON e' un no-op.
    expect(saveRevision).toHaveBeenCalledTimes(1);
    const [, documentArg] = saveRevision.mock.calls[0] as [string, SiteDocument];
    const hours = (documentArg.pages[0].blocks[0].data as { hours: Record<string, string> }).hours;
    expect(hours['lun.ven']).toBe('9:00-13:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) switch tema che restila DAVVERO i blocchi (l'elemento che SiteView stila, non un div vuoto).
// ─────────────────────────────────────────────────────────────────────────────

describe('editor composto — lo switch tema restila i blocchi', () => {
  it('scegliere un altro dei 5 temi scambia le --site-* sulla .site-page (l antenato da cui i blocchi leggono var)', async () => {
    const { container } = await renderEditor(heroDoc(START_THEME.id, 'Titolo'));

    // .site-page e' l'elemento che SiteView stila e da cui i blocchi (suoi discendenti) leggono
    // var(--site-...). E' li' che lo switch DEVE arrivare, non su un antenato schermato.
    const sitePage = container.querySelector('[data-site-page="home"]') as HTMLElement;
    expect(sitePage).not.toBeNull();

    const accentKey = '--site-color-accent';
    const startAccent = (siteThemeStyle(START_THEME) as Record<string, string>)[accentKey];
    const otherAccent = (siteThemeStyle(OTHER_THEME) as Record<string, string>)[accentKey];
    // Precondizioni non vacue: i due temi differiscono sull'accent, e all'avvio la .site-page e' sul primo.
    expect(startAccent).not.toBe(otherAccent);
    expect(sitePage.style.getPropertyValue(accentKey)).toBe(startAccent);

    // Si sceglie l'altro tema dalla sola scelta predefinita del selettore.
    await act(async () => {
      fireEvent.click(container.querySelector(`[data-theme-option="${OTHER_THEME.id}"]`) as HTMLElement);
    });

    // La .site-page — l'antenato che i blocchi leggono — porta ora le var del tema scelto: i blocchi
    // si restilizzano. Un fix che toccasse solo un antenato schermato lascerebbe qui il valore vecchio.
    expect(sitePage.style.getPropertyValue(accentKey)).toBe(otherAccent);
    // L'intera tabella proiettata, non solo l'accent.
    for (const [property, value] of Object.entries(siteThemeStyle(OTHER_THEME) as Record<string, string>)) {
      expect(sitePage.style.getPropertyValue(property)).toBe(value);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) save-point: pulsante Salva immediato + autosave con debounce, sempre dall'unica porta.
// ─────────────────────────────────────────────────────────────────────────────

describe('editor composto — save-point', () => {
  it('il pulsante Salva persiste SUBITO il draft corrente dall unica porta saveRevision', async () => {
    const { container } = await renderEditor(heroDoc(START_THEME.id, 'Titolo'));

    await act(async () => {
      fireEvent.click(container.querySelector('.editor-save-button') as HTMLElement);
    });

    expect(saveRevision).toHaveBeenCalledTimes(1);
    expect(saveRevision.mock.calls[0][0]).toBe(SITE_ID);
    // L'indicatore riflette l'esito riuscito.
    expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('saved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RISCELTA soft dall'editor (T-310/D3): conferma rassicurante + chiamante di produzione fromEditor.
// ─────────────────────────────────────────────────────────────────────────────

describe('editor composto — riscelta soft non distruttiva (T-310)', () => {
  it('il controllo di riscelta mostra la conferma che NOMINA la storia e invoca selectVariant con fromEditor', async () => {
    const { container } = await renderEditor(heroDoc(START_THEME.id, 'Titolo'), {
      rechoose: { generationId: 'gen-1', variantIndex: 3 },
    });

    // Primo passo: armare la conferma.
    await act(async () => {
      fireEvent.click(container.querySelector('[data-rechoose-open]') as HTMLElement);
    });

    // La conferma e' RASSICURANTE e NOMINA la conservazione delle modifiche in storia (DoD 3, T-310).
    const prompt = container.querySelector('[data-rechoose-prompt]') as HTMLElement;
    expect(prompt).not.toBeNull();
    expect(prompt.textContent).toBe(LABELS.rechooseConfirm);
    expect(prompt.textContent).toMatch(/storia delle revisioni/i);

    // Secondo passo: confermare invoca selectVariant col percorso fromEditor (produzione reale).
    await act(async () => {
      fireEvent.click(container.querySelector('[data-rechoose-yes]') as HTMLElement);
    });

    expect(selectVariantSpy).toHaveBeenCalledTimes(1);
    expect(selectVariantSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        siteId: SITE_ID,
        generationId: 'gen-1',
        variantIndex: 3,
        fromEditor: true,
        confirm: true,
      }),
    );
  });

  it('senza rechoose (sito non ancora scelto) il controllo di riscelta non compare', async () => {
    const { container } = await renderEditor(heroDoc(START_THEME.id, 'Titolo'));
    expect(container.querySelector('[data-rechoose-open]')).toBeNull();
  });
});
