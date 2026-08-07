import { describe, it, expect } from 'vitest';
import {
  supabaseStorageOrigin,
  buildPublicSiteCsp,
  publicSecurityHeaders,
} from '@/config/security-headers';

// (deploy pass) T-3 — CSP + security header della rotta pubblica /s/<slug>. Difesa in
// profondita' oltre la sanificazione del renderer unico; qui si prova la FORMA degli header.

describe('T-3 supabaseStorageOrigin', () => {
  it('deriva l origine (scheme+host+porta) da NEXT_PUBLIC_SUPABASE_URL', () => {
    expect(supabaseStorageOrigin({ NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' })).toBe(
      'https://xyz.supabase.co',
    );
    expect(supabaseStorageOrigin({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54621/rest/v1' })).toBe(
      'http://127.0.0.1:54621',
    );
  });

  it('assente o malformata => null (nessun host Storage allowlistato)', () => {
    expect(supabaseStorageOrigin({})).toBeNull();
    expect(supabaseStorageOrigin({ NEXT_PUBLIC_SUPABASE_URL: '' })).toBeNull();
    expect(supabaseStorageOrigin({ NEXT_PUBLIC_SUPABASE_URL: 'non-un-url' })).toBeNull();
  });
});

describe('T-3 buildPublicSiteCsp', () => {
  const csp = buildPublicSiteCsp('https://xyz.supabase.co');

  it('nega tutto per default e blocca object/base/frame', () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'"); // niente plugin
    expect(csp).toContain("base-uri 'none'"); // niente <base> injection
    expect(csp).toContain("frame-ancestors 'none'"); // anti-clickjacking
    expect(csp).toContain("form-action 'self'");
  });

  it('img-src ammette SOLO self, data: e il NOSTRO host Storage (rinforza P2-D12)', () => {
    expect(csp).toContain("img-src 'self' data: https://xyz.supabase.co");
    // connect-src per RSC + storage.
    expect(csp).toContain("connect-src 'self' https://xyz.supabase.co");
  });

  it('senza host Storage (null): img-src resta a self + data:, nessun host esterno', () => {
    const bare = buildPublicSiteCsp(null);
    expect(bare).toContain("img-src 'self' data:");
    expect(bare).not.toContain('supabase');
    // nessun host arbitrario finisce nella policy.
    expect(bare).toContain("connect-src 'self'");
  });

  it('script-src ammette unsafe-inline (limite dichiarato: XSS coperta dall escaping, non dalla CSP)', () => {
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe('T-3 publicSecurityHeaders', () => {
  const headers = publicSecurityHeaders({ NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' });
  const byKey = (k: string) => headers.find((h) => h.key === k)?.value;

  it('include CSP + i classici header di sicurezza', () => {
    expect(byKey('Content-Security-Policy')).toContain("default-src 'self'");
    expect(byKey('X-Content-Type-Options')).toBe('nosniff');
    expect(byKey('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(byKey('X-Frame-Options')).toBe('DENY');
    expect(byKey('Strict-Transport-Security')).toMatch(/max-age=\d+/);
    expect(byKey('Permissions-Policy')).toContain('geolocation=()');
  });
});
