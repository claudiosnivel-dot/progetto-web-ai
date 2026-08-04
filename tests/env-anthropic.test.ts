import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  getAnthropicApiKey,
  getAnthropicGenerationModel,
  getAnthropicOnboardingModel,
} from '@/config/env';

// T-130 (macrotask ai-onboarding, P1) — config env Anthropic. Le asserzioni
// derivano dagli acceptance_criteria AC-130-1..4 (02-ai-onboarding.md).
// AC-130-2 e verificato in modo STRUTTURALE sul sorgente di src/** (come
// tests/supabase-clients.test.ts): non basta guardare una stringa, si controlla
// che nessuna var NEXT_PUBLIC_ANTHROPIC esista e che nessun modulo client tocchi
// il segreto.

const root = process.cwd();

// Elenca ricorsivamente i sorgenti TS/TSX sotto una directory.
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const sources = listSourceFiles(resolve(root, 'src')).map((file) => ({
  path: relative(root, file).replace(/\\/g, '/'),
  text: readFileSync(file, 'utf8'),
}));

describe('T-130 config env Anthropic', () => {
  it('chiave e modello risolvono ai valori impostati nell ambiente server', () => {
    const source = {
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_MODEL_ONBOARDING: 'claude-sonnet-4-6',
    };
    expect(getAnthropicApiKey(source)).toBe('test-key'); // covers: AC-130-1
    expect(getAnthropicOnboardingModel(source)).toBe('claude-sonnet-4-6'); // covers: AC-130-1
  });

  it("chiave e modello si leggono dall'AMBIENTE quando l accessor e chiamato senza argomenti", () => {
    // AC-130-1 dice "impostate nell'AMBIENTE server": asserirlo solo su una source
    // iniettata lascerebbe non coperto il cablaggio a process.env, che e l'UNICO
    // percorso usato in produzione (src/data/anthropic.ts -> getAnthropicApiKey()).
    const before = {
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL_ONBOARDING,
    };
    try {
      process.env.ANTHROPIC_API_KEY = 'chiave-di-ambiente';
      process.env.ANTHROPIC_MODEL_ONBOARDING = 'claude-sonnet-4-6';
      expect(getAnthropicApiKey()).toBe('chiave-di-ambiente'); // covers: AC-130-1
      expect(getAnthropicOnboardingModel()).toBe('claude-sonnet-4-6'); // covers: AC-130-1

      delete process.env.ANTHROPIC_API_KEY;
      expect(() => getAnthropicApiKey()).toThrowError(/ANTHROPIC_API_KEY/); // covers: AC-130-4 — fail-fast anche sull ambiente reale
    } finally {
      if (before.key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = before.key;
      if (before.model === undefined) delete process.env.ANTHROPIC_MODEL_ONBOARDING;
      else process.env.ANTHROPIC_MODEL_ONBOARDING = before.model;
    }
  });

  it('nessuna variabile NEXT_PUBLIC_ANTHROPIC nel sorgente', () => {
    const leaking = sources.filter((s) => s.text.includes('NEXT_PUBLIC_ANTHROPIC'));
    expect(leaking.map((s) => s.path)).toEqual([]); // covers: AC-130-2
  });

  it('nessun modulo client referenzia ANTHROPIC_API_KEY', () => {
    const clientModules = sources.filter((s) => /^\s*['"]use client['"]/m.test(s.text));
    expect(clientModules.length).toBeGreaterThan(0); // covers: AC-130-2 — guardia anti-placebo
    const leaking = clientModules.filter((s) => s.text.includes('ANTHROPIC_API_KEY'));
    expect(leaking.map((s) => s.path)).toEqual([]); // covers: AC-130-2
  });

  it('ANTHROPIC_API_KEY e nominata solo dall accessor in src/config/env.ts', () => {
    const naming = sources.filter((s) => s.text.includes('ANTHROPIC_API_KEY'));
    expect(naming.map((s) => s.path)).toEqual(['src/config/env.ts']); // covers: AC-130-2
  });

  it('il lettore del modello non dipende dal segreto (usabile ovunque)', () => {
    // Non discende da AC-130-2 (che riguarda l'assenza della chiave fra le
    // variabili client): copre la definition_of_done, cioe che modello e segreto
    // siano due accessor distinti e che il modello sia config pubblica.
    expect(getAnthropicOnboardingModel({ ANTHROPIC_MODEL_ONBOARDING: 'claude-sonnet-4-6' })).toBe(
      'claude-sonnet-4-6',
    ); // DoD T-130
  });

  it("il modello risolve al default quando ANTHROPIC_MODEL_ONBOARDING non e' impostata", () => {
    expect(getAnthropicOnboardingModel({})).toBe('claude-haiku-4-5'); // covers: AC-130-3
    expect(getAnthropicOnboardingModel({ ANTHROPIC_MODEL_ONBOARDING: '   ' })).toBe(
      'claude-haiku-4-5',
    ); // covers: AC-130-3 — vuota/whitespace = non impostata (come loadEnv)
  });

  it('la lettura della chiave assente lancia un errore che la nomina (fail-fast)', () => {
    expect(() => getAnthropicApiKey({})).toThrowError(/ANTHROPIC_API_KEY/); // covers: AC-130-4
    expect(() => getAnthropicApiKey({ ANTHROPIC_API_KEY: '' })).toThrowError(/ANTHROPIC_API_KEY/); // covers: AC-130-4
    expect(() => getAnthropicApiKey({ ANTHROPIC_API_KEY: '   ' })).toThrowError(
      /ANTHROPIC_API_KEY/,
    ); // covers: AC-130-4 — nessun valore vuoto restituito silenziosamente
  });
});

// ---------------------------------------------------------------------------
// T-224 (macrotask generation-llm, P2) — l'accessor del modello della GENERAZIONE. I suoi casi
// stanno QUI e non in tests/generation-turn.test.ts perche' qui vive gia' il suo GEMELLO, e i
// due bordi che l'accessor dell'intervista ha da P1 — il parametro `source` e il valore di soli
// spazi — sono esattamente quelli che a questo mancavano: misurato in verifica avversariale,
// togliere il trim, trimmare il valore al RITORNO e ignorare del tutto il parametro `source`
// erano tre mutazioni tutte SOPRAVVISSUTE. Era l'unico accessor di config del progetto senza i
// propri casi limite, mentre l'oracolo di T-224 lo esercitava solo attraverso il confine, dove
// si vede il valore e non il modo in cui e' stato letto.

describe('T-224 config env del modello di generazione', () => {
  it("il modello risolve al default quando ANTHROPIC_MODEL_GENERATION non e' impostata", () => {
    expect(getAnthropicGenerationModel({})).toBe('claude-sonnet-5'); // DoD T-224
    // Vuota/whitespace = NON IMPOSTATA, come loadEnv e come il gemello dell'intervista: senza
    // questa riga una variabile di soli spazi diventerebbe il nome del modello, e il turno
    // fallirebbe alla prima richiesta reale con un errore che non nomina la causa.
    expect(getAnthropicGenerationModel({ ANTHROPIC_MODEL_GENERATION: '   ' })).toBe(
      'claude-sonnet-5',
    ); // DoD T-224
    // I DUE ACCESSOR SONO SEPARATI per decisione (P2-D11) e non un default condiviso: se
    // questo delegasse all'altro, cambiare modello all'intervista lo cambierebbe di nascosto
    // anche alla generazione, che ha compiti e costi diversi.
    expect(getAnthropicGenerationModel({})).not.toBe(getAnthropicOnboardingModel({})); // DoD T-224
  });

  it("il valore iniettato vince sull'ambiente, e senza source si legge l'ambiente", () => {
    const prima = process.env.ANTHROPIC_MODEL_GENERATION;
    try {
      process.env.ANTHROPIC_MODEL_GENERATION = 'claude-sonnet-4-6';
      // Il parametro `source` e' la sola ragione per cui questo accessor e' provabile senza
      // toccare l'ambiente: se venisse ignorato, questa riga tornerebbe il valore
      // dell'ambiente (o il default) invece di quello iniettato, e nessun altro caso se ne
      // accorgerebbe.
      expect(getAnthropicGenerationModel({ ANTHROPIC_MODEL_GENERATION: 'claude-opus-5' })).toBe(
        'claude-opus-5',
      ); // DoD T-224
      // ...e senza `source` si legge davvero l'AMBIENTE, che e' l'unico percorso usato in
      // produzione (src/data/anthropic.ts -> getAnthropicGenerationModel()).
      expect(getAnthropicGenerationModel()).toBe('claude-sonnet-4-6'); // DoD T-224
    } finally {
      if (prima === undefined) delete process.env.ANTHROPIC_MODEL_GENERATION;
      else process.env.ANTHROPIC_MODEL_GENERATION = prima;
    }
  });

  it('il valore configurato torna IDENTICO, spazi ai lati compresi', () => {
    // Il trim decide SE la variabile e' impostata, non QUANTO vale: trimmare anche il ritorno
    // cambierebbe in silenzio cio' che l'operatore ha scritto, e il gemello dell'intervista
    // non lo fa. La riga pinna quale delle due cose il trim serve a fare.
    expect(getAnthropicGenerationModel({ ANTHROPIC_MODEL_GENERATION: ' claude-opus-5 ' })).toBe(
      ' claude-opus-5 ',
    ); // DoD T-224
  });
});
