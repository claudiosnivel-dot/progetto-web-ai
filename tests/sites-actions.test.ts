import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-101 — Server action createSite/listSites RUNTIME contro il Supabase locale.
//
// Cosa mockiamo e perché NON è hollow: sostituiamo SOLO la costruzione del client
// SSR (createServerSupabaseClient), che dipende dai cookie di next/headers non
// disponibili in node, con un client Supabase ad AUTH REALE (signInAs → JWT,
// ruolo 'authenticated', RLS ATTIVA). La logica delle azioni (validazione,
// derivazione dell'account dall'identità, slug unico, insert/select con RLS) gira
// per intero contro il DB locale. L'identità è derivata da supabase.auth.getUser()
// sul client iniettato → è reale, non auto-confermata.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Holder mutabile: ogni test inietta il client con cui l'azione deve girare
// (A autenticato, oppure un client anonimo senza sessione).
const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

// createSiteForm (adapter del form) invoca revalidatePath: la mockiamo come spy
// per esercitare l'adapter reale in ambiente node senza il runtime di Next.
const { revalidatePathSpy } = vi.hoisted(() => ({ revalidatePathSpy: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathSpy }));

// Import DOPO il mock (vi.mock è hoisted).
import { createSite, listSites, createSiteForm } from '@/data/sites';

describe.skipIf(!SB)('T-101 createSite/listSites (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t101a_${randomUUID()}@example.test`;
  const emailB = `t101b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;
    const admin = adminClient();
    const { data: accA } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    const { data: accB } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userBId)
      .single();
    accountAId = accA!.id as string;
    accountBId = accB!.id as string;

    // Un solo sign-in per A (riusato); B resta gestito via service_role (setup).
    clientA = await signInAs(emailA, password);
    // Client anonimo senza sessione: auth.getUser() → nessun utente.
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId); // cascade accounts → sites
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-101-1
  it("A crea un sito: riga in sites con account_id=X, status='draft', slug non nullo, ritorna l'id", async () => {
    clientHolder.current = clientA;
    const res = await createSite('Bar Sole');
    expect(res.ok).toBe(true); // covers: AC-101-1
    if (!res.ok) throw new Error('createSite fallita');
    expect(res.id).toBeTruthy(); // covers: AC-101-1

    // Oracolo service_role: la riga esiste con i valori attesi.
    const { data: row } = await adminClient()
      .from('sites')
      .select('account_id, status, slug')
      .eq('id', res.id)
      .single();
    expect(row?.account_id).toBe(accountAId); // covers: AC-101-1
    expect(row?.status).toBe('draft'); // covers: AC-101-1
    expect(typeof row?.slug).toBe('string'); // covers: AC-101-1
    expect((row?.slug as string).length).toBeGreaterThan(0); // covers: AC-101-1
    expect(row?.slug).toBe('bar-sole'); // covers: AC-101-1
  });

  // covers: AC-101-4
  it("createSite due volte con lo stesso name nello stesso account → due slug distinti, nessuna violazione unique", async () => {
    clientHolder.current = clientA;
    const r1 = await createSite('Pizzeria');
    const r2 = await createSite('Pizzeria');
    expect(r1.ok).toBe(true); // covers: AC-101-4
    expect(r2.ok).toBe(true); // covers: AC-101-4
    if (!r1.ok || !r2.ok) throw new Error('createSite fallita');

    const { data: rows } = await adminClient()
      .from('sites')
      .select('slug')
      .in('id', [r1.id, r2.id]);
    const slugs = (rows ?? []).map((r) => r.slug).sort();
    expect(slugs).toEqual(['pizzeria', 'pizzeria-2']); // covers: AC-101-4
    expect(new Set(slugs).size).toBe(2); // covers: AC-101-4 — slug distinti
  });

  // covers: AC-101-3
  it("createSite con name di soli spazi → validazione rifiuta (400), nessuna riga aggiunta", async () => {
    clientHolder.current = clientA;
    const before = await adminClient()
      .from('sites')
      .select('id')
      .eq('account_id', accountAId);
    const beforeCount = (before.data ?? []).length;

    const res = await createSite('   ');
    expect(res.ok).toBe(false); // covers: AC-101-3
    if (res.ok) throw new Error('createSite avrebbe dovuto rifiutare');
    expect(res.status).toBe(400); // covers: AC-101-3

    const after = await adminClient()
      .from('sites')
      .select('id')
      .eq('account_id', accountAId);
    expect((after.data ?? []).length).toBe(beforeCount); // covers: AC-101-3
  });

  // covers: AC-101-2
  it('A elenca i propri siti: solo quelli dell account X, nessuno dell account Y', async () => {
    // B (account Y) possiede un sito, inserito via service_role (setup, non browser).
    const { error: insErr } = await adminClient()
      .from('sites')
      .insert({ account_id: accountBId, name: 'Sito di B', slug: 'sito-di-b' });
    expect(insErr).toBeNull(); // covers: AC-101-2 — dato di B esiste davvero

    clientHolder.current = clientA;
    const res = await listSites();
    expect(res.ok).toBe(true); // covers: AC-101-2
    if (!res.ok) throw new Error('listSites fallita');

    const accountIds = new Set<string>();
    for (const s of res.sites) {
      const { data } = await adminClient()
        .from('sites')
        .select('account_id')
        .eq('id', s.id)
        .single();
      accountIds.add(data?.account_id as string);
    }
    // Tutti i siti restituiti appartengono all'account di A; nessuno a quello di B.
    expect(accountIds.has(accountAId)).toBe(true); // covers: AC-101-2
    expect(accountIds.has(accountBId)).toBe(false); // covers: AC-101-2
    // A ha creato 3 siti (Bar Sole, Pizzeria, Pizzeria) nei test precedenti.
    expect(res.sites.length).toBe(3); // covers: AC-101-2
  });

  // covers: AC-101-5
  it("A non può creare un sito nell account Y: derivazione server-side + WITH CHECK RLS lo impediscono", async () => {
    // (a) La derivazione: createSite non accetta un account_id dal client — usa
    //     sempre l'account di A. Nessuna riga con account_id=Y viene creata.
    clientHolder.current = clientA;
    const res = await createSite('Tentativo cross-tenant');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('createSite fallita');
    const { data: created } = await adminClient()
      .from('sites')
      .select('account_id')
      .eq('id', res.id)
      .single();
    expect(created?.account_id).toBe(accountAId); // covers: AC-101-5 — mai Y
    expect(created?.account_id).not.toBe(accountBId); // covers: AC-101-5

    // (b) Il gate DB indipendente: un insert diretto di A (client auth reale) che
    //     FORZA account_id=Y è respinto dalla WITH CHECK RLS (A non è membro di Y).
    const { data: forced, error } = await clientA
      .from('sites')
      .insert({ account_id: accountBId, name: 'Hack', slug: `hack-${randomUUID()}` })
      .select();
    const rejected = error !== null || (forced ?? []).length === 0;
    expect(rejected).toBe(true); // covers: AC-101-5

    // Oracolo service_role: nessun sito con account_id=Y creato da questo tentativo.
    const { data: yRows } = await adminClient()
      .from('sites')
      .select('name')
      .eq('account_id', accountBId);
    const names = (yRows ?? []).map((r) => r.name);
    expect(names).not.toContain('Hack'); // covers: AC-101-5
    expect(names).not.toContain('Tentativo cross-tenant'); // covers: AC-101-5
  });

  // covers: AC-101-6
  it('senza sessione autenticata: createSite e listSites falliscono con 401, nessuna scrittura', async () => {
    clientHolder.current = anon;

    const create = await createSite('Senza sessione');
    expect(create.ok).toBe(false); // covers: AC-101-6
    if (create.ok) throw new Error('createSite senza sessione non doveva riuscire');
    expect(create.status).toBe(401); // covers: AC-101-6

    const list = await listSites();
    expect(list.ok).toBe(false); // covers: AC-101-6
    if (list.ok) throw new Error('listSites senza sessione non doveva riuscire');
    expect(list.status).toBe(401); // covers: AC-101-6

    // Nessun sito 'Senza sessione' è stato scritto in tutto il DB.
    const { data } = await adminClient()
      .from('sites')
      .select('id')
      .eq('name', 'Senza sessione');
    expect((data ?? []).length).toBe(0); // covers: AC-101-6
  });

  // covers: AC-102-4
  it("createSiteForm (adapter del form dashboard): estrae il name dal FormData, invoca createSite (sito creato e presente in listSites) e revalida la dashboard del locale", async () => {
    clientHolder.current = clientA;
    revalidatePathSpy.mockClear();

    const formData = new FormData();
    formData.set('name', 'Sito Dal Form');
    const res = await createSiteForm('it', { status: 'idle' }, formData);

    // L'adapter reale ha esito success (createSite è stata invocata col name estratto).
    expect(res.status).toBe('success'); // covers: AC-102-4

    // createSite è stata DAVVERO invocata: un sito con quel name/slug esiste
    // nell'account di A (oracolo service_role).
    const { data: created } = await adminClient()
      .from('sites')
      .select('account_id, slug')
      .eq('name', 'Sito Dal Form')
      .single();
    expect(created?.account_id).toBe(accountAId); // covers: AC-102-4
    expect(created?.slug).toBe('sito-dal-form'); // covers: AC-102-4

    // Il nuovo sito COMPARE nell'elenco dell'utente (listSites come A).
    const list = await listSites();
    expect(list.ok).toBe(true); // covers: AC-102-4
    if (!list.ok) throw new Error('listSites fallita');
    expect(list.sites.some((s) => s.slug === 'sito-dal-form')).toBe(true); // covers: AC-102-4

    // La dashboard del locale (validato contro l'allowlist) è stata rivalidata.
    expect(revalidatePathSpy).toHaveBeenCalledWith('/it/dashboard'); // covers: AC-102-4
  });
});
