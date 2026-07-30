import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { ESLint } from 'eslint';
import type Anthropic from '@anthropic-ai/sdk';
import { runOnboardingTurn } from '@/data/anthropic';
import { getAnthropicOnboardingModel } from '@/config/env';

// T-131 (macrotask ai-onboarding, P1) — confine LLM server-only e mockabile.
// Le asserzioni derivano dagli acceptance_criteria AC-131-1..3 (02-ai-onboarding.md).
// Il fatto stesso che questo file importi @/data/anthropic senza chiave Anthropic
// nell'ambiente dimostra che il client reale NON viene istanziato all'import.

const root = process.cwd();

// Moduli che finiscono nel bundle del browser: NON si riconoscono dal percorso
// (in App Router una page con 'use client' vive sotto src/app/**, non solo in
// src/ui/**), quindi si enumerano dalla direttiva. La guardia di lint va provata
// su TUTTI questi, non su un percorso di comodo.
function clientModules(dir = resolve(root, 'src')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return clientModules(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return /^\s*['"]use client['"]/m.test(readFileSync(full, 'utf8')) ? [full] : [];
  });
}

// Messaggi e tool del turno: sono l'input che AC-131-1 vuole ritrovare INVARIATO
// nella chiamata al client.
const MESSAGES: Anthropic.MessageParam[] = [
  { role: 'user', content: 'Ho un bar a Roma, si chiama Bar Sole' },
];

const TOOLS: Anthropic.ToolUnion[] = [
  {
    name: 'update_brief',
    description: 'Aggiorna i campi del brief raccolti durante l intervista.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { business_name: { type: 'string' } },
      required: ['business_name'],
      additionalProperties: false,
    },
  },
];

const SYSTEM = 'Sei l assistente di onboarding di Belora.';

// Doppio del client SDK: registra i parametri ricevuti e ritorna una risposta fissa.
function createMockClient() {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const reply: Anthropic.Message = {
    id: 'msg_test_t131',
    container: null,
    content: [{ type: 'text', text: 'Perfetto, Bar Sole.', citations: null }],
    model: 'claude-haiku-4-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'end_turn',
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 10,
      output_tokens: 5,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
  const client = {
    messages: {
      create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        calls.push(params);
        return Promise.resolve(reply);
      },
    },
  };
  return { calls, client, reply };
}

const ORIGINAL_MODEL_ENV = process.env.ANTHROPIC_MODEL_ONBOARDING;

afterEach(() => {
  if (ORIGINAL_MODEL_ENV === undefined) delete process.env.ANTHROPIC_MODEL_ONBOARDING;
  else process.env.ANTHROPIC_MODEL_ONBOARDING = ORIGINAL_MODEL_ENV;
});

describe('T-131 confine LLM server-only e mockabile', () => {
  // covers: AC-131-1
  it('invoca il client iniettato con il modello di ANTHROPIC_MODEL_ONBOARDING e con esattamente messaggi e tool passati', async () => {
    // Modello impostato nell'ambiente: se il confine lo leggesse da una costante
    // hardcoded questa asserzione fallirebbe.
    process.env.ANTHROPIC_MODEL_ONBOARDING = 'claude-sonnet-4-6';
    const { calls, client, reply } = createMockClient();

    const result = await runOnboardingTurn(
      { system: SYSTEM, messages: MESSAGES, tools: TOOLS },
      client,
    );

    expect(calls).toHaveLength(1); // covers: AC-131-1 — il client mockato e invocato
    const params = calls[0];
    expect(params.model).toBe('claude-sonnet-4-6'); // covers: AC-131-1
    expect(params.model).toBe(getAnthropicOnboardingModel()); // covers: AC-131-1 — stesso valore della config
    expect(params.messages).toEqual(MESSAGES); // covers: AC-131-1 — esattamente i messaggi passati
    expect(params.tools).toEqual(TOOLS); // covers: AC-131-1 — esattamente i tool passati
    // Le tre asserzioni seguenti NON discendono da AC-131-1 (che parla solo di
    // model + esattamente messaggi e tool): coprono la definition_of_done di
    // T-131 ("una sola funzione di turno" che inoltra il turno al modello).
    expect(params.system).toBe(SYSTEM); // DoD T-131
    expect(typeof params.max_tokens).toBe('number'); // DoD T-131 — request valida (max_tokens obbligatorio)
    expect(result).toBe(reply); // DoD T-131 — ritorna la risposta del modello
  });

  // covers: AC-131-2
  it('una regola no-restricted-imports fa fallire il lint su OGNI modulo client reale che importi @/data/anthropic', async () => {
    const eslint = new ESLint({ cwd: root });
    const source =
      "import { runOnboardingTurn } from '@/data/anthropic';\n\nexport const seam = runOnboardingTurn;\n";

    // I moduli client del repo, non un percorso inventato: se domani ne nasce uno
    // fuori da src/ui/** (es. una page 'use client' in src/app/**) questo test lo
    // include automaticamente.
    const modules = clientModules();
    expect(modules.length).toBeGreaterThan(0); // covers: AC-131-2 — guardia anti-vacuita: ci sono davvero moduli client
    // Il layer app deve essere rappresentato: e' li' che App Router mette le page.
    expect(modules.some((m) => relative(root, m).replace(/\\/g, '/').startsWith('src/app/'))).toBe(
      true,
    ); // covers: AC-131-2

    for (const filePath of modules) {
      const [result] = await eslint.lintText(source, { filePath });
      const restricted = result.messages.filter((m) => m.ruleId === 'no-restricted-imports');
      const where = relative(root, filePath);
      expect(restricted.length, `nessun errore su ${where}`).toBeGreaterThan(0); // covers: AC-131-2 — import lato client = errore di lint
      expect(
        restricted.every((m) => m.severity === 2),
        `warning invece di error su ${where}`,
      ).toBe(true); // covers: AC-131-2 — severita error, non warning
      expect(
        restricted.some((m) => m.message.includes('@/data/anthropic')),
        `il confine LLM non e' il motivo del blocco su ${where}`,
      ).toBe(true); // covers: AC-131-2 — e proprio il confine LLM a essere vietato
    }

    // Caso NEGATIVO: dal layer domain (server) lo stesso import deve restare lecito,
    // altrimenti l'orchestrazione dell'intervista (T-132) sarebbe impossibile.
    const [domainResult] = await eslint.lintText(source, {
      filePath: resolve(root, 'src/domain/onboarding/interview.ts'),
    });
    expect(domainResult.messages.some((m) => m.fatal === true)).toBe(false); // covers: AC-131-2 — guardia anti-placebo: nessun errore di parsing
    expect(domainResult.messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]); // covers: AC-131-2
  });

  // covers: AC-131-2 — l'AC ammette la guardia sul modulo "o 'server-only'": la
  // direttiva e' la difesa a build-time di Next e va pinnata come in P0 si pinna
  // quella di supabase-admin (tests/supabase-clients.test.ts), altrimenti puo'
  // sparire senza che nessun oracolo se ne accorga.
  it("il confine dichiara 'server-only' come prima istruzione", () => {
    const source = readFileSync(resolve(root, 'src/data/anthropic.ts'), 'utf8');
    const firstStatement = source
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0 && !l.startsWith('//'));
    expect(firstStatement).toBe("import 'server-only';"); // covers: AC-131-2
  });

  // covers: AC-131-3
  it('il sorgente del confine non contiene alcuna chiave letterale: legge solo da config/env', () => {
    const source = readFileSync(resolve(root, 'src/data/anthropic.ts'), 'utf8');

    // Nessun literal opaco lungo (forma tipica di una chiave API).
    expect(/(['"])[A-Za-z0-9_-]{20,}\1/.test(source)).toBe(false); // covers: AC-131-3
    // Nessuna assegnazione di una chiave letterale al client.
    expect(/apiKey\s*:\s*['"`]/.test(source)).toBe(false); // covers: AC-131-3
    // Il segreto non e nemmeno nominato qui: nessuna lettura diretta dall'ambiente.
    expect(source.includes('process.env')).toBe(false); // covers: AC-131-3
    expect(source.includes('ANTHROPIC_API_KEY')).toBe(false); // covers: AC-131-3
    // L'unica via alla chiave e l'accessor di config/env (T-130).
    expect(/from\s+['"]@\/config\/env['"]/.test(source)).toBe(true); // covers: AC-131-3
    expect(source.includes('getAnthropicApiKey(')).toBe(true); // covers: AC-131-3
  });
});

// ---------------------------------------------------------------------------
// LE TRE FORME CHE IL CONFINE NON VEDEVA.
//
// Il test di AC-131-2 qui sopra prova UNA forma sola: l'import STATICO con l'alias. Le
// altre tre famiglie sono state misurate sulla configurazione VERA e davano TUTTE 0
// messaggi da ogni percorso del repo, mentre quella statica ne dava 2.
//   - DINAMICA. 'no-restricted-imports' aggancia soltanto ImportDeclaration,
//     ExportNamedDeclaration ed ExportAllDeclaration: nessun handler per
//     ImportExpression. import('@/data/anthropic') passava da qualunque percorso, e
//     serve la seconda regola 'no-restricted-syntax'.
//   - CON ESTENSIONE '.js'. moduleResolution 'bundler' la risolve allo stesso file e il
//     typecheck la accetta, ma sfuggiva a `paths` (confronto esatto) e ai pattern.
//   - FILE NON-TS. Col glob '{ts,tsx}' un .jsx o un .mjs sotto src/** non incontrava
//     alcuna restrizione, e tsconfig ha `allowJs`.
//
// QUANTO PESA, senza gonfiarlo: anthropic.ts ha import 'server-only' come prima riga
// (pinnato qui sopra), quindi in un bundle client il BUILD fallirebbe comunque. Questo
// strato e' difesa in profondita': il solo che nomina il confine con un errore
// leggibile PRIMA del build, ed e' un gate della CI.
//
// IL RAMO CHE CONTA DI PIU' E' QUELLO NEGATIVO. Il confine LLM, a differenza del
// service_role, e' APERTO al layer di dominio: l'orchestrazione dell'intervista (T-132)
// deve poter chiamare il modello. La restrizione dinamica deve rispecchiare ESATTAMENTE
// quel layering — se vietasse import('@/data/anthropic') anche a src/domain/**,
// vieterebbe per via dinamica cio' che per via statica e' lecito, e nessuna asserzione
// sulla forma statica se ne accorgerebbe.

const REGOLE_DEL_CONFINE = ['no-restricted-imports', 'no-restricted-syntax'];

const eslintDelConfine = new ESLint({ cwd: root });

/**
 * Gli errori delle regole del confine su un sorgente linta a un certo percorso.
 *
 * GUARDIA ANTI-PLACEBO: un errore di PARSING avrebbe `ruleId` null e svuoterebbe il
 * filtro, quindi ogni ramo negativo passerebbe per un fixture che non compila invece
 * che per una regola mirata — ed e' proprio il ramo negativo il cuore di questo file.
 */
async function erroriDelConfine(source: string, percorso: string) {
  const [risultato] = await eslintDelConfine.lintText(source, {
    filePath: resolve(root, percorso),
  });
  expect(
    risultato.messages.filter((messaggio) => messaggio.fatal === true),
    `errore di parsing sul fixture di ${percorso}`,
  ).toEqual([]);
  return risultato.messages.filter(
    (messaggio) => messaggio.ruleId !== null && REGOLE_DEL_CONFINE.includes(messaggio.ruleId),
  );
}

// LE SETTE FORME con cui un modulo puo' raggiungere il confine LLM: ognuna risolve allo
// stesso file. La `regola` attesa e' dichiarata forma per forma, cosi' l'elenco dice
// anche CON QUALE meccanismo ciascuna e' presa.
const FORME_VIETATE_LLM = [
  {
    forma: "statica, alias '@/data/anthropic'",
    regola: 'no-restricted-imports',
    source:
      "import { runOnboardingTurn } from '@/data/anthropic';\n\nexport const seam = runOnboardingTurn;\n",
  },
  {
    forma: "statica, relativa '../data/anthropic'",
    regola: 'no-restricted-imports',
    source:
      "import { runOnboardingTurn } from '../data/anthropic';\n\nexport const seam = runOnboardingTurn;\n",
  },
  {
    forma: "con estensione, alias '@/data/anthropic.js'",
    regola: 'no-restricted-imports',
    source:
      "import { runOnboardingTurn } from '@/data/anthropic.js';\n\nexport const seam = runOnboardingTurn;\n",
  },
  {
    forma: "con estensione, relativa '../data/anthropic.js'",
    regola: 'no-restricted-imports',
    source:
      "import { runOnboardingTurn } from '../data/anthropic.js';\n\nexport const seam = runOnboardingTurn;\n",
  },
  {
    forma: "dinamica, alias import('@/data/anthropic')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data/anthropic');\n",
  },
  {
    forma: "dinamica, relativa dentro await import('../data/anthropic')",
    regola: 'no-restricted-syntax',
    source:
      "export async function seam() {\n  const mod = await import('../data/anthropic');\n  return mod;\n}\n",
  },
  {
    forma: "dinamica con estensione, import('@/data/anthropic.js')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data/anthropic.js');\n",
  },
  {
    // TEMPLATE LITERAL senza buchi: il nodo e' 'TemplateLiteral', non 'Literal', quindi il
    // primo selector non lo vedeva. Misurato 0 messaggi da tutti e otto i layer contro 1
    // della forma con gli apici, e TypeScript lo risolve allo stesso modulo.
    forma: 'dinamica con TEMPLATE LITERAL senza buchi, import(`@/data/anthropic`)',
    regola: 'no-restricted-syntax',
    source: 'export const carica = () => import(`@/data/anthropic`);\n',
  },
  {
    // SEGMENTO DOPPIO, forma DINAMICA. Il selector del confine LLM deve restare ancorato a
    // 'data' — un '/anthropic/' nudo colpirebbe '@anthropic-ai/sdk', che e' una dipendenza
    // vera e che nessuna regola statica vieta — ma l'ancoraggio a UN solo carattere lasciava
    // passare '@/data//anthropic' e '@/data/./anthropic', che TypeScript risolve allo stesso
    // modulo (nessun TS2307). Cioe' questo confine era piu' STRETTO di quello del
    // service_role, il cui selector e' nudo. Ora l'ancoraggio ammette da uno a tre caratteri.
    forma: "dinamica con SEGMENTO DOPPIO, import('@/data//anthropic')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data//anthropic');\n",
  },
  {
    forma: "dinamica con SEGMENTO PUNTATO, import('@/data/./anthropic')",
    regola: 'no-restricted-syntax',
    source: "export const carica = () => import('@/data/./anthropic');\n",
  },
];

// I LAYER SOGGETTI. Il dominio NON e' qui: e' l'eccezione, e ha un test tutto suo.
// I tre percorsi NON-TS coprono il terzo buco (`allowJs`); src/ui/site/ e' il layer del
// sito generato (T-231), che dichiara le stesse restrizioni in un blocco PROPRIO —
// in flat config le opzioni della stessa regola si sostituiscono invece di sommarsi,
// quindi li' il confine puo' cadere da solo.
const PERCORSI_SOGGETTI_LLM = [
  'src/ui/onboarding/ChatPanel.tsx', // UI del builder (blocco base), file VERO
  'src/app/[locale]/page.tsx', // App Router: qui vivono le page 'use client', file VERO
  'src/ui/site/Hero.tsx', // layer del sito generato (T-231), non ancora su disco
  'src/ui/onboarding/Legacy.jsx', // NON-TS fuori da src/ui/site/
  'src/app/[locale]/legacy.mjs', // NON-TS sotto src/app/
  'src/ui/site/legacy/widget.mjs', // NON-TS nel layer del sito
  // L'ultima delle otto estensioni del glob che nessun caso esercitava. Con questa e le
  // due aggiunte in tests/supabase-clients.test.ts (.cts soggetto, .cjs esentato), tutte
  // e otto sono coperte: prima, togliere '.cjs', '.mts' e '.cts' dal glob lasciava la
  // suite verde.
  'src/ui/onboarding/legacy.mts', // NON-TS, l ultima estensione non provata
];

// I LAYER LIBERI. src/domain/** e' il PRIMO della lista e non e' un dettaglio: e' il
// layer per cui il confine esiste APERTO (T-132). Gli altri sono i moduli server
// designati e gli helper di test.
const PERCORSI_LIBERI_LLM = [
  { percorso: 'src/domain/onboarding/interview.ts', vero: true },
  { percorso: 'src/domain/generation/blocks.ts', vero: true },
  { percorso: 'src/data/briefs.ts', vero: true },
  { percorso: 'tests/anthropic-boundary.test.ts', vero: true },
  { percorso: 'src/domain/generation/legacy.mjs', vero: false },
  { percorso: 'src/data/legacy.mjs', vero: false },
];

// Cio' che deve restare LECITO OVUNQUE, e la prima voce e' quella che una regex golosa
// sbaglierebbe: '@anthropic-ai/sdk' e' una dipendenza VERA del progetto e nessuna
// regola statica di eslint.config.mjs la vieta. Un selector su '/anthropic/' nudo la
// prenderebbe, vietando per via dinamica cio' che per via statica e' lecito. Le altre
// due tengono la regola lontana da import() in quanto tale: un selector sciatto (il
// solo `ImportExpression`) romperebbe il code splitting dell'intera app.
const IMPORT_LECITI_OVUNQUE_LLM = [
  {
    forma: "l SDK del fornitore, '@anthropic-ai/sdk', caricato in modo dinamico",
    source: "export const f = () => import('@anthropic-ai/sdk');\n",
  },
  {
    forma: 'l SDK del fornitore importato come TIPO, forma statica',
    source:
      "import type Anthropic from '@anthropic-ai/sdk';\n\nexport type Msg = Anthropic.Message;\n",
  },
  {
    forma: 'una libreria esterna caricata in modo dinamico',
    source: "export const f = () => import('react');\n",
  },
  {
    forma: 'un modulo di dominio caricato in modo dinamico',
    source: "export const f = () => import('@/domain/generation/themes');\n",
  },
  {
    // L'SDK del fornitore nella forma TEMPLATE: e' il caso che il selector NUOVO sul
    // template sbaglierebbe se fosse scritto sul solo nodo TemplateLiteral invece che sul
    // testo grezzo del pezzo. La regex e' la stessa del literal, quindi l'ancoraggio a
    // 'data' vale anche qui — e questa riga e' cio' che lo prova.
    forma: 'l SDK del fornitore in forma TEMPLATE, import(`@anthropic-ai/sdk`)',
    source: 'export const f = () => import(`@anthropic-ai/sdk`);\n',
  },
  {
    // Un template CON un buco: forma legittima e presente nel repo (src/i18n/request.ts
    // carica i cataloghi cosi'). Il selector guarda il testo GREZZO del pezzo, quindi non
    // lo tocca; senza questa riga un selector piu' grezzo romperebbe quel caso in silenzio.
    forma: 'un template literal CON un buco, la forma che carica i cataloghi i18n',
    source: 'export const f = (n: string) => import(`../../messages/${n}.json`);\n',
  },
];

describe('T-131 confine LLM: le forme equivalenti dell import, e il layering che devono rispecchiare', () => {
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO, una per forma: togliere '**/data/anthropic.*'
  // da anthropicBoundaryPatterns (cadono le due con estensione); togliere
  // 'no-restricted-syntax' dal blocco base (cadono le dinamiche su ui/app); non
  // ridichiararla nel blocco di src/ui/site/** (cadono le dinamiche sui tre percorsi
  // del sito, e SOLO su quelli); riportare i `files` a '{ts,tsx}' (cadono i tre
  // percorsi non-TS in ogni forma).
  // covers: AC-131-2
  it('OGNI forma equivalente dell import del confine LLM e un errore di lint, da OGNI layer client', async () => {
    // Guardia anti-vacuita': taglie DICHIARATE separatamente — il solo prodotto
    // sopravviverebbe a un elenco svuotato e all'altro gonfiato. 42 casi, non zero.
    expect(FORME_VIETATE_LLM).toHaveLength(10); // covers: AC-131-2
    expect(PERCORSI_SOGGETTI_LLM).toHaveLength(7); // covers: AC-131-2

    for (const percorso of PERCORSI_SOGGETTI_LLM) {
      for (const { forma, regola, source } of FORME_VIETATE_LLM) {
        const errori = await erroriDelConfine(source, percorso);
        const dove = `${percorso} / ${forma}`;

        expect(errori.length, `nessun errore su ${dove}`).toBeGreaterThan(0); // covers: AC-131-2
        expect(
          errori.every((errore) => errore.severity === 2),
          `warning invece di error su ${dove}`,
        ).toBe(true); // covers: AC-131-2 — severita error, non warning
        expect(
          errori.some((errore) => errore.message.includes('src/data/anthropic')),
          `il confine LLM non e il motivo del blocco su ${dove}`,
        ).toBe(true); // covers: AC-131-2
        expect(
          errori.some((errore) => errore.ruleId === regola),
          `${dove}: preso da [${errori.map((errore) => errore.ruleId).join(',')}] invece che da ${regola}`,
        ).toBe(true); // covers: AC-131-2
      }
    }
  });

  // IL RAMO CHE IMPEDISCE ALLA REGOLA DI ESSERE TROPPO LARGA. Il divieto dinamico deve
  // rispecchiare il layering di quello statico voce per voce: il blocco di src/domain/**
  // ridichiara il SOLO service_role, quindi anche 'no-restricted-syntax' deve elencare
  // li' il solo service_role.
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: aggiungere anthropicBoundaryDynamicImport al
  // 'no-restricted-syntax' del blocco src/domain/**, oppure omettere quella regola dal
  // blocco del dominio (allora il blocco base, che vieta ENTRAMBI, non viene piu'
  // sostituito e il dominio eredita il divieto sul confine LLM). Entrambe le mutazioni
  // spengono T-132 per via dinamica lasciando verde ogni asserzione sulla forma statica.
  // covers: AC-131-2 (verso permissivo: il divieto e' MIRATO al codice client)
  it('src/domain/** puo raggiungere il confine LLM in TUTTE le forme, dinamica compresa (T-132)', async () => {
    expect(PERCORSI_LIBERI_LLM).toHaveLength(6); // covers: AC-131-2

    for (const { percorso, vero } of PERCORSI_LIBERI_LLM) {
      if (vero) {
        expect(existsSync(resolve(root, percorso)), `non e un file vero: ${percorso}`).toBe(true); // covers: AC-131-2
      }
      for (const { forma, source } of FORME_VIETATE_LLM) {
        const errori = await erroriDelConfine(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]); // covers: AC-131-2
      }
    }
  });

  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: nel selector, '/data.anthropic/' -> '/anthropic/'
  // (cade la prima voce: l SDK del fornitore), oppure il selector nudo
  // "ImportExpression" (cadono anche le due dinamiche generiche, cioe' il code
  // splitting dell'intera app).
  it('import() di qualunque altro modulo, SDK del fornitore compreso, resta lecito da ogni layer', async () => {
    expect(IMPORT_LECITI_OVUNQUE_LLM).toHaveLength(6);

    for (const percorso of [
      ...PERCORSI_SOGGETTI_LLM,
      ...PERCORSI_LIBERI_LLM.map((p) => p.percorso),
    ]) {
      for (const { forma, source } of IMPORT_LECITI_OVUNQUE_LLM) {
        const errori = await erroriDelConfine(source, percorso);
        expect(errori, `${percorso} / ${forma}`).toEqual([]);
      }
    }
  });

  // NON deriva da un AC: e' il PIN di una COPERTURA DICHIARATA APERTA, cioe' di un buco che
  // sappiamo esserci e che questo giro non chiude. La meta' DINAMICA del segmento doppio e'
  // chiusa (sta in FORME_VIETATE_LLM qui sopra); la meta' STATICA no, e non per pigrizia: il
  // pacchetto `ignore` che ESLint usa per i `patterns` non fa combaciare il segmento VUOTO,
  // quindi ne '**/data/**/anthropic' (che copre il solo '/./') ne la variante extglob
  // prendono '@/data//anthropic'. Chiuderla richiede un meccanismo che NORMALIZZI il
  // percorso — un plugin di import con resolver — invece di un confronto fra stringhe.
  //
  // Perche' pinnarlo invece di scriverlo solo in un commento: un buco dichiarato e non
  // asserito e' indistinguibile da un buco dimenticato. Cosi' il giorno in cui qualcuno
  // introduce quel resolver, QUESTO test diventa rosso, la copertura dichiarata va rimossa e
  // la decisione torna sul tavolo. E' la stessa forma con cui P2 pinna l'assenza di una
  // sorgente di recensioni nel brief e il CJK fuori da max_bytes.
  it('DICHIARATO APERTO: la forma statica col segmento doppio sfugge ancora ai patterns', async () => {
    const statica =
      "import { runOnboardingTurn } from '@/data//anthropic';\n\nexport const seam = runOnboardingTurn;\n";
    const dinamica = "export const carica = () => import('@/data//anthropic');\n";

    // Il layer piu' esposto: la UI del builder, che finisce nel browser.
    const percorso = 'src/ui/onboarding/ChatPanel.tsx';

    // Il buco: la statica NON e' presa. Se un giorno lo diventasse, questa riga e' rossa.
    expect(await erroriDelConfine(statica, percorso)).toEqual([]);
    // E accanto, il contrasto che dice che il buco e' della sola META' statica: la stessa
    // forma per via dinamica e' presa dal selector.
    const errori = await erroriDelConfine(dinamica, percorso);
    expect(errori.some((e) => e.ruleId === 'no-restricted-syntax')).toBe(true);
  });
});
