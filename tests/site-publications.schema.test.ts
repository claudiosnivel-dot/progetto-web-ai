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

// T-401 (macrotask publish-core, P4) — Schema account-scoped public.site_publications,
// RLS RICONQUISTATA (membri in CRUD + anon in SELECT solo sul pubblicato), FK COMPOSITE
// verso sites/site_generations, UNIQUE globale su public_slug e UNIQUE su site_id, GRANT
// column-level ad anon. Le asserzioni derivano dagli acceptance_criteria AC-401-1..6
// (docs/blueprint/P4-publish/01-publish-core.md).
//
// Tre strati di verifica (stessa impostazione di T-301):
//  - CATALOGO: connessione Postgres diretta (pgQuery) su pg_class / information_schema /
//    pg_policies / pg_constraint / pg_indexes / column_privileges — PostgREST non espone
//    i cataloghi.
//  - VINCOLI a runtime (AC-401-5/6) via pgQuery superuser: bypassa la RLS ma NON i
//    vincoli, quindi prova la difesa in profondita indipendente dalla RLS.
//  - RLS a runtime: client ad AUTH REALE (signInAs → JWT authenticated) per l'isolamento
//    membro (AC-401-2), e client anon reale SENZA sign-in (AC-401-3/4) per la superficie
//    pubblica — l'SQL editor / la connessione superuser darebbero un FALSO VERDE.

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

describe.skipIf(!DB)('T-401 site_publications — schema, RLS, vincoli (catalogo)', () => {
  // covers: AC-401-1
  it('RLS abilitata (relrowsecurity = true) sulla tabella', async () => {
    const rows = await pgQuery<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity
         from pg_class
        where oid = 'public.site_publications'::regclass`,
    );
    expect(rows).toHaveLength(1); // covers: AC-401-1
    expect(rows[0].relrowsecurity).toBe(true); // covers: AC-401-1
  });

  // (DoD 1 — insieme e forma delle colonne del contratto; nessun AC dedicato, ma e la
  // struttura su cui poggiano gli AC di runtime)
  it('espone ESATTAMENTE le colonne del contratto con tipi, nullability e default attesi', async () => {
    const cols = await pgQuery<ColRow>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema = 'public' and table_name = 'site_publications'
        order by column_name`,
    );
    const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));

    // Insieme ESATTO delle colonne (nessuna in meno, nessuna in piu).
    expect(cols.map((c) => c.column_name)).toEqual([
      'account_id',
      'created_at',
      'document',
      'id',
      'is_published',
      'locale',
      'public_slug',
      'published_at',
      'site_id',
      'source_generation_id',
      'updated_at',
    ]);

    // id uuid NOT NULL default gen_random_uuid()
    expect(by['id'].data_type).toBe('uuid');
    expect(by['id'].is_nullable).toBe('NO');
    expect(by['id'].column_default ?? '').toContain('gen_random_uuid()');

    // Le tre colonne di ancoraggio/provenienza: uuid NOT NULL (le FK composite le legano
    // all'account; NOT NULL perche una publication ha sempre sito e generazione sorgente).
    expect(by['account_id'].data_type).toBe('uuid');
    expect(by['account_id'].is_nullable).toBe('NO');
    expect(by['site_id'].data_type).toBe('uuid');
    expect(by['site_id'].is_nullable).toBe('NO');
    expect(by['source_generation_id'].data_type).toBe('uuid');
    expect(by['source_generation_id'].is_nullable).toBe('NO');

    // document jsonb NOT NULL: snapshot congelato, mai vuoto.
    expect(by['document'].data_type).toBe('jsonb');
    expect(by['document'].is_nullable).toBe('NO');

    // public_slug text NOT NULL: identita pubblica, assegnata al publish e mai nuda.
    expect(by['public_slug'].data_type).toBe('text');
    expect(by['public_slug'].is_nullable).toBe('NO');

    // locale text NOT NULL (il vocabolario it/es e vincolato dal CHECK, provato a parte).
    expect(by['locale'].data_type).toBe('text');
    expect(by['locale'].is_nullable).toBe('NO');

    // is_published boolean NOT NULL default false: predicato della policy anon.
    expect(by['is_published'].data_type).toBe('boolean');
    expect(by['is_published'].is_nullable).toBe('NO');
    expect(by['is_published'].column_default ?? '').toContain('false');

    // published_at timestamptz NULLABLE: NULL finche non pubblicato.
    expect(by['published_at'].data_type).toBe('timestamp with time zone');
    expect(by['published_at'].is_nullable).toBe('YES');

    // created_at / updated_at timestamptz NOT NULL default now()
    expect(by['created_at'].data_type).toBe('timestamp with time zone');
    expect(by['created_at'].is_nullable).toBe('NO');
    expect(by['created_at'].column_default ?? '').toContain('now()');
    expect(by['updated_at'].data_type).toBe('timestamp with time zone');
    expect(by['updated_at'].is_nullable).toBe('NO');
    expect(by['updated_at'].column_default ?? '').toContain('now()');
  });

  // covers: AC-401-6 (struttura che produce il 23503 provato a runtime)
  // Insieme ESATTO delle FK, non "esiste almeno una FK verso X": entrambe le composite
  // (verso sites e verso site_generations) sono la difesa cross-tenant; una FK SEMPLICE su
  // site_id / source_generation_id che comparisse ad affiancarle direbbe di nuovo solo "il
  // riferimento esiste", riaprendo lo squatting.
  it('espone ESATTAMENTE le tre FK attese — due composite verso sites/site_generations, una semplice verso accounts — tutte ON DELETE CASCADE', async () => {
    const fks = await pgQuery<{ conname: string; def: string; confdeltype: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as def, c.confdeltype
         from pg_constraint c
        where c.conrelid = 'public.site_publications'::regclass and c.contype = 'f'`,
    );
    const shape = fks
      .map((r) => ({
        conname: r.conname,
        def: r.def.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim(),
        confdeltype: r.confdeltype,
      }))
      .sort((a, b) => a.conname.localeCompare(b.conname));

    expect(shape).toEqual([
      {
        conname: 'site_publications_account_generation_fk',
        def: 'FOREIGN KEY (account_id, source_generation_id) REFERENCES site_generations(account_id, id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-401-6
      {
        conname: 'site_publications_account_id_fkey',
        def: 'FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-401-6
      {
        conname: 'site_publications_account_site_fk',
        def: 'FOREIGN KEY (account_id, site_id) REFERENCES sites(account_id, id) ON DELETE CASCADE',
        confdeltype: 'c',
      }, // covers: AC-401-6
    ]);
  });

  // covers: AC-401-5 (struttura che produce i due 23505 provati a runtime)
  // DUE vincoli UNIQUE, ciascuno su una singola colonna: public_slug GLOBALE (identita
  // pubblica) e site_id (uno snapshot per-sito). Asserito per INSIEME esatto: un UNIQUE che
  // sparisse o uno che comparisse in piu romperebbe il test.
  it('ha ESATTAMENTE due vincoli UNIQUE — su public_slug (globale) e su site_id', async () => {
    const uq = await pgQuery<{ conname: string; def: string }>(
      `select c.conname, pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_publications'::regclass and c.contype = 'u'`,
    );
    const shape = uq
      .map((r) => ({ conname: r.conname, def: r.def.replace(/\s+/g, ' ') }))
      .sort((a, b) => a.conname.localeCompare(b.conname));
    expect(shape).toEqual([
      { conname: 'site_publications_public_slug_key', def: 'UNIQUE (public_slug)' }, // covers: AC-401-5
      { conname: 'site_publications_site_id_key', def: 'UNIQUE (site_id)' }, // covers: AC-401-5
    ]);
  });

  // (DoD 1 / locale — vocabolario it/es vincolato dal CHECK; supporto strutturale)
  it('vincola locale al vocabolario {it, es} via un CHECK, e a nient\'altro', async () => {
    const checks = await pgQuery<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conrelid = 'public.site_publications'::regclass and c.contype = 'c'`,
    );
    const localeChecks = checks
      .map((r) => r.def.replace(/\s+/g, ' '))
      .filter((d) => /\blocale\b/.test(d));
    expect(localeChecks).toHaveLength(1);
    const def = localeChecks[0];
    const quoted = (def.match(/'[^']*'/g) ?? []).sort();
    expect(quoted).toEqual(["'es'", "'it'"]);
  });

  // covers: AC-401-2 + AC-401-3 (le espressioni di isolamento) — asserite per INTERO, non
  // per contenimento: `is_account_member(account_id) or true` conterrebbe entrambi i token
  // e non isolerebbe nulla; `is_published = true or true` idem. Solo l'uguaglianza esatta
  // distingue la policy giusta.
  it('ha ESATTAMENTE 4 policy membro (SELECT/INSERT/UPDATE/DELETE TO authenticated ancorate a is_account_member(account_id)) piu 1 policy anon (SELECT is_published=true)', async () => {
    const pols = await pgQuery<{
      cmd: string;
      roles: string[];
      qual: string | null;
      with_check: string | null;
    }>(
      `select cmd, roles::text[] as roles, qual, with_check
         from pg_policies
        where schemaname = 'public' and tablename = 'site_publications'`,
    );

    // norm: whitespace collassato + `public.` rimosso; stripWrap: rimuove una singola
    // coppia di parentesi che avvolge l'intera espressione (pg_get_expr rende una
    // comparazione come `(is_published = true)`, una chiamata di funzione senza parentesi
    // esterne) → confronto stabile a un LETTERALE calcolato a mano.
    const norm = (e: string | null): string | null =>
      e == null ? null : e.replace(/\s+/g, ' ').replace(/\bpublic\./g, '').trim();
    const stripWrap = (e: string | null): string | null =>
      e == null ? null : e.replace(/^\((.*)\)$/, '$1');
    const shape = (e: string | null): string | null => stripWrap(norm(e));

    const MEMBER = 'is_account_member(account_id)';
    const ANON = 'is_published = true';

    // Chiave cmd:ruolo — ci sono DUE policy SELECT (una authenticated, una anon).
    const byKey = Object.fromEntries(
      pols.map((p) => [`${p.cmd}:${p.roles.join(',')}`, p]),
    );
    expect(Object.keys(byKey).sort()).toEqual([
      'DELETE:authenticated',
      'INSERT:authenticated',
      'SELECT:anon',
      'SELECT:authenticated',
      'UPDATE:authenticated',
    ]); // covers: AC-401-2

    // SELECT membro: USING = MEMBER, nessun WITH CHECK.
    expect(shape(byKey['SELECT:authenticated'].qual)).toBe(MEMBER); // covers: AC-401-2
    expect(byKey['SELECT:authenticated'].with_check).toBeNull(); // covers: AC-401-2

    // INSERT membro: nessun USING, WITH CHECK = MEMBER.
    expect(byKey['INSERT:authenticated'].qual).toBeNull(); // covers: AC-401-2
    expect(shape(byKey['INSERT:authenticated'].with_check)).toBe(MEMBER); // covers: AC-401-2

    // UPDATE membro: USING = MEMBER e WITH CHECK = MEMBER (niente spostamento cross-tenant).
    expect(shape(byKey['UPDATE:authenticated'].qual)).toBe(MEMBER); // covers: AC-401-2
    expect(shape(byKey['UPDATE:authenticated'].with_check)).toBe(MEMBER); // covers: AC-401-2

    // DELETE membro: USING = MEMBER, nessun WITH CHECK.
    expect(shape(byKey['DELETE:authenticated'].qual)).toBe(MEMBER); // covers: AC-401-2
    expect(byKey['DELETE:authenticated'].with_check).toBeNull(); // covers: AC-401-2

    // SELECT anon: USING = (is_published = true), nessun WITH CHECK. NON e' is_account_member
    // (anon non e' membro di nulla) e NON e' `true` (leggerebbe anche il non pubblicato).
    expect(shape(byKey['SELECT:anon'].qual)).toBe(ANON); // covers: AC-401-3
    expect(byKey['SELECT:anon'].with_check).toBeNull(); // covers: AC-401-3
    expect(shape(byKey['SELECT:anon'].qual)).not.toBe('true'); // covers: AC-401-3
  });

  // (DoD 8 / R9 — colonne di policy e di join indicizzate; nessun AC dedicato)
  it('espone ESATTAMENTE gli indici attesi, con btree COMPLETI su account_id, site_id e source_generation_id', async () => {
    const idx = await pgQuery<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'site_publications'`,
    );
    // Insieme ESATTO: rompe se un indice atteso sparisce E se ne compare uno non previsto.
    expect(idx.map((r) => r.indexname).sort()).toEqual([
      'site_publications_account_id_idx', // R9: colonna di policy
      'site_publications_pkey',
      'site_publications_public_slug_key', // indice del vincolo UNIQUE globale
      'site_publications_site_id_idx', // R9: colonna di join
      'site_publications_site_id_key', // indice del vincolo UNIQUE per-sito
      'site_publications_source_generation_id_idx', // R9: colonna di join
    ]);

    // btree COMPLETO NON unique NON parziale su ESATTAMENTE quella colonna: l'ancora `)$`
    // esclude un eventuale indice composito che portasse la colonna solo come prefisso.
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
    expect(plainBtreeOn('site_id')).toBe(true);
    expect(plainBtreeOn('source_generation_id')).toBe(true);
  });

  // covers: AC-401-2 (DoD 7 — GRANT di TABELLA: authenticated CRUD, service_role CRUD, anon
  // ZERO privilegi di tabella). Le default privileges Supabase concedono REFERENCES /
  // TRIGGER / TRUNCATE a tutti i ruoli su ogni tabella nuova: "non concedere" non equivale a
  // "non avere" → il REVOKE ALL esplicito porta anon a ZERO privilegi DI TABELLA (il suo
  // accesso e' SOLO column-level, provato a parte).
  it('concede CRUD (select/insert/update/delete) a authenticated e service_role, e ZERO privilegi DI TABELLA ad anon', async () => {
    const CRUD = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    const grants = await pgQuery<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name = 'site_publications'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    );
    const privsOf = (grantee: string): string[] =>
      grants
        .filter((g) => g.grantee === grantee)
        .map((g) => g.privilege_type)
        .sort();

    expect(privsOf('authenticated')).toEqual(CRUD); // covers: AC-401-2
    expect(privsOf('service_role')).toEqual(CRUD); // covers: AC-401-2
    // anon: insieme VUOTO a livello TABELLA (il suo SELECT e' column-level, non di tabella).
    expect(privsOf('anon')).toEqual([]); // covers: AC-401-2
  });

  // covers: AC-401-4 (GRANT column-level: anon legge ESATTAMENTE public_slug, document,
  // locale — mai account_id / site_id / source_generation_id). information_schema.
  // column_privileges riflette il GRANT column-level di anon; per authenticated (che ha il
  // grant di TABELLA) riflette invece OGNI colonna — per questo si interroga anon.
  it('concede ad anon SELECT column-level ESATTAMENTE su {public_slug, document, locale}, su nessun\'altra colonna', async () => {
    const cp = await pgQuery<{ column_name: string; privilege_type: string }>(
      `select column_name, privilege_type
         from information_schema.column_privileges
        where table_schema = 'public'
          and table_name = 'site_publications'
          and grantee = 'anon'`,
    );
    // Ogni privilegio column-level di anon e' un SELECT (nessun insert/update di colonna).
    for (const r of cp) {
      expect(r.privilege_type).toBe('SELECT'); // covers: AC-401-4
    }
    const cols = cp.map((r) => r.column_name).sort();
    // Insieme ESATTO delle colonne leggibili da anon.
    expect(cols).toEqual(['document', 'locale', 'public_slug']); // covers: AC-401-4
    // Le colonne private NON compaiono — asserito nominalmente, non solo per assenza dal set.
    expect(cols).not.toContain('account_id'); // covers: AC-401-4
    expect(cols).not.toContain('site_id'); // covers: AC-401-4
    expect(cols).not.toContain('source_generation_id'); // covers: AC-401-4
  });
});

describe.skipIf(!SB)(
  'T-401 site_publications a runtime (isolamento membro, superficie anon, vincoli)',
  () => {
    const password = 'Password123!';
    const emailA = `t401a_${randomUUID()}@example.test`;
    const emailB = `t401b_${randomUUID()}@example.test`;
    let userAId = '';
    let userBId = '';
    let accountX = '';
    let accountY = '';
    let anon: SupabaseClient;

    // Fixture DISCORDANTI. La disciplina anti-identita si applica sui campi che il test
    // CONTROLLA: gli account_id sono UUID (36 caratteri) — un account_id letteralmente
    // PREFISSO di un altro non e' rappresentabile, quindi la trappola-prefisso e' portata
    // dai public_slug controllabili:
    //   - public_slug 'shop' PREFISSO di 'shop-two' (X pubblicato vs Y non pubblicato,
    //     tenant diversi) e di 'shop-own' (X, stesso tenant). Un lookup per prefisso
    //     (startsWith) confonderebbe le publication; l'UNIQUE globale e la RLS no.
    // Valori discordanti anche su locale (it/es), is_published (true/false), document.
    let siteX_pub = ''; // X, base pubblicata (public_slug 'shop')
    let siteX_own = ''; // X, controllo positivo update/delete membro
    let siteX_uni = ''; // X, sito libero per il test UNIQUE
    let siteX_fk = ''; // X, sito libero per il test FK
    let siteY = ''; // Y, 'pub-a' omonimo di X (altro tenant)
    let siteY_free = ''; // Y, sito SENZA publication: bersaglio della FK cross-tenant (AC-401-6a)
    let genX_pub = '';
    let genX_own = '';
    let genX_uni = '';
    let genX_fk = '';
    let genY = '';
    let pubX_pub = ''; // X, is_published=true, 'shop'
    let pubX_own = ''; // X, is_published=false, 'shop-own'
    let pubY_unpub = ''; // Y, is_published=false, 'shop-two'

    const insertPublication = async (
      accountId: string,
      siteId: string,
      sourceGenerationId: string,
      publicSlug: string,
      locale: string,
      isPublished: boolean,
      document: unknown,
    ): Promise<string> => {
      const rows = await pgQuery<{ id: string }>(
        `insert into public.site_publications
           (account_id, site_id, source_generation_id, public_slug, locale, is_published, published_at, document)
         values ($1, $2, $3, $4, $5, $6, case when $6 then now() else null end, $7::jsonb)
         returning id`,
        [accountId, siteId, sourceGenerationId, publicSlug, locale, isPublished, JSON.stringify(document)],
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
         values ($1, 'Sito pub-a',   'pub-a'),
                ($1, 'Sito pub-own', 'pub-own'),
                ($1, 'Sito pub-uni', 'pub-uni'),
                ($1, 'Sito pub-fk',  'pub-fk'),
                ($2, 'Sito pub-a',   'pub-a'),
                ($2, 'Sito pub-yfree', 'pub-yfree')
         returning id, slug, account_id`,
        [accountX, accountY],
      );
      const siteOf = (accountId: string, slug: string): string =>
        siteRows.find((r) => r.account_id === accountId && r.slug === slug)!.id;
      siteX_pub = siteOf(accountX, 'pub-a');
      siteX_own = siteOf(accountX, 'pub-own');
      siteX_uni = siteOf(accountX, 'pub-uni');
      siteX_fk = siteOf(accountX, 'pub-fk');
      siteY = siteOf(accountY, 'pub-a');
      siteY_free = siteOf(accountY, 'pub-yfree');
      // Lo slug omonimo vive in due tenant diversi: due id DISTINTI.
      expect(siteX_pub).not.toBe(siteY);

      // max_pages DISCORDANTI fra le generazioni.
      const genRows = await pgQuery<{ id: string; site_id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages)
         values ($1, $2, 'chosen', 8),
                ($1, $3, 'chosen', 3),
                ($1, $4, 'chosen', 5),
                ($1, $5, 'chosen', 6),
                ($6, $7, 'chosen', 4)
         returning id, site_id`,
        [accountX, siteX_pub, siteX_own, siteX_uni, siteX_fk, accountY, siteY],
      );
      const genOf = (siteId: string): string =>
        genRows.find((r) => r.site_id === siteId)!.id;
      genX_pub = genOf(siteX_pub);
      genX_own = genOf(siteX_own);
      genX_uni = genOf(siteX_uni);
      genX_fk = genOf(siteX_fk);
      genY = genOf(siteY);

      // Le tre publication di base. Trappola-prefisso su public_slug ('shop' ⊂ 'shop-two',
      // 'shop' ⊂ 'shop-own'); locale e is_published discordanti; document discordanti.
      pubX_pub = await insertPublication(
        accountX, siteX_pub, genX_pub, 'shop', 'it', true, { marker: 'shop-doc' },
      );
      pubX_own = await insertPublication(
        accountX, siteX_own, genX_own, 'shop-own', 'it', false, { marker: 'own-doc' },
      );
      pubY_unpub = await insertPublication(
        accountY, siteY, genY, 'shop-two', 'es', false, { marker: 'shop-two-doc' },
      );
      // Le tre righe sono distinte (nessuna collisione di setup).
      expect(new Set([pubX_pub, pubX_own, pubY_unpub]).size).toBe(3);

      anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
    }, 60_000);

    afterAll(async () => {
      // cascade: auth.users → accounts → sites → site_generations → site_publications
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-401-2
    it('un membro vede e muta SOLO le proprie publication, mai quelle di un altro account (RLS, client ad AUTH REALE)', async () => {
      const clientA = await signInAs(emailA, password);
      const admin = adminClient();

      // (a) SELECT: A vede le PROPRIE publication (accountX) e NESSUNA di Y.
      const { data: seen, error: selErr } = await clientA
        .from('site_publications')
        .select('id, account_id, public_slug');
      expect(selErr).toBeNull(); // covers: AC-401-2
      const rows = seen ?? [];
      expect(rows.map((r) => r.id)).toContain(pubX_pub); // covers: AC-401-2
      expect(rows.map((r) => r.id)).toContain(pubX_own); // covers: AC-401-2
      expect(rows.map((r) => r.id)).not.toContain(pubY_unpub); // covers: AC-401-2
      expect(rows.every((r) => r.account_id === accountX)).toBe(true); // covers: AC-401-2

      // (b) UPDATE della riga di Y: la RLS (USING) non la rende visibile → 0 righe toccate.
      const updForeign = await clientA
        .from('site_publications')
        .update({ is_published: true })
        .eq('id', pubY_unpub)
        .select();
      expect(updForeign.error).toBeNull(); // covers: AC-401-2
      expect(updForeign.data ?? []).toEqual([]); // covers: AC-401-2

      // (c) DELETE della riga di Y: idem, 0 righe toccate.
      const delForeign = await clientA
        .from('site_publications')
        .delete()
        .eq('id', pubY_unpub)
        .select();
      expect(delForeign.error).toBeNull(); // covers: AC-401-2
      expect(delForeign.data ?? []).toEqual([]); // covers: AC-401-2

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): la riga di Y e' INTATTA —
      // is_published ancora false, riga ancora presente. Non ci si fida del solo esito di A.
      const { data: yRow } = await admin
        .from('site_publications')
        .select('id, is_published')
        .eq('id', pubY_unpub)
        .maybeSingle();
      expect(yRow?.id).toBe(pubY_unpub); // covers: AC-401-2
      expect(yRow?.is_published).toBe(false); // covers: AC-401-2

      // CONTROLLO POSITIVO: sul PROPRIO account A muta senza ostacoli — la RLS ISOLA per
      // tenant, non blocca tutto (una denial universale non proverebbe nulla). Update poi
      // delete della propria riga pubX_own.
      const updOwn = await clientA
        .from('site_publications')
        .update({ published_at: new Date().toISOString() })
        .eq('id', pubX_own)
        .select();
      expect(updOwn.error).toBeNull(); // covers: AC-401-2
      expect((updOwn.data ?? []).length).toBe(1); // covers: AC-401-2

      const delOwn = await clientA
        .from('site_publications')
        .delete()
        .eq('id', pubX_own)
        .select();
      expect(delOwn.error).toBeNull(); // covers: AC-401-2
      expect((delOwn.data ?? []).map((r) => r.id)).toEqual([pubX_own]); // covers: AC-401-2
    });

    // covers: AC-401-3
    it('anon (senza sign-in) legge SOLO la riga is_published=true, mai la non pubblicata ne di altri tenant', async () => {
      const { data, error } = await anon
        .from('site_publications')
        .select('public_slug, document, locale');
      expect(error).toBeNull(); // covers: AC-401-3
      const rows = data ?? [];
      const slugs = rows.map((r) => r.public_slug as string);
      // Vede il pubblicato 'shop'...
      expect(slugs).toContain('shop'); // covers: AC-401-3
      // ...e NON la riga non pubblicata di Y 'shop-two' (prefissata da 'shop': un match per
      // prefisso la trascinerebbe dentro; la RLS sul flag no).
      expect(slugs).not.toContain('shop-two'); // covers: AC-401-3
      // La riga vista porta i dati pubblici corretti (document/locale sono concessi ad anon).
      const shopRow = rows.find((r) => r.public_slug === 'shop');
      expect((shopRow?.document as { marker?: string } | undefined)?.marker).toBe('shop-doc'); // covers: AC-401-3
      expect(shopRow?.locale).toBe('it'); // covers: AC-401-3
    });

    // covers: AC-401-4
    it('anon NON puo leggere le colonne private (account_id / source_generation_id): 42501; le colonne pubbliche invece si', async () => {
      // account_id NON concesso ad anon → permission denied for column (42501).
      const accCol = await anon.from('site_publications').select('account_id');
      expect(accCol.error?.code).toBe('42501'); // covers: AC-401-4
      expect(accCol.data).toBeNull(); // covers: AC-401-4

      // source_generation_id NON concesso ad anon → 42501.
      const genCol = await anon.from('site_publications').select('source_generation_id');
      expect(genCol.error?.code).toBe('42501'); // covers: AC-401-4

      // site_id NON concesso ad anon → 42501.
      const siteCol = await anon.from('site_publications').select('site_id');
      expect(siteCol.error?.code).toBe('42501'); // covers: AC-401-4

      // CONTROLLO POSITIVO: una colonna concessa (public_slug) e' leggibile — la denial e'
      // per-colonna, non un blocco totale della tabella per anon.
      const okCol = await anon.from('site_publications').select('public_slug');
      expect(okCol.error).toBeNull(); // covers: AC-401-4
    });

    // covers: AC-401-5
    it('il vincolo UNIQUE rifiuta un public_slug duplicato E un site_id duplicato (23505), e accetta la coppia nuova', async () => {
      // (a) STESSO public_slug ('shop', gia di pubX_pub) su un sito DIVERSO (siteX_uni):
      // solo il vincolo public_slug GLOBALE puo scattare → 23505. Isola il vincolo slug dal
      // vincolo site_id.
      await expect(
        insertPublication(accountX, siteX_uni, genX_uni, 'shop', 'it', false, { marker: 'dup-slug' }),
      ).rejects.toMatchObject({ code: '23505' }); // covers: AC-401-5

      // (b) STESSO site_id (siteX_pub, gia di pubX_pub) con un public_slug NUOVO: solo il
      // vincolo site_id puo scattare → 23505. Isola il vincolo site_id dal vincolo slug.
      await expect(
        insertPublication(accountX, siteX_pub, genX_pub, 'shop-dup-site', 'it', false, { marker: 'dup-site' }),
      ).rejects.toMatchObject({ code: '23505' }); // covers: AC-401-5

      // CONTROLLO POSITIVO: sito NUOVO (siteX_uni) + slug NUOVO ('shop-ok') e' ACCETTATO —
      // l'UNIQUE distingue il duplicato, non vieta ogni scrittura. Consuma siteX_uni.
      const ok = await insertPublication(
        accountX, siteX_uni, genX_uni, 'shop-ok', 'it', false, { marker: 'ok' },
      );
      expect(ok).toBeTruthy(); // covers: AC-401-5
    });

    // covers: AC-401-6
    // Il vettore che la sola RLS NON copre: X usa il PROPRIO account_id — legittimo per la
    // WITH CHECK, che guarda solo account_id — ma punta al sito/generazione di un ALTRO
    // tenant. Senza le FK composite lo snapshot cross-tenant passerebbe. Provato via
    // connessione diretta (superuser: RLS bypassata, vincoli NO): e' il VINCOLO a tenere.
    it('le FK COMPOSITE respingono uno snapshot ancorato a sito/generazione di un ALTRO tenant (23503), e accettano la coppia coerente', async () => {
      // (a) (account_id, site_id): accountX + siteY_free (sito di Y SENZA publication, cosi' scatta
      // SOLO la FK verso sites e non l'UNIQUE su site_id) con source_generation valido di X → 23503.
      await expect(
        insertPublication(accountX, siteY_free, genX_uni, 'fk-site', 'it', false, { marker: 'squat-site' }),
      ).rejects.toMatchObject({ code: '23503' }); // covers: AC-401-6

      // (b) (account_id, source_generation_id): accountX + genY (di Y) con site valido di X
      // → solo la FK verso site_generations scatta → 23503.
      await expect(
        insertPublication(accountX, siteX_fk, genY, 'fk-gen', 'it', false, { marker: 'squat-gen' }),
      ).rejects.toMatchObject({ code: '23503' }); // covers: AC-401-6

      // CONTROLLO POSITIVO: coppia (account, sito, generazione) tutta di X e' ACCETTATA — le
      // FK distinguono il tenant discordante, non vietano ogni scrittura. Consuma siteX_fk.
      const coherent = await insertPublication(
        accountX, siteX_fk, genX_fk, 'fk-ok', 'it', false, { marker: 'coherent' },
      );
      expect(coherent).toBeTruthy(); // covers: AC-401-6

      // ORACOLO INDIPENDENTE (service_role): sul sito bersaglio siteX_fk esiste la SOLA riga
      // coerente e nessuna porta un account_id di Y.
      const { data: onTarget } = await adminClient()
        .from('site_publications')
        .select('id, account_id')
        .eq('site_id', siteX_fk);
      expect((onTarget ?? []).map((r) => r.id)).toEqual([coherent]); // covers: AC-401-6
      expect((onTarget ?? []).some((r) => r.account_id === accountY)).toBe(false); // covers: AC-401-6
    });
  },
);
