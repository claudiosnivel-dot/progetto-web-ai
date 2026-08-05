import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// T-306 (macrotask editor-core, P3) — Il GEMELLO dell'oracolo di stile per la superficie EDITOR.
// tests/site-blocks-style.test.ts (T-231, AC-231-4) sorveglia src/ui/site/** contro i colori
// LETTERALI (esadecimale, funzioni rgb/hsl) e l'iniezione di HTML grezzo. Ma la modalita editable
// (T-305: EditableText) apre una SECONDA superficie di render, src/ui/editor, che quell'oracolo
// non guarda: un sink pericoloso introdotto qui passerebbe la CI in silenzio (rischio n.1 di P3,
// security_notes T-306). Questo file porta lo STESSO scanner su src/ui/editor.
//
// Le asserzioni derivano dagli acceptance_criteria di 01-editor-core.md (AC-306-1..4), taggate
// `// covers:` sulla riga dell'EXPECT. Test HERMETIC / statico: legge i file dal disco, nessun
// runtime, nessuna auth, nessun DB.
//
// Verifica su TUTTA LA DIRECTORY, non per componente: un file aggiunto dopo (i controlli inline
// di T-307/T-308/T-309) non sfugge al controllo per essere nato dopo che il test era scritto. La
// superficie parte con una sola isola e cresce; la guardia di non-vacuita chiede >0 file (non >1).
//
// FALSIFICABILITA (security_note: "prima di credere al verde, prova che sa diventare rosso"): le
// forme vietate NON compaiono mai LETTERALI in questo file — sono ASSEMBLATE A RUNTIME, cosi lo
// scanner non scatta sul proprio file di test (e un grep di sicurezza sul repo per il sink trova
// solo occorrenze reali). Le stesse funzioni-predicato che scandiscono la superficie reale sono
// riusate contro offender sintetici: il verde e onesto solo se quei predicati sanno diventare rossi.

const EDITOR_DIR = fileURLToPath(new URL('../src/ui/editor', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
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

// ── Lo SCANNER (identico a T-231) ─────────────────────────────────────────────
// `HEX` pretende '#' + 3..8 cifre esadecimali con un confine finale; `RGB`/`HSL` prendono la
// funzione col suo '(' e la variante con alfa. `var(--site-...)` — cio' che la superficie usa
// davvero al posto dei letterali — non contiene '#' ne l'apertura di rgb o hsl, quindi non e' un
// offender per questo scanner.
// Il token del sink di HTML grezzo e' assemblato a runtime: non compare mai letterale nel sorgente.
const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /\brgba?\(/;
const HSL = /\bhsla?\(/;
const DANGEROUS_HTML = ['dangerously', 'SetInnerHTML'].join('');

// I DUE predicati sono l'UNICO scanner: la superficie reale e gli offender sintetici passano di qui.
function hasLiteralColor(source: string): boolean {
  return HEX.test(source) || RGB.test(source) || HSL.test(source);
}
function hasRawHtmlSink(source: string): boolean {
  return source.includes(DANGEROUS_HTML);
}

const files = walk(EDITOR_DIR);

describe('T-306 AC-306 — src/ui/editor sotto lo stesso scanner anti-XSS di src/ui/site', () => {
  it('lo scan trova ALMENO UN file (non passa per vacuita)', () => {
    // Se la superficie fosse vuota o inesistente, offenders sarebbe [] per vacuita e ogni
    // controllo seguente sarebbe verde a vuoto. La superficie editor parte da una isola.
    expect(files.length).toBeGreaterThan(0);
  });

  it('nessun file della superficie editor contiene un colore letterale (hex, rgb, hsl)', () => {
    const offenders = files.filter((file) => hasLiteralColor(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]); // covers: AC-306-2, AC-306-3
  });

  it('nessun file della superficie editor usa l iniezione di HTML grezzo', () => {
    const offenders = files.filter((file) => hasRawHtmlSink(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]); // covers: AC-306-1, AC-306-3
  });

  it('lo scanner e FALSIFICABILE: riconosce il sink di HTML grezzo (assemblato a runtime)', () => {
    // Il sink non compare letterale qui: lo compone a runtime. Lo stesso predicato che scandisce
    // la superficie reale lo riconosce — quindi un sink introdotto in src/ui/editor farebbe ROSSO.
    const offending = '<div ' + DANGEROUS_HTML + '={{ __html: userText }} />';
    expect(hasRawHtmlSink(offending)).toBe(true); // covers: AC-306-1, AC-306-4
    // e non scatta su un'isola pulita che passa il testo come children React:
    expect(hasRawHtmlSink('<span>{children}</span>')).toBe(false); // covers: AC-306-4
  });

  it('lo scanner e FALSIFICABILE: riconosce i colori letterali (assemblati a runtime) e non scatta su var(--site-...)', () => {
    // Ogni forma vietata assemblata a runtime (nessun letterale nel sorgente), valori DISCORDANTI
    // per esercitare OGNI ramo dello scanner (hex 6, hex 3, rgb, rgba, hsl, hsla) e non uno solo.
    expect(hasLiteralColor('color: ' + '#' + 'ffffff')).toBe(true); // covers: AC-306-2, AC-306-4
    expect(hasLiteralColor('color: ' + '#' + 'a1b')).toBe(true); // covers: AC-306-2, AC-306-4
    expect(hasLiteralColor('rgb' + '(12, 34, 56)')).toBe(true); // covers: AC-306-2, AC-306-4
    expect(hasLiteralColor('rgba' + '(0, 0, 0, 0.5)')).toBe(true); // covers: AC-306-2, AC-306-4
    expect(hasLiteralColor('hsl' + '(210, 40%, 30%)')).toBe(true); // covers: AC-306-2, AC-306-4
    expect(hasLiteralColor('hsla' + '(210, 40%, 30%, 0.5)')).toBe(true); // covers: AC-306-2, AC-306-4
    // e NON scatta su cio' che il layer usa davvero al posto dei letterali (nessun falso positivo):
    expect(hasLiteralColor('backgroundColor: "var(--site-color-accent)"')).toBe(false); // covers: AC-306-3, AC-306-4
    expect(hasLiteralColor('fontFamily: "var(--site-font-body)"')).toBe(false); // covers: AC-306-3, AC-306-4
  });

  it('lo scanner e FALSIFICABILE: la PIPELINE di scan (filter) sa diventare rossa, non solo la regex', () => {
    // Prova che il meccanismo completo file->filter->offenders puo' produrre un elenco NON vuoto:
    // e' il ramo che, sulla superficie reale, e' vincolato a toEqual([]). Sorgenti sintetici, tutte
    // le forme assemblate a runtime.
    const clean = 'export const S = () => <span>{children}</span>;';
    const colorOffender = 'const c = "color: ' + '#' + 'ff0000";';
    const sinkOffender = '<i ' + DANGEROUS_HTML + '={{ __html: x }} />';
    const flagged = [clean, colorOffender, sinkOffender].filter(
      (s) => hasLiteralColor(s) || hasRawHtmlSink(s),
    );
    expect(flagged).toEqual([colorOffender, sinkOffender]); // covers: AC-306-1, AC-306-2, AC-306-4
    // e una fonte che usa solo var(--site-...) resta NON segnalata dalla stessa pipeline:
    const varSource = 'style={{ color: "var(--site-color-fg)" }}';
    expect([varSource].filter((s) => hasLiteralColor(s) || hasRawHtmlSink(s))).toEqual([]); // covers: AC-306-3
  });

  it('lo scanner NON si auto-falsa: il file di test stesso e pulito sotto lo scanner', () => {
    // Le forme vietate assemblate a runtime NON lasciano letterali nel sorgente: applicando lo
    // scanner a QUESTO file, entrambi i predicati sono falsi. Prova concreta di "non scatta sul
    // proprio file di test" (AC-306-4). Se un letterale sfuggisse qui, questo test diventerebbe rosso.
    const own = readFileSync(SELF, 'utf8');
    expect(hasLiteralColor(own)).toBe(false); // covers: AC-306-4
    expect(hasRawHtmlSink(own)).toBe(false); // covers: AC-306-4
  });
});
