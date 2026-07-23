import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// AC-060-5: la helper public.is_account_member deve valutare l'appartenenza del
// chiamante REALE (auth.uid() dal JWT), non del superuser. Si esegue ATTRAVERSO
// il client autenticato (RPC), mai nell'SQL editor.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!SB)('T-060 is_account_member (client autenticato reale)', () => {
  const ts = Date.now();
  const emailA = `t060_member_a_${ts}@example.test`;
  const emailB = `t060_member_b_${ts}@example.test`;
  const password = 'Password123!';

  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;

  beforeAll(async () => {
    // createTestUser attiva l'auto-provision (T-062): ogni utente riceve gia il
    // proprio account + membership owner. B serve come account "di cui A NON e
    // membro". Un solo sign-in (clientA) per rispettare il rate limit.
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA, error: eA } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    const { data: accB, error: eB } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userBId)
      .single();
    if (eA) throw eA;
    if (eB) throw eB;
    accountAId = accA!.id;
    accountBId = accB!.id;

    clientA = await signInAs(emailA, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-060-5
  it('ritorna true per il proprio account (A ne e membro owner via auto-provision)', async () => {
    const { data, error } = await clientA.rpc('is_account_member', {
      a_id: accountAId,
    });
    expect(error).toBeNull(); // covers: AC-060-5
    expect(data).toBe(true); // covers: AC-060-5
  });

  // covers: AC-060-5
  it("ritorna false per un account di cui A NON e membro (l'account di B)", async () => {
    const { data, error } = await clientA.rpc('is_account_member', {
      a_id: accountBId,
    });
    expect(error).toBeNull(); // covers: AC-060-5
    expect(data).toBe(false); // covers: AC-060-5
  });
});
