import { describe, it, expect } from 'vitest';
import { RECIPES, applyRecipe, recipeFor, type SiteRecipe } from '@/domain/generation/recipes';
import { BLOCKS, blocksFor, slotsForBlocks } from '@/domain/generation/blocks';
import { DOCUMENT_LIMITS, SiteDocumentSchema, parseDocument } from '@/domain/generation/document';
import { SLOTS, type PageRole, type SlotId } from '@/domain/generation/slots';
import { THEMES } from '@/domain/generation/themes';
import { applyBriefUpdate, emptyBrief, type Brief } from '@/domain/onboarding/brief';

// T-212 (macrotask generation-engine, P2) — LE CINQUE RICETTE, cioe' le direzioni fra cui
// l'utente scegle. Le asserzioni DERIVANO dagli acceptance_criteria AC-212-1..AC-212-5
// (docs/blueprint/P2-generation/02-generation-engine.md). I cinque describe in fondo sono
// dichiarati come oracoli AGGIUNTIVI e nominano cio' che provano: (1) la COERENZA fra
// ricetta e catalogo, il verso che AC-212-3 non copre; (2) l'assenza di DOPPIONI dentro una
// sequenza; (3) la COPERTURA del catalogo nei due versi; piu' la DECISIONE sul blocco
// recensioni resa visibile e la precondizione EREDITATA da T-202 sugli id versionati.
// Dominio puro: nessun DB, nessuna rete, nessun mock.
//
// L'ORDINE E' IL CUORE DEL TASK, e detta la forma di ogni confronto di questo file:
// AC-212-2 e AC-212-4 parlano entrambi di ordine, quindi si confrontano SEQUENZE
// (`toEqual` su array) e mai insiemi. Dove la differenza fra due ricette e' di solo
// ORDINE il test dichiara anche che gli INSIEMI sono UGUALI: e' la riga che rende
// osservabile un oracolo scritto coi Set, che su quelle coppie sarebbe cieco e passerebbe
// mentre le cinque direzioni si riducono a una sola permutata.
//
// CIO' CHE QUESTO FILE NON PROVA, scritto invece che sottinteso (L-COL-006): NON prova che
// le cinque direzioni siano BELLE, ne che il carattere dichiarato nel commento di ogni
// ricetta ("la vetrina", "il racconto di bottega", ...) sia quello che un occhio umano ci
// legge, ne che una sequenza converta meglio di un'altra. Lo stile non e' oracolabile
// (P1 §6-bis p.8) e i commenti del modulo NON sono asserzioni. Qui si giudica che le
// direzioni siano CINQUE (id distinti e versionati, cinque temi distinti), che siano
// DAVVERO DIVERSE come sequenze, che ogni riferimento a un blocco e a un ruolo di pagina
// esista e sia COERENTE col catalogo di T-210, e che la composizione scarti per
// precondizione conservando l'ordine dichiarato.
//
// CIO' CHE RESTA DICHIARATO E NON ASSERITO (declared coverage), scritto qui perche' chi
// rivede non debba scoprirlo da solo:
// - DOPPIONI: il vincolo "nessuna sequenza ripete un id" vale per LE CINQUE RICETTE DI
//   QUESTO CATALOGO, non per ogni `SiteRecipe` che un chiamante possa costruire.
//   `applyRecipe` NON deduplica, ed e' una SCELTA asserita piu' sotto: il doppione resta un
//   errore di DICHIARAZIONE con un solo giudice. Per T-214 — che riceve la ricetta dal
//   PROPRIO chiamante — "nessun doppione" e' percio' una PRECONDIZIONE, non un teorema.
// - RUOLO FUORI VOCABOLARIO: un `pageRole` che non sia uno dei sei e' IRRAPPRESENTABILE per
//   tipo (`PageRole` e' un'unione chiusa e `inner_page_rules` un record totale), quindi il
//   caso non e' scrivibile qui senza una forzatura. Se ne arrivasse uno da un artefatto
//   PERSISTITO (il `role` di una pagina del SiteDocument, T-202) `applyRecipe` LANCEREBBE
//   invece di restituire []: il gate e' `parseDocument` a monte, e non questo modulo.
// - IMMUTABILITA': il `readonly` di TypeScript e' del COMPILATORE, non del runtime. RECIPES,
//   le sue voci e le loro sequenze sono MUTABILI (`Object.isFrozen` e' falso su tutti e tre
//   i livelli), come THEMES in T-211. Nessun `Object.freeze` viene chiesto qui: sarebbe una
//   decisione di MACROTASK, da prendere insieme per i due cataloghi. Cio' che questo file
//   giudica e' che `applyRecipe` non muti le dichiarazioni (AC-212-5), non che nessun altro
//   POSSA mutarle.
// - LA BIIEZIONE CON I TEMI HA UN COSTO: il test chiede che le cinque direzioni ESAURISCANO
//   il catalogo di T-211, mentre AC-212-1 chiede solo cinque `theme_id` distinti. Un SESTO
//   tema in T-211 — modifica legittima che non tocca il contratto di T-212 — rende ROSSO
//   questo file. E' voluto (un tema che nessuna direzione usa e' codice morto in vetrina),
//   ed e' lo stesso costo del gemello sui blocchi, che e' dichiarato dove vive.
// - IL VOCABOLARIO DEI RUOLI e' letto da un PROXY (gli id distinti dei `page_role` di SLOTS)
//   perche' `PageRole` non e' enumerabile a runtime; la guardia che tiene insieme il proxy e
//   il tipo e' esplicita piu' sotto.
// - IDENTITA' PER RIFERIMENTO delle voci composte: NON giudicata, e la ragione e' misurata.
//   `applyRecipe` restituisce oggi le voci del catalogo, ma sostituirle con uno spread
//   superficiale (`{ ...blocco }`) lascia questo file interamente verde, e non per una
//   dimenticanza: `toEqual` e' un confronto STRUTTURALE, e uno spread superficiale condivide
//   con la voce originale ogni array e la closure `precondition`, quindi la copia e'
//   toEqual-uguale PER COSTRUZIONE. Non serve un `toBe` accanto: nessun AC di T-212 nomina
//   l'identita', e il consumatore (T-214) legge VALORI — `slots`, `brief_fields_rendered`,
//   `id` — che una copia superficiale porta identici. Il giorno in cui qualcuno volesse
//   appoggiarsi all'identita' (per esempio una Map con il blocco come chiave), quella
//   diventa una decisione da prendere e da asserire, e oggi non lo e'.

// ── fixture ──────────────────────────────────────────────────────────────────
// Correzione di metodo n.1 di P1 (il difetto ripetutosi TRE volte con la suite verde):
// PIU' DI UN ELEMENTO, valori DISCORDANTI, e almeno un id che sia PREFISSO di un altro.
//
// SULLA TERZA CONDIZIONE, detta per come stanno le cose invece di darla per fatta: nel
// catalogo delle ricette non e' costruibile. La forma dell'id versionato ('nome-kebab@N',
// T-202) impedisce che un id vero sia prefisso di un altro id vero, a meno di due versioni
// dello stesso nome — che sarebbero la stessa direzione due volte, non due direzioni. La
// trappola del prefisso e' percio' esercitata sui NEGATIVI di `recipeFor`, nei due versi:
// l'id troncato della versione (che e' PREFISSO di uno vero) e l'id con una cifra in piu'
// ('...@1' -> '...@10', di cui uno vero e' PREFISSO).

const CINQUE_OFFERTE = [
  { name: 'Tagliere', price: '12,00' },
  { name: 'Tagliere della casa', description: 'Selezione del giorno', section: 'Antipasti' },
  { name: 'Zuppa di ceci', price: '9,50', section: 'Primi' },
  { name: 'Acqua naturale' },
  { name: 'Caffe', price: '1,20' },
];

// Due chiavi con valori DISCORDANTI: un orario spezzato e uno continuato.
const ORARI = { 'lun-ven': '9:00-13:00 / 15:00-19:00', sabato: '9:00-13:00' };

// Il brief PIU' RICCO costruibile col Brief v1: ogni sorgente che un blocco del catalogo
// possa chiedere. E' il "brief ricco" del given di AC-212-2, e che lo sia davvero e'
// ASSERITO (non assunto) dal primo test della sezione AC-212-2.
const PATCH_RICCO: Record<string, unknown> = {
  business_name: 'Osteria del Ponte',
  vertical: 'ristorazione',
  description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
  address: 'Via dei Mille 4, Bologna',
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@osteriadelponte.it',
  primary_goal: 'prenota',
  highlights: ['Pasta fatta in casa', 'Cantina naturale', 'Dehors sul canale'],
  offerings: CINQUE_OFFERTE,
  hours: ORARI,
  geo: { lat: 44.4949, lng: 11.3426 },
  social_links: ['https://instagram.com/osteriadelponte', 'https://facebook.com/osteria'],
  brand_hints: 'tono caldo, niente superlativi',
};

/**
 * Costruisce un brief dalla patch ricca OMETTENDO i campi indicati. Si toglie per
 * OMISSIONE e non con la stringa vuota, e si passa dal VALIDATORE vero
 * (`applyBriefUpdate`): cosi' il brief sotto test e' un brief che il dominio accetta
 * davvero, non un oggetto scritto a mano che gli somiglia. Se una patch venisse SCARTATA
 * il caso proverebbe qualcosa di diverso da cio' che dichiara, quindi lo scarto e' rosso
 * qui.
 */
function briefCaso(omessi: readonly string[] = []): Brief {
  const patch: Record<string, unknown> = { ...PATCH_RICCO };
  for (const campo of omessi) delete patch[campo];
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

// I ruoli di pagina sono DERIVATI dal catalogo degli slot (T-201, contratto A MONTE): un
// ruolo nuovo la' entra da solo nelle iterazioni di questo file invece di restare fuori.
const RUOLI: readonly PageRole[] = [...new Set(SLOTS.map((slot) => slot.page_role))];

/**
 * IL VOCABOLARIO DEI RUOLI PRESO DAL TIPO, e non dal proxy (R-09). `RUOLI` qui sopra e' un
 * PROXY: gli id distinti dei `page_role` di SLOTS, perche' `PageRole` non e' enumerabile a
 * runtime. Oggi le due cose coincidono, ma un ruolo che nascesse in T-201 SENZA slot il
 * proxy lo perderebbe, e la diagnosi di questo file sarebbe ROVESCIATA: accuserebbe una
 * ricetta di citare un ruolo inesistente mentre il ruolo esiste.
 *
 * Il record e' TOTALE PER TIPO: un ruolo nuovo in T-201 non compila finche' non compare
 * anche qui, e allora il conteggio LETTERALE del test che lo usa diventa rosso e obbliga a
 * decidere invece di lasciare il vocabolario cambiare in silenzio.
 */
const RUOLI_DEL_TIPO: Record<PageRole, true> = {
  home: true,
  offerings: true,
  hours: true,
  contact: true,
  reviews: true,
  faq: true,
};

const RUOLO_HOME = 'home' satisfies PageRole;

function eRuoloInterno(ruolo: PageRole): ruolo is keyof SiteRecipe['inner_page_rules'] {
  return ruolo !== RUOLO_HOME;
}

const RUOLI_INTERNI = RUOLI.filter(eRuoloInterno);

function ids(blocchi: readonly { readonly id: string }[]): string[] {
  return blocchi.map((blocco) => blocco.id);
}

function bloccoDelCatalogo(id: string): (typeof BLOCKS)[number] {
  const trovato = BLOCKS.find((blocco) => blocco.id === id);
  if (!trovato) throw new Error(`blocco assente dal catalogo: ${id}`);
  return trovato;
}

/** Tutte le sequenze dichiarate da una ricetta, col nome del ruolo che le possiede. */
function sequenzeDi(recipe: SiteRecipe): readonly { nome: string; sequenza: readonly string[] }[] {
  return [
    { nome: 'home', sequenza: recipe.home_blocks },
    ...RUOLI_INTERNI.map((ruolo) => ({ nome: ruolo, sequenza: recipe.inner_page_rules[ruolo] })),
  ];
}

/**
 * Una ricetta di PROVA per i casi di AC-212-4: la sequenza della home e' l'unica cosa che
 * cambia da caso a caso. Le regole delle pagine interne sono quelle minime coerenti col
 * catalogo, perche' il tipo e' TOTALE sui ruoli interni e una regola mancante non
 * compilerebbe.
 */
function ricettaDiProva(id: string, home_blocks: readonly string[]): SiteRecipe {
  return {
    id,
    theme_id: 'linea-essenziale@1',
    home_blocks,
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['contatti'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  };
}

// ── le ricette attese, voce per voce ─────────────────────────────────────────
// La mappa e' LETTERALE e completa, scritta a mano: derivarla da RECIPES la renderebbe
// vera per costruzione. Le uniche derivazioni ammesse sono dai contratti A MONTE (BLOCKS,
// THEMES, PageRole, lo schema dell'id versionato di T-202).
//
// PERCHE' NON BASTA LA PROPRIETA' "le cinque sequenze sono diverse" (AC-212-2): scambiare
// fra loro le home di due ricette, o riassegnare un tema, conserva ogni differenza a
// coppie e non sposta nessun conteggio — e' l'ASSEGNAZIONE (quale direzione possiede quale
// sequenza e quale tema) che resterebbe senza giudice, la stessa classe di buco misurata in
// T-210. Qui l'assegnazione e' pinnata voce per voce, ORDINE COMPRESO.
//
// COSTO DICHIARATO: ritoccare una ricetta rende rosso questo file. E' voluto — una ricetta
// e' un artefatto che i siti gia' generati citano per id (P2-D21, e la versione e' DENTRO
// l'id proprio per questo), quindi cambiarne la sequenza senza alzare la versione e'
// esattamente la cosa che deve passare sotto gli occhi di chi rivede.
//
// Il tipo di `inner_page_rules` e' DERIVATO da quello del modulo, che a sua volta e' totale
// sui ruoli interni di T-201: un ruolo di pagina nuovo la' rompe il typecheck anche qui.

type RicettaAttesa = {
  readonly theme_id: string;
  readonly home_blocks: readonly string[];
  readonly inner_page_rules: Record<keyof SiteRecipe['inner_page_rules'], readonly string[]>;
};

const RICETTE_ATTESE: Record<string, RicettaAttesa> = {
  'vetrina-dell-offerta@1': {
    theme_id: 'sole-mediterraneo@1',
    home_blocks: ['hero', 'offerte', 'orari', 'chi-siamo', 'faq', 'contatti', 'cta-whatsapp'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['contatti', 'cta-whatsapp'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
  'racconto-di-bottega@1': {
    theme_id: 'bottega-artigiana@1',
    home_blocks: ['hero', 'chi-siamo', 'offerte', 'faq', 'contatti', 'orari', 'cta-whatsapp'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['contatti', 'cta-whatsapp'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
  'scatto-alla-conversione@1': {
    theme_id: 'scatto-vitale@1',
    home_blocks: ['hero', 'cta-whatsapp', 'offerte', 'chi-siamo', 'contatti', 'orari'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['cta-whatsapp', 'contatti'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
  'mappa-e-orari@1': {
    theme_id: 'brezza-costiera@1',
    home_blocks: ['hero', 'orari', 'contatti', 'offerte', 'chi-siamo', 'cta-whatsapp', 'faq'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['contatti', 'cta-whatsapp'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
  'scheda-sobria@1': {
    theme_id: 'linea-essenziale@1',
    home_blocks: ['hero', 'chi-siamo', 'faq', 'offerte', 'orari', 'contatti'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      contact: ['contatti', 'cta-whatsapp'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
};

// L'ORDINE di dichiarazione del catalogo, letterale: e' l'ordine in cui un'interfaccia
// offrira' le cinque direzioni. Non pinnarlo lascerebbe senza giudice un riordino, che e'
// una modifica visibile al prodotto.
const ORDINE_DICHIARATO = [
  'vetrina-dell-offerta@1',
  'racconto-di-bottega@1',
  'scatto-alla-conversione@1',
  'mappa-e-orari@1',
  'scheda-sobria@1',
];

function attesa(id: string): RicettaAttesa {
  const trovata = RICETTE_ATTESE[id];
  if (!trovata) throw new Error(`ricetta senza attesa dichiarata: ${id}`);
  return trovata;
}

// ── AC-212-1 — cinque direzioni, id versionati, cinque temi distinti ─────────

describe('T-212 RECIPES — cinque ricette con id distinti e versionati e temi distinti', () => {
  // covers: AC-212-1
  it('sono esattamente cinque, con id distinti, nell ordine dichiarato', () => {
    expect(RECIPES).toHaveLength(5); // covers: AC-212-1
    // L'ordine e l'IDENTITA' di ciascuna, non solo il conteggio: una ricetta sostituita da
    // un duplicato di un'altra conserverebbe il cinque.
    expect(RECIPES.map((ricetta) => ricetta.id)).toEqual(ORDINE_DICHIARATO); // covers: AC-212-1
    expect(new Set(RECIPES.map((ricetta) => ricetta.id)).size).toBe(5); // covers: AC-212-1
    // Una ricetta NUOVA senza la sua riga nella mappa attesa rende rosso questo file
    // invece di nascere con la propria sequenza e il proprio tema non giudicati.
    expect(new Set(Object.keys(RICETTE_ATTESE))).toEqual(new Set(RECIPES.map((r) => r.id)));
  });

  // covers: AC-212-1
  it('ciascuna cita un theme_id distinto dalle altre quattro, e ogni tema esiste in T-211', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-212-1

    // Gli id dei temi sono DERIVATI da T-211 (contratto A MONTE): un tema rinominato la'
    // rende rosso questo test invece di lasciare una ricetta che punta al nulla.
    const temiEsistenti = new Set(THEMES.map((tema) => tema.id));
    for (const ricetta of RECIPES) {
      expect(temiEsistenti.has(ricetta.theme_id), `${ricetta.id} -> ${ricetta.theme_id}`).toBe(
        true,
      ); // covers: AC-212-1
    }

    const temiCitati = RECIPES.map((ricetta) => ricetta.theme_id);
    // Il CINQUE e' letterale e non RECIPES.length: derivarlo dal catalogo che si sta
    // giudicando renderebbe la riga vera anche su un catalogo vuoto (0 === 0).
    expect(new Set(temiCitati).size, temiCitati.join(',')).toBe(5); // covers: AC-212-1
    // Ne segue una BIIEZIONE fra le cinque direzioni e i cinque temi: cinque temi distinti
    // scelti fra i cinque che esistono li esauriscono. Detto in una riga, cosi' che un tema
    // che nessuna direzione usa (codice morto in vetrina) sia rosso qui.
    expect(new Set(temiCitati)).toEqual(new Set(THEMES.map((tema) => tema.id))); // covers: AC-212-1
  });

  // covers: AC-212-1
  it('ogni ricetta porta ESATTAMENTE la sequenza, il tema e le regole che le competono', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-212-1

    for (const ricetta of RECIPES) {
      const sua = attesa(ricetta.id);
      expect(ricetta.theme_id, ricetta.id).toBe(sua.theme_id); // covers: AC-212-1
      // Uguaglianza su ARRAY, quindi ORDINE COMPRESO: e' la sequenza dichiarata, non
      // l'insieme dei blocchi.
      expect(ricetta.home_blocks, ricetta.id).toEqual(sua.home_blocks);
      // Le regole delle pagine interne, per OGGETTO INTERO: prende sia una regola
      // riscritta sia due regole scambiate fra due ruoli.
      expect(ricetta.inner_page_rules, ricetta.id).toEqual(sua.inner_page_rules);
    }
  });

  // covers: AC-212-1
  it('recipeFor trova ogni ricetta per id ESATTO, e nient altro (trappola del prefisso)', () => {
    // Il ciclo e' sull'elenco LETTERALE degli id: se `RECIPES` perdesse una voce, la
    // lookup del suo id diventerebbe undefined ed e' rosso qui.
    for (const id of ORDINE_DICHIARATO) {
      const trovata = recipeFor(id);
      expect(trovata, id).toBeDefined();
      expect(trovata?.id, id).toBe(id); // covers: AC-212-1
      expect(trovata?.theme_id, id).toBe(attesa(id).theme_id); // covers: AC-212-1
      expect(trovata?.home_blocks, id).toEqual(attesa(id).home_blocks); // covers: AC-212-1

      // NEGATIVO, primo verso: l'id troncato della versione e' PREFISSO di uno vero. Un
      // confronto scritto con startsWith invece che con uguaglianza lo accetterebbe, e
      // T-214 registrerebbe nel documento un id che nessuna versione ha mai prodotto.
      const senzaVersione = id.replace(/@[0-9]+$/, '');
      expect(senzaVersione, `id gia privo di versione: ${id}`).not.toBe(id);
      expect(recipeFor(senzaVersione), senzaVersione).toBeUndefined();
      // NEGATIVO, secondo verso: un id vero e' PREFISSO di questo ('...@1' -> '...@10').
      expect(recipeFor(`${id}0`), `${id}0`).toBeUndefined();
      // Il confronto e' anche CASE SENSITIVE: gli id sono minuscoli per forma (T-202).
      expect(recipeFor(id.toUpperCase()), id.toUpperCase()).toBeUndefined();
    }

    expect(recipeFor('')).toBeUndefined();
    // Le CHIAVI SPECIALI di JavaScript: se la lookup fosse un accesso a un oggetto
    // indicizzato per id, queste risolverebbero il membro EREDITATO da Object.prototype e
    // `recipeFor` restituirebbe qualcosa che non e' una ricetta.
    expect(recipeFor('__proto__')).toBeUndefined();
    expect(recipeFor('constructor')).toBeUndefined();
    expect(recipeFor('toString')).toBeUndefined();
  });
});

// ── AC-212-2 — le cinque sequenze sono diverse a due a due ───────────────────

// Le DIECI COPPIE, dichiarate a mano con il TESTIMONE della loro differenza e il suo
// GENERE. AC-212-2 chiede "l'ordine relativo o la presenza": sono due cose diverse e il
// test le tiene separate, perche' un confronto scritto "gli insiemi sono diversi" non prova
// NULLA sull'ordine e sarebbe cieco proprio sulle coppie che differiscono solo per esso.
//
// - 'ordine': le due sequenze hanno lo STESSO INSIEME di blocchi (asserito, cosi' la
//   cecita' di un oracolo coi Set e' dimostrata e non argomentata) e la coppia
//   `prima_in_a`/`dopo_in_a` compare in ordine INVERTITO fra le due.
// - 'presenza': `solo_in_a` e `solo_in_b` sono la differenza simmetrica ESATTA, in un verso
//   e nell'altro. L'elenco vuoto da un lato e' un'informazione, non una lacuna: dice che
//   quella ricetta non ha nulla che l'altra non abbia.
type DifferenzaAttesa =
  | { readonly tipo: 'ordine'; readonly prima_in_a: string; readonly dopo_in_a: string }
  | {
      readonly tipo: 'presenza';
      readonly solo_in_a: readonly string[];
      readonly solo_in_b: readonly string[];
    };

const DIFFERENZE_ATTESE: Record<string, DifferenzaAttesa> = {
  // La vetrina mette l'offerta davanti al racconto; la bottega fa il contrario. Stesso
  // insieme di sette blocchi: la direzione E' l'ordine.
  'vetrina-dell-offerta@1|racconto-di-bottega@1': {
    tipo: 'ordine',
    prima_in_a: 'offerte',
    dopo_in_a: 'chi-siamo',
  },
  'vetrina-dell-offerta@1|scatto-alla-conversione@1': {
    tipo: 'presenza',
    solo_in_a: ['faq'],
    solo_in_b: [],
  },
  // La vetrina apre con l'offerta e poi dice quando si mangia; mappa-e-orari inverte.
  'vetrina-dell-offerta@1|mappa-e-orari@1': {
    tipo: 'ordine',
    prima_in_a: 'offerte',
    dopo_in_a: 'orari',
  },
  'vetrina-dell-offerta@1|scheda-sobria@1': {
    tipo: 'presenza',
    solo_in_a: ['cta-whatsapp'],
    solo_in_b: [],
  },
  'racconto-di-bottega@1|scatto-alla-conversione@1': {
    tipo: 'presenza',
    solo_in_a: ['faq'],
    solo_in_b: [],
  },
  // La bottega racconta prima di dire gli orari; mappa-e-orari apre con gli orari.
  'racconto-di-bottega@1|mappa-e-orari@1': {
    tipo: 'ordine',
    prima_in_a: 'chi-siamo',
    dopo_in_a: 'orari',
  },
  'racconto-di-bottega@1|scheda-sobria@1': {
    tipo: 'presenza',
    solo_in_a: ['cta-whatsapp'],
    solo_in_b: [],
  },
  'scatto-alla-conversione@1|mappa-e-orari@1': {
    tipo: 'presenza',
    solo_in_a: [],
    solo_in_b: ['faq'],
  },
  // Le due direzioni piu' lontane fra loro: una spinge a scrivere subito e non fa domande,
  // l'altra risponde alle domande e non chiede nulla.
  'scatto-alla-conversione@1|scheda-sobria@1': {
    tipo: 'presenza',
    solo_in_a: ['cta-whatsapp'],
    solo_in_b: ['faq'],
  },
  'mappa-e-orari@1|scheda-sobria@1': {
    tipo: 'presenza',
    solo_in_a: ['cta-whatsapp'],
    solo_in_b: [],
  },
};

// Quante coppie differiscono per SOLO ORDINE. E' una guardia sul TEST e non sul modulo, ed
// e' bene sapere quale delle due cose e': dice che la copertura sull'ordine ESISTE. Senza
// questa riga un futuro ritocco alla tabella qui sopra potrebbe dichiarare tutte e dieci le
// coppie 'presenza' — un genere di differenza che un confronto fra insiemi vede — e il file
// resterebbe verde avendo perso l'unica cosa che AC-212-2 chiede di distinguere. Il MODULO
// resta comunque vincolato dal ciclo: una coppia dichiarata 'ordine' i cui blocchi cambiano
// di presenza fallisce sul confronto fra insiemi.
const COPPIE_DI_SOLO_ORDINE = 3;

describe('T-212 applyRecipe — le cinque home sono diverse a due a due, non solo per tema', () => {
  // covers: AC-212-2
  it('il brief ricco soddisfa la precondizione di OGNI blocco citato dalle cinque home', () => {
    // Il GIVEN di AC-212-2 e' ASSERITO e non assunto: se non lo fosse, le cinque sequenze
    // risultanti sarebbero diverse anche solo perche' un blocco e' caduto per mancanza di
    // dati, e il test proverebbe una cosa diversa da quella che dichiara.
    const ricco = briefCaso();
    const superstiti = new Set(ids(blocksFor(ricco, RUOLO_HOME)));
    const citati = new Set(RECIPES.flatMap((ricetta) => [...ricetta.home_blocks]));

    expect(citati.size, 'nessun blocco citato: il ciclo sarebbe vero per vacuita').toBeGreaterThan(
      1,
    ); // covers: AC-212-2
    for (const id of citati) {
      expect(superstiti.has(id), `blocco citato senza precondizione soddisfatta: ${id}`).toBe(true); // covers: AC-212-2
    }
    // E non e' vero per lassismo del catalogo: 'recensioni' NON e' fra i superstiti, ed e'
    // esattamente la ragione per cui nessuna home lo cita (vedi gli oracoli aggiuntivi).
    expect(superstiti.has('recensioni')).toBe(false); // covers: AC-212-2
  });

  // covers: AC-212-2
  it('le dieci coppie differiscono per ORDINE o per PRESENZA, col testimone dichiarato', () => {
    const ricco = briefCaso();
    const composte = new Map(
      RECIPES.map((ricetta) => [ricetta.id, ids(applyRecipe(ricetta, ricco, RUOLO_HOME))]),
    );

    const coppie: { chiave: string; a: string; b: string }[] = [];
    for (let i = 0; i < RECIPES.length; i += 1) {
      for (let j = i + 1; j < RECIPES.length; j += 1) {
        const a = RECIPES[i];
        const b = RECIPES[j];
        if (a && b) coppie.push({ chiave: `${a.id}|${b.id}`, a: a.id, b: b.id });
      }
    }

    // Le coppie sono DIECI: senza questo conteggio un catalogo ridotto renderebbe il ciclo
    // vero per vacuita' (con una sola ricetta le coppie sarebbero zero).
    expect(coppie).toHaveLength(10); // covers: AC-212-2
    // E sono ESATTAMENTE quelle dichiarate: una coppia senza testimone a mano rende rosso
    // questo test invece di passare senza giudice.
    expect(new Set(coppie.map((coppia) => coppia.chiave))).toEqual(
      new Set(Object.keys(DIFFERENZE_ATTESE)),
    );

    for (const { chiave, a, b } of coppie) {
      const seqA = composte.get(a) ?? [];
      const seqB = composte.get(b) ?? [];
      const differenza = DIFFERENZE_ATTESE[chiave];
      // IMPLICATA dall'uguaglianza fra gli insiemi di chiavi qui sopra (R-10): non e' un
      // oracolo indipendente. Resta perche' serve al restringimento di tipo della riga dopo e
      // perche' nomina cio' che il caso pretende — ogni coppia ha il suo testimone a mano.
      expect(differenza, chiave).toBeDefined();
      if (!differenza) continue;

      expect(seqA.length, chiave).toBeGreaterThan(0);
      // LA LETTERA DELL'AC: le due sequenze non sono la stessa sequenza.
      expect(seqA, chiave).not.toEqual(seqB); // covers: AC-212-2

      if (differenza.tipo === 'ordine') {
        // Gli INSIEMI sono UGUALI: qui un oracolo scritto coi Set sarebbe CIECO, e questa
        // riga lo dimostra invece di dirlo. La differenza puo' essere solo l'ordine.
        expect(new Set(seqA), chiave).toEqual(new Set(seqB)); // covers: AC-212-2
        expect(seqA, chiave).toContain(differenza.prima_in_a);
        expect(seqA, chiave).toContain(differenza.dopo_in_a);
        // L'ordine RELATIVO della coppia di blocchi e' invertito fra le due direzioni.
        expect(
          seqA.indexOf(differenza.prima_in_a) < seqA.indexOf(differenza.dopo_in_a),
          `${chiave}: in ${a} ${differenza.prima_in_a} non precede ${differenza.dopo_in_a}`,
        ).toBe(true); // covers: AC-212-2
        expect(
          seqB.indexOf(differenza.prima_in_a) > seqB.indexOf(differenza.dopo_in_a),
          `${chiave}: in ${b} ${differenza.prima_in_a} non segue ${differenza.dopo_in_a}`,
        ).toBe(true); // covers: AC-212-2
      } else {
        // La differenza simmetrica ESATTA, nei due versi: dice sia cosa c'e' in piu' sia
        // cosa manca, e l'ordine dell'elenco e' quello della sequenza di partenza.
        expect(
          seqA.filter((id) => !seqB.includes(id)),
          `${chiave}: solo in ${a}`,
        ).toEqual(differenza.solo_in_a); // covers: AC-212-2
        expect(
          seqB.filter((id) => !seqA.includes(id)),
          `${chiave}: solo in ${b}`,
        ).toEqual(differenza.solo_in_b); // covers: AC-212-2
        expect(
          differenza.solo_in_a.length + differenza.solo_in_b.length,
          `${chiave}: differenza di presenza vuota`,
        ).toBeGreaterThan(0); // covers: AC-212-2
      }
    }

    const soloOrdine = coppie.filter(
      (coppia) => DIFFERENZE_ATTESE[coppia.chiave]?.tipo === 'ordine',
    );
    expect(soloOrdine).toHaveLength(COPPIE_DI_SOLO_ORDINE); // covers: AC-212-2
  });

  // covers: AC-212-2
  it('ogni ricetta compone per ogni ruolo la sequenza che ha dichiarato (reviews esclusa)', () => {
    const ricco = briefCaso();
    expect(new Set(Object.keys(RICETTE_ATTESE))).toEqual(new Set(RECIPES.map((r) => r.id)));

    for (const ricetta of RECIPES) {
      const sua = attesa(ricetta.id);
      // La home passa da `home_blocks`, le altre pagine da `inner_page_rules`: due
      // sorgenti scambiate fra loro sono rosse qui.
      expect(ids(applyRecipe(ricetta, ricco, RUOLO_HOME)), `${ricetta.id}/home`).toEqual(
        sua.home_blocks,
      ); // covers: AC-212-2

      for (const ruolo of RUOLI_INTERNI) {
        // 'reviews' e' l'ECCEZIONE DICHIARATA e l'unico ruolo in cui il risultato NON
        // coincide con la regola: 'recensioni' non ha sorgente nel Brief v1 (T-210), quindi
        // la pagina non compone nulla nemmeno col brief piu' ricco. E' anche la riga che
        // rende ROSSA una `applyRecipe` che ignorasse le precondizioni: col brief ricco e'
        // il solo ruolo in cui si vede.
        const attesoRuolo = ruolo === 'reviews' ? [] : sua.inner_page_rules[ruolo];
        expect(ids(applyRecipe(ricetta, ricco, ruolo)), `${ricetta.id}/${ruolo}`).toEqual(
          attesoRuolo,
        ); // covers: AC-212-2
      }
    }
  });
});

// ── il PAYLOAD delle voci composte, non solo i loro id ───────────────────────
// R-01 — CIO' CHE NESSUN ORACOLO GUARDAVA. Del risultato di `applyRecipe` i test qui sopra
// leggono l'ID (attraverso `ids`) e `brief_fields_rendered`: gli SLOT e i RUOLI delle voci
// restavano senza giudice, e sono proprio il payload con cui il modulo giustifica la propria
// firma ("ritorna le voci del catalogo perche' T-214 ha bisogno di slots e
// brief_fields_rendered"). Una composizione che restituisse voci DEGRADATE del catalogo — gli
// slot svuotati, i ruoli riscritti — passava verde: con gli slot vuoti T-214 non riempirebbe
// alcuno slot, T-220 non riceverebbe alcun permesso di scrivere, e nulla in T-212 lo direbbe.
//
// L'UNIONE DEGLI SLOT E' SCRITTA A MANO, e non derivata dal catalogo ne dal risultato: e'
// cio' che T-220 mandera' al modello per quella pagina. Scritta letterale pinna insieme tre
// cose che una derivazione perderebbe — QUALI slot, in CHE ORDINE, e SENZA doppioni — e
// l'ordine e' quello di prima comparizione che `slotsForBlocks` promette (T-210), cioe'
// l'ordine della RICETTA e non quello del catalogo.
//
// COSTO DICHIARATO, lo stesso di RICETTE_ATTESE: ritoccare una sequenza rende rosse anche
// queste due tabelle. E' voluto — cambiare quali slot una pagina concede al modello e'
// esattamente cio' che deve passare sotto gli occhi di chi rivede.

const SLOTS_ATTESI_HOME: Record<string, readonly SlotId[]> = {
  'vetrina-dell-offerta@1': [
    'hero_title_kicker',
    'hero_title',
    'hero_subtitle',
    'offerings_title',
    'offerings_intro',
    'hours_title',
    'hours_intro',
    'about_title',
    'about_body',
    'about_points',
    'faq_title',
    'faq_items',
    'contact_title',
    'contact_intro',
    'whatsapp_cta_title',
  ],
  'racconto-di-bottega@1': [
    'hero_title_kicker',
    'hero_title',
    'hero_subtitle',
    'about_title',
    'about_body',
    'about_points',
    'offerings_title',
    'offerings_intro',
    'faq_title',
    'faq_items',
    'contact_title',
    'contact_intro',
    'hours_title',
    'hours_intro',
    'whatsapp_cta_title',
  ],
  // La home piu' CORTA delle cinque, e la sola in cui l'invito a scrivere apre: la
  // differenza fra le direzioni si vede anche negli slot, non solo negli id dei blocchi.
  'scatto-alla-conversione@1': [
    'hero_title_kicker',
    'hero_title',
    'hero_subtitle',
    'whatsapp_cta_title',
    'offerings_title',
    'offerings_intro',
    'about_title',
    'about_body',
    'about_points',
    'contact_title',
    'contact_intro',
    'hours_title',
    'hours_intro',
  ],
  'mappa-e-orari@1': [
    'hero_title_kicker',
    'hero_title',
    'hero_subtitle',
    'hours_title',
    'hours_intro',
    'contact_title',
    'contact_intro',
    'offerings_title',
    'offerings_intro',
    'about_title',
    'about_body',
    'about_points',
    'whatsapp_cta_title',
    'faq_title',
    'faq_items',
  ],
  // La sola home senza `whatsapp_cta_title`: la scheda sobria non porta la CTA, e lo si
  // vede nel permesso che il modello NON riceve per quella pagina.
  'scheda-sobria@1': [
    'hero_title_kicker',
    'hero_title',
    'hero_subtitle',
    'about_title',
    'about_body',
    'about_points',
    'faq_title',
    'faq_items',
    'offerings_title',
    'offerings_intro',
    'hours_title',
    'hours_intro',
    'contact_title',
    'contact_intro',
  ],
};

// La pagina CONTATTI, che e' l'unica pagina interna su cui una direzione ha una scelta vera:
// quattro direzioni mettono i recapiti prima dell'invito, lo scatto alla conversione lo
// rovescia — e la differenza arriva fino agli slot, nell'ordine.
const SLOTS_ATTESI_CONTACT: Record<string, readonly SlotId[]> = {
  'vetrina-dell-offerta@1': ['contact_title', 'contact_intro', 'whatsapp_cta_title'],
  'racconto-di-bottega@1': ['contact_title', 'contact_intro', 'whatsapp_cta_title'],
  'scatto-alla-conversione@1': ['whatsapp_cta_title', 'contact_title', 'contact_intro'],
  'mappa-e-orari@1': ['contact_title', 'contact_intro', 'whatsapp_cta_title'],
  'scheda-sobria@1': ['contact_title', 'contact_intro', 'whatsapp_cta_title'],
};

// Quante VOCI le cinque direzioni compongono in tutto col brief ricco, sui sei ruoli: 33
// sulle cinque home (7+7+6+7+6) piu' 5 per direzione sulle pagine interne (una per
// offerings, hours e faq, DUE su contact, ZERO su reviews). E' letterale perche' e' la
// guardia di vacuita' del ciclo qui sotto: una `applyRecipe` che restituisse sempre [] lo
// renderebbe vero senza ispezionare nulla.
const VOCI_COMPOSTE_IN_TUTTO = 58;

describe('T-212 applyRecipe — le voci composte sono quelle del CATALOGO, non copie degradate', () => {
  it('ogni voce composta e ESATTAMENTE la voce che il catalogo dichiara per quell id', () => {
    const ricco = briefCaso();
    let ispezionate = 0;

    for (const ricetta of RECIPES) {
      for (const ruolo of RUOLI) {
        for (const blocco of applyRecipe(ricetta, ricco, ruolo)) {
          // L'ATTESO VIENE DAL CATALOGO A MONTE (T-210) e mai dal risultato: l'uguaglianza
          // e' sulla VOCE INTERA, quindi in una riga pinna `slots`, `page_roles`,
          // `brief_fields_rendered` e anche la precondizione — che essendo una funzione e'
          // confrontata per RIFERIMENTO (misurato: una `precondition` sostituita nella voce
          // composta e' rossa qui). Prende MOD-29 (voce spreddata con `slots: []`) e MOD-33
          // (`page_roles` riscritti a ['home']), entrambe SOPRAVVISSUTE alla versione
          // precedente di questo file.
          // COSA QUESTA RIGA NON PUO' VEDERE, detto invece che sottinteso: una modifica al
          // CATALOGO (uno slot tolto a un blocco in T-210) cambia i due termini insieme e
          // resta verde. E' il buco che copre il test qui sotto, dove l'unione degli slot e'
          // scritta a mano — e la divisione dei compiti fra i due casi e' MISURATA: togliendo
          // 'hero_subtitle' al blocco hero in T-210, questo caso resta verde e quello cade.
          expect(blocco, `${ricetta.id}/${ruolo}/${blocco.id}`).toEqual(
            bloccoDelCatalogo(blocco.id),
          );
          ispezionate += 1;
        }
      }
    }

    expect(ispezionate).toBe(VOCI_COMPOSTE_IN_TUTTO);
  });

  it('gli SLOT che la pagina composta concede sono l unione attesa, in ordine', () => {
    const ricco = briefCaso();
    // Una ricetta nuova senza la sua riga nelle due tabelle rende rosso questo file invece
    // di nascere col proprio payload non giudicato.
    expect(new Set(Object.keys(SLOTS_ATTESI_HOME))).toEqual(new Set(RECIPES.map((r) => r.id)));
    expect(new Set(Object.keys(SLOTS_ATTESI_CONTACT))).toEqual(new Set(RECIPES.map((r) => r.id)));

    for (const ricetta of RECIPES) {
      // SI PASSA DAL CONTRATTO VERO che T-220 usera' (`slotsForBlocks`, T-210) invece di
      // leggere `blocco.slots` a mano: e' l'unione che il modello ricevera' per quella
      // pagina. Prende MOD-29 come la riga qui sopra, e in piu' l'ORDINE degli slot e
      // l'assenza di doppioni, che un'uguaglianza voce per voce non dice.
      expect(slotsForBlocks(applyRecipe(ricetta, ricco, RUOLO_HOME)), `${ricetta.id}/home`).toEqual(
        SLOTS_ATTESI_HOME[ricetta.id],
      );
      expect(
        slotsForBlocks(applyRecipe(ricetta, ricco, 'contact')),
        `${ricetta.id}/contact`,
      ).toEqual(SLOTS_ATTESI_CONTACT[ricetta.id]);
      // La pagina reviews non compone nulla, quindi non concede NESSUNO slot: e' il verso
      // per cui P2-D7 e' strutturale e non sperato — senza il blocco il modello non riceve
      // reviews_title ne reviews_intro e non ha la POSSIBILITA' di inventare testimonianze.
      // Che quei due slot esistano davvero nel catalogo e' asserito nella sezione dedicata
      // a quel nodo, quindi qui il vuoto non e' vero per assenza del contratto.
      expect(
        slotsForBlocks(applyRecipe(ricetta, ricco, 'reviews')),
        `${ricetta.id}/reviews`,
      ).toEqual([]);
    }
  });
});

// ── AC-212-3 — nessun riferimento pende ──────────────────────────────────────

describe('T-212 RECIPES — ogni id di blocco e ogni ruolo citati esistono', () => {
  // covers: AC-212-3
  it('ogni id di blocco citato esiste nel catalogo BLOCKS (T-210)', () => {
    const esistenti = new Set(BLOCKS.map((blocco) => blocco.id));
    let citazioni = 0;

    for (const ricetta of RECIPES) {
      for (const { nome, sequenza } of sequenzeDi(ricetta)) {
        for (const id of sequenza) {
          // Appartenenza per UGUAGLIANZA (Set.has), mai per prefisso.
          expect(esistenti.has(id), `${ricetta.id}/${nome}/${id}`).toBe(true); // covers: AC-212-3
          citazioni += 1;
        }
      }
    }

    // Il numero di citazioni ispezionate e' DICHIARATO: un catalogo di ricette vuoto, o una
    // ricetta con le sequenze svuotate, renderebbe il ciclo vero per vacuita'.
    expect(citazioni, 'poche citazioni: il ciclo sarebbe quasi vero per vacuita').toBeGreaterThan(
      30,
    ); // covers: AC-212-3
  });

  // covers: AC-212-3
  it('ogni ruolo di pagina citato esiste nel vocabolario di T-201, e nessuno resta senza regola', () => {
    // MISURATO nel passo rosso: senza questa riga il ciclo qui sotto passava su un catalogo
    // VUOTO. La guardia di vacuita' non e' cerimonia, e' cio' che era assente.
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-212-3
    const ruoli = new Set<string>(RUOLI);
    expect(ruoli.has(RUOLO_HOME)).toBe(true); // covers: AC-212-3 — il ruolo della home_blocks

    for (const ricetta of RECIPES) {
      const citati = Object.keys(ricetta.inner_page_rules);
      for (const ruolo of citati) {
        expect(ruoli.has(ruolo), `${ricetta.id}/${ruolo}`).toBe(true); // covers: AC-212-3
      }
      // Uguaglianza ESATTA coi ruoli INTERNI derivati da T-201: dice sia che nessun ruolo
      // citato pende, sia che nessun ruolo del vocabolario resta senza regola di
      // composizione — una pagina senza blocchi non e' un documento valido (T-202).
      expect(new Set(citati), ricetta.id).toEqual(new Set<string>(RUOLI_INTERNI)); // covers: AC-212-3
    }
  });

  it('i ruoli di pagina sono SEI, e il proxy derivato dagli slot li vede tutti', () => {
    // R-09 — LA GUARDIA LETTERALE CHE MANCAVA. Il file la ha per i blocchi (8) e per le
    // ricette (5), e non per i ruoli, che sono la terza cosa da cui dipende ogni ciclo qui
    // dentro. E' una guardia sul TERMINE DI CONFRONTO, non sul modulo: dice che il proxy
    // (`RUOLI`, dagli slot di T-201) e il TIPO (`PageRole`, chiuso) contengono le stesse sei
    // voci. La mutazione che prende sta A MONTE — un ruolo di T-201 che perdesse tutti i
    // suoi slot, o un ruolo nuovo dichiarato senza slot: il proxy si accorcerebbe, ogni
    // ciclo di questo file smetterebbe di guardare quel ruolo restando verde, e la diagnosi
    // arriverebbe rovesciata dal test di AC-212-3.
    // Il SEI e' LETTERALE: contarlo su SLOTS o su RUOLI lo renderebbe vero per costruzione.
    // DA SAPERE, per chi gira solo vitest: questa riga e' un oracolo del gate TYPECHECK, non
    // del gate dei test. RUOLI_DEL_TIPO e' un record TOTALE su PageRole, quindi un settimo
    // ruolo dichiarato la' non compila finche' non compare anche qui — ed e' li' che si vede.
    // MISURATO: con un settimo membro in PageRole questo file resta VERDE (30 passed) e
    // 'npm run typecheck' diventa rosso su questa riga. Non aspettarsi un rosso da vitest.
    expect(Object.keys(RUOLI_DEL_TIPO)).toHaveLength(6);
    expect(new Set<string>(RUOLI)).toEqual(new Set(Object.keys(RUOLI_DEL_TIPO)));
  });
});

// ── AC-212-4, AC-212-5 — lo scarto per precondizione, l'ordine, il determinismo ──

describe('T-212 applyRecipe — un blocco senza dati e SCARTATO e l ordine dichiarato resta', () => {
  // A = hero, B = orari, C = contatti. B cade quando il brief non ha `hours`, mentre A e C
  // restano: la sparizione e' attribuibile alla sola sorgente tolta (T-210 pinna che
  // `hours` regge il solo blocco orari).
  const ABC = ricettaDiProva('prova-abc@1', ['hero', 'orari', 'contatti']);

  // covers: AC-212-4
  it('[A,B,C] con la precondizione di B non soddisfatta da [A,C], nell ordine dichiarato', () => {
    // Il ramo POSITIVO, senza il quale il caso proverebbe solo che qualcosa sparisce: col
    // brief ricco la sequenza e' completa.
    expect(ids(applyRecipe(ABC, briefCaso(), RUOLO_HOME))).toEqual([
      'hero',
      'orari',
      'contatti',
    ]); // covers: AC-212-4

    const composto = ids(applyRecipe(ABC, briefCaso(['hours']), RUOLO_HOME));
    // Uguaglianza ESATTA: dice in una riga che B e' scartato, che NON e' sostituito da un
    // segnaposto (la lunghezza e' due) e che A e C non si riordinano.
    expect(composto).toEqual(['hero', 'contatti']); // covers: AC-212-4
    // LE DUE RIGHE QUI SOTTO SONO IMPLICATE dal `toEqual` esatto qui sopra (R-10): non sono
    // oracoli indipendenti, e nessuna mutazione le rende rosse senza rendere rossa anche
    // l'uguaglianza. Restano perche' NOMINANO la lettera dell'AC — "scartato" e "non
    // sostituito da un segnaposto" — e una revisione futura non deve contarle come copertura.
    expect(composto).toHaveLength(2); // covers: AC-212-4 — nessun segnaposto al posto di B
    expect(composto).not.toContain('orari'); // covers: AC-212-4
  });

  // covers: AC-212-4
  it("l ORDINE e' quello della RICETTA, non quello di dichiarazione del catalogo", () => {
    // IL CASO CHE NESSUN ALTRO VEDE. `applyRecipe` si appoggia a `blocksFor` (T-210), che
    // restituisce i superstiti nell'ordine di DICHIARAZIONE DEL CATALOGO: una composizione
    // che ereditasse quell'ordine invece di quello della ricetta supererebbe ogni controllo
    // scritto sugli insiemi, e le cinque direzioni sarebbero cinque volte la stessa pagina
    // con cinque temi diversi. La sequenza di prova e' il ROVESCIO esatto dell'ordine del
    // catalogo, cosi' la confusione fra i due e' massimamente visibile.
    const ricco = briefCaso();
    const ordineCatalogo = ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'];
    const rovesciato = [...ordineCatalogo].reverse();

    // L'ordine del catalogo, LETTERALE: e' cio' che T-210 promette di conservare e il
    // termine di confronto di questo caso.
    expect(ids(blocksFor(ricco, RUOLO_HOME))).toEqual(ordineCatalogo);

    const rovesciata = ricettaDiProva('prova-ordine-rovesciato@1', rovesciato);
    expect(ids(applyRecipe(rovesciata, ricco, RUOLO_HOME))).toEqual(rovesciato); // covers: AC-212-4
  });

  // covers: AC-212-4
  it('due scarti NON adiacenti: quello in testa e quello in mezzo, senza riordino', () => {
    // Gli scarti in posizioni diverse della sequenza (il primo elemento e il quarto)
    // prendono una composizione che tagli sempre in coda, o che ricompatti riordinando.
    // La sequenza e' una FIXTURE, non una direzione: 'faq' prima di 'hero' non e' una
    // pagina che qualcuno pubblicherebbe, ed e' proprio per questo che serve.
    const mista = ricettaDiProva('prova-scarti-multipli@1', [
      'orari',
      'faq',
      'hero',
      'cta-whatsapp',
      'contatti',
    ]);

    // Tolti `hours` (cade orari) e `whatsapp` (cade la CTA): la FAQ resta, perche' le sue
    // materie scendono da sei a cinque e la soglia di T-210 e' tre.
    const composto = ids(applyRecipe(mista, briefCaso(['hours', 'whatsapp']), RUOLO_HOME));
    expect(composto).toEqual(['faq', 'hero', 'contatti']); // covers: AC-212-4
    // Lo stesso insieme di superstiti, letto dal catalogo, avrebbe l'ordine OPPOSTO: e' la
    // riga che dimostra che il risultato qui sopra non e' l'ordine del catalogo per caso.
    expect(composto).not.toEqual(['hero', 'contatti', 'faq']); // covers: AC-212-4
  });

  // covers: AC-212-4
  it('il FILTRO SUL RUOLO e un CONTRATTO: su una pagina interna passa solo chi dichiara quel ruolo', () => {
    // R-03 — PERCHE' SERVE UN CASO COSTRUITO, e perche' non basta il caso che gia' c'e'.
    // Tutte e cinque le ricette citano, per ogni ruolo interno, esattamente i blocchi che
    // dichiarano quel ruolo: un test guidato da RECIPES non puo' distinguere una
    // `applyRecipe` che FILTRA per ruolo da una che il ruolo lo ignora. La sola copertura di
    // quel filtro stava nel caso "una citazione INCOERENTE sarebbe MUTA", che il file
    // presenta come ILLUSTRAZIONE di un difetto di dichiarazione: un futuro "ripulisci i
    // test costruiti a mano" l'avrebbe cancellata senza rendere niente rosso. Questo caso
    // nomina il filtro come contratto del MODULO, ed e' quello che prende MOD-16
    // (`blocksFor(brief, 'home')` al posto di `blocksFor(brief, pageRole)`).
    const ricco = briefCaso();
    const mescolata: SiteRecipe = {
      ...ricettaDiProva('prova-filtro-ruolo@1', ['hero', 'orari', 'faq']),
      inner_page_rules: {
        offerings: ['offerte'],
        // Tre blocchi che il brief ricco soddisfa TUTTI, di cui uno solo dichiara 'hours'.
        hours: ['hero', 'orari', 'faq'],
        contact: ['contatti'],
        reviews: ['recensioni'],
        faq: ['faq'],
      },
    };

    // I due fatti del catalogo A MONTE su cui il caso poggia, ASSERITI e non assunti: se
    // T-210 aprisse 'hero' o 'faq' al ruolo 'hours', l'atteso qui sotto sarebbe un altro e
    // questo file lo dice invece di sbagliare in silenzio.
    expect(bloccoDelCatalogo('hero').page_roles).toEqual(['home']);
    expect(bloccoDelCatalogo('faq').page_roles).toEqual(['faq', 'home']);

    // IL RAMO NEGATIVO: sulla pagina 'hours' resta il solo blocco che quel ruolo dichiara.
    expect(ids(applyRecipe(mescolata, ricco, 'hours'))).toEqual(['orari']); // covers: AC-212-4
    // IL RAMO POSITIVO, sullo STESSO BRIEF e sugli STESSI TRE BLOCCHI: sul ruolo 'home' li
    // dichiarano tutti e tre, e compaiono tutti e tre nell'ordine della ricetta. Cio' che li
    // fa sparire qui sopra e' dunque il RUOLO, non i dati ne l'ordine.
    expect(ids(applyRecipe(mescolata, ricco, RUOLO_HOME))).toEqual(['hero', 'orari', 'faq']); // covers: AC-212-4
  });

  // covers: AC-212-5
  it('due chiamate identiche danno lo stesso risultato e non toccano le dichiarazioni', () => {
    const ricco = briefCaso();
    const povero = briefCaso(['hours', 'whatsapp']);
    // LA MUTAZIONE CHE QUESTO CASO PRENDE, ed e' la ragione per cui non e' una riga vera
    // per definizione: una composizione che ordinasse IN PLACE la sequenza dichiarata
    // (`Array.prototype.reverse` e `sort` mutano) corromperebbe il catalogo alla prima
    // chiamata, e la seconda darebbe un altro risultato. Il confronto della
    // serializzazione di RECIPES prima e dopo e' l'oracolo di quella corruzione.
    const primaDelleChiamate = JSON.stringify(RECIPES);
    // MISURATO nel passo rosso: senza questa riga il ciclo passava su un catalogo VUOTO.
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-212-5

    for (const ricetta of RECIPES) {
      const prima = applyRecipe(ricetta, ricco, RUOLO_HOME);
      // Chiamate INTERPOSTE con altri argomenti. COSA VEDONO DAVVERO, corretto dopo il
      // rilievo R-04: lo stato che CAMBIA il risultato — un accumulatore vivo fra le
      // chiamate, una sequenza dichiarata mutata in place. NON possono vedere una CACHE, che
      // e' lo stato piu' probabile e che rende i due risultati PIU' identici invece che meno:
      // per costruzione l'interposizione non la scopre. Quel verso e' il caso qui sotto (un
      // brief DIVERSO, con la differenza attesa scritta a mano). E la forza di questo caso
      // sta nell'oracolo di CORRUZIONE — il confronto della serializzazione di RECIPES prima
      // e dopo — piu' che nella ripetizione della chiamata: MISURATO, togliendo quella riga
      // un `reverse()` in place non farebbe piu' cadere nulla.
      applyRecipe(ricetta, povero, RUOLO_HOME);
      applyRecipe(ricetta, ricco, 'contact');
      const dopo = applyRecipe(ricetta, ricco, RUOLO_HOME);

      expect(ids(dopo), ricetta.id).toEqual(ids(prima)); // covers: AC-212-5
      expect(dopo, ricetta.id).toEqual(prima); // covers: AC-212-5 — anche i blocchi, non solo gli id
      expect(prima.length, ricetta.id).toBeGreaterThan(0); // covers: AC-212-5 — non vero per vacuita
    }

    expect(JSON.stringify(RECIPES)).toBe(primaDelleChiamate); // covers: AC-212-5
  });

  // Le cinque home composte col brief POVERO (senza `hours` e senza `whatsapp`), scritte a
  // mano voce per voce: cade 'orari', cade 'cta-whatsapp', e nient'altro si muove ne si
  // riordina. E' l'atteso del caso qui sotto, e derivarlo filtrando RICETTE_ATTESE
  // rifarebbe il lavoro della funzione sotto test dentro il proprio oracolo.
  const HOME_COL_BRIEF_POVERO: Record<string, readonly string[]> = {
    'vetrina-dell-offerta@1': ['hero', 'offerte', 'chi-siamo', 'faq', 'contatti'],
    'racconto-di-bottega@1': ['hero', 'chi-siamo', 'offerte', 'faq', 'contatti'],
    'scatto-alla-conversione@1': ['hero', 'offerte', 'chi-siamo', 'contatti'],
    'mappa-e-orari@1': ['hero', 'contatti', 'offerte', 'chi-siamo', 'faq'],
    'scheda-sobria@1': ['hero', 'chi-siamo', 'faq', 'offerte', 'contatti'],
  };

  // covers: AC-212-5
  it('un brief DIVERSO da una composizione DIVERSA, e la differenza e quella attesa', () => {
    // R-04 — IL VERSO CHE MANCAVA AD AC-212-5. Il caso qui sopra ripete la stessa chiamata e
    // pretende lo stesso risultato: prende lo stato che SPORCA, non quello che CONGELA. Una
    // memoizzazione sulla coppia (id della ricetta, ruolo) che ignorasse il brief soddisfa
    // ogni riga di quel caso — e' esattamente MOD-46, che cadeva solo su un caso di AC-212-4
    // e non qui. Il determinismo su cui T-214 poggia sono DUE proprieta': stessi argomenti
    // -> stesso risultato, e argomenti diversi -> risultato che li distingue.
    const ricco = briefCaso();
    const povero = briefCaso(['hours', 'whatsapp']);
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-212-5
    expect(new Set(Object.keys(HOME_COL_BRIEF_POVERO))).toEqual(new Set(RECIPES.map((r) => r.id)));

    for (const ricetta of RECIPES) {
      // L'ordine delle due chiamate NON e' indifferente, ed e' quello che una cache
      // riempirebbe col risultato sbagliato: prima il brief ricco, poi il povero.
      const conRicco = ids(applyRecipe(ricetta, ricco, RUOLO_HOME));
      const conPovero = ids(applyRecipe(ricetta, povero, RUOLO_HOME));

      expect(conPovero, ricetta.id).toEqual(HOME_COL_BRIEF_POVERO[ricetta.id]); // covers: AC-212-5
      // RIDONDANTE con la riga qui sopra (l'atteso letterale e' piu' corto di ogni home), e
      // tenuta perche' NOMINA la proprieta': due brief diversi non danno la stessa pagina.
      expect(conPovero, ricetta.id).not.toEqual(conRicco); // covers: AC-212-5
      // E il ramo POSITIVO: il risultato col brief ricco e' ancora quello dichiarato, cioe'
      // la differenza viene dal brief POVERO e non da una prima chiamata che sbaglia.
      expect(conRicco, ricetta.id).toEqual(attesa(ricetta.id).home_blocks); // covers: AC-212-5
    }
  });
});

// ── oracolo AGGIUNTIVO 1 — coerenza ricetta <-> catalogo ─────────────────────

describe('T-212 oracoli aggiuntivi — ogni blocco citato per un ruolo DICHIARA quel ruolo', () => {
  // NON e' un AC, ed e' il verso che AC-212-3 non copre: AC-212-3 chiede che i ruoli citati
  // ESISTANO, non che il BLOCCO citato per un certo ruolo dichiari quel ruolo fra i propri
  // `page_roles`. Se una ricetta mettesse 'orari' fra i blocchi della pagina 'faq',
  // `blocksFor` non lo restituirebbe MAI per quel ruolo: la regola sarebbe MUTA — una
  // sezione dichiarata dalla ricetta e mai composta, senza errore da nessuna parte.

  it('per ogni ruolo citato da ogni ricetta, ogni blocco citato dichiara quel ruolo', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      expect(ricetta.home_blocks.length, ricetta.id).toBeGreaterThan(1);
      for (const id of ricetta.home_blocks) {
        expect(bloccoDelCatalogo(id).page_roles, `${ricetta.id}/home/${id}`).toContain(RUOLO_HOME);
      }
      for (const ruolo of RUOLI_INTERNI) {
        const sequenza = ricetta.inner_page_rules[ruolo];
        expect(sequenza.length, `${ricetta.id}/${ruolo}`).toBeGreaterThan(0);
        for (const id of sequenza) {
          expect(bloccoDelCatalogo(id).page_roles, `${ricetta.id}/${ruolo}/${id}`).toContain(ruolo);
        }
      }
    }
  });

  it("una citazione INCOERENTE sarebbe MUTA: e' la ragione di questo oracolo", () => {
    // Il difetto e' costruito, cosi' che la sua invisibilita' sia MISURATA e non
    // argomentata: la regola cita un blocco che non dichiara il ruolo, e la composizione
    // non produce nulla — nessuna eccezione, nessun avviso, una pagina in meno.
    const ricco = briefCaso();
    const incoerente: SiteRecipe = {
      ...ricettaDiProva('prova-incoerente@1', ['hero']),
      inner_page_rules: {
        offerings: ['offerte'],
        hours: ['orari'],
        contact: ['contatti'],
        reviews: ['recensioni'],
        // 'orari' non dichiara il ruolo 'faq' (T-210): la sezione non sara' mai composta.
        faq: ['orari', 'faq'],
      },
    };

    expect(bloccoDelCatalogo('orari').page_roles).not.toContain('faq');
    // 'orari' e' SCARTATO IN SILENZIO: la pagina faq compone il solo blocco che dichiara il
    // ruolo, e nessuno segnala che la regola conteneva una sezione impossibile.
    expect(ids(applyRecipe(incoerente, ricco, 'faq'))).toEqual(['faq']);

    // Il ramo POSITIVO sullo STESSO BLOCCO: 'orari' non e' scartato perche' i dati manchino
    // — sul ruolo che dichiara, e con lo stesso brief, viene composto. Cio' che lo fa
    // sparire e' solo l'incoerenza fra la regola e il catalogo.
    expect(ids(applyRecipe(incoerente, ricco, 'hours'))).toEqual(['orari']);
  });
});

// ── oracolo AGGIUNTIVO 2 — nessun doppione dentro una sequenza ───────────────

describe('T-212 oracoli aggiuntivi — nessuna sequenza ripete un id', () => {
  // NON e' un AC. Un id ripetuto in `home_blocks` renderebbe la stessa sezione due volte
  // sulla stessa pagina, e per la precondizione MISURATA di T-202/T-214 (2026-07-28) se
  // quel blocco rende un campo PESANTE del brief (offerings, description, hours,
  // highlights) il caso peggiore in italiano/spagnolo accentato passa da 6.397.198 byte a
  // 11.813.858 e il documento viene RIFIUTATO dal tetto di DOCUMENT_LIMITS.max_bytes: un
  // sito legittimo che non si genera piu'.
  //
  // META' DELL'ELENCO E' IN PREVISIONE, e va detto perche' il conteggio non inganni (R-08):
  // oggi NESSUN blocco del catalogo rende `description` o `highlights` — chi-siamo li porta
  // al MODELLO e non alla pagina (`brief_fields_rendered: []`, T-210) e tornano come prosa
  // negli slot — quindi su quei due nomi il ciclo e' VACUO e i campi davvero esercitati sono
  // DUE: `offerings` (dal blocco offerte) e `hours` (dal blocco orari). Restano in elenco
  // perche' il giorno in cui un blocco li rendesse il vincolo esisterebbe gia'.
  //
  // `whatsapp` E' ESCLUSO DELIBERATAMENTE, e non e' una dimenticanza: e' il solo campo che si
  // ripete DAVVERO su una pagina composta — il blocco contatti lo rende come recapito e la
  // CTA come destinazione del bottone — in quattro home su cinque e su ogni pagina contatti.
  // La ripetizione e' dichiarata e MISURATA in T-210: BRIEF_LIMITS.whatsapp = 40 code unit
  // per pagina, al piu' ~800 byte sul documento intero contro i 1.991.410 byte di margine
  // misurati in T-202. Non e' percio' un campo pesante, ed e' il test qui sotto — che pinna
  // la PARTIZIONE invece di controllare quattro nomi scelti — a tenerlo sotto giudizio.
  const CAMPI_PESANTI = ['offerings', 'description', 'hours', 'highlights'] as const;

  // Le pagine su cui una ripetizione e' ATTESA, dichiarate a mano: le quattro home che
  // portano la CTA (la scheda sobria non la porta) e tutte e cinque le pagine contatti. Il
  // campo ripetuto e' `whatsapp` e nessun altro, ed e' asserito voce per voce.
  const PAGINE_CON_RIPETIZIONE = [
    'vetrina-dell-offerta@1/home',
    'racconto-di-bottega@1/home',
    'scatto-alla-conversione@1/home',
    'mappa-e-orari@1/home',
    'vetrina-dell-offerta@1/contact',
    'racconto-di-bottega@1/contact',
    'scatto-alla-conversione@1/contact',
    'mappa-e-orari@1/contact',
    'scheda-sobria@1/contact',
  ];

  it('nessuna sequenza di nessuna ricetta contiene lo stesso id due volte', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      for (const { nome, sequenza } of sequenzeDi(ricetta)) {
        // Il confronto e' fra la taglia dell'INSIEME e la lunghezza della SEQUENZA: sono
        // due misure diverse della stessa lista, quindi la riga puo' davvero fallire.
        expect(
          new Set(sequenza).size,
          `${ricetta.id}/${nome}: ${sequenza.join(',')}`,
        ).toBe(sequenza.length);
        expect(sequenza.length, `${ricetta.id}/${nome}: sequenza vuota`).toBeGreaterThan(0);
      }
    }
  });

  it('nessuna pagina composta rende due volte lo stesso campo PESANTE del brief', () => {
    // L'altra faccia dello stesso vincolo, sul risultato invece che sulla dichiarazione: il
    // tetto del documento e' sfondato dal campo reso DUE VOLTE, non dall'id ripetuto in se'.
    // Vale anche se il doppione arrivasse da due blocchi DIVERSI che rendono lo stesso
    // campo — cosa che T-210 oggi esclude e che questa riga continuerebbe a vedere.
    const ricco = briefCaso();
    const tuttiResi: string[] = [];

    for (const ricetta of RECIPES) {
      for (const ruolo of RUOLI) {
        const resi = applyRecipe(ricetta, ricco, ruolo).flatMap((blocco) => [
          ...blocco.brief_fields_rendered,
        ]);
        tuttiResi.push(...resi);
        for (const campo of CAMPI_PESANTI) {
          expect(
            resi.filter((reso) => reso === campo).length,
            `${ricetta.id}/${ruolo}/${campo}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }

    // Il ramo POSITIVO: le pagine composte rendono davvero dei campi pesanti, quindi il
    // ciclo qui sopra non e' vero per vacuita'.
    expect(tuttiResi).toContain('offerings');
    expect(tuttiResi).toContain('hours');
  });

  it('l unico campo che una pagina composta rende due volte e whatsapp, e solo dove la CTA c e', () => {
    // R-08 — LA PARTIZIONE, invece di quattro nomi scelti. Il ciclo qui sopra controlla un
    // ELENCO di campi (due dei quali oggi nessun blocco rende), quindi non vede una
    // ripetizione che nascesse su un campo fuori elenco. Qui l'oracolo e' rovesciato: si
    // guarda QUALI campi si ripetono, e si pretende che sia sempre e solo `whatsapp` —
    // l'unica ripetizione dichiarata e misurata (T-210). Un campo PESANTE che iniziasse a
    // ripetersi, anche portato da due blocchi DIVERSI, e' rosso qui senza che nessuno debba
    // ricordarsi di aggiungerlo a un elenco.
    const ricco = briefCaso();
    const conRipetizione: string[] = [];

    for (const ricetta of RECIPES) {
      for (const ruolo of RUOLI) {
        const resi = applyRecipe(ricetta, ricco, ruolo).flatMap((blocco) => [
          ...blocco.brief_fields_rendered,
        ]);
        const ripetuti = [...new Set(resi.filter((reso, i) => resi.indexOf(reso) !== i))];
        for (const campo of ripetuti) {
          expect(campo, `${ricetta.id}/${ruolo}: ${resi.join(',')}`).toBe('whatsapp');
        }
        if (ripetuti.length > 0) conRipetizione.push(`${ricetta.id}/${ruolo}`);
      }
    }

    // E le pagine su cui la ripetizione accade sono ESATTAMENTE le nove dichiarate: cosi' una
    // ripetizione che comparisse dove non e' attesa e' rossa anche se il campo e' `whatsapp`,
    // e una che sparisse (la CTA tolta da una home) non passa inosservata. Il confronto e'
    // fra INSIEMI perche' l'ordine di questo elenco non e' una decisione di prodotto: lo
    // detta l'ordine dei ruoli, che viene dagli slot di T-201.
    expect(new Set(conRipetizione)).toEqual(new Set(PAGINE_CON_RIPETIZIONE));
    // NB: qui c'era un `expect(PAGINE_CON_RIPETIZIONE).toHaveLength(9)`, TOLTO perche' non
    // aveva alcuna via per diventare rosso: contava un letterale scritto in questo stesso
    // file, non era agganciato a nessun tipo, e non proteggeva nemmeno la riga sopra (una
    // tabella svuotata farebbe cadere comunque l'uguaglianza fra insiemi). Era peso morto
    // della stessa famiglia delle tre righe vere-per-costruzione trovate in T-211: un
    // expect che non puo' fallire non e' una difesa in piu', e' copertura che non esiste.
  });

  it('applyRecipe NON deduplica: un id ripetuto e riprodotto fedelmente, due volte', () => {
    // R-02 — LA SCELTA, presa e asserita invece di lasciata non specificata. `applyRecipe`
    // accetta una `SiteRecipe` QUALUNQUE dal chiamante e riproduce cio' che quella dichiara,
    // doppioni compresi: il vincolo dei doppioni vive sulle DICHIARAZIONI (il test qui sopra,
    // sulle cinque ricette di questo catalogo) e non nella funzione.
    // PERCHE' COSI' E NON CON UNA DEDUPLICAZIONE DENTRO LA FUNZIONE: deduplicare la' RIPAREREBBE
    // IN SILENZIO una ricetta che dichiara il falso, cioe' toglierebbe il rosso al solo
    // giudice che quell'errore ha — ed e' la stessa forma del difetto che il modulo evita non
    // riscrivendo le regole di `blocksFor` (due verita' sulla stessa cosa, e prima o poi due
    // verita' diverse). Il tetto dei byte resta presidiato dal suo gate, `parseDocument`
    // (T-202), che pesa il documento vero invece di indovinarlo da un id ripetuto.
    // Prende MOD-30 (dedup aggiunto DENTRO applyRecipe), SOPRAVVISSUTA alla versione
    // precedente di questo file: ne' il comportamento attuale ne' il suo opposto erano
    // osservati.
    const ricco = briefCaso();
    const doppia: SiteRecipe = {
      ...ricettaDiProva('prova-doppione@1', ['hero', 'offerte', 'offerte', 'orari']),
      inner_page_rules: {
        offerings: ['offerte', 'offerte'],
        hours: ['orari'],
        contact: ['contatti'],
        reviews: ['recensioni'],
        faq: ['faq'],
      },
    };

    expect(ids(applyRecipe(doppia, ricco, RUOLO_HOME))).toEqual([
      'hero',
      'offerte',
      'offerte',
      'orari',
    ]);
    expect(ids(applyRecipe(doppia, ricco, 'offerings'))).toEqual(['offerte', 'offerte']);

    // LA CONSEGUENZA, detta per intero: e' un campo PESANTE reso DUE VOLTE sulla stessa
    // pagina, cioe' il caso che sfonda il tetto misurato in T-202 — e nessuno lo ripara qui.
    // La riga e' IMPLICATA da quella sopra piu' il catalogo di T-210, ed e' tenuta perche'
    // NOMINA il rischio invece di lasciarlo dedurre a chi legge.
    const resi = applyRecipe(doppia, ricco, 'offerings').flatMap((blocco) => [
      ...blocco.brief_fields_rendered,
    ]);
    expect(resi.filter((reso) => reso === 'offerings')).toHaveLength(2);
  });
});

// ── oracolo AGGIUNTIVO 3 — la copertura del catalogo, nei due versi ──────────

describe('T-212 oracoli aggiuntivi — la copertura del catalogo dei blocchi', () => {
  // NON e' un AC. AC-212-3 chiede che ogni id citato esista; questo chiede anche il verso
  // opposto — che ogni blocco del catalogo sia citato da almeno una ricetta — perche' un
  // blocco che nessuna direzione usa e' codice che nessuno puo' vedere: precondizione,
  // slot e contratto di sanificazione mantenuti per una sezione irraggiungibile.
  //
  // NESSUN BLOCCO RESTA FUORI, e l'elenco delle eccezioni e' percio' VUOTO ed e' dichiarato
  // tale invece di essere sottinteso. Il caso limite e' 'recensioni', che ha la sua sezione
  // dedicata qui sotto.
  const FUORI_DA_OGNI_RICETTA: readonly string[] = [];

  it('ogni blocco del catalogo e citato da almeno una ricetta, e ogni id citato esiste', () => {
    // L'OTTO e' letterale (gli otto blocchi di T-210): derivarlo da BLOCKS renderebbe la
    // guardia vera per costruzione anche su un catalogo dimezzato.
    expect(BLOCKS).toHaveLength(8);

    const citati = new Set(
      RECIPES.flatMap((ricetta) => sequenzeDi(ricetta).flatMap(({ sequenza }) => [...sequenza])),
    );

    for (const blocco of BLOCKS) {
      if (FUORI_DA_OGNI_RICETTA.includes(blocco.id)) {
        expect(citati.has(blocco.id), `eccezione dichiarata ma citata: ${blocco.id}`).toBe(false);
        continue;
      }
      expect(citati.has(blocco.id), `blocco che nessuna direzione usa: ${blocco.id}`).toBe(true);
    }

    const esistenti = new Set(BLOCKS.map((blocco) => blocco.id));
    for (const id of citati) expect(esistenti.has(id), id).toBe(true);
    // Copertura ESATTA nei due versi, detta in una riga: nessun blocco fuori, nessun id che
    // pende. E' l'unica forma in cui le due meta' non possono divergere fra loro.
    expect(citati).toEqual(esistenti);
  });
});

// ── la DECISIONE sul blocco recensioni, dichiarata e resa visibile ───────────

describe('T-212 oracoli aggiuntivi — il blocco recensioni: citato solo dove ha senso', () => {
  // IL NODO, deciso e non aggirato. Il blocco 'recensioni' non e' soddisfatto da alcun
  // brief v1 (T-210: `precondition: () => false`, perche' il Brief v1 non ha alcun campo
  // che porti recensioni). Le ricette POTEVANO citarlo, ometterlo, o citarlo in parte.
  //
  // LA DECISIONE: e' citato in `inner_page_rules.reviews` di TUTTE le cinque ricette, e in
  // NESSUNA `home_blocks`. Le due meta' hanno due ragioni diverse:
  // - CITATO fra le regole della pagina reviews perche' la struttura la dichiariamo NOI e
  //   sono i DATI a decidere se una sezione esiste (P2-D1 + P2-D7). Ometterlo la' vorrebbe
  //   dire che il giorno in cui una sorgente di recensioni entra nel brief bisogna
  //   ricordarsi di riaprire tutte e cinque le ricette — cioe' affidare a chi verra' dopo
  //   una cosa che il codice puo' dire da solo. E' la stessa scelta di T-210, che la voce
  //   l'ha tenuta nel catalogo invece di cancellarla: cancellarla nasconderebbe la
  //   decisione.
  // - FUORI da `home_blocks` perche' il GIVEN di AC-212-2 chiede un brief per cui TUTTI i
  //   blocchi della home soddisfano la precondizione, e con 'recensioni' fra i blocchi della
  //   home quel brief non esisterebbe per nessun dato possibile: l'acceptance criterion
  //   diventerebbe non verificabile. Non e' una scorciatoia — e' la lettura giusta della
  //   differenza fra la home (che esiste sempre, e va composta con cio' che c'e') e una
  //   pagina interna (che esiste solo se i dati la giustificano, T-213).
  //
  // CONSEGUENZA DICHIARATA: fino a quando il brief non avra' una sorgente di recensioni, la
  // pagina 'reviews' non compone NULLA e T-213 non la produrra'. Il giorno in cui quella
  // sorgente esistera', la sezione comparira' senza toccare le ricette — e questi test
  // diventeranno rossi, cosi' la decisione torna sul tavolo invece di restare implicita.

  it("'recensioni' e citato SOLO fra le regole della pagina reviews, in nessuna home", () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      expect(ricetta.home_blocks, ricetta.id).not.toContain('recensioni');
      expect(ricetta.inner_page_rules.reviews, ricetta.id).toEqual(['recensioni']);
      // E in nessun'altra regola: la sezione appartiene al proprio ruolo e a nessun altro.
      for (const ruolo of RUOLI_INTERNI) {
        if (ruolo === 'reviews') continue;
        expect(ricetta.inner_page_rules[ruolo], `${ricetta.id}/${ruolo}`).not.toContain(
          'recensioni',
        );
      }
    }
  });

  it('con il brief piu ricco costruibile la pagina reviews non compone nulla', () => {
    const ricco = briefCaso();
    // MISURATO nel passo rosso: senza questa riga il ciclo passava su un catalogo VUOTO,
    // cioe' la decisione sul blocco recensioni restava senza giudice proprio nel file che
    // la dichiara.
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      expect(ids(applyRecipe(ricetta, ricco, 'reviews')), ricetta.id).toEqual([]);
      // Il ramo POSITIVO, senza il quale il vuoto potrebbe venire da una composizione
      // rotta: sulle altre pagine interne la stessa ricetta compone davvero.
      expect(ids(applyRecipe(ricetta, ricco, 'offerings')), ricetta.id).toEqual(['offerte']);
      expect(ids(applyRecipe(ricetta, ricco, 'faq')), ricetta.id).toEqual(['faq']);
    }

    // E la voce e' ancora nel catalogo dei blocchi coi suoi slot: la sezione non e' stata
    // cancellata, e' dichiarata senza sorgente (cosi' T-220 non riceve i suoi slot, P2-D7).
    expect(bloccoDelCatalogo('recensioni').slots).toEqual(['reviews_title', 'reviews_intro']);
  });
});

// ── oracolo AGGIUNTIVO — gli id nascono VERSIONATI (precondizione di T-202) ──

describe('T-212 oracoli aggiuntivi — gli id delle ricette passano il gate del documento', () => {
  // NON e' un AC (AC-212-1 dice "versionati" e si ferma li'): e' la precondizione MISURATA
  // ed EREDITATA da T-202 (2026-07-28). Il documento congelato RICHIEDE `recipe_id` e
  // `theme_id` nella forma 'nome-kebab@N' — un id senza '@N' fa cadere l'INTERO documento,
  // non solo il campo. La versione e' DENTRO l'id perche' e' cosi' che un ritocco futuro a
  // una ricetta non riscrive un sito gia' scelto (P2-D21).
  //
  // IL CONTROLLO E' DERIVATO DAL CONTRATTO A MONTE, mai riscritto: la forma dell'id NON
  // compare in questo file. Si usa lo schema di T-202 (`SiteDocumentSchema`) e il suo gate
  // (`parseDocument`), come fa gia' tests/generation-themes.test.ts per i temi, cosi' il
  // giorno in cui la forma cambia la' questo file diventa rosso invece di continuare a
  // giudicare con una regex sua.
  const SCHEMA_ID_VERSIONATO = SiteDocumentSchema.innerType().shape.recipe_id;

  /** Il documento valido piu' piccolo che T-202 accetti, con la coppia di id sotto esame. */
  function documentoCon(recipeId: string, themeId: string): Record<string, unknown> {
    return {
      recipe_id: recipeId,
      theme_id: themeId,
      pages: [
        {
          slug: 'home',
          role: 'home',
          title: 'Osteria del Ponte',
          meta_description: 'Osteria di quartiere a Bologna, cucina di stagione.',
          blocks: [{ id: 'hero', content: {}, data: {}, brief_fields_rendered: [], images: [] }],
        },
      ],
    };
  }

  it('ogni id passa lo schema di T-202 e sta sotto il tetto di DOCUMENT_LIMITS', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      expect(SCHEMA_ID_VERSIONATO.safeParse(ricetta.id).success, ricetta.id).toBe(true);
      expect(ricetta.id.length, ricetta.id).toBeLessThanOrEqual(DOCUMENT_LIMITS.versioned_id);
    }
  });

  it('la COPPIA ricetta+tema che ogni direzione dichiara entra nel documento congelato', () => {
    // La coppia insieme, non i due id separatamente: e' cosi' che il documento la registra
    // (T-202 li chiede entrambi), ed e' cio' che T-214 dovra' scrivere.
    // MISURATO nel passo rosso: senza la guardia il ciclo passava su un catalogo VUOTO.
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      const esito = parseDocument(documentoCon(ricetta.id, ricetta.theme_id));
      expect(esito.ok, `${ricetta.id} + ${ricetta.theme_id}`).toBe(true);
    }
  });

  it('senza la versione nell id cade il documento INTERO, non solo il campo', () => {
    expect(RECIPES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const ricetta of RECIPES) {
      // Il taglio NON e' l'oracolo (l'oracolo resta `parseDocument`): serve a fabbricare il
      // controesempio, ed e' dichiarato non vuoto perche' un id gia' privo di '@N'
      // renderebbe i due rami lo stesso caso.
      const senzaVersione = ricetta.id.replace(/@[0-9]+$/, '');
      expect(senzaVersione, `id gia privo di versione: ${ricetta.id}`).not.toBe(ricetta.id);
      expect(SCHEMA_ID_VERSIONATO.safeParse(senzaVersione).success, senzaVersione).toBe(false);
      expect(parseDocument(documentoCon(senzaVersione, ricetta.theme_id)).ok, senzaVersione).toBe(
        false,
      );
    }
  });
});
