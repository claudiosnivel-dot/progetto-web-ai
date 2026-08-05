import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgQuery } from './helpers/pg';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-301 (macrotask editor-core, P3) — Schema account-scoped public.site_document_revisions,
// RLS per-tenant, FK COMPOSITA verso site_generations, vincoli CHECK/UNIQUE e append-only.
// Le asserzioni derivano dagli acceptance_criteria AC-301-1..4 (01-editor-core.md).
//
// Tre strati di verifica (stessa impostazione di T-100/T-120/T-200):
//  - CATALOGO (AC-301-1 + i supporti strutturali di AC-301-3/4): connessione Postgres
//    diretta (pgQuery) su pg_class/information_schema/pg_policies/pg_constraint/pg_indexes
//    — PostgREST non espone i cataloghi.
//  - VINCOLI a runtime (AC-301-3/4) via pgQuery superuser: bypassa la RLS ma NON i
//    vincoli, quindi prova la difesa in profondita indipendente dalla RLS.
//  - RLS a runtime (AC-301-2/3) via client ad AUTH REALE (signInAs → JWT, ruolo
//    authenticated): l'SQL editor / la connessione superuser darebbero un FALSO VERDE.

const DB = !!process.env.DATABASE_URL;
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

type ColRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe.skipIf(!DB)('T-301 site_document_revisions — schema, RLS, vincoli (catalogo)', () => {
  // covers: AC-301-1
  it('RLS abilitata (relrowsecurity = true) sulla tabella', async () => {
    const rows = await pgQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where oid = 'public.site_document_revisions'::regclass`,
    );
    expect(rows).toHaveLength(1); // covers: AC-301-1
    expect(rows[0].relrowsecurity).toBe(true); // covers: AC-301-1
  });

  // (DoD 1 — insieme e forma delle colonne del contratto; nessun AC dedicato, ma e la
  // struttura su cui poggiano gli AC di runtime)
  it('espone ESATTAMENTE le colonne del contratto con tipi, nullability e default attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'site_document_revisions'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // Insieme ESATTO delle colonne (nessuna in meno, nessuna in piu).
    expect(cols.map((c) => c.column_name)).toEqual([
      'account_id',
      'created_at',
      'document',
      'id',
      'seq',
      'site_generation_id',
      'source',
    ]);

    // id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid');
    expect(by['id'].is_nullable).toBe('NO');
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()');

    // site_generation_id / account_id uuid NOT NULL
    expect(by['site_generation_id'].data_type).toBe('uuid');
    expect(by['site_generation_id'].is_nullable).toBe('NO');
    expect(by['account_id'].data_type).toBe('uuid');
    expect(by['account_id'].is_nullable).toBe('NO');

    // document jsonb NOT NULL: una revisione senza documento non ha senso.
    expect(by['document'].data_type).toBe('jsonb');
    expect(by['document'].is_nullable).toBe('NO');

    // source text NOT NULL (il vocabolario e vincolato dal CHECK, provato a parte)
    expect(by['source'].data_type).toBe('text');
    expect(by['source'].is_nullable).toBe('NO');

    // seq bigint NOT NULL: criterio d'ordine deterministico del read-path (T-304) e
    // chiave della potatura FIFO (T-303).
    expect(by['seq'].data_type).toBe('bigint');
    expect(by['seq'].is_nullable).toBe('NO');

    // created_at timestamptz NOT NULL default now()
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
    expect(by['created_at'].is_nullable).toBe('NO');
    expect(by['created_at'].column_default ?? '').toContain('now()');
  });

  // covers: AC-301-3 (struttura che produce il 23503 provato a runtime)
  // Insieme ESATTO delle FK, non "esiste almeno una FK verso X":
  //  - la composita (account_id, site_generation_id) → site_generations(account_id, id) e
  //    la difesa cross-tenant; declassarla a NO ACTION o droppare la referenziata la
  //    riaprirebbe;
  //  - una FK SEMPLICE su site_generation_id che comparisse ad affiancarla direbbe di
  //    nuovo solo "la generazione esiste", riaprendo lo squatting.
  it('espone ESATTAMENTE le FK attese — composita verso site_generations, semplice verso accounts — entrambe ON DELETE CASCADE', async () => {
    const fks = await pgQuery<{ conname: string; def: string; confdeltype: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.site_document_revisions'::regclass and c.contype = 'f'`,
    );
    const shape = fks
      .map((r) => ({
        conname: r.conname,
        // pg_get_constraintdef rende i nomi secondo il search_path: `public.` puo
        // comparire o no. E l'unica normalizzazione — colonne, tabella referenziata e
        // azione di cancellazione restano confrontate alla lettera.
        def: r.def.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim(),
        confdeltype: r.confdeltype,
      }))
      .sort((a, b) => a.conname.localeCompare(b.conname));

    expect(shape).toEqual([
      {
        conname: 'site_document_revisions_account_generation_fk',
        def: 'FOREIGN KEY (account_id, site_generation_id) REFERENCES site_generations(account_id, id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-301-3
      {
        conname: 'site_document_revisions_account_id_fkey',
        def: 'FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-301-3
    ]);
  });

  // covers: AC-301-4 (struttura che produce il 23505 sulla coppia provato a runtime)
  it('ha UN SOLO vincolo UNIQUE, sulla coppia (site_generation_id, seq)', async () => {
    const uq = await pgQuery<{ conname: string; def: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_document_revisions'::regclass and c.contype = 'u'`,
    );
    expect(uq).toHaveLength(1); // covers: AC-301-4
    expect(uq[0].conname).toBe('site_document_revisions_site_generation_id_seq_key'); // covers: AC-301-4
    expect(uq[0].def.replace(/\s+/g, ' ')).toBe('UNIQUE (site_generation_id, seq)'); // covers: AC-301-4
  });

  // covers: AC-301-4 (struttura che produce il 23514 su source fuori vocabolario)
  it('vincola source al vocabolario {generated, edited, rechosen, restored} via un CHECK', async () => {
    const checks = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_document_revisions'::regclass and c.contype = 'c'`,
    );
    const sourceChecks = checks
      .map((r) => r.def.replace(/\s+/g, ' '))
      .filter((d) => /\bsource\b/.test(d));
    expect(sourceChecks).toHaveLength(1); // covers: AC-301-4
    const def = sourceChecks[0];
    // ENUM ESATTO a 4 valori (D4/T-318 ha aggiunto 'restored'): ogni valore atteso e' presente...
    for (const v of ['generated', 'edited', 'rechosen', 'restored']) {
      expect(def).toContain(`'${v}'`); // covers: AC-301-4
    }
    // ...e nessun quinto valore stringa oltre i quattro (il CHECK non e' piu' largo del vocabolario).
    const quoted = (def.match(/'[^']*'/g) ?? []).sort();
    expect(quoted).toEqual(["'edited'", "'generated'", "'rechosen'", "'restored'"]); // covers: AC-301-4
    // ...e NON ammette un valore fuori vocabolario (nessuna disgiunzione che lo lasci).
    expect(def).not.toContain("'published'"); // covers: AC-301-4
  });

  // covers: AC-301-2 (l'espressione di isolamento) — asserita per INTERO, non per
  // contenimento: `is_account_member(account_id) or true` conterrebbe entrambi i token e
  // non isolerebbe nulla. Solo l'uguaglianza esatta distingue la policy giusta.
  it("ha ESATTAMENTE le policy SELECT/INSERT/DELETE (NESSUNA UPDATE — append-only) TO authenticated, ciascuna ancorata a is_account_member(account_id) nella clausola giusta", async () => {
    const pols = await pgQuery<{
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'site_document_revisions'`,
    );

    const norm = (e: string | null): string | null =>
      e == null ? null : e.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();
    const EXPR = 'is_account_member(account_id)';

    // Insieme ESATTO dei comandi: NIENTE UPDATE (append-only). Se una policy UPDATE
    // comparisse, la mutabilita silenziosa di una revisione rientrerebbe senza proteste.
    expect(pols.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT']); // covers: AC-301-2
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-301-2
    }
    const byCmd = Object.fromEntries(pols.map((p) => [p.cmd, p]));

    // SELECT: USING = EXPR, nessun WITH CHECK.
    expect(norm(byCmd['SELECT'].qual)).toBe(EXPR); // covers: AC-301-2
    expect(byCmd['SELECT'].with_check).toBeNull(); // covers: AC-301-2

    // INSERT: nessun USING, WITH CHECK = EXPR.
    expect(byCmd['INSERT'].qual).toBeNull(); // covers: AC-301-2
    expect(norm(byCmd['INSERT'].with_check)).toBe(EXPR); // covers: AC-301-2

    // DELETE (potatura FIFO T-303 sotto RLS): USING = EXPR, nessun WITH CHECK.
    expect(norm(byCmd['DELETE'].qual)).toBe(EXPR); // covers: AC-301-2
    expect(byCmd['DELETE'].with_check).toBeNull(); // covers: AC-301-2

    // NESSUNA policy UPDATE, esplicito: append-only irrappresentabile a livello policy.
    expect(byCmd['UPDATE']).toBeUndefined(); // covers: AC-301-2
  });

  // (DoD indici / R9 — colonne di policy e di join indicizzate; nessun AC dedicato)
  it('espone ESATTAMENTE gli indici attesi, con btree COMPLETI su account_id e site_generation_id', async () => {
    const idx = await pgQuery<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'site_document_revisions'`,
    );
    // Insieme ESATTO: rompe se un indice atteso sparisce E se ne compare uno non previsto.
    expect(idx.map((r) => r.indexname).sort()).toEqual([
      'site_document_revisions_account_id_idx', // R9: colonna di policy
      'site_document_revisions_pkey',
      'site_document_revisions_site_generation_id_idx', // R9: colonna di join/lettura
      'site_document_revisions_site_generation_id_seq_key', // indice del vincolo UNIQUE
    ]);

    // btree COMPLETO su ESATTAMENTE quella colonna: non parziale, non unique, e su una
    // sola colonna (l'ancora `)$` esclude l'indice UNIQUE composito che porta
    // site_generation_id solo come prefisso).
    const plainBtreeOn = (col: string): boolean =>
      idx.some((r) => {
        const def = r.indexdef.replace(/\s+/g, ' ');
        return (
          !/create unique index/i.test(def) &&
          !/ where /i.test(def) &&
          new RegExp(`USING btree \\(${col}\\)$`, 'i').test(def)
        );
      });
    expect(plainBtreeOn('account_id')).toBe(true);
    expect(plainBtreeOn('site_generation_id')).toBe(true);
  });

  // covers: AC-301-2 (DoD 6 / R7 — GRANT append-only espliciti; ZERO privilegi ad anon)
  // Le default privileges della piattaforma Supabase concedono da sole REFERENCES /
  // TRIGGER / TRUNCATE ad anon su OGNI nuova tabella di public: "non concedere" non
  // equivale a "non avere". La migrazione le annulla con un REVOKE ALL esplicito, quindi
  // qui si asserisce ZERO privilegi di QUALUNQUE tipo per anon — non zero DML.
  it('concede select/insert/delete (NIENTE update) a authenticated e service_role, e ZERO privilegi ad anon', async () => {
    const APPEND_ONLY = ['DELETE', 'INSERT', 'SELECT'];
    const grants = await pgQuery<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'site_document_revisions'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    );
    const privsOf = (grantee: string): string[] =>
      grants
        .filter((g) => g.grantee === grantee)
        .map((g) => g.privilege_type)
        .sort();

    // Insieme ESATTO dei privilegi: append-only (no UPDATE). Un UPDATE che rientrasse fra
    // i grant contraddirebbe l'immutabilita anche se nessuna policy lo permettesse.
    expect(privsOf('authenticated')).toEqual(APPEND_ONLY); // covers: AC-301-2
    expect(privsOf('service_role')).toEqual(APPEND_ONLY); // covers: AC-301-2
    // anon: insieme VUOTO, non "vuoto di DML".
    expect(privsOf('anon')).toEqual([]); // covers: AC-301-2
  });
});

describe.skipIf(!SB)(
  'T-301 site_document_revisions a runtime (vincoli + isolamento cross-tenant)',
  () => {
    const password = 'Password123!';
    const emailA = `t301a_${randomUUID()}@example.test`;
    const emailB = `t301b_${randomUUID()}@example.test`;
    let userAId = '';
    let userBId = '';
    let accountX = '';
    let accountY = '';

    // Fixture DISCORDANTI. La disciplina anti-identita si applica sui campi che il test
    // CONTROLLA: gli account_id sono UUID emessi dal provisioning (36 caratteri, con
    // trattini) — un account_id letteralmente PREFISSO di un altro non e rappresentabile,
    // quindi la trappola-prefisso e portata dai campi controllabili (stessa sostituzione
    // onesta fatta dalle fixture di T-200 con gli slug):
    //   - slug 'rev-a' PREFISSO di 'rev-a-2' (siti dello stesso tenant);
    //   - seq 1 PREFISSO-di-stringa di 10 (revisioni della stessa generazione);
    //   - marker 'x-1' PREFISSO di 'x-10' nel document.
    let siteA1 = ''; // X, slug 'rev-a'
    let siteA2 = ''; // X, slug 'rev-a-2'  (prefisso di A1 → trappola)
    let siteB = ''; // X, slug 'rev-b'
    let siteC = ''; // X, slug 'rev-c'  (bersaglio dedicato del test FK)
    let siteYown = ''; // Y, slug 'rev-a'  (omonimo di A1, altro tenant)
    let genX = ''; // generazione di X su siteA1 (piu revisioni)
    let genXOther = ''; // seconda generazione di X su siteB (unicita per-generazione)
    let genY = ''; // generazione di Y su siteYown (B deve VEDERE le proprie revisioni)
    let revY1 = ''; // revisione di Y (marcatore d'isolamento)
    const revXIds: string[] = []; // revisioni di X (mai visibili a B)

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

    const insertRevision = async (
      accountId: string,
      siteGenerationId: string,
      source: string,
      seq: number,
      document: unknown,
    ): Promise<string> => {
      const rows = await pgQuery<{ id: string }>(
        `insert into public.site_document_revisions (account_id, site_generation_id, source, seq, document)
         values ($1, $2, $3, $4, $5::jsonb) returning id`,
        [accountId, siteGenerationId, source, seq, JSON.stringify(document)],
      );
      return rows[0].id;
    };

    // Timeout esplicito: il setup crea due utenti con auth reale (bcrypt su Supabase
    // locale) e supera i 10s di default dei hook di vitest.
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
         values ($1, 'Sito rev-a',   'rev-a'),
                ($1, 'Sito rev-a-2', 'rev-a-2'),
                ($1, 'Sito rev-b',   'rev-b'),
                ($1, 'Sito rev-c',   'rev-c'),
                ($2, 'Sito rev-a',   'rev-a')
         returning id, slug, account_id`,
        [accountX, accountY],
      );
      const siteOf = (accountId: string, slug: string): string =>
        siteRows.find((r) => r.account_id === accountId && r.slug === slug)!.id;
      siteA1 = siteOf(accountX, 'rev-a');
      siteA2 = siteOf(accountX, 'rev-a-2');
      siteB = siteOf(accountX, 'rev-b');
      siteC = siteOf(accountX, 'rev-c');
      siteYown = siteOf(accountY, 'rev-a');
      // Lo slug omonimo vive in due tenant diversi: due id DISTINTI.
      expect(siteA1).not.toBe(siteYown);
      // Trappola-prefisso sugli slug (STESSO tenant): 'rev-a' e' PREFISSO di 'rev-a-2' → id
      // DISTINTI. Un lookup per prefisso (startsWith) confonderebbe i due siti; qui non accade.
      expect(siteA1).not.toBe(siteA2); // covers: AC-301-2

      // max_pages DISCORDANTI fra le generazioni.
      const genRows = await pgQuery<{ id: string; site_id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages)
         values ($1, $2, 'chosen', 8), ($1, $3, 'chosen', 3), ($4, $5, 'chosen', 5)
         returning id, site_id`,
        [accountX, siteA1, siteB, accountY, siteYown],
      );
      genX = genRows.find((r) => r.site_id === siteA1)!.id;
      genXOther = genRows.find((r) => r.site_id === siteB)!.id;
      genY = genRows.find((r) => r.site_id === siteYown)!.id;

      // Revisioni DISCORDANTI per document, seq e source (l'insieme dei tre valori di
      // source e coperto). seq 1 e prefisso-di-stringa di seq 10; marker 'x-1' prefisso
      // di 'x-10'. Un pool di revisioni per X e uno per Y: la SELECT di B che vede le
      // PROPRIE ma non quelle di X prova l'isolamento (una SELECT vuota non proverebbe
      // nulla).
      const revRows = await pgQuery<{ id: string; site_generation_id: string; seq: string }>(
        `insert into public.site_document_revisions (account_id, site_generation_id, source, seq, document)
         values ($1, $2, 'generated', 1,  '{"marker":"x-1"}'::jsonb),
                ($1, $2, 'edited',    2,  '{"marker":"x-2"}'::jsonb),
                ($1, $2, 'rechosen',  10, '{"marker":"x-10"}'::jsonb),
                ($1, $3, 'generated', 5,  '{"marker":"xo-5"}'::jsonb),
                ($4, $5, 'generated', 1,  '{"marker":"y-1"}'::jsonb)
         returning id, site_generation_id, seq`,
        [accountX, genX, genXOther, accountY, genY],
      );
      for (const r of revRows) {
        if (r.site_generation_id === genY) revY1 = r.id;
        else revXIds.push(r.id);
      }
      expect(revY1).toBeTruthy();
      expect(revXIds).toHaveLength(4);
    }, 60_000);

    afterAll(async () => {
      // cascade: auth.users → accounts → sites → site_generations → site_document_revisions
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-301-4
    it('source fuori vocabolario viola il CHECK (23514); una coppia (site_generation_id, seq) duplicata viola l\'UNIQUE (23505); i valori validi sono accettati', async () => {
      // source fuori dall'enum → 23514
      await expect(
        insertRevision(accountX, genXOther, 'published', 6, { marker: 'bad-source' }),
      ).rejects.toMatchObject({ code: '23514' }); // covers: AC-301-4

      // coppia (genX, seq=1) gia esistente → 23505
      await expect(
        insertRevision(accountX, genX, 'edited', 1, { marker: 'dup-seq' }),
      ).rejects.toMatchObject({ code: '23505' }); // covers: AC-301-4

      // CONTROLLO NEGATIVO 1: source dentro il vocabolario e ACCETTATO — il CHECK non
      // rifiuta tutto.
      const okSource = await insertRevision(accountX, genXOther, 'rechosen', 7, {
        marker: 'ok-source',
      });
      expect(okSource).toBeTruthy(); // covers: AC-301-4

      // CONTROLLO NEGATIVO 2: la STESSA seq (1) su una generazione DIVERSA (genXOther,
      // che non ha ancora seq 1) e ACCETTATA — l'unicita e PER GENERAZIONE, non globale.
      // Senza questo il test passerebbe anche con un unique globale su seq, che
      // bloccherebbe ogni sito dopo la prima revisione con quel numero.
      const okCross = await insertRevision(accountX, genXOther, 'edited', 1, {
        marker: 'cross-seq',
      });
      expect(okCross).toBeTruthy(); // covers: AC-301-4

      // ORACOLO che DISCRIMINA: la seq 1 esiste UNA volta per CIASCUNA delle due
      // generazioni — un unique globale ne lascerebbe una sola in tutto, un unique
      // assente ne lascerebbe due su genX.
      const perGen = await pgQuery<{ site_generation_id: string; n: number }>(
        `select site_generation_id, count(*)::int as n
           from public.site_document_revisions
          where site_generation_id = any($1::uuid[]) and seq = 1
          group by site_generation_id`,
        [[genX, genXOther]],
      );
      const byGen = Object.fromEntries(perGen.map((r) => [r.site_generation_id, r.n]));
      expect(byGen[genX]).toBe(1); // covers: AC-301-4
      expect(byGen[genXOther]).toBe(1); // covers: AC-301-4
    });

    // covers: AC-301-3
    // Il vettore che la sola RLS NON copre: B usa il PROPRIO account_id — legittimo per la
    // WITH CHECK, che guarda solo account_id — e la generazione di X. Senza la FK
    // composita questo INSERT riuscirebbe e inquinerebbe la storia di X. Provato sia via
    // client ad AUTH REALE sia via connessione diretta: e il VINCOLO a tenere, non la
    // policy.
    it('la FK COMPOSITA respinge la revisione ancorata alla generazione di un ALTRO tenant (23503), sia via client ad AUTH REALE sia via connessione diretta, e accetta la coppia coerente', async () => {
      // Bersaglio dedicato con gli slot seq ancora liberi: l'esito non dipende dall'ordine
      // degli altri test.
      const genTarget = await insertGeneration(accountX, siteC, 'chosen', 7);
      const clientB = await signInAs(emailB, password);
      const admin = adminClient();

      // (a) VIA CLIENT AD AUTH REALE (ruolo authenticated, JWT di B): account_id proprio,
      // generazione di X.
      const squat = await clientB
        .from('site_document_revisions')
        .insert({
          account_id: accountY, // il PROPRIO: la RLS non ha nulla da obiettare
          site_generation_id: genTarget, // la generazione di X
          source: 'edited',
          seq: 1,
          document: { marker: 'squat-rev' },
        })
        .select();
      expect(squat.error?.code).toBe('23503'); // covers: AC-301-3
      expect(squat.data ?? []).toEqual([]); // covers: AC-301-3

      // (b) VIA CONNESSIONE DIRETTA (superuser: RLS BYPASSATA, vincoli NO): la difesa
      // regge anche a una chiamata PostgREST diretta che aggirasse il codice.
      await expect(
        insertRevision(accountY, genTarget, 'edited', 2, { marker: 'squat-direct' }),
      ).rejects.toMatchObject({ code: '23503' }); // covers: AC-301-3
      // Vettore inverso: X verso la generazione di Y.
      await expect(
        insertRevision(accountX, genY, 'edited', 2, { marker: 'squat-inverse' }),
      ).rejects.toMatchObject({ code: '23503' }); // covers: AC-301-3

      // CONTROLLO NEGATIVO: la coppia (account, generazione) COERENTE e ACCETTATA — il
      // vincolo distingue l'account discordante, non vieta ogni scrittura.
      const coherent = await insertRevision(accountX, genTarget, 'generated', 1, {
        marker: 'coherent',
      });
      expect(coherent).toBeTruthy(); // covers: AC-301-3
      // ...e anche dal client ad auth reale, sulla PROPRIA generazione.
      const ownCoherent = await clientB
        .from('site_document_revisions')
        .insert({
          account_id: accountY,
          site_generation_id: genY,
          source: 'edited',
          seq: 2,
          document: { marker: 'mio-coerente' },
        })
        .select();
      expect(ownCoherent.error).toBeNull(); // covers: AC-301-3
      expect((ownCoherent.data ?? []).length).toBe(1); // covers: AC-301-3

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): sulla generazione bersaglio di
      // X esiste la SOLA riga coerente, e nessuna riga porta un account_id di Y.
      const { data: onTarget } = await admin
        .from('site_document_revisions')
        .select('id, account_id')
        .eq('site_generation_id', genTarget);
      expect((onTarget ?? []).map((r) => r.id)).toEqual([coherent]); // covers: AC-301-3
      expect((onTarget ?? []).every((r) => r.account_id === accountX)).toBe(true); // covers: AC-301-3
      expect((onTarget ?? []).some((r) => r.account_id === accountY)).toBe(false); // covers: AC-301-3
    });

    // covers: AC-301-2
    it('un utente non membro non legge ne scrive le revisioni di un altro account (RLS, client ad AUTH REALE)', async () => {
      const clientB = await signInAs(emailB, password);
      const admin = adminClient();
      const squatMarker = 'squat-rls-marker';

      // (a) SELECT: B vede le PROPRIE revisioni e NESSUNA di X.
      const { data: seen, error: selErr } = await clientB
        .from('site_document_revisions')
        .select('id, account_id, site_generation_id');
      expect(selErr).toBeNull(); // covers: AC-301-2
      const rows = seen ?? [];
      expect(rows.map((r) => r.id)).toContain(revY1); // covers: AC-301-2
      for (const revX of revXIds) {
        expect(rows.map((r) => r.id)).not.toContain(revX); // covers: AC-301-2
      }
      expect(rows.every((r) => r.account_id === accountY)).toBe(true); // covers: AC-301-2
      expect(rows.some((r) => r.site_generation_id === genX)).toBe(false); // covers: AC-301-2

      // (b) INSERT con l'account_id di X: la WITH CHECK blocca (42501 = new row violates
      // row-level security policy). Codice REALE, non una disgiunzione che qualunque
      // errore soddisfa.
      const insForeign = await clientB
        .from('site_document_revisions')
        .insert({
          account_id: accountX,
          site_generation_id: genX,
          source: 'edited',
          seq: 99,
          document: { marker: squatMarker },
        })
        .select();
      expect(insForeign.error?.code).toBe('42501'); // covers: AC-301-2
      expect(insForeign.data ?? []).toEqual([]); // covers: AC-301-2

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): nessuna riga con il marcatore
      // di squat e finita nel tenant X. Non ci si fida del solo errore restituito a B.
      const { data: oracle } = await admin
        .from('site_document_revisions')
        .select('id, document')
        .eq('site_generation_id', genX);
      expect(
        (oracle ?? []).some(
          (r) => (r.document as { marker?: string } | null)?.marker === squatMarker,
        ),
      ).toBe(false); // covers: AC-301-2

      // CONTROLLO NEGATIVO: nel PROPRIO account B scrive senza ostacoli — la RLS isola per
      // tenant, non blocca tutto (una denial universale non proverebbe nulla).
      const ownWrite = await clientB
        .from('site_document_revisions')
        .insert({
          account_id: accountY,
          site_generation_id: genY,
          source: 'edited',
          seq: 3,
          document: { marker: 'mio-rls' },
        })
        .select();
      expect(ownWrite.error).toBeNull(); // covers: AC-301-2
      expect((ownWrite.data ?? []).length).toBe(1); // covers: AC-301-2
    });
  },
);
