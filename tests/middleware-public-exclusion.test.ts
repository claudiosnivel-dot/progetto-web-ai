import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// T-406 — Il middleware UNICO deve ESCLUDERE /s/* dal routing per locale.
// /s/<slug> è la rotta pubblica STANDALONE (P4-D4): 's' è uno slug RISERVATO,
// mai un locale. Qui MOCKIAMO due cuciture per osservare la DECISIONE, non la
// negoziazione reale di next-intl:
//  - next-intl `createMiddleware` → una spia (`handleI18n`): così vediamo se il
//    "locale middleware" viene invocato o NO per un dato path (AC-406-1/2/3).
//  - `getUserFromRequest` (@/data/supabase-ssr) → per non toccare Supabase (le
//    rotte di controllo qui sono pubbliche e non attivano la guardia, ma la
//    cucitura resta mockata per isolamento).
const { createMiddlewareMock, handleI18nSpy, getUserFromRequestMock } = vi.hoisted(() => {
  const handleI18nSpy = vi.fn();
  return {
    handleI18nSpy,
    // createMiddleware(routing) → restituisce la spia: nel modulo diventa handleI18n.
    createMiddlewareMock: vi.fn(() => handleI18nSpy),
    getUserFromRequestMock: vi.fn(),
  };
});

vi.mock('next-intl/middleware', () => ({ default: createMiddlewareMock }));
vi.mock('@/data/supabase-ssr', () => ({ getUserFromRequest: getUserFromRequestMock }));

// Import DOPO i mock (vi.mock è hoisted). Importiamo il default (funzione reale),
// il predicato di esclusione e `config`/`routing` per le proprietà osservabili.
import middleware, { isPublicStandalonePath, config } from '@/middleware';
import { routing } from '@/i18n/routing';

const run = (pathname: string, headers?: Record<string, string>) =>
  middleware(
    new NextRequest(
      new URL(pathname, 'http://localhost'),
      headers ? { headers } : undefined,
    ),
  );

// Fixture DISCIPLINATA: più elementi, valori DISCORDANTI, e uno slug che è
// PROPER PREFIX di un altro (`shop` ⊂ `shop-two`) → prova il confine ESATTO
// `/s/…`, non un match per prefisso lasco. Include un sotto-path `/s/<slug>/<sub>`
// e uno slug che ASSOMIGLIA a un locale (`/s/it`) per provare che 's' non è una
// lingua e che il segmento dopo `/s` non viene negoziato come locale.
const PATH_STANDALONE = [
  '/s', // radice del prefisso pubblico
  '/s/shop', // slug semplice
  '/s/shop-two', // `shop` è PROPER PREFIX di `shop-two`
  '/s/shop/menu', // sotto-path /s/<slug>/<sub>
  '/s/pizzeria-da-mario', // slug discordante
  '/s/it', // slug che SEMBRA un locale (non deve essere trattato come lingua)
];

// Controllo NON vacuo: rotte che DEVONO ancora passare al locale middleware.
// '/support' e '/services' iniziano per 's' ma NON sono sotto `/s/` → l'esclusione
// non deve catturarle (confine esatto). '/' e '/editor' sono l'esempio delle AC.
const PATH_LOCALE = ['/', '/editor', '/it/login', '/support', '/services'];

describe('T-406 middleware: /s/* escluso dal routing per locale', () => {
  beforeEach(() => {
    handleI18nSpy.mockReset();
    // Il locale middleware, quando invocato, restituisce un passthrough: ci basta
    // osservare SE viene chiamato, non il suo output.
    handleI18nSpy.mockReturnValue(NextResponse.next());
    getUserFromRequestMock.mockReset();
    getUserFromRequestMock.mockResolvedValue(null);
  });

  // AC-406-1 — /s/<slug> con Accept-Language ≠ locale del sito: nessun redirect,
  // nessun prefisso di locale, l'URL resta /s/<slug>. La negoziazione Accept-Language
  // vive dentro handleI18n: se non viene invocato, l'header è ignorato per costruzione.
  it('AC-406-1: /s/<slug> con Accept-Language diverso non viene rediretto né prefissato di locale', async () => {
    // given: Accept-Language 'es' (≠ locale del sito 'it'); when: GET /s/shop
    const res = await run('/s/shop', { 'accept-language': 'es-ES,es;q=0.9' });
    // then: nessun redirect (niente Location, status ≠ 307) → l'URL resta /s/shop
    expect(res.headers.get('location')).toBeNull(); // covers: AC-406-1
    expect(res.status).not.toBe(307); // covers: AC-406-1
    // e la negoziazione di locale non è nemmeno stata invocata (Accept-Language ignorato)
    expect(handleI18nSpy).not.toHaveBeenCalled(); // covers: AC-406-1
  });

  // AC-406-2 — Le rotte localizzate senza prefisso (home `/`, `/editor`) sono ancora
  // gestite dal locale middleware: l'esclusione /s NON introduce regressioni.
  it('AC-406-2: una rotta localizzata senza prefisso è ancora gestita dal locale middleware (nessuna regressione)', async () => {
    expect(PATH_LOCALE.length).toBeGreaterThan(0); // anti-vacuità
    for (const p of PATH_LOCALE) {
      handleI18nSpy.mockClear();
      await run(p);
      // then: il locale middleware viene invocato ESATTAMENTE come prima, sul path reale
      expect(handleI18nSpy, p).toHaveBeenCalledTimes(1); // covers: AC-406-2
      expect(handleI18nSpy, p).toHaveBeenCalledWith(expect.anything()); // covers: AC-406-2
    }
  });

  // AC-406-3 — Nessun path sotto /s/* è intercettato dal locale middleware; ogni
  // rotta localizzata sì. La decisione è OSSERVABILE via la spia su handleI18n.
  it('AC-406-3: nessun path /s/* è intercettato dal locale middleware; le rotte localizzate sì', async () => {
    expect(PATH_STANDALONE.length).toBeGreaterThan(1); // fixture ≥ 2 elementi + anti-vacuità

    for (const p of PATH_STANDALONE) {
      handleI18nSpy.mockClear();
      const res = await run(p);
      // il locale middleware NON viene mai invocato per /s/* → 's' non è mai un locale
      expect(handleI18nSpy, p).not.toHaveBeenCalled(); // covers: AC-406-3
      // e nessun redirect (nessun prefisso di locale aggiunto)
      expect(res.headers.get('location'), p).toBeNull(); // covers: AC-406-3
    }

    // Falsificabilità: per le rotte localizzate la spia VIENE invocata (esclusione non vacua)
    for (const p of PATH_LOCALE) {
      handleI18nSpy.mockClear();
      await run(p);
      expect(handleI18nSpy, p).toHaveBeenCalledTimes(1); // covers: AC-406-3
    }
  });

  // AC-406-3 (proprietà pura) — 's' è slug RISERVATO, mai un locale; il predicato di
  // esclusione cattura ESATTAMENTE /s e /s/* e NIENT'altro. Costruito dal predicato
  // ESPORTATO dal modulo (mai da una copia), così la mutazione lo prende.
  it("AC-406-3: 's' non è un locale; il predicato cattura /s e /s/* e nient'altro (confine esatto)", () => {
    // 's' non è tra i locali supportati (P4-D4): il middleware non deve mai trattarlo come lingua
    expect(routing.locales).not.toContain('s'); // covers: AC-406-3
    expect(routing.locales.length).toBeGreaterThan(0); // anti-vacuità

    // VERO esattamente per /s e i suoi sotto-path (inclusi slug che sembrano locale)
    for (const p of PATH_STANDALONE) {
      expect(isPublicStandalonePath(p), p).toBe(true); // covers: AC-406-3
    }
    // FALSO per le rotte localizzate, per i path che iniziano per 's' ma non sono /s/*,
    // e per i path localizzati protetti: il confine è ESATTO, non un match per prefisso.
    for (const p of [
      ...PATH_LOCALE,
      '/it/dashboard',
      '/es/preview/x',
      '/sitemap',
      '/s-extra', // inizia per '/s' ma NON è '/s' né sotto '/s/'
    ]) {
      expect(isPublicStandalonePath(p), p).toBe(false); // covers: AC-406-3
    }
  });

  // SECURITY (A05:2025) — Escludere /s/* dal locale NON deve escluderlo dalla
  // sicurezza: /s/* resta DENTRO config.matcher, quindi il middleware CONTINUA a
  // girare su quel path (può applicare le protezioni globali). Costruito dal
  // `config.matcher` ESPORTATO dal modulo: una mutazione che togliesse /s dal
  // matcher (spegnendo il middleware sul path pubblico) lo renderebbe rosso.
  it('SECURITY: /s/* resta nel perimetro di config.matcher (esclude solo il locale, non la sicurezza)', () => {
    const matcherRegexes = config.matcher.map((pattern) => new RegExp(`^${pattern}$`));
    const inPerimeter = (pathname: string) => matcherRegexes.some((re) => re.test(pathname));
    for (const p of ['/s', '/s/shop', '/s/shop/menu', '/s/pizzeria-da-mario']) {
      // security_note: il middleware deve continuare ad applicare le protezioni
      // globali sul path pubblico — esclude SOLO il locale, non la sicurezza.
      expect(inPerimeter(p), p).toBe(true); // covers: AC-406-3 (installazione)
    }
  });
});
