import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RECIPES } from '@/domain/generation/recipes';
import type { SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-233 (macrotask generation-ui, P2) — ORACOLO della RISCELTA DOPO LA FASE 2. L'asserzione deriva
// da AC-233-4 (04-generation-ui.md), taggata `// covers: AC-233-4` sulla riga dell'EXPECT.
//
// LA DECISIONE CHE QUESTO FILE PINNA (security_note di AC-233-4): dopo la fase 2 riscegliere ha un
// COSTO REALE — la fase 2 va rifatta, cioe' altre chiamate al modello a pagamento. Non puo' essere
// un gesto silenzioso: senza una conferma ESPLICITA l'azione NON procede e NON scrive nulla. Solo
// con la conferma la generazione torna a 'chosen' con la sola home della nuova variante — lo stato
// da cui la fase 2 (T-234) verra' rifatta.
//
// I seam mockati sono gli stessi di generation-choose.test: getGeneration porta lo stato 'complete',
// il fake di supabase-ssr registra il CAS della riscelta, il confine (@/data/anthropic) e' mockato
// per PROVARE che la riscelta non lo tocca finche' la conferma non arriva (e nemmeno dopo, in
// T-233: rimettere in moto la fase 2 e' di T-234).

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

// Il client con sessione della riscelta (applyRechoose). Il fake registra l'UPDATE: `payload` (cosa
// si scrive) e `filters` (il CAS `.eq('id')`/`.eq('status')`).
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

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn() }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { selectVariant } from '@/data/generation-choose';

// Brief RICCO, dominio REALE (come generation-choose.test). Valori DISCORDANTI: due chiavi orario,
// tre offerte di cui una il PREFISSO di un'altra ('Antipasto' / 'Antipasto della casa').
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
  boundarySpy.mockReset();
});

describe('T-233 riscelta DOPO la fase 2 (complete): conferma esplicita', () => {
  // covers: AC-233-4
  it("da 'complete' SENZA conferma l'azione non procede; solo CON la conferma la generazione torna a 'chosen' per rifare la fase 2", async () => {
    // when: da 'complete', l'utente tenta di scegliere una variante diversa SENZA confermare.
    const senza = await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 4,
    });

    // then: l'azione NON procede e chiede una conferma esplicita — nessuna scrittura, nessuna
    // transizione, nessun confine, nessun reindirizzamento.
    expect(senza).toEqual({ ok: false, reason: 'conferma_richiesta' }); // covers: AC-233-4
    expect(supaHolder.lastUpdate).toBeNull(); // covers: AC-233-4
    expect(chooseVariantSpy).not.toHaveBeenCalled(); // covers: AC-233-4
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-233-4
    expect(redirectSpy).not.toHaveBeenCalled(); // covers: AC-233-4

    // when: la stessa scelta, ma CON conferma esplicita.
    await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 4,
      confirm: true,
    });

    // then: solo ora la generazione torna a 'chosen' con la sola home della nuova variante — lo
    // stato da cui la fase 2 (T-234) verra' rifatta. Il CAS riparte ESATTAMENTE da 'complete'.
    expect(supaHolder.lastUpdate).not.toBeNull();
    expect(supaHolder.lastUpdate!.filters).toEqual({ id: GEN_ID, status: 'complete' }); // covers: AC-233-4
    expect(supaHolder.lastUpdate!.payload.status).toBe('chosen'); // covers: AC-233-4
    expect(supaHolder.lastUpdate!.payload.chosen_variant).toBe(4); // covers: AC-233-4
    const doc = supaHolder.lastUpdate!.payload.document as SiteDocument;
    expect(doc.recipe_id).toBe(RECIPES[4].id); // covers: AC-233-4
    expect(doc.pages.length).toBe(1); // covers: AC-233-4
    expect(doc.pages[0].role).toBe('home'); // covers: AC-233-4
    // la fase 2 in se' (rimettere in moto le pagine interne) e' di T-234: qui il confine resta
    // intatto anche dopo la conferma — T-233 riporta soltanto la generazione allo stato 'chosen'.
    expect(boundarySpy).not.toHaveBeenCalled();
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`);
  });
});
