import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-404 (macrotask publish-core, P4) — `unpublishSite` RUNTIME contro il Supabase locale. Le
// asserzioni derivano dagli acceptance_criteria AC-404-1..4 (01-publish-core.md).
//
// DB-BACKED per necessita': unpublishSite trova/aggiorna la publication sotto RLS con la sessione
// reale. Come T-403 (publish-site) mockiamo SOLO la costruzione del client SSR con un client ad AUTH
// REALE (signInAs -> JWT, RLS ATTIVA); la ricerca sotto RLS, l'update e la RLS anon-published girano
// per intero contro il DB. La service_role compare SOLO come ORACOLO INDIPENDENTE (adminClient) e nel
// setup, MAI dentro l'azione — un valore restituito soddisfatto da un'impl che scrive con
// service_role sarebbe un falso verde; la riga RILETTA con la service_role no. AC-404-2 usa in piu' un
// client `anon` REALE (anon key, nessuna sessione) per provare la sparizione dalla vista pubblica.
//
// FIXTURE MULTI-TENANT con TRAPPOLA-PREFISSO sul campo CONTROLLABILE public_slug (gli UUID, 36 char
// fissi, non possono essere prefisso l'uno dell'altro): nel tenant A 'osteria' e' PREFISSO di
// 'osteria-due' (ritirando 'osteria' il sibling 'osteria-due' non deve muoversi — l'update filtra per
// site_id ESATTO); nel tenant B 'negozio' e' PREFISSO di 'negozio-due' (A che tenta di ritirare la
// riga di B prende 404 e NESSUNA delle due righe di B e' toccata). public_slug e' UNIQUE GLOBALE e il
// DB e' condiviso fra i file di test (in parallelo): gli slug seminati qui sono propri di questo file
// (namespace 't404') per non collidere con quelli di site-publications.schema/publish-site.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { publishSite, unpublishSite, type UnpublishSiteResult } from '@/data/site-publications';

// ── fixture del documento (forma di parseDocument, T-202; clonata da publish-site.test.ts) ────────
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

/** Una home BEN FORMATA: parseDocument e' identita' su di essa (== il letterale seminato). */
function documentoValido(firma: string) {
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: `Bottega Aurora — ${firma}`,
        meta_description: `Pane a lievitazione naturale, ${firma}.`,
        blocks: [
          {
            id: 'hero',
            content: {
              hero_title: `Il pane di via Roma (${firma})`,
              hero_subtitle: `Sfornato tre volte al giorno. ${firma}`,
            },
            data: { business_name: `Bottega Aurora ${firma}` },
            brief_fields_rendered: ['business_name'],
            images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
          },
        ],
      },
    ],
  };
}

type PublicationRow = {
  id: string;
  account_id: string;
  site_id: string;
  source_generation_id: string;
  public_slug: string;
  locale: string;
  is_published: boolean;
  published_at: string | null;
  document: unknown;
};

// Documenti DISCORDANTI per-sito (firma distinta): lo snapshot di ciascuna publication e' un letterale
// seminato che l'oracolo confronta identico dopo il ritiro.
const docOne = documentoValido('osteria-uno');
const docGuard = documentoValido('guardia');
const docAnon = documentoValido('gelato');
const docB = documentoValido('bravo');
const docB2 = documentoValido('bravo-due');

describe.skipIf(!SB)('T-404 unpublishSite — is_published=false, snapshot e slug preservati, RLS anon-published (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t404a_${randomUUID()}@example.test`;
  const emailB = `t404b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let anon: SupabaseClient;

  let siteOne = ''; // AC-404-1: pubblicato, ritirato -> is_published=false, doc+slug invariati
  let siteGuard = ''; // AC-404-1: sibling 'osteria-due', deve restare pubblicato (precisione .eq)
  let siteAnon = ''; // AC-404-2: ritirato -> invisibile ad anon
  let siteRe = ''; // AC-404-3: publish -> unpublish -> re-publish, stesso slug
  let siteNoPub = ''; // AC-404-4: posseduto da A ma SENZA publication -> 404
  let siteB = ''; // AC-404-4: publication di B (tenant estraneo), A prende 404, resta intatta
  let siteB2 = ''; // AC-404-4: 'negozio-due', compagna trappola-prefisso, resta intatta

  /** Crea un sito + una generazione congelata (document not null) per l'account dato. */
  async function creaSito(accountId: string, label: string): Promise<{ siteId: string; genId: string }> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountId, name: label, slug: `${label}-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteId = site.id as string;
    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountId,
        site_id: siteId,
        status: 'chosen',
        max_pages: 8,
        chosen_variant: 0,
        document: documentoValido(label),
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    return { siteId, genId: gen.id as string };
  }

  /** Semina una publication PUBBLICATA (is_published=true) con document e public_slug dati. */
  async function seedPublication(
    accountId: string,
    label: string,
    publicSlug: string,
    doc: unknown,
  ): Promise<string> {
    const { siteId, genId } = await creaSito(accountId, label);
    const { error } = await adminClient().from('site_publications').insert({
      account_id: accountId,
      site_id: siteId,
      source_generation_id: genId,
      document: doc,
      public_slug: publicSlug,
      locale: 'it',
      is_published: true,
      published_at: new Date().toISOString(),
    });
    if (error) throw error;
    return siteId;
  }

  async function creaBrief(accountId: string, siteId: string, businessName: string): Promise<void> {
    const { error } = await adminClient()
      .from('site_briefs')
      .insert({ account_id: accountId, site_id: siteId, business_name: businessName, locale: 'it' });
    if (error) throw error;
  }

  /** La publication di un sito, RILETTA con la service_role (RLS bypassata): l'oracolo. */
  async function publicationOf(siteId: string): Promise<PublicationRow | null> {
    const { data, error } = await adminClient()
      .from('site_publications')
      .select('id, account_id, site_id, source_generation_id, public_slug, locale, is_published, published_at, document')
      .eq('site_id', siteId)
      .maybeSingle();
    if (error) throw error;
    return (data as PublicationRow | null) ?? null;
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA, error: accAErr } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    if (accAErr || !accA) throw accAErr ?? new Error('account di A assente');
    accountAId = accA.id as string;
    const { data: accB, error: accBErr } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userBId)
      .single();
    if (accBErr || !accB) throw accBErr ?? new Error('account di B assente');
    accountBId = accB.id as string;

    // Tenant A — trappola-prefisso su slug: 'osteria' PREFISSO di 'osteria-due'.
    siteOne = await seedPublication(accountAId, 't404-one', 'osteria', docOne);
    siteGuard = await seedPublication(accountAId, 't404-guard', 'osteria-due', docGuard);
    siteAnon = await seedPublication(accountAId, 't404-anon', 'gelateria', docAnon);

    // AC-404-3: sito con brief, pubblicato via publishSite (slug generato), poi ritirato e ripubblicato.
    ({ siteId: siteRe } = await creaSito(accountAId, 't404-re'));
    await creaBrief(accountAId, siteRe, 'Trattoria Ritiro');

    // AC-404-4 (b): sito posseduto da A ma SENZA publication.
    ({ siteId: siteNoPub } = await creaSito(accountAId, 't404-nopub'));

    // Tenant B — trappola-prefisso su slug: 'negozio' PREFISSO di 'negozio-due'.
    siteB = await seedPublication(accountBId, 't404-b1', 'negozio', docB);
    siteB2 = await seedPublication(accountBId, 't404-b2', 'negozio-due', docB2);

    // B non agisce come sessione: l'attacco cross-tenant di AC-404-4 e' A che tenta la riga di B sotto
    // la PROPRIA RLS. Di B servono solo l'account e le publication seminate (via adminClient) sopra.
    clientA = await signInAs(emailA, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }, 60_000);

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-404-1
  it('un sito pubblicato ritirato porta is_published=false con document e public_slug INVARIATI (riga non eliminata); un sibling non e toccato', async () => {
    clientHolder.current = clientA;

    // Stato iniziale (oracolo): pubblicato, con lo snapshot e lo slug seminati.
    const prima = await publicationOf(siteOne);
    expect(prima?.is_published).toBe(true); // covers: AC-404-1
    expect(prima?.public_slug).toBe('osteria'); // covers: AC-404-1
    expect(prima?.document).toEqual(docOne); // covers: AC-404-1

    const res: UnpublishSiteResult = await unpublishSite(siteOne);
    expect(res.ok).toBe(true); // covers: AC-404-1

    // ORACOLO INDIPENDENTE: la riga ESISTE ancora (non cancellata), is_published=false, document e
    // public_slug INTATTI (== i letterali seminati), stesso id (non ricreata).
    const dopo = await publicationOf(siteOne);
    expect(dopo).not.toBeNull(); // covers: AC-404-1
    expect(dopo?.is_published).toBe(false); // covers: AC-404-1
    expect(dopo?.public_slug).toBe('osteria'); // covers: AC-404-1
    expect(dopo?.document).toEqual(docOne); // covers: AC-404-1
    expect(dopo?.id).toBe(prima?.id); // covers: AC-404-1

    // PRECISIONE: il sibling 'osteria-due' (di cui 'osteria' e' PREFISSO) resta pubblicato — l'update
    // ha filtrato per site_id esatto, non per prefisso ne' a tappeto.
    const guardia = await publicationOf(siteGuard);
    expect(guardia?.is_published).toBe(true); // covers: AC-404-1
    expect(guardia?.public_slug).toBe('osteria-due'); // covers: AC-404-1
  });

  // covers: AC-404-2
  it('dopo il ritiro la riga non e piu leggibile da anon (RLS anon-published: is_published=false invisibile)', async () => {
    clientHolder.current = clientA;

    // CONTROLLO: da pubblicata, anon la vede interrogando per public_slug (sole colonne pubbliche).
    const primaAnon = await anon
      .from('site_publications')
      .select('public_slug, document, locale')
      .eq('public_slug', 'gelateria');
    expect(primaAnon.error).toBeNull(); // covers: AC-404-2
    expect(primaAnon.data?.length).toBe(1); // covers: AC-404-2

    const res = await unpublishSite(siteAnon);
    expect(res.ok).toBe(true); // covers: AC-404-2

    // Ritirata (is_published=false), la policy anon (using is_published = true) la nasconde: 0 righe.
    const dopoAnon = await anon
      .from('site_publications')
      .select('public_slug, document, locale')
      .eq('public_slug', 'gelateria');
    expect(dopoAnon.error).toBeNull(); // covers: AC-404-2
    expect(dopoAnon.data?.length).toBe(0); // covers: AC-404-2

    // ORACOLO: la riga vive ancora (per anon solo nascosta), contenuto non alterato — solo il flag.
    const oracolo = await publicationOf(siteAnon);
    expect(oracolo?.is_published).toBe(false); // covers: AC-404-2
    expect(oracolo?.public_slug).toBe('gelateria'); // covers: AC-404-2
    expect(oracolo?.document).toEqual(docAnon); // covers: AC-404-2
  });

  // covers: AC-404-3
  it('un sito ritirato e poi ripubblicato riusa lo STESSO public_slug (identita pubblica preservata al re-publish)', async () => {
    clientHolder.current = clientA;

    // Primo publish: 'Trattoria Ritiro' slugifica a 'trattoria-ritiro' (calcolato a mano), slug libero.
    const pub1 = await publishSite(siteRe);
    expect(pub1.ok).toBe(true); // covers: AC-404-3
    if (!pub1.ok) throw new Error('primo publishSite doveva riuscire');
    expect(pub1.public_slug).toBe('trattoria-ritiro'); // covers: AC-404-3

    // Ritiro: is_published=false, slug preservato.
    const unp = await unpublishSite(siteRe);
    expect(unp.ok).toBe(true); // covers: AC-404-3
    const dopoRitiro = await publicationOf(siteRe);
    expect(dopoRitiro?.is_published).toBe(false); // covers: AC-404-3
    expect(dopoRitiro?.public_slug).toBe('trattoria-ritiro'); // covers: AC-404-3

    // Re-publish: lo STESSO slug e' riusato (non ri-generato), la riga torna pubblicata.
    const pub2 = await publishSite(siteRe);
    expect(pub2.ok).toBe(true); // covers: AC-404-3
    if (!pub2.ok) throw new Error('re-publishSite doveva riuscire');
    expect(pub2.public_slug).toBe('trattoria-ritiro'); // covers: AC-404-3
    expect(pub2.public_slug).toBe(pub1.public_slug); // covers: AC-404-3

    // ORACOLO: una sola riga per il sito, di nuovo pubblicata, con lo slug d'origine.
    const oracolo = await publicationOf(siteRe);
    expect(oracolo?.is_published).toBe(true); // covers: AC-404-3
    expect(oracolo?.public_slug).toBe('trattoria-ritiro'); // covers: AC-404-3
  });

  // covers: AC-404-4
  it('un sito non posseduto o senza publication risponde 404 (anti-enumerazione) e nessuna riga di un altro tenant e toccata', async () => {
    clientHolder.current = clientA;

    // (a) A tenta di ritirare la publication di B: sotto la SUA RLS la riga di B filtra a null -> 404,
    // mai un errore che ne riveli l'esistenza.
    const foreign = await unpublishSite(siteB);
    expect(foreign.ok).toBe(false); // covers: AC-404-4
    if (!foreign.ok) expect(foreign.status).toBe(404); // covers: AC-404-4

    // ORACOLO INDIPENDENTE: la riga di B ('negozio') e la compagna trappola-prefisso ('negozio-due')
    // restano INTATTE, ancora pubblicate col contenuto seminato — l'update di A non ha toccato altri tenant.
    const bIntatta = await publicationOf(siteB);
    expect(bIntatta?.is_published).toBe(true); // covers: AC-404-4
    expect(bIntatta?.public_slug).toBe('negozio'); // covers: AC-404-4
    expect(bIntatta?.document).toEqual(docB); // covers: AC-404-4
    expect(bIntatta?.account_id).toBe(accountBId); // covers: AC-404-4
    const b2Intatta = await publicationOf(siteB2);
    expect(b2Intatta?.is_published).toBe(true); // covers: AC-404-4
    expect(b2Intatta?.public_slug).toBe('negozio-due'); // covers: AC-404-4

    // (b) Un sito POSSEDUTO da A ma SENZA publication -> stesso 404, indistinguibile dall'altrui.
    const senza = await unpublishSite(siteNoPub);
    expect(senza.ok).toBe(false); // covers: AC-404-4
    if (!senza.ok) expect(senza.status).toBe(404); // covers: AC-404-4

    // (c) Un site_id INESISTENTE (mai creato) da' lo STESSO 404 (anti-enumerazione P1-D21).
    const ghost = await unpublishSite(randomUUID());
    expect(ghost.ok).toBe(false); // covers: AC-404-4
    if (!ghost.ok) expect(ghost.status).toBe(404); // covers: AC-404-4
  });
});
