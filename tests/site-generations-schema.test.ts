import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgQuery } from './helpers/pg';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-200 (P2) — Schema account-scoped public.site_generations + public.generation_pools,
// RLS, FK composita, indice UNIQUE parziale e vincoli CHECK.
// Le asserzioni derivano dagli acceptance_criteria AC-200-1..10 (01-generation-model.md).
//
// Tre strati di verifica (stessa impostazione di T-100/T-120):
//  - CATALOGO (AC-200-1/2/4/10 + i supporti strutturali di AC-200-3/5/6/9): connessione
//    Postgres diretta (pgQuery) su pg_class/information_schema/pg_policies/pg_indexes —
//    PostgREST non espone i cataloghi.
//  - VINCOLI a runtime (AC-200-3/5/6/7/9) via pgQuery superuser: bypassa la RLS ma NON i
//    vincoli, quindi prova la difesa in profondita indipendente dalla RLS.
//  - RLS a runtime (AC-200-8/9) via client ad AUTH REALE (signInAs → JWT, ruolo
//    authenticated): l'SQL editor / la connessione superuser darebbero un FALSO VERDE.

const DB = !!process.env.DATABASE_URL;
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

type ColRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

const TABLES = ['site_generations', 'generation_pools'] as const;

describe.skipIf(!DB)('T-200 site_generations / generation_pools — schema e RLS (catalogo)', () => {
  // covers: AC-200-1
  it('RLS abilitata (relrowsecurity = true) su ENTRAMBE le tabelle', async () => {
    const rows = await pgQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where oid in ('public.site_generations'::regclass, 'public.generation_pools'::regclass)
        order by relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(['generation_pools', 'site_generations']); // covers: AC-200-1
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true); // covers: AC-200-1
    }
  });

  // covers: AC-200-2
  it('espone le colonne del contratto con tipi, nullability e default attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('site_generations', 'generation_pools')
        order by table_name, column_name`,
    );
    const gen = cols.filter((c) => c.table_name === 'site_generations');
    const pool = cols.filter((c) => c.table_name === 'generation_pools');
    const byGen = Object.fromEntries(gen.map((c) => [c.column_name, c]));
    const byPool = Object.fromEntries(pool.map((c) => [c.column_name, c]));

    // Insieme ESATTO delle colonne del contratto (nessuna in meno, nessuna in piu).
    expect(gen.map((c) => c.column_name)).toEqual([
      'account_id',
      'chosen_variant',
      'created_at',
      'document',
      'failure_reason',
      'id',
      'max_pages',
      'site_id',
      'status',
      'updated_at',
    ]); // covers: AC-200-2
    expect(pool.map((c) => c.column_name)).toEqual([
      'account_id',
      'content',
      'created_at',
      'generation_id',
      'id',
      'scope',
      'variant_index',
    ]); // covers: AC-200-2

    // ── site_generations ────────────────────────────────────────────────────
    // id uuid NOT NULL default gen_random_uuid()
    expect(byGen['id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byGen['id'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byGen['id'].column_default ?? '').toContain('gen_random_uuid()'); // covers: AC-200-2

    // account_id / site_id uuid NOT NULL
    expect(byGen['account_id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byGen['account_id'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byGen['site_id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byGen['site_id'].is_nullable).toBe('NO'); // covers: AC-200-2

    // status text NOT NULL default 'generating'
    expect(byGen['status'].data_type).toBe('text'); // covers: AC-200-2
    expect(byGen['status'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byGen['status'].column_default ?? '').toContain("'generating'"); // covers: AC-200-2

    // chosen_variant smallint NULLABLE
    expect(byGen['chosen_variant'].data_type).toBe('smallint'); // covers: AC-200-2
    expect(byGen['chosen_variant'].is_nullable).toBe('YES'); // covers: AC-200-2

    // document jsonb NULLABLE
    expect(byGen['document'].data_type).toBe('jsonb'); // covers: AC-200-2
    expect(byGen['document'].is_nullable).toBe('YES'); // covers: AC-200-2

    // max_pages smallint NOT NULL
    expect(byGen['max_pages'].data_type).toBe('smallint'); // covers: AC-200-2
    expect(byGen['max_pages'].is_nullable).toBe('NO'); // covers: AC-200-2

    // failure_reason text NULLABLE
    expect(byGen['failure_reason'].data_type).toBe('text'); // covers: AC-200-2
    expect(byGen['failure_reason'].is_nullable).toBe('YES'); // covers: AC-200-2

    // created_at / updated_at timestamptz NOT NULL default now().
    // La NULLABILITY qui non e decorativa (EMENDAMENTO P2-D22): sono il riferimento
    // temporale della riconciliazione di T-203, e una riga con entrambe NULL non ha eta,
    // quindi non e MAI stantia — resta 'generating' per sempre, tiene occupato l'indice
    // UNIQUE parziale e rende quel sito non piu generabile. Lo stato e stato verificato
    // RAPPRESENTABILE finche le due colonne erano NULLABLE (il solo `default now()` non
    // ferma una INSERT che passa NULL esplicito): senza queste due asserzioni la
    // migrazione tornerebbe indietro senza che nulla protesti.
    expect(byGen['created_at'].data_type).toBe('timestamp with time zone'); // covers: AC-200-2
    expect(byGen['created_at'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byGen['created_at'].column_default ?? '').toContain('now()'); // covers: AC-200-2
    expect(byGen['updated_at'].data_type).toBe('timestamp with time zone'); // covers: AC-200-2
    expect(byGen['updated_at'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byGen['updated_at'].column_default ?? '').toContain('now()'); // covers: AC-200-2

    // ── generation_pools ────────────────────────────────────────────────────
    expect(byPool['id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byPool['id'].is_nullable).toBe('NO'); // covers: AC-200-2
    expect(byPool['id'].column_default ?? '').toContain('gen_random_uuid()'); // covers: AC-200-2

    expect(byPool['account_id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byPool['account_id'].is_nullable).toBe('NO'); // covers: AC-200-2

    expect(byPool['generation_id'].data_type).toBe('uuid'); // covers: AC-200-2
    expect(byPool['generation_id'].is_nullable).toBe('NO'); // covers: AC-200-2

    expect(byPool['scope'].data_type).toBe('text'); // covers: AC-200-2
    expect(byPool['scope'].is_nullable).toBe('NO'); // covers: AC-200-2

    // variant_index smallint NULLABLE: NULL = pool condiviso fra le varianti.
    expect(byPool['variant_index'].data_type).toBe('smallint'); // covers: AC-200-2
    expect(byPool['variant_index'].is_nullable).toBe('YES'); // covers: AC-200-2

    expect(byPool['content'].data_type).toBe('jsonb'); // covers: AC-200-2
    expect(byPool['content'].is_nullable).toBe('NO'); // covers: AC-200-2

    expect(byPool['created_at'].data_type).toBe('timestamp with time zone'); // covers: AC-200-2
    expect(byPool['created_at'].column_default ?? '').toContain('now()'); // covers: AC-200-2
  });

  // covers: AC-200-3, AC-200-9 (struttura che produce i 23503 provati a runtime)
  // Insieme ESATTO delle FK delle due tabelle, non "esiste almeno una FK verso X":
  //  - una FK ATTESA che sparisce fa fallire (la FK account_id -> accounts della DoD e
  //    l'ON DELETE CASCADE delle composite non erano coperte da nulla, e droppare la
  //    prima o declassare la seconda a NO ACTION lasciava la suite verde);
  //  - una FK NON PREVISTA che compare fa fallire (una FK semplice su site_id o su
  //    generation_id che tornasse ad affiancare la composita direbbe di nuovo solo
  //    "esiste", riaprendo lo squatting cross-tenant senza che nessuno protesti).
  it('espone ESATTAMENTE le FK attese sulle due tabelle — composite verso sites e site_generations, semplici verso accounts — tutte ON DELETE CASCADE', async () => {
    const fks = await pgQuery<{
      tbl: string;
      conname: string;
      def: string;
      confdeltype: string;
    }>(
      `select cl.relname as tbl, c.conname, pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
         join pg_class cl on cl.oid = c.conrelid
        where c.conrelid in ('public.site_generations'::regclass, 'public.generation_pools'::regclass)
          and c.contype = 'f'`,
    );
    // pg_get_constraintdef rende i nomi secondo il search_path: `public.` puo comparire
    // o no. E l'unica normalizzazione — colonne, tabella referenziata e azione di
    // cancellazione restano confrontate alla lettera.
    const shape = fks
      .map((r) => ({
        tbl: r.tbl,
        conname: r.conname,
        def: r.def.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim(),
        confdeltype: r.confdeltype,
      }))
      .sort((a, b) => `${a.tbl}.${a.conname}`.localeCompare(`${b.tbl}.${b.conname}`));

    expect(shape).toEqual([
      {
        tbl: 'generation_pools',
        conname: 'generation_pools_account_generation_fk',
        def: 'FOREIGN KEY (account_id, generation_id) REFERENCES site_generations(account_id, id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-200-9
      {
        tbl: 'generation_pools',
        conname: 'generation_pools_account_id_fkey',
        def: 'FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-200-9
      {
        tbl: 'site_generations',
        conname: 'site_generations_account_id_fkey',
        def: 'FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-200-3
      {
        tbl: 'site_generations',
        conname: 'site_generations_account_site_fk',
        def: 'FOREIGN KEY (account_id, site_id) REFERENCES sites(account_id, id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-200-3
    ]);

    // Chiave referenziata: senza (account_id, id) unique su site_generations la FK
    // composita di generation_pools non sarebbe nemmeno creabile. E l'UNICO vincolo
    // UNIQUE della tabella (l'indice parziale one-in-flight e un indice, non un
    // constraint, quindi non compare qui).
    const uq = await pgQuery<{ conname: string; def: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_generations'::regclass and c.contype = 'u'`,
    );
    expect(uq.map((r) => ({ conname: r.conname, def: r.def.replace(/\s+/g, ' ') }))).toEqual([
      { conname: 'site_generations_account_id_id_key', def: 'UNIQUE (account_id, id)' },
    ]); // covers: AC-200-9
  });

  // covers: AC-200-4
  // L'espressione e asserita per INTERO, non per contenimento: una policy
  // `is_account_member(account_id) or true` CONTIENE sia 'account_id' sia
  // 'is_account_member' e non isola nulla, e nemmeno un controllo di "costante true"
  // la intercetta, perche valuta l'espressione intera. Solo l'uguaglianza esatta
  // distingue la policy giusta da una plausibilmente sbagliata.
  it("ENTRAMBE le tabelle hanno policy SELECT/INSERT/UPDATE/DELETE TO authenticated, e l'espressione di ciascuna e ESATTAMENTE is_account_member(account_id) nella clausola giusta", async () => {
    const pols = await pgQuery<{
      tablename: string;
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select tablename, cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public'
          and tablename in ('site_generations', 'generation_pools')`,
    );

    // pg_policies rende l'espressione secondo il search_path: `public.` puo comparire
    // o no. E l'unica normalizzazione ammessa — non allenta nulla del predicato.
    const norm = (e: string | null): string | null =>
      e == null ? null : e.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();
    const EXPR = 'is_account_member(account_id)';

    for (const table of TABLES) {
      const own = pols.filter((p) => p.tablename === table);
      // Insieme ESATTO dei comandi coperti (non "contiene"): quattro policy, una per
      // comando. R6 (UPDATE accompagnata da SELECT) e implicata da questo insieme.
      expect(own.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']); // covers: AC-200-4
      for (const p of own) {
        expect(p.roles).toEqual(['authenticated']); // covers: AC-200-4 (R5)
      }
      const byCmd = Object.fromEntries(own.map((p) => [p.cmd, p]));

      // USING sulle righe leggibili/modificabili/cancellabili; WITH CHECK su quelle
      // scrivibili. La clausola VUOTA e asserita a null: un WITH CHECK inatteso su
      // SELECT/DELETE, o un USING inatteso su INSERT, e comunque una deviazione.
      expect(norm(byCmd['SELECT'].qual)).toBe(EXPR); // covers: AC-200-4 (R3, R4)
      expect(byCmd['SELECT'].with_check).toBeNull(); // covers: AC-200-4

      expect(byCmd['INSERT'].qual).toBeNull(); // covers: AC-200-4
      expect(norm(byCmd['INSERT'].with_check)).toBe(EXPR); // covers: AC-200-4 (R3, R4)

      // UPDATE ha ENTRAMBE: USING filtra le righe modificabili, WITH CHECK impedisce
      // di "spostare" la riga in un account non proprio riscrivendo account_id.
      expect(norm(byCmd['UPDATE'].qual)).toBe(EXPR); // covers: AC-200-4 (R3, R4)
      expect(norm(byCmd['UPDATE'].with_check)).toBe(EXPR); // covers: AC-200-4 (R3, R4)

      expect(norm(byCmd['DELETE'].qual)).toBe(EXPR); // covers: AC-200-4 (R3, R4)
      expect(byCmd['DELETE'].with_check).toBeNull(); // covers: AC-200-4
    }
  });

  // covers: AC-200-5 (struttura che produce il 23505 provato a runtime)
  it("esiste UN SOLO indice UNIQUE PARZIALE su site_generations (site_id) WHERE status = 'generating'", async () => {
    const idx = await pgQuery<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'site_generations'`,
    );
    const partial = idx
      .map((r) => r.indexdef.replace(/\s+/g, ' '))
      .filter((d) => /create unique index/i.test(d) && / where /i.test(d));
    expect(partial).toHaveLength(1); // covers: AC-200-5
    expect(partial[0]).toMatch(/\(site_id\)/i); // covers: AC-200-5
    expect(partial[0]).toMatch(/where \(status = 'generating'::text\)/i); // covers: AC-200-5
    // Nessun indice unique NON parziale su site_id: bloccherebbe le generazioni
    // successive dello stesso sito (1:N) invece della sola doppia generazione in volo.
    const totalUnique = idx.filter((r) => /create unique index/i.test(r.indexdef));
    const nonPartialOnSiteId = totalUnique.filter(
      (r) => /\(site_id\)/i.test(r.indexdef) && !/ where /i.test(r.indexdef.replace(/\s+/g, ' ')),
    );
    expect(nonPartialOnSiteId).toHaveLength(0); // covers: AC-200-5
  });

  // covers: AC-200-6 (struttura che produce il 23505 sulla terna)
  it('generation_pools ha il vincolo UNIQUE sulla terna (generation_id, scope, variant_index)', async () => {
    const uq = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.generation_pools'::regclass and c.contype = 'u'`,
    );
    expect(uq).toHaveLength(1); // covers: AC-200-6
    // NULLS NOT DISTINCT e ammesso (ed e il modo con cui il NULL di variant_index
    // resta comunque unico), ma il contratto e la terna esatta in quest'ordine.
    expect(uq[0].def.replace(/\s+/g, ' ')).toMatch(
      /^UNIQUE( NULLS NOT DISTINCT)? \(generation_id, scope, variant_index\)$/i,
    ); // covers: AC-200-6
  });

  // (DoD "indici btree su ..." / R9 — colonne di policy e di join indicizzate; nessun
  // AC dedicato)
  // L'indice su site_id va cercato COMPLETO: site_generations_one_in_flight_idx e
  // anch'esso `USING btree (site_id)`, quindi un controllo che si fermi a "esiste un
  // btree che nomina (site_id)" e soddisfatto dal solo indice PARZIALE e non si accorge
  // della sparizione di quello completo — che e proprio l'indice che serve alle letture
  // fuori da status='generating' (getGeneration, T-203). Da qui le due esclusioni
  // (`create unique index` e ` where `) e l'insieme ESATTO dei nomi.
  it('espone ESATTAMENTE gli indici attesi, e i btree su account_id/site_id/generation_id sono COMPLETI (non parziali, non unique)', async () => {
    const idx = await pgQuery<{ tablename: string; indexname: string; indexdef: string }>(
      `select tablename, indexname, indexdef from pg_indexes
        where schemaname = 'public'
          and tablename in ('site_generations', 'generation_pools')`,
    );
    const namesOf = (table: string): string[] =>
      idx
        .filter((r) => r.tablename === table)
        .map((r) => r.indexname)
        .sort();

    // Insieme ESATTO: rompe se un indice atteso sparisce E se ne compare uno non
    // previsto (un unique in piu su una colonna di dominio cambierebbe in silenzio la
    // cardinalita ammessa).
    expect(namesOf('site_generations')).toEqual([
      'site_generations_account_id_id_key', // indice del vincolo UNIQUE (account_id, id)
      'site_generations_account_id_idx', // R9: colonna di policy
      'site_generations_one_in_flight_idx', // UNIQUE PARZIALE, una sola in volo
      'site_generations_pkey',
      'site_generations_site_id_idx', // R9: colonna di join/lettura, COMPLETO
    ]);
    expect(namesOf('generation_pools')).toEqual([
      'generation_pools_account_id_idx', // R9: colonna di policy
      'generation_pools_generation_id_idx', // R9: colonna di join
      'generation_pools_generation_id_scope_variant_index_key', // indice del vincolo UNIQUE
      'generation_pools_pkey',
    ]);

    // btree COMPLETO su ESATTAMENTE quella colonna: non parziale (nessun WHERE), non
    // unique, e su una sola colonna (l'ancora `)$` esclude un composito che la porti
    // solo come prefisso).
    const plainBtreeOn = (table: string, col: string): boolean =>
      idx.some((r) => {
        const def = r.indexdef.replace(/\s+/g, ' ');
        return (
          r.tablename === table &&
          !/create unique index/i.test(def) &&
          !/ where /i.test(def) &&
          new RegExp(`USING btree \\(${col}\\)$`, 'i').test(def)
        );
      });
    expect(plainBtreeOn('site_generations', 'account_id')).toBe(true);
    expect(plainBtreeOn('site_generations', 'site_id')).toBe(true);
    expect(plainBtreeOn('generation_pools', 'account_id')).toBe(true);
    expect(plainBtreeOn('generation_pools', 'generation_id')).toBe(true);
  });

  // covers: AC-200-10 (DoD 10 / R7 — GRANT DML espliciti a authenticated e service_role,
  // NESSUN privilegio ad anon)
  // Le default privileges della piattaforma Supabase concedono da sole REFERENCES /
  // TRIGGER / TRUNCATE ad anon su OGNI nuova tabella di public: "non concedere" non
  // equivale a "non avere". La migrazione le annulla con un REVOKE ALL esplicito, quindi
  // qui si asserisce ZERO privilegi di QUALUNQUE tipo per anon — non zero DML.
  it('concede select/insert/update/delete a authenticated e service_role, e ZERO privilegi di qualunque tipo ad anon', async () => {
    const DML = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    // Nessun filtro su privilege_type: un privilegio non-DML residuo deve far fallire.
    const grants = await pgQuery<{ table_name: string; grantee: string; privilege_type: string }>(
      `select table_name, grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('site_generations', 'generation_pools')
          and grantee in ('anon', 'authenticated', 'service_role')`,
    );
    const privsOf = (table: string, grantee: string): string[] =>
      grants
        .filter((g) => g.table_name === table && g.grantee === grantee)
        .map((g) => g.privilege_type)
        .sort();
    const dmlOf = (table: string, grantee: string): string[] =>
      privsOf(table, grantee).filter((p) => DML.includes(p));
    for (const table of TABLES) {
      expect(dmlOf(table, 'authenticated')).toEqual(DML); // covers: AC-200-10
      expect(dmlOf(table, 'service_role')).toEqual(DML); // covers: AC-200-10
      // anon: insieme VUOTO, non "vuoto di DML".
      expect(privsOf(table, 'anon')).toEqual([]); // covers: AC-200-10
    }
  });
});

describe.skipIf(!SB)(
  'T-200 site_generations / generation_pools a runtime (vincoli + isolamento cross-tenant)',
  () => {
    const password = 'Password123!';
    const emailA = `t200a_${randomUUID()}@example.test`;
    const emailB = `t200b_${randomUUID()}@example.test`;
    let userAId = '';
    let userBId = '';
    let accountX = '';
    let accountY = '';
    // Fixture DISCORDANTI: piu siti per l'account X, con 'gen-a' PREFISSO di 'gen-a-2'
    // per smascherare confronti per prefisso/substring; Y ha uno slug OMONIMO ('gen-a')
    // in un altro account, cosi l'identita non puo essere dedotta dallo slug.
    let siteA1 = ''; // X, slug 'gen-a'
    let siteA2 = ''; // X, slug 'gen-a-2'  (prefisso di A1 → trappola)
    let siteB = ''; // X, slug 'gen-b'
    let siteC = ''; // X, slug 'gen-c'
    let siteD = ''; // X, slug 'gen-d'
    let siteYown = ''; // Y, slug 'gen-a'  (omonimo di A1, altro tenant)
    let genXReady = ''; // generazione di X su siteC (bersaglio cross-tenant)
    let genXOther = ''; // seconda generazione di X su siteB (controllo negativo AC-200-6)
    let genYOwn = ''; // generazione di Y su siteYown (B deve VEDERE le proprie righe)

    const insertGeneration = async (
      accountId: string,
      siteId: string,
      status: string,
      maxPages: number,
    ): Promise<string> => {
      const rows = await pgQuery<{ id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages)
         values ($1, $2, $3, $4) returning id`,
        [accountId, siteId, status, maxPages],
      );
      return rows[0].id;
    };

    const insertPool = async (
      accountId: string,
      generationId: string,
      scope: string,
      variantIndex: number | null,
    ): Promise<string> => {
      const rows = await pgQuery<{ id: string }>(
        `insert into public.generation_pools (account_id, generation_id, scope, variant_index, content)
         values ($1, $2, $3, $4, $5::jsonb) returning id`,
        [
          accountId,
          generationId,
          scope,
          variantIndex,
          JSON.stringify({ pages: { home: { hero_title: `${scope}-${variantIndex}` } } }),
        ],
      );
      return rows[0].id;
    };

    // Il timeout esplicito e infrastruttura, non un allentamento: il setup crea due
    // utenti con auth reale (bcrypt su Supabase locale) e supera i 10s di default dei
    // hook di vitest. Le fixture sono inserite in poche query multi-riga perche
    // pgQuery apre una connessione per chiamata.
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
      accountX = (accs ?? []).find((r) => r.owner_id === userAId)!.id as string;
      accountY = (accs ?? []).find((r) => r.owner_id === userBId)!.id as string;

      const siteRows = await pgQuery<{ id: string; slug: string; account_id: string }>(
        `insert into public.sites (account_id, name, slug)
         values ($1, 'Sito gen-a',   'gen-a'),
                ($1, 'Sito gen-a-2', 'gen-a-2'),
                ($1, 'Sito gen-b',   'gen-b'),
                ($1, 'Sito gen-c',   'gen-c'),
                ($1, 'Sito gen-d',   'gen-d'),
                ($2, 'Sito gen-a',   'gen-a')
         returning id, slug, account_id`,
        [accountX, accountY],
      );
      const siteOf = (accountId: string, slug: string): string =>
        siteRows.find((r) => r.account_id === accountId && r.slug === slug)!.id;
      siteA1 = siteOf(accountX, 'gen-a');
      siteA2 = siteOf(accountX, 'gen-a-2');
      siteB = siteOf(accountX, 'gen-b');
      siteC = siteOf(accountX, 'gen-c');
      siteD = siteOf(accountX, 'gen-d');
      siteYown = siteOf(accountY, 'gen-a');
      // Lo slug omonimo vive in due tenant diversi: due id DISTINTI.
      expect(siteA1).not.toBe(siteYown);

      // max_pages DISCORDANTI fra le generazioni: un confronto sbagliato non puo
      // passare per coincidenza di valori.
      const genRows = await pgQuery<{ id: string; site_id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages)
         values ($1, $2, 'ready', 8), ($1, $3, 'ready', 3), ($4, $5, 'ready', 5)
         returning id, site_id`,
        [accountX, siteC, siteB, accountY, siteYown],
      );
      genXReady = genRows.find((r) => r.site_id === siteC)!.id;
      genXOther = genRows.find((r) => r.site_id === siteB)!.id;
      genYOwn = genRows.find((r) => r.site_id === siteYown)!.id;

      // Un pool per tenant, cosi la SELECT di B che vede le PROPRIE righe ma non
      // quelle di X prova l'isolamento (una SELECT vuota non proverebbe nulla).
      await pgQuery(
        `insert into public.generation_pools (account_id, generation_id, scope, variant_index, content)
         values ($1, $2, 'inner', 3, '{"pages":{"home":{"hero_title":"setup-x"}}}'::jsonb),
                ($3, $4, 'inner', 1, '{"pages":{"home":{"hero_title":"setup-y"}}}'::jsonb)`,
        [accountX, genXReady, accountY, genYOwn],
      );
    }, 60_000);

    afterAll(async () => {
      // cascade: auth.users → accounts → sites → site_generations → generation_pools
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-200-3
    it('la FK COMPOSITA respinge il site-squatting cross-tenant (23503) e accetta la coppia coerente', async () => {
      // Y prova ad ancorare la propria generazione al sito di X.
      await expect(insertGeneration(accountY, siteC, 'ready', 4)).rejects.toMatchObject({
        code: '23503',
      }); // covers: AC-200-3
      // Vettore inverso: X verso il sito di Y.
      await expect(insertGeneration(accountX, siteYown, 'ready', 4)).rejects.toMatchObject({
        code: '23503',
      }); // covers: AC-200-3

      // CONTROLLO NEGATIVO: la coppia (account, sito) coerente e ACCETTATA per
      // ENTRAMBI i tenant — la FK non sta semplicemente rifiutando tutto.
      const okX = await insertGeneration(accountX, siteD, 'ready', 2);
      expect(okX).toBeTruthy(); // covers: AC-200-3
      const okY = await insertGeneration(accountY, siteYown, 'ready', 2);
      expect(okY).toBeTruthy(); // covers: AC-200-3

      // Le due righe accettate sono ancorate ESATTAMENTE alla coppia richiesta. (Un
      // `expect(okX).not.toBe(okY)` sarebbe stato una tautologia: sono due
      // gen_random_uuid() indipendenti e non possono coincidere.)
      const back = await pgQuery<{ id: string; account_id: string; site_id: string }>(
        `select id, account_id, site_id
           from public.site_generations
          where id = any($1::uuid[])`,
        [[okX, okY]],
      );
      expect(back).toHaveLength(2); // covers: AC-200-3
      expect(back.find((r) => r.id === okX)).toMatchObject({
        account_id: accountX,
        site_id: siteD,
      }); // covers: AC-200-3
      expect(back.find((r) => r.id === okY)).toMatchObject({
        account_id: accountY,
        site_id: siteYown,
      }); // covers: AC-200-3
    });

    // covers: AC-200-5
    it("una sola generazione 'generating' per sito (23505); altri status e altri siti restano accettati", async () => {
      const first = await insertGeneration(accountX, siteA1, 'generating', 6);
      expect(first).toBeTruthy(); // covers: AC-200-5

      await expect(insertGeneration(accountX, siteA1, 'generating', 6)).rejects.toMatchObject({
        code: '23505',
      }); // covers: AC-200-5

      // Stesso sito, status FUORI dal predicato parziale: accettato (1:N nel tempo).
      const failed = await insertGeneration(accountX, siteA1, 'failed', 6);
      expect(failed).toBeTruthy(); // covers: AC-200-5

      // CONTROLLO NEGATIVO: 'generating' su un sito DIVERSO (slug 'gen-a-2', di cui
      // 'gen-a' e prefisso) e ACCETTATO. Senza questa asserzione il test passerebbe
      // anche con un indice unique GLOBALE, che bloccherebbe tutti gli altri clienti.
      const otherSite = await insertGeneration(accountX, siteA2, 'generating', 6);
      expect(otherSite).toBeTruthy(); // covers: AC-200-5

      // E anche un altro tenant puo avere la propria generazione in volo.
      const otherTenant = await insertGeneration(accountY, siteYown, 'generating', 6);
      expect(otherTenant).toBeTruthy(); // covers: AC-200-5

      // ORACOLO che DISCRIMINA, al posto dei confronti fra uuid appena generati (che
      // non potevano fallire): quante righe e quante IN VOLO esistono per sito. E la
      // forma esatta del contratto — 1:N nel tempo, ma una sola sotto 'generating' —
      // e cade sia se l'indice parziale sparisse (in_flight = 2) sia se diventasse
      // totale (la riga 'failed' non sarebbe mai entrata e total = 1).
      const perSite = await pgQuery<{ site_id: string; total: number; in_flight: number }>(
        `select site_id,
                count(*)::int as total,
                (count(*) filter (where status = 'generating'))::int as in_flight
           from public.site_generations
          where site_id = any($1::uuid[])
          group by site_id`,
        [[siteA1, siteA2, siteYown]],
      );
      const bySite = Object.fromEntries(perSite.map((r) => [r.site_id, r]));
      expect(bySite[siteA1]).toMatchObject({ total: 2, in_flight: 1 }); // covers: AC-200-5
      expect(bySite[siteA2]).toMatchObject({ total: 1, in_flight: 1 }); // covers: AC-200-5
      // siteYown porta la riga 'ready' del setup, quella 'ready' del test AC-200-3 e
      // questa 'generating': l'altro tenant NON e stato ostacolato.
      expect(bySite[siteYown]).toMatchObject({ total: 3, in_flight: 1 }); // covers: AC-200-5
    });

    // covers: AC-200-6
    it('la terna (generation_id, scope, variant_index) e unica anche con variant_index NULL, ma solo dentro la stessa generazione', async () => {
      const shared = await insertPool(accountX, genXReady, 'home', null);
      expect(shared).toBeTruthy(); // covers: AC-200-6

      // Il caso che il default NULLS DISTINCT di Postgres lascerebbe passare.
      await expect(insertPool(accountX, genXReady, 'home', null)).rejects.toMatchObject({
        code: '23505',
      }); // covers: AC-200-6

      // scope diverso o variante diversa sulla STESSA generazione: accettati.
      expect(await insertPool(accountX, genXReady, 'inner', null)).toBeTruthy(); // covers: AC-200-6
      const variant2 = await insertPool(accountX, genXReady, 'home', 2);
      expect(variant2).toBeTruthy(); // covers: AC-200-6
      // ...e il duplicato con variante NON nulla e comunque respinto.
      await expect(insertPool(accountX, genXReady, 'home', 2)).rejects.toMatchObject({
        code: '23505',
      }); // covers: AC-200-6

      // CONTROLLO NEGATIVO: la STESSA terna su una generazione DIVERSA e ACCETTATA.
      // Senza, il test passerebbe anche con un unique che ignora generation_id.
      const onOtherGeneration = await insertPool(accountX, genXOther, 'home', null);
      expect(onOtherGeneration).toBeTruthy(); // covers: AC-200-6

      // ORACOLO che DISCRIMINA, al posto del confronto fra due uuid appena generati:
      // la terna ('home', NULL) esiste UNA volta per CIASCUNA delle due generazioni.
      // Cioe l'unicita e PER GENERAZIONE — un unique globale su (scope, variant_index)
      // darebbe una riga sola in tutto, un unique assente ne darebbe due su genXReady.
      const perGen = await pgQuery<{ generation_id: string; n: number }>(
        `select generation_id, count(*)::int as n
           from public.generation_pools
          where generation_id = any($1::uuid[])
            and scope = 'home' and variant_index is null
          group by generation_id`,
        [[genXReady, genXOther]],
      );
      const byGen = Object.fromEntries(perGen.map((r) => [r.generation_id, r.n]));
      expect(byGen[genXReady]).toBe(1); // covers: AC-200-6
      expect(byGen[genXOther]).toBe(1); // covers: AC-200-6
    });

    // covers: AC-200-7
    it("status='queued' e chosen_variant=5 violano i CHECK (23514)", async () => {
      await expect(insertGeneration(accountX, siteD, 'queued', 4)).rejects.toMatchObject({
        code: '23514',
      }); // covers: AC-200-7
      await expect(
        pgQuery(
          `insert into public.site_generations (account_id, site_id, status, max_pages, chosen_variant)
           values ($1, $2, 'ready', 4, 5)`,
          [accountX, siteD],
        ),
      ).rejects.toMatchObject({ code: '23514' }); // covers: AC-200-7

      // CONTROLLO NEGATIVO: i valori DENTRO il vocabolario/intervallo sono accettati —
      // il CHECK non sta rifiutando tutto.
      const ok = await pgQuery<{ id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages, chosen_variant)
         values ($1, $2, 'chosen', 4, 4) returning id`,
        [accountX, siteD],
      );
      expect(ok[0].id).toBeTruthy(); // covers: AC-200-7
    });

    // (DoD 4 e 6 — resto del vocabolario vincolato; nessun AC dedicato)
    it('chosen_variant negativo, max_pages < 1, scope fuori vocabolario e variant_index fuori 0..4 violano i CHECK (23514)', async () => {
      await expect(
        pgQuery(
          `insert into public.site_generations (account_id, site_id, status, max_pages, chosen_variant)
           values ($1, $2, 'ready', 4, -1)`,
          [accountX, siteD],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(insertGeneration(accountX, siteD, 'ready', 0)).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertPool(accountX, genXOther, 'blog', null)).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertPool(accountX, genXOther, 'home', 5)).rejects.toMatchObject({
        code: '23514',
      });
    });

    // covers: AC-200-8
    it('un utente non membro non legge ne scrive generazioni e pool di un altro account (RLS, client ad AUTH REALE)', async () => {
      const clientB = await signInAs(emailB, password);
      const admin = adminClient();
      // Marcatori riconoscibili: l'oracolo service_role cerca ESATTAMENTE questi.
      const squatMaxPages = 99;
      const squatVariant = 4;

      // (a) SELECT site_generations: B vede le PROPRIE righe e NESSUNA di X.
      const { data: genSeen, error: genErr } = await clientB
        .from('site_generations')
        .select('id, account_id, site_id');
      expect(genErr).toBeNull(); // covers: AC-200-8
      const seenGen = genSeen ?? [];
      expect(seenGen.map((r) => r.id)).toContain(genYOwn); // covers: AC-200-8
      expect(seenGen.map((r) => r.id)).not.toContain(genXReady); // covers: AC-200-8
      expect(seenGen.map((r) => r.id)).not.toContain(genXOther); // covers: AC-200-8
      expect(seenGen.every((r) => r.account_id === accountY)).toBe(true); // covers: AC-200-8
      expect(seenGen.some((r) => r.site_id === siteC)).toBe(false); // covers: AC-200-8

      // (b) SELECT generation_pools: idem.
      const { data: poolSeen, error: poolErr } = await clientB
        .from('generation_pools')
        .select('id, account_id, generation_id');
      expect(poolErr).toBeNull(); // covers: AC-200-8
      const seenPool = poolSeen ?? [];
      expect(seenPool.map((r) => r.generation_id)).toContain(genYOwn); // covers: AC-200-8
      expect(seenPool.some((r) => r.generation_id === genXReady)).toBe(false); // covers: AC-200-8
      expect(seenPool.every((r) => r.account_id === accountY)).toBe(true); // covers: AC-200-8

      // (c) INSERT site_generations con l'account_id di X: la WITH CHECK blocca.
      const insForeignAccount = await clientB
        .from('site_generations')
        .insert({
          account_id: accountX,
          site_id: siteC,
          status: 'ready',
          max_pages: squatMaxPages,
        })
        .select();
      // Codice REALE osservato, non una disgiunzione. La forma precedente
      // (`error !== null || data vuoto`) e soddisfatta da QUALUNQUE errore, quindi
      // resta verde anche quando l'INSERT viene fermato da qualcosa che non c'entra
      // con la tenancy e il gate RLS non viene esercitato affatto: verificato
      // aggiungendo un CHECK estraneo su max_pages, che fa arrivare 23514 al posto del
      // codice atteso: la disgiunzione non se ne accorgeva, l'uguaglianza si.
      // 42501 = new row violates row-level security policy.
      expect(insForeignAccount.error?.code).toBe('42501'); // covers: AC-200-8
      expect(insForeignAccount.data ?? []).toEqual([]); // covers: AC-200-8

      // (c2) INSERT col PROPRIO account ma il sito di X: la FK composita blocca.
      const insForeignSite = await clientB
        .from('site_generations')
        .insert({
          account_id: accountY,
          site_id: siteC,
          status: 'ready',
          max_pages: squatMaxPages,
        })
        .select();
      // Qui il codice REALE e 23503, NON 42501: l'account_id e il proprio, quindi la
      // WITH CHECK e soddisfatta e a fermare l'INSERT e la FK composita. La differenza
      // fra i due codici e la prova che i due gate sono DISTINTI e agiscono entrambi.
      expect(insForeignSite.error?.code).toBe('23503'); // covers: AC-200-8
      expect(insForeignSite.data ?? []).toEqual([]); // covers: AC-200-8

      // (d) INSERT generation_pools verso la generazione di X.
      const insForeignPool = await clientB
        .from('generation_pools')
        .insert({
          account_id: accountX,
          generation_id: genXReady,
          scope: 'home',
          variant_index: squatVariant,
          content: { pages: { home: { hero_title: 'squat' } } },
        })
        .select();
      expect(insForeignPool.error?.code).toBe('42501'); // covers: AC-200-8
      expect(insForeignPool.data ?? []).toEqual([]); // covers: AC-200-8

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): nessuna riga di B e
      // finita nel tenant X. Non ci si fida del solo errore restituito a B.
      const { data: sgOracle } = await admin
        .from('site_generations')
        .select('id, max_pages')
        .eq('site_id', siteC);
      expect((sgOracle ?? []).some((r) => r.max_pages === squatMaxPages)).toBe(false); // covers: AC-200-8
      const { data: gpOracle } = await admin
        .from('generation_pools')
        .select('id, variant_index')
        .eq('generation_id', genXReady);
      expect((gpOracle ?? []).some((r) => r.variant_index === squatVariant)).toBe(false); // covers: AC-200-8

      // CONTROLLO NEGATIVO: nel PROPRIO account B scrive senza ostacoli — la RLS
      // isola per tenant, non blocca tutto (una denial universale non proverebbe nulla).
      const ownWrite = await clientB
        .from('generation_pools')
        .insert({
          account_id: accountY,
          generation_id: genYOwn,
          scope: 'home',
          variant_index: null,
          content: { pages: { home: { hero_title: 'mio' } } },
        })
        .select();
      expect(ownWrite.error).toBeNull(); // covers: AC-200-8
      expect((ownWrite.data ?? []).length).toBe(1); // covers: AC-200-8
    });

    // covers: AC-200-8, AC-200-9
    // Il vettore che la sola RLS NON copre: B usa il PROPRIO account_id — legittimo per
    // la WITH CHECK, che guarda solo account_id — e la generazione di X. Prima della FK
    // composita questo INSERT RIUSCIVA, e occupava lo slot UNIQUE (generation_id, scope,
    // variant_index) della generazione di X: X veniva poi respinto con 23505 sul proprio
    // pool condiviso. Il payload con account_id ALTRUI (caso (d) qui sopra) e un vettore
    // DIVERSO e piu debole: era gia bloccato, e da solo non prova nulla su questo.
    it('la FK COMPOSITA di generation_pools respinge il pool ancorato alla generazione di un ALTRO tenant (23503) sia via client ad AUTH REALE sia via connessione diretta, e accetta la coppia coerente', async () => {
      // Bersaglio dedicato, con gli slot ancora liberi: l'esito non dipende dall'ordine
      // degli altri test. Tutti e tre i tentativi qui sotto usano la STESSA terna
      // ('home', NULL), cosi l'unica variabile fra respinto e accettato e account_id.
      const genTarget = await insertGeneration(accountX, siteD, 'ready', 7);
      const clientB = await signInAs(emailB, password);
      const admin = adminClient();

      // (a) VIA CLIENT AD AUTH REALE (ruolo authenticated, JWT di B).
      const squat = await clientB
        .from('generation_pools')
        .insert({
          account_id: accountY, // il PROPRIO: la RLS non ha nulla da obiettare
          generation_id: genTarget, // la generazione di X
          scope: 'home',
          variant_index: null,
          content: { pages: { home: { hero_title: 'squat-pool' } } },
        })
        .select();
      expect(squat.error?.code).toBe('23503'); // covers: AC-200-8, AC-200-9
      expect(squat.data ?? []).toEqual([]); // covers: AC-200-8

      // (b) VIA CONNESSIONE DIRETTA (superuser: RLS BYPASSATA, vincoli NO). Prova che la
      // difesa regge anche a una chiamata PostgREST diretta che aggirasse il codice
      // applicativo: e il vincolo a tenere, non la policy.
      await expect(insertPool(accountY, genTarget, 'home', null)).rejects.toMatchObject({
        code: '23503',
      }); // covers: AC-200-9
      // Vettore inverso: X verso la generazione di Y.
      await expect(insertPool(accountX, genYOwn, 'home', 4)).rejects.toMatchObject({
        code: '23503',
      }); // covers: AC-200-9

      // CONTROLLO NEGATIVO: la STESSA terna con la coppia COERENTE e ACCETTATA — il
      // vincolo distingue l'account discordante, non vieta ogni scrittura.
      const coherent = await insertPool(accountX, genTarget, 'home', null);
      expect(coherent).toBeTruthy(); // covers: AC-200-9
      // ...e anche dal client ad auth reale, sulla PROPRIA generazione.
      const ownCoherent = await clientB
        .from('generation_pools')
        .insert({
          account_id: accountY,
          generation_id: genYOwn,
          scope: 'inner',
          variant_index: 0,
          content: { pages: { home: { hero_title: 'mio-coerente' } } },
        })
        .select();
      expect(ownCoherent.error).toBeNull(); // covers: AC-200-8
      expect((ownCoherent.data ?? []).length).toBe(1); // covers: AC-200-8

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): sulla generazione di X esiste
      // la SOLA riga coerente, e nessuna riga porta un account_id diverso da quello della
      // generazione. Non ci si fida del solo errore restituito a B.
      const { data: poolsOnTarget } = await admin
        .from('generation_pools')
        .select('id, account_id')
        .eq('generation_id', genTarget);
      expect((poolsOnTarget ?? []).map((r) => r.id)).toEqual([coherent]); // covers: AC-200-8
      expect((poolsOnTarget ?? []).every((r) => r.account_id === accountX)).toBe(true); // covers: AC-200-8
      expect((poolsOnTarget ?? []).some((r) => r.account_id === accountY)).toBe(false); // covers: AC-200-8
    });
  },
);
