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

// T-407 (macrotask public-serving, P4) — RLS RICONQUISTATA e PROVATA A RUNTIME sulla
// PRIMA superficie del progetto leggibile da `anon` (public.site_publications, T-401).
// L'oracolo qui non e' lo schema (gia coperto staticamente da T-401) ma il COMPORTAMENTO
// con un client ANON reale (anon key → ruolo Postgres `anon`, RLS attiva):
//
//  - il PUBBLICATO (is_published=true) e' letto — anche cross-tenant, che per il serving
//    pubblico e' INTENZIONALE (P4);
//  - il NON pubblicato e' NEGATO, per OGNI tenant, sia per slug (la RLS filtra) sia per id
//    (anon non ha nemmeno il GRANT column-level su `id`: negazione ancora piu forte);
//  - le colonne PRIVATE (account_id / source_generation_id) non sono esposte, ne nella
//    proiezione pubblica ne interrogandole per nome (GRANT column-level, T-401);
//  - ANTI-PLACEBO: la riga non pubblicata di A e' letta dal suo MEMBRO owner (esiste
//    davvero), quindi la negazione ad anon non e' vacua;
//  - FALSIFICABILITA (CANARY): allargando la policy anon a USING(true) il non pubblicato
//    diventa visibile e l'oracolo va ROSSO — poi la policy e' RIPRISTINATA, byte-equivalente.
//
// Client ANON reale per le ASSERZIONI, MAI service_role (che bypassa la RLS e darebbe un
// verde VACUO — A01:2025). service_role / pgQuery (superuser) SOLO per il setup (bypassa la
// RLS ma NON i vincoli → fixture coerente), per l'ORACOLO indipendente e per la DDL del
// canary. L'SQL editor / la connessione superuser darebbero un FALSO VERDE.
//
// Le asserzioni derivano dagli acceptance_criteria AC-407-1..6
// (docs/blueprint/P4-publish/... public-serving).

// pgQuery serve alla DDL del canary → DATABASE_URL nel gate. Senza env il blocco si
// auto-salta pulito (l'orchestratore lo esegue davvero al checkpoint a stato pulito).
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

// La policy anon originale (migrazione T-401) e' `using (is_published = true)`. Il canary
// la allarga a `true` e la RIPRISTINA con questa DDL LETTERALE (nessun input interpolato:
// nessuna superficie di injection), byte-equivalente all'originale.
const widenAnonPolicy = (): Promise<unknown[]> =>
  pgQuery(
    'alter policy site_publications_select_anon on public.site_publications using (true)',
  );
const restoreAnonPolicy = (): Promise<unknown[]> =>
  pgQuery(
    'alter policy site_publications_select_anon on public.site_publications using (is_published = true)',
  );

describe.skipIf(!SB)(
  'T-407 RLS anon a runtime — pubblicato letto, non pubblicato negato, colonne private nascoste, canary falsificabile',
  () => {
    const password = 'Password123!';
    // Namespace per-file: gli slug sono UNIQUE GLOBALI, quindi vanno isolati da ogni altro
    // file/fixture. Trappola-PREFISSO sull'ASSE che il codice seleziona (public_slug): lo
    // slug del pubblicato di A e' PREFISSO PROPRIO sia del pubblicato di B sia del non
    // pubblicato di A — un lookup per prefisso (startsWith/LIKE) li confonderebbe, il match
    // ESATTO no.
    const suffisso = randomUUID().slice(0, 8);
    const emailA = `t407a_${randomUUID()}@example.test`;
    const emailB = `t407b_${randomUUID()}@example.test`;

    const slugApub = `shop-${suffisso}`; // A, is_published=true  — RIFERIMENTO
    const slugAunpub = `shop-${suffisso}-hidden`; // A, is_published=false — prefissato da slugApub
    const slugBpub = `shop-${suffisso}-plus`; // B, is_published=true  — prefissato da slugApub, anon-visibile
    const slugBunpub = `bazar-${suffisso}`; // B, is_published=false — namespace distinto

    let userAId = '';
    let userBId = '';
    let accountA = '';
    let accountB = '';
    let idApub = '';
    let idAunpub = '';
    let idBpub = '';
    let idBunpub = '';
    let anon: SupabaseClient;

    // Inserisce una publication via superuser (bypassa la RLS, NON i vincoli): la fixture
    // e' coerente con le FK composite e con gli UNIQUE globali. Mirror di T-401.
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

    // Timeout esplicito: due utenti con auth reale (bcrypt su Supabase locale) superano i
    // 10s di default dei hook di vitest.
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

      // Un sito per publication: l'UNIQUE(site_id) sulle publication impone un solo snapshot
      // per sito. Slug per-account (UNIQUE(account_id, slug)), namespacizzati col suffisso.
      const siteRows = await pgQuery<{ id: string; slug: string; account_id: string }>(
        `insert into public.sites (account_id, name, slug)
         values ($1, 'A pub',   $3),
                ($1, 'A unpub', $4),
                ($2, 'B pub',   $5),
                ($2, 'B unpub', $6)
         returning id, slug, account_id`,
        [
          accountA,
          accountB,
          `site-apub-${suffisso}`,
          `site-aunpub-${suffisso}`,
          `site-bpub-${suffisso}`,
          `site-bunpub-${suffisso}`,
        ],
      );
      const siteOf = (accountId: string, slug: string): string =>
        siteRows.find((r) => r.account_id === accountId && r.slug === slug)!.id;
      const siteApub = siteOf(accountA, `site-apub-${suffisso}`);
      const siteAunpub = siteOf(accountA, `site-aunpub-${suffisso}`);
      const siteBpub = siteOf(accountB, `site-bpub-${suffisso}`);
      const siteBunpub = siteOf(accountB, `site-bunpub-${suffisso}`);

      // Una generazione per sito (max_pages DISCORDANTI), sorgente delle FK composite.
      const genRows = await pgQuery<{ id: string; site_id: string }>(
        `insert into public.site_generations (account_id, site_id, status, max_pages)
         values ($1, $2, 'chosen', 5),
                ($1, $3, 'chosen', 3),
                ($4, $5, 'chosen', 7),
                ($4, $6, 'chosen', 4)
         returning id, site_id`,
        [accountA, siteApub, siteAunpub, accountB, siteBpub, siteBunpub],
      );
      const genOf = (siteId: string): string =>
        genRows.find((r) => r.site_id === siteId)!.id;

      // Le quattro publication. Fixture DISCORDANTE: tenant A/A/B/B, is_published
      // true/false/true/false, locale it/es/es/it, document con marker distinti; trappola
      // prefisso su public_slug (slugApub ⊂ slugAunpub, slugApub ⊂ slugBpub).
      idApub = await insertPublication(
        accountA, siteApub, genOf(siteApub), slugApub, 'it', true, { marker: `apub-${suffisso}` },
      );
      idAunpub = await insertPublication(
        accountA, siteAunpub, genOf(siteAunpub), slugAunpub, 'es', false, { marker: `aunpub-${suffisso}` },
      );
      idBpub = await insertPublication(
        accountB, siteBpub, genOf(siteBpub), slugBpub, 'es', true, { marker: `bpub-${suffisso}` },
      );
      idBunpub = await insertPublication(
        accountB, siteBunpub, genOf(siteBunpub), slugBunpub, 'it', false, { marker: `bunpub-${suffisso}` },
      );
      // Le quattro righe sono distinte (nessuna collisione di setup).
      expect(new Set([idApub, idAunpub, idBpub, idBunpub]).size).toBe(4);

      // Client ANON reale: anon key, NESSUN sign-in → ruolo Postgres `anon`, RLS attiva.
      anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
    }, 60_000);

    afterAll(async () => {
      // Rete di sicurezza: se il canary fosse stato interrotto tra widen e finally,
      // ripristina comunque la policy sicura (idempotente) prima di lasciare la DB.
      try {
        await restoreAnonPolicy();
      } catch {
        /* best effort */
      }
      // cascade: auth.users → accounts → sites → site_generations → site_publications
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-407-1
    it('anon che SELECT per il public_slug ESATTO del pubblicato di A riceve ESATTAMENTE quella riga — non la sorella prefissata, non le altre (nessun match per prefisso)', async () => {
      const { data, error } = await anon
        .from('site_publications')
        .select('public_slug, document, locale')
        .eq('public_slug', slugApub);
      expect(error).toBeNull(); // covers: AC-407-1
      const rows = data ?? [];
      expect(rows).toHaveLength(1); // covers: AC-407-1 — esattamente una riga
      expect(rows[0].public_slug).toBe(slugApub); // covers: AC-407-1
      expect((rows[0].document as { marker?: string } | undefined)?.marker).toBe(`apub-${suffisso}`); // covers: AC-407-1
      expect(rows[0].locale).toBe('it'); // covers: AC-407-1
      // Nessun match per prefisso: la sorella PUBBLICATA di B (slug con slugApub come
      // prefisso proprio, quindi anon-visibile) NON e' trascinata dentro dal match esatto.
      expect(rows.map((r) => r.public_slug)).not.toContain(slugBpub); // covers: AC-407-1

      // Guardrail: slugBpub e' DAVVERO leggibile da anon sul suo slug esatto → la sua
      // assenza sopra e' dovuta al match ESATTO, non a una soppressione RLS della riga di B.
      const sib = await anon
        .from('site_publications')
        .select('public_slug')
        .eq('public_slug', slugBpub);
      expect(sib.error).toBeNull(); // covers: AC-407-1
      expect((sib.data ?? []).map((r) => r.public_slug)).toEqual([slugBpub]); // covers: AC-407-1

      // Lettura a tabella piena: anon vede ENTRAMBI i pubblicati (cross-tenant, intenzionale)
      // e nessuno dei due non pubblicati (filtro sul namespace del file → robusto ad altre righe).
      const all = await anon.from('site_publications').select('public_slug, document, locale');
      expect(all.error).toBeNull(); // covers: AC-407-1
      const slugs = (all.data ?? []).map((r) => r.public_slug as string);
      expect(slugs).toContain(slugApub); // covers: AC-407-1
      expect(slugs).toContain(slugBpub); // covers: AC-407-1
    });

    // covers: AC-407-2
    it('anon NON legge la riga is_published=false di A — ne per slug (RLS) ne per id (GRANT) — insieme vuoto; ma la riga ESISTE (anti-placebo)', async () => {
      // Per SLUG: public_slug e' concesso ad anon, quindi il filtro e' lecito; e' la RLS anon
      // (is_published=true) a filtrare la riga non pubblicata → 0 righe, SENZA errore.
      const bySlug = await anon
        .from('site_publications')
        .select('public_slug, document, locale')
        .eq('public_slug', slugAunpub);
      expect(bySlug.error).toBeNull(); // covers: AC-407-2 — RLS, non un errore di privilegio
      expect(bySlug.data ?? []).toHaveLength(0); // covers: AC-407-2

      // Per ID: anon non ha nemmeno il GRANT column-level su `id` (concesse solo public_slug/
      // document/locale), quindi non puo' REFERENZIARE id in un filtro → 42501, negazione
      // ANCORA PIU FORTE della RLS. In ogni caso NESSUNA riga e' restituita.
      const byId = await anon
        .from('site_publications')
        .select('public_slug')
        .eq('id', idAunpub);
      expect(byId.data ?? []).toHaveLength(0); // covers: AC-407-2

      // ORACOLO INDIPENDENTE (service_role, RLS bypassata): la riga ESISTE davvero → il vuoto
      // sopra e' soppressione, non assenza di dati.
      const { data: real } = await adminClient()
        .from('site_publications')
        .select('id, is_published')
        .eq('id', idAunpub)
        .maybeSingle();
      expect(real?.id).toBe(idAunpub); // covers: AC-407-2
      expect(real?.is_published).toBe(false); // covers: AC-407-2
    });

    // covers: AC-407-3
    it('anon NON legge la riga is_published=false di B — ne per slug ne per id — insieme vuoto: il non pubblicato e nascosto per OGNI tenant, non solo per quello di riferimento', async () => {
      const bySlug = await anon
        .from('site_publications')
        .select('public_slug, document, locale')
        .eq('public_slug', slugBunpub);
      expect(bySlug.error).toBeNull(); // covers: AC-407-3
      expect(bySlug.data ?? []).toHaveLength(0); // covers: AC-407-3

      const byId = await anon
        .from('site_publications')
        .select('public_slug')
        .eq('id', idBunpub);
      expect(byId.data ?? []).toHaveLength(0); // covers: AC-407-3

      // ORACOLO INDIPENDENTE: anche la non pubblicata di B ESISTE davvero.
      const { data: real } = await adminClient()
        .from('site_publications')
        .select('id, is_published')
        .eq('id', idBunpub)
        .maybeSingle();
      expect(real?.id).toBe(idBunpub); // covers: AC-407-3
      expect(real?.is_published).toBe(false); // covers: AC-407-3
    });

    // covers: AC-407-4
    it('le colonne private (account_id / source_generation_id) non sono esposte ad anon: assenti dalla proiezione pubblica E irreferenziabili in lettura diretta (42501)', async () => {
      // (a) La proiezione pubblica del pubblicato espone ESATTAMENTE {document, locale, public_slug}.
      const { data, error } = await anon
        .from('site_publications')
        .select('public_slug, document, locale')
        .eq('public_slug', slugApub);
      expect(error).toBeNull(); // covers: AC-407-4
      const rows = data ?? [];
      expect(rows).toHaveLength(1); // covers: AC-407-4
      expect(Object.keys(rows[0]).sort()).toEqual(['document', 'locale', 'public_slug']); // covers: AC-407-4 — niente account_id/source_generation_id

      // (b) Lettura DIRETTA delle colonne private: non concesse ad anon → 42501, nessun dato.
      const acc = await anon.from('site_publications').select('account_id');
      expect(acc.error?.code).toBe('42501'); // covers: AC-407-4
      expect(acc.data).toBeNull(); // covers: AC-407-4
      const gen = await anon.from('site_publications').select('source_generation_id');
      expect(gen.error?.code).toBe('42501'); // covers: AC-407-4
      expect(gen.data).toBeNull(); // covers: AC-407-4

      // Controllo POSITIVO: una colonna concessa (document) resta leggibile → la negazione e'
      // per-colonna, non un blocco totale della tabella per anon.
      const ok = await anon
        .from('site_publications')
        .select('document')
        .eq('public_slug', slugApub);
      expect(ok.error).toBeNull(); // covers: AC-407-4
    });

    // covers: AC-407-5
    it('un MEMBRO owner di A legge la propria riga is_published=false (esiste ed e owner-readable) → la negazione ad anon non e vacua', async () => {
      // Un solo sign-in (rate limit auth): client autenticato col JWT reale di A (RLS attiva).
      const clientA = await signInAs(emailA, password);

      // Per ID: l'owner ha il GRANT di tabella (puo' referenziare id) e la RLS membro
      // (is_account_member) qualifica la riga → la riga e' RESTITUITA.
      const byId = await clientA
        .from('site_publications')
        .select('id, account_id, public_slug, is_published')
        .eq('id', idAunpub);
      expect(byId.error).toBeNull(); // covers: AC-407-5
      expect(byId.data ?? []).toHaveLength(1); // covers: AC-407-5 — la riga ESISTE ed e leggibile dall'owner
      expect(byId.data![0].account_id).toBe(accountA); // covers: AC-407-5
      expect(byId.data![0].is_published).toBe(false); // covers: AC-407-5
      expect(byId.data![0].public_slug).toBe(slugAunpub); // covers: AC-407-5

      // Per SLUG: idem, l'owner legge la propria riga non pubblicata.
      const bySlug = await clientA
        .from('site_publications')
        .select('id')
        .eq('public_slug', slugAunpub);
      expect(bySlug.error).toBeNull(); // covers: AC-407-5
      expect((bySlug.data ?? []).map((r) => r.id)).toEqual([idAunpub]); // covers: AC-407-5
    });

    // covers: AC-407-6
    it('CANARY: allargando la policy anon a USING(true) il non pubblicato (di A e di B) diventa visibile e l oracolo va ROSSO; poi la policy sicura e ripristinata', async () => {
      // PRECONDIZIONE (policy sicura): anon NON vede il non pubblicato di A. Se questo gia
      // fallisse, il canary non proverebbe nulla.
      const preA = await anon
        .from('site_publications')
        .select('public_slug')
        .eq('public_slug', slugAunpub);
      expect(preA.data ?? []).toHaveLength(0); // covers: AC-407-6 — precondizione: la policy sicura nasconde il non pubblicato

      try {
        // Allarga la policy anon a USING(true) — INSICURO, solo per il canary.
        await widenAnonPolicy();

        // Con la policy allargata, il non pubblicato di A diventa visibile ad anon: e' la
        // CONDIZIONE ROSSA che una RLS NON falsificabile non potrebbe mai mostrare.
        const leakA = await anon
          .from('site_publications')
          .select('public_slug, document, locale')
          .eq('public_slug', slugAunpub);
        expect(leakA.error).toBeNull(); // covers: AC-407-6
        const leakedRows = leakA.data ?? [];
        expect(leakedRows.map((r) => r.public_slug)).toContain(slugAunpub); // covers: AC-407-6 — RLS falsificabile: il widen fa trapelare il non pubblicato
        const leaked = leakedRows.find((r) => r.public_slug === slugAunpub);
        expect((leaked?.document as { marker?: string } | undefined)?.marker).toBe(`aunpub-${suffisso}`); // covers: AC-407-6

        // La falla e' GLOBALE (predicato `true`), non della sola riga di riferimento: anche
        // il non pubblicato di B trapela.
        const leakB = await anon
          .from('site_publications')
          .select('public_slug')
          .eq('public_slug', slugBunpub);
        expect((leakB.data ?? []).map((r) => r.public_slug)).toContain(slugBunpub); // covers: AC-407-6
      } finally {
        // RIPRISTINO deterministico (byte-equivalente all'originale): la DB resta com'era,
        // qualunque cosa accada alle asserzioni dentro il try.
        await restoreAnonPolicy();
      }

      // POST-ripristino: anon torna a NON vedere il non pubblicato → il verde del resto della
      // suite non dipende dallo stato lasciato dal canary.
      const postA = await anon
        .from('site_publications')
        .select('public_slug')
        .eq('public_slug', slugAunpub);
      expect(postA.data ?? []).toHaveLength(0); // covers: AC-407-6 — policy sicura ripristinata
    });
  },
);
