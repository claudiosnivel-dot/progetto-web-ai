// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { RECIPES } from '@/domain/generation/recipes';
import type { SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// WIRE (macrotask generation-ui, P2) — INTEGRAZIONE del gesto a due passi (AC-233-4) ATTRAVERSO la
// `selectVariant` REALE. L'oracolo del pulsante (generation-choose-button.test) mocka l'azione e
// prova la meta' CLIENT (con quali argomenti la invoca); l'oracolo server (generation-rechoose.test)
// invoca l'azione DIRETTA. Nessuno dei due fa passare il GESTO dell'utente attraverso l'azione
// vera: e' il giunto che questo file copre. Qui il pulsante e la `selectVariant` sono ENTRAMBI
// reali; si mockano SOLO i seam di dato — getGeneration (lo stato 'complete'), getBrief,
// readHomePools — e il client SSR (un fake che REGISTRA l'UPDATE). La composizione del documento
// (resolveVariantHome) resta REALE, cosi' il documento congelato dalla riscelta e' autentico.
//
// PROPRIETA' PINNATA (security_note di AC-233-4): il PRIMO click ARMA soltanto — la `selectVariant`
// REALE non parte, quindi il DB non e' toccato (nessun UPDATE, getGeneration mai chiamata). Solo la
// CONFERMA fa partire l'azione, che legge lo stato 'complete' e guida il CAS della riscelta
// ESATTAMENTE da 'complete' (.eq('status','complete')) verso 'chosen'. Senza la conferma non parte;
// con la conferma parte.

const { redirectSpy } = vi.hoisted(() => ({ redirectSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: redirectSpy }));

const { getBriefSpy, briefHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { briefHolder: holder, getBriefSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { readHomePoolsSpy, poolsHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { poolsHolder: holder, readHomePoolsSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/generation-pools', () => ({ readHomePools: readHomePoolsSpy }));

const { getGenerationSpy, chooseVariantSpy, genHolder, chooseHolder } = vi.hoisted(() => {
  const genHolder = { current: null as unknown };
  const chooseHolder = { current: { ok: true } as unknown };
  return {
    genHolder,
    chooseHolder,
    getGenerationSpy: vi.fn(async () => genHolder.current),
    chooseVariantSpy: vi.fn(async () => chooseHolder.current),
  };
});
vi.mock('@/data/generations', () => ({
  getGeneration: getGenerationSpy,
  chooseVariant: chooseVariantSpy,
}));

// Il client con SESSIONE della riscelta (applyRechoose). Il fake registra l'UPDATE: `payload` (cosa
// si scrive) e `filters` (il CAS `.eq('id')`/`.eq('status')`). E' lo stesso fake di
// generation-rechoose.test — qui pero' e' guidato dal GESTO del pulsante, non da una chiamata diretta.
const { supaHolder } = vi.hoisted(() => ({
  supaHolder: {
    user: { id: 'user-a' } as unknown,
    updateResult: { data: [{ id: 'gen' }] as unknown[] | null, error: null as unknown },
    lastUpdate: null as null | { payload: Record<string, unknown>; filters: Record<string, unknown> },
  },
}));
vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: supaHolder.user }, error: null }) },
    from: () => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        update: (payload: Record<string, unknown>) => {
          supaHolder.lastUpdate = { payload, filters };
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        select: async () => supaHolder.updateResult,
      };
      return builder;
    },
  }),
}));

// Import DOPO i mock (vi.mock e' hoisted). Il pulsante e la selectVariant sono ENTRAMBI reali.
import { ChooseVariantButton } from '@/ui/generation/ChooseVariantButton';

// Brief RICCO, dominio REALE (come generation-choose/rechoose.test): basta a far comporre a
// resolveVariantHome un documento home valido, cosi' la riscelta arriva davvero al CAS.
const RICH_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Trattoria Aurora',
  vertical: 'ristorazione',
  description: 'Cucina di mercato nel centro storico, aperta dal 1980.',
  whatsapp: '+39 333 4445566',
  phone: '+39 06 5551234',
  address: 'Via Verdi 12, Roma',
  hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
  offerings: [
    { name: 'Antipasto', section: 'Cucina' },
    { name: 'Antipasto della casa', section: 'Cucina' },
    { name: 'Dolce', section: 'Dessert' },
  ],
}).brief;

function homePool(firma: string): { pages: { home: Record<string, unknown> } } {
  return {
    pages: {
      home: {
        hero_title_kicker: `Occhiello ${firma}`,
        hero_title: `Titolo hero ${firma}`,
        hero_subtitle: `Sottotitolo hero ${firma}`,
        offerings_title: `Le nostre offerte ${firma}`,
        offerings_intro: `Introduzione alle offerte ${firma}`,
        about_title: `Chi siamo ${firma}`,
        about_body: `La nostra storia ${firma}`,
        about_points: [`Primo punto ${firma}`, `Secondo punto ${firma}`],
        hours_title: `I nostri orari ${firma}`,
        hours_intro: `Nota sugli orari ${firma}`,
        contact_title: `Contattaci ${firma}`,
        contact_intro: `Scrivici per informazioni ${firma}`,
        faq_title: `Domande frequenti ${firma}`,
        faq_items: [
          { question: `Prima domanda ${firma}?`, answer: `Prima risposta ${firma}` },
          { question: `Seconda domanda ${firma}?`, answer: `Seconda risposta ${firma}` },
        ],
        whatsapp_cta_title: `Scrivici su WhatsApp ${firma}`,
      },
    },
  };
}

const SHARED_POOL = homePool('condiviso');
const SITE_ID = 'site-di-a';
const GEN_ID = '11111111-1111-4111-8111-111111111111';

const LABELS = {
  choose: 'Scegli questa proposta',
  confirmPrompt: 'Cambiare proposta rigenera le pagine interne. Procedere?',
  confirm: 'Sì, rigenera con questa proposta',
  cancel: 'Annulla',
};

function generazione(status: string) {
  return {
    ok: true,
    generation: {
      id: GEN_ID,
      site_id: SITE_ID,
      status,
      max_pages: 10,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    },
  };
}

beforeEach(() => {
  briefHolder.current = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  poolsHolder.current = { ok: true, shared: SHARED_POOL, byVariant: {} };
  genHolder.current = generazione('complete');
  chooseHolder.current = { ok: true };
  supaHolder.user = { id: 'user-a' };
  supaHolder.updateResult = { data: [{ id: GEN_ID }], error: null };
  supaHolder.lastUpdate = null;
  getGenerationSpy.mockClear();
  chooseVariantSpy.mockClear();
  getBriefSpy.mockClear();
  readHomePoolsSpy.mockClear();
  redirectSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('WIRE integrazione AC-233-4 — gesto a due passi ATTRAVERSO la selectVariant reale', () => {
  // covers: AC-233-4
  it('il PRIMO click ARMA (nessun UPDATE, DB intatto); solo la CONFERMA guida il CAS .eq("status","complete") -> chosen', async () => {
    render(
      <ChooseVariantButton
        siteId={SITE_ID}
        generationId={GEN_ID}
        locale="it"
        variantIndex={2}
        status="complete"
        labels={LABELS}
      />,
    );

    // PRIMO click: su 'complete' arma soltanto. La selectVariant REALE NON e' invocata — lo stato
    // non e' nemmeno letto (getGeneration mai chiamata) e il DB non e' toccato (nessun UPDATE).
    fireEvent.click(document.querySelector('[data-choose-variant="2"]') as HTMLElement);
    expect(document.querySelector('[data-choose-confirm-dialog="2"]')).not.toBeNull(); // covers: AC-233-4
    expect(getGenerationSpy).not.toHaveBeenCalled(); // covers: AC-233-4
    expect(supaHolder.lastUpdate).toBeNull(); // covers: AC-233-4

    // CONFERMA (secondo gesto): ora la selectVariant REALE parte, legge lo stato 'complete' e guida
    // il CAS della riscelta ESATTAMENTE da 'complete' verso 'chosen' (applyRechoose).
    fireEvent.click(document.querySelector('[data-choose-confirm="2"]') as HTMLElement);
    await waitFor(() => expect(supaHolder.lastUpdate).not.toBeNull()); // covers: AC-233-4
    expect(getGenerationSpy).toHaveBeenCalledTimes(1); // covers: AC-233-4
    // Il CAS riparte ESATTAMENTE da 'complete': e' cio' che rende la conferma non aggirabile per
    // corsa (se la fase 2 fosse avanzata nel frattempo, .eq('status','complete') toccherebbe 0 righe).
    expect(supaHolder.lastUpdate!.filters).toEqual({ id: GEN_ID, status: 'complete' }); // covers: AC-233-4
    expect(supaHolder.lastUpdate!.payload.status).toBe('chosen'); // covers: AC-233-4
    expect(supaHolder.lastUpdate!.payload.chosen_variant).toBe(2); // covers: AC-233-4
    // e cio' che si congela e' la SOLA home della nuova variante (documento autentico, composizione reale).
    const doc = supaHolder.lastUpdate!.payload.document as SiteDocument;
    expect(doc.recipe_id).toBe(RECIPES[2].id); // covers: AC-233-4
    expect(doc.pages.length).toBe(1); // covers: AC-233-4
    expect(doc.pages[0].role).toBe('home'); // covers: AC-233-4
  });

  // covers: AC-233-4
  it('annullare dopo il primo click lascia il DB intatto e non invoca mai la selectVariant reale', async () => {
    render(
      <ChooseVariantButton
        siteId={SITE_ID}
        generationId={GEN_ID}
        locale="it"
        variantIndex={2}
        status="complete"
        labels={LABELS}
      />,
    );

    fireEvent.click(document.querySelector('[data-choose-variant="2"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-choose-cancel="2"]') as HTMLElement);

    // annullato: la selectVariant reale non e' mai partita, quindi nessuna lettura e nessun UPDATE.
    expect(getGenerationSpy).not.toHaveBeenCalled(); // covers: AC-233-4
    expect(supaHolder.lastUpdate).toBeNull(); // covers: AC-233-4
    expect(document.querySelector('[data-choose-variant="2"]')).not.toBeNull(); // covers: AC-233-4
  });
});
