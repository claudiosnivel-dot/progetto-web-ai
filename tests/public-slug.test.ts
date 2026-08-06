import { describe, it, expect } from 'vitest';
import {
  RESERVED_PUBLIC_SLUGS,
  isReservedSlug,
  generateUniquePublicSlug,
  validatePublicSlug,
} from '@/domain/sites/public-slug';
import { SLUG_MAX_LENGTH } from '@/domain/sites/slug';

// T-402 — logica di dominio PURA (nessun DB): generazione/dedup/riservati/validazione
// del public_slug. Le asserzioni derivano dagli acceptance_criteria AC-402-1..5 del
// blueprint (docs/blueprint/P4-publish/01-publish-core.md). Funzioni deterministiche →
// ambiente node, nessun mock: exists è iniettato come Set/funzione INLINE nel test.
// Il lato ATTESO di ogni expect è un letterale/valore calcolato a mano nel test, mai il
// binding importato dall'implementazione (nessuna tautologia). La forma canonica dello
// slug pubblico è scritta come regex-letterale QUI, indipendente dall'impl.

const PUBLIC_SLUG_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// I riservati richiesti dal DoD, come lista-LETTERALE indipendente: guida sia il match
// esatto sia il cross-check contro la costante esportata. 's' è (di proposito) prefisso
// di 'signup'/'sitemap'/'static' → trappola-prefisso interna al dominio dei riservati.
const REQUIRED_RESERVED = [
  's',
  'api',
  'admin',
  'auth',
  'login',
  'logout',
  'signup',
  'dashboard',
  'editor',
  'preview',
  'sitemap',
  'robots',
  'static',
  '_next',
  'www',
];

describe('T-402 generateUniquePublicSlug — forma URL-safe', () => {
  // covers: AC-402-1
  it('deriva da un business_name con diacritici, spazi e simboli uno slug della forma canonica entro SLUG_MAX_LENGTH', async () => {
    // 'Café München & Söhne!!!' → NFKD+strip+lower → 'cafe munchen & sohne!!!' →
    // [^a-z0-9]+→'-' + collasso + trim bordo → 'cafe-munchen-sohne' (calcolato a mano).
    const slug = await generateUniquePublicSlug('Café München & Söhne!!!', () => false);
    expect(slug).toBe('cafe-munchen-sohne'); // covers: AC-402-1
    expect(PUBLIC_SLUG_SHAPE.test(slug)).toBe(true); // covers: AC-402-1
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH); // covers: AC-402-1

    // Secondo valore discordante: nome lunghissimo → troncato, mai trattino di bordo.
    const longSlug = await generateUniquePublicSlug('Ristorante ' + 'Molto '.repeat(40), () => false);
    expect(PUBLIC_SLUG_SHAPE.test(longSlug)).toBe(true); // covers: AC-402-1
    expect(longSlug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH); // covers: AC-402-1
  });
});

describe('T-402 generateUniquePublicSlug — dedup globale ascendente', () => {
  // covers: AC-402-2
  it("con base e base-2 occupati globalmente ritorna base-3 (match ESATTO, non per prefisso)", async () => {
    // Fixture >1 elemento, valori discordanti, uno slug PREFISSO di un altro: 'trattoria'
    // è prefisso sia di 'trattoria-2' sia di 'trattoria-lunga'. Il predicato exists usa
    // uguaglianza esatta (Set.has): 'trattoria-lunga' occupato NON deve bloccare nulla.
    const taken = new Set(['trattoria', 'trattoria-2', 'trattoria-lunga']);
    const exists = (slug: string) => taken.has(slug);
    expect(await generateUniquePublicSlug('Trattoria', exists)).toBe('trattoria-3'); // covers: AC-402-2
  });

  it('supporta un predicato exists asincrono', async () => {
    const taken = new Set(['osteria']);
    const exists = async (slug: string) => taken.has(slug);
    expect(await generateUniquePublicSlug('Osteria', exists)).toBe('osteria-2');
  });
});

describe('T-402 generateUniquePublicSlug — i riservati sono occupati', () => {
  // covers: AC-402-3
  it("un name che slugifica a un riservato non restituisce MAI il valore nudo, ma un'alternativa suffissata non riservata", async () => {
    // exists sempre false: l'unica ragione di suffisso è il riservato → prova il match esatto
    // su valori discordanti che slugificano a 'admin', 'api', 's'.
    const free = () => false;
    const adminSlug = await generateUniquePublicSlug('Admin', free);
    expect(adminSlug).toBe('admin-2'); // covers: AC-402-3
    expect(isReservedSlug(adminSlug)).toBe(false); // covers: AC-402-3

    const apiSlug = await generateUniquePublicSlug('API', free);
    expect(apiSlug).toBe('api-2'); // covers: AC-402-3
    expect(isReservedSlug(apiSlug)).toBe(false); // covers: AC-402-3

    const sSlug = await generateUniquePublicSlug('S', free);
    expect(sSlug).toBe('s-2'); // covers: AC-402-3
    expect(isReservedSlug(sSlug)).toBe(false); // covers: AC-402-3
  });
});

describe('T-402 isReservedSlug + RESERVED_PUBLIC_SLUGS — match esatto', () => {
  // covers: AC-402-4
  it('è true SOLO per il match esatto di ogni riservato, false per una parola più lunga con lo stesso prefisso', () => {
    for (const word of REQUIRED_RESERVED) {
      expect(isReservedSlug(word)).toBe(true); // covers: AC-402-4
      expect(RESERVED_PUBLIC_SLUGS.has(word)).toBe(true); // covers: AC-402-4
      // Una parola più lunga che contiene il riservato come prefisso NON è riservata
      // (nessun blocco per substring): 'adminzzz', 'szzz', '_nextzzz', …
      expect(isReservedSlug(word + 'zzz')).toBe(false); // covers: AC-402-4
    }
    // Esempio nominato dal blueprint: 'admin' riservato, 'administrator' no.
    expect(isReservedSlug('admin')).toBe(true); // covers: AC-402-4
    expect(isReservedSlug('administrator')).toBe(false); // covers: AC-402-4
    // Uno slug ordinario non è riservato.
    expect(isReservedSlug('trattoria')).toBe(false); // covers: AC-402-4
  });
});

describe('T-402 validatePublicSlug — forma server-side', () => {
  // covers: AC-402-5
  it('rifiuta gli slug non validi e accetta il valido non riservato', () => {
    // Non validi: maiuscole, spazio, simbolo, oltre SLUG_MAX_LENGTH, trattino di bordo
    // (iniziale e finale), un riservato. Valori discordanti, ognuno colpisce un ramo.
    expect(validatePublicSlug('Shop')).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('my shop')).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('shop!')).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('a'.repeat(SLUG_MAX_LENGTH + 1))).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('-shop')).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('shop-')).toBe(false); // covers: AC-402-5
    expect(validatePublicSlug('admin')).toBe(false); // covers: AC-402-5

    // Validi non riservati, incluso il caso-limite di un carattere e una trappola-prefisso
    // ('shop' prefisso di 'shop-two'): la validità NON dipende da relazioni di prefisso.
    expect(validatePublicSlug('trattoria-malaga')).toBe(true); // covers: AC-402-5
    expect(validatePublicSlug('shop')).toBe(true); // covers: AC-402-5
    expect(validatePublicSlug('shop-two')).toBe(true); // covers: AC-402-5
    expect(validatePublicSlug('a')).toBe(true); // covers: AC-402-5
  });
});
