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
