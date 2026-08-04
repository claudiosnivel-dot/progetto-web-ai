import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyBriefUpdate, emptyBrief, type Brief } from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';
import type { PageSpec } from '@/domain/generation/pages';

// T-234 (macrotask generation-ui, P2) — ORACOLO DELL'ORCHESTRAZIONE della fase 2 a chunk (P2-D13,
// EMENDAMENTO "A" = P2-D32). Le asserzioni derivano da AC-234-1, AC-234-3, AC-234-4, AC-234-5 e
// AC-234-6 (04-generation-ui.md), taggate `// covers: AC-234-<n>` sulla riga dell'EXPECT.
//
// I DOPPI E COSA MISURANO: il confine (@/data/anthropic runGenerationTurn) CONTA le chiamate al
// modello e puo' far FALLIRE un chunk (AC-234-3); `getGeneration` porta stato/variante/max_pages;
// `writePool`/`appendPages`/`failGenerationPhase2` sono i seam di scrittura, di cui si conta il
// numero e si ispezionano gli argomenti. L'assemblaggio del turno (`runGenerationPhase2Chunk`,
// dominio) e la derivazione delle pagine (`resolve`) girano PER DAVVERO sul brief reale, quindi il
// conteggio non e' hollow. `pagesFor` e' mockabile PER TEST: reale dove conta il tetto registrato
// (AC-234-6), sostituito dove serve un set di sette pagine che nessun brief v1 produce (AC-234-1).
//
// LE CAS CONTRO IL DB (appendPages({final:false}) chosen->chosen, failGenerationPhase2
// chosen->failed) e la riconciliazione estesa (AC-234-7) NON stanno qui: vivono in
// generations-write-actions.test.ts e generations-read-actions.test.ts (describe.skipIf(!SB)),
// dove le funzioni reali girano contro il Supabase locale mockando SOLO supabase-ssr. Non possono
// coabitare con questo file perche' qui @/data/generations e' MOCKATO a livello di modulo
// (vi.mock e' hoisted sull'intero file), e mockarlo e non mockarlo insieme e' irrappresentabile.

const { getBriefSpy, briefHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { briefHolder: holder, getBriefSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const {
  getGenerationSpy,
  genHolder,
  writePoolSpy,
  writeHolder,
  appendPagesSpy,
  appendHolder,
  failPhase2Spy,
  failHolder,
} = vi.hoisted(() => {
  const genHolder = { current: null as unknown };
  const writeHolder = { returns: [] as unknown[], calls: [] as unknown[][] };
  const appendHolder = { returns: [] as unknown[], calls: [] as unknown[][] };
  const failHolder = { calls: [] as unknown[][], value: { ok: true } as unknown };
  return {
    genHolder,
    writeHolder,
    appendHolder,
    failHolder,
    getGenerationSpy: vi.fn(async () => genHolder.current),
    writePoolSpy: vi.fn(async (...args: unknown[]) => {
      writeHolder.calls.push(args);
      return writeHolder.returns.length > 1 ? writeHolder.returns.shift() : writeHolder.returns[0];
    }),
    appendPagesSpy: vi.fn(async (...args: unknown[]) => {
      appendHolder.calls.push(args);
      return appendHolder.returns.length > 1 ? appendHolder.returns.shift() : appendHolder.returns[0];
    }),
    failPhase2Spy: vi.fn(async (...args: unknown[]) => {
      failHolder.calls.push(args);
      return failHolder.value;
    }),
  };
});
vi.mock('@/data/generations', () => ({
  getGeneration: getGenerationSpy,
  writePool: writePoolSpy,
  appendPages: appendPagesSpy,
  failGenerationPhase2: failPhase2Spy,
}));

const { boundarySpy, boundaryHolder } = vi.hoisted(() => {
  const holder = { returns: [] as unknown[] };
  return {
    boundaryHolder: holder,
    boundarySpy: vi.fn<(turn: unknown) => Promise<unknown>>(async () =>
      holder.returns.length > 1 ? holder.returns.shift() : holder.returns[0],
    ),
  };
});
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

const { pagesHolder } = vi.hoisted(() => ({
  pagesHolder: {
    override: null as null | ((brief: Brief, opts: { maxPages: number }) => readonly PageSpec[]),
  },
}));
vi.mock('@/domain/generation/pages', async (importActual) => {
  const actual = await importActual<typeof import('@/domain/generation/pages')>();
  return {
    ...actual,
    pagesFor: (brief: Brief, opts: { maxPages: number }) =>
      pagesHolder.override ? pagesHolder.override(brief, opts) : actual.pagesFor(brief, opts),
  };
});

// Import DOPO i mock (vi.mock e' hoisted).
import { runPhase2 } from '@/data/generation-phase2';

const SITE_ID = 'site-di-a';
const GEN_ID = '22222222-2222-4222-8222-222222222222';
const VARIANTE = 1;

// Brief RICCO, dominio REALE: giustifica i blocchi delle pagine interne (offerte/contatti/orari/
// faq) e, con almeno quattro offerte e almeno due recapiti, fa esistere anche le PAGINE offerte e
// contatti (T-213). Valori DISCORDANTI: due chiavi orario, quattro offerte con sezioni ripetute.
const RICH_BRIEF: Brief = (() => {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), {
    business_name: 'Trattoria Aurora',
    vertical: 'ristorazione',
    description: 'Cucina di mercato nel centro storico, aperta dal 1980.',
    highlights: ['Forno a legna', 'Terrazza sul fiume'],
    address: 'Via Verdi 12, Roma',
    phone: '+39 06 5551234',
    whatsapp: '+39 333 4445566',
    hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
    offerings: [
      { name: 'Antipasto', section: 'Cucina' },
      { name: 'Antipasto della casa', section: 'Cucina' },
      { name: 'Primo', section: 'Cucina' },
      { name: 'Dolce', section: 'Dessert' },
    ],
  });
  if (rejected.length > 0) throw new Error('RICH_BRIEF non valido');
  return brief;
})();

function gen(over: { status: string; chosen_variant: number | null; max_pages: number }) {
  return {
    id: GEN_ID,
    site_id: SITE_ID,
    status: over.status,
    chosen_variant: over.chosen_variant,
    max_pages: over.max_pages,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  };
}

// ── set di pagine interne FABBRICATO (AC-234-1/3/4): sette pagine, piu' di pages_per_chunk ──────
// Nessun brief v1 produce sette pagine interne (i ruoli interni con dati sono quattro), quindi il
// set si fabbrica. I ruoli sono INTERNI e reali (hanno blocchi per il brief ricco, cosi' il tool
// non e' vuoto), gli slug sono DISCORDANTI e nell'ordine del set derivato.
function homeSpec(): PageSpec {
  return { role: 'home', slug: 'home', label_key: 'site.nav.home', shape: 'multi-page', absorbed_roles: [] };
}
function innerSpec(role: PageRole, slug: string): PageSpec {
  return { role, slug, label_key: 'site.nav.offerings', shape: 'multi-page', absorbed_roles: [] };
}
function setDiSette(): readonly PageSpec[] {
  return [
    homeSpec(),
    innerSpec('offerings', 'in-1'),
    innerSpec('contact', 'in-2'),
    innerSpec('hours', 'in-3'),
    innerSpec('faq', 'in-4'),
    innerSpec('offerings', 'in-5'),
    innerSpec('contact', 'in-6'),
    innerSpec('hours', 'in-7'),
  ];
}

/** Gli slug delle pagine passate ad appendPages, in ordine di chiamata. */
function slugAppesi(): string[] {
  return appendHolder.calls.flatMap((c) => (c[1] as { slug: string }[]).map((p) => p.slug));
}

/** Il flag `final` della i-esima chiamata ad appendPages. */
function finalDi(i: number): boolean | undefined {
  return (appendHolder.calls[i]?.[2] as { final?: boolean } | undefined)?.final;
}

beforeEach(() => {
  briefHolder.current = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
  genHolder.current = { ok: true, generation: gen({ status: 'chosen', chosen_variant: VARIANTE, max_pages: 10 }) };
  writeHolder.returns = [{ ok: true, id: 'pool-inner' }];
  writeHolder.calls.length = 0;
  appendHolder.returns = [{ ok: true }];
  appendHolder.calls.length = 0;
  failHolder.calls.length = 0;
  failHolder.value = { ok: true };
  boundaryHolder.returns = [{ ok: true, pool: { pages: {} } }];
  pagesHolder.override = null;
  boundarySpy.mockClear();
  writePoolSpy.mockClear();
  appendPagesSpy.mockClear();
  failPhase2Spy.mockClear();
  getGenerationSpy.mockClear();
  getBriefSpy.mockClear();
});

describe('T-234 fase 2 a chunk (P2-D32)', () => {
  // covers: AC-234-1
  it('sette pagine interne con pages_per_chunk=4: il confine e chiamato ESATTAMENTE due volte, il pool inner e sotto la variante scelta e ACCUMULA i pool dei due chunk', async () => {
    pagesHolder.override = () => setDiSette();
    // Un chunk a testa, con pool DISCORDANTI: "in-1" arriva col PRIMO chunk, "in-5" col SECONDO.
    // Il pool 'inner' scritto una volta sola deve portarli ENTRAMBI — se scrivesse solo l'ultimo
    // turno (`turn.pool`) invece dell'accumulato, "in-1" mancherebbe. E' la sorgente che la
    // rigenerazione copy-on-write (P2-D3) rileggera'.
    boundaryHolder.returns = [
      { ok: true, pool: { pages: { 'in-1': { offerings_title: 'A' } } } },
      { ok: true, pool: { pages: { 'in-5': { offerings_title: 'B' } } } },
    ];

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: true }); // covers: AC-234-1

    // 7 / 4 -> 2 chunk, e ogni chiamata e' un turno di FASE 2 (non hollow).
    expect(boundarySpy).toHaveBeenCalledTimes(2); // covers: AC-234-1
    expect((boundarySpy.mock.calls[0][0] as { phase: string }).phase).toBe('phase2_chunk'); // covers: AC-234-1
    expect((boundarySpy.mock.calls[1][0] as { phase: string }).phase).toBe('phase2_chunk'); // covers: AC-234-1

    // UN solo pool 'inner', sotto la variante scelta: l'UNIQUE (generation, 'inner', variante) ne
    // ammette uno per variante, quindi i chunk ne accumulano uno solo (non uno a chunk).
    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-234-1
    expect(writeHolder.calls[0][1]).toBe('inner'); // covers: AC-234-1
    expect(writeHolder.calls[0][2]).toBe(VARIANTE); // covers: AC-234-1
    // Il pool scritto ACCUMULA i due chunk: contiene ESATTAMENTE "in-1" (primo) e "in-5" (secondo).
    const poolScritto = (writeHolder.calls[0][3] as { pages: Record<string, unknown> }).pages;
    expect(Object.keys(poolScritto).sort()).toEqual(['in-1', 'in-5']); // covers: AC-234-1
  });

  // covers: AC-234-3
  it('il secondo chunk fallisce (troncamento): fase 2 chiusa a failed col motivo nominato, mai complete, e il primo chunk resta persistito', async () => {
    pagesHolder.override = () => setDiSette();
    // Primo chunk OK, secondo TRONCATO.
    boundaryHolder.returns = [
      { ok: true, pool: { pages: {} } },
      { ok: false, reason: 'risposta_troncata' },
    ];

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: false, reason: 'confine_fallito' }); // covers: AC-234-3

    // Il PRIMO chunk e' stato persistito con {final:false}: la riga resta 'chosen', non 'complete'.
    expect(appendHolder.calls).toHaveLength(1); // covers: AC-234-3
    expect(finalDi(0)).toBe(false); // covers: AC-234-3
    // La fase 2 e' chiusa a 'failed' col motivo NOMINATO, e il document non e' toccato dal fallimento.
    expect(failHolder.calls).toHaveLength(1); // covers: AC-234-3
    expect(failHolder.calls[0][1]).toBe('fase2_troncata'); // covers: AC-234-3
    // NON dichiara 'complete': nessun append finale, e nessun pool 'inner' scritto (il pool si
    // scrive solo all'ultimo chunk, che non e' mai stato raggiunto).
    expect(appendHolder.calls.some((c) => (c[2] as { final?: boolean }).final === true)).toBe(false); // covers: AC-234-3
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-234-3
  });

  // covers: AC-234-3 — il DUALE del troncamento: l'ULTIMO chunk PRODUCE il pool, ma writePool lo
  // rifiuta (UNIQUE sul pool 'inner' gia' scritto / stato terminale, 409). Il pool 'inner' si
  // scrive PRIMA dell'append che porta a 'complete', quindi un writePool fallito ferma tutto e
  // NESSUN appendPages({final:true}) parte: mai 'complete' senza un pool inner scritto. Se l'ordine
  // writePool/append(final) fosse invertito, l'append finale sarebbe gia' passato e questa cadrebbe.
  it("writePool fallisce sull'ultimo chunk (409): esito 'conflitto' e MAI un append finale (nessun complete senza pool)", async () => {
    pagesHolder.override = () => setDiSette();
    writeHolder.returns = [{ ok: false, status: 409 }];

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: false, reason: 'conflitto' }); // covers: AC-234-3
    // writePool E' stato tentato (ultimo chunk), ma NESSUN append finale e' partito: la riga non
    // arriva mai a 'complete' senza un pool 'inner' scritto.
    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-234-3
    expect(appendHolder.calls.every((c) => (c[2] as { final?: boolean }).final !== true)).toBe(true); // covers: AC-234-3
  });

  // covers: AC-234-4
  it('fase 2 conclusa: gli slug del documento coincidono col set derivato, nello stesso ordine, e solo l ultimo append chiude', async () => {
    pagesHolder.override = () => setDiSette();

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: true }); // covers: AC-234-4

    // Le pagine appese, concatenate nell'ordine dei chunk, sono ESATTAMENTE gli slug interni
    // derivati, nello stesso ordine.
    expect(slugAppesi()).toEqual(['in-1', 'in-2', 'in-3', 'in-4', 'in-5', 'in-6', 'in-7']); // covers: AC-234-4
    // Solo l'ULTIMO append porta a 'complete'; il primo tiene aperta la riga.
    expect(finalDi(0)).toBe(false); // covers: AC-234-4
    expect(finalDi(appendHolder.calls.length - 1)).toBe(true); // covers: AC-234-4
  });

  // covers: AC-234-5
  it('RI-fase2 su una generazione gia complete: respinta prima del confine, nessun secondo pool inner', async () => {
    genHolder.current = { ok: true, generation: gen({ status: 'complete', chosen_variant: VARIANTE, max_pages: 10 }) };

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: false, reason: 'stato_non_valido' }); // covers: AC-234-5
    // Nessuna chiamata al confine ne' scrittura: il rifiuto sullo stato precede tutto.
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-234-5
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-234-5
    expect(appendPagesSpy).not.toHaveBeenCalled(); // covers: AC-234-5
  });

  // covers: AC-234-6
  it('max_pages REGISTRATO (3) governa il set: due sole pagine interne, il documento non si ricalcola dai piani correnti', async () => {
    // pagesFor REALE: e' il tetto della RIGA a tagliare, non il brief. maxPages=3 tiene le due
    // interne a priorita' massima (offerte 90, contatti 80) e scarta orari e faq.
    genHolder.current = { ok: true, generation: gen({ status: 'chosen', chosen_variant: VARIANTE, max_pages: 3 }) };

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: true }); // covers: AC-234-6

    // Il documento finale ha tre pagine (home + due interne), coerenti col max_pages REGISTRATO e
    // non con le quattro interne che il brief ricco produrrebbe a tetto alto.
    expect(slugAppesi()).toEqual(['offerte', 'contatti']); // covers: AC-234-6
    expect(boundarySpy).toHaveBeenCalledTimes(1); // covers: AC-234-6 — due pagine, un solo chunk
    expect(finalDi(0)).toBe(true); // covers: AC-234-6 — l'unico chunk e' anche l'ultimo
  });

  // NON deriva da un AC: pin del contenimento del costo (security_note di T-234). Un brief la cui
  // lettura FALLISCE non e' un brief assente (P2-D16), e in nessuno dei due casi si spende una
  // chiamata al confine.
  it('un guasto di lettura del brief non spende alcuna chiamata al confine, ed e distinto dal brief assente', async () => {
    briefHolder.current = { ok: false, status: 500 };
    expect(await runPhase2({ siteId: SITE_ID, generationId: GEN_ID })).toEqual({
      ok: false,
      reason: 'brief_non_leggibile',
    }); // P2-D16

    briefHolder.current = { ok: true, brief: null, status: null, complete: false };
    expect(await runPhase2({ siteId: SITE_ID, generationId: GEN_ID })).toEqual({
      ok: false,
      reason: 'brief_assente',
    }); // P2-D16

    expect(boundarySpy).not.toHaveBeenCalled();
    expect(writePoolSpy).not.toHaveBeenCalled();
  });

  // NON deriva da un AC: contenimento del costo ZERO-CHUNK (P2-D13). Una one-pager (nessuna pagina
  // interna) chiude subito con un append VUOTO e {final:true}, SENZA spendere una chiamata al
  // confine. Rimuovere quel ramo lascerebbe la one-pager senza alcun append — mai 'complete'.
  it('one-pager (nessuna pagina interna): chiude con un append vuoto {final:true} senza toccare il confine', async () => {
    pagesHolder.override = () => [homeSpec()];

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: true }); // P2-D13
    expect(boundarySpy).not.toHaveBeenCalled(); // P2-D13 — zero chunk, zero chiamate al modello
    expect(writePoolSpy).not.toHaveBeenCalled(); // P2-D13
    // ESATTAMENTE un append, VUOTO e FINALE: la one-pager arriva a 'complete' con la sola home.
    expect(appendHolder.calls).toHaveLength(1); // P2-D13
    expect(appendHolder.calls[0][1]).toEqual([]); // P2-D13
    expect(finalDi(0)).toBe(true); // P2-D13
  });

  // NON deriva da un AC: il CATCH del confine (T-224). Un'ECCEZIONE (rete/SDK) non e' un esito
  // NOMINATO di fallimento: entrambe chiudono la fase 2 a 'failed', ma con motivi distinti — qui
  // 'confine_in_errore', non il vocabolario chiuso del troncamento. Senza il try/catch l'eccezione
  // risalirebbe e la fase 2 non si chiuderebbe mai a 'failed'.
  it("un'eccezione del confine (rete) chiude la fase 2 a failed col motivo 'confine_in_errore', esito 'confine_fallito'", async () => {
    pagesHolder.override = () => setDiSette();
    boundarySpy.mockRejectedValueOnce(new Error('rete'));

    const res = await runPhase2({ siteId: SITE_ID, generationId: GEN_ID });
    expect(res).toEqual({ ok: false, reason: 'confine_fallito' }); // T-224
    // La fase 2 e' chiusa a 'failed' col motivo dell'ECCEZIONE, distinto dal troncamento nominato.
    expect(failHolder.calls).toHaveLength(1); // T-224
    expect(failHolder.calls[0][1]).toBe('confine_in_errore'); // T-224
    // Il fallimento e' TERMINALE gia' al primo chunk: nessun secondo giro, nessun pool, nessun append.
    expect(boundarySpy).toHaveBeenCalledTimes(1); // T-224
    expect(writePoolSpy).not.toHaveBeenCalled(); // T-224
    expect(appendHolder.calls.every((c) => (c[2] as { final?: boolean }).final !== true)).toBe(true); // T-224
  });
});
