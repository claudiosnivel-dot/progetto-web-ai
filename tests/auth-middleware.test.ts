import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';

// T-041 — Guardia di route nel middleware UNICO (next-intl + auth).
// La lettura sessione del middleware è ISOLATA in getUserFromRequest (modulo
// @/data/supabase-ssr): qui la MOCKIAMO per pilotare utente valido|null senza un
// vero cookie. Così questo test verifica la LOGICA di guardia/redirect e la
// composizione con next-intl (il locale non viene corto-circuitato), mentre la
// validazione reale del JWT è coperta da tests/auth-server-session.test.ts.
const { getUserFromRequestMock } = vi.hoisted(() => ({
  getUserFromRequestMock: vi.fn(),
}));

vi.mock('@/data/supabase-ssr', () => ({
  getUserFromRequest: getUserFromRequestMock,
}));

// Import DOPO il mock (vi.mock è hoisted).
import middleware from '@/middleware';

// Import ADDITIVI, usati SOLO dal blocco di proprietà in fondo al file (audit degli
// oracoli, schema D): `config` serve a costruire il perimetro del matcher DAL
// MODULO — mai ricopiandone il pattern qui, o il test resterebbe verde proprio
// sulla mutazione che deve prendere; `routing` a derivare i locale dall'unica
// sorgente di verità invece di scriverli a mano.
import { config } from '@/middleware';
import { routing } from '@/i18n/routing';

const fakeUser = { id: '00000000-0000-0000-0000-000000000001' } as User;

const run = (pathname: string) =>
  middleware(new NextRequest(new URL(pathname, 'http://localhost')));

describe('T-041 middleware: guardia auth composta con next-intl', () => {
  beforeEach(() => {
    getUserFromRequestMock.mockReset();
  });

  it('senza sessione, GET /it/dashboard reindirizza 307 a /it/login', async () => {
    // given: nessuna sessione valida; when: GET /it/dashboard (route protetta)
    getUserFromRequestMock.mockResolvedValue(null);
    const res = await run('/it/dashboard');
    // then: redirect 307 con Location = /it/login
    expect(res.status).toBe(307); // covers: AC-041-1
    const location = res.headers.get('location');
    expect(location).not.toBeNull();
    expect(new URL(location as string).pathname).toBe('/it/login'); // covers: AC-041-1
  });

  it('con sessione valida, GET /it/dashboard prosegue senza redirect al login', async () => {
    // given: sessione valida (identità server-side); when: GET /it/dashboard
    getUserFromRequestMock.mockResolvedValue(fakeUser);
    const res = await run('/it/dashboard');
    // then: nessun redirect (NextResponse.next del flusso next-intl)…
    expect(res.headers.get('location')).toBeNull(); // covers: AC-041-2
    // …e la guardia ha consultato l'identità server-side (non un flag client).
    expect(getUserFromRequestMock).toHaveBeenCalledOnce(); // covers: AC-041-2
  });

  it('route pubbliche /it/login e /it/auth/callback proseguono senza redirect', async () => {
    // given: route pubbliche di auth; when: il middleware le elabora
    const login = await run('/it/login');
    const callback = await run('/it/auth/callback');
    // then: nessun redirect (non sono protette) e la guardia non viene consultata
    expect(login.headers.get('location')).toBeNull(); // covers: AC-041-5
    expect(callback.headers.get('location')).toBeNull(); // covers: AC-041-5
    expect(getUserFromRequestMock).not.toHaveBeenCalled(); // covers: AC-041-5
  });

  // T-150 — la rotta onboarding (/{locale}/onboarding/<siteId>) entra fra le route
  // protette: prima era fuori dalla regex e il middleware la lasciava passare senza
  // sessione. La pagina fa comunque il proprio getUser (difesa in profondità), ma la
  // guardia di route deve negare l'accesso PRIMA di eseguire il Server Component.
  it('senza sessione, GET /it/onboarding/<siteId> reindirizza 307 a /it/login', async () => {
    // given: nessuna sessione valida; when: GET della rotta onboarding di un sito
    getUserFromRequestMock.mockResolvedValue(null);
    const res = await run('/it/onboarding/00000000-0000-0000-0000-0000000000aa');
    // then: redirect 307 con Location = /it/login
    expect(res.status).toBe(307); // covers: AC-150-1
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/it/login'); // covers: AC-150-1
  });

  it('con sessione valida, GET /it/onboarding/<siteId> prosegue senza redirect al login', async () => {
    // given: sessione valida; when: GET della rotta onboarding
    getUserFromRequestMock.mockResolvedValue(fakeUser);
    const res = await run('/it/onboarding/00000000-0000-0000-0000-0000000000aa');
    // then: nessun redirect e la guardia ha consultato l'identità server-side
    expect(res.headers.get('location')).toBeNull(); // covers: AC-150-1
    expect(getUserFromRequestMock).toHaveBeenCalledOnce(); // covers: AC-150-1
  });

  it('senza sessione, GET /es/onboarding/<siteId> reindirizza 307 a /es/login (locale es preservato)', async () => {
    // given: nessuna sessione; when: GET onboarding sul locale non-default
    getUserFromRequestMock.mockResolvedValue(null);
    const res = await run('/es/onboarding/00000000-0000-0000-0000-0000000000aa');
    // then: il routing di locale non è corto-circuitato dalla guardia
    expect(res.status).toBe(307); // covers: AC-150-1
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/es/login'); // covers: AC-150-1
  });

  it('senza sessione, GET /es/dashboard reindirizza 307 a /es/login (locale es preservato)', async () => {
    // given: nessuna sessione; when: GET /es/dashboard (locale non-default)
    getUserFromRequestMock.mockResolvedValue(null);
    const res = await run('/es/dashboard');
    // then: redirect 307 a /es/login → il routing di locale next-intl NON è
    // corto-circuitato dalla guardia (es resta es, non diventa il default it).
    expect(res.status).toBe(307); // covers: AC-041-6
    expect(new URL(res.headers.get('location') as string).pathname).toBe('/es/login'); // covers: AC-041-6
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit degli oracoli — schema D: i test sopra asseriscono l'ESITO nel caso
// nominale ("senza sessione si viene rediretti al login"); qui si asseriscono le
// PROPRIETÀ che rendono quell'esito sicuro — se la guardia viene invocata del
// tutto (A3-04), DOVE porta il redirect (A3-01) e con quale query (A3-05).
// Peso specifico di questa superficie: è l'unica del progetto senza RLS come
// seconda linea. Altrove una guardia che cade trova ancora il database a dire di
// no; qui, se la guardia cade, non c'è nient'altro.
//
// Il perimetro del middleware NON è la funzione `middleware`, è la coppia
// (funzione, installazione). I test sopra chiamano `middleware(request)` in modo
// DIRETTO: provano la funzione, mai la sua installazione. Qui si compila il
// predicato che Next usa davvero per decidere se invocarla.

// `config.matcher` contiene pattern che Next valuta sull'INTERO pathname: sono già
// regex (lookahead negativi), le ancoriamo e basta. Costruito dal valore esportato
// dal modulo, non da una copia: è questo che rende il test sensibile alla mutazione.
const matcherRegexes = config.matcher.map((pattern) => new RegExp(`^${pattern}$`));
const isInMiddlewarePerimeter = (pathname: string) =>
  matcherRegexes.some((re) => re.test(pathname));

const SITE_ID = '00000000-0000-0000-0000-0000000000aa';

describe('T-041 proprietà di sicurezza della guardia (audit oracoli, schema D)', () => {
  beforeEach(() => {
    getUserFromRequestMock.mockReset();
  });

  // A3-04 — MUTAZIONE CHE LO RENDE ROSSO: escludere le rotte protette da
  // `config.matcher`, p.es. `'/((?!api|_next|_vercel|.*/dashboard|.*\\..*).*)'`
  // (equivalentemente: restringere il matcher a un prefisso che non le comprende).
  // Con quella mutazione la guardia continua a esistere, a essere corretta e a
  // superare TUTTI i test che la invocano direttamente — ma Next non la invoca mai
  // e /it/dashboard diventa pubblica. È il modo di fallire più insidioso della
  // superficie: 25 test su 25 verdi a protezione disattivata.
  it('ogni rotta protetta, in ogni locale supportato, cade DENTRO il perimetro installato in config.matcher', () => {
    // Anti-vacuità: se `routing.locales` fosse vuoto il ciclo passerebbe a vuoto e
    // il test non proverebbe più niente.
    expect(routing.locales.length).toBeGreaterThan(0);

    const protette = routing.locales.flatMap((locale) => [
      `/${locale}/dashboard`,
      `/${locale}/dashboard/${SITE_ID}`,
      `/${locale}/onboarding/${SITE_ID}`,
    ]);
    expect(protette.length).toBe(routing.locales.length * 3);

    for (const pathname of protette) {
      // Se questa asserzione cade, la guardia non viene MAI eseguita su quel path,
      // per quanto corretta sia: la rotta è pubblica.
      expect(isInMiddlewarePerimeter(pathname), pathname).toBe(true); // covers: AC-041-1, AC-150-1 (installazione, non solo funzione)
    }
  });

  // A3-04 (verso opposto) — MUTAZIONE CHE LO RENDE ROSSO: togliere `api` (oppure
  // `_next`, `_vercel`, `.*\\..*`) dal lookahead negativo di `config.matcher`.
  // Conseguenza concreta: l'endpoint di turno della chat sotto /api riceverebbe un
  // 307 verso il login al posto del 401 JSON che un fetch può leggere (T-150), e
  // ogni file statico passerebbe dal routing di locale.
  it('/api, /_next, /_vercel e i percorsi con estensione restano FUORI dal perimetro di config.matcher', () => {
    for (const pathname of [
      '/api/chat/turn',
      '/api/qualsiasi/altra',
      '/_next/static/chunks/main.js',
      '/_next/image',
      '/_vercel/insights/view',
      '/favicon.ico',
      '/logo.png',
    ]) {
      expect(isInMiddlewarePerimeter(pathname), pathname).toBe(false); // DoD T-041 (commento righe 61-63 di src/middleware.ts)
    }
  });

  // A3-01 — MUTAZIONE CHE LO RENDE ROSSO: far dipendere la destinazione dall'input,
  // p.es. in `guardProtectedRoute`
  //   loginUrl.pathname = request.nextUrl.searchParams.get('next') ?? `/${locale}/login`;
  // (o `NextResponse.redirect(new URL(next, request.url), 307)`). I test nominali
  // restano tutti verdi — asseriscono CHE si viene rediretti al login, non DOVE — e
  // un link a /it/dashboard?next=https://evil.example/ deposita l'utente NON
  // autenticato su un host esterno, con l'aria di essere partito dal sito.
  it('senza sessione la destinazione del redirect non dipende in alcun modo dai parametri della richiesta: resta same-origin e su /{locale}/login', async () => {
    getUserFromRequestMock.mockResolvedValue(null);

    const locationOf = async (url: string) => {
      const res = await middleware(new NextRequest(new URL(url, 'http://localhost')));
      expect(res.status, url).toBe(307);
      const location = res.headers.get('location');
      expect(location, url).not.toBeNull();
      return location as string;
    };

    expect(routing.locales.length).toBeGreaterThan(0); // anti-vacuità

    for (const locale of routing.locales) {
      // Riferimento: la STESSA rotta protetta, senza alcun parametro.
      const atteso = await locationOf(`/${locale}/dashboard`);
      expect(new URL(atteso).origin).toBe('http://localhost'); // covers: AC-041-1
      expect(new URL(atteso).pathname).toBe(`/${locale}/login`); // covers: AC-041-1

      for (const query of [
        'next=https://evil.example/',
        'next=//evil.example',
        'next=%2F%2Fevil.example',
        'next=/\\evil.example',
        'returnTo=/es/dashboard',
        'redirect_uri=https://evil.example/&next=https://evil.example/&callbackUrl=https://evil.example/',
      ]) {
        const location = await locationOf(`/${locale}/dashboard?${query}`);

        // LA proprietà: byte per byte la stessa destinazione del caso senza
        // parametri. Non "una destinazione accettabile" — l'input non la sfiora.
        expect(location, query).toBe(atteso); // covers: AC-041-1
        const dest = new URL(location);
        expect(dest.origin, query).toBe('http://localhost'); // covers: AC-041-1
        expect(dest.pathname, query).toBe(`/${locale}/login`); // covers: AC-041-1
        // Ridondante ma esplicito: l'host ostile non compare da nessuna parte
        // nell'header, nemmeno dentro una query superstite.
        expect(location, query).not.toContain('evil.example'); // covers: AC-041-1
      }
    }
  });

  // A3-05 — MUTAZIONE CHE LO RENDE ROSSO: rimuovere `loginUrl.search = ''` da
  // `guardProtectedRoute`. La query della richiesta — che l'attaccante controlla
  // per intero — sopravvive nell'header Location e arriva alla pagina di login:
  // `?error=...` le fa mostrare un messaggio scelto dall'attaccante e `?next=...`
  // resta lì pronto per qualunque logica di ritorno post-login.
  it('il redirect al login non porta con sé ALCUNA query string della richiesta originale', async () => {
    getUserFromRequestMock.mockResolvedValue(null);

    const res = await middleware(
      new NextRequest(
        new URL(
          '/it/dashboard?next=https://evil.example/&utm_source=phish&error=sessione-scaduta',
          'http://localhost',
        ),
      ),
    );

    const dest = new URL(res.headers.get('location') as string);
    expect(dest.pathname).toBe('/it/login'); // covers: AC-041-1
    // Nessun parametro: non "nessun parametro pericoloso", proprio nessuno.
    expect(dest.search).toBe(''); // covers: AC-041-1
    expect([...dest.searchParams.keys()]).toEqual([]); // covers: AC-041-1
  });
});
