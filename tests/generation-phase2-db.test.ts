import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-234 (macrotask generation-ui, P2) — LE DUE NUOVE TRANSIZIONI DELLA FASE 2 A CHUNK (P2-D32),
// RUNTIME contro il Supabase locale: `appendPages({final:false})` (chosen->chosen, document
// ESTESO) e `failGenerationPhase2` (chosen->failed, document INTATTO). Come T-203/T-204 mockiamo
// SOLO la costruzione del client SSR con un client ad AUTH REALE (signInAs -> JWT, RLS ATTIVA);
// la macchina a stati, le CAS e la RLS girano per intero contro il DB. La service_role compare
// SOLO come ORACOLO INDIPENDENTE (adminClient) e nel setup, mai dentro le azioni.
//
// PERCHE' QUI E NON IN generation-phase2.test.ts: quel file MOCKA @/data/generations a livello di
// modulo per contare l'orchestrazione di `runPhase2`; le CAS reali contro il DB non possono
// coabitare con quel mock (vi.mock e' hoisted sull'intero file). PERCHE' NON e' un valore
// restituito che si controlla, ma la RIGA RILETTA con la service_role: le CAS nuove non devono
// restare vere per costruzione — un `.eq('status','chosen')` che non filtrasse davvero passerebbe
// il ramo positivo e cadrebbe solo sul NEGATIVO, che qui c'e' (transizione da uno stato sbagliato).

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { appendPages, failGenerationPhase2 } from '@/data/generations';

// ── fixture del documento (forma di parseDocument, T-202): identica a T-204 ───────────────────
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

function paginaHome(firma: string) {
  return {
    slug: 'home',
    role: 'home',
    title: `Panificio Aurora — ${firma}`,
    meta_description: `Pane a lievitazione naturale, ${firma}.`,
    blocks: [
      {
        id: 'hero',
        content: {
          hero_title_kicker: `Panificio dal 1953 — ${firma}`,
          hero_title: `Il pane di via Roma (${firma})`,
          hero_subtitle: `Sfornato tre volte al giorno. ${firma}`,
        },
        data: { business_name: `Panificio Aurora ${firma}` },
        brief_fields_rendered: ['business_name'],
        images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
      },
    ],
  };
}

function paginaInterna(slug: string, role: string) {
  return {
    slug,
    role,
    title: `Titolo della pagina ${slug}`,
    meta_description: `Meta description della pagina ${slug}, diversa da ogni altra.`,
    blocks: [
      {
        id: `${slug}-blocco`,
        content: { offerings_title: `Sezione principale di ${slug}` },
        data: { address: `Indirizzo reso in ${slug}` },
        brief_fields_rendered: ['address'],
        images: [{ source: 'theme-placeholder', token: `banner-${slug}` }],
      },
    ],
  };
}

function documentoSoloHome(firma: string) {
  return { recipe_id: RICETTA, theme_id: TEMA, pages: [paginaHome(firma)] };
}

function documentoMultiPagina(firma: string) {
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [paginaHome(firma), paginaInterna('offerte', 'offerings')],
  };
}

type Esito = { ok: true } | { ok: false; status: number };
function accettato(res: Esito, cosa: string): void {
  if (!res.ok) throw new Error(`${cosa} doveva riuscire, invece status=${res.status}`);
}
function rifiuto(res: Esito, cosa: string): number {
  if (res.ok) throw new Error(`${cosa} NON doveva riuscire`);
  return res.status;
}

describe.skipIf(!SB)('T-234 appendPages({final:false}) e failGenerationPhase2 (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t234a_${randomUUID()}@example.test`;
  let userAId = '';
  let accountAId = '';
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  let gChunk = ''; // 'chosen' — appendPages({final:false}) poi {final:true}
  let gFail = ''; //  'chosen' — failGenerationPhase2
  let gReady = ''; // 'ready'  — controllo negativo delle due CAS

  async function creaSito(slug: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountAId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function creaGenerazione(opts: {
    slug: string;
    status: string;
    maxPages: number;
    document?: unknown;
    chosenVariant?: number | null;
  }): Promise<string> {
    const siteId = await creaSito(opts.slug);
    const quando = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: accountAId,
        site_id: siteId,
        status: opts.status,
        max_pages: opts.maxPages,
        document: opts.document ?? null,
        chosen_variant: opts.chosenVariant ?? null,
        created_at: quando,
        updated_at: quando,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  type Istantanea = {
    status: string;
    chosen_variant: number | null;
    document: unknown;
    updated_at: string;
  };
  async function istantanea(generationId: string): Promise<Istantanea> {
    const { data, error } = await adminClient()
      .from('site_generations')
      .select('status, chosen_variant, document, updated_at')
      .eq('id', generationId)
      .single();
    if (error) throw error;
    return data as Istantanea;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    userAId = a.id;
    const { data: accA, error } = await adminClient()
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    if (error || !accA) throw error ?? new Error('account di A assente');
    accountAId = accA.id as string;

    gChunk = await creaGenerazione({
      slug: 't234-chunk',
      status: 'chosen',
      maxPages: 8,
      chosenVariant: 0,
      document: documentoSoloHome('chunk'),
    });
    gFail = await creaGenerazione({
      slug: 't234-fail',
      status: 'chosen',
      maxPages: 5,
      chosenVariant: 2,
      document: documentoMultiPagina('fail'),
    });
    gReady = await creaGenerazione({ slug: 't234-ready', status: 'ready', maxPages: 6 });

    clientA = await signInAs(emailA, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
  });

  // covers: AC-234-3
  it("appendPages({final:false}) ESTENDE il documento e LASCIA la riga 'chosen'; un secondo append {final:true} la porta a 'complete'", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gChunk);
    expect(prima.status).toBe('chosen');
    expect((prima.document as { pages: unknown[] }).pages).toHaveLength(1);

    // CHUNK NON FINALE: estende (home + una interna) ma NON chiude.
    accettato(
      await appendPages(gChunk, [paginaInterna('offerte', 'offerings')], { final: false }),
      'appendPages({final:false})',
    );

    const dopoChunk = await istantanea(gChunk);
    // La riga resta 'chosen', ma il documento e' CAMBIATO: la CAS chosen->chosen ha scritto
    // davvero (non e' un no-op mascherato da fixture gia' 'chosen').
    expect(dopoChunk.status).toBe('chosen'); // covers: AC-234-3
    const doc = dopoChunk.document as { pages: { slug: string }[] };
    expect(doc.pages.map((p) => p.slug)).toEqual(['home', 'offerte']); // covers: AC-234-3
    // Prova di vita: `updated_at` avanza, cosi' un chunk in corso non invecchia sotto la
    // riconciliazione (P2-D32).
    expect(Date.parse(dopoChunk.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-234-3
    expect(dopoChunk.chosen_variant).toBe(0); // covers: AC-234-3

    // CHUNK FINALE: chiude a 'complete', estendendo ancora.
    accettato(
      await appendPages(gChunk, [paginaInterna('contatti', 'contact')], { final: true }),
      'appendPages({final:true})',
    );
    const finale = await istantanea(gChunk);
    expect(finale.status).toBe('complete'); // covers: AC-234-4
    expect((finale.document as { pages: { slug: string }[] }).pages.map((p) => p.slug)).toEqual([
      'home',
      'offerte',
      'contatti',
    ]); // covers: AC-234-4
  });

  // covers: AC-234-3
  it("failGenerationPhase2 porta 'chosen' -> 'failed' col motivo nominato, senza toccare il documento gia' persistito", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gFail);
    expect(prima.status).toBe('chosen');

    accettato(await failGenerationPhase2(gFail, 'fase2_troncata'), 'failGenerationPhase2');

    const dopo = await istantanea(gFail);
    expect(dopo.status).toBe('failed'); // covers: AC-234-3
    // Il documento gia' persistito (home + prima interna) NON e' toccato: la fase 2 fallita
    // conserva il lavoro dei chunk riusciti.
    expect(dopo.document).toEqual(prima.document); // covers: AC-234-3
    expect(dopo.chosen_variant).toBe(2); // covers: AC-234-3
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-234-3
  });

  // covers: AC-234-3
  it('le due CAS della fase 2 sono vincolate a PARTIRE da chosen: da uno stato diverso (ready) sono respinte con 409 e la riga non si muove', async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gReady);
    expect(prima.status).toBe('ready');

    // NEGATIVO che rende non-vacue le due CAS: da 'ready' entrambe toccano 0 righe -> 409.
    expect(
      rifiuto(await appendPages(gReady, [paginaInterna('offerte', 'offerings')], { final: false }), 'appendPages da ready'),
    ).toBe(409); // covers: AC-234-3
    expect(rifiuto(await failGenerationPhase2(gReady, 'fase2_troncata'), 'failGenerationPhase2 da ready')).toBe(409); // covers: AC-234-3

    const dopo = await istantanea(gReady);
    expect(dopo.status).toBe('ready'); // covers: AC-234-3
    expect(dopo.document).toBeNull(); // covers: AC-234-3
  });

  // covers: AC-234-3
  it('senza sessione le due nuove transizioni falliscono con 401 e non modificano la riga', async () => {
    clientHolder.current = anon;
    const prima = await istantanea(gFail);

    expect(rifiuto(await appendPages(gFail, [], { final: false }), 'appendPages anonimo')).toBe(401); // covers: AC-234-3
    expect(rifiuto(await failGenerationPhase2(gFail, 'fase2_troncata'), 'failGenerationPhase2 anonimo')).toBe(401); // covers: AC-234-3

    const dopo = await istantanea(gFail);
    expect(dopo.status).toBe(prima.status); // covers: AC-234-3
  });
});
