// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// WIRE (macrotask generation-ui, P2) — ORACOLO della CHIUSURA DEL LOOP del launcher: a stream
// concluso la riga e' 'ready', quindi il launcher chiede a Next di RILEGGERE i dati server
// (router.refresh) e la pagina — che ora legge getGeneration — rende il SELETTORE al posto del
// launcher. Senza questa rilettura le cinque proposte esisterebbero nel DB ma l'utente resterebbe
// sul launcher: e' l'ultimo anello della raggiungibilita' end-to-end (AC-235-5). Un fallimento del
// trasporto NON rilegge nulla: non si transita al selettore su una generazione mai riuscita.
//
// COSA SI MOCKA: next/navigation useRouter (si osserva refresh, non una navigazione vera) e la
// fetch globale (un corpo a due chunk drenato come in produzione). Nessun altro seam: la macchina
// a stati del launcher gira per davvero.

const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshSpy }) }));

// Import DOPO i mock (vi.mock e' hoisted).
import { GenerateLauncher } from '@/ui/generation/GenerateLauncher';

const LABELS = { generate: 'Genera', generating: 'In corso', done: 'Fatto', error: 'Errore' } as const;

// Un corpo che consegna `chunks` a due flush e poi si chiude, come lo stream NDJSON di /api/generate.
function streamingResponse(chunks: readonly string[]): unknown {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) {
            const value = new TextEncoder().encode(chunks[i]);
            i += 1;
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
      }),
    },
  };
}

beforeEach(() => {
  refreshSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WIRE GenerateLauncher — a stream concluso rilegge i dati server', () => {
  // covers: AC-235-5
  it('a buon fine drena lo stream e chiama router.refresh una volta (transizione al selettore)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(['{"type":"frames"}\n', '{"type":"pool"}\n'])),
    );
    render(<GenerateLauncher siteId="site-di-a" labels={LABELS} />);

    fireEvent.click(screen.getByRole('button', { name: LABELS.generate }));

    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1)); // covers: AC-235-5
    expect(screen.getByText(LABELS.done)).toBeTruthy(); // covers: AC-235-5
  });

  // covers: AC-235-5
  it('a fetch fallito NON rilegge i dati: nessuna transizione su una generazione mai riuscita', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, body: null })));
    render(<GenerateLauncher siteId="site-di-a" labels={LABELS} />);

    fireEvent.click(screen.getByRole('button', { name: LABELS.generate }));

    await waitFor(() => expect(screen.getByText(LABELS.error)).toBeTruthy()); // covers: AC-235-5
    expect(refreshSpy).not.toHaveBeenCalled(); // covers: AC-235-5
  });
});
