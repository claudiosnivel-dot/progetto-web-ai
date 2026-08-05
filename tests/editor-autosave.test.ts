// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { createElement } from 'react';
import { renderHook, render, act, cleanup, fireEvent } from '@testing-library/react';
import type { SiteDocument } from '@/domain/generation/document';
import type { SaveRevisionResult } from '@/data/site-document-revisions';
import { useAutosave, type SaveDraft } from '@/ui/editor/useAutosave';
import { SaveControls } from '@/ui/editor/SaveControls';

// T-309 (macrotask editor-core, P3) — SAVE-POINT: autosave con debounce + salvataggio esplicito.
// Le asserzioni derivano dagli acceptance_criteria di 01-editor-core.md (AC-309-1..3), taggate
// `// covers:` sulla riga dell'EXPECT. Test HERMETIC (jsdom + fake timers): la scrittura reale
// (saveRevision, T-302: gate parseDocument + RLS su Supabase) e' INIETTATA come `save` e MOCKATA,
// cosi' il test non tocca auth/DB. Cio' che si verifica qui e' la DISCIPLINA DEL SAVE-POINT:
//   • una raffica di edit + inattivita' => UNA SOLA chiamata a `save` (debounce, AC-309-1);
//   • il pulsante Salva persiste SUBITO, e annulla il debounce pendente (niente doppia scrittura);
//   • un draft che il gate rifiuta (save -> { ok:false }) => stato 'error', nessun retry.
//
// SICUREZZA (security_note T-309): l'UNICA via di persistenza del hook e' chiamare `save` — la
// stessa funzione per autosave e per il pulsante. Il hook non ha alcun altro canale di scrittura:
// non c'e' bypass del gate (RLS/parseDocument vivono dentro saveRevision, T-302). Il test lo rende
// osservabile — ogni scrittura, comunque innescata, e' una chiamata a QUELLA funzione, mai un'altra.

// ── fixture ───────────────────────────────────────────────────────────────────
// Il hook tratta il documento come RIFERIMENTO OPACO: lo passa a `save` e usa l'uguaglianza di
// riferimento per decidere "cambiato o no" (il reducer di T-307 produce una nuova reference a ogni
// edit reale, la stessa su un no-op). Ogni chiamata a makeDoc restituisce una NUOVA reference:
// simula un'edit del draft. I campi soddisfano solo il tipo SiteDocument — non passano dal gate qui.
function makeDoc(hero: string): SiteDocument {
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
            content: { hero_title: hero },
            data: { business_name: 'Panificio Aurora' },
            brief_fields_rendered: ['business_name'],
            images: [],
          },
        ],
      },
    ],
  };
}

const okFor = (draft: SiteDocument): SaveRevisionResult => ({ ok: true, document: draft });
const REJECTED: SaveRevisionResult = { ok: false, status: 400 };

const DEBOUNCE = 1000;

// `save` iniettata: di default persiste con successo restituendo il draft ricevuto. Un test la
// sovrascrive con un rifiuto del gate (AC-309-3). Tipata come SaveDraft cosi' e' accettata dal hook.
let save: Mock<SaveDraft>;

beforeEach(() => {
  vi.useFakeTimers();
  save = vi.fn(async (draft: SiteDocument): Promise<SaveRevisionResult> => okFor(draft));
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

// Avanza i fake timer e drena le microtask (la promise di `save` risolta -> setStatus).
async function tick(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-309-1 — una raffica di modifiche + inattivita' => UNA SOLA revisione (debounce).
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-309-1 — autosave con debounce: una sola scrittura per burst', () => {
  it('non autosalva il documento iniziale (nessuna edit): il tempo passa e save non e chiamata', async () => {
    const doc0 = makeDoc('titolo 0');
    renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), { initialProps: { doc: doc0 } });

    await tick(DEBOUNCE * 5);
    expect(save).not.toHaveBeenCalled(); // covers: AC-309-1
  });

  it('tre edit ravvicinate + inattivita => save chiamata UNA volta, con l ultimo documento del burst', async () => {
    const doc0 = makeDoc('titolo 0');
    const docA = makeDoc('titolo A');
    const docB = makeDoc('titolo B');
    const docC = makeDoc('titolo C');

    const { rerender } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    // Raffica: ogni edit reimposta il timer di debounce (ognuna a meno di DEBOUNCE dalla prossima).
    act(() => rerender({ doc: docA }));
    await tick(DEBOUNCE - 200);
    act(() => rerender({ doc: docB }));
    await tick(DEBOUNCE - 200);
    act(() => rerender({ doc: docC }));
    await tick(DEBOUNCE - 200);

    // Ancora dentro la finestra di inattivita': niente scrittura mentre l'utente digita.
    expect(save).not.toHaveBeenCalled(); // covers: AC-309-1

    // Superata l'inattivita': scatta l'autosave, UNA sola volta, con l'ULTIMO stato del burst.
    await tick(300);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-1
    expect(save).toHaveBeenCalledWith(docC); // covers: AC-309-1
  });

  it('due burst separati da inattivita => due scritture (una per burst), mai per singola edit', async () => {
    const { rerender } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: makeDoc('base') },
    });

    // Primo burst.
    act(() => rerender({ doc: makeDoc('a1') }));
    const b1 = makeDoc('a2');
    act(() => rerender({ doc: b1 }));
    await tick(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-1
    expect(save).toHaveBeenLastCalledWith(b1); // covers: AC-309-1

    // Secondo burst dopo che il primo e' stato scritto.
    const b2 = makeDoc('b2');
    act(() => rerender({ doc: makeDoc('b1') }));
    act(() => rerender({ doc: b2 }));
    await tick(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(2); // covers: AC-309-1
    expect(save).toHaveBeenLastCalledWith(b2); // covers: AC-309-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-309-2 — il pulsante Salva persiste SUBITO (e non lascia scattare il debounce).
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-309-2 — salvataggio esplicito immediato', () => {
  it('saveNow persiste subito il documento corrente, senza attendere il debounce', async () => {
    const doc0 = makeDoc('subito');
    const { result } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    await act(async () => {
      result.current.saveNow();
    });
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-2
    expect(save).toHaveBeenCalledWith(doc0); // covers: AC-309-2
  });

  it('Salva esplicito ANNULLA il debounce pendente: una sola scrittura, non due', async () => {
    const doc0 = makeDoc('base');
    const docA = makeDoc('edit A');
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    // Un'edit arma il debounce...
    act(() => rerender({ doc: docA }));
    // ...ma l'utente preme Salva prima che scatti: scrittura immediata di docA.
    await act(async () => {
      result.current.saveNow();
    });
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-2
    expect(save).toHaveBeenCalledWith(docA); // covers: AC-309-2

    // Il timer di debounce non deve produrre una SECONDA scrittura dello stesso stato.
    await tick(DEBOUNCE * 3);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-2
  });

  it('il pulsante Salva del componente SaveControls invoca save (una scrittura per click)', async () => {
    const doc0 = makeDoc('via il pulsante');
    const { container } = render(createElement(SaveControls, { document: doc0, save, debounceMs: DEBOUNCE }));

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLButtonElement);
    });
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-2
    expect(save).toHaveBeenCalledWith(doc0); // covers: AC-309-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-309-3 — un draft che il gate rifiuta: nessuna revisione scritta, stato di errore.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-309-3 — draft invalido: nessuna revisione, stato di errore', () => {
  it('save che ritorna { ok:false } porta lo stato a error e non innesca alcun retry', async () => {
    save.mockImplementation(async (): Promise<SaveRevisionResult> => REJECTED);
    const doc0 = makeDoc('non valido');
    const { result } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    await act(async () => {
      result.current.saveNow();
    });

    // Il gate (dentro saveRevision) ha rifiutato: nessuna revisione scritta. Il hook non riprova.
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-3
    expect(result.current.status).toBe('error'); // covers: AC-309-3

    // Anche lasciando passare il tempo, nessun tentativo ulteriore parte da solo.
    await tick(DEBOUNCE * 3);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-3
    expect(result.current.status).toBe('error'); // covers: AC-309-3
  });

  it('l AUTOSAVE con debounce (non solo il salvataggio esplicito) su un draft rifiutato porta lo stato a error', async () => {
    // Il ramo esplicito (saveNow) e' gia' coperto sopra; qui si prova il ramo AUTOSAVE: un'edit reale
    // (nuova reference) arma il debounce, e alla prima pausa la scrittura scatta DA SOLA e — col gate
    // che rifiuta — porta l'indicatore a 'error'. Senza questo, una regressione che rompesse solo il
    // percorso di errore dell'autosave (lasciando integro quello esplicito) passerebbe in silenzio.
    save.mockImplementation(async (): Promise<SaveRevisionResult> => REJECTED);
    const doc0 = makeDoc('base');
    const docEdit = makeDoc('edit che il gate rifiuta');
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    // Un'edit reale (nuova reference) ARMA il debounce: nessuna scrittura mentre l'utente "digita".
    act(() => rerender({ doc: docEdit }));
    expect(save).not.toHaveBeenCalled(); // covers: AC-309-3

    // Superata l'inattivita' l'AUTOSAVE scatta con l'ultimo stato; il gate rifiuta -> stato 'error'.
    await tick(DEBOUNCE);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-3
    expect(save).toHaveBeenCalledWith(docEdit); // covers: AC-309-3
    expect(result.current.status).toBe('error'); // covers: AC-309-3

    // Nessun retry automatico: il tempo passa e l'autosave rifiutato non riparte da solo.
    await tick(DEBOUNCE * 3);
    expect(save).toHaveBeenCalledTimes(1); // covers: AC-309-3
    expect(result.current.status).toBe('error'); // covers: AC-309-3
  });

  it('l indicatore attraversa saving -> saved sul percorso felice, saving -> error sul rifiuto', async () => {
    // Percorso felice: 'saving' (sincrono) poi 'saved' (dopo la promise).
    const okDoc = makeDoc('ok');
    const ok = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), { initialProps: { doc: okDoc } });
    act(() => ok.result.current.saveNow());
    expect(ok.result.current.status).toBe('saving'); // covers: AC-309-3
    await act(async () => {});
    expect(ok.result.current.status).toBe('saved'); // covers: AC-309-3

    // Percorso di rifiuto: 'saving' poi 'error'.
    save.mockImplementation(async (): Promise<SaveRevisionResult> => REJECTED);
    const koDoc = makeDoc('ko');
    const ko = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), { initialProps: { doc: koDoc } });
    act(() => ko.result.current.saveNow());
    expect(ko.result.current.status).toBe('saving'); // covers: AC-309-3
    await act(async () => {});
    expect(ko.result.current.status).toBe('error'); // covers: AC-309-3
  });

  it('SaveControls riflette lo stato di errore nell indicatore (data-status)', async () => {
    save.mockImplementation(async (): Promise<SaveRevisionResult> => REJECTED);
    const doc0 = makeDoc('errore');
    const { container } = render(createElement(SaveControls, { document: doc0, save, debounceMs: DEBOUNCE }));

    await act(async () => {
      fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    });
    const indicator = container.querySelector('[data-status]');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('data-status')).toBe('error'); // covers: AC-309-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SICUREZZA — nessun bypass del gate: OGNI scrittura (autosave o esplicita) e' una chiamata alla
// STESSA funzione `save` (== saveRevision in produzione), l'unica porta di persistenza del hook.
// ─────────────────────────────────────────────────────────────────────────────

describe('sicurezza — ogni save passa dalla funzione iniettata (gate T-302), nessun altro canale', () => {
  it('autosave e Salva esplicito chiamano la MEDESIMA funzione, sempre col draft come argomento', async () => {
    const doc0 = makeDoc('base');
    const docEdit = makeDoc('edit');
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, save, DEBOUNCE), {
      initialProps: { doc: doc0 },
    });

    // Autosave.
    act(() => rerender({ doc: docEdit }));
    await tick(DEBOUNCE);
    // Esplicito.
    await act(async () => {
      result.current.saveNow();
    });

    // Entrambe le vie sono passate da `save`; ogni argomento e' un SiteDocument (mai un'altra porta).
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2); // covers: AC-309-1, AC-309-2
    for (const call of save.mock.calls) {
      expect(call[0]).toHaveProperty('pages'); // covers: AC-309-1, AC-309-2
    }
  });
});
