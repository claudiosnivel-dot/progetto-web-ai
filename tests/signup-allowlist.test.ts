import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSignupAllowed } from '@/domain/auth/validation';
import { getSignupAllowlist } from '@/config/env';

// (deploy pass) T-1 — MURO DEI SIGNUP (allowlist). La logica di sicurezza vive in due
// pezzi puri/testabili: la policy `isSignupAllowed` (domain) e il parsing
// `getSignupAllowlist` (config). Il terzo test esercita la Server Action e prova la
// proprieta' che conta: per un'email NON in allowlist `supabase.auth.signUp` NON viene
// MAI invocato (il muro blocca a monte), col messaggio generico anti-enumeration.

// ── policy pura: isSignupAllowed ──────────────────────────────────────────────
describe('T-1 isSignupAllowed — policy pura di allowlist', () => {
  // Allowlist con PIU' di un elemento, valori DISCORDANTI, e la trappola del prefisso:
  // 'me@ulaba.net' e' prefisso di 'me@ulaba.net.attacker.com'.
  const allowlist = ['me@ulaba.net', 'team@ulaba.net'];

  it('allowlist VUOTA => aperto (true) per qualunque email (default dev/test)', () => {
    expect(isSignupAllowed('chiunque@example.com', [])).toBe(true);
    expect(isSignupAllowed('altro@x.io', [])).toBe(true);
  });

  it('email nella lista => true (uguaglianza esatta)', () => {
    expect(isSignupAllowed('me@ulaba.net', allowlist)).toBe(true);
    expect(isSignupAllowed('team@ulaba.net', allowlist)).toBe(true);
  });

  it('email NON nella lista => false', () => {
    expect(isSignupAllowed('estraneo@example.com', allowlist)).toBe(false);
  });

  it('case-insensitive: MAIUSCOLE/spazi nell input non aggirano ne bloccano la lista', () => {
    expect(isSignupAllowed('  Me@Ulaba.NET  ', allowlist)).toBe(true);
    expect(isSignupAllowed('TEAM@ULABA.NET', allowlist)).toBe(true);
  });

  it('trappola del prefisso: match ESATTO, mai prefisso/sottostringa', () => {
    // 'me@ulaba.net' e' prefisso di questo: un match per prefisso lo ammetterebbe.
    expect(isSignupAllowed('me@ulaba.net.attacker.com', allowlist)).toBe(false);
    // suffisso condiviso ma local-part diversa.
    expect(isSignupAllowed('notme@ulaba.net', allowlist)).toBe(false);
    // la lista non e' vuota, quindi non ricade nel ramo "aperto".
    expect(allowlist.length).toBeGreaterThan(0);
  });
});

// ── parsing: getSignupAllowlist ───────────────────────────────────────────────
describe('T-1 getSignupAllowlist — parsing e normalizzazione da env', () => {
  it('assente o vuota => [] (registrazioni aperte in dev)', () => {
    expect(getSignupAllowlist({})).toEqual([]);
    expect(getSignupAllowlist({ SIGNUP_ALLOWLIST: '' })).toEqual([]);
    expect(getSignupAllowlist({ SIGNUP_ALLOWLIST: '   ' })).toEqual([]);
  });

  it('split su virgola, trim, lowercase, scarto dei vuoti', () => {
    const list = getSignupAllowlist({ SIGNUP_ALLOWLIST: ' Me@Ulaba.NET , team@ulaba.net ,, ' });
    expect(list).toEqual(['me@ulaba.net', 'team@ulaba.net']);
  });

  it('un solo indirizzo resta una lista di uno (normalizzato)', () => {
    expect(getSignupAllowlist({ SIGNUP_ALLOWLIST: 'FOUNDER@ulaba.net' })).toEqual(['founder@ulaba.net']);
  });
});

// ── Server Action: il muro blocca signUp per l'email non autorizzata ──────────
const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));
vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { signUp: signUpMock } })),
}));

import { signup } from '@/app/[locale]/signup/actions';

function form(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

describe('T-1 signup action — allowlist gate anti-enumeration', () => {
  const VALID_PASSWORD = 'Password123';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SIGNUP_ALLOWLIST;
    signUpMock.mockReset();
    signUpMock.mockResolvedValue({ error: null });
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SIGNUP_ALLOWLIST;
    else process.env.SIGNUP_ALLOWLIST = saved;
  });

  it('email NON in allowlist: signUp MAI invocato, messaggio generico', async () => {
    process.env.SIGNUP_ALLOWLIST = 'me@ulaba.net';
    const res = await signup({ status: 'idle' }, form('estraneo@example.com', VALID_PASSWORD));
    expect(res.status).toBe('error');
    expect(res.message).toBe('Registrazione non riuscita. Riprova.'); // stesso messaggio di un fallimento auth
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('trappola del prefisso sull azione: me@ulaba.net.attacker.com bloccato, signUp mai invocato', async () => {
    process.env.SIGNUP_ALLOWLIST = 'me@ulaba.net';
    const res = await signup({ status: 'idle' }, form('me@ulaba.net.attacker.com', VALID_PASSWORD));
    expect(res.status).toBe('error');
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it('email in allowlist: signUp invocato, successo', async () => {
    process.env.SIGNUP_ALLOWLIST = 'me@ulaba.net, team@ulaba.net';
    const res = await signup({ status: 'idle' }, form('me@ulaba.net', VALID_PASSWORD));
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('success');
  });

  it('allowlist assente (dev): registrazioni aperte, signUp invocato', async () => {
    delete process.env.SIGNUP_ALLOWLIST;
    const res = await signup({ status: 'idle' }, form('chiunque@example.com', VALID_PASSWORD));
    expect(signUpMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('success');
  });
});
