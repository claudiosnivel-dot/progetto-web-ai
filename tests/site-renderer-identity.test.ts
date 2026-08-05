// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import itMessages from '../messages/it.json';
import { RECIPES } from '@/domain/generation/recipes';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { parseDocument, type SiteBlock, type SiteDocument } from '@/domain/generation/document';

// T-232 / T-235 (macrotask generation-ui, P2) — RINFORZO dell'ORACOLO di AC-232-1 (IDENTITA' DEL
// RENDERER). Le asserzioni derivano da AC-232-1 (04-generation-ui.md), taggate `// covers: AC-232-1`
// sulla riga dell'EXPECT.
//
// PERCHE' QUESTO FILE ESISTE, cioe' cosa l'oracolo di tests/generation-chooser.test.ts NON prova.
// La', AC-232-1 confronta la sequenza di id-blocco di `VariantCard` con quella di `SiteView`
// invocato DIRETTAMENTE sullo STESSO documento risolto. E' f(x) vs f(x): entrambe le strade
// chiamano lo stesso modulo sullo stesso oggetto, quindi il confronto e' vero per COSTRUZIONE e non
// puo' cadere. Due buchi ne restano scoperti:
//   1. L'ANTEPRIMA REALE non e' mai montata. La PreviewPage (T-235) LEGGE il documento CONGELATO dal
//      DB (readGenerationDocument) e lo compone a piena pagina; quel percorso — quello che l'utente
//      vede davvero — non entra in alcuna asserzione. Una divergenza introdotta LI' (ordine dei
//      blocchi invertito, un wrapper diverso, un secondo renderer) resterebbe verde, perche' il
//      confronto e' fra VariantCard e SiteView-diretto, non fra VariantCard e la pagina.
//   2. L'oracolo osserva la sola SEQUENZA di `data-block-id`. Un renderer PARALLELO dentro VariantCard
//      — un `dangerouslySetInnerHTML` con le stesse ancore, o una mappa a mano dei componenti dei
//      blocchi — riprodurrebbe quelle stringhe e passerebbe. La classe di difetto "la card non
//      somiglia al sito scelto" tornerebbe rappresentabile.
//
// I DUE ORACOLI DI QUESTO FILE chiudono i due buchi, ciascuno con la sua PROBE che oggi e' verde e
// diventa rossa alla mutazione:
//   (a) IMPORT-GUARD STATICO — pinna che SIA VariantCard SIA la PreviewPage REALE rendano attraverso
//       il renderer UNICO (`@/ui/site/SiteView`, o `renderBlock` del registry), MAI un render inline
//       dei blocchi. Probe rossa: sostituire in una delle due un `dangerouslySetInnerHTML`, un import
//       diretto di un componente di `@/ui/site/blocks/**`, o un secondo modulo-renderer → la guardia
//       cade. La tabella delle FORME prova che il predicato discrimina (non e' un `true` costante).
//   (b) EFFETTO — monta la PreviewPage REALE su un documento CONGELATO multi-pagina (readGenerationDocument
//       mockato) e confronta la sequenza `data-block-id` della SOLA home dell'anteprima con quella
//       della VariantCard della stessa variante, risolta sullo STESSO pool/brief. Devono coincidere.
//       Probe rossa: far comporre all'anteprima i blocchi della home in ordine INVERSO (o con un
//       wrapper che non emette `data-block-id`) → il confronto cade; oggi resta verde.
//
// I due oracoli sono COMPLEMENTARI: (b) prende una divergenza di COMPORTAMENTO nella pagina (ordine,
// wrapper) ma non un renderer parallelo che riproduce fedelmente le ancore; (a) rende quel renderer
// parallelo STRUTTURALMENTE irrappresentabile. Insieme fanno di "un solo renderer" una proprieta'
// invece di una speranza (security_note di AC-232-1, DoD T-232 "nessun renderer parallelo").
//
// COSA SI MOCKA E PERCHE' NON E' HOLLOW (come in generation-preview.test / generation-chooser.test):
//  - next/navigation: redirect/notFound con throw-sentinel, come in produzione.
//  - next-intl/server getTranslations: risolve dal catalogo REALE it (namespace 'preview' per la
//    guardia, 'site' per la navigazione e i blocchi). Le etichette sono autentiche.
//  - @/data/supabase-ssr getUser, @/data/sites listSites: i seam d'ingresso della guardia.
//  - @/data/generation-document readGenerationDocument: la lettura del DOCUMENTO congelato. Il
//    renderer (SiteView, registry, blocchi, parseDocument) NON e' mockato: rende per davvero.
//  VariantCard NON ha seam di dato — riceve pool/ricetta/brief per prop — quindi non serve mockarne.

// ── mock: la navigazione (throw-sentinel come in produzione) ──────────────────
const { redirectSpy, notFoundSpy } = vi.hoisted(() => {
  const redirectSentinel = Symbol('redirect');
  const notFoundSentinel = Symbol('not-found');
  return {
    REDIRECT: redirectSentinel,
    NOT_FOUND: notFoundSentinel,
    redirectSpy: vi.fn(() => {
      throw redirectSentinel;
    }),
    notFoundSpy: vi.fn(() => {
      throw notFoundSentinel;
    }),
  };
});
vi.mock('next/navigation', () => ({ redirect: redirectSpy, notFound: notFoundSpy }));

// getTranslations REALE dal catalogo it: risolve il path puntato dentro il namespace richiesto, e
// una chiave assente ricade sul proprio path (cosi' un blocco senza etichetta non fa cadere il
// render). Copre 'preview' (guardia) e 'site' (navigazione + blocchi).
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { locale: string; namespace: string }) => {
    const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

const { authHolder } = vi.hoisted(() => ({ authHolder: { user: null as { id: string } | null } }));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { docHolder, readDocumentSpy } = vi.hoisted(() => {
  const holder = { result: { ok: true, document: null } as unknown };
  return { docHolder: holder, readDocumentSpy: vi.fn(async () => holder.result) };
});
vi.mock('@/data/generation-document', () => ({ readGenerationDocument: readDocumentSpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import PreviewPage from '@/app/[locale]/preview/[siteId]/page';
import { VariantCard } from '@/ui/generation/VariantCard';
import { resolveVariantHome } from '@/domain/generation/variant-document';

// ── fixture di dominio (le stesse di generation-chooser.test, verbatim) ───────
// Brief RICCO: sette blocchi di home esistono, quindi la direzione compone una home di piu' blocchi.
// Valori DISCORDANTI: due chiavi orario diverse, tre offerte di cui una il PREFISSO di un'altra.
const RICH_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Trattoria Aurora',
  vertical: 'ristorazione',
  description: 'Cucina di mercato nel centro storico, aperta dal 1980.',
  whatsapp: '+39 333 4445566',
  phone: '+39 06 5551234',
  address: 'Via Verdi 12, Roma',
  hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
  offerings: [
    { name: 'Antipasto', section: 'Cucina' },
    { name: 'Antipasto della casa', section: 'Cucina' },
    { name: 'Dolce', section: 'Dessert' },
  ],
}).brief;

// Un pool 'home' che riempie TUTTI gli slot dei blocchi della home con valori DISCORDANTI, cosi'
// nessun blocco viene scartato da `resolve` e la home rende la propria sequenza intera. Gli id di
// slot portano la coppia PREFISSO del catalogo ('hero_title' e' prefisso di 'hero_title_kicker').
function homePool(firma: string): { pages: { home: Record<string, unknown> } } {
  return {
    pages: {
      home: {
        hero_title_kicker: `Occhiello ${firma}`,
        hero_title: `Titolo hero ${firma}`,
        hero_subtitle: `Sottotitolo hero ${firma}`,
        offerings_title: `Le nostre offerte ${firma}`,
        offerings_intro: `Introduzione alle offerte ${firma}`,
        about_title: `Chi siamo ${firma}`,
        about_body: `La nostra storia ${firma}`,
        about_points: [`Primo punto ${firma}`, `Secondo punto ${firma}`],
        hours_title: `I nostri orari ${firma}`,
        hours_intro: `Nota sugli orari ${firma}`,
        contact_title: `Contattaci ${firma}`,
        contact_intro: `Scrivici per informazioni ${firma}`,
        faq_title: `Domande frequenti ${firma}`,
        faq_items: [
          { question: `Prima domanda ${firma}?`, answer: `Prima risposta ${firma}` },
          { question: `Seconda domanda ${firma}?`, answer: `Seconda risposta ${firma}` },
        ],
        whatsapp_cta_title: `Scrivici su WhatsApp ${firma}`,
      },
    },
  };
}

const SHARED_POOL = homePool('condiviso');

// Un blocco hero minimo ma VALIDO (parseDocument lo accetta), per le pagine INTERNE del documento
// congelato — quelle che la fase 2 aggiunge alla home congelata dalla fase 1.
function heroBlock(title: string): SiteBlock {
  return {
    id: 'hero',
    content: { hero_title: title },
    data: {},
    brief_fields_rendered: [],
    images: [],
  };
}

const SITE_ID = 'site-of-a';
const OWNED_SITES = [{ id: SITE_ID, name: 'Officina di A', slug: 'officina-di-a', status: 'draft' }];

/** La sequenza degli id-blocco resi (in ordine di DOM) sotto `root`, da `data-block-id` (SiteSection). */
function blockSeq(root: ParentNode): string[] {
  return [...root.querySelectorAll('[data-block-id]')].map(
    (el) => (el as HTMLElement).getAttribute('data-block-id') ?? '',
  );
}

/**
 * La sequenza degli id-blocco della SOLA pagina home. Il selettore e' un match ESATTO
 * (`[data-site-page="home"]`), non un prefisso: una pagina 'home-storia' NON vi cade dentro, ed e'
 * cio' che rende il confronto un confronto sulla home e non su tutto il documento.
 */
function homeBlockSeq(root: ParentNode): string[] {
  return [...root.querySelectorAll('[data-site-page="home"] [data-block-id]')].map(
    (el) => (el as HTMLElement).getAttribute('data-block-id') ?? '',
  );
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  docHolder.result = { ok: true, document: null };
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  listSitesSpy.mockClear();
  readDocumentSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) IMPORT-GUARD STATICO: card e anteprima passano dal renderer UNICO, mai inline.
// ─────────────────────────────────────────────────────────────────────────────

// I DUE renderer UNICI ammessi (P2-D8): SiteView sull'intero documento, o renderBlock del registry.
// Un file "passa dal renderer unico" se IMPORTA uno di questi simboli dal suo modulo canonico E lo
// USA (un import morto non conta). La coppia modulo+simbolo e' verificata per UGUAGLIANZA del
// modulo, cosi' '@/ui/site/SiteViewInline' non si spaccia per '@/ui/site/SiteView'.
const RENDERER_CANONICI = [
  { modulo: '@/ui/site/SiteView', simbolo: 'SiteView' },
  { modulo: '@/ui/site/registry', simbolo: 'renderBlock' },
] as const;

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function importaSimboloDa(source: string, simbolo: string, modulo: string): boolean {
  return new RegExp(
    `import\\s*(?:type\\s+)?\\{[^}]*\\b${simbolo}\\b[^}]*\\}\\s*from\\s*['"]${esc(modulo)}['"]`,
  ).test(source);
}

function usaSimbolo(source: string, simbolo: string): boolean {
  // Forma chiamata `X(` (Server Component invocato come funzione) o forma JSX `<X`.
  return new RegExp(`\\b${simbolo}\\s*\\(`).test(source) || new RegExp(`<${simbolo}[\\s/>]`).test(source);
}

function passaDalRendererUnico(source: string): boolean {
  return RENDERER_CANONICI.some(
    ({ modulo, simbolo }) => importaSimboloDa(source, simbolo, modulo) && usaSimbolo(source, simbolo),
  );
}

/** La forma di render INLINE dei blocchi, se presente: il verso in cui la guardia cade. */
function renderInline(source: string): 'INLINE:dangerouslySetInnerHTML' | 'INLINE:import-blocco' | null {
  // A03:2025 (XSS): il bypass dell'escape di React. Vietato sotto src/ui/site/** (AC-231-4); qui la
  // ragione e' la DIVERGENZA di render, ma il segnale e' lo stesso.
  if (source.includes('dangerouslySetInnerHTML')) return 'INLINE:dangerouslySetInnerHTML';
  // Un componente di blocco importato DIRETTAMENTE salta il registry: e' il render parallelo.
  if (/from\s*['"]@\/ui\/site\/blocks/.test(source)) return 'INLINE:import-blocco';
  return null;
}

/**
 * IL VERDETTO su un sorgente. L'ordine conta: un render inline e' una violazione ANCHE se il file
 * tiene un import (morto) del renderer unico — cosi' un `import { SiteView }` lasciato li' non
 * lava un `dangerouslySetInnerHTML` accanto.
 */
function verdettoRenderer(source: string): string {
  const inline = renderInline(source);
  if (inline) return inline;
  return passaDalRendererUnico(source) ? 'RENDERER-UNICO' : 'RENDERER-PARALLELO';
}

// I DUE deliverable che devono passare dal renderer unico: la card del selettore e la pagina
// dell'anteprima. I percorsi con [locale]/[siteId] sono letterali sul filesystem.
const RENDERER_SOURCES = [
  { label: 'src/ui/generation/VariantCard.tsx', rel: '../src/ui/generation/VariantCard.tsx' },
  { label: 'src/app/[locale]/preview/[siteId]/page.tsx', rel: '../src/app/[locale]/preview/[siteId]/page.tsx' },
] as const;

// LE FORME, con l'esito atteso di ciascuna — la contro-prova che il verdetto DISCRIMINA e non e' un
// 'RENDERER-UNICO' costante. Fixture VIRTUALI (stringhe): un secondo renderer VERO su disco sarebbe
// dead-code per il controllo di P2-D26. Ci sono righe BUONE e righe di VIOLAZIONE, e con soli
// positivi un predicato che dicesse sempre 'RENDERER-UNICO' passerebbe.
const FORME_DEL_RENDERER: readonly (readonly [string, string, string])[] = [
  [
    'passa da SiteView',
    "import { SiteView } from '@/ui/site/SiteView';\nexport async function C(){ return await SiteView({}); }\n",
    'RENDERER-UNICO',
  ],
  [
    'passa da renderBlock del registry',
    "import { renderBlock } from '@/ui/site/registry';\nexport async function C(b){ return await renderBlock(b, 'it'); }\n",
    'RENDERER-UNICO',
  ],
  [
    'inline: mappa a mano i componenti dei blocchi',
    "import { Hero } from '@/ui/site/blocks/Hero';\nexport function C(){ return <Hero />; }\n",
    'INLINE:import-blocco',
  ],
  [
    'inline: dangerouslySetInnerHTML',
    'export function C({ html }){ return <div dangerouslySetInnerHTML={{ __html: html }} />; }\n',
    'INLINE:dangerouslySetInnerHTML',
  ],
  [
    'renderer PARALLELO importato al posto di SiteView',
    "import { SiteViewInline } from '@/ui/site/SiteViewInline';\nexport async function C(){ return await SiteViewInline({}); }\n",
    'RENDERER-PARALLELO',
  ],
  [
    'import di SiteView MORTO accanto a un render inline',
    "import { SiteView } from '@/ui/site/SiteView';\nimport { Hero } from '@/ui/site/blocks/Hero';\nexport function C(){ return <Hero />; }\n",
    'INLINE:import-blocco',
  ],
];

describe('AC-232-1 (a) import-guard: card e anteprima passano dal renderer UNICO, mai inline', () => {
  it('il verdetto discrimina ogni forma di render, e nessuna forma che render-unico non e', () => {
    // Anti-vacuita': la tabella ha righe BUONE e righe di VIOLAZIONE.
    expect(FORME_DEL_RENDERER.filter(([, , atteso]) => atteso === 'RENDERER-UNICO').length).toBeGreaterThan(1);
    expect(FORME_DEL_RENDERER.filter(([, , atteso]) => atteso !== 'RENDERER-UNICO').length).toBeGreaterThan(2);

    const osservato = FORME_DEL_RENDERER.map(([forma, source]) => `${forma}: ${verdettoRenderer(source)}`);
    const atteso = FORME_DEL_RENDERER.map(([forma, , esito]) => `${forma}: ${esito}`);
    expect(osservato).toEqual(atteso);
  });

  // covers: AC-232-1
  it('VariantCard e la PreviewPage reale rendono ENTRAMBE dal renderer unico (nessun render inline)', () => {
    const osservato = RENDERER_SOURCES.map(({ label, rel }) => {
      const source = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      return `${label}: ${verdettoRenderer(source)}`;
    });
    // then: entrambi i deliverable passano dal renderer unico. Probe rossa: un dangerouslySetInnerHTML,
    // un import di @/ui/site/blocks/**, o un secondo modulo-renderer in UNO dei due fa cadere la sua riga.
    const atteso = RENDERER_SOURCES.map(({ label }) => `${label}: RENDERER-UNICO`);
    expect(osservato).toEqual(atteso); // covers: AC-232-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) EFFETTO: la home dell'ANTEPRIMA REALE == la card della stessa variante.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-232-1 (b) effetto: la home dell anteprima reale coincide con la card scelta', () => {
  // covers: AC-232-1
  it('anteprima REALE su documento congelato multi-pagina: la sua home ha la sequenza id-blocco della card', async () => {
    // given: la variante 0 risolta sul pool/brief — cio' che la card mostra e cio' che T-233 CONGELA
    // come home (una pagina sola, ruolo 'home').
    const recipe = RECIPES[0];
    const resolved = resolveVariantHome(SHARED_POOL, recipe, RICH_BRIEF);
    expect(resolved).not.toBeNull();
    const homePage = resolved!.document.pages[0];
    expect(homePage.role).toBe('home'); // covers: AC-232-1
    expect(homePage.slug).toBe('home'); // covers: AC-232-1

    // Il DOCUMENTO CONGELATO come vive nel DB dopo la fase 2: la home risolta piu' le pagine interne.
    // Trappola del PREFISSO: 'home-storia' ha 'home' come prefisso — un ritaglio della home per
    // prefisso prenderebbe due pagine per una, e la sequenza si gonfierebbe.
    const frozen: SiteDocument = {
      recipe_id: resolved!.document.recipe_id,
      theme_id: resolved!.theme.id,
      pages: [
        homePage,
        { slug: 'home-storia', role: 'contact', title: 'La nostra storia', meta_description: 'Chi siamo', blocks: [heroBlock('La storia')] },
        { slug: 'contatti', role: 'reviews', title: 'I contatti', meta_description: 'Come trovarci', blocks: [heroBlock('Scrivici')] },
      ],
    };
    // Sanity: il documento congelato e' VALIDO (altrimenti l'anteprima renderebbe lo stato vuoto).
    expect(parseDocument(frozen).ok).toBe(true);
    docHolder.result = { ok: true, document: frozen };

    // when: monto la PreviewPage REALE — LEI legge il documento congelato (readGenerationDocument) e
    // lo compone a piena pagina. Non e' SiteView invocato a mano: e' la pagina che l'utente vede.
    const previewUi = await PreviewPage({ params: Promise.resolve({ locale: 'it', siteId: SITE_ID }) });
    const previewContainer = document.createElement('div');
    render(previewUi, { container: previewContainer });
    expect(readDocumentSpy).toHaveBeenCalledWith(SITE_ID); // covers: AC-232-1

    // when: rendo la CARD della stessa variante sullo STESSO pool/brief.
    const cardUi = await VariantCard({ pool: SHARED_POOL, recipe, brief: RICH_BRIEF, locale: 'it', variantIndex: 0 });
    const cardContainer = document.createElement('div');
    render(cardUi, { container: cardContainer });

    const previewHome = homeBlockSeq(previewContainer);
    const cardHome = homeBlockSeq(cardContainer);

    // Anti-vacuita': la home ha PIU' blocchi (una reversal e' osservabile) e non e' un palindromo,
    // quindi la probe "ordine invertito nell'anteprima" e' davvero distinguibile.
    expect(cardHome.length).toBeGreaterThan(1); // covers: AC-232-1
    expect([...cardHome].reverse()).not.toEqual(cardHome);

    // L'anteprima e' davvero MULTI-PAGINA e il selettore RITAGLIA la sola home: ci sono blocchi anche
    // fuori (le pagine interne), quindi la home e' un SOTTOINSIEME — la trappola del prefisso non l'ha
    // gonfiata (se lo avesse, `homeBlockSeq` porterebbe anche l'hero di 'home-storia').
    expect(previewContainer.querySelectorAll('[data-site-page]')).toHaveLength(3);
    expect(blockSeq(previewContainer).length).toBeGreaterThan(previewHome.length);
    expect(previewHome.length).toBe(cardHome.length); // covers: AC-232-1

    // IL CUORE: la home dell'anteprima REALE e la card coincidono, blocco per blocco e in ordine —
    // cio' che l'utente scegle e' cio' che ottiene. Probe rossa: comporre la home dell'anteprima in
    // ordine inverso (o con un wrapper senza `data-block-id`) rompe questa riga; oggi e' verde.
    expect(previewHome).toEqual(cardHome); // covers: AC-232-1
    expect(previewHome[0]).toBe('hero'); // covers: AC-232-1
  });
});
