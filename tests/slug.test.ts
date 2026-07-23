import { describe, it, expect } from 'vitest';
import { slugify, generateUniqueSlug, SLUG_MAX_LENGTH } from '@/domain/sites/slug';

// T-104 — utility di dominio PURA (nessun DB): slugify + generateUniqueSlug.
// Le asserzioni derivano dagli acceptance_criteria AC-104-1..4 del blueprint
// (06-sites.md). Funzioni deterministiche → test in ambiente node, nessun mock.

describe('T-104 slugify', () => {
  // covers: AC-104-1
  it("normalizza diacritici IT/ES, spazi e simboli: 'Trattoria Málaga & Niño' → 'trattoria-malaga-nino'", () => {
    expect(slugify('Trattoria Málaga & Niño')).toBe('trattoria-malaga-nino'); // covers: AC-104-1
  });

  // covers: AC-104-2
  it('produce un fallback non vuoto [a-z0-9-] per input vuoto o di soli spazi (mai stringa vuota)', () => {
    const onlySpaces = slugify('   ');
    const empty = slugify('');
    expect(onlySpaces.length).toBeGreaterThan(0); // covers: AC-104-2
    expect(empty.length).toBeGreaterThan(0); // covers: AC-104-2
    expect(onlySpaces).toMatch(/^[a-z0-9-]+$/); // covers: AC-104-2
    expect(empty).toMatch(/^[a-z0-9-]+$/); // covers: AC-104-2
    // Anche un input fatto SOLO di caratteri fuori dal set (es. simboli/diacritici
    // che decadono a nulla) deve ricadere sul fallback, mai su ''.
    const symbols = slugify('—&$%#—');
    expect(symbols.length).toBeGreaterThan(0); // covers: AC-104-2
    expect(symbols).toMatch(/^[a-z0-9-]+$/); // covers: AC-104-2
  });

  // covers: AC-104-4
  it('tronca a SLUG_MAX_LENGTH senza terminare con un trattino', () => {
    // Slug che, prima del troncamento, cade esattamente su un confine di trattino:
    // 'ab '.repeat(40) → 'ab-ab-...-ab-...' → slice(0,MAX) potrebbe finire con '-'.
    const long = slugify('ab '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH); // covers: AC-104-4
    expect(long.endsWith('-')).toBe(false); // covers: AC-104-4

    // Anche una singola parola lunghissima resta entro il massimo.
    const oneWord = slugify('a'.repeat(SLUG_MAX_LENGTH + 40));
    expect(oneWord.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH); // covers: AC-104-4
    expect(oneWord.endsWith('-')).toBe(false); // covers: AC-104-4
  });
});

describe('T-104 generateUniqueSlug', () => {
  // covers: AC-104-3
  it("con exists true per 'pizzeria' e 'pizzeria-2' e false per 'pizzeria-3' → 'pizzeria-3'", async () => {
    const taken = new Set(['pizzeria', 'pizzeria-2']);
    const exists = (slug: string) => taken.has(slug);
    expect(await generateUniqueSlug('Pizzeria', exists)).toBe('pizzeria-3'); // covers: AC-104-3
  });

  it('restituisce lo slug base quando è libero (nessun suffisso)', async () => {
    const exists = () => false;
    expect(await generateUniqueSlug('Bar Sole', exists)).toBe('bar-sole');
  });

  it('supporta un predicato exists asincrono', async () => {
    const taken = new Set(['bar-sole']);
    const exists = async (slug: string) => taken.has(slug);
    expect(await generateUniqueSlug('Bar Sole', exists)).toBe('bar-sole-2');
  });
});
