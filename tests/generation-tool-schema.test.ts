import { describe, it, expect, afterEach, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { POOL_LIMITS } from '@/domain/generation/pool';
import { SLOTS } from '@/domain/generation/slots';
import type { SlotId } from '@/domain/generation/slots';
import { buildPoolTool } from '@/domain/generation/tool';

// T-222 (P2, macrotask generation-llm) — il tool strict del pool e la guardia di
// conformita' al sottoinsieme JSON Schema. Le asserzioni derivano dagli
// acceptance_criteria AC-222-1..5 (docs/blueprint/P2-generation/03-generation-llm.md).
// Dominio PURO: nessuna chiave API, nessuna rete, nessun client SDK — qui si ispeziona
// un OGGETTO.
//
// PERCHE' LA GUARDIA CAMMINA L'OGGETTO E NON IL SORGENTE: i numeri della description
// sono DERIVATI da POOL_LIMITS e le property sono derivate dal catalogo, quindi il
// sorgente non dice quali finiscono davvero nello schema (stessa lezione di P1-D20).
// L'unica ispezione che vale e' quella su cio' che T-224 passerebbe al confine.
//
// COSA QUESTO FILE NON PUO' PROVARE, dichiarato: che l'API reale accetti questo schema.
// Non esiste una chiave (P2 §6-bis / out_of_scope di T-222). La guardia prova la
// conformita' al sottoinsieme ACCERTATO da P1-D20, che e' la miglior approssimazione
// disponibile — non un via libera dell'API.
//
// Disciplina delle fixture (spec di design §9): piu' di un elemento, valori DISCORDANTI
// e identificatori in cui uno e' PREFISSO dell'altro — fra gli slot (`hero_title` /
// `hero_title_kicker`) e fra gli slug (`offerte` / `offerte-speciali`).
//
// E LA COPPIA-PREFISSO DEVE AVERE QUALCOSA DA FAR SBAGLIARE, altrimenti e' disciplina
// applicata alla lettera e vuota. I due lati non fanno lo stesso lavoro:
// - SLOT: qui un confronto col catalogo esiste davvero (`SLOTS.filter`), ma sbaglia solo
//   quando UNO SOLO dei due membri e' richiesto. Con entrambi nel turno — come in
//   SLOT_DEL_TURNO e in TRE_SLOT — prefisso e uguaglianza danno lo STESSO insieme, e
//   infatti le due mutazioni con startsWith sopravvivevano a suite verde. Per questo
//   esistono le chiamate a un solo slot piu' sotto: sono l'unica condizione in cui un
//   confronto per prefisso si vede mentre sbaglia.
// - SLUG: nessun confronto, l'enumerazione e' pura (`Object.fromEntries`). La coppia
//   sorveglia il COLLASSO: due slug che condividono un prefisso devono restare due
//   property distinte, e una chiave costruita per troncamento ne perderebbe una.

// I quattro slot del turno: coprono tutti e tre i kind del catalogo e comprendono
// `faq_items` (kind 'qa'), che e' l'unico a produrre un oggetto annidato a due livelli —
// cioe' il nodo su cui AC-222-1 si gioca.
const SLOT_DEL_TURNO: readonly SlotId[] = [
  'hero_title_kicker',
  'hero_title',
  'about_points',
  'faq_items',
];

// I TRE slot di AC-222-4, di nuovo con la coppia in cui uno e' prefisso dell'altro.
const TRE_SLOT: readonly SlotId[] = ['hero_title', 'hero_title_kicker', 'faq_items'];

const SLUG_DEL_TURNO: readonly string[] = ['home', 'offerte', 'offerte-speciali'];

// Lo stesso turno con uno slug RIPETUTO: e' l'unico ingresso in cui la deduplica di
// buildPoolTool ha qualcosa da fare, e senza di esso un `required` con elementi ripetuti
// esce dal modulo senza che nulla diventi rosso.
const SLUG_RIPETUTI: readonly string[] = ['home', 'home', 'offerte'];

// I due membri della coppia-prefisso, richiesti UNO ALLA VOLTA. E' la condizione — e
// l'unica — in cui filtro-per-uguaglianza e filtro-per-prefisso danno insiemi diversi,
// nei due versi in cui il confronto puo' essere scritto storto.
const COPPIA_PREFISSO_DEGLI_SLOT = [
  { richiesto: 'hero_title', escluso: 'hero_title_kicker' },
  { richiesto: 'hero_title_kicker', escluso: 'hero_title' },
] as const satisfies readonly { richiesto: SlotId; escluso: SlotId }[];

// Il nome con cui T-224 riconosce il blocco tool_use (AC-224-2). E' un LETTERALE e non la
// costante importata dal modulo, perche' una costante importata seguirebbe un rename
// invece di prenderlo: e' il senso stesso di pinnare un handshake.
const NOME_ATTESO_DEL_TOOL = 'emit_pool';

// Le keyword FUORI dal sottoinsieme dello strict tool use (P1-D20). Non sono un elenco
// di stile: ciascuna, se presente, e' un 400 alla prima chiamata reale.
const KEYWORD_FUORI_SOTTOINSIEME = [
  'maxLength',
  'minLength',
  'maxItems',
  'minItems',
  'maximum',
  'minimum',
  'multipleOf',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'uniqueItems',
] as const;

// I riferimenti ricorsivi, nelle due grafie che le bozze di JSON Schema usano. Sono
// fuori sottoinsieme come le altre, e vanno cercati con lo stesso passo.
const RIFERIMENTI_RICORSIVI = ['$ref', '$defs', 'definitions'] as const;

const CHIAVI_VIETATE: readonly string[] = [...KEYWORD_FUORI_SOTTOINSIEME, ...RIFERIMENTI_RICORSIVI];

// P2-D4, verso "nessuna leva in uscita": i nomi che una property NON puo' portare. Un
// campo che ammettesse un URL, un frammento di HTML, un nome di blocco, di tema o un
// colore darebbe a un'iniezione riuscita nel brief un posto dove depositare la leva.
const NOMI_CHE_SAREBBERO_LEVE =
  /url|uri|href|src|link|html|script|style|colou?r|tema|theme|block|blocco/i;

type Nodo = { readonly percorso: string; readonly valore: Record<string, unknown> };

function eOggettoSemplice(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === 'object' && valore !== null && !Array.isArray(valore);
}

/**
 * TUTTI i nodi oggetto raggiungibili, con il percorso in cui compaiono. E' la guardia
 * eseguibile chiesta dalla definition_of_done: cammina RICORSIVAMENTE, attraversa anche
 * gli array (dove vivono gli `items`) e non si ferma al primo livello — il nodo che P1
 * aveva lasciato scoperto sta due livelli sotto.
 *
 * Lo schema della pagina e' lo STESSO oggetto per ogni slug: qui compare una volta per
 * ciascun percorso, ed e' voluto — il controllo deve valere in ogni punto in cui il nodo
 * si trova, non una volta sola.
 */
function nodiDi(valore: unknown, percorso: string): Nodo[] {
  if (Array.isArray(valore)) {
    return valore.flatMap((elemento, indice) => nodiDi(elemento, `${percorso}[${indice}]`));
  }
  if (!eOggettoSemplice(valore)) return [];
  return [
    { percorso, valore },
    ...Object.entries(valore).flatMap(([chiave, annidato]) =>
      nodiDi(annidato, `${percorso}.${chiave}`),
    ),
  ];
}

/** I nodi che dichiarano `type: 'object'`, cioe' quelli su cui vale l'invariante di AC-222-1. */
function nodiObject(schema: unknown): Nodo[] {
  return nodiDi(schema, '$').filter((nodo) => nodo.valore.type === 'object');
}

/**
 * I percorsi dei nodi object NON CHIUSI. Un nodo e' chiuso quando ha
 * `additionalProperties: false` E un `required` non vuoto, senza ripetizioni, che
 * COINCIDE COME INSIEME con le chiavi delle sue `properties` (emendamento P2-D28).
 *
 * Le due cose INSIEME, non una: lo strict tool use rifiuta con un 400 sia una property
 * fuori da `required` sia un nome in `required` che non e' una property, e quel 400 e'
 * invisibile a ogni oracolo senza chiave. Misurato: con il solo "required non vuoto",
 * QUATTRO mutazioni distinte passavano a suite verde (property in piu' nella coppia qa,
 * property in piu' alla radice, required uguale al page_role, required con gli slug
 * troncati). La ripetizione e' la quinta: `required` e' un array a cui JSON Schema impone
 * `uniqueItems`, quindi un duplicato e' lo stesso 400 con un'altra faccia.
 */
function nodiSenzaChiusura(schema: unknown): string[] {
  return nodiObject(schema)
    .filter((nodo) => {
      if (nodo.valore.additionalProperties !== false) return true;
      // Un `required` assente o non-array vale quanto un `required` vuoto: nodo aperto.
      const richiesti: readonly unknown[] = Array.isArray(nodo.valore.required)
        ? (nodo.valore.required as readonly unknown[])
        : [];
      if (richiesti.length === 0) return true;
      const nomiRichiesti = new Set(
        richiesti.filter((nome): nome is string => typeof nome === 'string'),
      );
      // Meno nomi che elementi = un duplicato (o un elemento che non e' un nome).
      if (nomiRichiesti.size !== richiesti.length) return true;
      const dichiarate = eOggettoSemplice(nodo.valore.properties)
        ? Object.keys(nodo.valore.properties)
        : [];
      return (
        dichiarate.length !== nomiRichiesti.size ||
        dichiarate.some((nome) => !nomiRichiesti.has(nome))
      );
    })
    .map((nodo) => nodo.percorso);
}

/**
 * Le chiavi fuori sottoinsieme trovate, col loro percorso. Il controllo e'
 * DELIBERATAMENTE grezzo — guarda OGNI chiave di OGNI nodo, senza distinguere una
 * keyword di schema dal nome di una property — perche' l'AC chiede che non compaiano
 * "in alcun punto". Il costo dichiarato: uno slot che si chiamasse `maxLength` sarebbe
 * un falso positivo. Non esiste nel catalogo, e nascerebbe comunque nel mirino.
 */
function chiaviVietateIn(schema: unknown): string[] {
  return nodiDi(schema, '$').flatMap((nodo) =>
    Object.keys(nodo.valore)
      .filter((chiave) => CHIAVI_VIETATE.includes(chiave))
      .map((chiave) => `${nodo.percorso}.${chiave}`),
  );
}

/** Il nodo le cui chiavi sono gli SLUG delle pagine, cioe' un dato e non una decisione di schema. */
const PERCORSO_DELLA_MAPPA_PAGINE = '$.properties.pages';

/**
 * I nomi di property che sono una DECISIONE di questo modulo: `pages`, gli id di slot del
 * catalogo e i due campi della coppia qa.
 *
 * La MAPPA delle pagine e' esclusa di proposito, ed e' una restrizione voluta: le sue
 * chiavi sono gli slug, che nascono dai DATI del brief via T-213 e non da una scelta di
 * schema. Un'attivita' che si chiamasse "Link Cafe" produrrebbe lo slug `link-cafe` e
 * renderebbe rosso il controllo di P2-D4 senza che nulla, nello schema, sia diventato una
 * leva: sarebbe un falso positivo su un dato. Cio' che P2-D4 sorveglia qui e' l'insieme
 * dei nomi che QUESTO modulo decide.
 */
function nomiDelleProperty(schema: unknown): string[] {
  return nodiObject(schema)
    .filter((nodo) => nodo.percorso !== PERCORSO_DELLA_MAPPA_PAGINE)
    .flatMap((nodo) =>
      eOggettoSemplice(nodo.valore.properties) ? Object.keys(nodo.valore.properties) : [],
    );
}

/** Copia INDIPENDENTE dello schema, per poterlo sfregiare senza toccare l'originale. */
function copiaDi(schema: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

/** Scende di una property, fallendo con un percorso leggibile invece che con `undefined`. */
function figlio(nodo: Record<string, unknown>, chiave: string): Record<string, unknown> {
  const proprieta = nodo.properties;
  if (!eOggettoSemplice(proprieta)) throw new Error(`nessuna mappa di property sopra '${chiave}'`);
  const trovato = proprieta[chiave];
  if (!eOggettoSemplice(trovato)) throw new Error(`property assente: '${chiave}'`);
  return trovato;
}

function schemaDi(tool: Anthropic.Tool): Record<string, unknown> {
  return tool.input_schema;
}

function schemaDellaPagina(tool: Anthropic.Tool, slug: string): Record<string, unknown> {
  return figlio(figlio(schemaDi(tool), 'pages'), slug);
}

describe('T-222 tool strict del pool: chiusura di ogni nodo e conformita al sottoinsieme', () => {
  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: togliere `required` (o
  // `additionalProperties: false`) da COPPIA_QA in src/domain/generation/tool.ts. E'
  // esattamente il rischio dichiarato e mai verificato di P1 §6-bis p.2, e nessuna
  // asserzione sul nodo radice se ne accorgerebbe.
  // covers: AC-222-1
  it('OGNI nodo object dello schema ha additionalProperties:false e un required che lo chiude, annidati compresi', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);
    const object = nodiObject(schemaDi(tool));

    // Guardia anti-vacuita', con la taglia DERIVATA e non pinnata a mano: radice +
    // mappa delle pagine + una pagina per slug + la coppia qa dentro ciascuna pagina.
    // Un walk che si fermasse al primo livello ne troverebbe 2, non 8.
    expect(object).toHaveLength(2 + SLUG_DEL_TURNO.length * 2); // covers: AC-222-1
    // E il nodo a DUE livelli e' stato davvero raggiunto, non solo contato.
    expect(
      object.some((nodo) => nodo.percorso.includes('faq_items') && nodo.percorso.includes('items')),
    ).toBe(true); // covers: AC-222-1

    expect(nodiSenzaChiusura(schemaDi(tool))).toEqual([]); // covers: AC-222-1

    // GUARDIA ANTI-PLACEBO: la stessa guardia, sullo stesso schema sfregiato nel solo
    // nodo annidato, deve NOMINARLO. Senza questo ramo un walk che non scende sarebbe
    // indistinguibile da uno che scende e non trova nulla.
    const sfregiato = copiaDi(schemaDi(tool));
    const coppiaQa = figlio(figlio(figlio(sfregiato, 'pages'), 'home'), 'faq_items').items;
    if (!eOggettoSemplice(coppiaQa)) throw new Error('la coppia qa non e un oggetto');
    delete coppiaQa.required;
    const trovati = nodiSenzaChiusura(sfregiato);
    expect(trovati.length).toBeGreaterThan(0); // covers: AC-222-1
    expect(trovati.every((percorso) => percorso.includes('faq_items'))).toBe(true); // covers: AC-222-1
  });

  // EMENDAMENTO P2-D28. `required` non vuoto non basta: deve COINCIDERE COME INSIEME con
  // le chiavi di `properties` di quel nodo. Lo strict tool use pretende le due cose
  // insieme, e ciascuno dei modi di sbagliare qui sotto e' un 400 alla prima chiamata
  // reale — invisibile a ogni oracolo senza chiave. Le tre guardie anti-placebo sono le
  // QUATTRO mutazioni che passavano a suite verde prima dell'emendamento: la property in
  // piu' alla RADICE, la property in piu' nel nodo ANNIDATO, e — nella stessa guardia,
  // perche' sono lo stesso errore — il `required` con la CARDINALITA' giusta e i nomi
  // sbagliati (il page_role al posto dell'id di slot, e gli slug troncati).
  // covers: AC-222-1
  it('il required di ogni nodo coincide come insieme con le chiavi delle sue property, radice compresa', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);
    expect(nodiSenzaChiusura(schemaDi(tool))).toEqual([]); // covers: AC-222-1

    // ANTI-PLACEBO 1 — la property in piu' alla RADICE, non richiesta. E' il nodo che
    // nessuna asserzione guardava: l'enumerazione esatta era solo al livello pagina.
    const conProprietaAllaRadice = copiaDi(schemaDi(tool));
    const radice = conProprietaAllaRadice.properties;
    if (!eOggettoSemplice(radice)) throw new Error('la radice non ha property');
    radice.notes = { type: 'string' };
    expect(nodiSenzaChiusura(conProprietaAllaRadice)).toEqual(['$']); // covers: AC-222-1

    // ANTI-PLACEBO 2 — la property in piu' nel nodo ANNIDATO due livelli sotto, dove il
    // rischio di P1 §6-bis p.2 vive per davvero.
    const conCoppiaAperta = copiaDi(schemaDi(tool));
    const coppiaQa = figlio(figlio(figlio(conCoppiaAperta, 'pages'), 'home'), 'faq_items').items;
    if (!eOggettoSemplice(coppiaQa)) throw new Error('la coppia qa non e un oggetto');
    const campiDellaCoppia = coppiaQa.properties;
    if (!eOggettoSemplice(campiDellaCoppia)) throw new Error('la coppia qa non ha property');
    campiDellaCoppia.image = { type: 'string' };
    expect(nodiSenzaChiusura(conCoppiaAperta)).toEqual([
      '$.properties.pages.properties.home.properties.faq_items.items',
    ]); // covers: AC-222-1

    // ANTI-PLACEBO 3 — la cardinalita' giusta con i nomi sbagliati: tanti nomi quante
    // sono le property, ma nessuno di quei nomi E' una property. Un controllo scritto
    // con toHaveLength non lo vede.
    const conNomiSbagliati = copiaDi(schemaDi(tool));
    const pagina = figlio(figlio(conNomiSbagliati, 'pages'), 'offerte');
    const proprieta = pagina.properties;
    if (!eOggettoSemplice(proprieta)) throw new Error("la pagina 'offerte' non ha property");
    pagina.required = Object.keys(proprieta).map((nome) => `${nome}_x`);
    expect(nodiSenzaChiusura(conNomiSbagliati)).toEqual(['$.properties.pages.properties.offerte']); // covers: AC-222-1
  });

  // NON deriva da un AC: e' l'invariante che il JSDoc di buildPoolTool dichiara ("i
  // duplicati collassano, perche' una property e' una sola"). `required` e' un array su
  // cui JSON Schema impone `uniqueItems`, quindi un elemento ripetuto e' lo stesso 400
  // degli altri, con un'altra faccia. Nessuna fixture passava mai uno slug ripetuto:
  // misurato, togliere la deduplica lasciava la suite verde.
  it('uno slug ripetuto in ingresso collassa in una sola property e in un solo nome richiesto', () => {
    // Anti-vacuita': lo slug ripetuto c'e' davvero, altrimenti la deduplica non avrebbe
    // nulla da fare e il caso non proverebbe niente.
    expect(new Set(SLUG_RIPETUTI).size).toBeLessThan(SLUG_RIPETUTI.length); // DoD T-222

    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_RIPETUTI);
    const pagine = figlio(schemaDi(tool), 'pages');
    const proprieta = pagine.properties;
    if (!eOggettoSemplice(proprieta)) throw new Error('la mappa delle pagine non ha property');

    expect(Object.keys(proprieta)).toEqual(['home', 'offerte']); // DoD T-222
    expect(pagine.required).toEqual(['home', 'offerte']); // DoD T-222
    // E la guardia generale tace anche qui: e' la stessa che rifiuta le ripetizioni.
    expect(nodiSenzaChiusura(schemaDi(tool))).toEqual([]); // DoD T-222
  });

  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: aggiungere `maxLength: POOL_LIMITS.text` allo
  // schema del kind 'text' in tool.ts — cioe' la scorciatoia che verrebbe naturale a chi
  // volesse far rispettare i tetti dallo schema invece che da parsePool.
  // covers: AC-222-2
  it('nessuna keyword fuori dal sottoinsieme di P1-D20 e nessun riferimento ricorsivo compare nello schema', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);

    // Guardia anti-vacuita': l'elenco delle chiavi vietate e la taglia del walk sono
    // DICHIARATI separatamente, cosi' che un elenco svuotato non passi per un walk vuoto.
    expect(KEYWORD_FUORI_SOTTOINSIEME).toHaveLength(10); // covers: AC-222-2
    expect(RIFERIMENTI_RICORSIVI).toHaveLength(3); // covers: AC-222-2
    expect(nodiDi(schemaDi(tool), '$').length).toBeGreaterThan(nodiObject(schemaDi(tool)).length); // covers: AC-222-2

    expect(chiaviVietateIn(schemaDi(tool))).toEqual([]); // covers: AC-222-2
    // Seconda rete, indipendente dal walk: nemmeno nella serializzazione — e' la forma
    // in cui l'oggetto raggiunge davvero l'API.
    const serializzato = JSON.stringify(tool);
    for (const chiave of CHIAVI_VIETATE) {
      expect(serializzato.includes(`"${chiave}"`), `${chiave} presente nel tool`).toBe(false); // covers: AC-222-2
    }

    // GUARDIA ANTI-PLACEBO: sfregiando il nodo piu' profondo, la guardia lo trova.
    const sfregiato = copiaDi(schemaDi(tool));
    const coppiaQa = figlio(figlio(figlio(sfregiato, 'pages'), 'offerte'), 'faq_items').items;
    if (!eOggettoSemplice(coppiaQa)) throw new Error('la coppia qa non e un oggetto');
    figlio(coppiaQa, 'answer').maxLength = POOL_LIMITS.qa_answer;
    expect(chiaviVietateIn(sfregiato)).not.toEqual([]); // covers: AC-222-2
  });

  // covers: AC-222-4
  it('lo schema della pagina enumera esattamente i tre slot richiesti, e nessun altro del catalogo', () => {
    const tool = buildPoolTool(TRE_SLOT, SLUG_DEL_TURNO);

    // Guardia anti-vacuita': il catalogo ha piu' slot di quelli richiesti, altrimenti
    // "non compare alcuno slot ulteriore" sarebbe vero per mancanza di candidati.
    expect(SLOTS.length).toBeGreaterThan(TRE_SLOT.length); // covers: AC-222-4

    const esclusi = SLOTS.map((slot) => slot.id).filter((id) => !TRE_SLOT.includes(id));
    expect(esclusi.length).toBeGreaterThan(0); // covers: AC-222-4

    for (const slug of SLUG_DEL_TURNO) {
      const pagina = schemaDellaPagina(tool, slug);
      const proprieta = pagina.properties;
      if (!eOggettoSemplice(proprieta)) throw new Error(`pagina '${slug}' senza property`);

      // UGUAGLIANZA DEGLI INSIEMI, non inclusione: uno slot in piu' e' rosso quanto uno
      // in meno.
      expect(Object.keys(proprieta).sort()).toEqual([...TRE_SLOT].sort()); // covers: AC-222-4
      expect(pagina.required).toHaveLength(TRE_SLOT.length); // covers: AC-222-4
      for (const id of esclusi) {
        expect(Object.keys(proprieta), `slot ulteriore su '${slug}'`).not.toContain(id); // covers: AC-222-4
      }
    }
  });

  // LA COPPIA-PREFISSO RESA OSSERVABILE. Un turno che chiede ENTRAMBI i membri non
  // distingue il confronto per uguaglianza da quello per prefisso: i due producono lo
  // stesso insieme, e infatti le due mutazioni con startsWith sopravvivevano a suite
  // verde. Qui ne viene chiesto UNO SOLO, nei due versi in cui il confronto puo' essere
  // scritto storto — e con il mutante l'altro membro non solo entra nello schema, ma vi
  // entra OBBLIGATORIO: il modello sarebbe costretto a scrivere il contenuto di un blocco
  // che questo turno non ha mai chiesto.
  // covers: AC-222-4
  it('richiedendo un solo membro della coppia-prefisso, l altro non entra ne fra le property ne fra i richiesti', () => {
    for (const { richiesto, escluso } of COPPIA_PREFISSO_DEGLI_SLOT) {
      // Anti-vacuita': sono due slot DIVERSI del catalogo e uno e' davvero prefisso
      // dell'altro, altrimenti il caso non metterebbe alla prova nulla.
      const idDelCatalogo = SLOTS.map((slot) => slot.id);
      expect(idDelCatalogo, `'${richiesto}' fuori catalogo`).toContain(richiesto); // covers: AC-222-4
      expect(idDelCatalogo, `'${escluso}' fuori catalogo`).toContain(escluso); // covers: AC-222-4
      expect(
        richiesto.startsWith(escluso) || escluso.startsWith(richiesto),
        `'${richiesto}' e '${escluso}' non sono una coppia-prefisso`,
      ).toBe(true); // covers: AC-222-4

      const tool = buildPoolTool([richiesto], SLUG_DEL_TURNO);
      for (const slug of SLUG_DEL_TURNO) {
        const pagina = schemaDellaPagina(tool, slug);
        const proprieta = pagina.properties;
        if (!eOggettoSemplice(proprieta)) throw new Error(`pagina '${slug}' senza property`);

        expect(Object.keys(proprieta), `su '${slug}' e entrato '${escluso}'`).toEqual([richiesto]); // covers: AC-222-4
        expect(pagina.required, `su '${slug}' e obbligatorio '${escluso}'`).toEqual([richiesto]); // covers: AC-222-4
      }
    }
  });

  // covers: AC-222-5
  it('il tool dichiara strict: true', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);
    expect(tool.strict).toBe(true); // covers: AC-222-5
  });

  // NON deriva da un AC: e' la definition_of_done ("un oggetto tool", "lo schema enumera
  // esattamente gli slot passati"), nella parte che gli AC danno per scontata. Senza
  // queste righe un tool senza nome, o con le pagine non enumerate, resterebbe verde.
  it('la forma del tool: nome, schema object e pagine enumerate per uguaglianza esatta', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);

    // IL NOME E' L'HANDSHAKE COL CONFINE: T-224 riconosce il blocco tool_use da QUESTO
    // nome (AC-224-2), e un rename qui lo romperebbe senza produrre rosso da nessuna
    // parte — misurato: rinominare il tool lasciava verdi tutti e 86 i test del
    // macrotask, T-224 compreso. `name.length > 0` non pinnava niente.
    expect(tool.name).toBe(NOME_ATTESO_DEL_TOOL); // DoD T-222
    expect(schemaDi(tool).type).toBe('object'); // DoD T-222
    expect(schemaDi(tool).required).toEqual(['pages']); // DoD T-222

    const pagine = figlio(schemaDi(tool), 'pages');
    const proprieta = pagine.properties;
    if (!eOggettoSemplice(proprieta)) throw new Error('la mappa delle pagine non ha property');
    // 'offerte' e' PREFISSO di 'offerte-speciali'. Lato slug non c'e' alcun confronto da
    // far sbagliare — l'enumerazione e' pura (Object.fromEntries) —, ma la coppia
    // sorveglia il COLLASSO: due chiavi costruite per troncamento o per prefisso comune
    // diventerebbero UNA property sola, e una delle due pagine sparirebbe dallo schema.
    expect(Object.keys(proprieta).sort()).toEqual([...SLUG_DEL_TURNO].sort()); // DoD T-222
    expect(pagine.required).toHaveLength(SLUG_DEL_TURNO.length); // DoD T-222

    // Il kind del catalogo decide la forma del valore, e le tre forme sono DISCORDANTI
    // fra loro: una mappa che le confondesse non si vedrebbe con un solo kind di prova.
    const pagina = schemaDellaPagina(tool, 'home');
    expect(figlio(pagina, 'hero_title').type).toBe('string'); // DoD T-222 — kind 'text'
    const elenco = figlio(pagina, 'about_points');
    expect(elenco.type).toBe('array'); // DoD T-222 — kind 'list'
    expect(elenco.items).toEqual({ type: 'string' }); // DoD T-222
    const domande = figlio(pagina, 'faq_items');
    expect(domande.type).toBe('array'); // DoD T-222 — kind 'qa'
    if (!eOggettoSemplice(domande.items)) throw new Error('lo slot qa non ha items oggetto');
    expect(domande.items.type).toBe('object'); // DoD T-222
    expect(Object.keys(figlio(domande.items, 'question')).length).toBeGreaterThan(0); // DoD T-222
    expect(domande.items.required).toEqual(['question', 'answer']); // DoD T-222
  });

  // NON deriva da un AC: e' la security_note di P2-D4 ("nessuna leva in uscita"), che e'
  // un vincolo sul CODICE. Lo schema strict e' il contratto che limita cio' che il
  // modello puo' emettere: se una property ammettesse un URL o un nome di tema,
  // un'iniezione riuscita nel brief avrebbe dove depositare la leva.
  it('nessuna property ammette leve strutturali, e ogni foglia e testo (P2-D4)', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);

    const nomi = nomiDelleProperty(schemaDi(tool));
    expect(nomi.length).toBeGreaterThan(SLOT_DEL_TURNO.length); // DoD T-222 — anti-vacuita'
    // L'ESCLUSIONE E' DOVE DEVE ESSERE, e si vede: gli slug (che sono un dato del brief)
    // restano fuori, mentre `pages`, gli id di slot e i campi della coppia qa — cioe' i
    // nomi che questo modulo DECIDE — restano tutti sotto controllo. Senza queste righe
    // un filtro sbagliato potrebbe svuotare l'elenco e il ciclo qui sotto passerebbe per
    // mancanza di candidati.
    expect(nomi).toContain('pages'); // DoD T-222
    expect(nomi).toContain('faq_items'); // DoD T-222
    expect(nomi).toContain('question'); // DoD T-222
    for (const slug of SLUG_DEL_TURNO) {
      expect(nomi, `lo slug '${slug}' e un dato, non una decisione di schema`).not.toContain(slug); // DoD T-222
    }
    for (const nome of nomi) {
      expect(NOMI_CHE_SAREBBERO_LEVE.test(nome), `property con nome di leva: ${nome}`).toBe(false); // DoD T-222
    }
    // Anti-placebo sulla regex: su un nome che E' una leva deve scattare.
    expect(NOMI_CHE_SAREBBERO_LEVE.test('hero_background_color')).toBe(true); // DoD T-222

    // I soli `type` presenti sono contenitore, contenitore e testo: nessun numero,
    // nessun booleano, nessun enum di nomi di blocco o di tema.
    const tipi = new Set(
      nodiDi(schemaDi(tool), '$')
        .map((nodo) => nodo.valore.type)
        .filter((tipo) => typeof tipo === 'string'),
    );
    expect([...tipi].sort()).toEqual(['array', 'object', 'string']); // DoD T-222
  });

  // NON deriva da un AC: e' il contratto che slots.ts dichiara nel JSDoc di
  // SlotDefinition — quel testo e' "destinato alla `description` del tool strict (T-222)"
  // — e che tool.ts ripete ("La `description` viene dal catalogo"). E' la sola guida che
  // il modello riceve su COSA scrivere in ciascuno slot: uno schema che gli consegnasse
  // property NUDE resterebbe verde qui, e la qualita' del copy non e' oracolabile a
  // valle. Misurato: il kind 'text' che perdeva `description: slot.description` passava.
  it('ogni slot porta nello schema la propria description del catalogo, non una riscritta', () => {
    const tool = buildPoolTool(SLOT_DEL_TURNO, SLUG_DEL_TURNO);
    const pagina = schemaDellaPagina(tool, 'home');

    for (const id of SLOT_DEL_TURNO) {
      const definizione = SLOTS.find((slot) => slot.id === id);
      if (!definizione) throw new Error(`slot fuori catalogo: '${id}'`);
      // Anti-vacuita': il catalogo ha davvero qualcosa da dire per questo slot, cosi' che
      // l'uguaglianza non sia fra due stringhe vuote.
      expect(definizione.description.length, `catalogo muto su '${id}'`).toBeGreaterThan(0); // DoD T-222
      expect(figlio(pagina, id).description, `description di '${id}'`).toBe(
        definizione.description,
      ); // DoD T-222
    }
  });

  // NON deriva da un AC: e' l'invariante che la definition_of_done dichiara ("un array
  // required non vuoto"), nel solo caso in cui la costruzione potrebbe violarlo da sola.
  it('rifiuta un turno senza slot del catalogo o senza pagine, invece di emettere un required vuoto', () => {
    expect(() => buildPoolTool([], SLUG_DEL_TURNO)).toThrow(); // DoD T-222
    expect(() => buildPoolTool(SLOT_DEL_TURNO, [])).toThrow(); // DoD T-222
  });
});

// ---------------------------------------------------------------------------
// AC-222-3 — LA DESCRIPTION DERIVA DA POOL_LIMITS.
//
// Il modulo si rigenera contro un DOPPIO di pool.ts (vi.doMock + vi.resetModules +
// import dinamico), perche' e' l'unico modo di distinguere una description DERIVATA da
// una che ripete gli stessi numeri come letterali: entrambe, contro il modulo vero,
// direbbero 600. Il describe qui sopra continua a usare il modulo REALE.

const CHIAVI_DEI_TETTI = [
  'text',
  'list_item',
  'list_items',
  'qa_question',
  'qa_answer',
  'qa_pairs',
] as const;

// Valori del doppio: tutti DISCORDANTI fra loro, tutti diversi da quelli veri, e
// nessuno sottostringa di un altro (68 dentro 4321 renderebbe la ricerca ambigua).
const LIMITI_DEL_DOPPIO: Record<keyof typeof POOL_LIMITS, number> = {
  text: 4321,
  list_item: 777,
  list_items: 68,
  qa_question: 91,
  qa_answer: 1234,
  qa_pairs: 55,
  error_issues: 24,
  error_chars: 120,
};

/** Il numero compare come numero INTERO, non come sottostringa di un altro. */
function riporta(descrizione: string, valore: number): boolean {
  return new RegExp(`(?<!\\d)${valore}(?!\\d)`).test(descrizione);
}

// LA FRASE A CUI CIASCUN TETTO E' ATTACCATO. Cercare ogni numero nell'INTERA description
// prova che i numeri DERIVANO, non che stiano al posto giusto: misurato, scambiare
// qa_question e qa_answer lasciava la suite verde e il tool diceva al modello "ogni
// domanda al massimo 800 e ogni risposta al massimo 180". Sarebbe una divergenza REALE
// col gate — `parsePool` scarterebbe le risposte che seguono la guida —, silenziosa fino
// alla prima generazione rifiutata, cioe' esattamente il danno che il modulo dichiara di
// voler evitare. COSTO DICHIARATO: queste regex pinnano anche la FORMULA della frase, e
// riscriverla senza riattaccare il numero al proprio tetto e' rosso. E' il punto.
const FRASE_DEL_TETTO: Record<(typeof CHIAVI_DEI_TETTI)[number], RegExp> = {
  text: /ogni testo al massimo (\d+)/,
  list_item: /ogni voce di elenco al massimo (\d+)/,
  list_items: /al massimo (\d+) voci per elenco/,
  qa_question: /ogni domanda al massimo (\d+)/,
  qa_answer: /ogni risposta al massimo (\d+)/,
  qa_pairs: /al massimo (\d+) coppie/,
};

/** Il numero ATTACCATO alla frase di quel tetto, o null se la frase non compare. */
function tettoDetto(descrizione: string, chiave: (typeof CHIAVI_DEI_TETTI)[number]): number | null {
  const trovato = FRASE_DEL_TETTO[chiave].exec(descrizione);
  return trovato ? Number(trovato[1]) : null;
}

async function toolConLimiti(limiti: Record<keyof typeof POOL_LIMITS, number>) {
  vi.resetModules();
  vi.doMock('@/domain/generation/pool', () => ({ POOL_LIMITS: limiti }));
  const { buildPoolTool: costruisci } = await import('@/domain/generation/tool');
  return costruisci(SLOT_DEL_TURNO, SLUG_DEL_TURNO);
}

describe('T-222 la description dichiara i tetti derivandoli da POOL_LIMITS', () => {
  afterEach(() => {
    vi.doUnmock('@/domain/generation/pool');
    vi.resetModules();
  });

  // MUTAZIONE CHE LO FA DIVENTARE ROSSO: scrivere i numeri a mano nella description di
  // tool.ts ('ogni testo al massimo 600'). Contro il modulo vero resterebbe verde, ed e'
  // esattamente per questo che il doppio esiste.
  // covers: AC-222-3
  it('cambiando POOL_LIMITS in un doppio del modulo, i numeri della description cambiano di conseguenza', async () => {
    // Anti-vacuita': il doppio dice davvero altro. Se un valore coincidesse con quello
    // vero, la sua riga non distinguerebbe niente.
    for (const chiave of CHIAVI_DEI_TETTI) {
      expect(LIMITI_DEL_DOPPIO[chiave], `${chiave} non e cambiato`).not.toBe(POOL_LIMITS[chiave]); // covers: AC-222-3
    }

    const vero = await toolConLimiti(POOL_LIMITS);
    const doppio = await toolConLimiti(LIMITI_DEL_DOPPIO);

    for (const chiave of CHIAVI_DEI_TETTI) {
      // Il modulo vero riporta il valore vero...
      expect(riporta(vero.description ?? '', POOL_LIMITS[chiave]), `vero: ${chiave}`).toBe(true); // covers: AC-222-3
      // ...e il doppio riporta il proprio, mentre quello vero e SPARITO: e' la meta'
      // dell'asserzione che prende un letterale rimasto accanto al valore derivato.
      expect(
        riporta(doppio.description ?? '', LIMITI_DEL_DOPPIO[chiave]),
        `doppio: ${chiave}`,
      ).toBe(true); // covers: AC-222-3
      expect(riporta(doppio.description ?? '', POOL_LIMITS[chiave]), `letterale: ${chiave}`).toBe(
        false,
      ); // covers: AC-222-3

      // ...e ciascun numero e' ATTACCATO al proprio tetto, non solo presente da qualche
      // parte: due tetti scambiati fra loro sono due numeri veri al posto sbagliato.
      expect(tettoDetto(vero.description ?? '', chiave), `frase: ${chiave}`).toBe(
        POOL_LIMITS[chiave],
      ); // covers: AC-222-3
      expect(tettoDetto(doppio.description ?? '', chiave), `frase del doppio: ${chiave}`).toBe(
        LIMITI_DEL_DOPPIO[chiave],
      ); // covers: AC-222-3
    }

    expect(doppio.description).not.toBe(vero.description); // covers: AC-222-3
  });
});
