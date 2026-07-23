import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// T-044 — Route handler GET /{locale}/auth/callback (scambio code -> sessione).
//
// Cosa mockiamo e perché NON è hollow:
//  - next/headers: solo il TRASPORTO dei cookie (in-memory store). È il canale
//    reale con cui un route handler imposta i cookie sulla response, quindi
//    verificarne il contenuto prova davvero "cookie di sessione impostati".
//  - @supabase/ssr → createServerClient: NON mockiamo il modulo SSR dell'app.
//    Lasciamo girare il VERO createServerSupabaseClient (anon key + adapter cookie,
//    R7). Avvolgiamo solo exchangeCodeForSession con uno spy che (a) registra il
//    code ricevuto e (b) simula ciò che fa @supabase/ssr al successo: persiste la
//    sessione scrivendo un cookie ATTRAVERSO l'adapter cookie reale del client.
//    Così il cablaggio cookie del client SSR è autentico; solo la rete verso
//    l'auth server è simulata. Il code errato/assente non entra mai nello spy →
//    i due rami (sessione vs nessuna sessione) restano distinguibili.
const { cookieState, exchange, SESSION_COOKIE } = vi.hoisted(() => ({
  cookieState: { store: new Map<string, string>() },
  exchange: { codes: [] as string[] },
  SESSION_COOKIE: 'sb-belora-auth-token',
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () =>
      [...cookieState.store.entries()].map(([name, value]) => ({ name, value })),
    get: (name: string) => {
      const value = cookieState.store.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieState.store.set(name, value);
    },
    delete: (name: string) => {
      cookieState.store.delete(name);
    },
  }),
}));

vi.mock('@supabase/ssr', async (importActual) => {
  const actual = await importActual<typeof import('@supabase/ssr')>();
  return {
    ...actual,
    createServerClient: (...args: Parameters<typeof actual.createServerClient>) => {
      const client = actual.createServerClient(...args);
      // Adapter cookie REALE iniettato da createServerSupabaseClient (getAll/setAll
      // instradati su next/headers). exchangeCodeForSession al successo persiste la
      // sessione proprio tramite questo adapter: lo usiamo per essere fedeli. Il
      // tipo del terzo argomento è un'unione di adapter (server/deprecated): lo
      // restringiamo alla forma setAll usata dal client SSR dell'app.
      const cookieAdapter = args[2]?.cookies as
        | {
            setAll?: (
              list: { name: string; value: string; options: object }[],
            ) => void;
          }
        | undefined;
      const success = {
        data: {
          user: { id: 'oauth-user' },
          session: { access_token: 'access', refresh_token: 'refresh' },
        },
        error: null,
      } as unknown as Awaited<
        ReturnType<SupabaseClient['auth']['exchangeCodeForSession']>
      >;
      const impl = async (authCode: string) => {
        exchange.codes.push(authCode);
        cookieAdapter?.setAll?.([
          { name: SESSION_COOKIE, value: `session-for-${authCode}`, options: {} },
        ]);
        return success;
      };
      vi.spyOn(client.auth, 'exchangeCodeForSession').mockImplementation(
        impl as unknown as typeof client.auth.exchangeCodeForSession,
      );
      return client;
    },
  };
});

// Import DOPO i mock (vi.mock è hoisted): il handler risolverà @supabase/ssr e
// next/headers ai mock.
import { GET } from '@/app/[locale]/auth/callback/route';

const run = (path: string, locale = 'it') =>
  GET(new NextRequest(new URL(path, 'http://localhost')), {
    params: Promise.resolve({ locale }),
  });

describe('T-044 route handler /{locale}/auth/callback', () => {
  beforeEach(() => {
    cookieState.store.clear();
    exchange.codes.length = 0;
  });

  it('AC-044-1: code valido + next interno → exchange col code, cookie di sessione impostati, redirect 307 a /it/dashboard', async () => {
    // given: GET con ?code valido e ?next path relativo interno
    // when: il handler elabora la richiesta
    const res = await run('/it/auth/callback?code=valid-code&next=/it/dashboard');

    // then: exchangeCodeForSession invocato ESATTAMENTE col code ricevuto
    expect(exchange.codes).toEqual(['valid-code']); // covers: AC-044-1
    // then: i cookie di sessione risultano impostati (persistiti dall'adapter SSR)
    expect(cookieState.store.get(SESSION_COOKIE)).toBe('session-for-valid-code'); // covers: AC-044-1
    // then: redirect 307 verso la destinazione next (same-origin)
    expect(res.status).toBe(307); // covers: AC-044-1
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    const dest = new URL(location as string);
    expect(dest.pathname).toBe('/it/dashboard'); // covers: AC-044-1
    expect(dest.host).toBe('localhost'); // covers: AC-044-1
  });

  it('AC-044-2: nessun code → exchange NON chiamato, nessun cookie, redirect 307 a /it/login con errore', async () => {
    // given: GET senza parametro code
    // when: il handler elabora la richiesta
    const res = await run('/it/auth/callback');

    // then: exchangeCodeForSession NON invocato e nessun cookie di sessione
    expect(exchange.codes).toEqual([]); // covers: AC-044-2
    expect(cookieState.store.size).toBe(0); // covers: AC-044-2
    // then: redirect 307 verso /it/login con un parametro di errore
    expect(res.status).toBe(307); // covers: AC-044-2
    const dest = new URL(res.headers.get('location') as string);
    expect(dest.pathname).toBe('/it/login'); // covers: AC-044-2
    expect(dest.searchParams.get('error')).not.toBeNull(); // covers: AC-044-2
  });

  it('AC-044-2: ?error=access_denied → exchange NON chiamato, nessun cookie, redirect a /it/login', async () => {
    // given: l'auth server ha restituito un errore (nessun code utile)
    // when: il handler elabora la richiesta
    const res = await run('/it/auth/callback?error=access_denied');

    // then: nessuno scambio, nessuna sessione, redirect al login con errore
    expect(exchange.codes).toEqual([]); // covers: AC-044-2
    expect(cookieState.store.size).toBe(0); // covers: AC-044-2
    const dest = new URL(res.headers.get('location') as string);
    expect(dest.pathname).toBe('/it/login'); // covers: AC-044-2
    expect(dest.searchParams.get('error')).not.toBeNull(); // covers: AC-044-2
  });

  it('AC-044-3: next esterno/assoluto o con control-char smuggling → destinazione RIFIUTATA, redirect al default sicuro /it/dashboard, mai evil.example.com', async () => {
    // Asserzione condivisa: per un dato valore GREZZO del query param `next`
    // (iniettato COSÌ COM'È nella query, già percent-encoded dove serve — è
    // esattamente ciò che searchParams.get('next') decodifica dentro il handler),
    // la sessione si stabilisce col code valido MA la destinazione finale del
    // redirect resta same-origin (host localhost) e ricade sul default sicuro
    // /it/dashboard, mai su evil.example.com. Ispezioniamo l'header Location reale.
    const expectSafeFallback = async (rawNext: string) => {
      cookieState.store.clear();
      exchange.codes.length = 0;
      // when: il handler calcola la destinazione del redirect
      const res = await run(`/it/auth/callback?code=valid-code&next=${rawNext}`);

      // then: la sessione è comunque stabilita col code valido…
      expect(exchange.codes).toEqual(['valid-code']); // covers: AC-044-3
      // …ma la destinazione è rifiutata verso il default sicuro same-origin
      const location = res.headers.get('location') as string;
      const dest = new URL(location);
      expect(dest.host).toBe('localhost'); // covers: AC-044-3
      expect(dest.pathname).toBe('/it/dashboard'); // covers: AC-044-3
      expect(location).not.toContain('evil.example.com'); // covers: AC-044-3
    };

    // given: vettori classici open-redirect (assoluta, protocol-relative,
    // backslash-trick), passati percent-encoded come farebbe un attaccante.
    for (const next of [
      'https://evil.example.com',
      '//evil.example.com',
      '/\\evil.example.com',
    ]) {
      await expectSafeFallback(encodeURIComponent(next));
    }

    // given: vettori con CONTROL-CHAR smuggling. Nella query il byte di controllo è
    // percent-encoded (%09 TAB, %0A LF, %0D CR): searchParams lo decodifica in un
    // control char reale, così il handler riceve '/<TAB>//evil.example.com' ecc.
    // Senza la difesa esplicita, il parser WHATWG URL striperebbe il control char e
    // '//evil.example.com' risolverebbe su host ESTERNO. Iniettati grezzi (NON
    // ri-encodati) per riprodurre fedelmente l'attacco end-to-end.
    for (const rawNext of [
      '/%09//evil.example.com',
      '/%0A//evil.example.com',
      '/%0D//evil.example.com',
    ]) {
      await expectSafeFallback(rawNext);
    }
  });
});
