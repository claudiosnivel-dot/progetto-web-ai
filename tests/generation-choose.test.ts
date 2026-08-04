// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import { RECIPES } from '@/domain/generation/recipes';
import type { SiteDocument } from '@/domain/generation/document';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-233 (macrotask generation-ui, P2) — ORACOLO di SCEGLI & CONGELA. Le asserzioni derivano da
// AC-233-1, -2, -3, -5, -6 (04-generation-ui.md), taggate `// covers: AC-233-<n>` sulla riga
// dell'EXPECT. AC-233-4 (conferma sulla riscelta dopo la fase 2) vive in generation-rechoose.test.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - @/data/generations getGeneration/chooseVariant: lo STATO corrente e la transizione ready->chosen
//    di T-204 (gia' pinnata a runtime la': qui si prova che selectVariant la CHIAMA con la variante e
//    il documento giusti, non la si riscrive).
//  - @/data/briefs getBrief e @/data/generation-pools readHomePools: i seam di lettura. La
//    COMPOSIZIONE del documento (resolveVariantHome, resolve, pages, recipes, temi) gira PER DAVVERO
//    sul brief e sul pool reali, quindi il documento congelato e' autentico (AC-233-2).
//  - @/data/supabase-ssr: il client con SESSIONE, per la scrittura di RISCELTA in 'chosen'
//    (applyRechoose). Il fake registra il payload dell'UPDATE e i filtri del CAS.
//  - next/navigation redirect: la destinazione dell'anteprima, mai una navigazione vera.
//  - @/data/anthropic runGenerationTurn: il CONFINE. NON e' nel percorso della scelta — e' mockato
//    proprio per PROVARE che scegliere e riscegliere prima della fase 2 non lo tocca (P2-D3).
//  - next-intl/server getTranslations: il catalogo REALE it (namespace 'site'), per il render di
//    AC-233-6 dallo stesso renderer dell'anteprima (SiteView, T-231).

const { getTranslationsMock } = vi.hoisted(() => ({ getTranslationsMock: vi.fn() }));
vi.mock('next-intl/server', () => ({ getTranslations: getTranslationsMock }));

const { redirectSpy, notFoundSpy } = vi.hoisted(() => ({ redirectSpy: vi.fn(), notFoundSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: redirectSpy, notFound: notFoundSpy }));

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

// Il client con sessione della RISCELTA (applyRechoose). Il fake registra l'UPDATE: `payload` (cosa
// si scrive) e `filters` (il CAS `.eq('id')`/`.eq('status')`). `filters` e' lo STESSO oggetto
// catturato in `update`, quindi le `.eq()` successive vi si accumulano.
const { supaHolder } = vi.hoisted(() => ({
  supaHolder: {
    user: { id: 'user-a' } as unknown,
    updateResult: { data: [{ id: 'gen' }] as unknown[] | null, error: null as unknown },
    lastUpdate: null as null | { payload: Record<string, unknown>; filters: Record<string, unknown> },
  },
}));
vi.mock('@/data/supabase-ssr', () => ({
  // La guardia dell'anteprima (enterPreview) esige l'identita' con questo `getUser` (T-235): lo
  // stesso `supaHolder.user` che il client con sessione della riscelta riporta, cosi' i due seam
  // d'ingresso non divergono.
  getUser: async () => supaHolder.user,
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

// I seam dell'ANTEPRIMA REALE (T-235), montata in AC-233-6 per rendere il documento CONGELATO dal
// PERCORSO di produzione (PreviewPage -> SiteView) e non da una chiamata diretta al renderer:
//  - @/data/sites listSites: la proprieta' del sito, che la guardia dell'anteprima accerta.
//  - @/data/generation-document readGenerationDocument: la SOLA colonna `document` di
//    site_generations. E' il seam su cui poggia AC-233-6 — l'anteprima rende cio' che questa
//    lettura riporta, mai il pool ne la ricetta (P2-D5).
const { listSitesSpy, sitesHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { readDocumentSpy, docHolder } = vi.hoisted(() => {
  const holder = { current: { ok: true, document: null } as unknown };
  return { docHolder: holder, readDocumentSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/generation-document', () => ({ readGenerationDocument: readDocumentSpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { selectVariant } from '@/data/generation-choose';
import { resolveVariantHome } from '@/ui/generation/variant-document';
import PreviewPage from '@/app/[locale]/preview/[siteId]/page';

// getTranslations REALE dal catalogo it, namespace 'site': una chiave assente ricade sul suo path,
// cosi' un blocco senza etichetta non fa cadere il render (come in generation-chooser.test).
function realTranslations({ namespace }: { locale: string; namespace: string }) {
  const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<string, unknown>;
  return (key: string) => {
    const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
    return typeof value === 'string' ? value : `${namespace}.${key}`;
  };
}

// Brief RICCO, dominio REALE: sette blocchi di home esistono, quindi le direzioni compongono home
// DIVERSE. Valori DISCORDANTI: due chiavi orario diverse, tre offerte di cui una il PREFISSO di
// un'altra ('Antipasto' / 'Antipasto della casa').
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

// Un pool 'home' che riempie TUTTI gli slot dei blocchi della home con valori DISCORDANTI, cosi'
// nessun blocco viene scartato e ogni direzione rende i propri. Gli id di slot portano la coppia
// PREFISSO del catalogo ('hero_title' e' prefisso di 'hero_title_kicker', T-201).
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

/**
 * La sequenza degli id-blocco resa dall'ANTEPRIMA REALE per un sito: monta `PreviewPage` (che
 * legge il documento da `readGenerationDocument`, mai il pool/la ricetta — T-235) e ne estrae
 * l'ordine dei blocchi. E' il percorso di produzione, non una chiamata diretta a `SiteView`, cosi'
 * un'anteprima che RICALCOLASSE dalla ricetta invece di rendere dal documento sarebbe osservabile.
 */
async function renderPreviewSeq(siteId: string): Promise<string[]> {
  const container = document.createElement('div');
  const ui = await PreviewPage({ params: Promise.resolve({ locale: 'it', siteId }) });
  render(ui, { container });
  return [...container.querySelectorAll('[data-block-id]')].map(
    (node) => (node as HTMLElement).getAttribute('data-block-id') ?? '',
  );
}

/** Lo stato 'ready' con i campi che getGeneration riporta (GenerationSummary). */
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
  getTranslationsMock.mockImplementation(async (opts: { locale: string; namespace: string }) =>
    realTranslations(opts),
  );
  briefHolder.current = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  poolsHolder.current = { ok: true, shared: SHARED_POOL, byVariant: {} };
  genHolder.current = generazione('ready');
  chooseHolder.current = { ok: true };
  supaHolder.user = { id: 'user-a' };
  supaHolder.updateResult = { data: [{ id: GEN_ID }], error: null };
  supaHolder.lastUpdate = null;
  // Seam dell'anteprima: A possiede il sito reso, e la lettura del documento parte vuota (ogni
  // test dell'anteprima vi mette il proprio documento congelato).
  sitesHolder.current = { ok: true, sites: [{ id: SITE_ID, name: 'Sito di A', slug: 'sito-di-a', status: 'draft' }] };
  docHolder.current = { ok: true, document: null };
  getGenerationSpy.mockClear();
  chooseVariantSpy.mockClear();
  getBriefSpy.mockClear();
  readHomePoolsSpy.mockClear();
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  listSitesSpy.mockClear();
  readDocumentSpy.mockClear();
  boundarySpy.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('T-233 scegli & congela — la prima scelta (ready -> chosen)', () => {
  // covers: AC-233-1
  it("scelta della variante 3 da 'ready': chooseVariant(G,3, documento SOLA home) e redirect all'anteprima", async () => {
    // when: l'utente scegle la variante 3.
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 3 });

    // then: la transizione ready->chosen di T-204 e' chiamata con l'indice 3 (che scrive
    // chosen_variant=3 e status='chosen', pinnati a runtime la') e il documento congelato.
    expect(chooseVariantSpy).toHaveBeenCalledTimes(1); // covers: AC-233-1
    const [gid, idx, doc] = chooseVariantSpy.mock.calls[0] as unknown as [string, number, SiteDocument];
    expect(gid).toBe(GEN_ID); // covers: AC-233-1
    expect(idx).toBe(3); // covers: AC-233-1
    // il documento congelato ha ESATTAMENTE una pagina, di ruolo 'home' (la fase 1, P2-D13).
    expect(doc.pages.length).toBe(1); // covers: AC-233-1
    expect(doc.pages[0].role).toBe('home'); // covers: AC-233-1
    // l'utente e' portato all'anteprima, con locale dall'allowlist e site_id codificato.
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`); // covers: AC-233-1
    // la scelta non tocca il confine.
    expect(boundarySpy).not.toHaveBeenCalled();
  });

  // covers: AC-233-2
  it('il documento congelato registra recipe_id e theme_id VERSIONATI della variante scelta', async () => {
    // when: si scegle la variante 3.
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 3 });

    const doc = (chooseVariantSpy.mock.calls[0] as unknown as [string, number, SiteDocument])[2];
    // then: gli id sono quelli VERSIONATI della direzione 3 (resolve li registra, T-214).
    expect(doc.recipe_id).toBe(RECIPES[3].id); // covers: AC-233-2
    expect(doc.theme_id).toBe(RECIPES[3].theme_id); // covers: AC-233-2
    // …e sono nella forma 'nome-kebab@N' (la versione e' DENTRO l'id, P2-D21).
    expect(doc.recipe_id).toMatch(/@\d+$/); // covers: AC-233-2
    expect(doc.theme_id).toMatch(/@\d+$/); // covers: AC-233-2
  });
});

describe('T-233 riscelta PRIMA della fase 2 (chosen -> chosen)', () => {
  // covers: AC-233-3
  it("da 'chosen' con la sola home, riscegliere un'altra variante: ZERO confine, chosen_variant aggiornato, documento ricostruito col pool DELLA VARIANTE", async () => {
    // given: la generazione e' gia' 'chosen' (fase 1 conclusa, fase 2 non ancora fatta).
    genHolder.current = generazione('chosen');
    // …e la copia-su-scrittura di P2-D3 e' ESERCITATA: la variante 1 ha un pool PROPRIO
    // ('propria-1'), il resto pende dal CONDIVISO ('condiviso'). Riscegliere la 1 deve congelare il
    // suo pool proprio, non quello condiviso — il ramo `byVariant[index]` di poolForVariant, che con
    // `byVariant: {}` non veniva mai preso.
    poolsHolder.current = { ok: true, shared: SHARED_POOL, byVariant: { 1: homePool('propria-1') } };

    // when: l'utente scegle una variante DIVERSA (1).
    await selectVariant({ siteId: SITE_ID, generationId: GEN_ID, locale: 'it', variantIndex: 1 });

    // then: nessuna chiamata al confine — la ricomposizione e' pura (P2-D3).
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-233-3
    // …e NON si passa dalla transizione ready->chosen: la riscelta ha il suo percorso dedicato.
    expect(chooseVariantSpy).not.toHaveBeenCalled(); // covers: AC-233-3

    // then: la scrittura e' un CAS chosen->chosen che aggiorna chosen_variant e SOSTITUISCE il
    // documento, ricostruito dalla NUOVA variante.
    expect(supaHolder.lastUpdate).not.toBeNull();
    expect(supaHolder.lastUpdate!.filters).toEqual({ id: GEN_ID, status: 'chosen' }); // covers: AC-233-3
    expect(supaHolder.lastUpdate!.payload.status).toBe('chosen'); // covers: AC-233-3
    expect(supaHolder.lastUpdate!.payload.chosen_variant).toBe(1); // covers: AC-233-3
    const doc = supaHolder.lastUpdate!.payload.document as SiteDocument;
    expect(doc.recipe_id).toBe(RECIPES[1].id); // covers: AC-233-3
    expect(doc.pages.length).toBe(1); // covers: AC-233-3
    expect(doc.pages[0].role).toBe('home'); // covers: AC-233-3
    // then: il CONTENUTO congelato porta i dati del pool PROPRIO della variante 1 ('propria-1') e
    // MAI quelli del condiviso ('condiviso'). Congelare sempre dal condiviso passerebbe recipe_id,
    // pagine e ruolo ma cadrebbe QUI. La firma vive nel `content` degli slot (resolve vi copia la
    // prosa del pool), non nei `data` del brief: la si legge di la'.
    const contenutoSlot = JSON.stringify(doc.pages[0].blocks.map((b) => b.content));
    expect(contenutoSlot).toContain('propria-1'); // covers: AC-233-3
    expect(contenutoSlot).not.toContain('condiviso'); // covers: AC-233-3
    // e si e' comunque portati all'anteprima.
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`);
  });
});

describe('T-233 indice fuori dominio (AC-233-5)', () => {
  // covers: AC-233-5
  it("il PRIMO indice fuori scala (RECIPES.length) e l'indice -1: entrambi respinti, chosen_variant invariato, nessuna scrittura ne confine", async () => {
    // Il bordo superiore e' DERIVATO da RECIPES.length, non un 5 a mano: `RECIPES.length` e' il
    // primo indice che NON indicizza alcuna ricetta. Se il dominio si scollegasse (un massimo piu'
    // grande del catalogo), questo indice passerebbe e resolveVariantHome leggerebbe RECIPES[length]
    // inesistente — qui invece deve fermarsi PRIMA di ogni round-trip.
    for (const fuoriScala of [RECIPES.length, -1]) {
      const res = await selectVariant({
        siteId: SITE_ID,
        generationId: GEN_ID,
        locale: 'it',
        variantIndex: fuoriScala,
      });
      expect(res).toEqual({ ok: false, reason: 'indice_non_valido' }); // covers: AC-233-5
    }
    // then: il rifiuto precede ogni round-trip — nessuna lettura di stato, nessuna transizione,
    // nessuna scrittura, nessun confine, e chosen_variant resta intatto perche' niente e' scritto.
    expect(getGenerationSpy).not.toHaveBeenCalled(); // covers: AC-233-5
    expect(chooseVariantSpy).not.toHaveBeenCalled(); // covers: AC-233-5
    expect(supaHolder.lastUpdate).toBeNull(); // covers: AC-233-5
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(boundarySpy).not.toHaveBeenCalled();
  });

  // covers: AC-233-5
  it("l'ULTIMA direzione (indice RECIPES.length-1) e' scegliibile: il dominio e' LEGATO al catalogo", async () => {
    // given: lo stato 'ready' (default). L'ultimo indice VALIDO deve valere RECIPES.length-1: e'
    // l'indice con cui resolveVariantHome legge l'ULTIMA ricetta del catalogo.
    const ultima = RECIPES.length - 1;

    const res = await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: ultima,
    });

    // then: NON e' rifiutata come fuori dominio — la scelta procede e congela l'ultima direzione.
    // Un massimo scollegato piu' PICCOLO di RECIPES.length rifiuterebbe questo indice (la direzione
    // in coda diverrebbe non scegliibile): e' l'altra meta' del dominio, quella che il test sul
    // fuori scala non copre.
    expect(res).not.toEqual({ ok: false, reason: 'indice_non_valido' }); // covers: AC-233-5
    expect(chooseVariantSpy).toHaveBeenCalledTimes(1); // covers: AC-233-5
    const [, idx, doc] = chooseVariantSpy.mock.calls[0] as unknown as [string, number, SiteDocument];
    expect(idx).toBe(ultima); // covers: AC-233-5
    expect(doc.recipe_id).toBe(RECIPES[ultima].id); // covers: AC-233-5
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`);
  });
});

describe('T-233 il documento e DATO, non si ricalcola dalla ricetta (AC-233-6)', () => {
  // covers: AC-233-6
  it("l'ANTEPRIMA rende il documento congelato ANCHE dopo un ritocco alla ricetta usata: albero IDENTICO", async () => {
    // given: il documento CONGELATO della variante 0 (vetrina-dell-offerta), composto UNA volta.
    const resolved = resolveVariantHome(SHARED_POOL, RECIPES[0], RICH_BRIEF);
    expect(resolved).not.toBeNull();
    const doc = resolved!.document;
    const congelato = doc.pages[0].blocks.map((b) => b.id);
    expect(congelato.length).toBeGreaterThan(1); // la sequenza e' RICCA: l'inversione la cambia.

    // L'anteprima legge QUESTO documento congelato (readGenerationDocument), mai il pool ne la
    // ricetta: e' il seam su cui poggia AC-233-6.
    docHolder.current = { ok: true, document: doc };

    // when: l'anteprima REALE (PreviewPage -> SiteView) rende il documento.
    const treeA = await renderPreviewSeq(SITE_ID);
    expect(treeA).toEqual(congelato); // covers: AC-233-6
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_ID); // il documento e' letto, non il pool.

    // given: un RITOCCO alla definizione della ricetta USATA, MUTATA IN PLACE nel catalogo GLOBALE
    // (non una copia): la stessa direzione 0 con la sequenza della home in ordine INVERSO. Si
    // ripristina in `finally`, cosi' il catalogo torna intatto anche se un'asserzione cade.
    const recipe0 = RECIPES[0] as unknown as { home_blocks: readonly string[] };
    const originalHomeBlocks = recipe0.home_blocks;
    try {
      recipe0.home_blocks = [...originalHomeBlocks].reverse();

      // Che il ritocco sia REALE (non un no-op) lo prova il fatto che RICOMPORRE ora dalla ricetta
      // mutata da' un albero DIVERSO: e' precisamente cio' che un'anteprima che ri-risolvesse da
      // RECIPES (invece di rendere il documento) mostrerebbe.
      const seRicalcolasse = resolveVariantHome(SHARED_POOL, RECIPES[0], RICH_BRIEF)!.document.pages[0].blocks.map(
        (b) => b.id,
      );
      expect(seRicalcolasse).not.toEqual(treeA);

      // then: l'anteprima RILEGGE e RENDE il documento CONGELATO -> STESSO albero di prima, benche'
      // la ricetta sia cambiata sotto. Si rende dal DATO e non ricalcola dalla ricetta: e' la
      // ragione del congelamento (AC-233-6).
      const treeB = await renderPreviewSeq(SITE_ID);
      expect(treeB).toEqual(treeA); // covers: AC-233-6
    } finally {
      recipe0.home_blocks = originalHomeBlocks;
    }
    // e il ripristino ha davvero rimesso a posto il catalogo globale.
    expect(RECIPES[0].home_blocks).toBe(originalHomeBlocks);
  });
});
