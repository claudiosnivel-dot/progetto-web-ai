import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// T-231 (macrotask generation-ui, P2) — AC-231-4: nessun file sotto src/ui/site/** contiene
// un valore di colore LETTERALE (esadecimale, rgb(), hsl()) ne un uso di
// dangerouslySetInnerHTML. La verifica e' su TUTTA LA DIRECTORY e non per componente, cosi'
// un blocco aggiunto dopo (i blocchi di dati di T-237) non sfugge al controllo per essere
// nato dopo che il test era stato scritto (security_notes T-231, OWASP A03:2025). I colori
// arrivano dai token del tema tradotti in `var(--site-...)` alla radice del render, e il
// testo non fidato attraversa solo il percorso di escape di React.

const SITE_DIR = fileURLToPath(new URL('../src/ui/site', import.meta.url));
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (SOURCE.test(full)) found.push(full);
  }
  return found;
}

// Le forme vietate. `HEX` pretende '#' + 3..8 cifre esadecimali con un confine finale, cosi'
// non prende un frammento piu' lungo; `RGB`/`HSL` prendono la funzione col suo '(' e la
// variante con alfa. `var(--site-...)` NON contiene '#', 'rgb(' ne 'hsl(', quindi non e' un
// falso positivo.
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;
const HSL = /\bhsla?\(/;
const DANGEROUS_HTML = ['dangerously', 'SetInnerHTML'].join('');

const files = walk(SITE_DIR);

describe('T-231 AC-231-4 — src/ui/site/** senza colori letterali ne HTML grezzo', () => {
  it('lo scan trova PIU DI UN file (non passa per vacuita)', () => {
    // Piu' di un elemento: la directory ha renderer, involucro, blocchi e helper.
    expect(files.length).toBeGreaterThan(1);
  });

  it('nessun file contiene un colore letterale (hex, rgb(), hsl())', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return HEX.test(source) || RGB.test(source) || HSL.test(source);
    });
    expect(offenders).toEqual([]); // covers: AC-231-4
  });

  it('nessun file usa l iniezione di HTML grezzo', () => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes(DANGEROUS_HTML));
    expect(offenders).toEqual([]); // covers: AC-231-4
  });

  it('il controllo e FALSIFICABILE: gli scanner riconoscono davvero le forme vietate', () => {
    // Valori DISCORDANTI, per provare ogni ramo dello scanner e non uno solo.
    expect(HEX.test('color: #ffffff')).toBe(true); // covers: AC-231-4
    expect(HEX.test('color: #a1b')).toBe(true); // covers: AC-231-4
    expect(RGB.test('rgb(12, 34, 56)')).toBe(true); // covers: AC-231-4
    expect(RGB.test('rgba(0, 0, 0, 0.5)')).toBe(true); // covers: AC-231-4
    expect(HSL.test('hsl(210, 40%, 30%)')).toBe(true); // covers: AC-231-4
    expect(('<div ' + DANGEROUS_HTML + '={{ __html: x }} />').includes(DANGEROUS_HTML)).toBe(true); // covers: AC-231-4
    // e NON scatta su cio' che il layer usa davvero al posto dei letterali:
    expect(HEX.test('backgroundColor: "var(--site-color-accent)"')).toBe(false); // covers: AC-231-4
    expect(RGB.test('fontFamily: "var(--site-font-body)"')).toBe(false); // covers: AC-231-4
  });
});
