import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runOnboardingTurn } from '@/data/anthropic';
import { fetchSafe } from '@/domain/import/fetchSafe';
import { fromUrl } from '@/domain/import/fromUrl';
import { runInterviewTurn } from '@/domain/onboarding/interview';
import {
  BRIEF_LIMITS,
  BriefSchema,
  BriefUpdateSchema,
  applyBriefUpdate,
  emptyBrief,
} from '@/domain/onboarding/brief';

// P1-D17 (emendamento a T-121/T-122) — tetto di lunghezza sui campi del brief.
// Le asserzioni derivano dagli AC-E17-1..8, tranne AC-E17-7: quell'AC pretendeva i
// tetti replicati come maxLength/maxItems nel JSON Schema dei tool, ed e' stato
// ANNULLATO da P1-D20 (quei keyword sono fuori dal sottoinsieme dello strict tool
// use). Al suo posto ci sono le due asserzioni marcate P1-D20: i tetti dichiarati in
// prosa nella description, e la guardia che nessuno schema esca dal sottoinsieme.
// Dominio puro: nessun DB. Il confine LLM (T-131) e il fetch SSRF-safe (T-140) sono
// mockati solo per leggere cio' che viene DICHIARATO al modello.

vi.mock('@/data/anthropic', () => ({ runOnboardingTurn: vi.fn() }));
vi.mock('@/domain/import/fetchSafe', () => ({ fetchSafe: vi.fn() }));

const boundary = vi.mocked(runOnboardingTurn);
const fetcher = vi.mocked(fetchSafe);

// Marcatore riconoscibile in testa a ogni valore fuori scala: AC-E17-5 cerca
// proprio questo nel brief risultante per escludere una versione TRONCATA.
const MARKER = 'FUORISCALA';

function atCap(limit: number): string {
  return MARKER + 'x'.repeat(limit - MARKER.length);
}

function overCap(limit: number): string {
  return MARKER + 'x'.repeat(limit + 1 - MARKER.length);
}

function items<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_unused, index) => make(index));
}

function hoursOf(count: number): Record<string, string> {
  return Object.fromEntries(items(count, (index) => [`d${index}`, '09:00-17:00']));
}

// Un caso = un tetto, con il valore ESATTAMENTE al confine e quello superato di 1.
type CapCase = {
  readonly label: string;
  readonly field: string; // il nome atteso in rejected[] di applyBriefUpdate
  readonly atCap: Record<string, unknown>;
  readonly overCap: Record<string, unknown>;
};

function textCase(field: string, limit: number): CapCase {
  return {
    label: field,
    field,
    atCap: { [field]: atCap(limit) },
    overCap: { [field]: overCap(limit) },
  };
}

function offeringCase(property: string, limit: number): CapCase {
  return {
    label: `offerings.${property}`,
    field: 'offerings',
    atCap: { offerings: [{ name: 'Caffe', [property]: atCap(limit) }] },
    overCap: { offerings: [{ name: 'Caffe', [property]: overCap(limit) }] },
  };
}

// Tutti i campi con tetto (AC-E17-3) e tutte le collezioni con tetto di voci
// (AC-E17-4), in patch FLAT nella forma di BriefUpdateSchema.
const CAP_CASES: readonly CapCase[] = [
  textCase('business_name', BRIEF_LIMITS.business_name),
  textCase('description', BRIEF_LIMITS.description),
  textCase('address', BRIEF_LIMITS.address),
  textCase('phone', BRIEF_LIMITS.phone),
  textCase('whatsapp', BRIEF_LIMITS.whatsapp),
  textCase('email', BRIEF_LIMITS.email),
  textCase('brand_hints', BRIEF_LIMITS.brand_hints),
  {
    label: 'highlights (voce)',
    field: 'highlights',
    atCap: { highlights: [atCap(BRIEF_LIMITS.highlight)] },
    overCap: { highlights: [overCap(BRIEF_LIMITS.highlight)] },
  },
  {
    label: 'social_links (voce)',
    field: 'social_links',
    atCap: { social_links: [atCap(BRIEF_LIMITS.social_link)] },
    overCap: { social_links: [overCap(BRIEF_LIMITS.social_link)] },
  },
  {
    label: 'offerings.name',
    field: 'offerings',
    atCap: { offerings: [{ name: atCap(BRIEF_LIMITS.offering_name) }] },
    overCap: { offerings: [{ name: overCap(BRIEF_LIMITS.offering_name) }] },
  },
  offeringCase('description', BRIEF_LIMITS.offering_description),
  offeringCase('price', BRIEF_LIMITS.offering_price),
  offeringCase('section', BRIEF_LIMITS.offering_section),
  offeringCase('photo_ref', BRIEF_LIMITS.offering_photo_ref),
  {
    label: 'hours (chiave)',
    field: 'hours',
    atCap: { hours: { [atCap(BRIEF_LIMITS.hours_key)]: '09:00-17:00' } },
    overCap: { hours: { [overCap(BRIEF_LIMITS.hours_key)]: '09:00-17:00' } },
  },
  {
    label: 'hours (valore)',
    field: 'hours',
    atCap: { hours: { mo: atCap(BRIEF_LIMITS.hours_value) } },
    overCap: { hours: { mo: overCap(BRIEF_LIMITS.hours_value) } },
  },
  {
    label: 'highlights (numero di voci)',
    field: 'highlights',
    atCap: { highlights: items(BRIEF_LIMITS.highlights_items, (i) => `voce ${i}`) },
    overCap: { highlights: items(BRIEF_LIMITS.highlights_items + 1, (i) => `voce ${i}`) },
  },
  {
    label: 'social_links (numero di voci)',
    field: 'social_links',
    atCap: {
      social_links: items(BRIEF_LIMITS.social_links_items, (i) => `https://esempio.test/${i}`),
    },
    overCap: {
      social_links: items(BRIEF_LIMITS.social_links_items + 1, (i) => `https://esempio.test/${i}`),
    },
  },
  {
    label: 'offerings (numero di voci)',
    field: 'offerings',
    atCap: { offerings: items(BRIEF_LIMITS.offerings_items, (i) => ({ name: `voce ${i}` })) },
    overCap: { offerings: items(BRIEF_LIMITS.offerings_items + 1, (i) => ({ name: `voce ${i}` })) },
  },
  {
    label: 'hours (numero di chiavi)',
    field: 'hours',
    atCap: { hours: hoursOf(BRIEF_LIMITS.hours_keys) },
    overCap: { hours: hoursOf(BRIEF_LIMITS.hours_keys + 1) },
  },
];

// I campi che nel Brief COMPLETO vivono dentro `content` (la patch e' flat, il
// brief no): serve per validare lo stesso caso anche con BriefSchema.
const CONTENT_KEYS = new Set(['offerings', 'social_links', 'highlights', 'brand_hints']);

function briefWith(patch: Record<string, unknown>): Record<string, unknown> {
  const brief: Record<string, unknown> = { locale: 'it' };
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (CONTENT_KEYS.has(key)) content[key] = value;
    else brief[key] = value;
  }
  return { ...brief, content };
}

// --- P1-D20: cio' che viene DICHIARATO al modello -----------------------------

// Keyword JSON Schema FUORI dal sottoinsieme che lo strict tool use supporta
// (vincoli di stringa, vincoli numerici, vincoli complessi di array). Qui nessuno li
// rimuove: i tool sono oggetti `Anthropic.Tool` scritti a mano passati a
// messages.create, non schemi zod passati dagli helper dell'SDK, quindi arriverebbero
// all'API verbatim e la PRIMA chiamata reale rischierebbe un 400 in compilazione
// dello schema — un modo di fallire che senza chiave API nessun oracolo puo' vedere.
const KEYWORD_FUORI_SOTTOINSIEME: readonly string[] = [
  'maxLength',
  'minLength',
  'maxItems',
  'minItems',
  'minimum',
  'maximum',
  'multipleOf',
];

/** Ogni keyword non supportata presente nello schema, col percorso in cui compare. */
function keywordNonSupportate(node: unknown, path = 'tools'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => keywordNonSupportate(item, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') return [];

  const trovate: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    // Il percorso completo, cosi' un fallimento dice DOVE, non solo che c'e'.
    if (KEYWORD_FUORI_SOTTOINSIEME.includes(key)) trovate.push(`${path}.${key}`);
    trovate.push(...keywordNonSupportate(value, `${path}.${key}`));
  }
  return trovate;
}

/**
 * I tool di TUTTI i percorsi di P1 che parlano col modello, esattamente come li
 * riceve il confine (T-131): l'intervista in chat (T-132) e l'import da URL (T-141).
 */
async function toolsDichiaratiAlModello(): Promise<Anthropic.ToolUnion[]> {
  // Serve solo cio' che viene PASSATO al confine: la risposta del modello e'
  // irrilevante qui, quindi non si ricostruisce un Anthropic.Message intero.
  boundary.mockResolvedValue({ content: [] } as unknown as Anthropic.Message);

  await runInterviewTurn({ messages: [], brief: emptyBrief('it'), userMessage: 'ciao' });

  // La pagina non dichiara nulla di se stessa (nessun JSON-LD dell'attivita, nessun
  // og:title) ma ha del testo: e' la condizione in cui T-141 invoca il confine.
  fetcher.mockResolvedValue({
    ok: true,
    html: '<html lang="it"><body><p>Officina Rossi ripara auto a Bologna.</p></body></html>',
  });
  await fromUrl('https://officina-rossi.example/');

  return boundary.mock.calls.flatMap((call) => call[0].tools);
}

const briefSource = readFileSync(
  new URL('../src/domain/onboarding/brief.ts', import.meta.url),
  'utf8',
);

beforeEach(() => {
  boundary.mockReset();
  fetcher.mockReset();
});

describe('P1-D17 tetto di lunghezza dei campi del brief', () => {
  // covers: AC-E17-2, AC-E17-3, AC-E17-4
  it('i tetti sono esattamente quelli decisi in P1-D17', () => {
    // I numeri stanno scritti a mano SOLO qui: tutte le altre asserzioni derivano
    // dalle costanti, quindi senza questo confronto una costante mutata (o una
    // aggiunta senza tetto) resterebbe verde.
    expect(BRIEF_LIMITS).toEqual({
      business_name: 200,
      description: 2000,
      address: 300,
      phone: 40,
      whatsapp: 40,
      email: 320,
      brand_hints: 500,
      highlight: 200,
      highlights_items: 20,
      social_link: 500,
      social_links_items: 20,
      offering_name: 200,
      offering_description: 1000,
      offering_price: 50,
      offering_section: 100,
      offering_photo_ref: 500,
      offerings_items: 200,
      hours_key: 20,
      hours_value: 100,
      hours_keys: 32,
    }); // covers: AC-E17-2, AC-E17-3, AC-E17-4
  });

  // covers: AC-E17-1
  it('scarta un description da 900.000 caratteri senza lanciare e senza scriverlo nel brief', () => {
    const enorme = MARKER + 'x'.repeat(900_000);
    const base = emptyBrief('it');

    expect(() => applyBriefUpdate(base, { description: enorme })).not.toThrow(); // covers: AC-E17-1

    const { brief, rejected } = applyBriefUpdate(base, { description: enorme });
    expect(rejected).toContain('description'); // covers: AC-E17-1
    expect(brief.description).toBeUndefined(); // covers: AC-E17-1 — il valore fuori scala non entra
    expect(JSON.stringify(brief)).not.toContain(MARKER); // covers: AC-E17-1
  });

  // covers: AC-E17-2
  it('description: la lunghezza esatta del tetto passa, il tetto +1 fallisce indicando il campo', () => {
    const alLimite = BriefUpdateSchema.safeParse({
      description: 'x'.repeat(BRIEF_LIMITS.description),
    });
    expect(alLimite.success).toBe(true); // covers: AC-E17-2 — il confine e' incluso

    const oltre = BriefUpdateSchema.safeParse({
      description: 'x'.repeat(BRIEF_LIMITS.description + 1),
    });
    expect(oltre.success).toBe(false); // covers: AC-E17-2
    if (oltre.success) throw new Error('description oltre il tetto non doveva validare');
    expect(oltre.error.issues.some((issue) => issue.path.includes('description'))).toBe(true); // covers: AC-E17-2
  });

  // covers: AC-E17-3, AC-E17-4
  describe.each(CAP_CASES)('$label', (caso) => {
    // covers: AC-E17-3, AC-E17-4
    it('oltre il tetto: applyBriefUpdate lo riporta in rejected[] senza lanciare', () => {
      const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), caso.overCap);
      expect(rejected).toContain(caso.field); // covers: AC-E17-3, AC-E17-4
      expect(brief).toEqual(emptyBrief('it')); // covers: AC-E17-3, AC-E17-4 — brief intatto
    });

    // covers: AC-E17-3, AC-E17-4
    it('oltre il tetto: BriefUpdateSchema e BriefSchema falliscono', () => {
      expect(BriefUpdateSchema.safeParse(caso.overCap).success).toBe(false); // covers: AC-E17-3, AC-E17-4
      expect(BriefSchema.safeParse(briefWith(caso.overCap)).success).toBe(false); // covers: AC-E17-3, AC-E17-4
    });

    // covers: AC-E17-6, AC-E17-8
    it('esattamente al tetto: le tre dichiarazioni lo accettano tutte', () => {
      // Guardia anti-placebo: se il rifiuto sopra valesse anche al confine, il tetto
      // sarebbe piu' stretto di quello deciso. Le tre dichiarazioni devono coincidere.
      expect(applyBriefUpdate(emptyBrief('it'), caso.atCap).rejected).toEqual([]); // covers: AC-E17-6 — CORE/CONTENT_FIELD_SCHEMAS
      expect(BriefUpdateSchema.safeParse(caso.atCap).success).toBe(true); // covers: AC-E17-6
      expect(BriefSchema.safeParse(briefWith(caso.atCap)).success).toBe(true); // covers: AC-E17-6
    });
  });

  // covers: AC-E17-5
  it('non tronca: il campo conserva il valore precedente e del nuovo non resta traccia', () => {
    const precedente = 'Storico bar del centro';
    const base = applyBriefUpdate(emptyBrief('it'), { description: precedente }).brief;

    const { brief, rejected } = applyBriefUpdate(base, {
      description: overCap(BRIEF_LIMITS.description),
      address: overCap(BRIEF_LIMITS.address),
    });

    expect(rejected).toContain('description'); // covers: AC-E17-5
    expect(rejected).toContain('address'); // covers: AC-E17-5
    expect(brief.description).toBe(precedente); // covers: AC-E17-5 — valore PRECEDENTE, non tagliato
    expect(brief.description).toHaveLength(precedente.length); // covers: AC-E17-5
    expect(brief.address).toBeUndefined(); // covers: AC-E17-5 — campo assente resta assente
    // Nessuna versione tagliata del valore nuovo da nessuna parte nel brief.
    expect(JSON.stringify(brief)).not.toContain(MARKER); // covers: AC-E17-5
    expect(JSON.stringify(brief)).not.toContain('xx'); // covers: AC-E17-5
  });

  // P1-D17 — il percorso di LETTURA, dichiarato: il tetto vale anche a leggere, e un
  // valore GIA' in tabella che lo sfonda SPARISCE dal brief. rowToBrief
  // (src/data/briefs.ts) ricostruisce il Brief da una riga con esattamente questa
  // chiamata e non propaga `rejected`, quindi la perdita non e' segnalata a nessuno.
  // Scelta ACCETTATA (fail-closed, come lo scarto in scrittura): questa asserzione la
  // PINNA, cosi' cambiarla e' una decisione e non una svista. Il giro completo per il DB
  // sta in briefs-actions (DB-backed): qui si pinna il meccanismo, che e' dove la perdita
  // accade.
  // NON si dica che "la riga in tabella non viene toccata": e' falso. La base di
  // upsertBrief e' lo stesso rowToBrief, che ha gia' scartato il valore, e briefToRow
  // riscrive ogni colonna — quindi il primo salvataggio del brief (con T-150, il primo
  // turno di chat) porta quel campo a NULL in tabella. Rischio LATENTE: nessun writer
  // applicativo scrive oltre il tetto, quindi la riga fuori scala oggi non esiste; vedi
  // la dichiarazione sopra rowToBrief in src/data/briefs.ts.
  it('lettura: un valore in tabella oltre il tetto sparisce dal brief, gli altri campi restano', () => {
    // La forma della patch che rowToBrief costruisce da una riga: colonne del brief,
    // con `description` scritta quando il tetto non c'era ancora.
    const rigaFuoriScala = {
      business_name: 'Bar Sole',
      description: overCap(BRIEF_LIMITS.description),
      locale: 'it',
    };

    const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), rigaFuoriScala);

    expect(rejected).toEqual(['description']); // P1-D17 — solo quel campo cade
    expect(brief.description).toBeUndefined(); // P1-D17 — il campo torna VUOTO, non troncato
    expect(brief.business_name).toBe('Bar Sole'); // P1-D17 — il resto della riga sopravvive
    expect(JSON.stringify(brief)).not.toContain(MARKER); // P1-D17 — nessun residuo del valore
    // Il brief ricostruito e' comunque valido: la lettura non restituisce mai un Brief
    // che il proprio schema rifiuterebbe.
    expect(BriefSchema.safeParse(brief).success).toBe(true); // P1-D17
  });

  // covers: AC-E17-4, AC-E17-5
  it('offerings: il tetto vale sul RISULTATO del merge, non solo sulla patch', () => {
    // Le offerings sono il solo campo che si fonde per ACCUMULO (name nuovo →
    // appende): tre patch da 200 voci con nomi tutti diversi sono conformi UNA PER
    // UNA, quindi validare la sola patch le lascia passare tutte e il brief arriva a
    // 600 voci con rejected vuoto. Percio' il caso e' a PIU' GIRI: la patch singola
    // (coperta sopra da CAP_CASES) non lo vede.
    const patchDelGiro = (giro: number) => ({
      offerings: items(BRIEF_LIMITS.offerings_items, (i) => ({ name: `g${giro}-voce ${i}` })),
    });

    // Primo giro: esattamente al tetto, deve passare (guardia anti-eccesso).
    const primo = applyBriefUpdate(emptyBrief('it'), patchDelGiro(0));
    expect(primo.rejected).toEqual([]); // covers: AC-E17-4
    expect(primo.brief.content.offerings).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-E17-4

    // Giri successivi: ogni patch e' conforme da sola, ma il merge sfonda il tetto →
    // SCARTATA, e il brief resta identico a prima del giro.
    let brief = primo.brief;
    for (const giro of [1, 2]) {
      const passo = applyBriefUpdate(brief, patchDelGiro(giro));
      expect(passo.rejected, `giro ${giro}`).toContain('offerings'); // covers: AC-E17-4
      expect(passo.brief, `giro ${giro}`).toEqual(brief); // covers: AC-E17-5 — array PRECEDENTE, non troncato
      brief = passo.brief;
    }

    // L'invariante che il difetto violava: cio' che applyBriefUpdate restituisce e'
    // sempre un Brief valido secondo il proprio schema.
    expect(brief.content.offerings).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-E17-4
    expect(BriefSchema.safeParse(brief).success).toBe(true); // covers: AC-E17-4
    // Delle patch scartate non resta traccia: nessuna voce dei giri 1 e 2 nel brief.
    expect(JSON.stringify(brief)).not.toContain('g1-'); // covers: AC-E17-5
    expect(JSON.stringify(brief)).not.toContain('g2-'); // covers: AC-E17-5

    // Anti-eccesso: al tetto, una patch che AGGIORNA voci esistenti (stesso name,
    // nessuna aggiunta) non fa crescere l'array e deve passare.
    const aggiornamento = applyBriefUpdate(brief, {
      offerings: [{ name: 'g0-voce 0', price: '1.20' }],
    });
    expect(aggiornamento.rejected).toEqual([]); // covers: AC-E17-4
    expect(aggiornamento.brief.content.offerings).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-E17-4
    expect(aggiornamento.brief.content.offerings[0].price).toBe('1.20'); // covers: AC-E17-4
  });

  // covers: AC-E17-6
  it('i limiti vivono in una sola definizione: nessun literal duplicato nel sorgente', () => {
    // Ogni numero di BRIEF_LIMITS compare nel sorgente tante volte quante sono le
    // voci che lo usano (cioe' solo dentro BRIEF_LIMITS): se una dichiarazione
    // riscrivesse il numero a mano, il conteggio salirebbe.
    const valori = Object.values(BRIEF_LIMITS);
    for (const valore of new Set(valori)) {
      const attese = valori.filter((altro) => altro === valore).length;
      const trovate = briefSource.match(new RegExp(`\\b${valore}\\b`, 'g'))?.length ?? 0;
      expect(trovate, `il limite ${valore} e ripetuto nel sorgente`).toBe(attese); // covers: AC-E17-6
    }
    // Nessun .max() con un numero scritto a mano: tutti derivano dalle costanti.
    expect(briefSource).not.toMatch(/\.max\(\s*\d/); // covers: AC-E17-6
  });

  // P1-D20 — guardia di regressione sul sottoinsieme dello strict tool use. Se
  // qualcuno rimette un maxLength/maxItems (o un altro vincolo fuori sottoinsieme),
  // anche annidato in fondo a un `items`, questo test deve morire.
  it('nessuno schema di tool passato al confine LLM esce dal sottoinsieme dello strict tool use', async () => {
    const tools = await toolsDichiaratiAlModello();

    // Anti-placebo: senza tool da scandire la scansione sarebbe vuota, e verde per il
    // motivo sbagliato. Sono i tool dei due percorsi che in P1 parlano col modello.
    expect(tools.map((tool) => ('name' in tool ? tool.name : '')).sort()).toEqual([
      'extract_brief',
      'mark_ready_for_review',
      'update_brief',
    ]); // P1-D20

    expect(keywordNonSupportate(tools)).toEqual([]); // P1-D20
  });

  // P1-D20, in luogo dell'annullato AC-E17-7: il motivo della clausola 4 di P1-D17
  // resta valido (la chat scarta l'INTERA tool-call su un solo campo invalido), e la
  // mitigazione si sposta nella description — prosa, sempre ammessa.
  it('il tool update_brief dichiara i tetti al modello nella description, derivandoli dalle costanti', async () => {
    const tool = (await toolsDichiaratiAlModello()).find(
      (candidate): candidate is Anthropic.Tool =>
        'input_schema' in candidate && candidate.name === 'update_brief',
    );
    if (tool === undefined) throw new Error('update_brief non e dichiarato al modello');
    const description = tool.description ?? '';

    // Solo i campi di testo libero, dove il modello puo' davvero sforare: venti
    // numeri in un prompt sarebbero rumore. I numeri sono confrontati con le
    // costanti, quindi una description che li riscrivesse a mano e poi divergesse
    // direbbe al modello un limite che la validazione non applica.
    expect(description).toContain(String(BRIEF_LIMITS.description)); // P1-D20
    expect(description).toContain(String(BRIEF_LIMITS.brand_hints)); // P1-D20
    expect(description).toContain(String(BRIEF_LIMITS.offering_description)); // P1-D20
  });

  // covers: AC-E17-8
  it('non-regressione: i brief legittimi dei test esistenti continuano a passare', () => {
    const barSole = {
      business_name: 'Bar Sole',
      vertical: 'ristorazione',
      primary_goal: 'contatta',
      locale: 'it',
      content: { offerings: [{ name: 'Caffe' }], social_links: [], highlights: [] },
    };
    expect(BriefSchema.safeParse(barSole).success).toBe(true); // covers: AC-E17-8

    const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), {
      business_name: 'Bar Sole',
      vertical: 'ristorazione',
      description: 'Storico bar del centro, aperto dal 1953. Caffe, cornetti e aperitivi.',
      address: 'Via Roma 1, 00100 Roma',
      phone: '+39 06 000 0000',
      whatsapp: '+39 333 000 0000',
      email: 'info@barsole.example',
      primary_goal: 'contatta',
      hours: { mo: '07:00-20:00', tu: '07:00-20:00', we: '07:00-20:00', su: 'chiuso' },
      offerings: [
        { name: 'Caffe', price: '1.20' },
        { name: 'Cornetto', price: '1.40', section: 'Colazione' },
        { name: 'Aperitivo', description: 'Spritz con tagliere', price: '8.00' },
      ],
      social_links: ['https://instagram.com/barsole', 'https://facebook.com/barsole'],
      highlights: ['Aperto dal 1953', 'Dehors in piazza', 'Wi-Fi gratis'],
      brand_hints: 'Toni caldi, legno e ottone, atmosfera anni cinquanta.',
    });

    expect(rejected).toEqual([]); // covers: AC-E17-8 — nessun falso rifiuto
    expect(brief.business_name).toBe('Bar Sole'); // covers: AC-E17-8
    expect(brief.content.offerings).toHaveLength(3); // covers: AC-E17-8
    expect(brief.hours?.mo).toBe('07:00-20:00'); // covers: AC-E17-8
  });
});
