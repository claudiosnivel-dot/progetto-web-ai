import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Spie condivise (hoisted) usate dai mock dei moduli. Il redirect reale di
// next-intl interrompe il flusso lanciando: la spia replica quel contratto
// lanciando un sentinel, così il codice dopo il redirect non viene eseguito.
const { cookieSetSpy, redirectSpy, REDIRECT } = vi.hoisted(() => {
  const sentinel = Symbol('redirect');
  return {
    REDIRECT: sentinel,
    cookieSetSpy: vi.fn(),
    redirectSpy: vi.fn(() => {
      throw sentinel;
    }),
  };
});

// next/headers: cookies() è async e ritorna uno store con .set spiato.
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSetSpy }),
}));

// @/i18n/navigation: a setLocale serve solo redirect (replica il lancio del
// redirect reale di next-intl per interrompere come in produzione).
vi.mock('@/i18n/navigation', () => ({
  redirect: redirectSpy,
}));

// Import DOPO i mock (vi.mock è hoisted). Il middleware non tocca i moduli
// mockati: gira con il vero next-intl per la risoluzione da cookie.
import middleware from '@/middleware';
import { setLocale } from '@/domain/setLocale';

describe('T-082 setLocale (server action) + persistenza cookie', () => {
  beforeEach(() => {
    cookieSetSpy.mockClear();
    redirectSpy.mockClear();
  });

  it('reindirizza alla stessa pagina col nuovo prefisso di locale (es → /es/dashboard)', async () => {
    try {
      await setLocale('es', '/dashboard');
    } catch (e) {
      expect(e).toBe(REDIRECT);
    }
    expect(redirectSpy).toHaveBeenCalledWith({
      href: '/dashboard',
      locale: 'es',
    }); // covers: AC-082-1
  });

  it('emette il cookie NEXT_LOCALE=es con Path=/ e SameSite=Lax', async () => {
    try {
      await setLocale('es', '/dashboard');
    } catch {
      // il redirect lancia: irrilevante per l'asserzione sul cookie
    }
    expect(cookieSetSpy).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'es',
      expect.objectContaining({ path: '/', sameSite: 'lax' }),
    ); // covers: AC-082-2
  });

  it('rifiuta un locale fuori allowlist (fr) con 400, senza cookie né redirect', async () => {
    const r = await setLocale('fr', '/dashboard');
    expect(r.status).toBe(400); // covers: AC-082-3
    expect(cookieSetSpy).not.toHaveBeenCalled(); // covers: AC-082-3
    expect(redirectSpy).not.toHaveBeenCalled(); // covers: AC-082-3
  });

  it('rifiuta un href assoluto (open-redirect) con 400, senza cookie né redirect', async () => {
    const r = await setLocale('es', 'https://evil.com');
    expect(r.status).toBe(400);
    expect(cookieSetSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('rifiuta un pathname protocol-relative (//evil.com) con 400, senza cookie né redirect', async () => {
    const r = await setLocale('es', '//evil.com');
    expect(r.status).toBe(400);
    expect(cookieSetSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('rifiuta un pathname con caratteri di controllo (smuggling) con 400', async () => {
    const r = await setLocale('es', '/\t//evil.com');
    expect(r.status).toBe(400);
    expect(cookieSetSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('il middleware risolve il locale es dal cookie NEXT_LOCALE su GET /', async () => {
    const req = new NextRequest(new URL('/', 'http://localhost'), {
      headers: { cookie: 'NEXT_LOCALE=es' },
    });
    // Il middleware (T-041) può essere async sulle route protette: qui la home /
    // è pubblica e resta sincrona, ma await ne normalizza il tipo di ritorno.
    const res = await middleware(req);
    expect(res.status).toBe(307); // covers: AC-082-4
    expect(res.headers.get('location')).toMatch(/\/es$/); // covers: AC-082-4
  });
});
