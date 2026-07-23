import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// AC-060-7: un membro EDITOR non puo auto-promuoversi a owner ne aggiungere
// membri (scritture su account_members owner-only). Verifica dell'esito via
// service_role (oracolo di verita): il verde deriva dalla RLS, non da dati assenti.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!SB)('T-060 account_members RLS: editor senza escalation (owner-only)', () => {
  const ts = Date.now();
  const emailOwner = `t060_owner_${ts}@example.test`;
  const emailEditor = `t060_editor_${ts}@example.test`;
  const emailNew = `t060_newmember_${ts}@example.test`;
  const password = 'Password123!';

  let ownerId = '';
  let editorId = '';
  let newMemberId = '';
  let ownerAccountId = '';
  let clientEditor: SupabaseClient;

  beforeAll(async () => {
    // Auto-provision (T-062) crea SOLO owner. Creo owner, editor e un terzo
    // utente (candidato "nuovo membro"). Un solo sign-in: quello dell'editor.
    const owner = await createTestUser(emailOwner, password);
    const editor = await createTestUser(emailEditor, password);
    const newMember = await createTestUser(emailNew, password);
    ownerId = owner.id;
    editorId = editor.id;
    newMemberId = newMember.id;

    const admin = adminClient();
    const { data: acc, error: accErr } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', ownerId)
      .single();
    if (accErr) throw accErr;
    ownerAccountId = acc!.id;

    // La membership EDITOR va inserita via service_role (l'auto-provision non la crea).
    const { error: insErr } = await admin.from('account_members').insert({
      account_id: ownerAccountId,
      user_id: editorId,
      role: 'editor',
    });
    if (insErr) throw insErr;

    clientEditor = await signInAs(emailEditor, password);
  });

  afterAll(async () => {
    if (ownerId) await deleteTestUser(ownerId);
    if (editorId) await deleteTestUser(editorId);
    if (newMemberId) await deleteTestUser(newMemberId);
  });

  // covers: AC-060-7
  it('guardrail: l editor VEDE la propria riga membership (il verde non deriva da assenza di dati)', async () => {
    const { data, error } = await clientEditor
      .from('account_members')
      .select('account_id, user_id, role')
      .eq('account_id', ownerAccountId)
      .eq('user_id', editorId);
    expect(error).toBeNull(); // covers: AC-060-7
    expect(data).toHaveLength(1); // covers: AC-060-7 — la lettura e permessa (appartenenza)
    expect(data![0].role).toBe('editor'); // covers: AC-060-7
  });

  // covers: AC-060-7
  it('un editor NON puo auto-promuoversi a owner: UPDATE colpisce 0 righe, ruolo resta editor', async () => {
    const { data, error } = await clientEditor
      .from('account_members')
      .update({ role: 'owner' })
      .eq('account_id', ownerAccountId)
      .eq('user_id', editorId)
      .select();
    // RLS owner-only: la riga non passa la USING dell'UPDATE -> 0 righe aggiornate.
    expect(error).toBeNull(); // covers: AC-060-7
    expect(data ?? []).toHaveLength(0); // covers: AC-060-7

    // Oracolo service_role: il ruolo dell'editor e rimasto invariato.
    const { data: after, error: afterErr } = await adminClient()
      .from('account_members')
      .select('role')
      .eq('account_id', ownerAccountId)
      .eq('user_id', editorId)
      .single();
    expect(afterErr).toBeNull();
    expect(after!.role).toBe('editor'); // covers: AC-060-7
  });

  // covers: AC-060-7
  it('un editor NON puo aggiungere membri al proprio account: INSERT rifiutato, nessun nuovo membro', async () => {
    const { data, error } = await clientEditor
      .from('account_members')
      .insert({ account_id: ownerAccountId, user_id: newMemberId, role: 'editor' })
      .select();
    // RLS owner-only: WITH CHECK fallisce -> errore o 0 righe inserite.
    const rejected = error !== null || (data ?? []).length === 0;
    expect(rejected).toBe(true); // covers: AC-060-7

    // Oracolo service_role: nessuna membership (ownerAccount, newMember) creata.
    const { data: check, error: checkErr } = await adminClient()
      .from('account_members')
      .select('user_id')
      .eq('account_id', ownerAccountId)
      .eq('user_id', newMemberId);
    expect(checkErr).toBeNull();
    expect(check ?? []).toHaveLength(0); // covers: AC-060-7
  });
});
