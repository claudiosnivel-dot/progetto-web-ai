import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RECIPES } from '@/domain/generation/recipes';
import type { SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-310 (macrotask editor-core, P3) — GUARDIA RISCELTA SOFT: la riscelta dopo l'editing e' NON
// DISTRUTTIVA. Estende `applyRechoose`/`selectVariant` (src/data/generation-choose.ts) perche', dal
// documento FRESCO, crei una revisione `source='rechosen'` (site_document_revisions, T-301/T-302)
// che diventa il documento CORRENTE (read-path "ultima revisione else baseline", T-304), lasciando
// leggibili in storia le revisioni 'edited' precedenti (append-only, MAI mutate ne eliminate). Le
// asserzioni derivano dagli acceptance_criteria AC-310-1/2/3 (01-editor-core.md), taggate
// `// covers:` sulla riga dell'EXPECT.
//
// PERCHE' UN SEGNALE `fromEditor` E NON una lettura server-side incondizionata delle revisioni: lo
// snapshot serve SOLO quando puo' esistere lavoro editoriale da preservare — cioe' quando la
// riscelta parte dalla SUPERFICIE EDITOR (P3-D3/P3-D5), dove le revisioni si accumulano. La riscelta
// del selettore pre-editing (T-233) non ha revisioni: non deve nemmeno toccare la tabella, e il suo
// CAS PURO (zero I/O sulle revisioni) va PRESERVATO. `fromEditor` distingue i due ingressi. Non e'
// un confine di sicurezza: lo snapshot resta server-composto e passato da `parseDocument`, scritto
// sul client di SESSIONE (RLS), con account_id DERIVATO dalla riga aggiornata, MAI service_role;
// omettere il flag al piu' salta uno snapshot (nessuna scrittura cross-tenant e' mai possibile).
//
// REGISTRO HERMETIC: guida la `selectVariant` REALE con i seam di dato mockati (getGeneration,
// getBrief, readHomePools) e un FAKE del client di sessione che INSTRADA PER TABELLA e REGISTRA il
// CAS e ogni operazione sulla tabella revisioni. Prova la LOGICA: CAS TOCTOU-safe preservato
// (AC-310-3), conferma-di-costo AC-233-4 preservata (AC-310-2), e la MECCANICA dello snapshot
// rechosen non distruttivo (AC-310-1) — un solo INSERT `source='rechosen'` a seq=max+1, MAI un
// UPDATE/DELETE su una revisione esistente. La prova RUNTIME sotto RLS (revisione persistita, edited
// leggibili dopo, non-proprietario che non scrive) e' DB-backed e DEFERITA al checkpoint: e'
// strutturalmente la stessa scrittura di `saveRevision` (T-302, stessa tabella/RLS/client), gia'
// pinnata a runtime — vedi `risks`.

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

/** Un pool 'home' che riempie tutti gli slot, cosi' `resolveVariantHome` compone una home valida. */
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
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

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

// Il client con sessione della riscelta (applyRechoose). Il fake INSTRADA PER TABELLA:
//  - site_generations: registra il CAS `.update().eq('id').eq('status').select()` (payload + filtri).
//  - site_document_revisions: la lettura del max seq `.select().eq().order().limit().maybeSingle()`
//    e l'`.insert()`, e CONTA ogni tentativo di UPDATE/DELETE — che per l'append-only deve stare a 0.
const { supaHolder } = vi.hoisted(() => ({
  supaHolder: {
    user: { id: 'user-a' } as unknown,
    // Valore iniziale neutro: `beforeEach` imposta il CAS result reale (data con id + account_id).
    casResult: { data: null as unknown[] | null, error: null as unknown },
    lastCas: null as null | { payload: Record<string, unknown>; filters: Record<string, unknown> },
    maxSeqRow: null as null | { seq: number | string },
    seqReadError: null as unknown,
    revReadFilters: null as null | Record<string, unknown>,
    inserts: [] as Array<Record<string, unknown>>,
    insertError: null as null | { code?: string },
    revisionUpdates: 0,
    revisionDeletes: 0,
  },
}));
vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: supaHolder.user }, error: null }) },
    from: (table: string) => {
      if (table === 'site_generations') {
        const filters: Record<string, unknown> = {};
        const b: Record<string, unknown> = {
          update: (payload: Record<string, unknown>) => {
            supaHolder.lastCas = { payload, filters };
            return b;
          },
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return b;
          },
          select: async () => supaHolder.casResult,
        };
        return b;
      }
      // site_document_revisions
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: async () => {
          supaHolder.revReadFilters = filters;
          return { data: supaHolder.maxSeqRow, error: supaHolder.seqReadError };
        },
        insert: async (row: Record<string, unknown>) => {
          supaHolder.inserts.push(row);
          return { error: supaHolder.insertError };
        },
        update: () => {
          supaHolder.revisionUpdates += 1;
          return b;
        },
        delete: () => {
          supaHolder.revisionDeletes += 1;
          return b;
        },
      };
      return b;
    },
  }),
}));

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn() }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { selectVariant } from '@/data/generation-choose';

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
  genHolder.current = generazione('chosen');
  chooseHolder.current = { ok: true };
  supaHolder.user = { id: 'user-a' };
  supaHolder.casResult = { data: [{ id: GEN_ID, account_id: ACCOUNT_ID }], error: null };
  supaHolder.lastCas = null;
  supaHolder.maxSeqRow = null;
  supaHolder.seqReadError = null;
  supaHolder.revReadFilters = null;
  supaHolder.inserts = [];
  supaHolder.insertError = null;
  supaHolder.revisionUpdates = 0;
  supaHolder.revisionDeletes = 0;
  getGenerationSpy.mockClear();
  chooseVariantSpy.mockClear();
  getBriefSpy.mockClear();
  readHomePoolsSpy.mockClear();
  redirectSpy.mockClear();
  boundarySpy.mockReset();
});

describe('T-310 riscelta soft non distruttiva — snapshot rechosen (hermetic)', () => {
  // covers: AC-310-1
  it("dall'editor, con revisioni 'edited' precedenti, la riscelta crea UNA revisione 'rechosen' a seq=max+1 senza mai mutare/eliminare le esistenti", async () => {
    // given: il sito e' 'chosen' con DUE revisioni 'edited' gia' in storia (seq massimo 2).
    genHolder.current = generazione('chosen');
    supaHolder.maxSeqRow = { seq: 2 };
    // …e la variante 1 ha un pool PROPRIO, cosi' il documento fresco porta la SUA prosa.
    poolsHolder.current = { ok: true, shared: SHARED_POOL, byVariant: { 1: homePool('propria-1') } };

    // when: l'utente risceglie la variante 1 DALL'EDITOR (fromEditor).
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 1, fromEditor: true });

    // then: e' scritta ESATTAMENTE una revisione, 'rechosen', a seq = max(2)+1 = 3, dal documento
    // fresco (sola home della variante 1), account_id DERIVATO dalla riga aggiornata dal CAS.
    expect(supaHolder.inserts).toHaveLength(1); // covers: AC-310-1
    const rev = supaHolder.inserts[0];
    expect(rev.source).toBe('rechosen'); // covers: AC-310-1
    expect(rev.seq).toBe(3); // covers: AC-310-1
    expect(rev.site_generation_id).toBe(GEN_ID); // covers: AC-310-1
    expect(rev.account_id).toBe(ACCOUNT_ID); // covers: AC-310-1
    const doc = rev.document as SiteDocument;
    expect(doc.recipe_id).toBe(RECIPES[1].id); // covers: AC-310-1
    expect(doc.pages).toHaveLength(1); // covers: AC-310-1
    expect(doc.pages[0].role).toBe('home'); // covers: AC-310-1
    // il contenuto fresco viene dal pool PROPRIO della variante, non dal condiviso.
    const contenuto = JSON.stringify(doc.pages[0].blocks.map((b) => b.content));
    expect(contenuto).toContain('propria-1'); // covers: AC-310-1

    // then: NON DISTRUTTIVO — nessun UPDATE ne DELETE su una revisione esistente: le 'edited'
    // precedenti restano leggibili in storia (append-only, "l'ultima vince" per seq).
    expect(supaHolder.revisionUpdates).toBe(0); // covers: AC-310-1
    expect(supaHolder.revisionDeletes).toBe(0); // covers: AC-310-1
    // la lettura del max seq e' SCOPATA alla generazione corrente (non un max globale).
    expect(supaHolder.revReadFilters).toEqual({ site_generation_id: GEN_ID }); // covers: AC-310-1

    // P3-D9: la riscelta DALL'EDITOR (fromEditor) e' un CAS chosen->chosen che NON tocca la baseline
    // congelata site_generations.document — il design fresco viaggia SOLO per la revisione append-only.
    expect(supaHolder.lastCas).not.toBeNull();
    expect(supaHolder.lastCas!.filters).toEqual({ id: GEN_ID, status: 'chosen' });
    expect(supaHolder.lastCas!.payload.chosen_variant).toBe(1);
    // NEGATIVA che pinna P3-D9: nessun `document` nel payload del CAS. Un ritorno alla sovrascrittura
    // della baseline (regressione) farebbe fallire QUI, non passare in silenzio.
    expect(supaHolder.lastCas!.payload).not.toHaveProperty('document'); // covers: AC-310-1
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`);
  });

  // covers: AC-310-1
  it('senza revisioni precedenti lo snapshot rechosen prende seq=1 (baseline = seq 0)', async () => {
    genHolder.current = generazione('chosen');
    supaHolder.maxSeqRow = null; // nessuna revisione ancora

    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 2, fromEditor: true });

    expect(supaHolder.inserts).toHaveLength(1); // covers: AC-310-1
    expect(supaHolder.inserts[0].seq).toBe(1); // covers: AC-310-1
    expect(supaHolder.inserts[0].source).toBe('rechosen'); // covers: AC-310-1
  });

  // covers: AC-310-2
  it("da 'complete' SENZA confirm la riscelta non procede (conferma_richiesta) e NULLA e' scritto; CON confirm scrive lo snapshot rechosen (AC-233-4 preservata)", async () => {
    genHolder.current = generazione('complete');
    supaHolder.maxSeqRow = { seq: 4 };

    // when: riscelta da 'complete' dall'editor SENZA conferma.
    const senza = await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 3,
      fromEditor: true,
    });

    // then: chiede la conferma di costo (AC-233-4) — nessun CAS, nessuna revisione, nessun redirect.
    expect(senza).toEqual({ ok: false, reason: 'conferma_richiesta' }); // covers: AC-310-2
    expect(supaHolder.lastCas).toBeNull(); // covers: AC-310-2
    expect(supaHolder.inserts).toHaveLength(0); // covers: AC-310-2
    expect(redirectSpy).not.toHaveBeenCalled(); // covers: AC-310-2

    // when: la stessa riscelta CON conferma esplicita.
    await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 3,
      confirm: true,
      fromEditor: true,
    });

    // then: il CAS riparte ESATTAMENTE da 'complete' (TOCTOU-safe) e lo snapshot rechosen e' scritto
    // a seq=max+1, non distruttivo.
    expect(supaHolder.lastCas).not.toBeNull();
    expect(supaHolder.lastCas!.filters).toEqual({ id: GEN_ID, status: 'complete' }); // covers: AC-310-2
    expect(supaHolder.lastCas!.payload.status).toBe('chosen'); // covers: AC-310-2
    expect(supaHolder.inserts).toHaveLength(1); // covers: AC-310-2
    expect(supaHolder.inserts[0].source).toBe('rechosen'); // covers: AC-310-2
    expect(supaHolder.inserts[0].seq).toBe(5); // covers: AC-310-2
    expect(supaHolder.revisionDeletes).toBe(0); // covers: AC-310-2
  });

  // covers: AC-310-3
  it("stato letto 'chosen' ma avanzato: il CAS .eq(status,'chosen') tocca 0 righe -> conflitto, NESSUNO snapshot (nessun reset silenzioso)", async () => {
    genHolder.current = generazione('chosen');
    supaHolder.maxSeqRow = { seq: 7 };
    // Il DB e' avanzato nel frattempo: il CAS con lo stato ESATTO letto tocca 0 righe.
    supaHolder.casResult = { data: [], error: null };

    const res = await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 1,
      fromEditor: true,
    });

    // then: conflitto — e NIENTE e' stato scritto: nessuna revisione rechosen su un CAS fallito.
    expect(res).toEqual({ ok: false, reason: 'conflitto' }); // covers: AC-310-3
    expect(supaHolder.lastCas!.filters).toEqual({ id: GEN_ID, status: 'chosen' }); // covers: AC-310-3
    expect(supaHolder.inserts).toHaveLength(0); // covers: AC-310-3
    expect(supaHolder.revisionDeletes).toBe(0); // covers: AC-310-3
    expect(redirectSpy).not.toHaveBeenCalled(); // covers: AC-310-3
  });

  it("PRESERVAZIONE P2: la riscelta del selettore (senza fromEditor) resta CAS puro — nessuna I/O sulle revisioni (AC-233-3/AC-233-4 intatti)", async () => {
    // La riscelta pre-editing (T-233) non ha revisioni: non deve leggere ne scrivere la tabella. E'
    // cio' che tiene VERDI gli oracoli P2 (generation-choose/generation-rechoose), il cui fake del
    // client di sessione conosce solo il CAS.
    genHolder.current = generazione('chosen');
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 1 });
    expect(supaHolder.lastCas).not.toBeNull(); // il CAS avviene comunque
    expect(supaHolder.inserts).toHaveLength(0);
    expect(supaHolder.revReadFilters).toBeNull(); // nessuna lettura della tabella revisioni

    // idem da 'complete' con conferma: transizione, ma nessuno snapshot senza fromEditor.
    genHolder.current = generazione('complete');
    supaHolder.lastCas = null;
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 3, confirm: true });
    expect(supaHolder.lastCas).not.toBeNull();
    expect(supaHolder.inserts).toHaveLength(0);
  });
});
