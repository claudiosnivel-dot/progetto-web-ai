import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
