import { describe, it, expect } from 'vitest';
import { assertProductionEnv } from '@/config/env';

// (deploy pass) T-2 — GATE FAIL-FAST DELLA CONFIG DI PRODUZIONE. assertProductionEnv
// e' invocata al boot da src/instrumentation.ts SOLO quando NODE_ENV === 'production'.
// Prova sull'origine (source parametrizzato), non sull'ambiente reale.

// Una config di produzione COMPLETA e valida (le 3 chiavi Supabase + Anthropic +
// site-url https pubblica + allowlist armata).
const OK: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  ANTHROPIC_API_KEY: 'sk-ant-xxx',
  NEXT_PUBLIC_SITE_URL: 'https://ulaba.net',
  SIGNUP_ALLOWLIST: 'me@ulaba.net',
};

describe('T-2 assertProductionEnv', () => {
  it('config completa e valida: non lancia', () => {
    expect(() => assertProductionEnv(OK)).not.toThrow();
  });

  it('chiave Supabase mancante: lancia nominandola (semantica di loadEnv)', () => {
    const rest = { ...OK };
    delete rest.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertProductionEnv(rest)).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('ANTHROPIC_API_KEY mancante: lancia nominandola', () => {
    const rest = { ...OK };
    delete rest.ANTHROPIC_API_KEY;
    expect(() => assertProductionEnv(rest)).toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('NEXT_PUBLIC_SITE_URL assente: lancia', () => {
    const rest = { ...OK };
    delete rest.NEXT_PUBLIC_SITE_URL;
    expect(() => assertProductionEnv(rest)).toThrowError(/NEXT_PUBLIC_SITE_URL/);
  });

  it('NEXT_PUBLIC_SITE_URL localhost: rifiutata (deve essere pubblica)', () => {
    expect(() => assertProductionEnv({ ...OK, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toThrowError(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('NEXT_PUBLIC_SITE_URL http (non https): rifiutata', () => {
    expect(() => assertProductionEnv({ ...OK, NEXT_PUBLIC_SITE_URL: 'http://ulaba.net' })).toThrowError(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('SIGNUP_ALLOWLIST vuota: rifiutata (il muro deve essere armato)', () => {
    expect(() => assertProductionEnv({ ...OK, SIGNUP_ALLOWLIST: '' })).toThrowError(/SIGNUP_ALLOWLIST/);
  });

  it('piu problemi insieme: l errore li nomina TUTTI', () => {
    const err = (() => {
      try {
        assertProductionEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
        return '';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    })();
    expect(err).toMatch(/ANTHROPIC_API_KEY/);
    expect(err).toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(err).toMatch(/SIGNUP_ALLOWLIST/);
  });
});
