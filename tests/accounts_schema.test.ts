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

// Riga di pg_proc per la funzione SECURITY DEFINER che regge le policy di lettura.
type ProcRow = {
  prosecdef: boolean;
  proconfig: string[] | null;
  provolatile: string;
  identity_args: string;
  result_type: string;
  acl: string[] | null;
  authenticated_can_execute: boolean;
};

// Valore CANONICO che Postgres memorizza in pg_proc.proconfig per
// `set search_path = public, pg_temp`. Postgres appiattisce la lista GUC in questa
// forma (verificato sul catalogo: tutte le proconfig dell'istanza sono `name=v1, v2`),
// quindi l'uguaglianza esatta e sensibile all'ORDINE e ai VALORI, non alla
// formattazione della migrazione.
const SEARCH_PATH_PINNED = 'search_path=public, pg_temp';

// Interrogazione unica del catalogo per public.is_account_member: filtra per NOME e
// non per firma (`::regprocedure` solleverebbe un errore di cast invece di dare una
// riga in meno), cosi l'assenza della funzione e un'asserzione fallita e leggibile.
const IS_ACCOUNT_MEMBER_PROC_SQL = `
  select p.prosecdef,
         p.proconfig,
         p.provolatile,
         pg_get_function_identity_arguments(p.oid) as identity_args,
         pg_get_function_result(p.oid) as result_type,
         p.proacl::text[] as acl,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'is_account_member'`;

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

  // ── public.is_account_member(uuid) — il contratto di CATALOGO della funzione ──
  //
  // OLTRE gli AC di T-060: nessun AC nomina il search_path. AC-060-5 prova a runtime
  // che la funzione RITORNI true per il proprio account e false per un altro, e resta
  // verde con QUALUNQUE search_path. L'unica dichiarazione dell'hardening sta nel
  // commento della migrazione 20260723000100 (righe 33-38: "search_path fisso e corpo
  // solo-parametro ... prevengono hijack/injection (R8/R9)"), e nessun test la
  // copriva. Misurato nell'audit degli oracoli (rilievo T-01, HIGH): togliere
  // `set search_path = public, pg_temp` lascia verdi 21 test su 21 E l'oracolo RLS
  // statico del checkpoint (`findings: 0`). E la funzione piu condivisa del progetto
  // — regge la lettura di accounts, account_members, sites, site_briefs,
  // site_generations, generation_pools — e nessuno la proteggeva.
  //
  // Il pattern non e inventato: e lo stesso di tests/auto_provision_secdef.test.ts
  // per l'ALTRA funzione SECURITY DEFINER del progetto (handle_new_user). La
  // differenza rispetto a quel test e che qui si asserisce il VALORE di proconfig,
  // non la sua presenza.
  //
  // MUTAZIONI CONCRETE che questo test rende ROSSE (tutte misurate/attese VERDI prima):
  //  1. `set search_path` RIMOSSO dalla funzione (mutazione A10 dell'audit) ->
  //     proconfig null;
  //  2. `set search_path = pg_temp, public` — lo schema TEMPORANEO davanti. Chiunque
  //     puo creare oggetti in pg_temp: `account_members` si risolverebbe li dentro e
  //     la funzione, che gira con i privilegi del PROPRIETARIO, leggerebbe la tabella
  //     dell'attaccante. E l'ORDINE a distinguere la forma sicura da quella hijackabile,
  //     e un controllo di sola presenza non lo vede;
  //  3. `set search_path = public` — NON e equivalente: se pg_temp non e elencato,
  //     Postgres lo cerca comunque e lo cerca PER PRIMO. Elencarlo per ULTIMO e cio
  //     che lo declassa. E per questo che la difesa e il valore esatto;
  //  4. una GUC AGGIUNTA alla funzione (`set row_security = off`, `set role = ...`):
  //     un controllo che cercasse solo la riga search_path non se ne accorgerebbe,
  //     l'uguaglianza dell'INTERO array si;
  //  5. `security definer` -> `security invoker`: la policy SELECT di account_members
  //     chiama questa funzione, che deve leggere account_members BYPASSANDO la RLS,
  //     altrimenti ricorsione infinita di policy;
  //  6. `stable` -> `volatile`: il planner non puo piu inlinare la funzione SQL nel
  //     predicato di policy (R9, caching); `stable` -> `immutable` e peggio, perche il
  //     risultato dipende da (select auth.uid()) e dal contenuto di account_members, e
  //     dichiararlo costante autorizza il planner a piegarlo a costante e riusarlo.
  it("is_account_member(uuid) e SECURITY DEFINER, STABLE, e il suo search_path vale ESATTAMENTE 'public, pg_temp' — in quest'ordine", async () => {
    const rows = await pgQuery<ProcRow>(IS_ACCOUNT_MEMBER_PROC_SQL);

    // Esattamente una funzione con questo nome: un OVERLOAD aggiunto (es. una
    // is_account_member(text) permissiva) sarebbe un secondo punto d'ingresso alle
    // policy, e questa uguaglianza lo prende.
    expect(rows).toHaveLength(1);
    const fn = rows[0];

    // Firma del contratto (DoD T-060): un solo parametro uuid, ritorna boolean.
    expect(fn.identity_args).toBe('a_id uuid');
    expect(fn.result_type).toBe('boolean');

    // SECURITY DEFINER: e cio che permette alla policy di leggere account_members
    // senza ricorsione. Toglierlo rompe la lettura, non la sicurezza — ma e comunque
    // una deviazione dal contratto, e va vista.
    expect(fn.prosecdef).toBe(true);

    // Volatilita del contratto: STABLE ('s'). Non VOLATILE ('v'), non IMMUTABLE ('i').
    expect(fn.provolatile).toBe('s');

    // proconfig per INTERO: una sola GUC pinnata sulla funzione, ed e il search_path
    // con il valore esatto. Questa singola riga copre le mutazioni 1, 2, 3 e 4.
    expect(fn.proconfig).toEqual([SEARCH_PATH_PINNED]);

    // La stessa cosa detta come PROPRIETA e non come stringa, perche sia il
    // FALLIMENTO a spiegare cosa e andato storto: la lista degli schemi, nell'ordine
    // di risoluzione dei nomi, con pg_temp per ULTIMO.
    const schemas = (fn.proconfig ?? [])[0]
      .slice('search_path='.length)
      .split(',')
      .map((s) => s.trim());
    expect(schemas).toEqual(['public', 'pg_temp']);
    expect(schemas[schemas.length - 1]).toBe('pg_temp');
  });

  // covers: AC-060-5 (il presupposto di), OLTRE gli AC per la parte sul GRANT esplicito
  //
  // PERCORSO POSITIVO (schema C dell'audit): gli oracoli di questa superficie provano
  // quasi solo che l'attaccante NON puo. Qui si prova che il chiamante LEGITTIMO puo:
  // `authenticated` deve poter ESEGUIRE la funzione, perche la chiama sia via RPC
  // (AC-060-5) sia dentro la policy SELECT, valutata come quel ruolo.
  //
  // Le DUE asserzioni non sono ridondanti, ed e questo il punto del rilievo T-01:
  //  - `revoke execute ... from public, authenticated` -> has_function_privilege
  //    diventa false: lo prende la prima;
  //  - la riga `grant execute on function public.is_account_member(uuid) to
  //    authenticated` CANCELLATA dalla migrazione -> proacl torna NULL, cioe il
  //    default (EXECUTE a PUBLIC), e has_function_privilege resta TRUE. La prima
  //    asserzione non se ne accorgerebbe. Lo prende solo la seconda, che pretende il
  //    GRANT ESPLICITO. E esattamente il caso contro cui la migrazione mette in
  //    guardia (righe 147-150: con auto_expose off il default a PUBLIC puo essere
  //    revocato, e allora la RPC dell'utente smette di funzionare).
  it('authenticated puo ESEGUIRE is_account_member, e per GRANT ESPLICITO — non per il default a PUBLIC', async () => {
    const rows = await pgQuery<ProcRow>(IS_ACCOUNT_MEMBER_PROC_SQL);
    expect(rows).toHaveLength(1);

    // (a) La proprieta semantica: il ruolo che chiama DEVE poter eseguire.
    expect(rows[0].authenticated_can_execute).toBe(true);

    // (b) Il GRANT esplicito e nell'ACL. Le voci hanno forma `grantee=PRIVS/grantor`;
    //     `X` e il privilegio EXECUTE.
    const acl = rows[0].acl ?? [];
    const authEntry = acl.find((e) => e.startsWith('authenticated='));
    expect(authEntry).toBeDefined();
    expect(authEntry!.split('/')[0].split('=')[1]).toContain('X');
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
