// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pgQuery } from './helpers/pg';
import { adminClient, createTestUser, deleteTestUser } from './helpers/supabase-test';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';

// T-411 (macrotask seo-base, P4) — ORACOLO di sitemap.xml per-sito + robots.txt + noindex
// editor/preview. Le asserzioni DERIVANO da AC-411-1..5 (blueprint P4-M3), taggate
// `// covers: AC-411-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: notFound() con throw-sentinel, come in produzione (in Next lancia e interrompe).
//    redirect/useRouter sono seam INERTI necessari solo perche' importare le pagine editor/preview
//    (per leggerne il `metadata`) trascina la loro catena di guardia/chrome.
//  - @/data/public-sitemap readPublishedSiteForSitemap: il SEAM DATI anon+RLS. Modella la RLS
//    anon-published + il match ESATTO su public_slug con una MAPPA di sole righe pubblicate: uno
//    slug inesistente O non pubblicato -> `null` (indistinguibili, P1-D21). E' il SOLO mock del
//    percorso sitemap: parseDocument, buildSitemapXml/xmlEscape e getSiteBaseUrl restano REALI.
//  - i seam di dati delle pagine editor/preview (supabase-ssr, sites, generation-document,
//    generations, briefs, revisions, choose): inerti, servono solo a far IMPORTARE la pagina —
//    il suo default component non e' mai invocato, si legge solo l'export statico `metadata`.
//
// PROPRIETA' PINNATE oltre agli AC:
//  - la sitemap risolve per UGUAGLIANZA ESATTA su public_slug: trappola-PREFISSO cafe/cafe-2 (la
//    sorella non pubblicata) + isolamento cross-tenant (bar). L'URL nasce dal public_slug DELLA RIGA
//    e dalla base di config, mai da testo libero; i valori inseriti sono XML-escaped (dominio puro).
//  - piu' la PROVA A RUNTIME (skipIf(!SB)) del GRANT column-level di published_at ad anon: anon lo
//    legge per una riga pubblicata, mentre account_id/source_generation_id restano NEGATI (42501).

// ── mock: next/navigation (notFound sentinel + seam inerti per l'import delle pagine) ─────────────
const { NOT_FOUND, notFoundSpy } = vi.hoisted(() => {
  const sentinel = Symbol('not-found');
  return {
    NOT_FOUND: sentinel,
    notFoundSpy: vi.fn(() => {
      throw sentinel;
    }),
  };
});
vi.mock('next/navigation', () => ({
  notFound: notFoundSpy,
  redirect: vi.fn(() => {
    throw new Error('redirect');
  }),
  useRouter: () => ({ refresh: () => {} }),
}));

// getTranslations: stub inerte (le pagine editor/preview lo importano via guard; qui non serve la
// traduzione, si legge solo il `metadata` statico). Ritorna una funzione identita' sulla chiave.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

// ── mock: il SEAM DATI del percorso sitemap (anon+RLS, match esatto) ──────────────────────────────
type SitemapRow = { document: unknown; public_slug: string; published_at: string | null };
const { sitemapHolder, readSitemapSpy } = vi.hoisted(() => {
  // Mappa di sole righe PUBBLICATE, keyed per public_slug ESATTO: modella insieme la RLS
  // anon-published (il non pubblicato non c'e' -> null) e il match esatto (il prefisso non collide).
  const holder = { rows: new Map<string, { document: unknown; public_slug: string; published_at: string | null }>() };
  return {
    sitemapHolder: holder,
    readSitemapSpy: vi.fn(async (slug: string) => holder.rows.get(slug) ?? null),
  };
});
vi.mock('@/data/public-sitemap', () => ({ readPublishedSiteForSitemap: readSitemapSpy }));

// ── mock: seam INERTI per far importare le pagine editor/preview (mai eseguite) ───────────────────
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => null }));
vi.mock('@/data/sites', () => ({ listSites: async () => ({ ok: true, sites: [] }) }));
vi.mock('@/data/generation-document', () => ({ readGenerationDocument: async () => ({ ok: true, document: null }) }));
vi.mock('@/data/generations', () => ({ getGeneration: async () => ({ ok: true, generation: null }) }));
vi.mock('@/data/briefs', () => ({ getBrief: async () => ({ ok: true, brief: null, status: null, complete: false }) }));
vi.mock('@/data/site-document-revisions', () => ({
  saveRevision: vi.fn(async () => ({ ok: true, document: null })),
  restoreRevision: vi.fn(async () => ({ ok: true, document: null })),
  listRevisions: vi.fn(async () => ({ ok: true, revisions: [] })),
}));
vi.mock('@/data/generation-choose', () => ({ selectVariant: vi.fn(async () => undefined) }));

// Import DOPO i mock.
import { GET } from '@/app/s/[slug]/sitemap.xml/route';
import robots from '@/app/robots';
import { metadata as editorMetadata } from '@/app/[locale]/editor/[siteId]/page';
import { metadata as previewMetadata } from '@/app/[locale]/preview/[siteId]/page';
import { xmlEscape, buildSitemapXml } from '@/domain/generation/sitemap';

// ── costanti ──────────────────────────────────────────────────────────────────────────────────────
const BASE = 'https://belora.example';
const THEME_ID = THEMES[0].id;

// published_at DISCORDANTI (W3C datetime, validi come <lastmod>).
const T_CAFE = '2026-08-01T09:00:00.000Z';
const T_BAR = '2026-07-15T18:30:00.000Z';

// ── builder di fixture (documenti VALIDI: passano parseDocument, gate reale del percorso) ───────────
function block(id: string): SiteBlock {
  return { id, content: {}, data: {}, brief_fields_rendered: [], images: [] };
}
function page(slug: string, role: SiteDocument['pages'][number]['role']): SiteDocument['pages'][number] {
  return { slug, role, title: `T ${slug}`, meta_description: `D ${slug}`, blocks: [block('hero')] };
}
// cafe: due pagine (discordante con bar, one-pager); bar: una pagina. La sitemap emette comunque UNA
// url per sito (la rotta pubblica /s/<slug> serve l'intero documento a URL UNICO), quindi il numero
// di pagine non moltiplica le <loc>: pinna che si liste il solo URL canonico del sito.
const DOC_CAFE: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME_ID,
  pages: [page('home', 'home'), page('offerte', 'offerings')],
};
const DOC_BAR: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME_ID,
  pages: [page('home', 'home')],
};

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const req = () => new Request('http://localhost/s/x/sitemap.xml');
const parseXml = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = BASE;
  // Fixture DISCORDANTE con trappola-PREFISSO + cross-tenant: SOLO le pubblicate stanno nella mappa.
  //  - 'cafe'   pubblicata (tenant A), public_slug='cafe'
  //  - 'bar'    pubblicata (tenant B, altro tenant), public_slug='bar'
  //  - 'cafe-2' NON pubblicata -> ASSENTE dalla mappa (la RLS anon la filtra a null); e' PREFISSO-
  //             discordante di 'cafe' (un lookup per prefisso la trascinerebbe dentro, il match esatto no)
  sitemapHolder.rows = new Map<string, SitemapRow>([
    ['cafe', { document: DOC_CAFE, public_slug: 'cafe', published_at: T_CAFE }],
    ['bar', { document: DOC_BAR, public_slug: 'bar', published_at: T_BAR }],
  ]);
  readSitemapSpy.mockClear();
  notFoundSpy.mockClear();
});

afterEach(() => {
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-411-1 — sitemap del pubblicato: URL assoluto + lastmod, urlset valido
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 sitemap.xml — pubblicato: <loc> assoluto + <lastmod>, urlset valido (AC-411-1)', () => {
  // covers: AC-411-1
  it('per lo slug pubblicato "cafe" (published_at T): urlset XML valido con <base>/s/cafe e <lastmod>=T', async () => {
    // Sanity: le fixture sono documenti VALIDI (parseDocument, il gate reale che la rotta applica).
    expect(parseDocument(DOC_CAFE).ok).toBe(true);
    expect(parseDocument(DOC_BAR).ok).toBe(true);

    const res = await GET(req(), ctx('cafe'));
    expect(res.headers.get('content-type')).toContain('xml'); // covers: AC-411-1
    const xml = await res.text();

    // XML valido: parsa senza errori e la radice e' <urlset>.
    const doc = parseXml(xml);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0); // covers: AC-411-1
    expect(doc.documentElement.tagName).toBe('urlset'); // covers: AC-411-1

    // Contiene l'URL ASSOLUTO della riga e il suo lastmod.
    const locs = [...doc.getElementsByTagName('loc')].map((n) => n.textContent);
    expect(locs).toContain(`${BASE}/s/cafe`); // covers: AC-411-1
    const lastmods = [...doc.getElementsByTagName('lastmod')].map((n) => n.textContent);
    expect(lastmods).toContain(T_CAFE); // covers: AC-411-1
    // Assoluto (schema+host), mai relativo.
    expect(`${BASE}/s/cafe`.startsWith('https://')).toBe(true); // covers: AC-411-1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-411-2 — match ESATTO: solo "cafe", mai la sorella prefissata "cafe-2" ne l'altro tenant "bar"
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 sitemap.xml — match esatto su public_slug, isolamento prefisso/tenant (AC-411-2)', () => {
  // covers: AC-411-2
  it('sitemap di "cafe": legge per slug ESATTO, elenca SOLO <base>/s/cafe (mai cafe-2, mai bar)', async () => {
    const res = await GET(req(), ctx('cafe'));
    const xml = await res.text();

    // Lettura per uguaglianza esatta (mai prefisso/LIKE).
    expect(readSitemapSpy).toHaveBeenCalledWith('cafe'); // covers: AC-411-2

    const doc = parseXml(xml);
    const locs = [...doc.getElementsByTagName('loc')].map((n) => n.textContent);
    // ESATTAMENTE una <loc>, quella del sito richiesto: nessuna moltiplicazione per pagina.
    expect(locs).toEqual([`${BASE}/s/cafe`]); // covers: AC-411-2
    // La sorella NON pubblicata col PREFISSO condiviso non compare (match esatto, non prefisso).
    expect(xml).not.toContain('/s/cafe-2'); // covers: AC-411-2
    // Ne l'altro tenant.
    expect(xml).not.toContain('/s/bar'); // covers: AC-411-2
  });

  // covers: AC-411-2
  it('l URL nasce dal public_slug DELLA RIGA (base di config), non dallo slug grezzo della richiesta', async () => {
    // La riga di 'cafe' porta public_slug='cafe'; si richiede uno slug DIVERSO che risolve alla
    // stessa riga (mappa aggiunta al volo) per osservare che l'URL usa il public_slug della RIGA.
    sitemapHolder.rows.set('alias-richiesta', { document: DOC_CAFE, public_slug: 'cafe', published_at: T_CAFE });
    const res = await GET(req(), ctx('alias-richiesta'));
    const xml = await res.text();
    const locs = [...parseXml(xml).getElementsByTagName('loc')].map((n) => n.textContent);
    expect(locs).toEqual([`${BASE}/s/cafe`]); // covers: AC-411-2 — public_slug della riga, non 'alias-richiesta'
    expect(xml).not.toContain('/s/alias-richiesta'); // covers: AC-411-2
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-411-3 — robots.txt: Allow /s/, Disallow editor/preview, riga Sitemap:
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 robots.txt — allow /s/, disallow editor/preview, Sitemap: (AC-411-3)', () => {
  const rulesOf = (r: ReturnType<typeof robots>) => (Array.isArray(r.rules) ? r.rules : [r.rules!]);
  const asArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

  // covers: AC-411-3
  it('Allow su /s/ e NESSUN Disallow che copra /s/', () => {
    const r = robots();
    const rules = rulesOf(r);
    const allows = rules.flatMap((rule) => asArray(rule.allow));
    const disallows = rules.flatMap((rule) => asArray(rule.disallow));
    expect(allows).toContain('/s/'); // covers: AC-411-3
    // /s/ NON e' fra i Disallow (ne come voce esatta ne come prefisso del serving pubblico).
    expect(disallows).not.toContain('/s/'); // covers: AC-411-3
    expect(disallows.some((d) => d === '/s' || d.startsWith('/s/'))).toBe(false); // covers: AC-411-3
  });

  // covers: AC-411-3
  it('Disallow su editor e preview (locale-prefissati)', () => {
    const disallows = rulesOf(robots()).flatMap((rule) => asArray(rule.disallow));
    expect(disallows).toContain('/*/editor'); // covers: AC-411-3
    expect(disallows).toContain('/*/preview'); // covers: AC-411-3
  });

  // covers: AC-411-3
  it('contiene una riga Sitemap: (base di config)', () => {
    const r = robots();
    const sitemaps = asArray(r.sitemap as string | string[] | undefined);
    expect(sitemaps.length).toBeGreaterThan(0); // covers: AC-411-3
    expect(sitemaps).toContain(`${BASE}/sitemap.xml`); // covers: AC-411-3
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-411-4 — editor/preview: robots noindex nei metadati
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 editor/preview — robots noindex (AC-411-4)', () => {
  // covers: AC-411-4
  it('la rotta editor esporta metadata con robots noindex', () => {
    const robotsMeta = editorMetadata.robots as { index?: boolean; follow?: boolean } | null | undefined;
    expect(robotsMeta).toBeTruthy(); // covers: AC-411-4
    expect(robotsMeta!.index).toBe(false); // covers: AC-411-4 — noindex
  });

  // covers: AC-411-4
  it('la rotta preview esporta metadata con robots noindex', () => {
    const robotsMeta = previewMetadata.robots as { index?: boolean; follow?: boolean } | null | undefined;
    expect(robotsMeta).toBeTruthy(); // covers: AC-411-4
    expect(robotsMeta!.index).toBe(false); // covers: AC-411-4 — noindex
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC-411-5 — sconosciuto / non pubblicato -> notFound (anti-enumerazione)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 sitemap.xml — sconosciuto/non pubblicato -> notFound (AC-411-5)', () => {
  // covers: AC-411-5
  it('slug inesistente E slug non pubblicato (entrambi null via RLS anon): notFound, nessuna sitemap', async () => {
    for (const slug of ['slug-inesistente', 'cafe-2']) {
      notFoundSpy.mockClear();
      readSitemapSpy.mockClear();
      await expect(GET(req(), ctx(slug))).rejects.toBe(NOT_FOUND); // covers: AC-411-5
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-411-5
      expect(readSitemapSpy).toHaveBeenCalledWith(slug); // covers: AC-411-5
    }
  });

  // covers: AC-411-5
  it('snapshot pubblicato ma non validabile da parseDocument: notFound (gate, come la rotta pubblica)', async () => {
    sitemapHolder.rows.set('rotto', { document: { non: 'un documento valido' }, public_slug: 'rotto', published_at: T_CAFE });
    await expect(GET(req(), ctx('rotto'))).rejects.toBe(NOT_FOUND); // covers: AC-411-5
    expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-411-5
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DOMINIO PURO — buildSitemapXml/xmlEscape: i valori inseriti sono XML-escaped (security_note)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T-411 sitemap (dominio puro) — XML escaping dei valori inseriti', () => {
  // covers: AC-411-1
  it('xmlEscape neutralizza < > & \' "', () => {
    expect(xmlEscape(`a<b>c&d'e"f`)).toBe('a&lt;b&gt;c&amp;d&apos;e&quot;f'); // covers: AC-411-1
  });

  // covers: AC-411-1
  it('buildSitemapXml escapa i valori ostili (nessun carattere grezzo) e produce urlset ben formato che round-trippa', () => {
    const hostileLoc = `https://x/s/a&b<c>'d"e`;
    const xml = buildSitemapXml([{ loc: hostileLoc, lastmod: T_CAFE }]);
    // Tutte e cinque le entita' compaiono: i caratteri strutturali del valore sono stati escapati.
    expect(xml).toContain('&amp;'); // covers: AC-411-1
    expect(xml).toContain('&lt;'); // covers: AC-411-1
    expect(xml).toContain('&gt;'); // covers: AC-411-1
    expect(xml).toContain('&apos;'); // covers: AC-411-1
    expect(xml).toContain('&quot;'); // covers: AC-411-1
    // Nessuna sequenza strutturale GREZZA del valore sopravvive ('a&b' e 'b<c' sarebbero markup;
    // 'c>' non si controlla perche' collide col legittimo '</loc>').
    expect(xml).not.toContain('a&b'); // covers: AC-411-1
    expect(xml).not.toContain('b<c'); // covers: AC-411-1
    // Ben formato e round-trip: il parser XML ricostruisce il valore ORIGINALE identico (dato, mai
    // markup) — la prova definitiva che l'escape e' completo e corretto.
    const doc = parseXml(xml);
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0); // covers: AC-411-1
    expect(doc.documentElement.tagName).toBe('urlset'); // covers: AC-411-1
    expect(doc.getElementsByTagName('loc')[0].textContent).toBe(hostileLoc); // covers: AC-411-1
  });

  // covers: AC-411-1
  it('senza lastmod la <url> non porta <lastmod>', () => {
    const xml = buildSitemapXml([{ loc: `${BASE}/s/x` }]);
    expect(xml).not.toContain('<lastmod>'); // covers: AC-411-1
    expect(xml).toContain(`<loc>${BASE}/s/x</loc>`); // covers: AC-411-1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PROVA A RUNTIME (skipIf(!SB)) — il GRANT column-level di published_at ad anon e' REALE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Senza env il blocco si auto-salta pulito (l'orchestratore lo esegue davvero al checkpoint, a stato
// pulito con la migrazione applicata). L'oracolo qui e' il COMPORTAMENTO con un client ANON reale:
//  - anon LEGGE published_at di una riga pubblicata (il GRANT widening e' applicato, non assunto);
//  - account_id / source_generation_id restano NEGATI (42501) — il widening non ha aperto altro;
//  - ANTI-PLACEBO: la sorella non pubblicata ESISTE (oracolo service_role) ma anon non la vede.
const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

describe.skipIf(!SB)('T-411 GRANT published_at ad anon — provato a runtime (skipIf(!SB))', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const email = `t411_${randomUUID()}@example.test`;

  // Trappola-PREFISSO sull'ASSE selezionato (public_slug): la pubblicata e' PREFISSO PROPRIO della
  // non pubblicata — un lookup per prefisso le confonderebbe, il match esatto no.
  const slugPub = `shop-${suffisso}`; // pubblicata
  const slugHidden = `shop-${suffisso}-hidden`; // NON pubblicata, prefissata da slugPub

  let userId = '';
  let account = '';
  let idPub = '';
  let idHidden = '';
  let anon: SupabaseClient;

  const insertPublication = async (
    accountId: string,
    siteId: string,
    sourceGenerationId: string,
    publicSlug: string,
    locale: string,
    isPublished: boolean,
  ): Promise<string> => {
    const rows = await pgQuery<{ id: string }>(
      `insert into public.site_publications
         (account_id, site_id, source_generation_id, public_slug, locale, is_published, published_at, document)
       values ($1, $2, $3, $4, $5, $6, case when $6 then now() else null end, $7::jsonb)
       returning id`,
      [accountId, siteId, sourceGenerationId, publicSlug, locale, isPublished, JSON.stringify({ marker: publicSlug })],
    );
    return rows[0].id;
  };

  beforeAll(async () => {
    const u = await createTestUser(email, password);
    userId = u.id;

    const admin = adminClient();
    const { data: acc } = await admin.from('accounts').select('id').eq('owner_id', userId).maybeSingle();
    account = (acc as { id: string }).id;

    const siteRows = await pgQuery<{ id: string; slug: string }>(
      `insert into public.sites (account_id, name, slug)
       values ($1, 'pub', $2), ($1, 'hidden', $3)
       returning id, slug`,
      [account, `site-pub-${suffisso}`, `site-hidden-${suffisso}`],
    );
    const siteOf = (slug: string): string => siteRows.find((r) => r.slug === slug)!.id;
    const sitePub = siteOf(`site-pub-${suffisso}`);
    const siteHidden = siteOf(`site-hidden-${suffisso}`);

    const genRows = await pgQuery<{ id: string; site_id: string }>(
      `insert into public.site_generations (account_id, site_id, status, max_pages)
       values ($1, $2, 'chosen', 5), ($1, $3, 'chosen', 3)
       returning id, site_id`,
      [account, sitePub, siteHidden],
    );
    const genOf = (siteId: string): string => genRows.find((r) => r.site_id === siteId)!.id;

    idPub = await insertPublication(account, sitePub, genOf(sitePub), slugPub, 'it', true);
    idHidden = await insertPublication(account, siteHidden, genOf(siteHidden), slugHidden, 'es', false);
    expect(new Set([idPub, idHidden]).size).toBe(2);

    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }, 60_000);

  afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  // covers: AC-411-1
  it('anon LEGGE published_at di una riga pubblicata (grant widening applicato), match esatto sullo slug', async () => {
    const { data, error } = await anon
      .from('site_publications')
      .select('public_slug, published_at')
      .eq('public_slug', slugPub);
    expect(error).toBeNull(); // covers: AC-411-1 — published_at concesso ad anon (nessun 42501)
    const rows = data ?? [];
    expect(rows).toHaveLength(1); // covers: AC-411-1 — esattamente la riga pubblicata
    expect(rows[0].public_slug).toBe(slugPub); // covers: AC-411-1
    expect(typeof rows[0].published_at).toBe('string'); // covers: AC-411-1 — valore leggibile, non nascosto
    expect(rows[0].published_at).not.toBeNull(); // covers: AC-411-1
  });

  // covers: AC-411-5
  it('anon NON vede la sorella non pubblicata (prefisso), ma ESISTE davvero (anti-placebo)', async () => {
    const bySlug = await anon
      .from('site_publications')
      .select('public_slug, published_at')
      .eq('public_slug', slugHidden);
    expect(bySlug.error).toBeNull(); // covers: AC-411-5 — RLS, non un errore di privilegio
    expect(bySlug.data ?? []).toHaveLength(0); // covers: AC-411-5

    const { data: real } = await adminClient()
      .from('site_publications')
      .select('id, is_published')
      .eq('id', idHidden)
      .maybeSingle();
    expect((real as { id: string }).id).toBe(idHidden); // covers: AC-411-5 — la riga esiste
    expect((real as { is_published: boolean }).is_published).toBe(false); // covers: AC-411-5
  });

  // covers: AC-411-1
  it('il widening NON ha aperto le colonne private: account_id / source_generation_id restano NEGATI (42501)', async () => {
    const acc = await anon.from('site_publications').select('account_id');
    expect(acc.error?.code).toBe('42501'); // covers: AC-411-1
    expect(acc.data).toBeNull(); // covers: AC-411-1
    const gen = await anon.from('site_publications').select('source_generation_id');
    expect(gen.error?.code).toBe('42501'); // covers: AC-411-1
    expect(gen.data).toBeNull(); // covers: AC-411-1
  });
});
