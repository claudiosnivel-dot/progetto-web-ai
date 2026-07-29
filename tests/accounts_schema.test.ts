import { describe, it, expect } from 'vitest';
import { pgQuery } from './helpers/pg';

// Asserzioni sui cataloghi di sistema via connessione Postgres diretta
// (PostgREST non li espone). Coprono AC-060-1/2/3/4/6 di T-060.
const DB = !!process.env.DATABASE_URL;

type ColRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

type PolicyRow = {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

// pg_policies rende l'espressione secondo il search_path: `public.` puo comparire o
// no, e gli spazi non sono significativi. E l'UNICA normalizzazione ammessa dai due
// test di uguaglianza ESATTA piu sotto: comprime gli spazi e toglie il prefisso di
// schema, e NON allenta nulla del predicato.
const norm = (e: string | null): string | null =>
  e == null ? null : e.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();

// Predicato di OWNERSHIP delle tre policy di SCRITTURA di account_members, come reso
// dal catalogo dopo norm(). E diverso dal predicato di APPARTENENZA della SELECT: e
// questa differenza a impedire l'auto-promozione di un editor (AC-060-7).
const OWNER_EXPR =
  '(EXISTS ( SELECT 1 FROM accounts a WHERE ((a.id = account_members.account_id) AND (a.owner_id = ( SELECT auth.uid() AS uid)))))';

describe.skipIf(!DB)('T-060 schema accounts + account_members (cataloghi)', () => {
  // covers: AC-060-1
  it('accounts espone esattamente id/owner_id/name/created_at con tipi e nullability attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'accounts'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // covers: AC-060-1 — insieme esatto delle colonne
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'created_at',
      'id',
      'name',
      'owner_id',
    ]);
    // covers: AC-060-1 — id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid');
    expect(by['id'].is_nullable).toBe('NO');
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()');
    // covers: AC-060-1 — owner_id uuid NOT NULL
    expect(by['owner_id'].data_type).toBe('uuid');
    expect(by['owner_id'].is_nullable).toBe('NO');
    // covers: AC-060-1 — name text, created_at timestamptz
    expect(by['name'].data_type).toBe('text');
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
  });

  // covers: AC-060-1
  it('account_members espone esattamente account_id/user_id/role/created_at con tipi attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'account_members'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // covers: AC-060-1 — insieme esatto delle colonne
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'account_id',
      'created_at',
      'role',
      'user_id',
    ]);
    // covers: AC-060-1 — account_id/user_id uuid
    expect(by['account_id'].data_type).toBe('uuid');
    expect(by['user_id'].data_type).toBe('uuid');
    // covers: AC-060-1 — role text NOT NULL
    expect(by['role'].data_type).toBe('text');
    expect(by['role'].is_nullable).toBe('NO');
    // covers: AC-060-1 — created_at timestamptz
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
  });

  // covers: AC-060-2
  it('account_members: PK composita (account_id,user_id), CHECK su role e FK account_id->accounts ON DELETE CASCADE', async () => {
    // PK composita nell'ordine (account_id, user_id)
    const pk = await pgQuery<{ cols: string[] }>(
      `select array_agg(a.attname::text order by k.ord) as cols
         from pg_constraint c
         join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.conrelid = 'public.account_members'::regclass and c.contype = 'p'
        group by c.oid`,
    );
    expect(pk).toHaveLength(1); // covers: AC-060-2
    expect(pk[0].cols).toEqual(['account_id', 'user_id']); // covers: AC-060-2

    // CHECK che limita role a owner/editor
    const checks = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.account_members'::regclass and c.contype = 'c'`,
    );
    const roleCheck = checks.map((r) => r.def).find((d) => d.includes('role'));
    expect(roleCheck).toBeDefined(); // covers: AC-060-2
    expect(roleCheck).toContain("'owner'"); // covers: AC-060-2
    expect(roleCheck).toContain("'editor'"); // covers: AC-060-2

    // FK account_id -> accounts con ON DELETE CASCADE (confdeltype = 'c')
    const fk = await pgQuery<{ def: string; confdeltype: string }>(
      `select pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.account_members'::regclass
          and c.contype = 'f'
          and c.confrelid = 'public.accounts'::regclass`,
    );
    expect(fk).toHaveLength(1); // covers: AC-060-2
    expect(fk[0].confdeltype).toBe('c'); // covers: AC-060-2 — ON DELETE CASCADE
    expect(fk[0].def).toContain('account_id'); // covers: AC-060-2
    expect(fk[0].def.toUpperCase()).toContain('ON DELETE CASCADE'); // covers: AC-060-2
  });

  // covers: AC-060-3
  it('RLS abilitata (relrowsecurity=true) su accounts e account_members', async () => {
    const rows = await pgQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relname in ('accounts', 'account_members')
        order by relname`,
    );
    expect(rows).toHaveLength(2); // covers: AC-060-3
    for (const r of rows) expect(r.relrowsecurity).toBe(true); // covers: AC-060-3
  });

  // covers: AC-060-4
  it('ogni policy e TO authenticated e nessuna usa USING(true)/WITH CHECK(true) o auth.uid() IS NOT NULL da sola', async () => {
    const pols = await pgQuery<{
      tablename: string;
      policyname: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, policyname, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public'
          and tablename in ('accounts', 'account_members')`,
    );

    // Almeno una policy per ciascuna tabella.
    const tables = new Set(pols.map((p) => p.tablename));
    expect(tables.has('accounts')).toBe(true); // covers: AC-060-4
    expect(tables.has('account_members')).toBe(true); // covers: AC-060-4

    // Vietate USING(true)/WITH CHECK(true) e la sola auth.uid() IS NOT NULL.
    const forbidden = (e: string | null): boolean => {
      if (e == null) return false;
      const s = e.replace(/\s+/g, '').toLowerCase();
      if (/^\(*true\)*$/.test(s)) return true;
      if (/^\(*(select)?auth\.uid\(\)(asuid)?\)*isnotnull\)*$/.test(s)) return true;
      return false;
    };

    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-060-4
      expect(forbidden(p.qual)).toBe(false); // covers: AC-060-4
      expect(forbidden(p.with_check)).toBe(false); // covers: AC-060-4
    }
  });

  // covers: AC-060-4 (R3, R4, R5)
  //
  // PERCHE l'uguaglianza ESATTA e necessaria. Il test qui sopra e per CONTENIMENTO e
  // per lista nera: respinge la sola costante 'true' e la sola `auth.uid() is not
  // null`. Un predicato completamente permissivo che non sia nessuna delle due lo
  // attraversa indenne — il contro-esempio concreto e `account_id is not null`, che
  // CONTIENE 'account_id', NON e la costante 'true' e non ha la forma su auth.uid()
  // intercettata da `forbidden`. Misurato nell'audit degli oracoli: sostituendo cosi
  // il predicato di una policy, TUTTI i test restano verdi su quattro tabelle
  // diverse. Solo il confronto per INTERO dell'espressione distingue la policy giusta
  // da una plausibilmente sbagliata.
  //
  // OLTRE l'AC-060-4 (che chiede solo "ogni tabella ha almeno una policy"): l'insieme
  // ESATTO dei comandi. accounts ha UNA SOLA policy, per SELECT — INSERT/UPDATE/DELETE
  // sono in DEFAULT-DENY, e la loro ASSENZA e la difesa: il GRANT DML a authenticated
  // c'e (migrazione 20260723000100), quindi e solo la mancanza di policy a impedire
  // che un utente crei, rinomini o cancelli account passando dalla Data API. E una
  // PROPRIETA, non un dettaglio di forma: un `toContain('SELECT')` resterebbe verde
  // dopo l'aggiunta di una `for all ... using (true)`, l'uguaglianza dell'insieme no.
  it("accounts ha ESATTAMENTE la sola policy SELECT (nessuna policy di scrittura: default-deny) e la sua USING e ESATTAMENTE ((select auth.uid()) = owner_id) or is_account_member(id)", async () => {
    const pols = await pgQuery<PolicyRow>(
      `select policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'accounts'`,
    );

    // Insieme ESATTO dei comandi coperti, non "contiene": e questo che rende ROSSA
    // l'AGGIUNTA di una policy di scrittura permissiva.
    expect(pols.map((p) => p.cmd).sort()).toEqual(['SELECT']); // covers: AC-060-4
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-060-4 (R5)
    }
    const byCmd = Object.fromEntries(pols.map((p) => [p.cmd, p]));

    // Il predicato di tenancy per INTERO: la disgiunzione owner_id/appartenenza e
    // parte del contratto, e togliere o aggiungere un ramo cambia chi legge.
    expect(norm(byCmd['SELECT'].qual)).toBe(
      '((( SELECT auth.uid() AS uid) = owner_id) OR is_account_member(id))',
    ); // covers: AC-060-4 (R3, R4)
    // La clausola NON pertinente e asserita null: un WITH CHECK su una policy SELECT
    // e comunque una deviazione dal contratto.
    expect(byCmd['SELECT'].with_check).toBeNull(); // covers: AC-060-4
  });

  // covers: AC-060-4 (R3, R4, R5), AC-060-6
  //
  // PERCHE l'uguaglianza ESATTA e necessaria: stesso contro-esempio del test su
  // accounts qui sopra — `account_id is not null` passa un controllo per
  // contenimento e non e la costante 'true', quindi neutralizza la policy senza far
  // fallire nulla.
  //
  // OLTRE l'AC: qui l'uguaglianza esatta porta una proprieta in piu, la DISTINZIONE
  // fra i due predicati. La SELECT usa l'APPARTENENZA (is_account_member), le tre
  // scritture usano l'OWNERSHIP (EXISTS su accounts.owner_id): sono predicati
  // DIVERSI, ed e proprio questa differenza a bloccare l'auto-promozione di un editor
  // a owner (AC-060-7). Un oracolo che chiedesse solo "l'espressione cita account_id"
  // accetterebbe il predicato di appartenenza al posto di quello di ownership sulle
  // scritture, cioe accetterebbe l'escalation di ruolo intra-tenant.
  // L'insieme ESATTO dei quattro comandi implica anche il companion R6 (AC-060-6).
  it("account_members ha ESATTAMENTE le policy DELETE/INSERT/SELECT/UPDATE, e le espressioni sono ESATTAMENTE l'appartenenza in lettura e l'ownership nelle tre scritture", async () => {
    const pols = await pgQuery<PolicyRow>(
      `select policyname, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'account_members'`,
    );

    // Insieme ESATTO: rompe sia se una policy attesa sparisce sia se ne compare una
    // non prevista (es. una seconda policy SELECT permissiva, che in OR con quella
    // buona aprirebbe la lettura a tutti senza che nessun'altra asserzione protesti).
    expect(pols.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']); // covers: AC-060-4, AC-060-6
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-060-4 (R5)
    }
    const byCmd = Object.fromEntries(pols.map((p) => [p.cmd, p]));

    // LETTURA: appartenenza. Chi e membro vede i co-membri.
    expect(norm(byCmd['SELECT'].qual)).toBe('is_account_member(account_id)'); // covers: AC-060-4 (R3, R4)
    expect(byCmd['SELECT'].with_check).toBeNull(); // covers: AC-060-4

    // SCRITTURE: ownership. Un editor e membro ma NON owner, quindi qui non passa.
    expect(byCmd['INSERT'].qual).toBeNull(); // covers: AC-060-4
    expect(norm(byCmd['INSERT'].with_check)).toBe(OWNER_EXPR); // covers: AC-060-4 (R3, R4)

    // UPDATE ha ENTRAMBE: la USING filtra le righe modificabili, la WITH CHECK
    // impedisce di "spostare" la riga in un account altrui riscrivendo account_id.
    expect(norm(byCmd['UPDATE'].qual)).toBe(OWNER_EXPR); // covers: AC-060-4 (R3, R4)
    expect(norm(byCmd['UPDATE'].with_check)).toBe(OWNER_EXPR); // covers: AC-060-4 (R3, R4)

    expect(norm(byCmd['DELETE'].qual)).toBe(OWNER_EXPR); // covers: AC-060-4 (R3, R4)
    expect(byCmd['DELETE'].with_check).toBeNull(); // covers: AC-060-4
  });

  // covers: AC-060-6
  it('ogni tabella con una policy UPDATE possiede anche una policy SELECT (companion R6)', async () => {
    const pols = await pgQuery<{ tablename: string; cmd: string }>(
      `select tablename, cmd
         from pg_policies
        where schemaname = 'public'
          and tablename in ('accounts', 'account_members')`,
    );

    for (const t of ['accounts', 'account_members']) {
      const cmds = pols.filter((p) => p.tablename === t).map((p) => p.cmd);
      if (cmds.includes('UPDATE')) {
        expect(cmds).toContain('SELECT'); // covers: AC-060-6
      }
    }

    // Guardia anti-vacuita: account_members ha davvero UPDATE + SELECT.
    const amCmds = pols
      .filter((p) => p.tablename === 'account_members')
      .map((p) => p.cmd);
    expect(amCmds).toContain('UPDATE'); // covers: AC-060-6
    expect(amCmds).toContain('SELECT'); // covers: AC-060-6
  });

  // Emendamento ledger 2026-07-23: UNIQUE(owner_id) su accounts (un utente possiede
  // al piu un account personale in P0/V1). Non tra gli AC originali di T-060.
  it('accounts ha un vincolo UNIQUE su owner_id (un account per owner)', async () => {
    const uniq = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.accounts'::regclass and c.contype = 'u'`,
    );
    expect(uniq.some((r) => /owner_id/.test(r.def))).toBe(true);
  });
});
