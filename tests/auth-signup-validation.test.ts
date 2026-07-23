import { describe, it, expect, vi, beforeEach } from 'vitest';

// T-042 — Validazione signup ESCLUSIVAMENTE server-side (UNIT su zod + gating
// dell'azione). Mockiamo SOLO il confine verso Supabase (il client SSR) per
// PROVARE che supabase.auth.signUp NON viene mai invocato quando l'input è
// invalido: lo spy non auto-conferma nulla, se l'azione chiamasse signUp su input
// invalido lo spy registrerebbe la chiamata e il test fallirebbe. La creazione
// utente reale è coperta da tests/auth-signup-flow.test.ts.
const { signUpMock } = vi.hoisted(() => ({ signUpMock: vi.fn() }));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => ({
    auth: { signUp: signUpMock },
  }),
}));

// Import DOPO il mock (vi.mock è hoisted).
import { signupSchema } from '@/domain/auth/validation';
import { signup } from '@/domain/auth/signup';

function formDataOf(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set('email', email);
  fd.set('password', password);
  return fd;
}

describe('T-042 signup: validazione server-side (schema zod + gating azione)', () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it('AC-042-1: email non valida → schema fallisce sul campo email e signUp NON viene chiamato', async () => {
    // given: payload con email 'notanemail' e password valida
    const result = signupSchema.safeParse({ email: 'notanemail', password: 'Password123!' });

    // then (schema): success === false con un issue sul campo email
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true); // covers: AC-042-1
    }

    // when: l'azione valida lo stesso input server-side
    const state = await signup({ status: 'idle' }, formDataOf('notanemail', 'Password123!'));

    // then (azione): esito d'errore e signUp mai raggiunto (validazione blocca prima)
    expect(state.status).toBe('error'); // covers: AC-042-1
    expect(signUpMock).not.toHaveBeenCalled(); // covers: AC-042-1
  });

  it('AC-042-2: password sotto la policy (<8) → schema fallisce sul campo password e signUp NON viene chiamato', async () => {
    // given: email valida e password 'abc' (sotto gli 8 caratteri richiesti)
    const result = signupSchema.safeParse({ email: 'valid@example.test', password: 'abc' });

    // then (schema): success === false con un issue sul campo password
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true); // covers: AC-042-2
    }

    // when: l'azione valida lo stesso input
    const state = await signup({ status: 'idle' }, formDataOf('valid@example.test', 'abc'));

    // then (azione): esito d'errore e signUp mai chiamato
    expect(state.status).toBe('error'); // covers: AC-042-2
    expect(signUpMock).not.toHaveBeenCalled(); // covers: AC-042-2
  });

  it('AC-042-4: campi extra iniettati dal client (role, account_id) vengono STRIPPATI', () => {
    // given: payload valido con campi privilegio extra iniettati dal client
    const result = signupSchema.safeParse({
      email: 'valid@example.test',
      password: 'Password123!',
      role: 'owner',
      account_id: '11111111-1111-1111-1111-111111111111',
    });

    // then: parse OK e l'oggetto risultante contiene SOLO email e password
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data).sort()).toEqual(['email', 'password']); // covers: AC-042-4
      expect('role' in result.data).toBe(false); // covers: AC-042-4
      expect('account_id' in result.data).toBe(false); // covers: AC-042-4
    }
  });
});
