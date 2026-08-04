// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// WIRE (macrotask generation-ui, P2) — ORACOLO del TRIGGER DELLA FASE 2 (Phase2Trigger), il
// consumatore di PRODUZIONE di `runPhase2` (rende la fase 2 RAGGIUNGIBILE da una rotta, non
// orfana — P2-D26, la stessa clausola di raggiungibilita' di AC-235-5). Le asserzioni sono
// taggate sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - @/data/generation-phase2 runPhase2: il seam dell'azione. Il trigger e' testato per cio' che
//    FA — con quali id invoca l'azione — e per come reagisce all'esito (rilettura a buon fine,
//    segnalazione al fallimento), non per la fase 2 in se' (il cui oracolo e' generation-phase2).
//  - next/navigation useRouter: la rilettura server (router.refresh) e' osservata, non una
//    navigazione vera.

const { runPhase2Spy, refreshSpy, holder } = vi.hoisted(() => {
  const holder = { result: { ok: true } as unknown };
  return {
    holder,
    runPhase2Spy: vi.fn(async () => holder.result),
    refreshSpy: vi.fn(),
  };
});
vi.mock('@/data/generation-phase2', () => ({ runPhase2: runPhase2Spy }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshSpy }) }));

// Import DOPO i mock (vi.mock e' hoisted).
import { Phase2Trigger } from '@/ui/generation/Phase2Trigger';

const LABEL = 'Genera le pagine interne del sito';

beforeEach(() => {
  holder.result = { ok: true };
  runPhase2Spy.mockClear();
  refreshSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('WIRE trigger della fase 2 (Phase2Trigger) — raggiungibilita di runPhase2', () => {
  // covers: AC-235-5
  it('il click avvia runPhase2 con gli id della generazione e, a buon fine, rilegge i dati server', async () => {
    render(<Phase2Trigger siteId="site-di-a" generationId="gen-9" label={LABEL} />);

    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    await waitFor(() => expect(runPhase2Spy).toHaveBeenCalledTimes(1)); // covers: AC-235-5
    // gli id passati per intero (mai un prefisso): un accoppiamento sbagliato cadrebbe qui.
    expect(runPhase2Spy).toHaveBeenCalledWith({ siteId: 'site-di-a', generationId: 'gen-9' }); // covers: AC-235-5
    // a buon fine si rilegge lo stato (la rotta non offrira' piu' il trigger, status 'complete').
    await waitFor(() => expect(refreshSpy).toHaveBeenCalledTimes(1)); // covers: AC-235-5
    expect(document.querySelector('[data-phase2-failed="true"]')).toBeNull(); // covers: AC-235-5
  });

  // covers: AC-235-5
  it('un esito di fallimento non rilegge i dati e segnala l errore', async () => {
    holder.result = { ok: false, reason: 'stato_non_valido' };
    render(<Phase2Trigger siteId="site-di-a" generationId="gen-9" label={LABEL} />);

    fireEvent.click(screen.getByRole('button', { name: LABEL }));

    await waitFor(() => expect(runPhase2Spy).toHaveBeenCalledTimes(1)); // covers: AC-235-5
    await waitFor(() =>
      expect(document.querySelector('[data-phase2-failed="true"]')).not.toBeNull(),
    ); // covers: AC-235-5
    // il fallimento NON naviga: un sito a meta' non deve sembrare pronto.
    expect(refreshSpy).not.toHaveBeenCalled(); // covers: AC-235-5
  });
});
