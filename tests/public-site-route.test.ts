// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { routing } from '@/i18n/routing';

// T-405 (macrotask public-serving, P4) — ORACOLO della rotta pubblica standalone /s/<slug>.
// Le asserzioni derivano da AC-405-1..5 (blueprint P4), taggate `// covers: AC-405-<n>` sulla riga
// dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW:
//  - next/navigation: notFound con throw-sentinel, come in produzione (in Next lancia e interrompe
//    il render). redirect e' un no-op difensivo (la rotta non lo usa).
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es per il locale passato, cosi'
//    le etichette dei landmark (site.blocks.*) sono autentiche e l'escaping del testo resta quello
//    vero di React. Serve anche da PROVA di locale: 'Intestazione' (it) vs 'Encabezado' (es).
//  - @/data/public-site readPublishedSite: il SOLO seam di dato. Modella la lettura anon+RLS: una
//    TABELLA di publication con `is_published`, da cui il seam restituisce la riga SOLO se pubblicata
//    (RLS anon-published) e SOLO le colonne pubbliche (document, public_slug, locale). Uno slug
//    inesistente e uno non pubblicato collassano entrambi a `null` — l'indistinguibilita' di P1-D21
//    e' nel seam, non simulata a mano. Il match e' per UGUAGLIANZA ESATTA (mappa a chiave esatta):
//    uno slug che e' PREFISSO di uno esistente non trova nulla.
//  parseDocument, THEMES, SiteView, il registry e i blocchi NON sono mockati: la rotta rende col
//  renderer REALE (P2-D8), e l'escaping del testo ostile e' quello vero.
//
// PROVE STRUTTURALI (source-scan sui file del deliverable), per i negativi che il mock non prova:
// niente service_role, niente LIKE/prefix, proiezione delle sole colonne pubbliche, niente
// dangerouslySetInnerHTML, renderer unico importato (mai una copia).

const { NOT_FOUND, notFoundSpy, redirectSpy } = vi.hoisted(() => {
  const notFoundSentinel = Symbol('not-found');
  return {
    NOT_FOUND: notFoundSentinel,
    notFoundSpy: vi.fn(() => {
      throw notFoundSentinel;
    }),
    redirectSpy: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  notFound: notFoundSpy,
  redirect: redirectSpy,
}));

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = ((cat[namespace] ?? {}) as Record<string, unknown>) ?? {};
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

// Il seam di dato modella la lettura anon+RLS: `table` e' la popolazione grezza (con is_published);
// il seam ne restituisce SOLO le righe pubblicate e SOLO le colonne pubbliche, o null.
const { pubHolder, readPublishedSiteSpy } = vi.hoisted(() => {
  const holder = {
    table: {} as Record<string, { document: unknown; locale: string; is_published: boolean }>,
  };
  return {
    pubHolder: holder,
    readPublishedSiteSpy: vi.fn(async (slug: string) => {
      // Match per UGUAGLIANZA ESATTA (chiave propria della mappa): un prefisso non trova nulla.
      const row = Object.prototype.hasOwnProperty.call(holder.table, slug)
        ? holder.table[slug]
        : undefined;
      // RLS anon-published: il non pubblicato e' invisibile ad anon, come lo sconosciuto -> null.
      if (!row || !row.is_published) return null;
      // Colonne pubbliche soltanto (GRANT column-level): mai account_id/site_id/source_generation_id.
      return { document: row.document, public_slug: slug, locale: row.locale };
    }),
  };
});
vi.mock('@/data/public-site', () => ({ readPublishedSite: readPublishedSiteSpy }));

// Import DOPO i mock.
import PublicSitePage from '@/app/s/[slug]/page';
import PublicSiteLayout from '@/app/s/[slug]/layout';

const THEME = THEMES[0];

// ── payload OSTILI distinti (AC-405-5) ─────────────────────────────────────────
const SCRIPT_PAYLOAD = '<script>window.__belora_pwned_405 = 1</script>';
const IMG_PAYLOAD = '<img src=x onerror="window.__belora_pwned_405 = 2">';
const JS_URL = 'javascript:alert(document.cookie)';
const HTTPS_SOCIAL = 'https://instagram.com/belora';

// ── fixture builder (LOCALI al file) ───────────────────────────────────────────
// Un hero minimo VALIDO che rende il proprio titolo in un <h1> e (se dato) il business_name in un <p>.
function heroBlock(title: string, businessName?: string): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: title },
    data: businessName ? { business_name: businessName } : {},
    brief_fields_rendered: businessName ? ['business_name'] : [],
    images: [],
  };
}

// Un contatti che rende i social come LINK costruiti da testo libero (safeHttpsHref): la superficie
// dove "nessun src/href da testo libero" e' falsificabile.
function contattiBlock(socials: string[]): SiteBlock {
  return {
    id: 'contatti',
    content: { contact_title: 'Contatti', contact_intro: 'Scrivici' },
    data: { social_links: socials },
    brief_fields_rendered: ['social_links'],
    images: [{ source: 'theme-placeholder', token: 'contatti' }],
  };
}

const IT_MARK = 'CASA-NOSTRA-IT';
const ES_MARK = 'NUESTRA-CASA-ES';
const HIDDEN_MARK = 'CONTENUTO-NASCOSTO-NON-PUBBLICATO';

const DOC_IT: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [{ slug: 'home', role: 'home', title: 'Benvenuti', meta_description: 'La home', blocks: [heroBlock(IT_MARK)] }],
};
const DOC_ES: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [{ slug: 'home', role: 'home', title: 'Bienvenidos', meta_description: 'El inicio', blocks: [heroBlock(ES_MARK)] }],
};
// Snapshot NON pubblicato: esiste nella tabella ma la RLS non lo restituisce ad anon.
const DOC_HIDDEN: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [{ slug: 'home', role: 'home', title: 'Segreto', meta_description: 'Non pubblicato', blocks: [heroBlock(HIDDEN_MARK)] }],
};
// Documento ostile ma VALIDO (passa parseDocument -> viene reso): hero con script nel titolo e
// img-onerror nel business_name, contatti con un social javascript: (ostile) e uno https (valido).
const HOSTILE_DOC: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [
    {
      slug: 'home',
      role: 'home',
      title: 'Casa',
      meta_description: 'Pagina ostile',
      blocks: [heroBlock(SCRIPT_PAYLOAD, IMG_PAYLOAD), contattiBlock([JS_URL, HTTPS_SOCIAL])],
    },
  ],
};
// Snapshot che NON passa il gate: nessuna pagina ha ruolo 'home' (superRefine di parseDocument).
const INVALID_DOC: unknown = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [{ slug: 'faq', role: 'faq', title: 'FAQ', meta_description: 'Domande', blocks: [heroBlock('x')] }],
};

// ── slug (disciplina fixture: >1 riga, valori DISCORDANTI, coppia in relazione di PREFISSO) ──
// 'bar' e' un PROPRIO PREFISSO di 'bar-centro': se la selezione fosse per prefisso, l'una
// assorbirebbe l'altra. Entrambe pubblicate, con locale DISCORDANTE (it vs es).
const SLUG_IT = 'bar';
const SLUG_ES = 'bar-centro';
const SLUG_HOSTILE = 'contatti-ostili';
const SLUG_INVALID = 'documento-rotto';
const SLUG_UNPUBLISHED = 'osteria-nascosta';
const SLUG_UNKNOWN = 'sconosciuto';
// Slug INESISTENTI che sono PREFISSO di uno esistente: la trappola del prefisso.
const SLUG_PREFIX_OF_BOTH = 'ba'; // prefisso di 'bar' e di 'bar-centro'
const SLUG_PREFIX_OF_ES = 'bar-cent'; // prefisso di 'bar-centro'

const renderPage = async (slug: string) => render(await PublicSitePage({ params: Promise.resolve({ slug }) }));

const layoutElement = async (slug: string) =>
  PublicSiteLayout({
    params: Promise.resolve({ slug }),
    children: createElement('div', { 'data-test-child': 'x' }),
  });

// I file del deliverable, per le prove strutturali (radice del repo = cwd di vitest).
const DATA_MODULE = resolve(process.cwd(), 'src/data/public-site.ts');
const PAGE_FILE = resolve(process.cwd(), 'src/app/s/[slug]/page.tsx');
const LAYOUT_FILE = resolve(process.cwd(), 'src/app/s/[slug]/layout.tsx');

// Le prove strutturali guardano il CODICE, non i commenti: i commenti di questi file NOMINANO
// deliberatamente cio' che il codice NON fa ('nessun dangerouslySetInnerHTML', 'nessun ramo su
// is_published') — spiegare l'assenza e' la loro funzione. Si scansiona quindi il sorgente coi
// commenti `//` rimossi, cosi' un token che compare SOLO in un commento non falsa il negativo. I
// file del deliverable usano solo commenti di riga e nessun `//` dentro stringhe di codice.
const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join('\n');

beforeEach(() => {
  pubHolder.table = {
    [SLUG_IT]: { document: DOC_IT, locale: 'it', is_published: true },
    [SLUG_ES]: { document: DOC_ES, locale: 'es', is_published: true },
    [SLUG_HOSTILE]: { document: HOSTILE_DOC, locale: 'it', is_published: true },
    [SLUG_INVALID]: { document: INVALID_DOC, locale: 'it', is_published: true },
    [SLUG_UNPUBLISHED]: { document: DOC_HIDDEN, locale: 'it', is_published: false },
  };
  notFoundSpy.mockClear();
  redirectSpy.mockClear();
  readPublishedSiteSpy.mockClear();
});

afterEach(() => cleanup());

// ─────────────────────────────────────────────────────────────────────────────
// AC-405-1 — render standalone dal renderer REALE, nel LOCALE DELLA RIGA (non del browser).
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-405-1 — /s/<slug> rende SiteView standalone nel locale della RIGA', () => {
  it('uno slug pubblicato it: la pagina e resa dal SiteView reale, standalone, in it', async () => {
    // Sanity: la fixture e' un documento VALIDO (altrimenti il render sarebbe vacuo).
    expect(parseDocument(DOC_IT).ok).toBe(true);

    const { container } = await renderPage(SLUG_IT);

    // Reso dal renderer UNICO reale: contenitore .site-view, una sezione per pagina, il titolo hero.
    expect(container.querySelector('.site-view')).not.toBeNull(); // covers: AC-405-1
    expect(document.querySelectorAll('[data-site-page="home"]')).toHaveLength(1); // covers: AC-405-1
    expect(within(screen.getByRole('main')).getByText(IT_MARK)).toBeTruthy(); // covers: AC-405-1

    // Il locale che ha reso e' quello della RIGA (it): l'etichetta i18n del landmark hero e' quella
    // del catalogo it ('Intestazione'), non quella es ('Encabezado').
    const heroSection = container.querySelector('[data-block-id="hero"]') as HTMLElement;
    expect(heroSection.getAttribute('aria-label')).toBe(itMessages.site.blocks.hero); // covers: AC-405-1
    expect(heroSection.getAttribute('aria-label')).not.toBe(esMessages.site.blocks.hero); // covers: AC-405-1

    // La lettura e' avvenuta con lo slug ESATTO richiesto; nessun notFound.
    expect(readPublishedSiteSpy).toHaveBeenCalledWith(SLUG_IT); // covers: AC-405-1
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-405-1
  });

  it('lo stesso codice su una riga es rende in es: il locale viene dalla RIGA, non dal browser', async () => {
    const { container } = await renderPage(SLUG_ES);

    // Riga es -> render es: etichetta del landmark 'Encabezado', e il marcatore es reso.
    const heroSection = container.querySelector('[data-block-id="hero"]') as HTMLElement;
    expect(heroSection.getAttribute('aria-label')).toBe(esMessages.site.blocks.hero); // covers: AC-405-1
    expect(within(screen.getByRole('main')).getByText(ES_MARK)).toBeTruthy(); // covers: AC-405-1
    // Nessun input di locale del browser esiste in questa strada: due righe, due locale distinti,
    // guidati SOLO dalla riga.
    expect(heroSection.getAttribute('aria-label')).not.toBe(itMessages.site.blocks.hero); // covers: AC-405-1
  });

  it('il LAYOUT standalone rende <html lang> col locale della RIGA (non del browser)', async () => {
    // Il root layout del sotto-albero /s/* fornisce <html>/<body>; lang = locale della riga.
    const elIt = await layoutElement(SLUG_IT);
    expect(elIt.type).toBe('html'); // covers: AC-405-1
    expect(elIt.props.lang).toBe('it'); // covers: AC-405-1
    expect(elIt.props.children.type).toBe('body'); // covers: AC-405-1

    // Stesso layout, riga es: lang segue la RIGA (es), a prova che non e' un valore fisso ne il
    // locale negoziato col browser (di cui il layout non ha alcun input).
    const elEs = await layoutElement(SLUG_ES);
    expect(elEs.props.lang).toBe('es'); // covers: AC-405-1
    expect(elEs.props.lang).not.toBe(elIt.props.lang); // covers: AC-405-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-405-2 — uno slug inesistente che e' PREFISSO di uno esistente -> notFound (mai per prefisso).
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-405-2 — nessuna selezione per prefisso: uno slug-prefisso inesistente e 404', () => {
  it('slug inesistenti che sono PREFISSO di uno esistente -> notFound, con lo slug ESATTO letto', async () => {
    for (const slug of [SLUG_PREFIX_OF_BOTH, SLUG_PREFIX_OF_ES]) {
      notFoundSpy.mockClear();
      readPublishedSiteSpy.mockClear();
      await expect(PublicSitePage({ params: Promise.resolve({ slug }) })).rejects.toBe(NOT_FOUND); // covers: AC-405-2
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-405-2
      // La lettura e' stata tentata con lo slug ESATTO (non troncato a un prefisso), e non ha trovato
      // riga: nessuna riga selezionata per prefisso.
      expect(readPublishedSiteSpy).toHaveBeenCalledWith(slug); // covers: AC-405-2
    }
  });

  it('CONTRO-PROVA: la coppia in relazione di prefisso resta DISTINTA (uguaglianza esatta)', async () => {
    // 'bar' e 'bar-centro' sono due righe distinte: ognuna rende il PROPRIO documento, nessuna
    // assorbe l'altra. Se la selezione fosse per prefisso, le due si incrocerebbero.
    const bar = await renderPage(SLUG_IT);
    expect(within(bar.container).queryByText(IT_MARK)).not.toBeNull(); // covers: AC-405-2
    expect(within(bar.container).queryByText(ES_MARK)).toBeNull(); // covers: AC-405-2
    cleanup();
    const barCentro = await renderPage(SLUG_ES);
    expect(within(barCentro.container).queryByText(ES_MARK)).not.toBeNull(); // covers: AC-405-2
    expect(within(barCentro.container).queryByText(IT_MARK)).toBeNull(); // covers: AC-405-2
  });

  it('il modulo di dato usa .eq(public_slug) e MAI LIKE/ilike/filter (prova strutturale)', () => {
    const src = codeOf(DATA_MODULE);
    expect(src).toContain(".eq('public_slug', slug)"); // covers: AC-405-2
    expect(src).not.toMatch(/\.i?like\s*\(/); // covers: AC-405-2
    expect(src).not.toMatch(/\.filter\s*\(/); // covers: AC-405-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-405-3 — slug NON pubblicato -> notFound, INDISTINGUIBILE dallo slug inesistente (P1-D21).
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-405-3 — non pubblicato e inesistente danno la STESSA risposta (anti-enumerazione)', () => {
  it('slug non pubblicato e slug inesistente: entrambi notFound, nessun render, nessun oracolo', async () => {
    // Sanity: lo snapshot non pubblicato esiste ed e' valido — se fosse servito, renderebbe HIDDEN_MARK.
    expect(parseDocument(DOC_HIDDEN).ok).toBe(true);

    for (const slug of [SLUG_UNPUBLISHED, SLUG_UNKNOWN]) {
      notFoundSpy.mockClear();
      await expect(PublicSitePage({ params: Promise.resolve({ slug }) })).rejects.toBe(NOT_FOUND); // covers: AC-405-3
      expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-405-3
    }

    // Nessuna traccia dello snapshot non pubblicato e' mai finita nel DOM: nessun corpo rivela che
    // la riga esiste ma non e' pubblicata.
    expect(document.body.textContent).not.toContain(HIDDEN_MARK); // covers: AC-405-3

    // Il seam (che modella la RLS anon-published) ha restituito null in ENTRAMBI i casi: la riga non
    // pubblicata e' invisibile ad anon esattamente come quella inesistente.
    expect(await readPublishedSiteSpy(SLUG_UNPUBLISHED)).toBeNull(); // covers: AC-405-3
    expect(await readPublishedSiteSpy(SLUG_UNKNOWN)).toBeNull(); // covers: AC-405-3
  });

  it('il filtro is_published e imposto dalla RLS, non da un ramo di codice della rotta', () => {
    // La rotta non ha alcun ramo su is_published: la colonna non e' nemmeno selezionata (non e'
    // concessa ad anon dal GRANT column-level). L'indistinguibilita' e' STRUTTURALE, non un if.
    const pageSrc = codeOf(PAGE_FILE);
    const dataSrc = codeOf(DATA_MODULE);
    // Proiezione delle SOLE colonne pubbliche: is_published NON e' selezionato.
    expect(dataSrc).toContain("select('document, public_slug, locale')"); // covers: AC-405-3
    // La rotta non ispeziona is_published (nessun ramo che distingua pubblicato da non pubblicato).
    expect(pageSrc).not.toContain('is_published'); // covers: AC-405-3
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-405-4 — uno snapshot che NON passa il gate e' rifiutato: niente reso fuori dal gate.
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-405-4 — parseDocument gate in render: uno snapshot non valido -> notFound, nulla reso', () => {
  it('uno snapshot che fallisce parseDocument non raggiunge SiteView', async () => {
    // Sanity: il documento NON passa il gate (nessuna home).
    expect(parseDocument(INVALID_DOC).ok).toBe(false);

    await expect(PublicSitePage({ params: Promise.resolve({ slug: SLUG_INVALID }) })).rejects.toBe(
      NOT_FOUND,
    ); // covers: AC-405-4
    expect(notFoundSpy).toHaveBeenCalledTimes(1); // covers: AC-405-4

    // Niente di non validato e' stato reso: nessun albero del sito nel DOM.
    expect(document.querySelector('.site-view')).toBeNull(); // covers: AC-405-4
    expect(document.querySelectorAll('[data-site-page]')).toHaveLength(0); // covers: AC-405-4
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-405-5 — testo ostile reso come TESTO (escaping del SiteView reale), nessun markup attivo,
// nessun src/href da testo libero.
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-405-5 — payload ostile reso come testo, nessun markup attivo, nessun href da testo libero', () => {
  it('script/on-handler/URL javascript compaiono come testo; nessun elemento o link ostile nasce', async () => {
    // Sanity: il documento ostile e' VALIDO (passa il gate e viene reso — l'asserzione non e' vacua).
    expect(parseDocument(HOSTILE_DOC).ok).toBe(true);

    const { container } = await renderPage(SLUG_HOSTILE);

    // I payload compaiono VERBATIM come TESTO nell'albero reso.
    expect(container.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-405-5
    expect(container.textContent).toContain(IMG_PAYLOAD); // covers: AC-405-5
    expect(container.textContent).toContain(JS_URL); // covers: AC-405-5

    // Nessun elemento attivo nasce dal testo: l'UNICO <script> ammesso e' il JSON-LD del serving
    // (T-410, type application/ld+json — NON eseguibile dal browser, contenuto GIA' ESCAPED da
    // serializeJsonLdSafe: < > & U+2028/9 -> \uXXXX), mai uno script eseguibile dal testo libero del
    // brief; zero <iframe>, zero <img> (il documento non ha immagini reali), nessun onerror.
    for (const s of [...container.querySelectorAll('script')]) {
      expect(s.getAttribute('type')).toBe('application/ld+json'); // covers: AC-405-5 — solo JSON-LD, nessuno script eseguibile
      expect(s.textContent ?? '').not.toContain('</script'); // covers: AC-405-5 — tag non richiudibile (contenuto escaped)
    }
    expect(container.querySelectorAll('iframe')).toHaveLength(0); // covers: AC-405-5
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-405-5
    expect(container.querySelector('[onerror]')).toBeNull(); // covers: AC-405-5
    expect((window as unknown as Record<string, unknown>).__belora_pwned_405).toBeUndefined(); // covers: AC-405-5

    // Nessun src/href deriva dal testo libero: l'URL javascript: NON diventa un href, e ogni href/src
    // presente non lo contiene.
    const urlAttrs = [...container.querySelectorAll('[src], [href]')].flatMap((el) => [
      el.getAttribute('src') ?? '',
      el.getAttribute('href') ?? '',
    ]);
    for (const value of urlAttrs) {
      expect(value).not.toContain('javascript:'); // covers: AC-405-5
      expect(value).not.toBe(JS_URL); // covers: AC-405-5
    }

    // FALSIFICABILITA': i due social sono resi (due voci), ma solo l'https VALIDO produce un link;
    // il javascript: resta solo testo. Se il render costruisse href da testo libero, i link sarebbero due.
    expect(container.querySelectorAll('.site-contact__social')).toHaveLength(2); // covers: AC-405-5
    const socialLinks = [...container.querySelectorAll('.site-contact__social a')];
    expect(socialLinks).toHaveLength(1); // covers: AC-405-5
    expect(socialLinks[0].getAttribute('href')).toBe(HTTPS_SOCIAL); // covers: AC-405-5
  });

  it('la rotta non usa dangerouslySetInnerHTML e monta il renderer UNICO (prova strutturale)', () => {
    const pageSrc = codeOf(PAGE_FILE);
    expect(pageSrc).not.toContain('dangerouslySetInnerHTML'); // covers: AC-405-5
    // Renderer UNICO: importa SiteView dal modulo canonico, mai una copia.
    expect(pageSrc).toContain("from '@/ui/site/SiteView'"); // covers: AC-405-5
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Difese trasversali del percorso pubblico (security_notes): anon-only e layout standalone robusto.
// ─────────────────────────────────────────────────────────────────────────────
describe('percorso pubblico anon-only e layout robusto (security_notes)', () => {
  it('nessun file del deliverable usa la service_role key (anon-only nel percorso pubblico)', () => {
    for (const file of [DATA_MODULE, PAGE_FILE, LAYOUT_FILE]) {
      const src = codeOf(file);
      expect(src).not.toContain('SERVICE_ROLE_KEY'); // covers: AC-405-3
    }
    // La lettura passa dal client SSR anon (RLS attiva), mai dal client autenticato/service_role.
    const dataSrc = codeOf(DATA_MODULE);
    expect(dataSrc).toContain("from '@/data/supabase-ssr'"); // covers: AC-405-3
    // Deduplicazione layout+page: la lettura e' avvolta in React cache().
    expect(dataSrc).toContain('cache('); // covers: AC-405-1
  });

  it('il layout non lancia per uno slug inesistente: html/body col defaultLocale (404 con documento)', async () => {
    // Anche quando la page rispondera' notFound, il layout deve produrre <html>/<body> per la pagina
    // 404. lang ricade sul defaultLocale — neutro, non distingue lo sconosciuto dal non pubblicato.
    const el = await layoutElement(SLUG_UNKNOWN);
    expect(el.type).toBe('html'); // covers: AC-405-3
    expect(el.props.lang).toBe(routing.defaultLocale); // covers: AC-405-3
    const elUnpub = await layoutElement(SLUG_UNPUBLISHED);
    expect(elUnpub.props.lang).toBe(el.props.lang); // covers: AC-405-3
  });
});
