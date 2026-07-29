import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pgQuery } from './helpers/pg';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-120 (P1) — Schema account-scoped public.site_briefs + RLS + vincoli 1:1.
// Le asserzioni derivano dagli acceptance_criteria AC-120-1..6 (01-brief-model.md).
//
// Due strati di verifica (come T-100):
//  - CATALOGO (AC-120-1/2/4): connessione Postgres diretta (pgQuery) su
//    pg_class/information_schema/pg_policies — PostgREST non espone i cataloghi.
//  - RUNTIME: UNIQUE/CHECK (AC-120-3/5) via pgQuery superuser (bypassa la RLS ma
//    NON i vincoli); la DENIAL cross-tenant (AC-120-6) via client ad AUTH REALE
//    (signInAs → JWT, ruolo authenticated, RLS ATTIVA), mai nell'SQL editor.

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

describe.skipIf(!DB)('T-120 site_briefs schema + RLS (catalogo)', () => {
  // covers: AC-120-1
  it('RLS abilitata (relrowsecurity = true) su public.site_briefs', async () => {
    const rows = await pgQuery<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'public.site_briefs'::regclass`,
    );
    expect(rows[0].relrowsecurity).toBe(true); // covers: AC-120-1
  });

  // covers: AC-120-2
  it('espone le colonne del contratto con tipi, nullability e default attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'site_briefs'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // Insieme ESATTO delle colonne del contratto.
    expect(cols.map((c) => c.column_name).sort()).toEqual([
      'account_id',
      'address',
      'business_name',
      'content',
      'created_at',
      'description',
      'email',
      'geo',
      'hours',
      'id',
      'locale',
      'phone',
      'primary_goal',
      'site_id',
      'status',
      'updated_at',
      'vertical',
      'whatsapp',
    ]); // covers: AC-120-2

    // id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid'); // covers: AC-120-2
    expect(by['id'].is_nullable).toBe('NO'); // covers: AC-120-2
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()'); // covers: AC-120-2

    // account_id / site_id uuid NOT NULL
    expect(by['account_id'].data_type).toBe('uuid'); // covers: AC-120-2
    expect(by['account_id'].is_nullable).toBe('NO'); // covers: AC-120-2
    expect(by['site_id'].data_type).toBe('uuid'); // covers: AC-120-2
    expect(by['site_id'].is_nullable).toBe('NO'); // covers: AC-120-2

    // business_name text nullable
    expect(by['business_name'].data_type).toBe('text'); // covers: AC-120-2
    expect(by['business_name'].is_nullable).toBe('YES'); // covers: AC-120-2

    // vertical text NOT NULL default 'altro'
    expect(by['vertical'].data_type).toBe('text'); // covers: AC-120-2
    expect(by['vertical'].is_nullable).toBe('NO'); // covers: AC-120-2
    expect(by['vertical'].column_default ?? '').toContain("'altro'"); // covers: AC-120-2

    // geo / hours / content jsonb
    expect(by['geo'].data_type).toBe('jsonb'); // covers: AC-120-2
    expect(by['hours'].data_type).toBe('jsonb'); // covers: AC-120-2
    expect(by['content'].data_type).toBe('jsonb'); // covers: AC-120-2
    expect(by['content'].is_nullable).toBe('NO'); // covers: AC-120-2

    // locale text NOT NULL
    expect(by['locale'].data_type).toBe('text'); // covers: AC-120-2
    expect(by['locale'].is_nullable).toBe('NO'); // covers: AC-120-2

    // status text NOT NULL default 'draft'
    expect(by['status'].data_type).toBe('text'); // covers: AC-120-2
    expect(by['status'].is_nullable).toBe('NO'); // covers: AC-120-2
    expect(by['status'].column_default ?? '').toContain("'draft'"); // covers: AC-120-2

    // created_at / updated_at timestamptz
    expect(by['created_at'].data_type).toBe('timestamp with time zone'); // covers: AC-120-2
    expect(by['updated_at'].data_type).toBe('timestamp with time zone'); // covers: AC-120-2
  });

  // covers: AC-120-2 (FK) — site_id -> sites ON DELETE CASCADE + UNIQUE(site_id)
  it('site_id e FK verso public.sites ON DELETE CASCADE ed e UNIQUE (1:1)', async () => {
    const fk = await pgQuery<{ def: string; confdeltype: string }>(
      `select pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.site_briefs'::regclass
          and c.contype = 'f'
          and c.confrelid = 'public.sites'::regclass`,
    );
    expect(fk).toHaveLength(1); // covers: AC-120-2
    expect(fk[0].confdeltype).toBe('c'); // covers: AC-120-2 — ON DELETE CASCADE
    expect(fk[0].def).toContain('site_id'); // covers: AC-120-2

    const uq = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_briefs'::regclass and c.contype = 'u'`,
    );
    const hasUniqueSiteId = uq.some((r) => /unique\s*\(\s*site_id\s*\)/i.test(r.def));
    expect(hasUniqueSiteId).toBe(true); // covers: AC-120-2 / AC-120-3
  });

  // covers: AC-120-4
  it('ha policy per SELECT/INSERT/UPDATE/DELETE, tutte TO authenticated, nessuna con qual/with_check = true e ognuna cita account_id', async () => {
    const pols = await pgQuery<{
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'site_briefs'`,
    );

    const cmds = pols.map((p) => p.cmd).sort();
    expect(cmds).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']); // covers: AC-120-4

    const isLiteralTrue = (e: string | null): boolean =>
      e != null && /^\(*true\)*$/.test(e.replace(/\s+/g, '').toLowerCase());

    expect(pols.length).toBeGreaterThan(0);
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-120-4
      expect(isLiteralTrue(p.qual)).toBe(false); // covers: AC-120-4
      expect(isLiteralTrue(p.with_check)).toBe(false); // covers: AC-120-4
      const blob = `${p.qual ?? ''} ${p.with_check ?? ''}`;
      expect(blob).toContain('account_id'); // covers: AC-120-4
    }
  });

  // covers: AC-120-4
  //
  // PERCHE L'UGUAGLIANZA ESATTA (e perche il test qui sopra non basta). Quello asserisce
  // due proprieta DEBOLI: che l'espressione CONTENGA la sottostringa 'account_id', e che
  // non sia la costante letterale 'true'. Entrambe sono superate da un predicato
  // COMPLETAMENTE PERMISSIVO. Contro-esempio MISURATO su questo repo: sostituendo la sola
  // policy DELETE con
  //     using (account_id is not null)
  // — che consente a QUALUNQUE utente autenticato di cancellare QUALUNQUE brief di
  // QUALUNQUE account — la suite resta interamente VERDE, perche quel predicato contiene
  // 'account_id' e non e la costante true. (La stessa mutazione sulla policy DELETE di
  // sites lascia verdi 35 test su 35.)
  // Da qui la forma di questo test:
  //  - insieme ESATTO dei comandi con toEqual, non "contiene": e questo che rende rossa
  //    anche l'AGGIUNTA di una quinta policy permissiva accanto alle quattro giuste;
  //  - uguaglianza ESATTA di qual e with_check, clausola per clausola;
  //  - unica normalizzazione ammessa: comprimere gli spazi e togliere il prefisso
  //    `public.` (pg_policies rende i nomi secondo il search_path). Non allenta nulla
  //    del predicato — nessun toContain, nessuna regex permissiva.
  it("le QUATTRO policy di site_briefs sono TO authenticated e l'espressione di ciascuna e ESATTAMENTE is_account_member(account_id) nella clausola giusta", async () => {
    const pols = await pgQuery<{
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'site_briefs'`,
    );

    const norm = (e: string | null): string | null =>
      e == null ? null : e.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();
    const EXPR = 'is_account_member(account_id)';

    // Insieme ESATTO dei comandi coperti: quattro policy, una per comando.
    expect(pols.map((p) => p.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']); // covers: AC-120-4
    for (const p of pols) {
      expect(p.roles).toEqual(['authenticated']); // covers: AC-120-4
    }
    const byCmd = Object.fromEntries(pols.map((p) => [p.cmd, p]));

    // USING sulle righe leggibili/modificabili/cancellabili; WITH CHECK su quelle
    // scrivibili. L'asserzione che la clausola NON pertinente sia `null` va OLTRE la
    // lettera di AC-120-4 (che parla dei comandi, dei ruoli e dell'isolamento per
    // account): un WITH CHECK su SELECT/DELETE, o un USING su INSERT, e comunque una
    // deviazione dal testo della migrazione e va vista.
    expect(norm(byCmd['SELECT'].qual)).toBe(EXPR); // covers: AC-120-4
    expect(byCmd['SELECT'].with_check).toBeNull(); // oltre AC-120-4: clausola non pertinente

    expect(byCmd['INSERT'].qual).toBeNull(); // oltre AC-120-4: clausola non pertinente
    expect(norm(byCmd['INSERT'].with_check)).toBe(EXPR); // covers: AC-120-4

    // UPDATE ha ENTRAMBE le clausole, e vanno asserite SEPARATAMENTE: USING filtra le
    // righe modificabili, WITH CHECK e cio che impedisce di "spostare" un brief verso un
    // account non proprio riscrivendo account_id. Un'asserzione sola sulla coppia
    // lascerebbe passare la sparizione della seconda.
    expect(norm(byCmd['UPDATE'].qual)).toBe(EXPR); // covers: AC-120-4
    expect(norm(byCmd['UPDATE'].with_check)).toBe(EXPR); // covers: AC-120-4

    // DELETE: il comando dello Schema A del referto — quello che nessun test esercita a
    // runtime. Qui e pinnato alla lettera.
    expect(norm(byCmd['DELETE'].qual)).toBe(EXPR); // covers: AC-120-4
    expect(byCmd['DELETE'].with_check).toBeNull(); // oltre AC-120-4: clausola non pertinente
  });
});

describe.skipIf(!SB)('T-120 site_briefs vincoli a runtime (UNIQUE / CHECK / cross-tenant)', () => {
  const password = 'Password123!';
  const emailX = `t120x_${randomUUID()}@example.test`;
  const emailY = `t120y_${randomUUID()}@example.test`;
  let userXId = '';
  let userYId = '';
  let accountXId = '';
  let accountYId = '';
  let siteS1 = '';
  let siteS2 = '';
  let siteS3 = '';
  let siteYown = '';

  const insertSite = async (accountId: string, slug: string): Promise<string> => {
    const rows = await pgQuery<{ id: string }>(
      `insert into public.sites (account_id, name, slug) values ($1, $2, $3) returning id`,
      [accountId, `Sito ${slug}`, slug],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    const x = await createTestUser(emailX, password);
    const y = await createTestUser(emailY, password);
    userXId = x.id;
    userYId = y.id;
    const admin = adminClient();
    const { data: accX } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userXId)
      .single();
    const { data: accY } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userYId)
      .single();
    accountXId = accX!.id as string;
    accountYId = accY!.id as string;
    siteS1 = await insertSite(accountXId, `s1-${randomUUID().slice(0, 8)}`);
    siteS2 = await insertSite(accountXId, `s2-${randomUUID().slice(0, 8)}`);
    siteS3 = await insertSite(accountXId, `s3-${randomUUID().slice(0, 8)}`);
    siteYown = await insertSite(accountYId, `yown-${randomUUID().slice(0, 8)}`);
  });

  afterAll(async () => {
    if (userXId) await deleteTestUser(userXId); // cascade: accounts → sites → site_briefs
    if (userYId) await deleteTestUser(userYId);
  });

  // covers: AC-120-3
  it('due brief per lo stesso site_id violano UNIQUE(site_id) (SQLSTATE 23505)', async () => {
    await pgQuery(
      `insert into public.site_briefs (account_id, site_id, locale) values ($1, $2, $3)`,
      [accountXId, siteS1, 'it'],
    );
    await expect(
      pgQuery(
        `insert into public.site_briefs (account_id, site_id, locale) values ($1, $2, $3)`,
        [accountXId, siteS1, 'it'],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-120-3
  });

  // covers: AC-120-5
  it("uno status fuori dai valori ammessi ('archived') viola il CHECK (SQLSTATE 23514)", async () => {
    await expect(
      pgQuery(
        `insert into public.site_briefs (account_id, site_id, locale, status) values ($1, $2, $3, $4)`,
        [accountXId, siteS2, 'it', 'archived'],
      ),
    ).rejects.toMatchObject({ code: '23514' }); // covers: AC-120-5
  });

  // covers: AC-120-6
  it("un utente non membro non puo leggere ne scrivere il brief di un altro account (RLS)", async () => {
    // Precondizione: S1 (account X) ha gia un brief (dal test AC-120-3).
    const clientY = await signInAs(emailY, password);

    // (a) INSERT di Y forzando account_id = X (di cui Y non e membro): RLS with_check blocca.
    const { data: insData, error: insErr } = await clientY
      .from('site_briefs')
      .insert({ account_id: accountXId, site_id: siteS3, locale: 'it' })
      .select();
    const insertRejected = insErr !== null || (insData ?? []).length === 0;
    expect(insertRejected).toBe(true); // covers: AC-120-6

    // Oracolo service_role: nessun brief per S3 e stato creato da Y.
    const { data: s3Rows } = await adminClient()
      .from('site_briefs')
      .select('id')
      .eq('site_id', siteS3);
    expect((s3Rows ?? []).length).toBe(0); // covers: AC-120-6

    // (b) SELECT di Y non vede il brief di X (S1): la RLS filtra a insieme vuoto.
    const { data: seen } = await clientY.from('site_briefs').select('id, site_id');
    expect((seen ?? []).some((r) => r.site_id === siteS1)).toBe(false); // covers: AC-120-6
  });

  // covers: AC-120-6 (rafforzamento: FK composita account<->site — rilievo verifica avversariale)
  it('un brief con account_id proprio ma site_id di un altro tenant e respinto dalla FK composita (SQLSTATE 23503)', async () => {
    // Vettore scoperto dalla verifica avversariale: X (col PROPRIO account) prova ad
    // ancorare un brief al sito di Y. La FK composita (account_id, site_id) ->
    // sites(account_id, id) lo blocca a livello DB anche via superuser (RLS bypassata,
    // vincoli no) — quindi anche via chiamata PostgREST diretta che bypassi briefs.ts.
    await expect(
      pgQuery(
        `insert into public.site_briefs (account_id, site_id, locale) values ($1, $2, $3)`,
        [accountXId, siteYown, 'it'],
      ),
    ).rejects.toMatchObject({ code: '23503' }); // covers: AC-120-6
  });
});
