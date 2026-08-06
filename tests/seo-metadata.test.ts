// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SEO_LIMITS } from '@/domain/generation/site-seo';
import { SITE_ASSETS_BUCKET } from '@/config/storage';

// T-409 (macrotask seo-base, P4) — ORACOLO di generateMetadata della rotta pubblica /s/<slug>.
// Le asserzioni DERIVANO da AC-409-1..6 (blueprint P4-M3), taggate `// covers: AC-409-<n>` sulla
// riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: notFound() con throw-sentinel, come in produzione (in Next lancia e interrompe).
//  - @/data/public-site readPublishedSite: il SEAM DATI anon+RLS. Modella la RLS anon-published: uno
//    slug inesistente O non pubblicato filtra a `null` (indistinguibili, P1-D21). E' il SOLO mock:
//    parseDocument, extractBusinessInfo, seoTitle/seoDescription, assetPublicUrl e getSiteBaseUrl
//    restano REALI — i metadati sono derivati dal documento vero, non finti.
//
// PROPRIETA' PINNATE oltre agli AC:
//  - canonical/og:url usano il public_slug DELLA RIGA, non lo slug della richiesta (il mock ritorna un
//    public_slug DIVERSO dallo slug richiesto: si osserva quale dei due finisce nell'URL).
//  - og:image = assetPublicUrl(hero asset_id) SOLO per un ImageSlot uploaded; trappola del PREFISSO
//    su asset_id (un id che condivide un prefisso di 35 char con l'hero): l'id emesso e' quello esatto.

const { NOT_FOUND, notFoundSpy } = vi.hoisted(() => {
  const notFoundSentinel = Symbol('not-found');
  return {
    NOT_FOUND: notFoundSentinel,
    notFoundSpy: vi.fn(() => {
      throw notFoundSentinel;
    }),
  };
});
vi.mock('next/navigation', () => ({ notFound: notFoundSpy }));

const { readHolder, readPublishedSiteSpy } = vi.hoisted(() => {
  const holder = {
    value: null as null | { document: unknown; public_slug: string; locale: string },
  };
  return { readHolder: holder, readPublishedSiteSpy: vi.fn(async () => holder.value) };
});
vi.mock('@/data/public-site', () => ({ readPublishedSite: readPublishedSiteSpy }));

// Import DOPO i mock.
import { generateMetadata } from '@/app/s/[slug]/page';

// ── costanti d'ambiente ────────────────────────────────────────────────────────
const BASE = 'https://belora.example';
const SUPA = 'https://xyzcompany.supabase.co';
const THEME_ID = THEMES[0].id;

// ── dati di dominio ────────────────────────────────────────────────────────────
const BUSINESS_NAME = 'Trattoria da Nonna Rosa';
const TAGLINE = 'Cucina casalinga romana dal 1962 nel cuore di Trastevere, ricette di famiglia.';

// Trappola del PREFISSO su asset_id: HERO e SIBLING condividono un prefisso di 35 caratteri e
// differiscono SOLO nell'ultima cifra. Un uuid ha lunghezza FISSA (36), quindi un vero "prefisso
// proprio" e' irrappresentabile fra due uuid validi (entrambi devono passare parseDocument, che
// pretende z.string().uuid()); questa e' la stressatura piu' vicina — chi selezionasse per prefisso
// invece che per identita' esatta le confonderebbe.
const HERO_ASSET = '11111111-1111-4111-8111-111111111111';
const SIBLING_ASSET = '11111111-1111-4111-8111-111111111112';
const OTHER_PAGE_ASSET = '22222222-2222-4222-8222-222222222222';
const HERO_PLACEHOLDER_TOKEN = 'hero-bg';
const NOUP_PLACEHOLDER_TOKEN = 'placeholder-solo';

// ── builder di fixture (LOCALI al file) ─────────────────────────────────────────
function block(
  id: string,
  data: SiteBlock['data'],
  images: SiteBlock['images'],
  brief_fields_rendered: SiteBlock['brief_fields_rendered'] = [],
): SiteBlock {
  return { id, content: {}, data, brief_fields_rendered, images };
}

function homeOnlyDoc(
  data: SiteBlock['data'],
  images: SiteBlock['images'],
  brief_fields_rendered: SiteBlock['brief_fields_rendered'] = [],
): SiteDocument {
  return {
    recipe_id: 'vetrina-dell-offerta@1',
    theme_id: THEME_ID,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Home',
        meta_description: 'Home page',
        blocks: [block('hero', data, images, brief_fields_rendered)],
      },
    ],
  };
}

// DOCUMENTO principale: due pagine con valori DISCORDANTI. La home porta il nome/tagline REALI e
// l'hero uploaded (preceduto da un placeholder del tema, che va SALTATO); una seconda pagina porta
// nome/tagline SBAGLIATI e un altro asset uploaded — non devono mai vincere sulla home.
const PUBLISHED_DOC: SiteDocument = {
  recipe_id: 'vetrina-dell-offerta@1',
  theme_id: THEME_ID,
  pages: [
    {
      slug: 'home',
      role: 'home',
      title: 'Benvenuti',
      meta_description: 'La home',
      blocks: [
        block(
          'hero',
          { business_name: BUSINESS_NAME, description: TAGLINE },
          [
            { source: 'theme-placeholder', token: HERO_PLACEHOLDER_TOKEN },
            { source: 'uploaded', asset_id: HERO_ASSET },
          ],
          ['business_name', 'description'],
        ),
        // Un secondo blocco della home con un uploaded il cui id condivide 35 char con l'hero.
        block('gallery', {}, [{ source: 'uploaded', asset_id: SIBLING_ASSET }]),
      ],
    },
    {
      slug: 'offerte',
      role: 'offerings',
      title: 'Le offerte',
      meta_description: 'Cosa offriamo',
      blocks: [
        block(
          'offers',
          { business_name: 'NON DEVE VINCERE', description: 'tagline sbagliata' },
          [{ source: 'uploaded', asset_id: OTHER_PAGE_ASSET }],
          ['business_name', 'description'],
        ),
      ],
    },
  ],
};

// Percorsi sorgente per gli scan strutturali (lang/og:locale dalla RIGA, URL costruiti da noi).
// Costruiti da process.cwd() (radice del repo) e non da import.meta.url: i segmenti fra parentesi
// quadre del percorso ([slug]) romperebbero il parsing di new URL().
const PAGE_PATH = resolve(process.cwd(), 'src/app/s/[slug]/page.tsx');
const LAYOUT_PATH = resolve(process.cwd(), 'src/app/s/[slug]/layout.tsx');

const meta = (slug: string) => generateMetadata({ params: Promise.resolve({ slug }) });

const originalEnv = {
  site: process.env.NEXT_PUBLIC_SITE_URL,
  supa: process.env.NEXT_PUBLIC_SUPABASE_URL,
  brand: process.env.NEXT_PUBLIC_BRAND_NAME,
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = BASE;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  delete process.env.NEXT_PUBLIC_BRAND_NAME; // il brand di default (Belora) non entra nel titolo
  readHolder.value = null;
  readPublishedSiteSpy.mockClear();
  notFoundSpy.mockClear();
});

afterEach(() => {
  const restore = (k: 'NEXT_PUBLIC_SITE_URL' | 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_BRAND_NAME', v?: string) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  restore('NEXT_PUBLIC_SITE_URL', originalEnv.site);
  restore('NEXT_PUBLIC_SUPABASE_URL', originalEnv.supa);
  restore('NEXT_PUBLIC_BRAND_NAME', originalEnv.brand);
});

describe('T-409 generateMetadata — titolo e descrizione dal brief pubblicato (AC-409-1)', () => {
  // covers: AC-409-1
  it('titolo contiene il nome, descrizione contiene la tagline, entrambi entro i tetti configurati', async () => {
    readHolder.value = { document: PUBLISHED_DOC, public_slug: 'trattoria-da-nonna-rosa', locale: 'it' };
    const m = await meta('trattoria-da-nonna-rosa');

    expect(typeof m.title).toBe('string'); // covers: AC-409-1
    expect(m.title as string).toContain(BUSINESS_NAME); // covers: AC-409-1
    expect((m.title as string).length).toBeLessThanOrEqual(SEO_LIMITS.title); // covers: AC-409-1
    expect(m.description).toContain(TAGLINE); // covers: AC-409-1
    expect((m.description as string).length).toBeLessThanOrEqual(SEO_LIMITS.description); // covers: AC-409-1
    // og:title / og:description rispecchiano titolo e descrizione.
    expect(m.openGraph?.title).toContain(BUSINESS_NAME); // covers: AC-409-1
    expect(m.openGraph?.description).toContain(TAGLINE); // covers: AC-409-1
  });

  // covers: AC-409-1
  it('un nome e una tagline oltre i tetti sono TRONCATI al tetto e restano un prefisso dell originale', async () => {
    const LONG_NAME = 'Z'.repeat(200); // = BRIEF_LIMITS.business_name, valido nel documento
    const LONG_TAGLINE = 'y'.repeat(2000); // = BRIEF_LIMITS.description
    const doc = homeOnlyDoc({ business_name: LONG_NAME, description: LONG_TAGLINE }, []);
    // Sanity: la fixture e' un documento VALIDO (parseDocument, reale nel percorso).
    expect(parseDocument(doc).ok).toBe(true);

    readHolder.value = { document: doc, public_slug: 'lungo', locale: 'it' };
    const m = await meta('lungo');

    expect((m.title as string).length).toBe(SEO_LIMITS.title); // troncato esatto al tetto // covers: AC-409-1
    expect(LONG_NAME.startsWith(m.title as string)).toBe(true); // covers: AC-409-1
    expect((m.description as string).length).toBe(SEO_LIMITS.description); // covers: AC-409-1
    expect(LONG_TAGLINE.startsWith(m.description as string)).toBe(true); // covers: AC-409-1
  });
});

describe('T-409 generateMetadata — canonical/og:url assoluti dalla RIGA (AC-409-2)', () => {
  // covers: AC-409-2
  it('og:url e canonical sono byte-uguali a <base>/s/<public_slug della RIGA>, og:type=website', async () => {
    // Il public_slug della RIGA e' 'offerte'; lo slug della RICHIESTA e' DIVERSO: si osserva quale
    // dei due finisce nell'URL. Deve vincere quello della riga.
    readHolder.value = { document: PUBLISHED_DOC, public_slug: 'offerte', locale: 'it' };
    const m = await meta('slug-della-richiesta-diverso');

    const expectedUrl = `${BASE}/s/offerte`;
    expect(m.alternates?.canonical).toBe(expectedUrl); // covers: AC-409-2
    expect(m.openGraph?.url).toBe(expectedUrl); // covers: AC-409-2
    // `type`/`card` vivono su membri specifici delle unioni OpenGraph/Twitter: si legge dal ramo giusto.
    expect((m.openGraph as { type?: string } | undefined)?.type).toBe('website'); // covers: AC-409-2
    // Trappola del PREFISSO su public_slug: 'offerte' non e' 'offerte-speciali'.
    expect(m.alternates?.canonical).not.toBe(`${BASE}/s/offerte-speciali`); // covers: AC-409-2
    // twitter card summary_large_image.
    expect((m.twitter as { card?: string } | undefined)?.card).toBe('summary_large_image'); // covers: AC-409-2
  });
});

describe('T-409 generateMetadata — og:image dall hero UPLOADED (AC-409-3, AC-409-4)', () => {
  // covers: AC-409-3
  it('con hero uploaded fra piu asset e una trappola di prefisso: og:image e l asset dell hero, sotto il nostro host Storage', async () => {
    readHolder.value = { document: PUBLISHED_DOC, public_slug: 'trattoria-da-nonna-rosa', locale: 'it' };
    const m = await meta('trattoria-da-nonna-rosa');

    const expectedImage = `${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${HERO_ASSET}`;
    expect(m.openGraph?.images).toEqual([expectedImage]); // covers: AC-409-3
    const imagesJson = JSON.stringify(m.openGraph?.images);
    // L'hero e' l'asset ESATTO (home prima, primo uploaded saltando il placeholder), non il fratello
    // col prefisso condiviso ne l'asset dell'altra pagina.
    expect(imagesJson).toContain(HERO_ASSET); // covers: AC-409-3
    expect(imagesJson).not.toContain(SIBLING_ASSET); // covers: AC-409-3
    expect(imagesJson).not.toContain(OTHER_PAGE_ASSET); // covers: AC-409-3
    // Sotto il NOSTRO host Storage (costruito da assetPublicUrl, non da testo libero).
    expect(expectedImage.startsWith(`${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/`)).toBe(true); // covers: AC-409-3
    expect(m.openGraph?.images).toEqual([`${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${HERO_ASSET}`]); // covers: AC-409-3
  });

  // covers: AC-409-4
  it('senza hero uploaded (solo placeholder del tema): og:image ASSENTE, nessun token emesso come URL', async () => {
    const doc = homeOnlyDoc(
      { business_name: BUSINESS_NAME, description: TAGLINE },
      [{ source: 'theme-placeholder', token: NOUP_PLACEHOLDER_TOKEN }],
      ['business_name', 'description'],
    );
    expect(parseDocument(doc).ok).toBe(true);

    readHolder.value = { document: doc, public_slug: 'senza-foto', locale: 'it' };
    const m = await meta('senza-foto');

    expect(m.openGraph?.images).toBeUndefined(); // covers: AC-409-4
    // Ne il token del tema ne altro testo libero compaiono da nessuna parte nei metadati.
    expect(JSON.stringify(m)).not.toContain(NOUP_PLACEHOLDER_TOKEN); // covers: AC-409-4
  });

  // covers: AC-409-3
  it('scan strutturale: l URL immagine e costruito da assetPublicUrl(asset_id), mai da testo libero', () => {
    const pageSrc = readFileSync(PAGE_PATH, 'utf8');
    expect(pageSrc).toContain('assetPublicUrl('); // covers: AC-409-3
    expect(pageSrc).toContain('heroAssetId'); // og:image solo per hero uploaded // covers: AC-409-3
  });
});

describe('T-409 generateMetadata — og:locale e <html lang> dalla RIGA, non dalla richiesta (AC-409-5)', () => {
  // covers: AC-409-5
  it('sito con locale es: og:locale=es a prescindere dal locale ambientale della richiesta', async () => {
    const doc = homeOnlyDoc(
      { business_name: 'Panaderia Sol', description: 'Pan artesano cada manana.' },
      [],
      ['business_name', 'description'],
    );
    // generateMetadata non riceve alcun locale di richiesta (params ha il solo slug): il locale dei
    // metadati puo' venire SOLO dalla riga.
    readHolder.value = { document: doc, public_slug: 'panaderia-sol', locale: 'es' };
    const m = await meta('panaderia-sol');

    expect(m.openGraph?.locale).toBe('es'); // covers: AC-409-5
  });

  // covers: AC-409-5
  it('scan strutturale: og:locale deriva da site.locale e <html lang> dal locale della riga', () => {
    const pageSrc = readFileSync(PAGE_PATH, 'utf8');
    // og:locale e' il locale della RIGA (site.locale), mai un locale negoziato col browser.
    expect(pageSrc).toContain('locale: site.locale'); // covers: AC-409-5
    const layoutSrc = readFileSync(LAYOUT_PATH, 'utf8');
    // <html lang> deriva dal locale della riga (readPublishedSite), gia' impostato dal layout.
    expect(layoutSrc).toContain('site?.locale'); // covers: AC-409-5
    expect(layoutSrc).toContain('lang={lang}'); // covers: AC-409-5
  });
});

describe('T-409 generateMetadata — slug sconosciuto/non pubblicato -> notFound (AC-409-6)', () => {
  // covers: AC-409-6
  it('slug inesistente E slug non pubblicato (entrambi null via RLS anon): notFound, nessun metadato', async () => {
    for (const slug of ['slug-inesistente', 'slug-non-pubblicato']) {
      notFoundSpy.mockClear();
      readPublishedSiteSpy.mockClear();
      readHolder.value = null; // RLS anon: inesistente e non pubblicato sono indistinguibili
      await expect(meta(slug)).rejects.toBe(NOT_FOUND); // covers: AC-409-6
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-409-6
      expect(readPublishedSiteSpy).toHaveBeenCalledWith(slug); // covers: AC-409-6
    }
  });

  // covers: AC-409-6
  it('snapshot pubblicato ma non validabile da parseDocument: notFound (nessun metadato non gated)', async () => {
    readHolder.value = { document: { non: 'un documento valido' }, public_slug: 'rotto', locale: 'it' };
    await expect(meta('rotto')).rejects.toBe(NOT_FOUND); // covers: AC-409-6
    expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-409-6
  });
});
