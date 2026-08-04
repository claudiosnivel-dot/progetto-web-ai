// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-231 (macrotask generation-ui, P2) — blocchi NARRATIVI: AC-231-1 (il testo non fidato e'
// reso come TESTO, nessun elemento nasce dal payload) e AC-231-5 (un blocco rende SOLO i suoi
// `brief_fields_rendered`). E' il primo punto in cui il testo non fidato del brief diventa
// pagina, quindi le asserzioni guardano l'ALBERO reso, non la sola stringa.
//
// Le etichette sono lette dal catalogo REALE via il mock di next-intl/server (stessa tecnica
// di tests/dashboard-onboarding-cta.test.ts). I blocchi sono Server Component asincroni,
// invocati come funzione e il risultato passato a `render`.

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = (cat[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

import { Hero } from '@/ui/site/blocks/Hero';
import { ChiSiamo } from '@/ui/site/blocks/ChiSiamo';
import { Faq } from '@/ui/site/blocks/Faq';
import { CtaWhatsapp } from '@/ui/site/blocks/CtaWhatsapp';
import { SitePageView, SiteView } from '@/ui/site/SiteView';
import { renderBlock, SITE_BLOCK_COMPONENTS } from '@/ui/site/registry';
import { THEMES } from '@/domain/generation/themes';
import type { SiteBlock, SiteDocument, SitePage } from '@/domain/generation/document';

const THEME = THEMES[0];

afterEach(() => cleanup());

// ── payload ostili distinti ──────────────────────────────────────────────────
// Un tag script e un tag img con attributo di evento: se un renderer usasse l'iniezione di
// HTML grezzo il primo creerebbe un elemento <script> e il secondo un <img> nell'albero.
const SCRIPT_PAYLOAD = '<script>window.__belora_pwned = 1</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__belora_pwned = 2">';

// ── fixture builder (LOCALI al file, nessun helper condiviso) ─────────────────

function heroBlock(businessName: string): SiteBlock {
  return {
    id: 'hero',
    content: {
      hero_title_kicker: 'Forno dal 1980',
      hero_title: 'Pane caldo ogni mattina',
      hero_subtitle: 'Lievito madre e farine locali',
    },
    data: { business_name: businessName },
    brief_fields_rendered: ['business_name'],
    images: [{ source: 'theme-placeholder', token: 'hero' }],
  };
}

// `about_body` e' dove atterra la prosa che il modello scrive da `description`, e
// `about_points` quella da `highlights` (spec §8): e' li' che il testo non fidato passa.
function chiSiamoBlock(body: string, firstPoint: string): SiteBlock {
  return {
    id: 'chi-siamo',
    content: {
      about_title: 'La nostra storia',
      about_body: body,
      about_points: [firstPoint, 'Impastiamo a mano ogni giorno'],
    },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

function faqBlock(): SiteBlock {
  return {
    id: 'faq',
    content: {
      faq_title: 'Domande frequenti',
      faq_items: [{ question: 'Aperti a pranzo?', answer: 'Si, tutti i giorni' }],
    },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

describe('T-231 AC-231-1 — testo non fidato reso come testo, nessun elemento dal payload', () => {
  it('script in description e img in un highlight compaiono come TESTO, senza generare elementi', async () => {
    // Fixture con PIU DI UN blocco e valori DISCORDANTI: hero (pulito) + chi-siamo (ostile).
    const cleanPage: SitePage = {
      slug: 'home',
      role: 'home',
      title: 'Panificio Aurora',
      meta_description: 'Pane fresco',
      blocks: [heroBlock('Panificio Aurora'), chiSiamoBlock('Siamo un forno di quartiere', 'Farine del territorio')],
    };
    const dirtyPage: SitePage = {
      slug: 'home',
      role: 'home',
      title: 'Panificio Aurora',
      meta_description: 'Pane fresco',
      blocks: [heroBlock('Panificio Aurora'), chiSiamoBlock(SCRIPT_PAYLOAD, IMG_PAYLOAD)],
    };

    const cleanContainer = render(await SitePageView({ page: cleanPage, theme: THEME, locale: 'it' })).container;
    const dirtyContainer = render(await SitePageView({ page: dirtyPage, theme: THEME, locale: 'it' })).container;

    // I due payload compaiono verbatim come TESTO nell'albero reso.
    expect(dirtyContainer.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-231-1
    expect(dirtyContainer.textContent).toContain(IMG_PAYLOAD); // covers: AC-231-1

    // Il numero di <script> e <img> non AUMENTA rispetto alla pagina pulita per il payload…
    expect(dirtyContainer.querySelectorAll('script')).toHaveLength(
      cleanContainer.querySelectorAll('script').length,
    ); // covers: AC-231-1
    expect(dirtyContainer.querySelectorAll('img')).toHaveLength(
      cleanContainer.querySelectorAll('img').length,
    ); // covers: AC-231-1
    // …ed e' quello atteso dal componente narrativo: nessuno dei due nasce dal testo.
    expect(dirtyContainer.querySelectorAll('script')).toHaveLength(0); // covers: AC-231-1
    expect(dirtyContainer.querySelectorAll('img')).toHaveLength(0); // covers: AC-231-1
  });

  it('anche il campo dati reso (business_name) escape il payload invece di aprire un elemento', async () => {
    const block = heroBlock(SCRIPT_PAYLOAD);
    const container = render(await Hero({ block, locale: 'it' })).container;

    expect(container.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-231-1
    expect(container.querySelectorAll('script')).toHaveLength(0); // covers: AC-231-1
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-231-1
  });
});

describe('T-231 AC-231-5 — un blocco rende SOLO i suoi brief_fields_rendered', () => {
  // L'UNIVERSO di `block.data` e' RenderedBriefDataSchema (document.ts): la shape flat del
  // brief (BriefUpdateSchema) piu' `offerings` e `hours` derivati. Marcare i soli sei campi
  // originari (description/address/phone/email/whatsapp/social) rendeva l'AC vero PER
  // COSTRUZIONE su tutto il resto: un blocco che leakasse `highlights` (testo LIBERO non
  // fidato, spec §8), `brand_hints`, `offerings`, `hours` o `geo` non sarebbe stato visto.
  // Qui ogni campo non dichiarato porta un marcatore DISCORDANTE, cosi' la mutazione che
  // rendesse uno qualunque di essi cade.
  //
  // Trappola del PREFISSO: il marcatore di description ha `business_name` come prefisso
  // ('Trattoria' -> 'Trattoria-ZZLEAK-DESCRIPTION'), cosi' un leak con confronto lasco
  // verrebbe visto e la presenza del solo prefisso (business_name) non basta a mascherarlo.
  //
  // CAMPI NON MARCABILI, dichiarato e non nascosto: `vertical`/`primary_goal`/`locale` sono
  // enum a valori chiusi (nessun sentinel arbitrario ci sta, il tipo lo vieta) e `geo` e'
  // numerico — quest'ultimo e' marcato dalla FORMA-STRINGA delle sue coordinate. Gli enum
  // sono comunque valorizzati per presentare al blocco l'INTERO universo di block.data.
  const BUSINESS = 'Trattoria';
  const MARK = {
    description: `${BUSINESS}-ZZLEAK-DESCRIPTION`,
    address: 'ZZLEAK-ADDRESS',
    phone: 'ZZLEAK-PHONE',
    email: 'ZZLEAK-EMAIL',
    whatsapp: 'ZZLEAK-WHATSAPP',
    social: 'ZZLEAK-SOCIAL',
    highlights: 'ZZLEAK-HIGHLIGHTS',
    brandHints: 'ZZLEAK-BRAND-HINTS',
    offering: 'ZZLEAK-OFFERING-NAME',
    hours: 'ZZLEAK-HOURS-VALUE',
    geoLat: '41.900042',
    geoLng: '12.400042',
  } as const;
  const ALL_MARKERS = Object.values(MARK);

  // L'INTERO universo di block.data marcato. Ogni blocco riceve questo e SOVRASCRIVE il solo
  // campo che dichiara di rendere con un valore reale: cosi' "rende solo i suoi
  // brief_fields_rendered" e' falsificabile su OGNI campo, non sui soli sei originari.
  function markedData(overrides: Partial<SiteBlock['data']> = {}): SiteBlock['data'] {
    return {
      business_name: MARK.description, // non dichiarato per default -> marcato (hero lo sovrascrive)
      vertical: 'ristorazione',
      description: MARK.description,
      address: MARK.address,
      geo: { lat: 41.900042, lng: 12.400042 },
      hours: { 'lun-ven': MARK.hours },
      phone: MARK.phone,
      email: MARK.email,
      whatsapp: MARK.whatsapp,
      primary_goal: 'prenota',
      social_links: [MARK.social],
      highlights: [MARK.highlights],
      brand_hints: MARK.brandHints,
      offerings: [{ name: MARK.offering }],
      ...overrides,
    };
  }

  function assertNoMarkers(text: string | null): void {
    for (const marker of ALL_MARKERS) {
      expect(text ?? '').not.toContain(marker); // covers: AC-231-5
    }
  }

  it('hero: rende business_name (dichiarato) e nessun marcatore dei campi non dichiarati', async () => {
    const block: SiteBlock = {
      id: 'hero',
      content: { hero_title_kicker: 'Dal 1980', hero_title: 'Cucina di casa', hero_subtitle: 'Ogni giorno' },
      data: markedData({ business_name: BUSINESS }),
      brief_fields_rendered: ['business_name'],
      images: [],
    };
    const container = render(await Hero({ block, locale: 'it' })).container;

    expect(container.textContent).toContain(BUSINESS); // covers: AC-231-5
    assertNoMarkers(container.textContent);
  });

  it('cta-whatsapp: rende whatsapp (dichiarato) come link e nessun marcatore altrove', async () => {
    const block: SiteBlock = {
      id: 'cta-whatsapp',
      content: { whatsapp_cta_title: 'Scrivici per prenotare un tavolo' },
      data: markedData({ whatsapp: '+390551234567' }),
      brief_fields_rendered: ['whatsapp'],
      images: [],
    };
    const container = render(await CtaWhatsapp({ block, locale: 'it' })).container;

    const link = container.querySelector('a.site-cta__button');
    expect(link?.getAttribute('href')).toBe('https://wa.me/390551234567'); // covers: AC-231-5
    // Il numero dichiarato e' reso (nell'href); i marcatori dei campi non dichiarati no,
    // ne nel testo ne nell'href.
    assertNoMarkers(container.textContent);
    assertNoMarkers(link?.getAttribute('href') ?? '');
  });

  it('chi-siamo: dichiara [] quindi nessun campo del brief e reso, solo la prosa degli slot', async () => {
    const block: SiteBlock = {
      id: 'chi-siamo',
      content: { about_title: 'Chi siamo', about_body: 'Un forno di quartiere', about_points: ['A mano', 'Ogni giorno'] },
      data: markedData(),
      brief_fields_rendered: [],
      images: [],
    };
    const container = render(await ChiSiamo({ block, locale: 'it' })).container;

    expect(container.textContent).toContain('Un forno di quartiere'); // covers: AC-231-5
    assertNoMarkers(container.textContent);
  });

  it('faq: dichiara [] quindi nessun campo del brief e reso, solo domande e risposte', async () => {
    const block: SiteBlock = {
      id: 'faq',
      content: {
        faq_title: 'Domande frequenti',
        faq_items: [
          { question: 'Siete aperti a pranzo?', answer: 'Si, tutti i giorni' },
          { question: 'Avete il forno a legna?', answer: 'Certo' },
        ],
      },
      data: markedData(),
      brief_fields_rendered: [],
      images: [],
    };
    const container = render(await Faq({ block, locale: 'it' })).container;

    expect(container.textContent).toContain('Siete aperti a pranzo?'); // covers: AC-231-5
    assertNoMarkers(container.textContent);
  });
});

// Le fondamenta condivise del renderer (PIN 1, P2-D8): un solo registry id->componente e il
// renderer a livello documento che l'anteprima (T-235) e le card (T-232) importeranno. Non
// sono AC di T-231 — sono INVARIANTI (`pin`) che tengono il confine del renderer.
describe('T-231 fondamenta condivise del renderer (pin)', () => {
  it('il registry unico mappa gli otto blocchi (narrativi T-231 e dati T-237) a componenti', () => {
    // pin: T-237 ha AGGIUNTO i blocchi di dati (offerte, orari, contatti, recensioni) accanto
    // ai narrativi, nello STESSO registry — nessun renderer parallelo.
    for (const id of ['hero', 'chi-siamo', 'faq', 'cta-whatsapp', 'offerte', 'orari', 'contatti', 'recensioni']) {
      expect(typeof SITE_BLOCK_COMPONENTS[id]).toBe('function');
    }
    expect(Object.keys(SITE_BLOCK_COMPONENTS)).toHaveLength(8);
  });

  it('renderBlock salta un blocco non registrato (un id fuori dal catalogo)', () => {
    // pin: un id fuori dal registry rende null invece di lanciare. 'galleria' non e' nel
    // catalogo v1 (P2-D24), quindi non ha componente.
    const dataBlock: SiteBlock = { id: 'galleria', content: {}, data: {}, brief_fields_rendered: [], images: [] };
    expect(renderBlock(dataBlock, 'it')).toBeNull();
  });

  it('SiteView rende l intero documento: ogni pagina e ogni blocco narrativo', async () => {
    // pin: renderer a livello documento (lo montera' l'anteprima T-235). Multi-pagina con
    // slug in relazione di PREFISSO ('chi' e' prefisso di 'chi-siamo-e-storia') e blocchi
    // DISCORDANTI per pagina.
    const doc: SiteDocument = {
      recipe_id: 'vetrina-dell-offerta@1',
      theme_id: THEME.id,
      pages: [
        { slug: 'chi', role: 'home', title: 'Home', meta_description: 'Benvenuti', blocks: [heroBlock('Panificio Aurora')] },
        { slug: 'chi-siamo-e-storia', role: 'faq', title: 'FAQ', meta_description: 'Le domande', blocks: [faqBlock()] },
      ],
    };
    const container = render(await SiteView({ document: doc, theme: THEME, locale: 'it' })).container;

    expect(container.querySelectorAll('[data-site-page]')).toHaveLength(2);
    expect(container.querySelector('[data-site-page="chi"] [data-block-id="hero"]')).not.toBeNull();
    expect(container.querySelector('[data-site-page="chi-siamo-e-storia"] [data-block-id="faq"]')).not.toBeNull();
    // La trappola del prefisso: la pagina 'chi' non prende i blocchi di 'chi-siamo-e-storia'.
    expect(container.querySelector('[data-site-page="chi"] [data-block-id="faq"]')).toBeNull();
  });
});
