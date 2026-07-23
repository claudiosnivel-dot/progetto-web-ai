// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-105 — Controlli UI rinomina/elimina della dashboard (componente SiteRow),
// testati in isolamento. Le server action di dato (T-103) sono mockate come spy:
// il livello UI si limita a invocarle (l'autorizzazione cross-tenant è imposta
// dalla RLS in T-103, non dalla UI). L'eliminazione richiede una conferma
// esplicita PRIMA di invocare deleteSite (AC-105-1).

const { renameSiteSpy, deleteSiteSpy } = vi.hoisted(() => ({
  renameSiteSpy: vi.fn(async () => ({ ok: true as const })),
  deleteSiteSpy: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock('@/data/sites', () => ({
  renameSite: renameSiteSpy,
  deleteSite: deleteSiteSpy,
}));

const { refreshSpy } = vi.hoisted(() => ({ refreshSpy: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshSpy }),
}));

import { SiteRow } from '@/ui/sites/SiteRow';

const itLabels = itMessages.dashboard.actions;
const esLabels = esMessages.dashboard.actions;
const site = { id: 'site-1', name: 'Bar Sole', status: 'draft' };

beforeEach(() => {
  renameSiteSpy.mockClear();
  deleteSiteSpy.mockClear();
  refreshSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('T-105 SiteRow (controlli rinomina/elimina)', () => {
  // covers: AC-105-1
  it("l'eliminazione richiede conferma esplicita: deleteSite NON è invocata finché la conferma non è accettata", async () => {
    const user = userEvent.setup();
    render(h(SiteRow, { site, labels: itLabels }));

    // Attivazione dell'eliminazione → compare la conferma, ma deleteSite NON parte.
    await user.click(screen.getByRole('button', { name: itLabels.delete }));
    expect(deleteSiteSpy).not.toHaveBeenCalled(); // covers: AC-105-1
    expect(
      screen.getByRole('button', { name: itLabels.confirmDelete }),
    ).toBeTruthy(); // covers: AC-105-1

    // Solo dopo la conferma esplicita deleteSite viene invocata con l'id del sito.
    await user.click(screen.getByRole('button', { name: itLabels.confirmDelete }));
    await waitFor(() =>
      expect(deleteSiteSpy).toHaveBeenCalledWith(site.id),
    ); // covers: AC-105-1
  });

  // covers: AC-105-1
  it("annullare la conferma non invoca deleteSite", async () => {
    const user = userEvent.setup();
    render(h(SiteRow, { site, labels: itLabels }));
    await user.click(screen.getByRole('button', { name: itLabels.delete }));
    await user.click(screen.getByRole('button', { name: itLabels.cancel }));
    expect(deleteSiteSpy).not.toHaveBeenCalled(); // covers: AC-105-1
    // Tornati allo stato iniziale: il pulsante Elimina è di nuovo disponibile.
    expect(screen.getByRole('button', { name: itLabels.delete })).toBeTruthy();
  });

  // covers: AC-105-2
  it("la rinomina con un name valido invoca renameSite col nuovo name e ricarica", async () => {
    const user = userEvent.setup();
    render(h(SiteRow, { site, labels: itLabels }));

    const input = screen.getByLabelText(itLabels.rename);
    await user.clear(input);
    await user.type(input, 'Nome Aggiornato');
    await user.click(screen.getByRole('button', { name: itLabels.save }));

    await waitFor(() =>
      expect(renameSiteSpy).toHaveBeenCalledWith(site.id, 'Nome Aggiornato'),
    ); // covers: AC-105-2
    await waitFor(() => expect(refreshSpy).toHaveBeenCalled()); // covers: AC-105-2 — refresh dell'elenco
  });

  // covers: AC-105-3
  it("in locale es le etichette rinomina/elimina/conferma sono in spagnolo (diverse dall it)", async () => {
    render(h(SiteRow, { site, labels: esLabels }));

    expect(screen.getByLabelText(esLabels.rename)).toBeTruthy(); // covers: AC-105-3
    expect(screen.getByRole('button', { name: esLabels.save })).toBeTruthy(); // covers: AC-105-3
    expect(screen.getByRole('button', { name: esLabels.delete })).toBeTruthy(); // covers: AC-105-3

    // Le etichette spagnole differiscono da quelle italiane (parità di chiavi,
    // valori diversi).
    expect(esLabels.rename).not.toBe(itLabels.rename); // covers: AC-105-3
    expect(esLabels.delete).not.toBe(itLabels.delete); // covers: AC-105-3
    expect(esLabels.confirmDelete).not.toBe(itLabels.confirmDelete); // covers: AC-105-3
  });
});
