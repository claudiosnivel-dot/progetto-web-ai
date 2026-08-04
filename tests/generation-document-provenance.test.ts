import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-235 (SEC) — PROVENIENZA dell'anteprima: `readGenerationDocument` deve puntare al DOCUMENTO
// CONGELATO piu' recente, NON alla generazione piu' recente IN ASSOLUTO. La finestra P2-D15:
// dopo aver congelato un sito, l'utente puo' avviare una NUOVA generazione, che nasce
// 'generating' con `document` null; se `readGenerationDocument` leggesse la riga piu' recente in
// assoluto, quella nuova riga NASCONDEREBBE il sito appena congelato e l'anteprima direbbe
// 'unavailable' su un sito che c'e'. Le asserzioni derivano da AC-235-1.
//
// Oracolo RUNTIME contro il Supabase locale, stessa forma di generations-read-actions: si mocka
// SOLO la costruzione del client SSR (createServerSupabaseClient) con un client ad AUTH REALE
// (signInAs → JWT, ruolo authenticated, RLS ATTIVA). La service_role compare SOLO nel setup delle
// fixture. Il valore restituito non e' l'oracolo di se stesso: le fixture hanno documenti
// DISCORDANTI e un ordine temporale scelto perche' "riga giusta" e "riga qualsiasi" divergano.

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

import { readGenerationDocument } from '@/data/generation-document';

const ORA_MS = 60 * 60 * 1000;

// Documenti congelati DISCORDANTI: il piu' recente e il piu' vecchio portano marcatori diversi,
// cosi' "ha letto la riga giusta" si distingue da "ha letto una riga".
const DOC_RECENTE = {
  recipe_id: 'vetrina@1',
  theme_id: 'chiaro@1',
  pages: [{ slug: 'home', role: 'home', title: 'Congelato-recente', blocks: [] }],
};
const DOC_VECCHIO = {
  recipe_id: 'vetrina@1',
  theme_id: 'chiaro@1',
  pages: [{ slug: 'home', role: 'home', title: 'Congelato-vecchio', blocks: [] }],
};

describe.skipIf(!SB)('T-235 readGenerationDocument — provenienza (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t235prov_a_${randomUUID()}@example.test`;
  const emailB = `t235prov_b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let sitoCongelato = ''; // un doc congelato + una 'generating' piu' recente (IL caso)
  let sitoVergine = ''; // nessuna generazione, mai
  let sitoDiB = ''; // di un altro tenant
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  async function creaSito(accountId: string, slug: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function creaGenerazione(opts: {
    accountId: string;
    siteId: string;
    status: string;
    etaMs: number;
    document?: unknown;
  }): Promise<string> {
    const quando = new Date(Date.now() - opts.etaMs).toISOString();
    const { data, error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: opts.accountId,
        site_id: opts.siteId,
        status: opts.status,
        max_pages: 10,
        document: opts.document ?? null,
        created_at: quando,
        updated_at: quando,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA } = await admin.from('accounts').select('id').eq('owner_id', userAId).single();
    const { data: accB } = await admin.from('accounts').select('id').eq('owner_id', userBId).single();
    accountAId = accA!.id as string;
    accountBId = accB!.id as string;

    sitoCongelato = await creaSito(accountAId, 'prov-congelato');
    sitoVergine = await creaSito(accountAId, 'prov-vergine');
    sitoDiB = await creaSito(accountBId, 'prov-di-b');

    // TRE generazioni per il sito congelato, con eta DISCORDANTI:
    //  - 'chosen' con DOC_VECCHIO, la piu' VECCHIA (5h)
    //  - 'complete' con DOC_RECENTE, in mezzo (2h)              ← il congelato piu' recente
    //  - 'generating' con document NULL, la piu' RECENTE (1h)   ← NON deve vincere
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoCongelato,
      status: 'chosen',
      etaMs: 5 * ORA_MS,
      document: DOC_VECCHIO,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoCongelato,
      status: 'complete',
      etaMs: 2 * ORA_MS,
      document: DOC_RECENTE,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoCongelato,
      status: 'generating',
      etaMs: 1 * ORA_MS,
      document: null,
    });

    // Il sito di B ha un documento congelato PROPRIO: un null per A dev'essere isolamento, non un
    // sito senza documenti.
    await creaGenerazione({
      accountId: accountBId,
      siteId: sitoDiB,
      status: 'complete',
      etaMs: ORA_MS,
      document: DOC_RECENTE,
    });

    clientA = await signInAs(emailA, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-235-1
  it('una nuova generating (document null) NON nasconde il documento congelato: torna il congelato piu recente', async () => {
    clientHolder.current = clientA;
    const res = await readGenerationDocument(sitoCongelato);
    expect(res.ok).toBe(true); // covers: AC-235-1
    if (!res.ok) throw new Error('readGenerationDocument fallita');
    // NON null (la 'generating' piu' recente non vince) e NON il documento vecchio: il piu'
    // recente FRA QUELLI CONGELATI.
    expect(res.document).not.toBeNull(); // covers: AC-235-1
    expect(res.document).toEqual(DOC_RECENTE); // covers: AC-235-1
  });

  // covers: AC-235-1
  it('un sito mai generato torna document null (non un errore)', async () => {
    clientHolder.current = clientA;
    const res = await readGenerationDocument(sitoVergine);
    expect(res.ok).toBe(true); // covers: AC-235-1
    if (!res.ok) throw new Error('readGenerationDocument (vergine) fallita');
    expect(res.document).toBeNull(); // covers: AC-235-1
  });

  // covers: AC-235-1
  it('il documento di un altro tenant filtra a null (RLS), non a un errore ne al documento altrui', async () => {
    clientHolder.current = clientA;
    const res = await readGenerationDocument(sitoDiB);
    expect(res.ok).toBe(true); // covers: AC-235-1 — insieme vuoto, mai un errore
    if (!res.ok) throw new Error('readGenerationDocument (cross-tenant) fallita');
    expect(res.document).toBeNull(); // covers: AC-235-1
  });

  // covers: AC-235-1
  it('senza sessione: 401 e nessun documento', async () => {
    clientHolder.current = anon;
    const res = await readGenerationDocument(sitoCongelato);
    expect(res.ok).toBe(false); // covers: AC-235-1
    if (res.ok) throw new Error('readGenerationDocument senza sessione non doveva riuscire');
    expect(res.status).toBe(401); // covers: AC-235-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROVENIENZA STRUTTURALE (node-env, SENZA DB). L'invariante di AC-235-1 — leggere il
// documento CONGELATO e non la riga piu' recente in assoluto — vive nella clausola
// `.not('document', 'is', null)` della query. Sopra e' esercitata SOLO dall'oracolo runtime
// `describe.skipIf(!SB)`: senza .env.local quel blocco si auto-skippa e l'invariante non ha piu'
// alcuna probe. Qui gliene diamo una che gira SEMPRE: si spia il query-builder (il fake registra
// .from/.select/.eq/.not/.order/.limit) e si asserisce STRUTTURALMENTE che la catena porta quel
// filtro. Non e' la sostituzione dell'oracolo runtime — e' la sua rete quando il DB non c'e'.
// MUTAZIONE CHE LO RENDE ROSSO: togliere `.not('document', 'is', null)` da
// src/data/generation-document.ts — la catena non contiene piu' alcun `.not(...)` e il find cade.
describe('T-235 readGenerationDocument — provenienza STRUTTURALE (node-env, senza DB)', () => {
  it('la catena di query filtra .not("document","is",null): il congelato piu recente, non una riga qualsiasi', async () => {
    const chiamate: Array<{ metodo: string; args: readonly unknown[] }> = [];
    const builder: Record<string, unknown> = {};
    // Ogni metodo di filtro/ordinamento registra la propria chiamata e RITORNA il builder, cosi'
    // la catena `.select(...).eq(...).not(...).order(...).limit(...)` si compone come sul client
    // vero; solo `.maybeSingle()` chiude restituendo l'esito.
    for (const metodo of ['select', 'eq', 'not', 'order', 'limit']) {
      builder[metodo] = (...args: unknown[]) => {
        chiamate.push({ metodo, args });
        return builder;
      };
    }
    builder.maybeSingle = async () => ({ data: null, error: null });
    clientHolder.current = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-a' } }, error: null }) },
      from: (tabella: string) => {
        chiamate.push({ metodo: 'from', args: [tabella] });
        return builder;
      },
    } as unknown as SupabaseClient;

    const res = await readGenerationDocument('11111111-1111-4111-8111-111111111111');
    expect(res.ok).toBe(true); // covers: AC-235-1

    // IL FILTRO DI PROVENIENZA e' nella catena, con operando LETTERALE (document/is/null):
    // togliendolo dal sorgente questo find diventa undefined e l'invariante cade anche a DB spento.
    const notCall = chiamate.find((c) => c.metodo === 'not');
    expect(notCall, 'la catena di readGenerationDocument non contiene alcun .not(...)').toBeDefined(); // covers: AC-235-1
    expect(notCall?.args).toEqual(['document', 'is', null]); // covers: AC-235-1

    // Anti-vacuita': la catena e' quella giusta (site_generations, filtrata per site_id), cosi'
    // il find di sopra non sta cercando dentro una sequenza vuota o estranea.
    expect(chiamate.some((c) => c.metodo === 'from' && c.args[0] === 'site_generations')).toBe(true);
    expect(chiamate.some((c) => c.metodo === 'eq' && c.args[0] === 'site_id')).toBe(true);
  });
});
