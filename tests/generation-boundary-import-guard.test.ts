import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ESLint } from 'eslint';

// T-224 (macrotask generation-llm, P2) — la guardia di lint sul confine COPRE ANCHE il turno
// di generazione (AC-224-7), e non perche' qualcuno l'abbia estesa: perche'
// runGenerationTurn vive nello STESSO file di runOnboardingTurn (P1-D7). E' l'intero
// argomento della decisione, ed e' cio' che questo file rende osservabile — un secondo modulo
// di confine sarebbe un secondo posto da sorvegliare, e la sorveglianza non lo seguirebbe da
// sola.
//
// IL FIXTURE E' VIRTUALE, e non e' una comodita': un file vero sotto src/ui/ che importi il
// confine sarebbe un orfano per il controllo dead-code e romperebbe il build (il confine ha
// "server-only" come prima riga). `lintText` con un `filePath` che non esiste applica alla
// stringa la configurazione di QUEL percorso, che e' esattamente cio' che si vuole misurare.
//
// COSA QUESTO FILE NON RIFA': le dieci forme equivalenti dell'import e i sette layer client
// sono gia' sorvegliati da tests/anthropic-boundary.test.ts (T-131), che e' la sede di quella
// matrice. Qui si prova la cosa che T-224 aggiunge — un import che nomina runGenerationTurn —
// e si pinna la premessa che la rende vera.

const root = process.cwd();
const eslintDelProgetto = new ESLint({ cwd: root });

/** Le due regole con cui il progetto tiene il confine: la meta' statica e quella dinamica. */
const REGOLE_DEL_CONFINE = new Set(['no-restricted-imports', 'no-restricted-syntax']);

/**
 * Gli errori delle regole del confine su un sorgente lintato a un certo percorso.
 *
 * GUARDIA ANTI-PLACEBO: un errore di PARSING ha `ruleId` null e svuoterebbe il filtro, cosi'
 * un fixture che non compila farebbe passare OGNI ramo — compreso quello negativo, che e'
 * quello che conta. Qui il parsing rotto e' rumoroso.
 */
async function erroriDelConfineSu(source: string, percorso: string) {
  const [risultato] = await eslintDelProgetto.lintText(source, {
    filePath: resolve(root, percorso),
  });
  expect(
    risultato.messages.filter((messaggio) => messaggio.fatal === true),
    `errore di PARSING sul fixture di ${percorso}`,
  ).toEqual([]);
  return risultato.messages.filter(
    (messaggio) => messaggio.ruleId !== null && REGOLE_DEL_CONFINE.has(messaggio.ruleId),
  );
}

/**
 * Un sorgente ESPORTA un nome, in QUALUNQUE delle forme in cui lo si puo' esportare.
 *
 * PERCHE' NON BASTA `export function`, misurato in verifica avversariale: la premessa di
 * AC-224-7 cercava soltanto quella forma, e un SECONDO modulo che avvolgesse
 * runGenerationTurn e' sopravvissuto alla suite intera. Le due forme che sfuggivano sono
 * anche le due piu' probabili — `export const nome = async (...) => ...`, che e' come si
 * scrive oggi una funzione, e soprattutto la RIESPORTAZIONE `export { nome } from '...'`, che
 * nasce come comodita' e non come decisione: e' cosi' che un secondo posto da sorvegliare si
 * apre senza che nessuno pensi di aver aperto niente.
 *
 * Il nome e' chiuso da `\b` su ENTRAMBI i lati, e non e' cerimonia: 'runGenerationTurn' e'
 * PREFISSO di 'runGenerationTurnDue', e una ricerca per sottostringa direbbe che il confine e'
 * doppio ogni volta che qualcuno chiama una funzione con un nome piu' lungo.
 */
function esportaIlNome(nome: string, sorgente: string): boolean {
  return new RegExp(
    [
      `export\\s+(?:async\\s+)?function\\s+${nome}\\b`,
      `export\\s+(?:const|let|var|class)\\s+${nome}\\b`,
      `export\\s*\\{[^}]*\\b${nome}\\b[^}]*\\}`,
      `export\\s+default\\s+(?:async\\s+)?(?:function\\s+)?${nome}\\b`,
    ].join('|'),
  ).test(sorgente);
}

/** I moduli di src/** che ESPORTANO una funzione con questo nome. */
function moduliCheEsportano(nome: string, dir = resolve(root, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((voce) => {
    const intero = join(dir, voce.name);
    if (voce.isDirectory()) return moduliCheEsportano(nome, intero);
    if (!/\.tsx?$/.test(voce.name)) return [];
    return esportaIlNome(nome, readFileSync(intero, 'utf8')) ? [intero] : [];
  });
}

/**
 * LE FORME, con l'esito atteso di ciascuna. E' un fixture VIRTUALE come quello del lint: la
 * premessa si prova su stringhe, perche' un secondo confine VERO su disco sarebbe un orfano
 * per il controllo dead-code e romperebbe il build. I casi NEGATIVI valgono quanto i positivi
 * — senza, una ricerca che restituisse sempre `true` passerebbe l'intera tabella.
 */
const FORME_DELL_EXPORT: readonly (readonly [string, string, boolean])[] = [
  ['dichiarazione async', 'export async function runGenerationTurn(turn) { return turn; }\n', true],
  ['dichiarazione', 'export function runGenerationTurn(turn) { return turn; }\n', true],
  ['const con arrow', 'export const runGenerationTurn = async (turn) => turn;\n', true],
  ['riesportazione', "export { runGenerationTurn } from '@/data/anthropic';\n", true],
  ['riesportazione con alias', "import { x } from './x';\nexport { x as runGenerationTurn };\n", true],
  ['default', "import { x } from './x';\nconst runGenerationTurn = x;\nexport default runGenerationTurn;\n", true],
  ['import, non export', "import { runGenerationTurn } from '@/data/anthropic';\n", false],
  ['solo una chiamata', 'const esito = await runGenerationTurn(turno);\n', false],
  ['un nome che lo CONTIENE come prefisso', 'export const runGenerationTurnDue = async () => 1;\n', false],
  ['una riesportazione del nome piu lungo', "export { runGenerationTurnDue } from './due';\n", false],
];

// LE FORME con cui un modulo client puo' raggiungere runGenerationTurn. Sono tre e non una,
// con la `regola` attesa dichiarata forma per forma: l'elenco dice anche CON QUALE
// meccanismo ciascuna e' presa, e la dinamica e' presa da un'altra regola — 'no-restricted-
// imports' non ha alcun handler per ImportExpression.
const FORME_VIETATE = [
  {
    forma: "statica, alias '@/data/anthropic'",
    regola: 'no-restricted-imports',
    source:
      "import { runGenerationTurn } from '@/data/anthropic';\n\nexport const seam = runGenerationTurn;\n",
  },
  {
    forma: "statica, relativa '../data/anthropic'",
    regola: 'no-restricted-imports',
    source:
      "import { runGenerationTurn } from '../data/anthropic';\n\nexport const seam = runGenerationTurn;\n",
  },
  {
    forma: "dinamica, import('@/data/anthropic')",
    regola: 'no-restricted-syntax',
    source:
      "export const carica = async () => (await import('@/data/anthropic')).runGenerationTurn;\n",
  },
];

// I LAYER CLIENT su cui provarle: la UI del builder, il layer del SITO GENERATO (che in flat
// config ridichiara le stesse regole in un blocco PROPRIO, quindi li' il confine puo' cadere
// da solo) e una page di App Router, dove vivono i moduli 'use client' che non stanno sotto
// src/ui/**. Nessuno dei tre e' un file vero.
const PERCORSI_CLIENT = [
  'src/ui/generation/AnteprimaMockup.tsx',
  'src/ui/site/BloccoHero.tsx',
  'src/app/[locale]/anteprima/page.tsx',
];

describe('T-224 la guardia deny-by-default del confine copre anche runGenerationTurn', () => {
  // LA PREMESSA DI AC-224-7, pinnata invece che raccontata: il turno di generazione e'
  // esportato dal confine UNICO e da nessun altro modulo di src/**. E' anche la
  // definition_of_done ("nessun modulo di confine nuovo") — il giorno in cui qualcuno lo
  // spostasse altrove, la guardia di lint smetterebbe di coprirlo e questa riga sarebbe rossa
  // PRIMA che il buco esista.
  it('runGenerationTurn e esportata da src/data/anthropic.ts e da nessun altro modulo', () => {
    const moduli = moduliCheEsportano('runGenerationTurn').map((file) =>
      relative(root, file).replace(/\\/g, '/'),
    );
    expect(moduli).toEqual(['src/data/anthropic.ts']); // DoD T-224
    // Contro-prova sul metodo: la stessa ricerca trova anche il turno di onboarding, quindi
    // non e' una regex che non trova mai nulla.
    expect(moduliCheEsportano('runOnboardingTurn')).toHaveLength(1); // DoD T-224
  });

  // LA RICERCA CHE PINNA LA PREMESSA VEDE TUTTE LE FORME, e la contro-prova qui sopra non lo
  // dice: dice che la ricerca trova QUALCOSA, non che trovi tutto. Misurato in verifica: un
  // secondo export che avvolgeva runGenerationTurn e' sopravvissuto all'intera suite, perche'
  // la ricerca cercava soltanto `export function`. La tabella si legge in blocco, cosi' una
  // forma che cade si vede accanto alle altre nove invece di fermare il ciclo alla prima.
  it('la ricerca degli export vede ogni forma di export, e nessuna forma che export non e', () => {
    // Anti-vacuita': la tabella ha righe VERE e righe FALSE. Con soli positivi, una ricerca
    // che rispondesse sempre 'si' passerebbe; con soli negativi, una che non trova mai nulla.
    expect(FORME_DELL_EXPORT.filter(([, , atteso]) => atteso).length).toBeGreaterThan(3); // DoD T-224
    expect(FORME_DELL_EXPORT.filter(([, , atteso]) => !atteso).length).toBeGreaterThan(3); // DoD T-224

    const osservato = FORME_DELL_EXPORT.map(
      ([forma, sorgente]) =>
        `${forma}: ${esportaIlNome('runGenerationTurn', sorgente) ? 'TROVATO' : 'non trovato'}`,
    );
    const atteso = FORME_DELL_EXPORT.map(
      ([forma, , trovato]) => `${forma}: ${trovato ? 'TROVATO' : 'non trovato'}`,
    );
    expect(osservato).toEqual(atteso); // DoD T-224
  });

  // covers: AC-224-7
  it('un modulo client che importa runGenerationTurn dal confine e un ERRORE di lint', async () => {
    // Anti-vacuita': le taglie sono DICHIARATE separatamente, cosi' il solo prodotto non
    // sopravvive a un elenco svuotato e all'altro gonfiato. Nove caselle, non zero.
    expect(FORME_VIETATE).toHaveLength(3); // covers: AC-224-7
    expect(PERCORSI_CLIENT).toHaveLength(3); // covers: AC-224-7

    // Il verdetto si legge come una TABELLA: una riga per casella, confrontata in blocco con
    // quella attesa. Una casella che cade si vede accanto alle otto che tengono, invece di
    // fermare il ciclo alla prima — e il verso in cui e' caduta (non vietata? presa dalla
    // regola sbagliata? solo warning?) e' scritto nella riga stessa.
    const osservato: string[] = [];
    for (const percorso of PERCORSI_CLIENT) {
      for (const { forma, regola, source } of FORME_VIETATE) {
        const errori = await erroriDelConfineSu(source, percorso);
        const verdetto =
          errori.length === 0
            ? 'NON VIETATO'
            : !errori.every((errore) => errore.severity === 2)
              ? 'solo warning'
              : !errori.some((errore) => errore.message.includes('src/data/anthropic'))
                ? 'vietato per un altro motivo'
                : `vietato da ${errori.map((errore) => errore.ruleId).find((id) => id === regola)}`;
        osservato.push(`${percorso} / ${forma}: ${verdetto}`);
      }
    }

    const atteso = PERCORSI_CLIENT.flatMap((percorso) =>
      FORME_VIETATE.map(({ forma, regola }) => `${percorso} / ${forma}: vietato da ${regola}`),
    );
    expect(osservato).toEqual(atteso); // covers: AC-224-7
  });

  // IL RAMO CHE RENDE L'ALTRO UNA PROVA. Il confine LLM, a differenza del service_role, e'
  // APERTO al layer di dominio: l'orchestrazione della generazione (T-230) dovra' poter
  // chiamare runGenerationTurn. Una regola che vietasse anche li' spegnerebbe il macrotask
  // successivo, e nessuna asserzione sul verso positivo se ne accorgerebbe.
  // covers: AC-224-7 (verso permissivo: il divieto e' MIRATO al codice client)
  it('src/domain/** e src/data/** possono importare runGenerationTurn in ogni forma', async () => {
    for (const percorso of ['src/domain/generation/pages.ts', 'src/data/generations.ts']) {
      for (const { forma, source } of FORME_VIETATE) {
        expect(await erroriDelConfineSu(source, percorso), `${percorso} / ${forma}`).toEqual([]); // covers: AC-224-7
      }
    }
  });
});
