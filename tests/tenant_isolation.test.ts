import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-063 — Isolamento tenant provato A RUNTIME attraverso il client Supabase con
// auth reale (JWT, ruolo 'authenticated', RLS attiva) su istanza locale — MAI
// nell'SQL editor, che gira come superuser e bypassa la RLS (falso verde).
//
// Attori (creati UNA sola volta in beforeAll per rispettare il rate limit auth;
// i client sono riusati, mai un sign-in dentro un it()):
//   A -> tenant A, owner del proprio account (accountA) via auto-provision (T-062).
//   B -> tenant B, owner del proprio account (accountB): l'"altro" account di cui
//        A NON e membro.
//   E -> membro EDITOR di accountA (membership inserita via service_role, perche
//        l'auto-provision crea SOLO owner): serve a provare l'assenza di
//        escalation di ruolo intra-tenant (scritture su account_members owner-only).
//
// La service_role (adminClient) bypassa la RLS ed e usata SOLO come oracolo di
// verita nel setup e nelle asserzioni server-side: un "0 righe" lato client prova
// l'isolamento della RLS e non la semplice assenza di dati (guardrail AC-063-6).
// Metodi PostgREST TIPATI soltanto (.eq/.select/.insert/.update/.delete/.single);
// mai .or()/.filter() con input interpolato (A05:2025 PostgREST filter injection).

// signInAs() usa la anon key -> va inclusa nel gate, altrimenti con URL+service_role
// ma senza anon il beforeAll fallirebbe alla creazione dei client autenticati.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

describe.skipIf(!SB)('T-063 isolamento tenant (runtime, client auth reale su Supabase locale)', () => {
  const password = 'Password123!';
  const emailA = `t063a_${randomUUID()}@example.test`;
  const emailB = `t063b_${randomUUID()}@example.test`;
  const emailE = `t063e_${randomUUID()}@example.test`;

  let userAId = '';
  let userBId = '';
  let userEId = '';
  let accountAId = '';
  let accountBId = '';

  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let clientE: SupabaseClient;

  beforeAll(async () => {
    // 1) Tre utenti reali; l'auto-provision (T-062) da a CIASCUNO il proprio
    //    account + membership owner + profilo. Nessuna insert manuale (niente PK conflict).
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    const e = await createTestUser(emailE, password);
    userAId = a.id;
    userBId = b.id;
    userEId = e.id;

    // 2) Id degli account auto-provisionati, letti via service_role (bypassa la RLS).
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
    accountAId = accA!.id as string;
    accountBId = accB!.id as string;

    // 3) E diventa EDITOR di accountA: l'auto-provision crea SOLO owner, quindi la
    //    membership editor va inserita via service_role (setup, mai nel browser).
    const { error: memErr } = await admin.from('account_members').insert({
      account_id: accountAId,
      user_id: userEId,
      role: 'editor',
    });
    if (memErr) throw memErr;

    // 4) Un solo sign-in per attore; i client (JWT reale, RLS attiva) sono riusati.
    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
    clientE = await signInAs(emailE, password);
  });

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
    if (userEId) await deleteTestUser(userEId);
  });

  // covers: AC-063-6
  it('guardrail service_role vs authenticated: la service_role VEDE l account di B, il client di A NO', async () => {
    // La service_role bypassa la RLS: l'account di B ESISTE davvero.
    const { data: adminView, error: adminErr } = await adminClient()
      .from('accounts')
      .select('id')
      .eq('id', accountBId);
    expect(adminErr).toBeNull(); // covers: AC-063-6
    expect(adminView).toHaveLength(1); // covers: AC-063-6
    expect(adminView?.[0].id).toBe(accountBId); // covers: AC-063-6

    // Controllo positivo: B (autenticato) vede il PROPRIO account -> la RLS non e un deny cieco.
    const { data: bOwn, error: bErr } = await clientB.from('accounts').select('id');
    expect(bErr).toBeNull(); // covers: AC-063-6
    expect((bOwn ?? []).map((r) => r.id)).toContain(accountBId); // covers: AC-063-6

    // Isolamento: il client di A NON vede l'account di B -> il verde deriva dalla RLS.
    const { data: aView, error: aErr } = await clientA
      .from('accounts')
      .select('id')
      .eq('id', accountBId);
    expect(aErr).toBeNull(); // covers: AC-063-6
    expect(aView).toHaveLength(0); // covers: AC-063-6
  });

  // covers: AC-063-1
  it('A legge accounts: vede SOLO il proprio account, quello di B e assente', async () => {
    const { data, error } = await clientA.from('accounts').select('id');
    expect(error).toBeNull(); // covers: AC-063-1
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(accountAId); // covers: AC-063-1
    expect(ids).not.toContain(accountBId); // covers: AC-063-1
    expect(data).toHaveLength(1); // covers: AC-063-1
  });

  // covers: AC-063-2
  it("A legge account_members dell'account di B con .eq('account_id', accountB): 0 righe (A non e membro di B)", async () => {
    // Guardrail service_role: l'account di B POSSIEDE davvero una membership (l'owner
    // auto-provisionato) -> il "0 righe" lato A prova la soppressione RLS, non l'assenza di dati.
    const { data: adminMembers, error: adminMembersErr } = await adminClient()
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountBId);
    expect(adminMembersErr).toBeNull(); // covers: AC-063-2
    expect((adminMembers ?? []).length).toBeGreaterThanOrEqual(1); // covers: AC-063-2 — B ha almeno la membership owner

    const { data, error } = await clientA
      .from('account_members')
      .select('account_id, user_id, role')
      .eq('account_id', accountBId);
    expect(error).toBeNull(); // covers: AC-063-2
    expect(data).toHaveLength(0); // covers: AC-063-2 — soppressione RLS provata dal guardrail sopra
  });

  // covers: AC-063-3
  it("A NON puo aggiungersi come membro dell'account di B: insert rifiutato, nessuna membership creata", async () => {
    const { data, error } = await clientA
      .from('account_members')
      .insert({ account_id: accountBId, user_id: userAId, role: 'editor' })
      .select();
    // RLS owner-only (WITH CHECK owner_id = auth.uid()): A non e owner di B -> rifiutato.
    const rejected = error !== null || (data ?? []).length === 0;
    expect(rejected).toBe(true); // covers: AC-063-3

    // Oracolo service_role: nessuna membership (accountB, A) e stata creata.
    const { data: check, error: checkErr } = await adminClient()
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountBId)
      .eq('user_id', userAId);
    expect(checkErr).toBeNull(); // covers: AC-063-3
    expect(check ?? []).toHaveLength(0); // covers: AC-063-3
  });

  // covers: AC-063-4
  it("A NON puo aggiornare il name dell'account di B: 0 righe aggiornate, name invariato", async () => {
    // Stato di B PRIMA (oracolo service_role).
    const before = await adminClient()
      .from('accounts')
      .select('name')
      .eq('id', accountBId)
      .single();
    expect(before.error).toBeNull();

    const { data: updated, error } = await clientA
      .from('accounts')
      .update({ name: 'hacked-by-A' })
      .eq('id', accountBId)
      .select();
    // accounts non ha policy UPDATE per authenticated -> la riga di B non qualifica -> 0 righe.
    expect(error).toBeNull(); // covers: AC-063-4
    expect(updated ?? []).toHaveLength(0); // covers: AC-063-4

    // Oracolo service_role: il name dell'account di B e invariato.
    const after = await adminClient()
      .from('accounts')
      .select('name')
      .eq('id', accountBId)
      .single();
    expect(after.error).toBeNull(); // covers: AC-063-4
    expect(after.data?.name).toBe(before.data?.name); // covers: AC-063-4
    expect(after.data?.name).not.toBe('hacked-by-A'); // covers: AC-063-4
  });

  // covers: AC-063-5
  it("A NON puo eliminare l'account di B: 0 righe eliminate, l'account di B esiste ancora", async () => {
    const { data: deleted, error } = await clientA
      .from('accounts')
      .delete()
      .eq('id', accountBId)
      .select();
    // accounts non ha policy DELETE per authenticated -> 0 righe eliminate.
    expect(error).toBeNull(); // covers: AC-063-5
    expect(deleted ?? []).toHaveLength(0); // covers: AC-063-5

    // Oracolo service_role: l'account di B esiste ancora.
    const { data: still, error: stillErr } = await adminClient()
      .from('accounts')
      .select('id')
      .eq('id', accountBId);
    expect(stillErr).toBeNull(); // covers: AC-063-5
    expect(still).toHaveLength(1); // covers: AC-063-5
    expect(still?.[0].id).toBe(accountBId); // covers: AC-063-5
  });

  // covers: AC-063-7
  it("guardrail: l'editor E VEDE la propria riga membership in accountA (il verde non deriva da assenza di dati)", async () => {
    const { data, error } = await clientE
      .from('account_members')
      .select('account_id, user_id, role')
      .eq('account_id', accountAId)
      .eq('user_id', userEId);
    expect(error).toBeNull(); // covers: AC-063-7
    expect(data).toHaveLength(1); // covers: AC-063-7 — la lettura e permessa (appartenenza)
    expect(data?.[0].role).toBe('editor'); // covers: AC-063-7
  });

  // covers: AC-063-7
  it("un editor NON puo auto-promuoversi a owner: 0 righe aggiornate, ruolo resta 'editor'", async () => {
    const { data, error } = await clientE
      .from('account_members')
      .update({ role: 'owner' })
      .eq('account_id', accountAId)
      .eq('user_id', userEId)
      .select();
    // account_members UPDATE e owner-only (USING owner_id = auth.uid()): E non e owner -> 0 righe.
    expect(error).toBeNull(); // covers: AC-063-7
    expect(data ?? []).toHaveLength(0); // covers: AC-063-7

    // Oracolo service_role: il ruolo di E e rimasto 'editor'.
    const { data: afterRow, error: afterErr } = await adminClient()
      .from('account_members')
      .select('role')
      .eq('account_id', accountAId)
      .eq('user_id', userEId)
      .single();
    expect(afterErr).toBeNull(); // covers: AC-063-7
    expect(afterRow?.role).toBe('editor'); // covers: AC-063-7
  });

  // covers: AC-063-7
  it("un editor NON puo aggiungere membri al proprio account: insert rifiutato, nessun nuovo membro", async () => {
    // E (editor di accountA) tenta di aggiungere B (utente reale, non membro di accountA)
    // come membro di accountA: la rejection e attribuibile alla RLS owner-only, non alla FK.
    const { data, error } = await clientE
      .from('account_members')
      .insert({ account_id: accountAId, user_id: userBId, role: 'editor' })
      .select();
    // RLS owner-only (WITH CHECK owner_id = auth.uid()): E non e owner di accountA -> rifiutato.
    const rejected = error !== null || (data ?? []).length === 0;
    expect(rejected).toBe(true); // covers: AC-063-7

    // Oracolo service_role: nessuna membership (accountA, B) e stata creata.
    const { data: check, error: checkErr } = await adminClient()
      .from('account_members')
      .select('user_id')
      .eq('account_id', accountAId)
      .eq('user_id', userBId);
    expect(checkErr).toBeNull(); // covers: AC-063-7
    expect(check ?? []).toHaveLength(0); // covers: AC-063-7
  });

  // ── DELETE su account_members esercitato come utente NON autorizzato ─────────
  // Prima di questi test nessun .delete() del repo colpiva account_members: la
  // policy account_members_delete_owner era provata solo per ESPRESSIONE (catalogo
  // statico), mai per COMPORTAMENTO. I test seguenti la esercitano a runtime.
  //
  // Due invarianti di metodo, applicate a tutti e quattro:
  //  1) guardrail service_role — la riga bersaglio ESISTEVA prima ed ESISTE ancora
  //     dopo: un "0 righe eliminate" da solo non distingue la RLS dai dati assenti;
  //  2) fixture con PIU righe DISCORDANTI (accountA: A owner + E editor;
  //     accountB: B owner) — con una riga sola "cancella quella giusta" e "cancella
  //     tutto" sarebbero indistinguibili.
  // Nota: asserire error === null (e non 42501) dimostra che il DELETE raggiunge
  // davvero la tabella (il GRANT c'e) e che a fermarlo e la RLS, non un privilegio.
  // Nessun sign-in nuovo: si riusano clientA / clientE del beforeAll (rate limit auth).

  // Stato delle membership letto via service_role (bypassa la RLS), come chiave
  // stabile e ordinata: confrontabile con toEqual senza dipendere dall'ordine.
  const membersOf = async (accountIds: string[]): Promise<string[]> => {
    const { data, error } = await adminClient()
      .from('account_members')
      .select('account_id, user_id, role')
      .in('account_id', accountIds);
    expect(error).toBeNull();
    return (data ?? []).map((r) => `${r.account_id}|${r.user_id}|${r.role}`).sort();
  };

  // covers: AC-063-5 — l'AC nomina la delete su accounts; qui la STESSA proprieta
  // ("0 righe eliminate e la riga esiste ancora") e provata su account_members, la
  // cui policy DELETE e owner-only. Copertura AGGIUNTIVA oltre l'AC: il DELETE
  // cross-tenant su account_members non era esercitato da alcun test.
  it("A NON puo eliminare la membership dell'account di B: 0 righe eliminate, la membership di B resta", async () => {
    // Guardrail service_role PRIMA: le righe bersaglio esistono davvero.
    const before = await membersOf([accountAId, accountBId]);
    expect(before).toHaveLength(3); // covers: AC-063-5 — A owner + E editor (accountA), B owner (accountB)
    expect(before).toContain(`${accountBId}|${userBId}|owner`); // covers: AC-063-5

    const { data: deleted, error } = await clientA
      .from('account_members')
      .delete()
      .eq('account_id', accountBId)
      .select();
    // A non e owner di accountB -> la USING owner-only non qualifica alcuna riga.
    expect(error).toBeNull(); // covers: AC-063-5
    expect(deleted ?? []).toHaveLength(0); // covers: AC-063-5

    // Guardrail service_role DOPO: nulla cancellato, nemmeno collateralmente su accountA.
    expect(await membersOf([accountAId, accountBId])).toEqual(before); // covers: AC-063-5
  });

  // covers: AC-063-7 — l'AC nomina update/insert; qui la stessa proprieta di
  // "nessuna escalation intra-tenant" sul DELETE. Copertura AGGIUNTIVA oltre l'AC:
  // il DE-PROVISIONING dell'OWNER da parte di un EDITOR. E vede la riga di A per
  // appartenenza (SELECT per membership) ma la DELETE e owner-only: vedere != poter
  // cancellare.
  it("l'editor E NON puo cancellare la membership OWNER di A: 0 righe eliminate, A resta owner", async () => {
    // Il verde non deriva da "riga invisibile a E": E VEDE la membership owner di A.
    const seen = await clientE
      .from('account_members')
      .select('account_id, user_id, role')
      .eq('account_id', accountAId)
      .eq('user_id', userAId);
    expect(seen.error).toBeNull(); // covers: AC-063-7
    expect(seen.data).toHaveLength(1); // covers: AC-063-7
    expect(seen.data?.[0].role).toBe('owner'); // covers: AC-063-7

    // Guardrail service_role PRIMA: due righe DISCORDANTI su accountA.
    const before = await membersOf([accountAId]);
    expect(before).toContain(`${accountAId}|${userAId}|owner`); // covers: AC-063-7
    expect(before).toContain(`${accountAId}|${userEId}|editor`); // covers: AC-063-7

    const { data: deleted, error } = await clientE
      .from('account_members')
      .delete()
      .eq('account_id', accountAId)
      .eq('user_id', userAId)
      .select();
    expect(error).toBeNull(); // covers: AC-063-7
    expect(deleted ?? []).toHaveLength(0); // covers: AC-063-7

    // Guardrail service_role DOPO: la membership owner di A esiste ancora...
    expect(await membersOf([accountAId])).toEqual(before); // covers: AC-063-7
    // ...e A e ancora owner del proprio account (accounts.owner_id invariato).
    const acc = await adminClient()
      .from('accounts')
      .select('owner_id')
      .eq('id', accountAId)
      .single();
    expect(acc.error).toBeNull(); // covers: AC-063-7
    expect(acc.data?.owner_id).toBe(userAId); // covers: AC-063-7
  });

  // covers: AC-063-7 — RAGGIO D'AZIONE del DELETE, copertura AGGIUNTIVA oltre l'AC:
  // un delete ad ampio raggio (tutto accountA) da parte dell'editor non cancella
  // NULLA, nemmeno la sua PROPRIA riga: la policy e owner-only, non "membro-only".
  // Le due righe di accountA hanno valori DISCORDANTI (owner vs editor), quindi
  // "cancella quella giusta" e "cancella tutto" restano distinguibili.
  it("l'editor E NON puo svuotare account_members del proprio account: 0 righe, entrambe le membership restano", async () => {
    const before = await membersOf([accountAId]);
    expect(before).toHaveLength(2); // covers: AC-063-7

    const { data: deleted, error } = await clientE
      .from('account_members')
      .delete()
      .eq('account_id', accountAId)
      .select();
    expect(error).toBeNull(); // covers: AC-063-7
    expect(deleted ?? []).toHaveLength(0); // covers: AC-063-7

    expect(await membersOf([accountAId])).toEqual(before); // covers: AC-063-7
  });

  // covers: AC-063-7 — controllo POSITIVO del DELETE (copertura AGGIUNTIVA oltre
  // l'AC). Senza di esso un "0 righe eliminate" potrebbe derivare da un DELETE che
  // non funziona per NESSUNO: qui l'owner A cancella la membership di E e SOLO
  // quella, mentre la propria riga owner (valore DISCORDANTE) sopravvive.
  // Va per ULTIMO nel file: modifica la fixture (E non e piu membro di accountA).
  it("controllo positivo: l'owner A cancella la membership dell'editor E e SOLO quella", async () => {
    expect(await membersOf([accountAId])).toHaveLength(2); // covers: AC-063-7

    const { data: deleted, error } = await clientA
      .from('account_members')
      .delete()
      .eq('account_id', accountAId)
      .eq('user_id', userEId)
      .select();
    expect(error).toBeNull(); // covers: AC-063-7
    expect(deleted ?? []).toHaveLength(1); // covers: AC-063-7 — il DELETE funziona davvero, per l'owner
    expect(deleted?.[0].user_id).toBe(userEId); // covers: AC-063-7

    // Guardrail service_role: resta ESATTAMENTE la membership owner di A.
    expect(await membersOf([accountAId])).toEqual([`${accountAId}|${userAId}|owner`]); // covers: AC-063-7
  });
});
