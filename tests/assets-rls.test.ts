import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pgQuery } from './helpers/pg';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-412 (macrotask media-storage, P4) — RLS OWNER-ONLY della tabella applicativa
// public.assets, RICONQUISTATA e PROVATA A RUNTIME (OWASP A01:2025). L'oracolo qui non e'
// lo schema (gia' coperto staticamente da rls-check) ma il COMPORTAMENTO con client reali:
//
//  - (AC-412-1) un MEMBRO dell'account A inserisce una riga assets PROPRIA (account_id=A) e
//    la scrittura passa (WITH CHECK is_account_member) con storage_path = la chiave PIATTA
//    <asset_id> (EMENDAMENTO P4-D6a: niente cartella, la chiave e' l'asset_id opaco);
//  - (AC-412-2) il membro di A che SELECT le righe di B riceve INSIEME VUOTO (RLS), anche per
//    uno storage_path che e' NEAR-COLLISION del proprio; l'anon che SELECT assets prende 42501
//    (nessun GRANT: assets non ha colonne pubbliche) → account_id/storage_path non esposti;
//  - (AC-412-5) il membro di A che DELETE la riga di B cancella 0 righe (RLS).
//
// ANTI-PLACEBO: un ORACOLO INDIPENDENTE service_role (RLS bypassata) prova che le righe di B
// ESISTONO davvero → il vuoto/0-cancellate visto da A e' SOPPRESSIONE, non assenza di dati.
// Client di SESSIONE reali per le asserzioni, MAI service_role (bypasserebbe la RLS → verde
// VACUO). service_role / pgQuery (superuser) SOLO per setup e per l'oracolo indipendente.
//
// Le asserzioni derivano dagli acceptance_criteria AC-412-1/2/5 (04-media-storage.md).

// pgQuery (DATABASE_URL) serve al setup di sites; il resto usa le chiavi Supabase. Senza env
// il blocco si auto-salta pulito: l'orchestratore lo esegue al checkpoint su stato pulito.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

// NEAR-COLLISION sull'asse che controlliamo (storage_path = asset_id): ritorna un uuid che
// condivide 35 caratteri di prefisso con `u` ma differisce nell'ultimo hex — resta un uuid
// valido (un prefisso PROPRIO non lo sarebbe). Un lookup per prefisso (LIKE/startsWith) li
// confonderebbe; il match ESATTO e la RLS per account_id no.
const nearCollision = (u: string): string =>
  u.slice(0, -1) + (u.endsWith('a') ? 'b' : 'a');

describe.skipIf(!SB)(
  'T-412 RLS owner-only su public.assets — membro scrive il proprio, cross-tenant SELECT/DELETE negati, anon 42501; oracolo indipendente anti-placebo',
  () => {
    const password = 'Password123!';
    const suffisso = randomUUID().slice(0, 8);
    const emailA = `t412a_${randomUUID()}@example.test`;
    const emailB = `t412b_${randomUUID()}@example.test`;

    // Chiavi piatte (asset_id) DISCORDANTI. Trappola: pA1 e pB1 sono NEAR-COLLISION (stesso
    // prefisso di 35 char, tenant DIVERSI) — se la RLS filtrasse per prefisso invece che per
    // account, A vedrebbe la riga di B. pA2/pB2 sono namespace distinti (fixture > 1 elemento
    // per account, valori discordanti).
    const pA1 = randomUUID(); // A, inserito dal membro A in AC-412-1
    const pB1 = nearCollision(pA1); // B, seminato — near-collision di pA1, tenant diverso
    const pA2 = randomUUID(); // A, seminato (A ha > 1 asset)
    const pB2 = randomUUID(); // B, seminato

    let userAId = '';
    let userBId = '';
    let accountA = '';
    let accountB = '';
    let siteA = '';
    let siteB = '';
    let idB1 = ''; // id della riga assets di B con storage_path=pB1
    let idB2 = '';
    let clientA: SupabaseClient;
    let anon: SupabaseClient;

    beforeAll(async () => {
      const a = await createTestUser(emailA, password);
      const b = await createTestUser(emailB, password);
      userAId = a.id;
      userBId = b.id;

      const admin = adminClient();
      const { data: accs } = await admin
        .from('accounts')
        .select('id, owner_id')
        .in('owner_id', [userAId, userBId]);
      accountA = (accs ?? []).find((r) => r.owner_id === userAId)!.id as string;
      accountB = (accs ?? []).find((r) => r.owner_id === userBId)!.id as string;

      // Un sito per account (FK composita (account_id, site_id) → sites). Slug per-account,
      // namespacizzato col suffisso. Valori name discordanti.
      const siteRows = await pgQuery<{ id: string; account_id: string; slug: string }>(
        `insert into public.sites (account_id, name, slug)
         values ($1, 'A shop', $3),
                ($2, 'B bazar', $4)
         returning id, account_id, slug`,
        [accountA, accountB, `site-a-${suffisso}`, `site-b-${suffisso}`],
      );
      siteA = siteRows.find((r) => r.account_id === accountA)!.id;
      siteB = siteRows.find((r) => r.account_id === accountB)!.id;

      // Semina via service_role (bypassa la RLS, NON i vincoli): l'asset extra di A e i due
      // asset di B. Valori DISCORDANTI (mime/width/height diversi).
      const { data: seeded, error: seedErr } = await admin
        .from('assets')
        .insert([
          { account_id: accountA, site_id: siteA, storage_path: pA2, mime: 'image/webp', width: 640, height: 480 },
          { account_id: accountB, site_id: siteB, storage_path: pB1, mime: 'image/png', width: 300, height: 300 },
          { account_id: accountB, site_id: siteB, storage_path: pB2, mime: 'image/jpeg', width: 1920, height: 1080 },
        ])
        .select('id, storage_path');
      expect(seedErr).toBeNull();
      idB1 = (seeded ?? []).find((r) => r.storage_path === pB1)!.id as string;
      idB2 = (seeded ?? []).find((r) => r.storage_path === pB2)!.id as string;
      expect(new Set([idB1, idB2]).size).toBe(2); // righe di B distinte

      // Un solo sign-in (rate limit auth): client autenticato col JWT reale di A (RLS attiva).
      clientA = await signInAs(emailA, password);

      // Client ANON reale: anon key, NESSUN sign-in → ruolo Postgres `anon`.
      anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );

      // Guardrail sulla fixture: pA1 e pB1 sono davvero near-collision (prefisso condiviso) ma
      // distinti e su tenant diversi → la trappola-prefisso e' armata.
      expect(pA1).not.toBe(pB1);
      expect(pB1.slice(0, 35)).toBe(pA1.slice(0, 35));
    }, 60_000);

    afterAll(async () => {
      // cascade: auth.users → accounts → sites → assets.
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-412-1
    it('un membro di A inserisce una riga assets PROPRIA: scrittura ammessa, account_id=A e storage_path = la chiave piatta <asset_id> (P4-D6a)', async () => {
      const { data, error } = await clientA
        .from('assets')
        .insert({
          account_id: accountA,
          site_id: siteA,
          storage_path: pA1, // chiave piatta = asset_id opaco (EMENDAMENTO P4-D6a, niente cartella)
          mime: 'image/jpeg',
          width: 1200,
          height: 800,
        })
        .select('id, account_id, site_id, storage_path, mime, width, height')
        .single();
      expect(error).toBeNull(); // covers: AC-412-1 — WITH CHECK is_account_member(A) passa
      expect(data!.account_id).toBe(accountA); // covers: AC-412-1 — riga ancorata all'account A
      expect(data!.site_id).toBe(siteA); // covers: AC-412-1
      expect(data!.storage_path).toBe(pA1); // covers: AC-412-1 — storage_path = <asset_id>
      expect(data!.mime).toBe('image/jpeg'); // covers: AC-412-1

      // ORACOLO INDIPENDENTE: la riga esiste davvero, con account_id=A (non un eco del client).
      const { data: real } = await adminClient()
        .from('assets')
        .select('account_id, storage_path')
        .eq('storage_path', pA1)
        .single();
      expect(real!.account_id).toBe(accountA); // covers: AC-412-1
    });

    // covers: AC-412-2
    it('un membro di A che SELECT gli asset di B riceve insieme VUOTO — anche sullo storage_path near-collision del proprio (RLS per account, non per prefisso); ma le righe di B ESISTONO (anti-placebo)', async () => {
      // Per account_id di B: la RLS (is_account_member) filtra → 0 righe, SENZA errore.
      const byAccount = await clientA
        .from('assets')
        .select('id, account_id, storage_path')
        .eq('account_id', accountB);
      expect(byAccount.error).toBeNull(); // covers: AC-412-2 — RLS, non errore di privilegio
      expect(byAccount.data ?? []).toHaveLength(0); // covers: AC-412-2

      // Per lo storage_path NEAR-COLLISION del proprio (pB1 ⁓ pA1): comunque 0 righe — la RLS
      // e' per account, l'assonanza di path non fa trapelare la riga di B.
      const byPath = await clientA
        .from('assets')
        .select('id, storage_path')
        .eq('storage_path', pB1);
      expect(byPath.error).toBeNull(); // covers: AC-412-2
      expect(byPath.data ?? []).toHaveLength(0); // covers: AC-412-2 — near-collision non confonde l'identita'

      // anon su assets: NESSUN GRANT (assets non ha colonne pubbliche) → 42501, dati nulli.
      // account_id e storage_path non sono esposti nemmeno interrogandoli per nome.
      const anonAll = await anon.from('assets').select('id');
      expect(anonAll.error?.code).toBe('42501'); // covers: AC-412-2 — anon negato
      expect(anonAll.data).toBeNull(); // covers: AC-412-2
      const anonAcc = await anon.from('assets').select('account_id');
      expect(anonAcc.error?.code).toBe('42501'); // covers: AC-412-2 — account_id non esposto
      const anonPath = await anon.from('assets').select('storage_path');
      expect(anonPath.error?.code).toBe('42501'); // covers: AC-412-2 — storage_path non esposto

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): le righe di B ESISTONO → il vuoto
      // sopra e' soppressione RLS, non assenza di dati.
      const { data: real } = await adminClient()
        .from('assets')
        .select('storage_path')
        .eq('account_id', accountB);
      const realPaths = (real ?? []).map((r) => r.storage_path as string);
      expect(realPaths).toContain(pB1); // covers: AC-412-2
      expect(realPaths).toContain(pB2); // covers: AC-412-2
    });

    // covers: AC-412-5
    it('un membro di A che DELETE la riga di B cancella 0 righe (RLS blocca il cross-tenant) e la riga di B resta (oracolo indipendente)', async () => {
      // DELETE per id di B: la RLS (USING is_account_member) non qualifica la riga per A →
      // 0 righe cancellate. .select() restituisce le righe EFFETTIVAMENTE cancellate.
      const delById = await clientA
        .from('assets')
        .delete()
        .eq('id', idB1)
        .select('id');
      expect(delById.error).toBeNull(); // covers: AC-412-5 — RLS, non errore
      expect(delById.data ?? []).toHaveLength(0); // covers: AC-412-5 — nessuna riga di B cancellata

      // DELETE per lo storage_path near-collision: idem, 0 righe.
      const delByPath = await clientA
        .from('assets')
        .delete()
        .eq('storage_path', pB1)
        .select('id');
      expect(delByPath.data ?? []).toHaveLength(0); // covers: AC-412-5

      // ORACOLO INDIPENDENTE: la riga di B c'e' ANCORA (la cancellazione non e' avvenuta).
      const { data: real } = await adminClient()
        .from('assets')
        .select('id, storage_path')
        .eq('id', idB1)
        .maybeSingle();
      expect(real?.id).toBe(idB1); // covers: AC-412-5 — riga di B intatta
      expect(real?.storage_path).toBe(pB1); // covers: AC-412-5
    });
  },
);
