// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  buildLocalBusinessJsonLd,
  serializeJsonLdSafe,
  type LocalBusinessJsonLd,
} from '@/domain/generation/jsonld';
import type { BusinessInfo } from '@/domain/generation/site-seo';
import { extractBusinessInfo } from '@/domain/generation/site-seo';
import { assetPublicUrl, SITE_ASSETS_BUCKET } from '@/config/storage';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';

// T-410 (macrotask seo-base, P4) — ORACOLO del JSON-LD LocalBusiness e della sua SERIALIZZAZIONE
// SICURA. Le asserzioni DERIVANO da AC-410-1..5 (blueprint P4-M3), taggate `// covers: AC-410-<n>`
// sulla riga dell'EXPECT.
//
// FALSIFICABILITA' (prova sull'effetto): il cuore del task e' che l'output escaped NON contenga la
// sequenza grezza di chiusura `<script>`. Una variante NON escaping la lascerebbe passare e questi
// oracoli andrebbero ROSSI — sia sulla stringa del dominio (Gruppo A) sia sul testo iniettato nella
// pagina (Gruppo B, jsdom). Nessun mock nel Gruppo A: si esercita il codice reale con fixture ostili.
//
// I due separatori di riga si scrivono via String.fromCharCode: nessun code point grezzo nel sorgente
// del test, come nel modulo sotto esame.
const U2028 = String.fromCharCode(0x2028);
const U2029 = String.fromCharCode(0x2029);
// La sequenza di chiusura tag, spezzata in due letterali cosi' che NON compaia mai grezza nemmeno
// nel sorgente del test (che altrimenti la conterrebbe come stringa cercata).
const CLOSE_SCRIPT = '</' + 'script>';

// ── fixture ostili (Gruppo A) ────────────────────────────────────────────────────
// Nome che tenta il BREAKOUT: chiude il tag e ne apre uno eseguibile.
const BREAKOUT_NAME = CLOSE_SCRIPT + '<script>alert(1)</script>';
// Indirizzo con `&` e markup HTML-like: deve restare DATO, mai markup.
const AMP_ADDRESS = '<b>&amp;</b>';
// Un campo coi due separatori di riga (spezzano il contesto JS se non escaped).
const LS_ADDRESS = 'Via Roma 1' + U2028 + 'int. 2' + U2029 + 'Milano';

// ── trappola del PREFISSO su asset_id (Gruppo A, AC-410-5) ───────────────────────
// HERO e SIBLING condividono 35 caratteri e differiscono SOLO nell'ultima cifra: chi selezionasse
// per prefisso invece che per identita' esatta li confonderebbe.
const HERO_ASSET = '11111111-1111-4111-8111-111111111111';
const SIBLING_ASSET = '11111111-1111-4111-8111-111111111112';
const OTHER_PAGE_ASSET = '22222222-2222-4222-8222-222222222222';
const PLACEHOLDER_TOKEN = 'hero-bg';
const SUPA = 'https://xyzcompany.supabase.co';
const THEME_ID = THEMES[0].id;

function block(
  id: string,
  data: SiteBlock['data'],
  images: SiteBlock['images'],
): SiteBlock {
  return { id, content: {}, data, brief_fields_rendered: [], images };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRUPPO A — dominio PURO: buildLocalBusinessJsonLd + serializeJsonLdSafe
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-410 serializeJsonLdSafe — anti-breakout dal <script> (AC-410-1)', () => {
  // covers: AC-410-1
  it('un nome che tenta di chiudere il <script> esce con < e > escaped: la chiusura del tag e irrappresentabile', () => {
    const info: BusinessInfo = { name: BREAKOUT_NAME };
    const serialized = serializeJsonLdSafe(buildLocalBusinessJsonLd(info));

    // La sequenza grezza di chiusura del tag NON compare: e' proprio cio' che una variante non
    // escaping lascerebbe passare (oracolo falsificabile).
    expect(serialized.includes(CLOSE_SCRIPT)).toBe(false); // covers: AC-410-1
    // < e > sono diventati i loro escape unicode.
    expect(serialized).toContain('\\u003c'); // covers: AC-410-1
    expect(serialized).toContain('\\u003e'); // covers: AC-410-1
    // Nessun < o > grezzo sopravvive nella stringa.
    expect(serialized.includes('<')).toBe(false); // covers: AC-410-1
    expect(serialized.includes('>')).toBe(false); // covers: AC-410-1
    // Il payload resta DATO: round-trip al nome esatto (escaping trasparente).
    expect(JSON.parse(serialized).name).toBe(BREAKOUT_NAME); // covers: AC-410-1
  });
});

describe('T-410 serializeJsonLdSafe — separatori di riga U+2028/U+2029 (AC-410-2)', () => {
  // covers: AC-410-2
  it('i separatori di riga in un campo appaiono ESCAPED, mai grezzi (non spezzano il contesto JS)', () => {
    const info: BusinessInfo = { address: LS_ADDRESS };
    const serialized = serializeJsonLdSafe(buildLocalBusinessJsonLd(info));

    // Escaped come U+2028 / U+2029.
    expect(serialized).toContain('\\u2028'); // covers: AC-410-2
    expect(serialized).toContain('\\u2029'); // covers: AC-410-2
    // I code point grezzi NON compaiono (JSON.stringify da solo NON li escaperebbe).
    expect(serialized.includes(U2028)).toBe(false); // covers: AC-410-2
    expect(serialized.includes(U2029)).toBe(false); // covers: AC-410-2
    // Round-trip trasparente all'indirizzo esatto, separatori inclusi.
    expect(JSON.parse(serialized).address).toBe(LS_ADDRESS); // covers: AC-410-2
  });
});

describe('T-410 serializeJsonLdSafe — & e testo HTML-like restano DATO (AC-410-3)', () => {
  // covers: AC-410-3
  it('& e escaped e il markup appare SOLO come dato nel JSON, mai come markup', () => {
    const info: BusinessInfo = { address: AMP_ADDRESS };
    const serialized = serializeJsonLdSafe(buildLocalBusinessJsonLd(info));

    // & e' diventato &; nessun & grezzo sopravvive.
    expect(serialized).toContain('\\u0026'); // covers: AC-410-3
    expect(serialized.includes('&')).toBe(false); // covers: AC-410-3
    // Il markup <b>...</b> non compare grezzo: < e > sono escaped.
    expect(serialized.includes('<b>')).toBe(false); // covers: AC-410-3
    expect(serialized.includes(CLOSE_SCRIPT)).toBe(false); // covers: AC-410-3
    // Appare SOLO come dato: round-trip alla stringa esatta.
    expect(JSON.parse(serialized).address).toBe(AMP_ADDRESS); // covers: AC-410-3
  });
});

describe('T-410 buildLocalBusinessJsonLd — LocalBusiness completo e round-trip trasparente (AC-410-4)', () => {
  // covers: AC-410-4
  it('un brief valido con name/address/geo/telephone/openingHours: JSON.parse ricostruisce i campi esatti', () => {
    const info: BusinessInfo = {
      name: 'Trattoria da Nonna Rosa',
      address: 'Via del Corso 12, Roma',
      geo: { lat: 41.9028, lng: 12.4964 },
      phone: '+39 06 1234567',
      // >1 voce, valori DISCORDANTI.
      hours: { lunedi: '9:00-18:00', sabato: '9:00-13:00' },
    };
    const built = buildLocalBusinessJsonLd(info);
    const serialized = serializeJsonLdSafe(built);
    const parsed = JSON.parse(serialized) as LocalBusinessJsonLd;

    // Escaping trasparente: il round-trip riproduce l'OGGETTO COSTRUITO identico.
    expect(parsed).toEqual(built); // covers: AC-410-4
    // I campi mappati, uno a uno.
    expect(parsed['@context']).toBe('https://schema.org'); // covers: AC-410-4
    expect(parsed['@type']).toBe('LocalBusiness'); // covers: AC-410-4
    expect(parsed.name).toBe('Trattoria da Nonna Rosa'); // covers: AC-410-4
    expect(parsed.address).toBe('Via del Corso 12, Roma'); // covers: AC-410-4
    expect(parsed.geo).toEqual({ '@type': 'GeoCoordinates', latitude: 41.9028, longitude: 12.4964 }); // covers: AC-410-4
    expect(parsed.telephone).toBe('+39 06 1234567'); // covers: AC-410-4
    expect(parsed.openingHours).toEqual(['lunedi 9:00-18:00', 'sabato 9:00-13:00']); // covers: AC-410-4
  });

  // covers: AC-410-4
  it('emette SOLO i campi presenti: un brief con il solo nome non produce chiavi undefined', () => {
    const built = buildLocalBusinessJsonLd({ name: 'Solo Nome' });
    // Nessuna chiave oltre @context/@type/name.
    expect(Object.keys(built).sort()).toEqual(['@context', '@type', 'name']); // covers: AC-410-4
    // Nessun valore undefined nella serializzazione.
    expect(serializeJsonLdSafe(built).includes('undefined')).toBe(false); // covers: AC-410-4
  });
});

describe('T-410 image dallo hero UPLOADED, mai da testo libero (AC-410-5)', () => {
  // Documento con DUE pagine, valori DISCORDANTI, piu' asset uploaded e la trappola del prefisso.
  // La home porta il nome REALE e l'hero uploaded (preceduto da un placeholder del tema, da SALTARE)
  // e un secondo uploaded col prefisso condiviso; una seconda pagina porta un altro uploaded che non
  // deve mai vincere sulla home.
  const DOC_WITH_HERO: SiteDocument = {
    recipe_id: 'vetrina-dell-offerta@1',
    theme_id: THEME_ID,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Benvenuti',
        meta_description: 'La home',
        blocks: [
          block('hero', { business_name: 'Da Rosa' }, [
            { source: 'theme-placeholder', token: PLACEHOLDER_TOKEN },
            { source: 'uploaded', asset_id: HERO_ASSET },
          ]),
          block('gallery', {}, [{ source: 'uploaded', asset_id: SIBLING_ASSET }]),
        ],
      },
      {
        slug: 'offerte',
        role: 'offerings',
        title: 'Le offerte',
        meta_description: 'Cosa offriamo',
        blocks: [block('offers', {}, [{ source: 'uploaded', asset_id: OTHER_PAGE_ASSET }])],
      },
    ],
  };

  // Documento SENZA hero uploaded: solo un placeholder del tema.
  const DOC_NO_HERO: SiteDocument = {
    recipe_id: 'vetrina-dell-offerta@1',
    theme_id: THEME_ID,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Benvenuti',
        meta_description: 'La home',
        blocks: [
          block('hero', { business_name: 'Senza Foto' }, [
            { source: 'theme-placeholder', token: PLACEHOLDER_TOKEN },
          ]),
        ],
      },
    ],
  };

  // covers: AC-410-5
  it('con hero uploaded fra piu asset e una trappola di prefisso: image e l URL Storage dell asset dell hero', () => {
    // Sanity: fixture VALIDA (percorso reale del gate).
    expect(parseDocument(DOC_WITH_HERO).ok).toBe(true);

    const info = extractBusinessInfo(DOC_WITH_HERO);
    // L'app layer costruisce l'URL dall'asset_id (reuse assetPublicUrl con source esplicito).
    const image = info.heroAssetId !== undefined ? assetPublicUrl(info.heroAssetId, { NEXT_PUBLIC_SUPABASE_URL: SUPA }) : undefined;
    const built = buildLocalBusinessJsonLd(info, { image });

    const expectedUrl = `${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${HERO_ASSET}`;
    expect(built.image).toBe(expectedUrl); // covers: AC-410-5
    // Sotto il NOSTRO host Storage (costruito, non testo libero).
    expect(built.image?.startsWith(`${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/`)).toBe(true); // covers: AC-410-5
    // L'asset ESATTO dell'hero, non il fratello col prefisso condiviso ne l'asset dell'altra pagina.
    const json = serializeJsonLdSafe(built);
    expect(json).toContain(HERO_ASSET); // covers: AC-410-5
    expect(json.includes(SIBLING_ASSET)).toBe(false); // covers: AC-410-5
    expect(json.includes(OTHER_PAGE_ASSET)).toBe(false); // covers: AC-410-5
  });

  // covers: AC-410-5
  it('senza hero uploaded (solo placeholder del tema): image ASSENTE, nessun token emesso come URL', () => {
    expect(parseDocument(DOC_NO_HERO).ok).toBe(true);

    const info = extractBusinessInfo(DOC_NO_HERO);
    const image = info.heroAssetId !== undefined ? assetPublicUrl(info.heroAssetId, { NEXT_PUBLIC_SUPABASE_URL: SUPA }) : undefined;
    const built = buildLocalBusinessJsonLd(info, { image });

    // Nessuna chiave `image`.
    expect('image' in built).toBe(false); // covers: AC-410-5
    const json = serializeJsonLdSafe(built);
    // Ne il token del tema ne l'host Storage compaiono da nessuna parte.
    expect(json.includes(PLACEHOLDER_TOKEN)).toBe(false); // covers: AC-410-5
    expect(json.includes('/storage/v1/object/public/')).toBe(false); // covers: AC-410-5
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GRUPPO B — effetto sulla PAGINA: lo <script> ld+json riceve la stringa escaped
// ═══════════════════════════════════════════════════════════════════════════════

const { NOT_FOUND, notFoundSpy } = vi.hoisted(() => {
  const sentinel = Symbol('not-found');
  return { NOT_FOUND: sentinel, notFoundSpy: vi.fn(() => { throw sentinel; }) };
});
vi.mock('next/navigation', () => ({ notFound: notFoundSpy }));

const { readHolder, readPublishedSiteSpy } = vi.hoisted(() => {
  const holder = { value: null as null | { document: unknown; public_slug: string; locale: string } };
  return { readHolder: holder, readPublishedSiteSpy: vi.fn(async () => holder.value) };
});
vi.mock('@/data/public-site', () => ({ readPublishedSite: readPublishedSiteSpy }));

// I blocchi e il badge risolvono le etichette via getTranslations: si risolve alla chiave (come in
// generation-preview). Il blocco della fixture e' comunque un id NON registrato -> renderBlock null.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

// Import DOPO i mock.
import PublicSitePage from '@/app/s/[slug]/page';

// Blocco con id NON registrato (renderBlock -> null): la pagina rende senza dipendere dai componenti
// dei blocchi, ma extractBusinessInfo legge comunque `data` e `images` per il JSON-LD.
const HOSTILE_DOC: SiteDocument = {
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
          'infoblock',
          {
            business_name: BREAKOUT_NAME,
            address: AMP_ADDRESS,
            geo: { lat: 41.9028, lng: 12.4964 },
            phone: '+39 06 1234567',
            hours: { lunedi: '9:00-18:00', sabato: '9:00-13:00' },
          },
          [{ source: 'uploaded', asset_id: HERO_ASSET }],
        ),
      ],
    },
  ],
};

const originalSupa = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  readHolder.value = null;
  readPublishedSiteSpy.mockClear();
  notFoundSpy.mockClear();
});

afterEach(() => {
  cleanup();
  if (originalSupa === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupa;
});

describe('T-410 iniezione nella pagina — <script> ld+json con testo escaped, nessun markup attivo (AC-410-1, AC-410-3)', () => {
  // covers: AC-410-1
  it('rende UN <script type=application/ld+json> il cui testo e la stringa escaped, non JSON grezzo', async () => {
    // Sanity: la fixture ostile e' un documento VALIDO (gate reale della pagina).
    expect(parseDocument(HOSTILE_DOC).ok).toBe(true);

    readHolder.value = { document: HOSTILE_DOC, public_slug: 'da-rosa', locale: 'it' };
    const ui = await PublicSitePage({ params: Promise.resolve({ slug: 'da-rosa' }) });
    render(ui);

    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    // Esattamente uno.
    expect(scripts).toHaveLength(1); // covers: AC-410-1
    const el = scripts[0] as HTMLScriptElement;
    const text = el.textContent ?? '';

    // Il testo iniettato NON contiene la sequenza grezza di chiusura del tag: una variante non
    // escaping la scriverebbe (oracolo falsificabile a livello di pagina).
    expect(text.includes(CLOSE_SCRIPT)).toBe(false); // covers: AC-410-1
    expect(text).toContain('\\u003c'); // covers: AC-410-1
    // Nessun MARKUP ATTIVO: nessun altro <script> e' comparso, e il nodo ld+json e' solo testo.
    expect(document.querySelectorAll('script')).toHaveLength(1); // covers: AC-410-1
    expect(el.children).toHaveLength(0); // covers: AC-410-1
    // Il payload resta DATO: round-trip al nome ostile esatto, @type LocalBusiness.
    const parsed = JSON.parse(text) as LocalBusinessJsonLd;
    expect(parsed['@type']).toBe('LocalBusiness'); // covers: AC-410-1
    expect(parsed.name).toBe(BREAKOUT_NAME); // covers: AC-410-1
  });

  // covers: AC-410-3
  it('l indirizzo con & e markup HTML-like resta DATO nel JSON iniettato, mai markup', async () => {
    readHolder.value = { document: HOSTILE_DOC, public_slug: 'da-rosa', locale: 'it' };
    const ui = await PublicSitePage({ params: Promise.resolve({ slug: 'da-rosa' }) });
    render(ui);

    const el = document.querySelector('script[type="application/ld+json"]') as HTMLScriptElement;
    const text = el.textContent ?? '';
    // & escaped, nessun <b> grezzo nel testo.
    expect(text).toContain('\\u0026'); // covers: AC-410-3
    expect(text.includes('<b>')).toBe(false); // covers: AC-410-3
    // Solo come dato: round-trip esatto.
    expect((JSON.parse(text) as LocalBusinessJsonLd).address).toBe(AMP_ADDRESS); // covers: AC-410-3
    // image dallo hero uploaded, host Storage nostro.
    expect((JSON.parse(text) as LocalBusinessJsonLd).image).toBe(
      `${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${HERO_ASSET}`,
    ); // covers: AC-410-3
  });

  // covers: AC-410-1
  it('slug null (inesistente/non pubblicato): notFound, nessuno <script> ld+json reso', async () => {
    readHolder.value = null;
    await expect(PublicSitePage({ params: Promise.resolve({ slug: 'ignoto' }) })).rejects.toBe(NOT_FOUND); // covers: AC-410-1
    expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-410-1
  });
});
