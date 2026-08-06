// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';

// T-408 (macrotask public-serving, P4) — ORACOLO del badge "Made with Belora" sulla rotta
// pubblica /s/<slug>. Le asserzioni derivano da AC-408-1..3 (blueprint P4), taggate
// `// covers: AC-408-<n>` sulla riga dell'EXPECT.
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW (identico impianto della rotta, T-405):
//  - next/navigation: notFound con throw-sentinel (difensivo; i casi qui sono tutti pubblicati e
//    validi, quindi non lo toccano — se lo toccasse, il test lo saprebbe).
//  - next-intl/server getTranslations: risolve dai cataloghi REALI it/es per il locale PASSATO,
//    cosi' il testo del badge e' quello autentico del catalogo e serve anche da PROVA di locale
//    ('Fatto con Belora' it vs 'Hecho con Belora' es) — non un valore inventato dal test.
//  - @/data/public-site readPublishedSite: il SOLO seam di dato; modella la lettura anon+RLS,
//    match per UGUAGLIANZA ESATTA sullo slug, sole colonne pubbliche (document, public_slug,
//    locale). parseDocument, THEMES, SiteView, il registry e i blocchi NON sono mockati: il badge
//    e' montato dalla rotta REALE accanto al renderer REALE.
//
// PROVA STRUTTURALE (source-scan): l'href del badge e' una COSTANTE statica, un solo href nel
// file, nessun dangerouslySetInnerHTML; la rotta (src/app), non il documento, monta il badge.

// I casi di questo file sono tutti PUBBLICATI e VALIDI: notFound() non deve mai scattare. Lo spy
// lancia se chiamato, cosi' un 404 imprevisto fa fallire il test invece di passare in silenzio.
const { notFoundSpy } = vi.hoisted(() => ({
  notFoundSpy: vi.fn(() => {
    throw new Error('notFound() chiamato in un caso pubblicato/valido');
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundSpy,
  redirect: vi.fn(),
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

// Seam di dato: la lettura anon+RLS. La `table` e' la popolazione grezza; il seam restituisce solo
// le righe pubblicate e solo le colonne pubbliche, per UGUAGLIANZA ESATTA sullo slug (un prefisso
// non trova nulla) — la stessa forma del seam di T-405.
const { pubHolder, readPublishedSiteSpy } = vi.hoisted(() => {
  const holder = {
    table: {} as Record<string, { document: unknown; locale: string; is_published: boolean }>,
  };
  return {
    pubHolder: holder,
    readPublishedSiteSpy: vi.fn(async (slug: string) => {
      const row = Object.prototype.hasOwnProperty.call(holder.table, slug)
        ? holder.table[slug]
        : undefined;
      if (!row || !row.is_published) return null;
      return { document: row.document, public_slug: slug, locale: row.locale };
    }),
  };
});
vi.mock('@/data/public-site', () => ({ readPublishedSite: readPublishedSiteSpy }));

// Import DOPO i mock.
import PublicSitePage from '@/app/s/[slug]/page';

// L'URL atteso del badge: lo stesso literal che la prova strutturale PINNA nel sorgente di Badge.tsx
// (`const BELORA_BADGE_URL = 'https://belora.app'`), cosi' cambiare l'uno senza l'altro fa rosso.
const EXPECTED_BADGE_URL = 'https://belora.app';

const THEME = THEMES[0];

// ── payload ostili (per la prova di non-spoofabilita', AC-408-2) ───────────────
const JS_URL = 'javascript:alert(document.cookie)';
const HTTPS_SOCIAL = 'https://instagram.com/belora';

// ── fixture builder (LOCALI al file) ───────────────────────────────────────────
function heroBlock(title: string): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: title },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

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

const DOC_IT: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [
    { slug: 'home', role: 'home', title: 'Benvenuti', meta_description: 'La home', blocks: [heroBlock(IT_MARK)] },
  ],
};
const DOC_ES: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [
    { slug: 'home', role: 'home', title: 'Bienvenidos', meta_description: 'El inicio', blocks: [heroBlock(ES_MARK)] },
  ],
};
// Documento OSTILE ma VALIDO: il titolo hero SPOOFA il testo del badge, e un social e' un
// javascript: (l'unico modo che il documento avrebbe per iniettare un href ostile). Passa il gate
// e viene reso — l'asserzione di AC-408-2 non e' vacua.
const HOSTILE_DOC: SiteDocument = {
  recipe_id: 'vetrina@1',
  theme_id: THEME.id,
  pages: [
    {
      slug: 'home',
      role: 'home',
      title: 'Casa',
      meta_description: 'Pagina ostile',
      // Il titolo copia ESATTAMENTE il testo del badge: se il documento potesse spoofare il badge,
      // questo lo confonderebbe con quello vero.
      blocks: [heroBlock(itMessages.site.badge), contattiBlock([JS_URL, HTTPS_SOCIAL])],
    },
  ],
};

// ── slug (disciplina fixture: >1 riga, valori DISCORDANTI, coppia in relazione di PREFISSO) ──
// 'trattoria' e' un PROPRIO PREFISSO di 'trattoria-mar': l'asse su cui il seam seleziona (lo slug).
// Righe DISCORDANTI: locale it vs es, marcatori diversi. Il seam fa uguaglianza esatta, quindi le
// due restano distinte.
const SLUG_IT = 'trattoria';
const SLUG_ES = 'trattoria-mar';
const SLUG_HOSTILE = 'sito-ostile';

const renderPage = async (slug: string) =>
  render(await PublicSitePage({ params: Promise.resolve({ slug }) }));

// Il file del deliverable del badge, per la prova strutturale.
const BADGE_FILE = resolve(process.cwd(), 'src/app/s/[slug]/Badge.tsx');
const PAGE_FILE = resolve(process.cwd(), 'src/app/s/[slug]/page.tsx');

// Le prove strutturali sulla PAGE guardano il CODICE, non i commenti (il commento della page
// nomina deliberatamente 'dangerouslySetInnerHTML' per dire che NON lo usa): si scansiona il
// sorgente coi commenti `//` rimossi. Il badge, invece, contiene `//` dentro la stringa dell'URL,
// quindi il suo file si legge GREZZO (il suo commento non nomina i token proibiti).
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
  };
  notFoundSpy.mockClear();
  readPublishedSiteSpy.mockClear();
});

afterEach(() => cleanup());

// Il badge SERVITO, identificato dal marcatore che solo la rotta (src/app) emette: nessun blocco
// del documento produce `data-belora-badge`, quindi selezionarlo isola cio' che la SERVING rende.
const servingBadge = (container: HTMLElement) =>
  container.querySelector('[data-belora-badge]') as HTMLElement | null;

// ─────────────────────────────────────────────────────────────────────────────
// AC-408-1 — un sito pubblicato mostra il badge "Made with Belora" con un link a Belora.
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-408-1 — /s/<slug> mostra il badge con link a Belora', () => {
  it('sito pubblicato: il badge servito e presente, e un link, e punta a Belora', async () => {
    // Sanity: la fixture e' un documento VALIDO (il render non e' vacuo).
    expect(parseDocument(DOC_IT).ok).toBe(true);

    const { container } = await renderPage(SLUG_IT);

    const badge = servingBadge(container);
    expect(badge).not.toBeNull(); // covers: AC-408-1

    // Il badge e' un LINK a Belora, con href STATICO (la costante del modulo).
    const link = badge!.querySelector('a') as HTMLAnchorElement;
    expect(link).not.toBeNull(); // covers: AC-408-1
    expect(link.getAttribute('href')).toBe(EXPECTED_BADGE_URL); // covers: AC-408-1
    // Il testo nomina Belora ed e' quello del catalogo del locale della riga (it).
    expect(link.textContent).toContain('Belora'); // covers: AC-408-1
    expect(link.textContent).toBe(itMessages.site.badge); // covers: AC-408-1

    // Il badge e' montato dalla SERVING, FUORI dall'albero del documento (non dentro .site-view):
    // il documento non puo' toccarlo.
    const siteView = container.querySelector('.site-view');
    expect(siteView).not.toBeNull(); // covers: AC-408-1
    expect(siteView!.contains(badge)).toBe(false); // covers: AC-408-1
    // Il badge non e' nemmeno dentro il <main> del sito: e' chrome della serving, non contenuto.
    expect(within(screen.getByRole('main')).queryByText(itMessages.site.badge)).toBeNull(); // covers: AC-408-1
    // Caso pubblicato e valido: nessun 404.
    expect(notFoundSpy).not.toHaveBeenCalled(); // covers: AC-408-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-408-2 — un documento che prova a sopprimere o spoofare il badge non ci riesce: il badge
// servito resta presente e il suo href resta l'URL statico di Belora (mai dal documento).
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-408-2 — il badge servito non e sopprimibile ne spoofabile dal documento', () => {
  it('documento ostile (spoof del testo + javascript: social): un solo badge servito, href statico', async () => {
    // Sanity: il documento ostile e' VALIDO (passa il gate e viene reso).
    expect(parseDocument(HOSTILE_DOC).ok).toBe(true);

    const { container } = await renderPage(SLUG_HOSTILE);

    // Il documento NON puo' creare un secondo badge: `data-belora-badge` lo emette solo la serving.
    const badges = container.querySelectorAll('[data-belora-badge]');
    expect(badges).toHaveLength(1); // covers: AC-408-2

    // L'href del badge resta la COSTANTE statica di Belora, mai il javascript: del documento.
    const badge = servingBadge(container)!;
    const link = badge.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(EXPECTED_BADGE_URL); // covers: AC-408-2
    expect(link.getAttribute('href')).not.toContain('javascript:'); // covers: AC-408-2
    expect(link.getAttribute('href')).not.toBe(JS_URL); // covers: AC-408-2

    // Il badge servito e' FUORI dall'albero del documento: il titolo hero che copia il testo del
    // badge resta DENTRO .site-view, il badge servito NO — non si confondono.
    const siteView = container.querySelector('.site-view')!;
    expect(siteView.contains(badge)).toBe(false); // covers: AC-408-2

    // Nessun href in tutta la pagina deriva dal testo libero ostile: il javascript: non e' mai un href.
    const hrefs = [...container.querySelectorAll('[href]')].map((el) => el.getAttribute('href') ?? '');
    for (const value of hrefs) {
      expect(value).not.toContain('javascript:'); // covers: AC-408-2
      expect(value).not.toBe(JS_URL); // covers: AC-408-2
    }
  });

  it('prova strutturale: href = costante statica, un solo href, niente dangerouslySetInnerHTML; la SERVING monta il badge', () => {
    const badgeSrc = readFileSync(BADGE_FILE, 'utf8');
    // L'href e' una COSTANTE del modulo, e la costante e' l'URL di Belora (mai testo del documento).
    expect(badgeSrc).toContain("const BELORA_BADGE_URL = 'https://belora.app'"); // covers: AC-408-2
    expect(badgeSrc).toContain('href={BELORA_BADGE_URL}'); // covers: AC-408-2
    // Un SOLO href nel file: nessun altro attributo di URL da qualsiasi altra fonte.
    expect((badgeSrc.match(/href=/g) ?? []).length).toBe(1); // covers: AC-408-2
    // Nessun innerHTML grezzo: il testo e' un figlio React (escaping preservato).
    expect(badgeSrc).not.toContain('dangerouslySetInnerHTML'); // covers: AC-408-2
    // Il badge non legge lo snapshot pubblicato: non importa il seam di dato del documento.
    expect(badgeSrc).not.toContain('@/data/public-site'); // covers: AC-408-2

    // La rotta (src/app), non il documento, monta il badge.
    const pageSrc = codeOf(PAGE_FILE);
    expect(pageSrc).toContain('BeloraBadge'); // covers: AC-408-2
    expect(pageSrc).not.toContain('dangerouslySetInnerHTML'); // covers: AC-408-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-408-3 — >1 sito con locale DISCORDANTI (it, es): il badge appare nel locale della RIGA di
// ciascun sito, non in quello del browser.
// ─────────────────────────────────────────────────────────────────────────────
describe('AC-408-3 — il badge e nel locale della RIGA di ciascun sito (non del browser)', () => {
  it('NON-VACUITA: il testo del badge differisce fra it ed es', () => {
    // Se i due cataloghi dessero la stessa stringa, l'asserzione di locale sotto sarebbe vuota.
    expect(itMessages.site.badge).not.toBe(esMessages.site.badge); // covers: AC-408-3
  });

  it('riga it -> badge it; riga es -> badge es: guidato SOLO dalla riga', async () => {
    // Riga italiana: badge nel catalogo IT, non in quello ES.
    const it = await renderPage(SLUG_IT);
    const itLink = servingBadge(it.container)!.querySelector('a') as HTMLAnchorElement;
    expect(itLink.textContent).toBe(itMessages.site.badge); // covers: AC-408-3
    expect(itLink.textContent).not.toBe(esMessages.site.badge); // covers: AC-408-3
    cleanup();

    // Lo STESSO codice su una riga spagnola: badge nel catalogo ES. Nessun input di locale del
    // browser esiste su questa strada — due righe, due locale, guidati solo dalla riga.
    const es = await renderPage(SLUG_ES);
    const esLink = servingBadge(es.container)!.querySelector('a') as HTMLAnchorElement;
    expect(esLink.textContent).toBe(esMessages.site.badge); // covers: AC-408-3
    expect(esLink.textContent).not.toBe(itMessages.site.badge); // covers: AC-408-3

    // L'href resta identico e statico fra i due locale: solo il TESTO segue la riga.
    expect(itLink.getAttribute('href')).toBe(EXPECTED_BADGE_URL); // covers: AC-408-3
    expect(esLink.getAttribute('href')).toBe(itLink.getAttribute('href')); // covers: AC-408-3
  });
});
