import { describe, it, expect } from 'vitest';
import { loadEnv } from '@/config/env';

describe('T-002 loader env', () => {
  it('lancia un errore che nomina la variabile mancante', () => {
    const source = {
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
    };
    // covers: AC-002-1
    expect(() => loadEnv(source)).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('ritorna un oggetto tipizzato con i tre valori quando presenti', () => {
    const source = {
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
    };
    const env = loadEnv(source);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://localhost:54321'); // covers: AC-002-5
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon'); // covers: AC-002-5
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('svc'); // covers: AC-002-5
  });
});
