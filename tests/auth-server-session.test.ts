import { describe, it, expect, vi, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createTestUser, deleteTestUser } from './helpers/supabase-test';

// T-041 — getUser() reale: sessione server-side VALIDATA.
// getUser() legge i cookie via next/headers: qui mockiamo SOLO il TRASPORTO dei
// cookie (next/headers), MAI la validazione del token. Un in-memory store simula
// il cookie store della request; getUser() costruisce un client SSR reale che
// invia il JWT all'auth server locale (supabase.auth.getUser(), non getSession).
// La validazione del JWT è quindi REALE — non un mock hollow.
const { cookieState } = vi.hoisted(() => ({
  cookieState: {
    store: new Map<string, string>(),
    // MODIFICA MINIMA AL MOCK, dichiarata: il cookie store finto registrava solo
    // nome e valore — la sua firma non accettava nemmeno il TERZO argomento. E'
    // esattamente per questo che nessun test poteva accorgersi se l'adapter
    // smettesse di propagare httpOnly / Secure / SameSite: il caso era esercitato
    // e mai osservabile. Qui il terzo argomento viene accettato e REGISTRATO.
    // Nessun test esistente cambia comportamento: `store` continua a ricevere
    // nome e valore come prima.
    sets: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      [...cookieState.store.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = cookieState.store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      cookieState.sets.push({ name, value, options });
      cookieState.store.set(name, value);
    },
    delete: (name: string) => {
      cookieState.store.delete(name);
    },
  }),
}));

// Import DOPO il mock (vi.mock è hoisted): getUser() risolverà next/headers al mock.
import { getUser } from '@/data/supabase-ssr';

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

describe.skipIf(!SB)('T-041 getUser() server-side (runtime, Supabase locale)', () => {
  let userId = '';
  const email = `t041_${randomUUID()}@example.test`;
  const password = 'Password123!';

  afterAll(async () => {
    cookieState.store.clear();
    if (userId) await deleteTestUser(userId);
  });

  it('senza sessione (cookie vuoti) getUser() ritorna null senza sollevare eccezioni', async () => {
    // given: contesto server privo di sessione; when: getUser()
    cookieState.store.clear();
    // then: null, nessuna eccezione (la Promise risolve, non rigetta)
    await expect(getUser()).resolves.toBeNull(); // covers: AC-041-3
  });

  it('con sessione reale valida getUser() ritorna lo user con id atteso (JWT validato lato server)', async () => {
    // given: un utente reale con sessione autenticata valida
    const user = await createTestUser(email, password);
    userId = user.id;

    // Login REALE con un client SSR "writer" che scrive nel medesimo store i
    // cookie di sessione realmente emessi dall'auth server locale.
    cookieState.store.clear();
    const writer = createServerClient(supabaseUrl(), anonKey(), {
      cookies: {
        getAll: () =>
          [...cookieState.store.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const c of list) cookieState.store.set(c.name, c.value);
        },
      },
    });
    const { error } = await writer.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    expect(cookieState.store.size).toBeGreaterThan(0);

    // when: getUser() legge quei cookie (via next/headers mockato) e RIVALIDA il
    // JWT contro l'auth server locale.
    const validated = await getUser();

    // then: ritorna lo user con id === id atteso (validazione reale del token).
    expect(validated).not.toBeNull(); // covers: AC-041-4
    expect(validated?.id).toBe(userId); // covers: AC-041-4
  });
});

// ---------------------------------------------------------------------------
// T-041 — le PROPRIETA di sicurezza della sessione, non l'esito nel caso nominale.
//
// I due test qui sopra asseriscono l'ESITO: null senza sessione, lo user giusto
// con una sessione reale. Nessuno dei due si accorge (a) se l'identita venisse
// letta con getSession() invece che con getUser(), ne (b) se l'adapter dei cookie
// smettesse di propagare gli attributi di sicurezza: entrambe le mutazioni oggi
// lasciano la suite verde, ed entrambe sono la differenza fra una sessione che
// tiene e una che non tiene. Qui non c'e la RLS a fare da seconda linea.
//
// Il doppio di @supabase/ssr e installato con vi.doMock + vi.resetModules e un
// import DINAMICO del modulo sotto test: il describe reale qui sopra continua a
// usare il vero @supabase/ssr e la vera validazione del JWT contro l'auth server
// locale. Nessun test esistente viene indebolito.
type CookieDaScrivere = { name: string; value: string; options?: Record<string, unknown> };
type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookiesToSet: CookieDaScrivere[]) => void;
};
type CostruzioneSsr = { url: string; key: string; options: { cookies: CookieAdapter } };

const ID_DOPPIO = 'utente-del-doppio';

// Doppio che espone ENTRAMBI i metodi di auth: e la sola forma in cui "getSession
// non e stata invocata" e un'affermazione con contenuto. Se il doppio esponesse
// solo getUser, la mutazione a getSession darebbe un TypeError e il test sarebbe
// rosso per il motivo sbagliato.
function ssrDouble() {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: { id: ID_DOPPIO } }, error: null })),
    getSession: vi.fn(async () => ({
      data: { session: { user: { id: ID_DOPPIO } } },
      error: null,
    })),
  };
  const calls: CostruzioneSsr[] = [];
  return {
    auth,
    calls,
    createServerClient: (url: string, key: string, options: { cookies: CookieAdapter }) => {
      calls.push({ url, key, options });
      return { auth };
    },
  };
}

async function caricaSsrCon(double: ReturnType<typeof ssrDouble>) {
  vi.resetModules();
  vi.doMock('@supabase/ssr', () => ({ createServerClient: double.createServerClient }));
  return import('@/data/supabase-ssr');
}

describe('T-041 proprieta della sessione server-side (doppio di @supabase/ssr)', () => {
  beforeEach(() => {
    cookieState.sets.length = 0;
    // Le sentinelle rendono i test indipendenti dalla presenza di .env.local:
    // senza queste, ssrEnv() lancerebbe, getUser() catturerebbe e ritornerebbe
    // null, e le asserzioni sulle spie sarebbero rosse per il motivo sbagliato.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sentinella.supabase.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'CHIAVE-ANON-SENTINELLA');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@supabase/ssr');
    vi.resetModules();
  });

  // MUTAZIONE CHE LO RENDE ROSSO: in src/data/supabase-ssr.ts, dentro getUser(),
  // `supabase.auth.getUser()` -> `supabase.auth.getSession()` (leggendo
  // `data.session?.user`). Lato server la differenza non e stilistica:
  // getSession() decodifica il JWT che sta nel cookie e si fida di cio che vi
  // legge, senza interpellare l'auth server — un token gia revocato, o scaduto,
  // o firmato altrove passerebbe. getUser() rivalida il token contro l'auth
  // server, ed e per questo che AC-041-4 nomina il metodo.
  // covers: AC-041-4
  it('getUser() ricava l identita RIVALIDANDO il token con auth.getUser(), e non invoca mai auth.getSession()', async () => {
    const double = ssrDouble();
    const { getUser } = await caricaSsrCon(double);

    const user = await getUser();

    // Anti-vacuita: il percorso e stato davvero percorso fino in fondo.
    expect(user?.id).toBe(ID_DOPPIO); // covers: AC-041-4
    expect(double.auth.getUser).toHaveBeenCalledTimes(1); // covers: AC-041-4
    // La proprieta: l'identita NON viene dal cookie creduto sulla parola.
    expect(double.auth.getSession).not.toHaveBeenCalled(); // covers: AC-041-4
  });

  // MUTAZIONE CHE LO RENDE ROSSO: la stessa sostituzione dentro
  // getUserFromRequest(). E il punto d'ingresso del MIDDLEWARE: se qui l'identita
  // si fidasse del cookie, la guardia di route lascerebbe passare chiunque
  // presenti un cookie di sessione non piu valido — e in quel contesto non c'e
  // alcuna RLS dietro a rifiutare la richiesta.
  // Oltre AC-041-4 (che parla di getUser()): la stessa proprieta sull'altro
  // punto d'ingresso del modulo, quello su cui poggia AC-041-1/2.
  it('anche getUserFromRequest() (middleware) usa auth.getUser(): auth.getSession() non viene mai invocata', async () => {
    const double = ssrDouble();
    const { getUserFromRequest } = await caricaSsrCon(double);
    const request = { cookies: { getAll: () => [{ name: 'sb-access-token', value: 'AAA' }] } };

    const user = await getUserFromRequest(
      request as unknown as Parameters<typeof getUserFromRequest>[0],
    );

    expect(user?.id).toBe(ID_DOPPIO);
    expect(double.auth.getUser).toHaveBeenCalledTimes(1);
    expect(double.auth.getSession).not.toHaveBeenCalled();
  });

  // MUTAZIONE CHE LO RENDE ROSSO: in src/data/supabase-ssr.ts, dentro setAll,
  // `cookieStore.set(name, value, options)` -> `cookieStore.set(name, value)`
  // (oppure togliere `options` dalla destrutturazione). Con quella riga ogni
  // cookie di sessione perde httpOnly, Secure e SameSite: diventa leggibile da
  // document.cookie — quindi esfiltrabile da un XSS — e viaggia anche in chiaro e
  // cross-site. E la differenza fra una sessione rubabile e una che non lo e.
  // La proprieta pinnata e "l'adapter non scarta nulla", NON quali attributi
  // siano: le opzioni le detta @supabase/ssr, non questo modulo.
  // Oltre gli AC di T-041 (nessuno parla degli attributi dei cookie): pinna la
  // DoD "client SSR con lettura/scrittura cookie" nel suo senso sicuro.
  it('l adapter dei cookie non scarta gli attributi: le opzioni arrivano INTATTE al cookie store', async () => {
    const double = ssrDouble();
    const { createServerSupabaseClient } = await caricaSsrCon(double);

    await createServerSupabaseClient();

    // Anti-vacuita: il client e stato costruito e ha davvero consegnato un adapter.
    expect(double.calls.length).toBe(1);
    const adapter = double.calls[0].options.cookies;

    // Il setAll e guidato dal test con opzioni note (quelle che @supabase/ssr
    // emette per i cookie di sessione): cosi la perdita e osservabile senza
    // dipendere da cosa produce la libreria in questo scenario.
    const opzioniAccess = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    };
    const opzioniRefresh = {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    };
    adapter.setAll([
      { name: 'sb-access-token', value: 'AAA', options: opzioniAccess },
      { name: 'sb-refresh-token', value: 'RRR', options: opzioniRefresh },
    ]);

    // Nessun cookie perso per strada e nessuna opzione persa: propagazione integrale.
    expect(cookieState.sets).toEqual([
      { name: 'sb-access-token', value: 'AAA', options: opzioniAccess },
      { name: 'sb-refresh-token', value: 'RRR', options: opzioniRefresh },
    ]);
    // E, detti per nome, i tre attributi che fanno la differenza.
    for (const registrato of cookieState.sets) {
      expect(registrato.options?.httpOnly, registrato.name).toBe(true);
      expect(registrato.options?.secure, registrato.name).toBe(true);
      expect(registrato.options?.sameSite, registrato.name).toBeDefined();
    }
  });
});
