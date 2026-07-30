import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';

// T-211 (macrotask generation-engine, P2) — IL CONFINE fra il design system del BUILDER
// (src/ui/theme/tokens.ts) e il layer del SITO GENERATO (src/ui/site/**). Le asserzioni
// DERIVANO dall'acceptance_criterion AC-211-4
// (docs/blueprint/P2-generation/02-generation-engine.md); l'oracolo in fondo e'
// dichiarato come AGGIUNTIVO e nomina cio' che prova.
//
// PERCHE' UNA REGOLA DI LINT E NON UNA CONVENZIONE (P2-D14): i token dell'app cambiano
// quando cambia il builder. Se un componente del sito generato li leggesse, ritoccare il
// design system del pannello riscriverebbe i siti GIA' SCELTI E PUBBLICATI dei clienti —
// e nessuno se ne accorgerebbe finche' non lo vede un cliente. La separazione e' imposta
// dal MECCANISMO, con lo stesso pattern che P1-D7 usa per il confine LLM (T-131).
//
// IL FIXTURE IN VIOLAZIONE E' VIRTUALE — `eslint.lintText(source, { filePath })` linta
// una STRINGA con un percorso che non esiste su disco. E' il precedente di T-131, e qui
// e' obbligatorio: 'npm run lint' e' un gate della CI (audit del 29/07), quindi un file
// in violazione lasciato nel repo renderebbe la CI rossa per costruzione.
//
// CIO' CHE QUESTO FILE NON PROVA, detto invece che sottinteso. (1) src/ui/site/ non
// esiste ancora su disco — ci arrivera' il rendering dei blocchi, T-231 — quindi qui si
// prova che la CONFIGURAZIONE produrrebbe l'errore, non che un file di oggi ci passi
// sotto; che il rendering nasca proprio in quella cartella e' pinnato dal blueprint di
// T-231, non da questo file ne' da eslint.config.mjs. (2) Il confine copre gli
// specificatori LETTERALI: un import(variabile) non e' leggibile da nessuna regola
// statica e resta fuori, ed e' un limite dichiarato in eslint.config.mjs.

const root = process.cwd();
const eslint = new ESLint({ cwd: root });

// LE DUE REGOLE CHE COMPONGONO IL CONFINE, e sono due per una ragione MISURATA e non per
// gusto: 'no-restricted-imports' aggancia soltanto ImportDeclaration,
// ExportNamedDeclaration ed ExportAllDeclaration — non ha alcun handler per
// ImportExpression — quindi l'import DINAMICO gli passa sotto per intero e va chiuso con
// 'no-restricted-syntax'. Il filtro guarda ENTRAMBE: guardarne una sola lascerebbe fuori
// meta' del confine senza che nessuna asserzione se ne accorgesse.
const REGOLE_DEL_CONFINE = ['no-restricted-imports', 'no-restricted-syntax'];

/**
 * Gli errori delle regole dei confini prodotti da un sorgente linta a un certo percorso.
 *
 * La GUARDIA ANTI-PLACEBO sta qui dentro: un errore di PARSING avrebbe `ruleId` null e
 * svuoterebbe il filtro, quindi ogni ramo negativo di questo file passerebbe per un
 * fixture che non compila invece che per una regola mirata.
 */
async function importVietati(source: string, filePath: string) {
  const [risultato] = await eslint.lintText(source, { filePath: resolve(root, filePath) });
  expect(
    risultato.messages.filter((messaggio) => messaggio.fatal === true),
    `errore di parsing sul fixture di ${filePath}`,
  ).toEqual([]);
  return risultato.messages.filter(
    (messaggio) => messaggio.ruleId !== null && REGOLE_DEL_CONFINE.includes(messaggio.ruleId),
  );
}

// LE OTTO FORME con cui un modulo del sito puo' raggiungere i token del builder. Non e'
// cerimonia: ognuna di queste stringhe risolve allo STESSO FILE, e ognuna delle tre
// famiglie e' stata misurata come buco aperto prima di essere chiusa.
// - STATICA, alias e relativa: una regola che nominasse il solo alias lascerebbe passare
//   gli import relativi, che sono proprio quelli che scrive chi lavora dentro src/ui/.
// - CON ESTENSIONE '.js': moduleResolution 'bundler' la risolve allo stesso modulo e
//   'npm run typecheck' la accetta senza fiatare, quindi e' un "path equivalente" a tutti
//   gli effetti — e i pattern senza estensione non la vedevano.
// - DINAMICA: 'no-restricted-imports' NON la vede, perche' non ha un handler per
//   ImportExpression. Era il buco piu' grande dei tre: bastava un import() per aggirare il
//   confine per intero, e qui non c'e' seconda linea che rattoppi (i token del builder
//   sono un normale modulo client-safe, nessun 'server-only' li ferma a runtime).
//
// La `regola` attesa e' DICHIARATA forma per forma, cosi' il file dice anche CON QUALE
// meccanismo ciascuna e' presa e non solo che qualcosa ha protestato. COSTO DICHIARATO:
// sostituire il meccanismo (poniamo, un plugin di import al posto delle due regole core)
// rende rosso questo elenco. E' voluto — cambiare meccanismo E' una modifica al confine.
const SORGENTI_VIETATE = [
  {
    forma: "statica, alias '@/ui/theme/tokens'",
    regola: 'no-restricted-imports',
    source: "import { colors } from '@/ui/theme/tokens';\n\nexport const sfondo = colors.background;\n",
  },
  {
    forma: "statica, relativa '../theme/tokens'",
    regola: 'no-restricted-imports',
    source: "import { spacing } from '../theme/tokens';\n\nexport const passo = spacing.md;\n",
  },
  {
    forma: "statica, relativa '../../ui/theme/tokens'",
    regola: 'no-restricted-imports',
    source:
      "import { borderRadius } from '../../ui/theme/tokens';\n\nexport const raggio = borderRadius.md;\n",
  },
  {
    forma: "con estensione, alias '@/ui/theme/tokens.js'",
    regola: 'no-restricted-imports',
    source:
      "import { colors } from '@/ui/theme/tokens.js';\n\nexport const sfondo = colors.background;\n",
  },
  {
    forma: "con estensione, relativa '../theme/tokens.js'",
    regola: 'no-restricted-imports',
    source: "import { spacing } from '../theme/tokens.js';\n\nexport const passo = spacing.md;\n",
  },
  {
    forma: "con estensione, relativa '../../ui/theme/tokens.js'",
    regola: 'no-restricted-imports',
    source:
      "import { borderRadius } from '../../ui/theme/tokens.js';\n\nexport const raggio = borderRadius.md;\n",
  },
  {
    forma: "dinamica, alias import('@/ui/theme/tokens')",
    regola: 'no-restricted-syntax',
    source: "export const caricaTema = () => import('@/ui/theme/tokens');\n",
  },
  {
    forma: "dinamica, relativa dentro lazy(() => import('../theme/tokens'))",
    regola: 'no-restricted-syntax',
    source:
      "import { lazy } from 'react';\n\nexport const Tema = lazy(() => import('../theme/tokens'));\n",
  },
  {
    // TEMPLATE LITERAL senza buchi: il nodo e' 'TemplateLiteral', non 'Literal', quindi il
    // primo selector non lo vedeva. Qui pesava piu' che sui due confini privilegiati, perche'
    // questo e' il confine SENZA seconda linea: tokens.ts e' un normale modulo client-safe e
    // nessun 'server-only' lo ferma a runtime, quindi la regola di lint E' il meccanismo.
    forma: 'dinamica con TEMPLATE LITERAL senza buchi, import(`@/ui/theme/tokens`)',
    regola: 'no-restricted-syntax',
    source: 'export const caricaTema = () => import(`@/ui/theme/tokens`);\n',
  },
  {
    // SEGMENTO DOPPIO, forma dinamica: '@/ui/theme//tokens' risolve allo stesso modulo e il
    // selector ancorato a UN solo carattere fra 'theme' e 'tokens' non lo vedeva. E' lo
    // stesso difetto misurato sul confine LLM, e su questo confine era rimasto aperto perche'
    // il giro che lo trovo' lo dichiaro' fuori scope. La META' STATICA resta aperta e
    // dichiarata, per la stessa ragione tecnica del confine LLM: i `patterns` di ESLint non
    // fanno combaciare il segmento vuoto.
    forma: "dinamica con SEGMENTO DOPPIO, import('@/ui/theme//tokens')",
    regola: 'no-restricted-syntax',
    source: "export const caricaTema = () => import('@/ui/theme//tokens');\n",
  },
];

// I percorsi SOTTO src/ui/site/: uno alla radice, uno ANNIDATO (senza '**' nel glob la
// regola non lo prenderebbe), uno con estensione .ts invece di .tsx e DUE NON-TS.
// Questi ultimi non sono un capriccio: tsconfig ha `allowJs`, e col glob '{ts,tsx}' un
// .jsx o un .mjs sotto src/ui/site/ non era coperto NE' dal blocco del sito NE' da quello
// su src/** (che ha lo stesso filtro) — cioe' era l'unico punto del repo dove nessuno dei
// tre confini esisteva. Misurato, non dedotto.
const PERCORSI_DEL_SITO = [
  'src/ui/site/Hero.tsx',
  'src/ui/site/blocks/Contatti.tsx',
  'src/ui/site/tema.ts',
  'src/ui/site/blocks/Galleria.jsx',
  'src/ui/site/legacy/widget.mjs',
];

// I percorsi che la regola NON deve toccare, e sono FILE VERI del repo.
// Il primo e' il caso che una regola scritta per PREFISSO sbaglierebbe: 'src/ui/site' e'
// PREFISSO di 'src/ui/sites', che e' il layer del BUILDER (l'elenco dei siti nel
// pannello) e i token dell'app li usa legittimamente. E' la correzione di metodo n.1 di
// P1 applicata ai percorsi: almeno un nome che sia prefisso di un altro.
const PERCORSI_FUORI_DAL_SITO = [
  'src/ui/sites/SiteRow.tsx',
  'src/ui/theme/ThemeProvider.tsx',
  'src/ui/primitives/button.tsx',
  'src/domain/generation/blocks.ts',
];

// Cio' che sotto src/ui/site/ resta LECITO: la regola nomina un MODULO, non una
// cartella. Il primo caso e' la sostituzione che il confine esiste per rendere
// obbligatoria — i temi di P2. Le due forme DINAMICHE sono il ramo negativo della regola
// nuova: 'no-restricted-syntax' guarda il valore del literal, quindi vieta un import()
// dei token e NON import() in quanto tale — un selector sciatto (il solo
// `ImportExpression`) romperebbe il code splitting dell'intero layer del sito e nessuna
// altra asserzione di questo file lo vedrebbe.
const IMPORT_LECITI_NEL_SITO = [
  {
    forma: 'i temi di P2 (la sostituzione)',
    source:
      "import { THEMES } from '@/domain/generation/themes';\n\nexport const primo = THEMES[0];\n",
  },
  {
    forma: 'una libreria esterna',
    source: "import { useMemo } from 'react';\n\nexport const usa = useMemo;\n",
  },
  {
    forma: 'i temi di P2 caricati in modo DINAMICO',
    source: "export const caricaTemi = () => import('@/domain/generation/themes');\n",
  },
  {
    forma: 'una libreria esterna caricata in modo DINAMICO',
    source: "export const caricaReact = () => import('react');\n",
  },
];

// I DUE CONFINI PRIVILEGIATI che esistevano prima (P0 e P1): la regola del sito li
// RIDICHIARA, perche' in ESLint flat una configurazione successiva SOSTITUISCE le
// opzioni della stessa regola invece di sommarsi. Dimenticarne uno aprirebbe in
// silenzio, proprio nel layer che finisce nel browser, la strada al client service_role
// e alla chiave Anthropic.
const CONFINI_CHE_RESTANO = [
  {
    forma: 'il client service_role',
    source:
      "import { createAdminClient } from '@/data/supabase-admin';\n\nexport const client = createAdminClient;\n",
    atteso: 'supabase-admin',
  },
  {
    forma: 'il confine LLM',
    source:
      "import { runOnboardingTurn } from '@/data/anthropic';\n\nexport const seam = runOnboardingTurn;\n",
    atteso: '@/data/anthropic',
  },
];

describe('T-211 confine imposto — src/ui/site/** non puo importare i token del builder', () => {
  // covers: AC-211-4
  it('un modulo sotto src/ui/site/ che importa src/ui/theme/tokens fa ERRORE di lint, in ogni forma', async () => {
    // Guardia anti-vacuita': i due elenchi hanno la taglia DICHIARATA, quindi il ciclo
    // esercita 40 casi e non zero. Le due lunghezze sono scritte SEPARATE apposta: il
    // solo prodotto sopravviverebbe a un elenco svuotato e all'altro gonfiato.
    expect(PERCORSI_DEL_SITO).toHaveLength(5); // covers: AC-211-4
    expect(SORGENTI_VIETATE).toHaveLength(10); // covers: AC-211-4

    for (const percorso of PERCORSI_DEL_SITO) {
      for (const { forma, regola, source } of SORGENTI_VIETATE) {
        const errori = await importVietati(source, percorso);
        const dove = `${percorso} / ${forma}`;

        expect(errori.length, `nessun errore su ${dove}`).toBeGreaterThan(0); // covers: AC-211-4
        expect(
          errori.every((errore) => errore.severity === 2),
          `warning invece di error su ${dove}`,
        ).toBe(true); // covers: AC-211-4
        // E' proprio il confine dei TOKEN a bloccare, non un'altra regola che passava di
        // li': il messaggio nomina il modulo vietato.
        expect(
          errori.some((errore) => errore.message.includes('src/ui/theme/tokens')),
          `il confine dei token non e il motivo del blocco su ${dove}`,
        ).toBe(true); // covers: AC-211-4
        // E ad averlo bloccato e' il meccanismo che tocca a quella forma: le statiche
        // 'no-restricted-imports', le dinamiche 'no-restricted-syntax'. Senza questa
        // riga, togliere la regola sull'import() lascerebbe il file verde su ogni forma
        // statica e nessuno vedrebbe che meta' del confine e' caduta.
        expect(
          errori.some((errore) => errore.ruleId === regola),
          `${dove}: preso da [${errori.map((errore) => errore.ruleId).join(',')}] invece che da ${regola}`,
        ).toBe(true); // covers: AC-211-4
      }
    }
  });

  // covers: AC-211-4
  it('LO STESSO import da un modulo NON sotto src/ui/site/ non produce alcun errore (regola mirata, non globale)', async () => {
    expect(PERCORSI_FUORI_DAL_SITO).toHaveLength(4); // covers: AC-211-4
    // I percorsi del ramo negativo sono FILE VERI del repo, ed e' un'affermazione che
    // qualcuno deve controllare: un percorso inventato (o rinominato da un refactor)
    // resterebbe pulito comunque, e questo ciclo continuerebbe a passare senza piu'
    // dire nulla sul fatto che la regola guarda DOVE sta il file.
    for (const percorso of PERCORSI_FUORI_DAL_SITO) {
      expect(existsSync(resolve(root, percorso)), `non e un file vero: ${percorso}`).toBe(true); // covers: AC-211-4
    }

    for (const percorso of PERCORSI_FUORI_DAL_SITO) {
      for (const { forma, source } of SORGENTI_VIETATE) {
        // Stesso sorgente, altro percorso, verdetto opposto: e' la differenza fra i due
        // cicli a dire che la regola guarda DOVE sta il file e non solo cosa importa.
        const errori = await importVietati(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]); // covers: AC-211-4
      }
    }
  });

  // covers: AC-211-4
  it('sotto src/ui/site/ gli altri import restano leciti: la regola nomina il MODULO, non la cartella', async () => {
    expect(IMPORT_LECITI_NEL_SITO).toHaveLength(4); // covers: AC-211-4

    for (const percorso of PERCORSI_DEL_SITO) {
      for (const { forma, source } of IMPORT_LECITI_NEL_SITO) {
        const errori = await importVietati(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]); // covers: AC-211-4
      }
    }
  });
});

describe('T-211 oracoli aggiuntivi — la regola del sito non apre i confini che c erano gia', () => {
  // NON e' un AC: e' il costo della forma che la DoD impone. Aggiungere un blocco di
  // configurazione per src/ui/site/** SOSTITUISCE le opzioni di no-restricted-imports
  // che il blocco su src/** dichiarava, quindi i due confini di P0 e P1 vanno riscritti
  // li' dentro. Se qualcuno li dimentica, questo test e' il solo posto in cui si vede.
  it('src/ui/site/** non puo importare ne il client service_role ne il confine LLM', async () => {
    expect(CONFINI_CHE_RESTANO).toHaveLength(2);

    for (const percorso of PERCORSI_DEL_SITO) {
      for (const { forma, source, atteso } of CONFINI_CHE_RESTANO) {
        const errori = await importVietati(source, percorso);
        const dove = `${percorso} / ${forma}`;
        expect(errori.length, `nessun errore su ${dove}`).toBeGreaterThan(0);
        expect(
          errori.some((errore) => errore.message.includes(atteso)),
          `il confine atteso non e il motivo del blocco su ${dove}`,
        ).toBe(true);
      }
    }
  });
});

describe('T-211 oracoli aggiuntivi — il modulo dei temi non dipende dal design system del builder', () => {
  // NON e' un AC, ed e' il complemento DICHIARATO della regola di lint: la regola e'
  // MIRATA a src/ui/site/** (cosi' la vuole la definition_of_done), quindi NON copre
  // src/domain/generation/themes.ts. Li' un import dei token dell'app non sarebbe un
  // errore di lint, e AC-211-3 lo prenderebbe solo per i COLORI — che nel builder sono
  // riferimenti var(--color-*) e si vedono — ma NON per spaziature, raggi e scala
  // tipografica, che nel builder sono valori propri e passerebbero il controllo sui
  // valori senza lasciare traccia. Il giudice di quel caso e' questo.
  it('il sorgente dei temi non importa nulla dal layer UI del builder', () => {
    const source = readFileSync(resolve(root, 'src/domain/generation/themes.ts'), 'utf8');
    const importati = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((trovato) => trovato[1]);

    // Il modulo dei temi e' un catalogo dichiarato: oggi non importa nulla, e domani
    // qualunque cosa importi non deve venire da src/ui/.
    expect(
      importati.filter((modulo) => /(^@\/ui\/|\/ui\/|(^|\/)theme\/tokens$)/.test(modulo)),
      `il modulo dei temi dipende dal builder: ${importati.join(',')}`,
    ).toEqual([]);
  });
});
