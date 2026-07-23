import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'smol-toml';

// T-040 — Configurazione Supabase Auth (email/password + Google).
// Il test parsa supabase/config.toml (via smol-toml) e legge .env.example (via
// node:fs) per verificare che i provider siano configurati SENZA segreti reali:
// riferimenti env(...) nel TOML, placeholder vuoti nel .env.example.

const configToml = readFileSync(resolve(process.cwd(), 'supabase/config.toml'), 'utf8');
const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
const config = parse(configToml);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Naviga un percorso di chiavi in un TOML parsato; ritorna undefined se il
// percorso attraversa un valore non-oggetto o una chiave mancante.
function at(root: unknown, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

// Estrae le coppie chiave=valore da un file in stile dotenv, saltando commenti
// e righe vuote. Il valore è la porzione a destra del primo '='.
function parseDotenv(source: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    pairs.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return pairs;
}

describe('T-040 configurazione Supabase Auth', () => {
  it('abilita il provider email con signup consentito', () => {
    // given: config.toml presente; when: leggo [auth.email].enable_signup
    // then: === true (AC-040-1)
    expect(at(config, ['auth', 'email', 'enable_signup'])).toBe(true); // covers: AC-040-1
  });

  it('abilita Google OAuth con credenziali referenziate via env(...) e mai letterali', () => {
    // given: config.toml; when: leggo [auth.external.google]
    // then: enabled === true e client_id/secret sono riferimenti env(...) (AC-040-2)
    expect(at(config, ['auth', 'external', 'google', 'enabled'])).toBe(true); // covers: AC-040-2

    const clientId = at(config, ['auth', 'external', 'google', 'client_id']);
    const secret = at(config, ['auth', 'external', 'google', 'secret']);
    expect(typeof clientId).toBe('string');
    expect(typeof secret).toBe('string');

    // Devono essere ESATTAMENTE riferimenti a variabili d'ambiente, non valori.
    const envRef = /^env\([A-Z0-9_]+\)$/;
    expect(clientId).toMatch(envRef); // covers: AC-040-2
    expect(secret).toMatch(envRef); // covers: AC-040-2

    // E NON devono assomigliare a credenziali Google reali (client id finisce
    // con .apps.googleusercontent.com; il secret inizia con GOCSPX-).
    const looksLikeGoogleCredential = /\.apps\.googleusercontent\.com|GOCSPX-/;
    expect(clientId as string).not.toMatch(looksLikeGoogleCredential); // covers: AC-040-2
    expect(secret as string).not.toMatch(looksLikeGoogleCredential); // covers: AC-040-2
  });

  it('.env.example documenta le 5 chiavi con soli placeholder vuoti, nessun segreto reale', () => {
    // given: .env.example; when: lo leggo riga per riga; then: le chiavi ci sono
    // e ogni valore è vuoto/placeholder, mai un pattern di segreto reale (AC-040-3)
    const pairs = parseDotenv(envExample);
    const requiredKeys = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID',
      'SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET',
    ];
    // Pattern che tradiscono un segreto reale: JWT (chiavi Supabase), secret
    // Google, client id Google, URL postgres con credenziali inline.
    const secretLike = /^eyJ|GOCSPX-|\.apps\.googleusercontent\.com|:\/\/[^/\s]*:[^/\s]*@/;

    for (const key of requiredKeys) {
      expect(pairs.has(key)).toBe(true); // covers: AC-040-3
      const value = pairs.get(key) ?? '';
      expect(value).toBe(''); // placeholder vuoto  // covers: AC-040-3
      expect(value).not.toMatch(secretLike); // covers: AC-040-3
    }

    // La service_role non deve MAI essere esposta come chiave pubblica NEXT_PUBLIC_*.
    expect(pairs.has('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY')).toBe(false); // covers: AC-040-3
  });

  it('additional_redirect_urls include le callback OAuth per /it e /es', () => {
    // given: config.toml; when: leggo auth.additional_redirect_urls
    // then: array con una URL che termina /it/auth/callback e una /es/auth/callback (AC-040-4)
    const redirects = at(config, ['auth', 'additional_redirect_urls']);
    expect(Array.isArray(redirects)).toBe(true);
    const urls = (redirects as unknown[]).filter((u): u is string => typeof u === 'string');
    expect(urls.some((u) => u.endsWith('/it/auth/callback'))).toBe(true); // covers: AC-040-4
    expect(urls.some((u) => u.endsWith('/es/auth/callback'))).toBe(true); // covers: AC-040-4
  });

  it('definisce un rate limit di auth per sign-in/sign-up con valore numerico > 0', () => {
    // given: config.toml; when: leggo [auth.rate_limit]; then: esiste un limite
    // numerico > 0 sulle operazioni di sign-in/sign-up (anti brute-force) (AC-040-5)
    const signInSignUps = at(config, ['auth', 'rate_limit', 'sign_in_sign_ups']);
    expect(typeof signInSignUps).toBe('number');
    expect(signInSignUps as number).toBeGreaterThan(0); // covers: AC-040-5
  });
});
