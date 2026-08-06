import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-403 (macrotask publish-core, P4) — `publishSite` DIETRO il gate `parseDocument`, RUNTIME contro
// il Supabase locale. Le asserzioni derivano dagli acceptance_criteria AC-403-1..6 (01-publish-core.md).
//
// DB-BACKED per necessita': publishSite legge/scrive sotto RLS con la sessione reale. Come T-302
// (save-revision) mockiamo SOLO la costruzione del client SSR con un client ad AUTH REALE (signInAs
// -> JWT, RLS ATTIVA); il gate, la derivazione di account_id, la scrittura, la RLS e lo UNIQUE
// globale girano per intero contro il DB. La service_role compare SOLO come ORACOLO INDIPENDENTE
// (adminClient) e nel setup, MAI dentro l'azione — un valore restituito soddisfatto da un'impl che
// scrive con service_role sarebbe un falso verde; la riga RILETTA con la service_role no.
//
// FIXTURE MULTI-TENANT con TRAPPOLA-PREFISSO: due tenant (A owner, B estraneo). Il public_slug e' il
// campo CONTROLLABILE su cui vive la trappola-prefisso — 'panificio-sole' (occupato globalmente da B)
// e' PREFISSO di 'panificio-sole-2' (anch'esso occupato da B): il dedup deve procedere per match
// ESATTO ancorato allo UNIQUE, non per prefisso, e assegnare 'panificio-sole-3'. Gli UUID (36 char
// fissi) non possono essere prefisso l'uno dell'altro, percio' la trappola sta sullo slug.

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

import { publishSite, type PublishSiteResult } from '@/data/site-publications';

// ── fixture del documento (forma di parseDocument, T-202; clonata da save-revision.test.ts) ──────
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

/** Una home BEN FORMATA: brief_fields_rendered gia' coincidente con le chiavi di `data`. */
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

/** NESSUNA pagina 'home' (solo 'offerings'): parseDocument lo rifiuta (invariante home). */
function documentoSenzaHome() {
  const home = documentoValido('nohome').pages[0];
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [{ ...home, slug: 'offerte', role: 'offerings' }],
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

type RevisionRow = { seq: number | string; document: unknown };

describe.skipIf(!SB)('T-403 publishSite — gate parseDocument, snapshot congelato, public_slug (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t403a_${randomUUID()}@example.test`;
  const emailB = `t403b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  // Siti di A (owner). Ognuno con un business_name distinto perche' lo slug intra-account non
  // interferisca fra i casi (l'exists di dedup, sotto RLS, vede il proprio account).
  let siteOne = '';
  let genOne = ''; // AC-403-1: publish riuscito
  let siteTwo = '';
  let siteThree = ''; // AC-403-3: primo publish con slug occupato globalmente da B
  let siteFour = '';
  let genFour = ''; // AC-403-4: re-publish, slug preservato
  let siteForeign = ''; // AC-403-5: posseduto da A, attaccato da B
  let siteSix = '';
  let genSix = ''; // AC-403-6: snapshot congelato disaccoppiato dalla potatura

  const docOne = documentoValido('uno'); // documento corrente di siteOne, atteso nello snapshot
  const docFourV2 = documentoValido('quattro-v2'); // revisione corrente al re-publish di siteFour
  const docSnapSix = documentoValido('snap-sei'); // snapshot congelato di siteSix

  async function creaGenerazioneA(label: string, doc: unknown): Promise<{ siteId: string; genId: string }> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: label, slug: `${label}-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteId = site.id as string;
    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountAId,
        site_id: siteId,
        status: 'chosen',
        max_pages: 8,
        chosen_variant: 0,
        document: doc,
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    return { siteId, genId: gen.id as string };
  }

  async function creaBriefA(siteId: string, businessName: string): Promise<void> {
    const { error } = await adminClient()
      .from('site_briefs')
      .insert({ account_id: accountAId, site_id: siteId, business_name: businessName, locale: 'it' });
    if (error) throw error;
  }

  // Una publication PUBBLICATA nel tenant B con un dato public_slug: occupa GLOBALMENTE lo slug
  // (UNIQUE su public_slug) restando INVISIBILE ad A sotto RLS. Le FK composite impongono di ancorare
  // sito e generazione all'account di B.
  async function creaPublicationB(label: string, publicSlug: string): Promise<void> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountBId, name: label, slug: `${label}-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteBId = site.id as string;
    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountBId,
        site_id: siteBId,
        status: 'chosen',
        max_pages: 8,
        chosen_variant: 0,
        document: documentoValido(label),
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    const { error: pubErr } = await admin.from('site_publications').insert({
      account_id: accountBId,
      site_id: siteBId,
      source_generation_id: gen.id as string,
      document: documentoValido(label),
      public_slug: publicSlug,
      locale: 'it',
      is_published: true,
      published_at: new Date().toISOString(),
    });
    if (pubErr) throw pubErr;
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

  /** Le revisioni di una generazione, RILETTE con la service_role: l'oracolo della potatura. */
  async function revisionsOf(genId: string): Promise<RevisionRow[]> {
    const { data, error } = await adminClient()
      .from('site_document_revisions')
      .select('seq, document')
      .eq('site_generation_id', genId)
      .order('seq', { ascending: true });
    if (error) throw error;
    return (data ?? []) as RevisionRow[];
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

    // AC-403-1: sito con documento corrente valido.
    ({ siteId: siteOne, genId: genOne } = await creaGenerazioneA('t403-one', docOne));
    await creaBriefA(siteOne, 'Bottega Aurora');

    // AC-403-2: documento corrente INVALIDO (nessuna home), piantato come baseline fuori dal gate.
    ({ siteId: siteTwo } = await creaGenerazioneA('t403-two', documentoSenzaHome()));
    await creaBriefA(siteTwo, 'Trattoria Due');

    // AC-403-3: business_name che slugifica a uno slug occupato GLOBALMENTE dal tenant B.
    ({ siteId: siteThree } = await creaGenerazioneA('t403-three', documentoValido('tre')));
    await creaBriefA(siteThree, 'Panificio Sole');

    // AC-403-4: sito da pubblicare due volte (slug preservato al re-publish).
    ({ siteId: siteFour, genId: genFour } = await creaGenerazioneA('t403-four', documentoValido('quattro-v1')));
    await creaBriefA(siteFour, 'Osteria Quattro');

    // AC-403-5: sito di A che B tentera' di pubblicare (deve fallire con 404).
    ({ siteId: siteForeign } = await creaGenerazioneA('t403-foreign', documentoValido('cinque')));
    await creaBriefA(siteForeign, 'Gelateria Cinque');

    // AC-403-6: sito il cui documento corrente e' una REVISIONE (seq 1), che verra' poi potata.
    ({ siteId: siteSix, genId: genSix } = await creaGenerazioneA('t403-six', documentoValido('baseline-sei')));
    await creaBriefA(siteSix, 'Pasticceria Sei');
    const { error: revErr } = await adminClient().from('site_document_revisions').insert({
      account_id: accountAId,
      site_generation_id: genSix,
      source: 'edited',
      seq: 1,
      document: docSnapSix,
    });
    if (revErr) throw revErr;

    // Tenant B occupa GLOBALMENTE 'panificio-sole' e 'panificio-sole-2' (trappola-prefisso):
    // A, che slugifica 'Panificio Sole' -> 'panificio-sole', dovra' deviare a 'panificio-sole-3'.
    await creaPublicationB('t403-b1', 'panificio-sole');
    await creaPublicationB('t403-b2', 'panificio-sole-2');

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
  }, 60_000);

  afterAll(async () => {
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-403-1
  it('pubblica un sito posseduto: riga is_published=true, document = copia validata, source_generation_id e published_at impostati', async () => {
    clientHolder.current = clientA;
    expect(await publicationOf(siteOne)).toBeNull();

    const res: PublishSiteResult = await publishSite(siteOne);
    expect(res.ok).toBe(true); // covers: AC-403-1
    if (!res.ok) throw new Error('publishSite doveva riuscire');
    // 'Bottega Aurora' slugifica a 'bottega-aurora' (calcolato a mano), slug libero.
    expect(res.public_slug).toBe('bottega-aurora'); // covers: AC-403-1
    expect(res.url).toBe('/s/bottega-aurora'); // covers: AC-403-1

    // ORACOLO INDIPENDENTE: la riga scritta e' pubblicata, ancorata alla generazione corrente, con
    // lo snapshot uguale alla COPIA VALIDATA del documento corrente (parseDocument e' identita' su un
    // documento gia' ben formato, quindi == docOne, il letterale seminato).
    const pub = await publicationOf(siteOne);
    expect(pub).not.toBeNull(); // covers: AC-403-1
    expect(pub?.is_published).toBe(true); // covers: AC-403-1
    expect(pub?.document).toEqual(docOne); // covers: AC-403-1
    expect(pub?.source_generation_id).toBe(genOne); // covers: AC-403-1
    expect(pub?.published_at).toBeTruthy(); // covers: AC-403-1
    expect(pub?.account_id).toBe(accountAId); // covers: AC-403-1
    expect(pub?.public_slug).toBe('bottega-aurora'); // covers: AC-403-1
    expect(pub?.locale).toBe('it'); // covers: AC-403-1

    // Nessun src/href introdotto nello snapshot (P2-D12 / security_note 5): e' la copia validata.
    expect(JSON.stringify(pub?.document)).not.toMatch(/"(url|src|href)"\s*:/); // covers: AC-403-1
  });

  // covers: AC-403-2
  it('un documento corrente che non supera parseDocument (nessuna home) e RIFIUTATO (400) e NESSUNA publication e scritta', async () => {
    clientHolder.current = clientA;
    expect(await publicationOf(siteTwo)).toBeNull();

    const res = await publishSite(siteTwo);
    expect(res.ok).toBe(false); // covers: AC-403-2
    if (!res.ok) expect(res.status).toBe(400); // covers: AC-403-2

    // ORACOLO: il gate ha respinto PRIMA della scrittura — nessuna publication esiste per il sito.
    expect(await publicationOf(siteTwo)).toBeNull(); // covers: AC-403-2
  });

  // covers: AC-403-3
  it('il primo publish con uno slug occupato GLOBALMENTE da un altro tenant devia allo slug libero, deduplicato e non riservato (match esatto, non per prefisso)', async () => {
    clientHolder.current = clientA;
    expect(await publicationOf(siteThree)).toBeNull();

    const res = await publishSite(siteThree);
    expect(res.ok).toBe(true); // covers: AC-403-3
    if (!res.ok) throw new Error('publishSite doveva riuscire');
    // 'panificio-sole' e 'panificio-sole-2' sono occupati da B (invisibili ad A sotto RLS): l'INSERT
    // prende 23505 su entrambi e devia a 'panificio-sole-3' (dedup per match esatto ancorato allo
    // UNIQUE globale). La trappola-prefisso ('panificio-sole' prefisso di 'panificio-sole-2') non
    // deve far saltare oltre.
    expect(res.public_slug).toBe('panificio-sole-3'); // covers: AC-403-3
    expect(res.url).toBe('/s/panificio-sole-3'); // covers: AC-403-3

    // ORACOLO: la riga di A porta lo slug deviato; non ha rivendicato uno slug di B.
    const pub = await publicationOf(siteThree);
    expect(pub?.public_slug).toBe('panificio-sole-3'); // covers: AC-403-3
    expect(pub?.account_id).toBe(accountAId); // covers: AC-403-3
    expect(pub?.is_published).toBe(true); // covers: AC-403-3
  });

  // covers: AC-403-4
  it('al re-publish dopo nuove modifiche lo stesso public_slug e PRESERVATO e lo snapshot e aggiornato al documento corrente', async () => {
    clientHolder.current = clientA;

    // Primo publish: 'Osteria Quattro' -> 'osteria-quattro' (slug libero).
    const res1 = await publishSite(siteFour);
    expect(res1.ok).toBe(true); // covers: AC-403-4
    if (!res1.ok) throw new Error('primo publishSite doveva riuscire');
    expect(res1.public_slug).toBe('osteria-quattro'); // covers: AC-403-4
    const pub1 = await publicationOf(siteFour);
    // Al primo publish lo snapshot e' la baseline 'quattro-v1' (nessuna revisione ancora).
    expect(pub1?.document).toEqual(documentoValido('quattro-v1')); // covers: AC-403-4

    // Nuova modifica: una revisione corrente (seq 1) col documento aggiornato 'quattro-v2'.
    const { error: revErr } = await adminClient().from('site_document_revisions').insert({
      account_id: accountAId,
      site_generation_id: genFour,
      source: 'edited',
      seq: 1,
      document: docFourV2,
    });
    if (revErr) throw revErr;

    // Re-publish: STESSO slug, snapshot aggiornato al documento corrente ('quattro-v2').
    const res2 = await publishSite(siteFour);
    expect(res2.ok).toBe(true); // covers: AC-403-4
    if (!res2.ok) throw new Error('re-publishSite doveva riuscire');
    expect(res2.public_slug).toBe('osteria-quattro'); // covers: AC-403-4
    expect(res2.public_slug).toBe(res1.public_slug); // covers: AC-403-4

    // ORACOLO: una sola riga per il sito (upsert, non un secondo snapshot), slug invariato, document
    // aggiornato a 'quattro-v2' e diverso dalla vecchia baseline 'quattro-v1'.
    const pub2 = await publicationOf(siteFour);
    expect(pub2?.public_slug).toBe('osteria-quattro'); // covers: AC-403-4
    expect(pub2?.document).toEqual(docFourV2); // covers: AC-403-4
    expect(pub2?.document).not.toEqual(documentoValido('quattro-v1')); // covers: AC-403-4
    expect(pub2?.id).toBe(pub1?.id); // covers: AC-403-4
  });

  // covers: AC-403-5
  it('un sito non posseduto (altro tenant) o inesistente risponde 404 (anti-enumerazione) e nessuna riga e scritta per quel tenant', async () => {
    // B (tenant diverso) tenta di pubblicare il sito di A: sotto la SUA RLS la generazione di A filtra
    // a null -> 404, mai un errore che ne riveli l'esistenza.
    clientHolder.current = clientB;
    expect(await publicationOf(siteForeign)).toBeNull();

    const resForeign = await publishSite(siteForeign);
    expect(resForeign.ok).toBe(false); // covers: AC-403-5
    if (!resForeign.ok) expect(resForeign.status).toBe(404); // covers: AC-403-5

    // Un site_id INESISTENTE (mai creato) da' lo STESSO 404: indistinguibile dall'altrui.
    const resGhost = await publishSite(randomUUID());
    expect(resGhost.ok).toBe(false); // covers: AC-403-5
    if (!resGhost.ok) expect(resGhost.status).toBe(404); // covers: AC-403-5

    // ORACOLO INDIPENDENTE: nessuna publication per il sito di A, ne alcuna del tenant di B su di esso.
    expect(await publicationOf(siteForeign)).toBeNull(); // covers: AC-403-5
  });

  // covers: AC-403-6
  it('lo snapshot pubblicato resta INVARIATO quando la revisione da cui proviene viene potata (congelato, disaccoppiato dalla FIFO)', async () => {
    clientHolder.current = clientA;

    // Pubblica: il documento corrente e' la revisione seq 1 ('snap-sei'), che diventa lo snapshot.
    const res = await publishSite(siteSix);
    expect(res.ok).toBe(true); // covers: AC-403-6
    if (!res.ok) throw new Error('publishSite doveva riuscire');
    const pubPrima = await publicationOf(siteSix);
    expect(pubPrima?.document).toEqual(docSnapSix); // covers: AC-403-6

    // POTATURA FIFO simulata (T-303): una nuova revisione (seq 2) e' scritta e la piu' VECCHIA (seq 1,
    // la FONTE dello snapshot) e' eliminata. La publication vive in un'ALTRA tabella: la potatura non
    // la nomina mai.
    const admin = adminClient();
    const { error: insErr } = await admin.from('site_document_revisions').insert({
      account_id: accountAId,
      site_generation_id: genSix,
      source: 'edited',
      seq: 2,
      document: documentoValido('churn-newer'),
    });
    if (insErr) throw insErr;
    const { error: delErr } = await admin
      .from('site_document_revisions')
      .delete()
      .eq('site_generation_id', genSix)
      .eq('seq', 1);
    if (delErr) throw delErr;

    // La fonte (seq 1) e' davvero sparita e resta solo seq 2: la storia delle revisioni E' cambiata.
    const revs = await revisionsOf(genSix);
    expect(revs.map((r) => Number(r.seq))).toEqual([2]); // covers: AC-403-6

    // ORACOLO: lo snapshot pubblicato e' comunque INVARIATO (copia congelata, non un riferimento alla
    // revisione potata).
    const pubDopo = await publicationOf(siteSix);
    expect(pubDopo?.document).toEqual(docSnapSix); // covers: AC-403-6
  });
});
