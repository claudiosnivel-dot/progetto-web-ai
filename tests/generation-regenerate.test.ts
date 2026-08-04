import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-232 (macrotask generation-ui, P2) — ORACOLO della RIGENERAZIONE di una variante (P2-D3,
// copia-su-scrittura). Le asserzioni derivano da AC-232-3 e AC-232-5 (04-generation-ui.md),
// taggate `// covers: AC-232-<n>` sulla riga dell'EXPECT.
//
// DUE META', E LA RAGIONE DELLA DIVISIONE:
//  - Il COSTO (AC-232-3) e il canale d'errore (AC-232-5) si misurano con DOPPI: il confine
//    (@/data/anthropic runGenerationTurn) conta le chiamate al modello, `getBrief`/`writePool`
//    sono i seam a monte e di scrittura. L'assemblaggio del turno di fase 1 gira PER DAVVERO sul
//    brief reale (proiezione/tool/pagine), quindi il conteggio non e' hollow.
//  - L'INVARIANTE DI SCHEMA che rende irrappresentabile la doppia rigenerazione (AC-232-5) e' un
//    fatto del DB, e si prova contro il Supabase locale sotto describe.skipIf(!SB), come
//    generations-write-actions: due inserimenti della STESSA terna (generation_id, 'home', 2)
//    col client con SESSIONE (RLS attiva), e il secondo cade sull'UNIQUE — una sola riga resta.
//
// La copia-su-scrittura (le altre quattro varianti rendono lo STESSO albero di prima) e' provata
// sul selettore PURO `poolForVariant`: dopo la rigenerazione della variante 2, le posizioni
// 0,1,3,4 selezionano ancora lo STESSO oggetto pool condiviso — identita' di riferimento, quindi
// stesso `resolve` e stesso render, senza dover montare cinque alberi.

const { getBriefSpy, briefHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { briefHolder: holder, getBriefSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { writePoolSpy, writeHolder } = vi.hoisted(() => {
  const holder = { returns: [] as unknown[], calls: [] as unknown[][] };
  return {
    writeHolder: holder,
    writePoolSpy: vi.fn(async (...args: unknown[]) => {
      holder.calls.push(args);
      // A esiti multipli si consuma uno per chiamata; altrimenti si ripete l'ultimo.
      return holder.returns.length > 1 ? holder.returns.shift() : holder.returns[0];
    }),
  };
});

// getGeneration e' il seam della COERENZA siteId<->generationId e del gate di stato (SEC): la
// rigenerazione legge la generazione CORRENTE del sito e pretende che sia quella indicata e in
// 'ready' PRIMA di spendere il confine. Il doppio restituisce la generazione del SITO, cosi' un
// generationId che non le corrisponde (l'attacco cross-sito nello stesso account) e' osservabile.
const { getGenerationSpy, genHolder } = vi.hoisted(() => {
  const holder = { result: null as unknown };
  return { genHolder: holder, getGenerationSpy: vi.fn(async () => holder.result) };
});
vi.mock('@/data/generations', () => ({
  writePool: writePoolSpy,
  getGeneration: getGenerationSpy,
}));

const { boundarySpy } = vi.hoisted(() => ({ boundarySpy: vi.fn() }));
vi.mock('@/data/anthropic', () => ({ runGenerationTurn: boundarySpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { regenerateVariant } from '@/data/generation-regenerate';
import { poolForVariant } from '@/ui/generation/variant-document';

// Brief RICCO, dominio REALE: l'assemblaggio del turno di fase 1 (proiezione, tool, pagine) gira
// per davvero. Valori DISCORDANTI: due chiavi orario, tre offerte di cui una PREFISSO dell'altra.
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

// Il pool ritornato dal confine: forma di massima con un MARCATORE riconoscibile. writePool e'
// mockato, quindi non lo valida — qui interessa solo che sia CIO' che finisce in writePool.
const FAKE_POOL = { pages: { home: { hero_title: 'ZQMARK_regen' } } };

const SITE_ID = 'site-di-a';
const GEN_ID = '11111111-1111-4111-8111-111111111111';

function okBrief() {
  return { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
}

// La generazione CORRENTE del sito, come la ritorna getGeneration: `id` = GEN_ID e `status`
// 'ready' salvo override. E' la generazione PROPRIA del sito SITE_ID; un generationId diverso
// da questo `id` e' il caso incoerente.
function currentGeneration(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    generation: {
      id: GEN_ID,
      site_id: SITE_ID,
      status: 'ready',
      chosen_variant: null,
      max_pages: 10,
      failure_reason: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    },
  };
}

beforeEach(() => {
  briefHolder.current = okBrief();
  genHolder.result = currentGeneration();
  writeHolder.returns = [{ ok: true, id: 'pool-nuovo' }];
  writeHolder.calls.length = 0;
  getBriefSpy.mockClear();
  getGenerationSpy.mockClear();
  writePoolSpy.mockClear();
  boundarySpy.mockReset();
  boundarySpy.mockResolvedValue({ ok: true, pool: FAKE_POOL });
});

describe('T-232 rigenera una variante (P2-D3)', () => {
  // covers: AC-232-3
  it('rigenera la variante 2: UNA chiamata al confine e UN writePool con scope home e variant_index 2', async () => {
    // when: eseguo 'rigenera' sulla variante 2
    const result = await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 });

    // then: il confine e' chiamato UNA volta sola (costo di P2-D3 verificabile senza chiave).
    expect(boundarySpy).toHaveBeenCalledTimes(1); // covers: AC-232-3
    // …ed e' un turno di FASE 1 assemblato per davvero (non hollow).
    expect((boundarySpy.mock.calls[0][0] as { phase: string }).phase).toBe('phase1'); // covers: AC-232-3

    // then: esiste UN pool scritto con scope 'home' e variant_index = 2 (il pool del confine).
    expect(writePoolSpy).toHaveBeenCalledTimes(1); // covers: AC-232-3
    expect(writeHolder.calls[0][0]).toBe(GEN_ID); // covers: AC-232-3
    expect(writeHolder.calls[0][1]).toBe('home'); // covers: AC-232-3
    expect(writeHolder.calls[0][2]).toBe(2); // covers: AC-232-3
    expect(writeHolder.calls[0][3]).toBe(FAKE_POOL); // covers: AC-232-3
    expect(writeHolder.calls[0][4]).toEqual(['home']); // covers: AC-232-3
    expect(result).toEqual({ ok: true, poolId: 'pool-nuovo' }); // covers: AC-232-3
  });

  // covers: AC-232-3
  it('le varianti 0,1,3,4 selezionano lo STESSO pool condiviso di prima; solo la 2 usa il proprio', () => {
    // given: i pool 'home' PRIMA della rigenerazione (solo il condiviso) e DOPO (condiviso +
    // variante 2). Oggetti DISTINTI, cosi' l'identita' di riferimento distingue i due.
    const shared = { pages: { home: { hero_title: 'condiviso' } } };
    const variant2 = { pages: { home: { hero_title: 'variante-2' } } };
    const prima = { shared, byVariant: {} as Record<number, unknown> };
    const dopo = { shared, byVariant: { 2: variant2 } as Record<number, unknown> };

    // then: PRIMA, ogni variante rende dal condiviso.
    for (const i of [0, 1, 2, 3, 4]) {
      expect(poolForVariant(prima, i)).toBe(shared); // covers: AC-232-3
    }
    // then: DOPO, la 2 usa il proprio pool, e 0,1,3,4 restano sullo STESSO condiviso di prima —
    // stesso oggetto ⇒ stesso resolve ⇒ stesso albero, senza chiamare il confine.
    expect(poolForVariant(dopo, 2)).toBe(variant2); // covers: AC-232-3
    for (const i of [0, 1, 3, 4]) {
      expect(poolForVariant(dopo, i)).toBe(shared); // covers: AC-232-3
    }
  });

  // covers: AC-232-5
  it('seconda rigenerazione della stessa variante gia in volo: respinta con errore riconoscibile', async () => {
    // given: la prima scrittura riesce, la seconda sbatte contro l'UNIQUE (409) del DB.
    writeHolder.returns = [
      { ok: true, id: 'pool-2' },
      { ok: false, status: 409 },
    ];

    const primo = await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 });
    const secondo = await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 });

    // then: la prima riesce, la seconda e' respinta con un errore RICONOSCIBILE ('conflitto').
    expect(primo).toEqual({ ok: true, poolId: 'pool-2' }); // covers: AC-232-5
    expect(secondo).toEqual({ ok: false, reason: 'conflitto' }); // covers: AC-232-5
    // La UI non ha sorvegliato nulla: entrambe hanno tentato la scrittura, ed e' il vincolo del
    // DB (non un controllo applicativo) a respingere la seconda.
    expect(writePoolSpy).toHaveBeenCalledTimes(2); // covers: AC-232-5
  });

  // Un indice fuori 0..4 e' respinto PRIMA di spendere una chiamata al confine (contenimento
  // del costo): pin dichiarato accanto ad AC-232-3/-5.
  it('indice di variante fuori 0..4: respinto senza chiamare il confine ne scrivere', async () => {
    const result = await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 5 });
    expect(result).toEqual({ ok: false, reason: 'indice_non_valido' });
    expect(boundarySpy).not.toHaveBeenCalled();
    expect(writePoolSpy).not.toHaveBeenCalled();
    // L'indice si valida PRIMA di ogni round-trip: nemmeno la lettura di stato parte.
    expect(getGenerationSpy).not.toHaveBeenCalled();
  });
});

// ── COERENZA siteId<->generationId e CONTENIMENTO DEL COSTO (SEC, security_note di AC-232-5) ──
// La RLS di site_generations scopa per ACCOUNT, non per SITO: senza un controllo applicativo un
// utente dello stesso account puo' passare il generationId del sito B col siteId del sito A e
// avvelenare il pool di B col brief di A. Il fix legge la generazione CORRENTE del sito e pretende
// che sia ESATTAMENTE quella indicata e in 'ready', PRIMA di leggere il brief e PRIMA del confine.
// Il doppio di getGeneration ritorna la generazione del SITO (id GEN_ID); il generationId passato
// e' la variabile.
const GEN_OF_B = '22222222-2222-4222-8222-222222222222';

describe('T-232 SEC — coerenza sito<->generazione e gate di stato (AC-232-5)', () => {
  // covers: AC-232-5
  it('siteId di A + generationId di B (stesso account): respinto con sito_incoerente, nessun confine ne writePool', async () => {
    // given: getGeneration(SITE_ID) ritorna la generazione PROPRIA di A (id GEN_ID), non quella di B.
    genHolder.result = currentGeneration({ id: GEN_ID, status: 'ready' });

    // when: si chiede di rigenerare passando il generationId di B (visibile perche' stesso account).
    const result = await regenerateVariant({
      siteId: SITE_ID,
      generationId: GEN_OF_B,
      variantIndex: 2,
    });

    // then: respinto con un errore riconoscibile, e nulla e' stato scritto ne speso al confine.
    expect(result).toEqual({ ok: false, reason: 'sito_incoerente' }); // covers: AC-232-5
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-232-5 — nessuna chiamata a pagamento sul ramo respinto
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-232-5 — il pool di B NON e' toccato
    // La coerenza si valuta sulla generazione del SITO indicato, non sul generationId del client.
    expect(getGenerationSpy).toHaveBeenCalledWith(SITE_ID); // covers: AC-232-5
  });

  // covers: AC-232-5
  it('generazione non in ready (generating/chosen/complete/failed): stato_non_valido, nessun confine speso', async () => {
    for (const status of ['generating', 'chosen', 'complete', 'failed']) {
      boundarySpy.mockClear();
      writePoolSpy.mockClear();
      genHolder.result = currentGeneration({ id: GEN_ID, status });

      const result = await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 });

      expect(result).toEqual({ ok: false, reason: 'stato_non_valido' }); // covers: AC-232-5
      expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-232-5
      expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-232-5
    }
  });

  // covers: AC-232-5
  it('un guasto di lettura della generazione non e una generazione assente: 500->non_leggibile, 401->non_autorizzato', async () => {
    genHolder.result = { ok: false, status: 500 };
    expect(
      await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
    ).toEqual({ ok: false, reason: 'generazione_non_leggibile' }); // covers: AC-232-5

    genHolder.result = { ok: false, status: 401 };
    expect(
      await regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
    ).toEqual({ ok: false, reason: 'non_autorizzato' }); // covers: AC-232-5
    // Un guasto di lettura non spende MAI il confine.
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-232-5
  });

  // covers: AC-232-5
  // Due rigenerazioni CONCORRENTI su un ramo che verrebbe comunque respinto (qui: stato non
  // 'ready') NON devono spendere DUE chiamate al confine a vuoto: il gate di stato sta a monte
  // del confine, quindi entrambe si fermano prima e il modello non e' chiamato affatto.
  it('Promise.all di due rigenerate su una generazione non-ready: il confine non e chiamato due volte a vuoto', async () => {
    genHolder.result = currentGeneration({ id: GEN_ID, status: 'chosen' });

    const [a, b] = await Promise.all([
      regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
      regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
    ]);

    expect(a).toEqual({ ok: false, reason: 'stato_non_valido' }); // covers: AC-232-5
    expect(b).toEqual({ ok: false, reason: 'stato_non_valido' }); // covers: AC-232-5
    // Il confine non e' stato speso NEMMENO UNA VOLTA, tanto meno due a vuoto.
    expect(boundarySpy.mock.calls.length).toBeLessThanOrEqual(1); // covers: AC-232-5
    expect(boundarySpy).not.toHaveBeenCalled(); // covers: AC-232-5
    expect(writePoolSpy).not.toHaveBeenCalled(); // covers: AC-232-5
  });

  // covers: AC-232-5
  // Due rigenerazioni CONCORRENTI della stessa variante in stato 'ready': entrambe tentano
  // (nessun controllo applicativo le previene, P2-D3), ma l'UNIQUE del DB fa fallire la seconda
  // scrittura — quindi AL PIU' UNA e' UTILE (una sola scrittura riesce), non due.
  it('Promise.all di due rigenerate della stessa variante: al piu una e utile (UNIQUE, non un guardiano applicativo)', async () => {
    genHolder.result = currentGeneration({ id: GEN_ID, status: 'ready' });
    // La prima scrittura riesce, la seconda sbatte contro l'UNIQUE (409).
    writeHolder.returns = [
      { ok: true, id: 'pool-uno' },
      { ok: false, status: 409 },
    ];

    const risultati = await Promise.all([
      regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
      regenerateVariant({ siteId: SITE_ID, generationId: GEN_ID, variantIndex: 2 }),
    ]);

    // then: esattamente UNA rigenerazione e' utile (ha scritto); l'altra e' 'conflitto'.
    const utili = risultati.filter((r) => r.ok);
    expect(utili).toHaveLength(1); // covers: AC-232-5 — al piu una scrittura utile
    expect(risultati.filter((r) => !r.ok && r.reason === 'conflitto')).toHaveLength(1); // covers: AC-232-5
  });
});

// ── L'INVARIANTE DI SCHEMA (AC-232-5) contro il Supabase locale ──────────────────────────────
// Rispecchia generations-write-actions: la doppia rigenerazione della stessa variante e'
// irrappresentabile perche' l'UNIQUE (generation_id, scope, variant_index) di T-200 respinge il
// secondo inserimento. Si esercita col client con SESSIONE (RLS attiva), MAI la service_role
// (che compare solo nel setup e come oracolo di conteggio).

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!SB)('T-232 UNIQUE su (generation_id, scope, variant_index) — Supabase locale', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t232a_${randomUUID()}@example.test`;
  let userAId = '';
  let accountAId = '';
  let siteAId = '';
  let genId = '';
  let clientA: SupabaseClient;

  function poolContenuto(firma: string): Record<string, unknown> {
    return {
      pages: {
        home: {
          hero_title_kicker: `Occhiello ${firma}`,
          hero_title: `Titolo ${firma}`,
        },
      },
    };
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    userAId = a.id;
    const admin = adminClient();

    const { data: account, error: accErr } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    if (accErr || !account) throw accErr ?? new Error('account di A assente');
    accountAId = account.id as string;

    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'Trattoria', slug: `trattoria-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    siteAId = site.id as string;

    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountAId,
        site_id: siteAId,
        status: 'ready',
        max_pages: 10,
        updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    genId = gen.id as string;

    // Un pool CONDIVISO ('home', null) esiste gia', come dopo la fase 1: la rigenerazione ne
    // aggiunge uno PER VARIANTE, non lo sovrascrive.
    const { error: sharedErr } = await admin.from('generation_pools').insert({
      account_id: accountAId,
      generation_id: genId,
      scope: 'home',
      variant_index: null,
      content: poolContenuto('condiviso'),
    });
    if (sharedErr) throw sharedErr;

    clientA = await signInAs(emailA, password);
  });

  afterAll(async () => {
    if (siteAId) await adminClient().from('sites').delete().eq('id', siteAId);
    if (userAId) await deleteTestUser(userAId);
  });

  // covers: AC-232-5
  it('due pool home/variante-2 per la stessa generazione: il secondo e respinto, resta UNA sola riga', async () => {
    // given/when: il PRIMO pool della variante 2, scritto col client con sessione (RLS attiva).
    const primo = await clientA
      .from('generation_pools')
      .insert({
        account_id: accountAId,
        generation_id: genId,
        scope: 'home',
        variant_index: 2,
        content: poolContenuto('variante-2-a'),
      })
      .select('id')
      .single();
    expect(primo.error).toBeNull(); // covers: AC-232-5

    // when: un SECONDO pool della STESSA variante 2 (la doppia rigenerazione in volo).
    const secondo = await clientA
      .from('generation_pools')
      .insert({
        account_id: accountAId,
        generation_id: genId,
        scope: 'home',
        variant_index: 2,
        content: poolContenuto('variante-2-b'),
      })
      .select('id')
      .single();

    // then: respinto dall'UNIQUE (23505), non un secondo pool.
    expect(secondo.error?.code).toBe('23505'); // covers: AC-232-5

    // then, ORACOLO INDIPENDENTE (service_role): UNA sola riga ('home', 2) per la generazione.
    const { data, error } = await adminClient()
      .from('generation_pools')
      .select('id')
      .eq('generation_id', genId)
      .eq('scope', 'home')
      .eq('variant_index', 2);
    expect(error).toBeNull(); // covers: AC-232-5
    expect((data ?? []).length).toBe(1); // covers: AC-232-5
  });
});
