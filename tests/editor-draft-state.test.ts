// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { SiteBlock, SiteDocument } from '@/domain/generation/document';
import { draftReducer, initialDraftState } from '@/ui/editor/draft-state';
import { useEditorDraft } from '@/ui/editor/useEditorDraft';

// T-307 (macrotask editor-core, P3) — STATO DRAFT dell'editor + undo/redo client sui testi + lo
// switch tema (supporto a T-308). Le asserzioni derivano dagli acceptance_criteria di
// 01-editor-core.md (AC-307-1..3), taggate `// covers:` sulla riga dell'EXPECT. Test HERMETIC: il
// grosso e' un REDUCER PURO (nessun React, nessun DB, nessuna auth), piu' un test sottile sul hook
// (renderHook, jsdom) per provare il cablaggio verso l'anteprima. Le forme di coordinata esercitate
// sono quelle REALI prodotte dalle isole <EditableText> dei blocchi (src/ui/site/blocks/**), ora
// come PATH STRUTTURATO (array di segmenti): ['content','<slot>'], ['content','<slot>','<i>'],
// ['content','faq_items','<i>','answer'], ['data','<field>'], ['data','hours','<giorno>'].
//
// PERCHE' UN PATH STRUTTURATO (fix T-307): una chiave di 'data.hours.<giorno>' puo' contenere un
// punto ('lun.ven'). Con una coordinata PUNTATA il reducer spezzava su '.', e 'data.hours.lun.ven'
// diventava ['data','hours','lun','ven'] — un no-op SILENZIOSO su una edit legittima. Portando i
// segmenti gia' separati dall'isola il punto dentro la chiave non e' piu' ambiguo.
//
// SICUREZZA (security_note T-307): il draft resta STRUTTURA DATI/TESTO — una edit mette una
// stringa piana nel campo giusto, mai HTML serializzato. Il test verifica che una edit tocchi
// SOLO quel campo, che i tipi non-stringa non siano sovrascrivibili, e che uno slot/blocco
// sconosciuto sia un no-op (nessun campo creato).

// ── fixture di dominio ────────────────────────────────────────────────────────
// Disciplina fixture (lezione P1/P2, §9 del design): PIU' DI UN blocco, valori DISCORDANTI, e
// almeno un id che sia PREFISSO di un altro — QUI su DUE assi, cosi' un lookup per prefisso
// (startsWith/includes) invece che per uguaglianza esatta e' osservabile mentre sbaglia:
//   • slot id: 'content.hero_title' e' prefisso di 'content.hero_title_kicker' (stesso blocco);
//   • block id: 'about' e' prefisso di 'about-us' (stessa pagina).
// Piu' blocchi su DUE pagine, con un blocco 'faq' su una pagina diversa da 'hero'/'about', e un
// blocco 'orari' con una chiave di orari che CONTIENE un punto (la trappola di T-307).
function fixtureDocument(): SiteDocument {
  return {
    recipe_id: 'ricetta-uno@1',
    theme_id: 'tema-uno@2',
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Panificio Aurora',
        meta_description: 'Pane fresco ogni mattina',
        blocks: [
          {
            id: 'hero',
            content: {
              hero_title_kicker: 'Forno dal 1980',
              hero_title: 'Pane vero, ogni giorno',
              hero_subtitle: 'Lievito madre e farine locali',
            },
            data: { business_name: 'Panificio Aurora' },
            brief_fields_rendered: ['business_name'],
            images: [],
          },
          {
            id: 'about',
            content: {
              about_title: 'La nostra storia',
              about_body: 'Impastiamo a mano dal 1980',
              about_points: ['Farine del territorio', 'Forno a legna'],
            },
            data: {},
            brief_fields_rendered: [],
            images: [],
          },
          {
            // block id 'about' e' PREFISSO di 'about-us': un match esatto NON deve confonderli.
            id: 'about-us',
            content: { about_title: 'Sezione gemella' },
            data: {},
            brief_fields_rendered: [],
            images: [],
          },
          {
            // ORARI: la mappa `giorno -> orario` del brief. La chiave 'lun.ven' CONTIENE un punto
            // (HoursKeySchema ammette '.' come separatore interno). Il valore e' un leaf STRINGA.
            id: 'orari',
            content: { hours_title: 'Orari di apertura' },
            data: {
              hours: {
                'lun.ven': '8:00-13:00',
                sab: '8:00-12:00',
              },
            },
            brief_fields_rendered: ['hours'],
            images: [],
          },
        ],
      },
      {
        slug: 'domande',
        role: 'faq',
        title: 'Domande frequenti',
        meta_description: 'Le risposte piu richieste',
        blocks: [
          {
            id: 'faq',
            content: {
              faq_title: 'Domande frequenti',
              faq_items: [
                { question: 'Siete aperti la domenica?', answer: 'Si, solo la mattina' },
                { question: 'Fate consegne?', answer: 'Solo in zona' },
              ],
            },
            data: {},
            brief_fields_rendered: [],
            images: [],
          },
        ],
      },
    ],
  };
}

/** Il blocco con quell'id nel documento (i blocchi vivono dentro le pagine). */
function block(document: SiteDocument, id: string): SiteBlock {
  const found = document.pages.flatMap((page) => page.blocks).find((b) => b.id === id);
  if (!found) throw new Error(`fixture priva del blocco ${id}`);
  return found;
}

/** Il testo di uno slot 'content.<slot>' come stringa (helper di lettura, tipizzato lasco). */
function content(document: SiteDocument, blockId: string, slot: string): unknown {
  return (block(document, blockId).content as Record<string, unknown>)[slot];
}

// La coordinata e' STRUTTURATA: un array di segmenti (radice + percorso), mai una stringa puntata.
const edit = (blockId: string, path: readonly string[], value: string) =>
  ({ type: 'editSlot', edit: { blockId, path, value } }) as const;

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────
// AC-307-1 — modificare uno slot cambia SOLO quel campo del draft.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-307-1 — una edit tocca solo il campo indirizzato', () => {
  it('edit di content.hero_title cambia solo quel campo (lo slot PREFISSO resta intatto)', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('hero', ['content', 'hero_title'], 'Pane appena sfornato'));

    // Il campo indirizzato cambia.
    expect(content(state1.document, 'hero', 'hero_title')).toBe('Pane appena sfornato'); // covers: AC-307-1
    // Lo slot il cui id e' PREFISSO ('hero_title_kicker') NON e' toccato — match esatto, non prefisso.
    expect(content(state1.document, 'hero', 'hero_title_kicker')).toBe('Forno dal 1980'); // covers: AC-307-1
    // Gli altri slot dello stesso blocco restano.
    expect(content(state1.document, 'hero', 'hero_subtitle')).toBe('Lievito madre e farine locali'); // covers: AC-307-1
    // Gli altri blocchi restano identici (stessa REFERENCE: structural sharing, nessuna mutazione).
    expect(block(state1.document, 'about')).toBe(block(state0.document, 'about')); // covers: AC-307-1
    expect(block(state1.document, 'faq')).toBe(block(state0.document, 'faq')); // covers: AC-307-1
  });

  it('non muta lo stato precedente (immutabilita): state0 resta il valore originale', () => {
    const state0 = initialDraftState(fixtureDocument());
    draftReducer(state0, edit('hero', ['content', 'hero_title'], 'Mutato?'));
    expect(content(state0.document, 'hero', 'hero_title')).toBe('Pane vero, ogni giorno'); // covers: AC-307-1
  });

  it('edit di content.hero_title_kicker non tocca il campo di cui e prefisso (direzione inversa)', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('hero', ['content', 'hero_title_kicker'], 'Dal 1975'));
    expect(content(state1.document, 'hero', 'hero_title_kicker')).toBe('Dal 1975'); // covers: AC-307-1
    expect(content(state1.document, 'hero', 'hero_title')).toBe('Pane vero, ogni giorno'); // covers: AC-307-1
  });

  it('match del blocco per uguaglianza esatta: edit su about non tocca about-us (prefisso)', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('about', ['content', 'about_title'], 'Chi siamo davvero'));
    expect(content(state1.document, 'about', 'about_title')).toBe('Chi siamo davvero'); // covers: AC-307-1
    expect(content(state1.document, 'about-us', 'about_title')).toBe('Sezione gemella'); // covers: AC-307-1
  });

  it('edit di un campo data (data.business_name) cambia solo quello, non i content', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('hero', ['data', 'business_name'], 'Forno Aurora'));
    expect(block(state1.document, 'hero').data.business_name).toBe('Forno Aurora'); // covers: AC-307-1
    expect(content(state1.document, 'hero', 'hero_title')).toBe('Pane vero, ogni giorno'); // covers: AC-307-1
  });

  it('edit di una voce di lista (content.about_points.0) cambia solo quell indice', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('about', ['content', 'about_points', '0'], 'Farine biologiche'));
    const points = content(state1.document, 'about', 'about_points') as string[];
    expect(points[0]).toBe('Farine biologiche'); // covers: AC-307-1
    expect(points[1]).toBe('Forno a legna'); // covers: AC-307-1
  });

  it('edit di un campo qa annidato (content.faq_items.1.answer) cambia solo quel leaf', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('faq', ['content', 'faq_items', '1', 'answer'], 'Consegne in tutta la citta'));
    const items = content(state1.document, 'faq', 'faq_items') as { question: string; answer: string }[];
    expect(items[1].answer).toBe('Consegne in tutta la citta'); // covers: AC-307-1
    expect(items[1].question).toBe('Fate consegne?'); // covers: AC-307-1
    expect(items[0]).toEqual({ question: 'Siete aperti la domenica?', answer: 'Si, solo la mattina' }); // covers: AC-307-1
  });

  it('edit di una chiave di orari che CONTIENE un punto (data.hours.lun.ven) edita il leaf, non e un no-op (fix T-307)', () => {
    const state0 = initialDraftState(fixtureDocument());
    // La coordinata e' STRUTTURATA: 'lun.ven' e' UN segmento, non due. Con una stringa puntata
    // spezzata su '.' questa edit sarebbe stata un no-op silenzioso — la corruzione che il fix chiude.
    const state1 = draftReducer(state0, edit('orari', ['data', 'hours', 'lun.ven'], '9:00-13:00'));
    const hours = block(state1.document, 'orari').data.hours as Record<string, string>;
    expect(hours['lun.ven']).toBe('9:00-13:00'); // covers: AC-307-1
    // Le altre chiavi di orari restano intatte.
    expect(hours['sab']).toBe('8:00-12:00'); // covers: AC-307-1
    // E' cambiato SOLO quel campo: gli altri blocchi restano la stessa reference (structural sharing).
    expect(block(state1.document, 'hero')).toBe(block(state0.document, 'hero')); // covers: AC-307-1
    // FALSIFICABILITA del fix: con la chiave SPEZZATA erroneamente (il punto trattato come
    // separatore, ['...','lun','ven']) la edit NON risolve — cioe' esattamente il no-op che la
    // coordinata strutturata elimina passando i segmenti gia' separati dall'isola.
    expect(draftReducer(state0, edit('orari', ['data', 'hours', 'lun', 'ven'], '9:00-13:00'))).toBe(state0); // covers: AC-307-1
  });

  it('SICUREZZA — uno slot/blocco sconosciuto e un target non-stringa sono no-op (nessun campo creato)', () => {
    const state0 = initialDraftState(fixtureDocument());
    // blocco inesistente
    expect(draftReducer(state0, edit('nope', ['content', 'hero_title'], 'x'))).toBe(state0); // covers: AC-307-1
    // slot inesistente nel blocco
    expect(draftReducer(state0, edit('hero', ['content', 'non_esiste'], 'x'))).toBe(state0); // covers: AC-307-1
    // target non-stringa (about_points e' un array): non si trasforma una struttura in testo
    expect(draftReducer(state0, edit('about', ['content', 'about_points'], 'x'))).toBe(state0); // covers: AC-307-1
    // radice sconosciuta (ne 'content' ne 'data')
    expect(draftReducer(state0, edit('hero', ['images', '0'], 'x'))).toBe(state0); // covers: AC-307-1
    // coordinata senza segmenti sotto la radice (solo la radice): non indirizza un leaf editabile
    expect(draftReducer(state0, edit('hero', ['content'], 'x'))).toBe(state0); // covers: AC-307-1
    // edit al medesimo valore: no-op (nessuna voce di storia spuria)
    expect(draftReducer(state0, edit('hero', ['content', 'hero_title'], 'Pane vero, ogni giorno'))).toBe(state0); // covers: AC-307-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-307-2 — undo ripristina lo stato immediatamente precedente.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-307-2 — undo torna allo stato precedente', () => {
  it('dopo una sequenza di edit, ogni undo torna indietro di un passo', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('hero', ['content', 'hero_title'], 'Titolo A'));
    const state2 = draftReducer(state1, edit('hero', ['content', 'hero_subtitle'], 'Sottotitolo B'));

    const undo1 = draftReducer(state2, { type: 'undo' });
    // Torna ESATTAMENTE allo stato dopo la prima edit (title=A, subtitle originale).
    expect(undo1.document).toEqual(state1.document); // covers: AC-307-2
    expect(content(undo1.document, 'hero', 'hero_title')).toBe('Titolo A'); // covers: AC-307-2
    expect(content(undo1.document, 'hero', 'hero_subtitle')).toBe('Lievito madre e farine locali'); // covers: AC-307-2

    // Un secondo undo torna al documento iniziale.
    const undo2 = draftReducer(undo1, { type: 'undo' });
    expect(undo2.document).toEqual(state0.document); // covers: AC-307-2

    // Undo con storia vuota e' un no-op (stessa reference).
    expect(draftReducer(undo2, { type: 'undo' })).toBe(undo2); // covers: AC-307-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-307-3 — redo riapplica la modifica annullata.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-307-3 — redo riapplica cio che undo ha annullato', () => {
  it('un redo dopo un undo riporta lo stato annullato', () => {
    const state0 = initialDraftState(fixtureDocument());
    const state1 = draftReducer(state0, edit('hero', ['content', 'hero_title'], 'Titolo A'));
    const state2 = draftReducer(state1, edit('hero', ['content', 'hero_subtitle'], 'Sottotitolo B'));

    const undo1 = draftReducer(state2, { type: 'undo' });
    const redo1 = draftReducer(undo1, { type: 'redo' });
    expect(redo1.document).toEqual(state2.document); // covers: AC-307-3
    expect(content(redo1.document, 'hero', 'hero_subtitle')).toBe('Sottotitolo B'); // covers: AC-307-3

    // Redo con futuro vuoto e' un no-op.
    expect(draftReducer(redo1, { type: 'redo' })).toBe(redo1); // covers: AC-307-3

    // Una nuova edit dopo un undo scarta il ramo redo (il futuro si azzera).
    const branched = draftReducer(undo1, edit('hero', ['content', 'hero_title'], 'Titolo C'));
    expect(draftReducer(branched, { type: 'redo' })).toBe(branched); // covers: AC-307-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setTheme — lo switch tema aggiorna theme_id nel draft (supporto a T-308). Il selettore dei 5
// temi e la proiezione delle var vivono in ThemeSwitcher (tests/editor-theme-switch.test.ts): qui
// si prova la sola azione del reducer che FX-EDITOR-2 leghera' a `onThemeChange`.
// ─────────────────────────────────────────────────────────────────────────────

describe('setTheme — aggiorna solo document.theme_id, con storia e no-op sul medesimo tema', () => {
  it('setTheme cambia solo theme_id, lascia pages alla stessa reference, e spinge una voce di storia', () => {
    const state0 = initialDraftState(fixtureDocument());
    const before = state0.document.theme_id;
    const state1 = draftReducer(state0, { type: 'setTheme', themeId: 'linea-essenziale@1' });

    expect(state1.document.theme_id).toBe('linea-essenziale@1');
    // Solo theme_id cambia: le pagine (e quindi ogni blocco) restano la STESSA reference.
    expect(state1.document.pages).toBe(state0.document.pages);
    // Immutabilita: lo stato precedente non e' mutato.
    expect(state0.document.theme_id).toBe(before);

    // Una voce di storia e' stata spinta: undo torna al tema precedente, redo lo riapplica.
    const undone = draftReducer(state1, { type: 'undo' });
    expect(undone.document.theme_id).toBe(before);
    const redone = draftReducer(undone, { type: 'redo' });
    expect(redone.document.theme_id).toBe('linea-essenziale@1');
  });

  it('setTheme al medesimo tema e un no-op (stessa reference, nessuna voce di storia spuria)', () => {
    const state0 = initialDraftState(fixtureDocument());
    expect(draftReducer(state0, { type: 'setTheme', themeId: state0.document.theme_id })).toBe(state0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hook sottile — cablaggio del reducer verso l'anteprima (le isole rileggono `document`
// senza round-trip server). Prova che editSlot/setTheme/undo/redo e i flag can* siano esposti.
// ─────────────────────────────────────────────────────────────────────────────

describe('useEditorDraft — hook sottile sul reducer', () => {
  it('editSlot aggiorna il documento in anteprima; undo/redo e i flag can* funzionano', () => {
    const { result } = renderHook(() => useEditorDraft(fixtureDocument()));

    expect(result.current.canUndo).toBe(false); // covers: AC-307-2
    expect(result.current.canRedo).toBe(false); // covers: AC-307-3
    expect(content(result.current.document, 'hero', 'hero_title')).toBe('Pane vero, ogni giorno');

    act(() => result.current.editSlot('hero', ['content', 'hero_title'], 'Pane caldo'));
    expect(content(result.current.document, 'hero', 'hero_title')).toBe('Pane caldo'); // covers: AC-307-1
    expect(result.current.canUndo).toBe(true); // covers: AC-307-2

    act(() => result.current.undo());
    expect(content(result.current.document, 'hero', 'hero_title')).toBe('Pane vero, ogni giorno'); // covers: AC-307-2
    expect(result.current.canRedo).toBe(true); // covers: AC-307-3

    act(() => result.current.redo());
    expect(content(result.current.document, 'hero', 'hero_title')).toBe('Pane caldo'); // covers: AC-307-3
  });

  it('setTheme e esposto dal hook e aggiorna theme_id in anteprima (supporto a T-308)', () => {
    const { result } = renderHook(() => useEditorDraft(fixtureDocument()));

    expect(typeof result.current.setTheme).toBe('function');
    act(() => result.current.setTheme('linea-essenziale@1'));
    expect(result.current.document.theme_id).toBe('linea-essenziale@1');
    expect(result.current.canUndo).toBe(true);
  });
});
