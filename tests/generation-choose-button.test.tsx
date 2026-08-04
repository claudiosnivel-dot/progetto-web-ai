// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// WIRE (macrotask generation-ui, P2) — ORACOLO del PULSANTE DI SCELTA (ChooseVariantButton), il
// consumatore di PRODUZIONE di `selectVariant` (chiude l'orfano rilevato su T-233, P2-D26). Le
// asserzioni sono taggate `// covers: AC-233-<n>` / `AC-235-5` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - @/data/generation-choose selectVariant: il seam dell'azione. Il pulsante e' testato per cio'
//    che FA — con quali argomenti invoca l'azione, e QUANDO — non per la sua resa. In produzione
//    l'azione REINDIRIZZA al successo (qui il doppio ritorna un ok e non naviga: si osserva la
//    CHIAMATA, che e' la meta' client della scelta).
//
// PROPRIETA' FALSIFICABILI PINNATE:
//  - l'indice spedito e' quello della card CLICCATA, non un altro: due pulsanti con indici
//    DISCORDANTI (1 e 3), si clicca il 3 e si asserisce 3 — un indice costante o sbagliato cade.
//  - la conferma dopo la fase 2 (AC-233-4) e' un GESTO A DUE PASSI: senza il secondo gesto
//    l'azione NON parte, e `confirm:true` non e' mai spedito dal solo montaggio del pulsante.

const { selectVariantSpy, holder } = vi.hoisted(() => {
  const holder = { result: { ok: true } as unknown };
  return { holder, selectVariantSpy: vi.fn(async () => holder.result) };
});
vi.mock('@/data/generation-choose', () => ({ selectVariant: selectVariantSpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { ChooseVariantButton } from '@/ui/generation/ChooseVariantButton';

const LABELS = {
  choose: 'Scegli questa proposta',
  confirmPrompt: 'Cambiare proposta rigenera le pagine interne. Procedere?',
  confirm: 'Sì, rigenera con questa proposta',
  cancel: 'Annulla',
};

// siteId e generationId con l'uno PREFISSO dell'altro sarebbe fuori luogo qui (sono passati per
// intero all'azione); la discordanza che conta e' fra gli INDICI delle card.
const BASE = { siteId: 'site-di-a', generationId: 'gen-1', locale: 'it', labels: LABELS } as const;

beforeEach(() => {
  // Successo: in produzione selectVariant reindirizza; qui basta un ok, il pulsante non naviga.
  holder.result = { ok: true };
  selectVariantSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('WIRE scelta diretta (ready/chosen): un click, indice della card cliccata', () => {
  // covers: AC-233-1
  it("stato 'ready': un click invoca selectVariant con l'indice cliccato e confirm=false", async () => {
    render(
      <>
        <ChooseVariantButton {...BASE} variantIndex={1} status="ready" />
        <ChooseVariantButton {...BASE} variantIndex={3} status="ready" />
      </>,
    );
    // due pulsanti di scelta (uno per card), con indici discordanti.
    expect(screen.getAllByRole('button', { name: LABELS.choose })).toHaveLength(2);

    fireEvent.click(document.querySelector('[data-choose-variant="3"]') as HTMLElement);

    // then: l'azione e' invocata UNA volta (consumatore di produzione raggiungibile)…
    await waitFor(() => expect(selectVariantSpy).toHaveBeenCalledTimes(1)); // covers: AC-235-5
    // …con l'indice della card CLICCATA (3, non 1) e confirm=false (nessun costo di fase 2).
    expect(selectVariantSpy).toHaveBeenCalledWith({
      siteId: 'site-di-a',
      generationId: 'gen-1',
      locale: 'it',
      variantIndex: 3,
      confirm: false,
    }); // covers: AC-233-1
  });

  // covers: AC-233-1
  it("stato 'chosen' (riscelta prima della fase 2): un click, confirm=false (nessun gesto in piu')", async () => {
    render(<ChooseVariantButton {...BASE} variantIndex={2} status="chosen" />);
    // nessun dialog di conferma su 'chosen': la riscelta e' gratuita.
    expect(document.querySelector('[data-choose-confirm-dialog]')).toBeNull(); // covers: AC-233-1

    fireEvent.click(document.querySelector('[data-choose-variant="2"]') as HTMLElement);
    await waitFor(() => expect(selectVariantSpy).toHaveBeenCalledTimes(1)); // covers: AC-233-1
    expect(selectVariantSpy).toHaveBeenCalledWith({
      siteId: 'site-di-a',
      generationId: 'gen-1',
      locale: 'it',
      variantIndex: 2,
      confirm: false,
    }); // covers: AC-233-1
  });
});

describe('WIRE riscelta DOPO la fase 2 (complete): gesto reale a due passi (AC-233-4)', () => {
  // covers: AC-233-4
  it("il primo click ARMA soltanto: selectVariant NON parte finche' non arriva la conferma", async () => {
    render(<ChooseVariantButton {...BASE} variantIndex={2} status="complete" />);

    // prima del gesto: il pulsante di scelta c'e', il dialog no, l'azione non e' stata toccata.
    expect(document.querySelector('[data-choose-confirm-dialog]')).toBeNull(); // covers: AC-233-4
    fireEvent.click(document.querySelector('[data-choose-variant="2"]') as HTMLElement);

    // dopo il PRIMO click: compare il dialog di conferma, ma l'azione NON e' partita (nessun bool
    // nudo spedito). Questa e' la garanzia di AC-233-4.
    expect(document.querySelector('[data-choose-confirm-dialog="2"]')).not.toBeNull(); // covers: AC-233-4
    expect(selectVariantSpy).not.toHaveBeenCalled(); // covers: AC-233-4

    // il SECONDO gesto (conferma) invoca l'azione con confirm=true.
    fireEvent.click(document.querySelector('[data-choose-confirm="2"]') as HTMLElement);
    await waitFor(() => expect(selectVariantSpy).toHaveBeenCalledTimes(1)); // covers: AC-233-4
    expect(selectVariantSpy).toHaveBeenCalledWith({
      siteId: 'site-di-a',
      generationId: 'gen-1',
      locale: 'it',
      variantIndex: 2,
      confirm: true,
    }); // covers: AC-233-4
  });

  // covers: AC-233-4
  it('annullare la conferma non invoca l azione e riporta al pulsante di scelta', async () => {
    render(<ChooseVariantButton {...BASE} variantIndex={4} status="complete" />);
    fireEvent.click(document.querySelector('[data-choose-variant="4"]') as HTMLElement);
    // armato: il dialog c'e'.
    expect(document.querySelector('[data-choose-confirm="4"]')).not.toBeNull(); // covers: AC-233-4

    fireEvent.click(document.querySelector('[data-choose-cancel="4"]') as HTMLElement);
    // annullato: nessuna chiamata, il dialog sparisce e torna il pulsante di scelta.
    expect(selectVariantSpy).not.toHaveBeenCalled(); // covers: AC-233-4
    expect(document.querySelector('[data-choose-confirm="4"]')).toBeNull(); // covers: AC-233-4
    expect(document.querySelector('[data-choose-variant="4"]')).not.toBeNull(); // covers: AC-233-4
  });
});
