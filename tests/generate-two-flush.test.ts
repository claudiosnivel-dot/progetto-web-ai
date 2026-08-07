import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { RECIPES } from '@/domain/generation/recipes';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-230 (macrotask generation-ui, P2) — ORACOLO dello STREAM NDJSON a DUE FLUSH di
// POST /api/generate. Le asserzioni derivano da AC-230-5 e AC-230-8
// (04-generation-ui.md), taggate `// covers: AC-230-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - @/data/anthropic runGenerationTurn: il CONFINE (T-224). Qui e' un doppio GATED da
//    una promise che il TEST risolve: e' l'unico modo di PROVARE (non dichiarare) che il
//    primo chunk esce MENTRE la chiamata al confine e' ancora in volo (AC-230-5), invece
//    di osservare un ordine fra microtask che una risposta in un colpo solo imiterebbe.
//  - @/data/generations createGeneration/writePool/markReady/markFailed: i seam di
//    scrittura. La riga 'generating' e' creata PRIMA di aprire lo stream (durabilita'
//    dalla riga), e writePool/markReady girano solo DOPO il ritorno del confine.
//  - @/data/sites listSites, @/data/briefs getBrief, @/data/supabase-ssr getUser: i seam
//    a monte. Il brief e' RICCO (generabile) e costruito col dominio REALE, cosi'
//    l'assemblaggio del payload di fase 1 (proiezione/tool/pagine) gira per davvero.
//
// PROPRIETA' PINNATE oltre agli AC:
//  - Le CINQUE CORNICI del primo chunk sono PURE: sono le 5 coppie {recipe_id, theme_id}
//    di RECIPES, derivate qui dallo stesso array, e NON contengono il testo del pool
//    (marcatore riconoscibile assente dal chunk 1 e presente nel chunk 2).
//  - Il pool arriva SOLO nel secondo chunk, e solo dopo che il gate del confine si apre.

const { authHolder } = vi.hoisted(() => ({ authHolder: { user: null as { id: string } | null } }));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { briefsHolder, getBriefSpy } = vi.hoisted(() => {
  const holder = { getBySite: {} as Record<string, unknown>, get: null as unknown };
  return {
    briefsHolder: holder,
    getBriefSpy: vi.fn(async (siteId: string) => holder.getBySite[siteId] ?? holder.get),
  };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { genHolder, createGenerationSpy, writePoolSpy, markReadySpy, markFailedSpy } = vi.hoisted(
  () => {
    const holder = {
      create: { ok: true, id: 'gen-x' } as unknown,
      writePool: { ok: true, id: 'pool-x' } as unknown,
      markReady: { ok: true } as unknown,
      markFailed: { ok: true } as unknown,
      writePoolCalls: [] as unknown[][],
    };
    return {
      genHolder: holder,
      createGenerationSpy: vi.fn(async () => holder.create),
      writePoolSpy: vi.fn(async (...args: unknown[]) => {
        holder.writePoolCalls.push(args);
        return holder.writePool;
      }),
      markReadySpy: vi.fn(async () => holder.markReady),
      markFailedSpy: vi.fn(async () => holder.markFailed),
    };
  },
);
vi.mock('@/data/generations', () => ({
  createGeneration: createGenerationSpy,
  // (deploy pass) T-4: la rotta ora conta le generazioni recenti (cap giornaliero) prima di
  // creare la riga. Sotto il tetto (count 0) => flusso invariato.
  countGenerationsSince: async () => ({ ok: true, count: 0 }),
  writePool: writePoolSpy,
  markReady: markReadySpy,
  markFailed: markFailedSpy,
}));

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn() }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { POST } from '@/app/api/generate/route';

const ORIGIN = 'http://localhost';
const SITE_A = 'site-of-a';
const SITE_B = 'site-of-b';
const SITE_A_ROW = { id: SITE_A, name: 'Officina di A', slug: 'officina-di-a', status: 'draft' };
const SITE_B_ROW = { id: SITE_B, name: 'Panetteria di B', slug: 'panetteria-di-b', status: 'draft' };
// DUE siti posseduti, con SITE_A NON in posizione 0: leggere sites[0].id al posto del
// siteId richiesto diventa osservabile.
const OWNED_SITES = [SITE_B_ROW, SITE_A_ROW];

// Brief RICCO, costruito col dominio REALE (T-121/T-122): sei blocchi di home, quindi
// generabile e con slot per il tool di fase 1. Valori DISCORDANTI (due offerte con
// sezioni diverse, due chiavi orario diverse) — la trappola-fixture di P1.
const RICH_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Bar Sole',
  vertical: 'ristorazione',
  description: 'Caffe e cornetti nel centro storico',
  whatsapp: '+39 333 1112222',
  phone: '+39 06 1234567',
  address: 'Via Roma 1, Roma',
  hours: { 'lun-ven': '08:00-20:00', sab: '09:00-13:00' },
  offerings: [
    { name: 'Espresso', section: 'Caffetteria' },
    { name: 'Cornetto', section: 'Colazione' },
    { name: 'Cappuccino', section: 'Caffetteria' },
  ],
}).brief;

// Il pool ritornato dal confine: forma valida di massima, con un MARCATORE riconoscibile
// nel testo, cosi' si prova che quel testo NON compare nel primo chunk (le cornici sono
// pure) e compare nel secondo (il pool). writePool e' mockato, quindi non lo valida.
const POOL_MARKER = 'ZQMARK_pool_testo_del_modello';
const FAKE_POOL = { pages: { home: { hero_title: POOL_MARKER } } };

// Le cornici ATTESE, derivate dallo STESSO array RECIPES che la rotta legge: cinque
// coppie {recipe_id, theme_id}, ognuna con un tema diverso (P2-D1).
const EXPECTED_FRAMES = RECIPES.map((r) => ({ recipe_id: r.id, theme_id: r.theme_id }));

type Init = { origin?: string | null; fetchSite?: string | null };

function buildRequest(body: unknown, init: Init = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set('origin', origin);
  const fetchSite = init.fetchSite === undefined ? 'same-origin' : init.fetchSite;
  if (fetchSite !== null) headers.set('sec-fetch-site', fetchSite);
  return new NextRequest(new URL('/api/generate', ORIGIN), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const runGenerate = (siteId: string) => POST(buildRequest({ siteId }));

function parseLine(value: Uint8Array | undefined): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(value).trim()) as Record<string, unknown>;
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  briefsHolder.getBySite = { [SITE_A]: { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true } };
  briefsHolder.get = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  genHolder.create = { ok: true, id: 'gen-x' };
  genHolder.writePool = { ok: true, id: 'pool-x' };
  genHolder.markReady = { ok: true };
  genHolder.markFailed = { ok: true };
  genHolder.writePoolCalls.length = 0;
  createGenerationSpy.mockClear();
  writePoolSpy.mockClear();
  markReadySpy.mockClear();
  markFailedSpy.mockClear();
  listSitesSpy.mockClear();
  getBriefSpy.mockClear();
  boundarySpy.mockReset();
});

describe('T-230 POST /api/generate — stream a due flush', () => {
  // covers: AC-230-5, AC-230-8
  it('primo chunk (5 cornici) MENTRE il confine e in volo, secondo chunk (pool) solo DOPO', async () => {
    // given: un confine il cui ritorno e' GATED: non risolve finche' il test non lo apre.
    let openGate!: () => void;
    const gated = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    boundarySpy.mockImplementation(async () => {
      await gated;
      return { ok: true, pool: FAKE_POOL };
    });

    // when: POST e lettura dello stream
    const res = await runGenerate(SITE_A);
    expect(res.status).toBe(200); // covers: AC-230-5
    expect(res.headers.get('content-type')).toContain('application/x-ndjson'); // covers: AC-230-5

    const reader = (res.body as ReadableStream<Uint8Array>).getReader();

    // FLUSH 1 — le cinque cornici, prima che il confine risolva.
    const first = await reader.read();
    expect(first.done).toBe(false); // covers: AC-230-5
    const chunk1 = parseLine(first.value);
    expect(chunk1.type).toBe('frames'); // covers: AC-230-8

    // La riga 'generating' e' stata creata PRIMA della chiamata al confine (durabilita').
    expect(createGenerationSpy).toHaveBeenCalledTimes(1); // covers: AC-230-5
    // Il confine E' STATO chiamato ma NON e' ancora risolto: e' in volo.
    expect(boundarySpy).toHaveBeenCalledTimes(1); // covers: AC-230-5
    // Nessuna scrittura del pool ne' transizione a 'ready' PRIMA del ritorno del confine.
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-230-5
    expect(markReadySpy).not.toHaveBeenCalled(); // covers: AC-230-5

    // AC-230-8: le cinque cornici sono i 5 recipe_id + theme_id, PURI, e NESSUN testo del
    // modello. Il marcatore del pool NON compare in questo chunk.
    expect(chunk1.frames).toEqual(EXPECTED_FRAMES); // covers: AC-230-8
    expect((chunk1.frames as unknown[]).length).toBe(5); // covers: AC-230-8
    expect(JSON.stringify(chunk1)).not.toContain(POOL_MARKER); // covers: AC-230-8

    // PROVA D'ORDINE: il secondo chunk NON e' disponibile finche' il gate e' chiuso. La
    // read resta pendente oltre un confine di MACROTASK (setTimeout 0): con una risposta
    // in UN SOLO chunk, o coi due chunk emessi insieme, qui vincerebbe la read.
    const secondRead = reader.read();
    const PENDING = Symbol('pending');
    const raced = await Promise.race([
      secondRead,
      new Promise<symbol>((resolve) => setTimeout(() => resolve(PENDING), 0)),
    ]);
    expect(raced).toBe(PENDING); // covers: AC-230-5

    // Aperto il gate, arriva il FLUSH 2 — e solo allora.
    openGate();
    const second = await secondRead;
    expect(second.done).toBe(false); // covers: AC-230-5
    const chunk2 = parseLine(second.value as Uint8Array);
    expect(chunk2.type).toBe('pool'); // covers: AC-230-5
    // Il pool e' nel secondo chunk (marcatore presente), e la scrittura condivisa e'
    // avvenuta con scope 'home' e variantIndex null (pool CONDIVISO, NON cinque pool).
    expect(JSON.stringify(chunk2)).toContain(POOL_MARKER); // covers: AC-230-8
    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-230-5
    expect(genHolder.writePoolCalls[0][1]).toBe('home'); // covers: AC-230-5 — scope
    expect(genHolder.writePoolCalls[0][2]).toBeNull(); // covers: AC-230-5 — pool condiviso
    // L'allowlist e' quella della fase 1 (sola pagina iniziale): la STESSA con cui il pool
    // e' validato, non ricalcolata nella rotta.
    expect(genHolder.writePoolCalls[0][4]).toEqual(['home']); // covers: AC-230-5
    expect(markReadySpy).toHaveBeenCalledTimes(1); // covers: AC-230-5

    // Lo stream si chiude dopo i due chunk: nessun terzo evento.
    expect((await reader.read()).done).toBe(true); // covers: AC-230-5
  });

  // covers: AC-230-8
  // Contro-prova diretta della PUREZZA delle cornici: le cinque coppie del primo chunk
  // corrispondono UNA PER UNA a RECIPES e i cinque temi sono distinti (P2-D1), quindi il
  // primo flush non attende il modello.
  it('le cinque cornici sono i recipe_id+theme_id di RECIPES, con cinque temi distinti', async () => {
    boundarySpy.mockResolvedValue({ ok: true, pool: FAKE_POOL });
    const res = await runGenerate(SITE_A);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const chunk1 = parseLine((await reader.read()).value);

    const frames = chunk1.frames as { recipe_id: string; theme_id: string }[];
    expect(frames.map((f) => f.recipe_id)).toEqual(RECIPES.map((r) => r.id)); // covers: AC-230-8
    expect(frames.map((f) => f.theme_id)).toEqual(RECIPES.map((r) => r.theme_id)); // covers: AC-230-8
    // Cinque temi DIVERSI: nessuna cornice ripete il tema di un'altra.
    expect(new Set(frames.map((f) => f.theme_id)).size).toBe(5); // covers: AC-230-8
    // Nessun testo del modello: le cornici sono le stesse per qualunque brief.
    expect(JSON.stringify(chunk1)).not.toContain(POOL_MARKER); // covers: AC-230-8
  });
});
