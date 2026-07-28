import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-203 (P2) — Server action createGeneration/getGeneration/listGenerationStatuses
// RUNTIME contro il Supabase locale. Le asserzioni derivano dagli acceptance_criteria
// AC-203-1..AC-203-7 (01-generation-model.md). AC-203-7 e l'unico test PURO del file
// (nessun DB, in fondo): pinna l'invariante dei timeout, non i loro numeri.
//
// Come T-101/T-123: mockiamo SOLO la costruzione del client SSR
// (createServerSupabaseClient, che dipende dai cookie di next/headers non disponibili
// in node) con un client ad AUTH REALE (signInAs → JWT, ruolo authenticated, RLS
// ATTIVA). Tutto il resto — derivazione dell'account dall'identita, ownership del sito,
// indice UNIQUE parziale, riconciliazione, RLS delle due tabelle — gira per intero
// contro il DB locale. La service_role compare SOLO come ORACOLO (adminClient) e nel
// setup delle fixture, mai dentro le azioni.

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

import { createGeneration, getGeneration, listGenerationStatuses } from '@/data/generations';
import { GENERATION_TIMEOUTS } from '@/domain/generation/timeouts';

// ── eta delle fixture ────────────────────────────────────────────────────────
// Dall'EMENDAMENTO P2-D22 GENERATION_TIMEOUTS e leggibile (modulo di dominio puro), ma
// le fixture continuano DELIBERATAMENTE a non derivare da esso: se le eta si muovessero
// coi timeout, cambiare un timeout muoverebbe anche le fixture e i test di AC-203-5
// resterebbero verdi qualunque numero ci fosse — l'oracolo misurerebbe se stesso. Restano
// quindi due eta fisse, una per parte di qualunque timeout ragionevole. 24 ore e oltre
// ogni timeout di riconciliazione plausibile — se un giorno un timeout salisse sopra le
// 24h i test di AC-203-5 diventerebbero rossi, ed e voluto: sarebbe una decisione da
// rivedere, non una svista. 0 ms e "adesso": una riga viva.
const ORA_MS = 60 * 60 * 1000;
const ETA_STANTIA = 24 * ORA_MS;
const ETA_RECENTE = 0;

// Documenti fixture: la colonna e jsonb OPACO (T-200) e la riconciliazione NON valida
// il documento (quello e il gate di T-204/parseDocument) — chiede solo se esiste una
// pagina interna. Bastano quindi le sole chiavi che il predicato guarda.
const DOC_SOLO_HOME = {
  recipe_id: 'essenziale@1',
  theme_id: 'chiaro@1',
  pages: [{ slug: 'home', role: 'home', title: 'Home', blocks: [] }],
};
const DOC_CON_PAGINE_INTERNE = {
  recipe_id: 'essenziale@1',
  theme_id: 'chiaro@1',
  pages: [
    { slug: 'home', role: 'home', title: 'Home', blocks: [] },
    { slug: 'contatti', role: 'contact', title: 'Contatti', blocks: [] },
  ],
};

type StatoGenerazione = 'generating' | 'ready' | 'chosen' | 'complete' | 'failed';

// ── contatore di RICHIESTE HTTP verso PostgREST (AC-203-6, EMENDAMENTO P2-D22) ──────
// La grandezza che AC-203-6 nomina e "il numero di RICHIESTE HTTP verso PostgREST", e si
// misura sul TRASPORTO. Il doppio precedente intercettava `from` sul client e contava le
// proprie trap, cioe se stesso: un N+1 VERO instradato per un'altra via — .schema(),
// .rpc(), o il riuso di un builder gia ottenuto — non passa da quella trap. Costruito e
// misurato: `from('sites').select('id')` seguito da una query PER SITO via
// `supabase.schema('public').from('site_generations')` emetteva N+1 round-trip PostgREST
// veri e lasciava la suite tutta VERDE. Contro il contatore qui sotto la stessa mutazione
// e rossa, e lo e sul CONTEGGIO: una richiesta per sito piu una, invece di una.
// Qui il client e REALE (auth reale, RLS attiva) e gli si sostituisce `global.fetch`:
// ogni richiesta a /rest/v1/ finisce nel registro, comunque sia stata costruita, perche
// il trasporto e l'unica strozzatura che nessuna API del client puo aggirare. Le chiamate
// ad /auth/v1/ (getUser) non sono query di tabella e non entrano nel registro: sono O(1)
// in N e conteggiarle confonderebbe la grandezza misurata.
// Il registro tiene gli URL: sono cio che si conta, e sono anche l'unico posto dove il
// parametro `select=` e osservabile per intero (embed compresi) — vedi la sua asserzione.
async function clientMisurato(
  sessioneDi: SupabaseClient,
  registro: string[],
): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (url.includes('/rest/v1/')) registro.push(url);
          return fetch(input, init);
        },
      },
    },
  );
  // La sessione e RIUSATA da un utente gia autenticato: `setSession` non e una nuova
  // signInWithPassword (l'auth locale ha un rate limit su sign-in/sign-up, e un test che
  // lo consuma per misurare le query sarebbe un test che si rompe da solo).
  const { data } = await sessioneDi.auth.getSession();
  const sessione = data.session;
  if (!sessione) throw new Error('sessione assente: il client misurato non sarebbe autenticato');
  const { error } = await client.auth.setSession({
    access_token: sessione.access_token,
    refresh_token: sessione.refresh_token,
  });
  if (error) throw error;
  return client;
}

describe.skipIf(!SB)('T-203 createGeneration/getGeneration/listGenerationStatuses (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t203a_${randomUUID()}@example.test`;
  const emailB = `t203b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;

  // Siti dell'account A. Gli slug hanno DELIBERATAMENTE una relazione di PREFISSO fra
  // loro ('gen-a' e prefisso di 'gen-a-2', 'gen-a-stale', …) e 'gen-a' esiste OMONIMO
  // anche nell'account B (l'unicita di sites e per-account): un filtro che confondesse
  // il prefisso con l'uguaglianza, o che dimenticasse l'ancoraggio all'account, morirebbe
  // qui invece di passare inosservato.
  let sitoS1 = ''; // gen-a            — creazione, doppia creazione, isolamento
  let sitoS2 = ''; // gen-a-2          — controllo negativo di AC-203-4 (altro sito, stesso account)
  let sitoStantio = ''; // gen-a-stale — riga 'generating' oltre il timeout della fase 1
  let sitoRecente = ''; // gen-a-fresh — riga 'generating' RECENTE (controllo negativo: varia solo l'eta)
  let sitoMulti = ''; // gen-a-multi   — DUE generazioni nel tempo (la relazione e 1:N)
  let sitoSceltoStantio = ''; // gen-a-chosen        — 'chosen' senza pagine interne, stantio
  let sitoSceltoConInterne = ''; // gen-a-chosen-inner — 'chosen' CON pagine interne, stantio
  let sitoSceltoRecente = ''; // gen-a-chosen-fresh   — 'chosen' senza pagine interne, recente
  let sitoVergine = ''; // gen-a-vergine — nessuna generazione, mai
  let sitoStantioLista = ''; // gen-a-stale-list — stantio, toccato SOLO dal test della lista
  let sitoStantioCreate = ''; // gen-a-stale-create — stantio, MAI letto da getGeneration
  let sitoB1 = ''; // gen-a nell'account B (omonimo), con una generazione PROPRIA

  // Tutti i siti dell'account A, per l'asserzione di completezza di AC-203-6.
  const sitiDiA: string[] = [];

  let generazioneS1 = '';
  let generazioneStantia = '';
  let generazioneStantiaCreate = '';
  let generazioneMultiVecchia = '';
  let generazioneMultiRecente = '';

  async function creaSito(accountId: string, slug: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function creaSitoA(slug: string): Promise<string> {
    const id = await creaSito(accountAId, slug);
    sitiDiA.push(id);
    return id;
  }

  async function creaGenerazione(opts: {
    accountId: string;
    siteId: string;
    status: StatoGenerazione;
    maxPages: number;
    etaMs: number;
    document?: unknown;
    chosenVariant?: number | null;
  }): Promise<string> {
    const quando = new Date(Date.now() - opts.etaMs).toISOString();
    const { data, error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: opts.accountId,
        site_id: opts.siteId,
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

  async function righeDi(siteId: string) {
    const { data, error } = await adminClient()
      .from('site_generations')
      .select('id, account_id, site_id, status, max_pages, document, chosen_variant, failure_reason, created_at, updated_at')
      .eq('site_id', siteId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
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

    sitoS1 = await creaSitoA('gen-a');
    sitoS2 = await creaSitoA('gen-a-2');
    sitoStantio = await creaSitoA('gen-a-stale');
    sitoRecente = await creaSitoA('gen-a-fresh');
    sitoMulti = await creaSitoA('gen-a-multi');
    sitoSceltoStantio = await creaSitoA('gen-a-chosen');
    sitoSceltoConInterne = await creaSitoA('gen-a-chosen-inner');
    sitoSceltoRecente = await creaSitoA('gen-a-chosen-fresh');
    sitoVergine = await creaSitoA('gen-a-vergine');
    sitoStantioLista = await creaSitoA('gen-a-stale-list');
    sitoStantioCreate = await creaSitoA('gen-a-stale-create');

    // Account B: STESSO slug 'gen-a' (omonimo, legittimo: l'unicita e per-account).
    sitoB1 = await creaSito(accountBId, 'gen-a');

    // Valori DISCORDANTI di proposito (max_pages, status, eta diverse): una fixture
    // uniforme non distingue "ha letto la riga giusta" da "ha letto una riga".
    generazioneStantia = await creaGenerazione({
      accountId: accountAId,
      siteId: sitoStantio,
      status: 'generating',
      maxPages: 10,
      etaMs: ETA_STANTIA,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoRecente,
      status: 'generating',
      maxPages: 2,
      etaMs: ETA_RECENTE,
    });
    // 1:N nel tempo: la piu VECCHIA e 'ready', la piu RECENTE e 'complete'. Chi legge
    // deve riportare la piu recente, e deve farlo in modo deterministico.
    generazioneMultiVecchia = await creaGenerazione({
      accountId: accountAId,
      siteId: sitoMulti,
      status: 'ready',
      maxPages: 5,
      etaMs: 3 * ORA_MS,
    });
    generazioneMultiRecente = await creaGenerazione({
      accountId: accountAId,
      siteId: sitoMulti,
      status: 'complete',
      maxPages: 7,
      etaMs: 2 * ORA_MS,
      document: DOC_CON_PAGINE_INTERNE,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoSceltoStantio,
      status: 'chosen',
      maxPages: 6,
      etaMs: ETA_STANTIA,
      document: DOC_SOLO_HOME,
      chosenVariant: 2,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoSceltoConInterne,
      status: 'chosen',
      maxPages: 9,
      etaMs: ETA_STANTIA,
      document: DOC_CON_PAGINE_INTERNE,
      chosenVariant: 4,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoSceltoRecente,
      status: 'chosen',
      maxPages: 4,
      etaMs: ETA_RECENTE,
      document: DOC_SOLO_HOME,
      chosenVariant: 0,
    });
    await creaGenerazione({
      accountId: accountAId,
      siteId: sitoStantioLista,
      status: 'generating',
      maxPages: 3,
      etaMs: ETA_STANTIA,
    });
    generazioneStantiaCreate = await creaGenerazione({
      accountId: accountAId,
      siteId: sitoStantioCreate,
      status: 'generating',
      maxPages: 1,
      etaMs: ETA_STANTIA,
    });
    // B ha una generazione PROPRIA e visibile: senza, un risultato vuoto per B
    // sembrerebbe isolamento anche se fosse dovuto a tutt'altro.
    await creaGenerazione({
      accountId: accountBId,
      siteId: sitoB1,
      status: 'ready',
      maxPages: 5,
      etaMs: ETA_RECENTE,
    });

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  });

  afterAll(async () => {
    // cascade: auth.users → accounts → sites → site_generations
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // ── DoD 1/4/5: proprieta del MODULO, verificate sulla sorgente ──────────────
  it("il modulo e server-side ('use server'), non usa la service_role, non fa select('*') e non usa .or()/.filter()", () => {
    const sorgente = readFileSync(
      resolve(process.cwd(), 'src/data/generations.ts'),
      'utf8',
    );
    // I divieti si asseriscono sul CODICE, non sulla prosa: il modulo NOMINA le pratiche
    // vietate nei propri commenti di sicurezza, e un controllo sul testo grezzo
    // punirebbe proprio il fatto che siano dichiarate. Lo spoglio e volutamente
    // ingenuo (nessuna stringa di questo modulo contiene '//' o '/*').
    const codice = sorgente
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(sorgente.startsWith("'use server'")).toBe(true);
    // R7: nessun client service_role qui dentro (bypasserebbe la RLS su cui poggia
    // l'intero isolamento di AC-203-2).
    expect(codice).not.toContain('supabase-admin');
    expect(codice).not.toContain('SERVICE_ROLE');
    // A05:2025 — PostgREST filter injection: nessun filtro a stringa libera. `.or` non
    // esiste su Array, quindi qualunque occorrenza sarebbe PostgREST; `.filter` invece
    // si, percio si cerca la sola forma PostgREST (primo argomento = nome di colonna).
    expect(codice).not.toMatch(/\.or\(/);
    expect(codice).not.toMatch(/\.filter\(\s*['"`]/);
    // DoD 4: colonne nominate, mai select('*').
    expect(codice).not.toMatch(/select\(\s*['"`]\*/);
  });

  // covers: AC-203-1
  it("A crea la generazione del proprio sito: riga con account_id=X, site_id=S, status='generating', max_pages=8, document nullo", async () => {
    clientHolder.current = clientA;
    const res = await createGeneration(sitoS1, 8);
    expect(res.ok).toBe(true); // covers: AC-203-1
    if (!res.ok) throw new Error('createGeneration fallita');
    generazioneS1 = res.id;

    const righe = await righeDi(sitoS1);
    expect(righe).toHaveLength(1); // covers: AC-203-1
    expect(righe[0].id).toBe(generazioneS1); // covers: AC-203-1
    expect(righe[0].account_id).toBe(accountAId); // covers: AC-203-1
    expect(righe[0].site_id).toBe(sitoS1); // covers: AC-203-1
    expect(righe[0].status).toBe('generating'); // covers: AC-203-1
    expect(righe[0].max_pages).toBe(8); // covers: AC-203-1
    expect(righe[0].document).toBeNull(); // covers: AC-203-1
    expect(righe[0].chosen_variant).toBeNull(); // covers: AC-203-1
  });

  // covers: AC-203-4
  it("una seconda createGeneration sullo stesso sito e rifiutata (409) e la riga esistente resta invariata", async () => {
    clientHolder.current = clientA;
    const res = await createGeneration(sitoS1, 3);
    expect(res.ok).toBe(false); // covers: AC-203-4
    if (res.ok) throw new Error('la seconda createGeneration non doveva riuscire');
    expect(res.status).toBe(409); // covers: AC-203-4 — errore riconoscibile di generazione in volo

    const righe = await righeDi(sitoS1);
    expect(righe).toHaveLength(1); // covers: AC-203-4 — nessuna riga aggiunta
    expect(righe[0].id).toBe(generazioneS1); // covers: AC-203-4 — id inalterato
    expect(righe[0].status).toBe('generating'); // covers: AC-203-4 — status inalterato
    expect(righe[0].max_pages).toBe(8); // covers: AC-203-4 — il 3 della seconda chiamata non e entrato
  });

  // covers: AC-203-4
  // Controllo negativo che differisce per UNA sola variabile (il sito): se il rifiuto
  // fosse "una generazione in volo per ACCOUNT" invece che "per SITO", questo morirebbe.
  it('la stessa A crea una generazione su un ALTRO sito dello stesso account: riesce', async () => {
    clientHolder.current = clientA;
    const res = await createGeneration(sitoS2, 5);
    expect(res.ok).toBe(true); // covers: AC-203-4
    if (!res.ok) throw new Error('createGeneration sul secondo sito doveva riuscire');

    const righe = await righeDi(sitoS2);
    expect(righe).toHaveLength(1); // covers: AC-203-4
    expect(righe[0].status).toBe('generating'); // covers: AC-203-4
    expect(righe[0].max_pages).toBe(5); // covers: AC-203-4
    // E la generazione di S1 non e stata toccata da questa creazione.
    const righeS1 = await righeDi(sitoS1);
    expect(righeS1).toHaveLength(1); // covers: AC-203-4
    expect(righeS1[0].id).toBe(generazioneS1); // covers: AC-203-4
  });

  // covers: AC-203-2
  it('A legge la propria generazione; B (altro account) ottiene null; B vede pero la PROPRIA', async () => {
    clientHolder.current = clientA;
    const propria = await getGeneration(sitoS1);
    expect(propria.ok).toBe(true); // covers: AC-203-2
    if (!propria.ok) throw new Error('getGeneration (A) fallita');
    expect(propria.generation?.id).toBe(generazioneS1); // covers: AC-203-2
    expect(propria.generation?.site_id).toBe(sitoS1); // covers: AC-203-2
    expect(propria.generation?.status).toBe('generating'); // covers: AC-203-2
    expect(propria.generation?.max_pages).toBe(8); // covers: AC-203-2

    clientHolder.current = clientB;
    const altrui = await getGeneration(sitoS1);
    expect(altrui.ok).toBe(true); // covers: AC-203-2 — nessun errore, insieme vuoto
    if (!altrui.ok) throw new Error('getGeneration (B) fallita');
    expect(altrui.generation).toBeNull(); // covers: AC-203-2 — la RLS isola per tenant

    // B ha una generazione PROPRIA e la vede: il null qui sopra e isolamento, non un
    // risultato vuoto per qualunque altra ragione.
    const propriaB = await getGeneration(sitoB1);
    expect(propriaB.ok).toBe(true); // covers: AC-203-2
    if (!propriaB.ok) throw new Error('getGeneration (B sul proprio sito) fallita');
    expect(propriaB.generation?.site_id).toBe(sitoB1); // covers: AC-203-2
    expect(propriaB.generation?.status).toBe('ready'); // covers: AC-203-2
  });

  // covers: AC-203-2
  it('B non puo creare una generazione sul sito di A: rifiutata (404) e nessuna riga scritta', async () => {
    clientHolder.current = clientB;
    const res = await createGeneration(sitoS2, 5);
    expect(res.ok).toBe(false); // covers: AC-203-2
    if (res.ok) throw new Error('createGeneration cross-tenant non doveva riuscire');
    expect(res.status).toBe(404); // covers: AC-203-2 — B non vede il sito di A

    const righe = await righeDi(sitoS2);
    expect(righe).toHaveLength(1); // covers: AC-203-2 — nessuna riga di B sul sito di A
    expect(righe[0].account_id).toBe(accountAId); // covers: AC-203-2
  });

  // covers: AC-203-5
  it("una riga 'generating' stantia e riportata 'failed', NON e cancellata, e la riga 'generating' RECENTE non lo e", async () => {
    clientHolder.current = clientA;
    const stantia = await getGeneration(sitoStantio);
    expect(stantia.ok).toBe(true); // covers: AC-203-5
    if (!stantia.ok) throw new Error('getGeneration (sito stantio) fallita');
    expect(stantia.generation?.id).toBe(generazioneStantia); // covers: AC-203-5
    expect(stantia.generation?.status).toBe('failed'); // covers: AC-203-5

    // La riga NON e stata cancellata: stesso id, stesso max_pages, created_at intatto.
    const righe = await righeDi(sitoStantio);
    expect(righe).toHaveLength(1); // covers: AC-203-5 — nessuna cancellazione
    expect(righe[0].id).toBe(generazioneStantia); // covers: AC-203-5
    expect(righe[0].max_pages).toBe(10); // covers: AC-203-5
    // …e lo stato 'failed' e PERSISTITO: e l'unico modo di liberare l'indice UNIQUE
    // parziale, cioe di rendere vera la seconda meta di questo AC.
    expect(righe[0].status).toBe('failed'); // covers: AC-203-5
    expect(righe[0].failure_reason).not.toBeNull(); // covers: AC-203-5

    // Controllo negativo: l'UNICA variabile e l'eta. Una 'generating' recente resta tale.
    const recente = await getGeneration(sitoRecente);
    expect(recente.ok).toBe(true); // covers: AC-203-5
    if (!recente.ok) throw new Error('getGeneration (sito recente) fallita');
    expect(recente.generation?.status).toBe('generating'); // covers: AC-203-5
    const righeRecenti = await righeDi(sitoRecente);
    expect(righeRecenti[0].status).toBe('generating'); // covers: AC-203-5 — non riconciliata
  });

  // covers: AC-203-5
  it('dopo la riconciliazione una nuova createGeneration sullo stesso sito RIESCE, e getGeneration riporta la piu RECENTE', async () => {
    clientHolder.current = clientA;
    const res = await createGeneration(sitoStantio, 4);
    expect(res.ok).toBe(true); // covers: AC-203-5
    if (!res.ok) throw new Error('createGeneration dopo la riconciliazione doveva riuscire');
    expect(res.id).not.toBe(generazioneStantia); // covers: AC-203-5 — e una riga NUOVA

    // Due righe: la stantia (conservata) e la nuova.
    const righe = await righeDi(sitoStantio);
    expect(righe).toHaveLength(2); // covers: AC-203-5 — la stantia non e stata cancellata
    expect(righe.map((r) => r.id)).toContain(generazioneStantia); // covers: AC-203-5

    // getGeneration legge la piu RECENTE, in modo deterministico.
    const dopo = await getGeneration(sitoStantio);
    expect(dopo.ok).toBe(true); // covers: AC-203-5
    if (!dopo.ok) throw new Error('getGeneration post-ricreazione fallita');
    expect(dopo.generation?.id).toBe(res.id); // covers: AC-203-5
    expect(dopo.generation?.status).toBe('generating'); // covers: AC-203-5
    expect(dopo.generation?.max_pages).toBe(4); // covers: AC-203-5
  });

  // covers: AC-203-5
  // Il sito NON deve dipendere dal fatto che qualcuno abbia letto prima: se l'unica via
  // per sbloccarlo fosse getGeneration, un chiamante che va dritto alla creazione
  // troverebbe il sito bloccato per sempre. Qui getGeneration non e MAI stata chiamata su
  // questo sito.
  it('createGeneration su un sito con una riga stantia mai letta: riesce, e la stantia e riportata failed senza essere cancellata', async () => {
    clientHolder.current = clientA;
    const res = await createGeneration(sitoStantioCreate, 9);
    expect(res.ok).toBe(true); // covers: AC-203-5
    if (!res.ok) throw new Error('createGeneration sul sito stantio doveva riuscire');

    const righe = await righeDi(sitoStantioCreate);
    expect(righe).toHaveLength(2); // covers: AC-203-5 — la stantia e conservata
    const stantia = righe.find((r) => r.id === generazioneStantiaCreate);
    expect(stantia?.status).toBe('failed'); // covers: AC-203-5
    expect(stantia?.max_pages).toBe(1); // covers: AC-203-5 — la riga non e stata riscritta altrove
    const nuova = righe.find((r) => r.id === res.id);
    expect(nuova?.status).toBe('generating'); // covers: AC-203-5
    expect(nuova?.max_pages).toBe(9); // covers: AC-203-5
  });

  // covers: AC-203-5
  // La relazione col sito e 1:N nel tempo: con DUE generazioni e nessuna riconciliazione
  // di mezzo, la lettura deve essere deterministica sulla piu recente.
  it('con due generazioni nel tempo, getGeneration riporta la piu recente (non la piu vecchia)', async () => {
    clientHolder.current = clientA;
    const res = await getGeneration(sitoMulti);
    expect(res.ok).toBe(true); // covers: AC-203-5
    if (!res.ok) throw new Error('getGeneration (sito multi) fallita');
    expect(res.generation?.id).toBe(generazioneMultiRecente); // covers: AC-203-5
    expect(res.generation?.id).not.toBe(generazioneMultiVecchia); // covers: AC-203-5
    expect(res.generation?.status).toBe('complete'); // covers: AC-203-5
    expect(res.generation?.max_pages).toBe(7); // covers: AC-203-5
  });

  // covers: AC-203-5
  // Seconda meta di P2-D15: la fase 2. Le tre righe differiscono per UNA variabile alla
  // volta (pagine interne si/no a parita di eta; eta a parita di documento).
  it("una riga 'chosen' stantia SENZA pagine interne e riportata 'failed'; con pagine interne, o recente, resta 'chosen'", async () => {
    clientHolder.current = clientA;

    const stantiaSenzaInterne = await getGeneration(sitoSceltoStantio);
    expect(stantiaSenzaInterne.ok).toBe(true); // covers: AC-203-5
    if (!stantiaSenzaInterne.ok) throw new Error('getGeneration (chosen stantio) fallita');
    expect(stantiaSenzaInterne.generation?.status).toBe('failed'); // covers: AC-203-5

    // Variabile cambiata: il documento HA pagine interne (stessa eta).
    const stantiaConInterne = await getGeneration(sitoSceltoConInterne);
    expect(stantiaConInterne.ok).toBe(true); // covers: AC-203-5
    if (!stantiaConInterne.ok) throw new Error('getGeneration (chosen con interne) fallita');
    expect(stantiaConInterne.generation?.status).toBe('chosen'); // covers: AC-203-5

    // Variabile cambiata: l'eta (stesso documento senza pagine interne).
    const recenteSenzaInterne = await getGeneration(sitoSceltoRecente);
    expect(recenteSenzaInterne.ok).toBe(true); // covers: AC-203-5
    if (!recenteSenzaInterne.ok) throw new Error('getGeneration (chosen recente) fallita');
    expect(recenteSenzaInterne.generation?.status).toBe('chosen'); // covers: AC-203-5

    // Oracolo service_role: solo la prima e stata riscritta; le altre due sono intatte.
    expect((await righeDi(sitoSceltoStantio))[0].status).toBe('failed'); // covers: AC-203-5
    expect((await righeDi(sitoSceltoConInterne))[0].status).toBe('chosen'); // covers: AC-203-5
    expect((await righeDi(sitoSceltoRecente))[0].status).toBe('chosen'); // covers: AC-203-5
    // Il documento congelato sopravvive alla riconciliazione: e riportato failed, non svuotato.
    expect((await righeDi(sitoSceltoStantio))[0].document).not.toBeNull(); // covers: AC-203-5
  });

  // covers: AC-203-3
  it('senza sessione autenticata: create/get/listStatuses falliscono con 401 e nessuna riga e scritta o restituita', async () => {
    clientHolder.current = anon;

    const create = await createGeneration(sitoVergine, 6);
    expect(create.ok).toBe(false); // covers: AC-203-3
    if (create.ok) throw new Error('createGeneration senza sessione non doveva riuscire');
    expect(create.status).toBe(401); // covers: AC-203-3

    const get = await getGeneration(sitoS1);
    expect(get.ok).toBe(false); // covers: AC-203-3
    if (get.ok) throw new Error('getGeneration senza sessione non doveva riuscire');
    expect(get.status).toBe(401); // covers: AC-203-3

    const lista = await listGenerationStatuses();
    expect(lista.ok).toBe(false); // covers: AC-203-3
    if (lista.ok) throw new Error('listGenerationStatuses senza sessione non doveva riuscire');
    expect(lista.status).toBe(401); // covers: AC-203-3

    // Nessuna riga scritta sul sito vergine, e la generazione di S1 e intatta.
    expect(await righeDi(sitoVergine)).toHaveLength(0); // covers: AC-203-3
    const righeS1 = await righeDi(sitoS1);
    expect(righeS1).toHaveLength(1); // covers: AC-203-3
    expect(righeS1[0].id).toBe(generazioneS1); // covers: AC-203-3
  });

  // Irrobustimento (A05:2025): maxPages e input del client e va validato server-side.
  it('createGeneration con maxPages fuori scala e rifiutata (400) e non scrive nulla', async () => {
    clientHolder.current = clientA;
    for (const fuoriScala of [0, -1, 11, 1.5, Number.NaN]) {
      const res = await createGeneration(sitoVergine, fuoriScala);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error(`maxPages=${fuoriScala} non doveva essere accettato`);
      expect(res.status).toBe(400);
    }
    expect(await righeDi(sitoVergine)).toHaveLength(0);
  });

  // covers: AC-203-6
  it('listGenerationStatuses: UNA sola richiesta HTTP a PostgREST, e resta UNA al crescere di N', async () => {
    const registro: string[] = [];
    clientHolder.current = await clientMisurato(clientA, registro);

    registro.length = 0; // la costruzione del client (setSession) non e materia della misura
    const primaMisura = await listGenerationStatuses();
    expect(primaMisura.ok).toBe(true); // covers: AC-203-6
    if (!primaMisura.ok) throw new Error('listGenerationStatuses fallita');
    expect(registro).toHaveLength(1); // covers: AC-203-6 — una sola richiesta a PostgREST
    const nIniziale = primaMisura.statuses.length;
    expect(nIniziale).toBe(sitiDiA.length); // covers: AC-203-6

    // La FORMA della richiesta realmente emessa, non il testo del sorgente. Il `select=`
    // non deve contenere alcun `*`: un wildcard sulla risorsa EMBEDDED
    // (`id, site_generations(*)`) sfugge a qualunque regex ancorata all'INIZIO
    // dell'argomento, ed e stato costruito lasciando la suite verde. E non deve nominare
    // `document`: la lista e un report di stato e trascinare N documenti jsonb sarebbe
    // esattamente il costo che l'unica-richiesta doveva risparmiare.
    const select = new URL(registro[0]).searchParams.get('select');
    expect(select).not.toBeNull(); // covers: AC-203-6
    expect(select).not.toContain('*'); // covers: AC-203-6
    expect(select).not.toContain('document'); // covers: AC-203-6

    // N cresce: due siti in piu, ciascuno con la propria generazione.
    const nuovi = [await creaSitoA('gen-a-piu-1'), await creaSitoA('gen-a-piu-2')];
    for (const sito of nuovi) {
      await creaGenerazione({
        accountId: accountAId,
        siteId: sito,
        status: 'ready',
        maxPages: 6,
        etaMs: ETA_RECENTE,
      });
    }

    registro.length = 0;
    const secondaMisura = await listGenerationStatuses();
    expect(secondaMisura.ok).toBe(true); // covers: AC-203-6
    if (!secondaMisura.ok) throw new Error('listGenerationStatuses (N maggiore) fallita');
    // La prova dell'assenza di N+1 non e il valore assoluto ma il fatto che NON CRESCA:
    // due N diversi, lo stesso numero di richieste.
    expect(registro).toHaveLength(1); // covers: AC-203-6
    expect(secondaMisura.statuses.length).toBe(nIniziale + nuovi.length); // covers: AC-203-6

    // Il risultato contiene TUTTI e SOLI i siti dell'account A.
    const siteIdRestituiti = secondaMisura.statuses.map((s) => s.site_id).sort();
    expect(siteIdRestituiti).toEqual([...sitiDiA].sort()); // covers: AC-203-6
    expect(siteIdRestituiti).not.toContain(sitoB1); // covers: AC-203-6 — la RLS isola per tenant

    const statoDi = (siteId: string) =>
      secondaMisura.statuses.find((s) => s.site_id === siteId)?.status;

    // Lo stato di CIASCUN sito, su fixture discordanti.
    expect(statoDi(sitoMulti)).toBe('complete'); // covers: AC-203-6 — la piu recente delle due
    expect(statoDi(sitoRecente)).toBe('generating'); // covers: AC-203-6
    expect(statoDi(sitoSceltoConInterne)).toBe('chosen'); // covers: AC-203-6
    expect(statoDi(nuovi[0])).toBe('ready'); // covers: AC-203-6
    expect(statoDi(nuovi[1])).toBe('ready'); // covers: AC-203-6
    // Un sito mai generato compare con stato nullo: la lista dice lo stato di TUTTI i
    // siti dell'account, non solo di quelli che hanno una generazione.
    expect(statoDi(sitoVergine)).toBeNull(); // covers: AC-203-6
    // Una riga stantia e riportata 'failed' anche dalla lista…
    expect(statoDi(sitoStantioLista)).toBe('failed'); // covers: AC-203-6
    // …ma la lista NON scrive: la riga in tabella e ancora 'generating'. E' un report,
    // non la lettura autorevole che libera l'indice (quella e getGeneration).
    expect((await righeDi(sitoStantioLista))[0].status).toBe('generating'); // covers: AC-203-6
  });
});

// ── AC-203-7: l'invariante dei timeout (test PURO, nessun DB) ────────────────────────
// Fuori dal describe di sopra di proposito: non tocca Supabase e deve valere anche dove
// il DB locale non c'e. Pinna la RELAZIONE, mai i numeri — i valori sono stime dichiarate
// (P2-D17) e la misura vera arrivera da T-225, quindi asserirli renderebbe rosso un
// aggiornamento legittimo e non direbbe nulla su cio che conta.
// Cio che conta: un timeout SOTTO la vita massima della richiesta libererebbe l'indice
// UNIQUE parziale mentre la generazione che possiede la riga e ancora viva, autorizzando
// un secondo scrittore — cioe proprio cio che quell'indice esiste per rendere
// impossibile. Prima dell'EMENDAMENTO P2-D22 questi numeri erano un `const` locale in un
// modulo 'use server' (che puo esportare solo funzioni async): nessun test poteva
// leggerli, e infatti portarli entrambi a un minuto, o scambiarli, lasciava questa suite
// tutta verde.
describe('T-203 — invariante dei timeout di riconciliazione (dominio puro)', () => {
  // covers: AC-203-7
  it('ogni timeout sta SOPRA il tetto di durata della richiesta, e la fase 2 sopra la fase 1', () => {
    const tetto = GENERATION_TIMEOUTS.max_request_lifetime;
    const fasi = Object.entries(GENERATION_TIMEOUTS.phases);

    // Senza questa, un `phases` svuotato renderebbe VACUA la clausola "ogni timeout" del
    // ciclo qui sotto: zero iterazioni, zero asserzioni, verde.
    expect(fasi.length).toBeGreaterThan(0); // covers: AC-203-7

    for (const [fase, timeout] of fasi) {
      expect(timeout, `il timeout della ${fase} deve stare sopra max_request_lifetime`)
        .toBeGreaterThan(tetto); // covers: AC-203-7
    }

    // La fase 2 sono piu chiamate in fila dopo la scelta della variante: il suo timeout
    // non puo essere minore o uguale a quello della singola chiamata della fase 1.
    expect(GENERATION_TIMEOUTS.phases.phase2).toBeGreaterThan(
      GENERATION_TIMEOUTS.phases.phase1,
    ); // covers: AC-203-7
  });
});
