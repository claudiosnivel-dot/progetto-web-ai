import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-230 (macrotask generation-ui, P2) — ORACOLO della CATENA DI GUARDIE di POST
// /api/generate (la stessa estratta in _shared/request-guard e condivisa con la rotta di
// onboarding). Le asserzioni derivano da AC-230-6 (04-generation-ui.md), taggate
// `// covers: AC-230-6` sulla riga dell'EXPECT.
//
// I TRE CONTROLLI, tutti PRIMA di qualunque lavoro:
//  - Sec-Fetch-Site PRETESO uguale a 'same-origin' e FAIL-CLOSED sull'assenza: assente
//    → 403, non "controllalo se c'e'".
//  - Origin confrontato con l'origin della richiesta: diverso o assente → 403.
//  - tetto sui BYTE del body: Content-Length oltre il tetto → 413 PRIMA di leggere il
//    corpo (request.bodyUsed resta false).
//
// Il seam del confine e delle scritture e' mockato per PROVARE che una richiesta respinta
// dalla guardia NON crea alcuna riga e NON chiama il confine: la guardia precede tutto.

const { authHolder } = vi.hoisted(() => ({ authHolder: { user: null as { id: string } | null } }));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { briefsHolder, getBriefSpy } = vi.hoisted(() => {
  const holder = { get: null as unknown };
  return { briefsHolder: holder, getBriefSpy: vi.fn(async () => holder.get) };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { createGenerationSpy, writePoolSpy, markReadySpy, markFailedSpy } = vi.hoisted(() => ({
  createGenerationSpy: vi.fn(async () => ({ ok: true, id: 'gen-x' })),
  writePoolSpy: vi.fn(async () => ({ ok: true, id: 'pool-x' })),
  markReadySpy: vi.fn(async () => ({ ok: true })),
  markFailedSpy: vi.fn(async () => ({ ok: true })),
}));
// (deploy pass) T-4: il seam del conteggio del cap giornaliero. Un holder controllabile per
// provare il wiring nella rotta (429 PRIMA della spesa; fail-open su errore).
const { genCapHolder, countGenerationsSinceSpy } = vi.hoisted(() => {
  const holder = { count: { ok: true, count: 0 } as unknown };
  return { genCapHolder: holder, countGenerationsSinceSpy: vi.fn(async () => holder.count) };
});
vi.mock('@/data/generations', () => ({
  createGeneration: createGenerationSpy,
  countGenerationsSince: countGenerationsSinceSpy,
  writePool: writePoolSpy,
  markReady: markReadySpy,
  markFailed: markFailedSpy,
}));

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn(async () => ({ ok: true, pool: {} })) }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock.
import { POST } from '@/app/api/generate/route';

const ORIGIN = 'http://localhost';
const SITE_A = 'site-of-a';
const SITE_A_ROW = { id: SITE_A, name: 'Officina di A', slug: 'officina-di-a', status: 'draft' };
const SITE_B_ROW = { id: 'site-of-b', name: 'Panetteria di B', slug: 'panetteria-di-b', status: 'draft' };
const OWNED_SITES = [SITE_B_ROW, SITE_A_ROW];

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

// Tetto sui byte del body di questa rotta. VALORE ATTESO ESPLICITO, non importato dalla
// route (un route handler non puo' esportare costanti proprie): il corpo legittimo e' un
// solo {siteId}, quindi il tetto e' piccolo. Scritto come NUMERO: se la route lo cambia,
// i due test ai lati del confine cadono.
const MAX_BODY_BYTES = 1024;

type Init = {
  origin?: string | null;
  fetchSite?: string | null;
  contentLength?: string;
};

function buildRequest(body: unknown, init: Init = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin !== null) headers.set('origin', origin);
  const fetchSite = init.fetchSite === undefined ? 'same-origin' : init.fetchSite;
  if (fetchSite !== null) headers.set('sec-fetch-site', fetchSite);
  if (init.contentLength !== undefined) headers.set('content-length', init.contentLength);
  return new NextRequest(new URL('/api/generate', ORIGIN), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const run = (init: Init = {}) => POST(buildRequest({ siteId: SITE_A }, init));

// Drena lo stream fino a done, cosi' il caso legittimo (200) non lascia il body aperto.
async function drain(res: Response): Promise<void> {
  const body = res.body as ReadableStream<Uint8Array> | null;
  if (!body) return;
  const reader = body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  briefsHolder.get = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  genCapHolder.count = { ok: true, count: 0 }; // sotto qualunque tetto: flusso invariato
  createGenerationSpy.mockClear();
  countGenerationsSinceSpy.mockClear();
  writePoolSpy.mockClear();
  markReadySpy.mockClear();
  markFailedSpy.mockClear();
  boundarySpy.mockClear();
});

describe('T-230 POST /api/generate — catena di guardie same-origin e tetto sui byte', () => {
  // covers: AC-230-6
  it('origine non same-origin (o assente): 403, nessuna riga, nessuna chiamata al confine', async () => {
    const cases: Init[] = [
      { origin: 'https://evil.example.com' },
      { origin: null },
      { origin: ORIGIN, fetchSite: 'cross-site' },
      { origin: ORIGIN, fetchSite: 'same-site' },
      { origin: ORIGIN, fetchSite: 'none' },
      // Sec-Fetch-Site ASSENTE: fail-CLOSED, non fail-open. Ometterlo non apre l'endpoint.
      { origin: ORIGIN, fetchSite: null },
      // Assenti ENTRAMBI: nessuna combinazione di omissioni apre l'endpoint.
      { origin: null, fetchSite: null },
    ];
    for (const init of cases) {
      createGenerationSpy.mockClear();
      boundarySpy.mockClear();
      const res = await run(init);
      expect(res.status).toBe(403); // covers: AC-230-6
      expect(createGenerationSpy).not.toHaveBeenCalled(); // covers: AC-230-6
      expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-230-6
    }
    // Contro-prova: la richiesta same-origin dichiarata dal browser passa la guardia.
    const ok = await run({ fetchSite: 'same-origin' });
    expect(ok.status).toBe(200); // covers: AC-230-6
    await drain(ok);
  });

  // covers: AC-230-6
  it('Content-Length oltre il tetto: 413 e il corpo non viene nemmeno letto', async () => {
    const request = buildRequest({ siteId: SITE_A }, { contentLength: String(MAX_BODY_BYTES + 1) });
    const res = await POST(request);

    // 413, non un 400 generico: il motivo del rifiuto e' la DIMENSIONE.
    expect(res.status).toBe(413); // covers: AC-230-6
    // Il corpo non e' stato consumato → il rifiuto e' arrivato PRIMA della lettura.
    expect(request.bodyUsed).toBe(false); // covers: AC-230-6
    expect(createGenerationSpy).not.toHaveBeenCalled(); // covers: AC-230-6
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-230-6

    // 'Infinity' non e' finito ma DEVE essere rifiutato: un Number.isFinite a guardia del
    // confronto lo farebbe passare.
    const infinite = await run({ contentLength: 'Infinity' });
    expect(infinite.status).toBe(413); // covers: AC-230-6

    // CONTRO-PROVA sul limite ESATTO: MAX_BODY_BYTES passa (il tetto non e' off-by-one).
    const atLimit = await run({ contentLength: String(MAX_BODY_BYTES) });
    expect(atLimit.status).toBe(200); // covers: AC-230-6
    await drain(atLimit);

    // LIMITE DICHIARATO: senza Content-Length (POST chunked) la guardia non si applica e
    // la richiesta prosegue. Nessun browser produce un body di stringa chunked.
    const chunked = buildRequest({ siteId: SITE_A });
    expect(chunked.headers.get('content-length')).toBeNull(); // covers: AC-230-6
    const noLength = await POST(chunked);
    expect(noLength.status).toBe(200); // covers: AC-230-6
    await drain(noLength);
  });
});

// (deploy pass) T-4 — WIRING del cap giornaliero nella rotta: prova che il 429 arriva PRIMA di
// qualunque spesa (nessuna riga creata, nessuna chiamata al confine/modello) e il fail-open.
describe('T-4 (deploy pass) POST /api/generate — cap giornaliero delle generazioni', () => {
  it('conteggio OLTRE il tetto: 429 PRIMA di createGeneration e del confine (nessuna spesa)', async () => {
    genCapHolder.count = { ok: true, count: 100000 }; // >= qualunque tetto configurato
    const res = await run({ fetchSite: 'same-origin' });
    expect(res.status).toBe(429);
    expect(createGenerationSpy).not.toHaveBeenCalled(); // nessuna riga
    expect(boundarySpy).not.toHaveBeenCalled(); // nessuna chiamata al modello
  });

  it('conteggio SOTTO il tetto: prosegue (200) e conta prima di creare', async () => {
    genCapHolder.count = { ok: true, count: 0 };
    const res = await run({ fetchSite: 'same-origin' });
    expect(res.status).toBe(200);
    expect(countGenerationsSinceSpy).toHaveBeenCalled(); // il conteggio E' avvenuto
    await drain(res);
  });

  it('errore di conteggio: FAIL-OPEN (prosegue 200) — il backstop e lo spending cap Anthropic', async () => {
    genCapHolder.count = { ok: false, status: 500 };
    const res = await run({ fetchSite: 'same-origin' });
    expect(res.status).toBe(200);
    await drain(res);
  });
});
