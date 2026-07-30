import { describe, it, expect } from 'vitest';
import {
  PAGE_CATALOG,
  PAGES_MIN,
  navigationFor,
  pagesFor,
  type NavigationEntry,
  type PageSpec,
} from '@/domain/generation/pages';
import { BLOCKS, blocksFor } from '@/domain/generation/blocks';
import { RECIPES, applyRecipe } from '@/domain/generation/recipes';
import { DOCUMENT_LIMITS, SiteDocumentSchema, parseDocument } from '@/domain/generation/document';
import { parsePool } from '@/domain/generation/pool';
import { SLOTS, type PageRole } from '@/domain/generation/slots';
import {
  applyBriefUpdate,
  emptyBrief,
  isBriefComplete,
  type Brief,
} from '@/domain/onboarding/brief';

// T-213 (macrotask generation-engine, P2) — IL SET DI PAGINE DERIVATO DAI DATI, la sua
// NAVIGAZIONE e i suoi link interni. Le asserzioni DERIVANO dagli acceptance_criteria
// AC-213-1..AC-213-6 (docs/blueprint/P2-generation/02-generation-engine.md); i describe
// marcati "oracoli aggiuntivi" sono dichiarati come tali e nominano cio' che provano.
// Dominio puro: nessun DB, nessuna rete, nessun mock.
//
// L'ORDINE E' UNA DECISIONE DI PRODOTTO, e detta la forma dei confronti di questo file:
// AC-213-5 chiede un taglio "deterministico e in ordine, non arbitrario", quindi le pagine
// si confrontano come SEQUENZE (`toEqual` su array) e mai come insiemi. Dove il confronto
// e' fra INSIEMI (l'elenco dei ruoli superstiti) e' detto perche': quell'ordine non e' una
// decisione, mentre l'ordine delle PAGINE e dei ruoli ASSORBITI lo e' ed e' pinnato a mano.
//
// TRE ORDINI DIVERSI CONVIVONO NEL CATALOGO, ed e' deliberato: l'ordine di DICHIARAZIONE
// (quello del vocabolario dei ruoli di T-201), l'ordine di PRIORITA' (quello del taglio) e
// l'ordine ALFABETICO degli slug. Sono tutti e tre diversi fra loro — asserito qui sotto,
// non sperato — perche' altrimenti nessun oracolo potrebbe distinguere un taglio che segue
// la priorita' da uno che segue la dichiarazione o l'alfabeto.
//
// CIO' CHE QUESTO FILE NON PROVA, scritto invece che sottinteso (L-COL-006):
// - non prova che le PRIORITA' siano quelle giuste per il prodotto (che le offerte contino
//   piu' degli orari e' una scelta commerciale, non una proprieta' oracolabile): prova che
//   sono TOTALI, DISTINTE e che il taglio le rispetta;
// - non prova che le soglie di pagina siano i numeri giusti: prova che sono PIU' ALTE di
//   quelle della sezione (T-210) dove il dato permette di misurarlo, e i casi di confine
//   pinnano il valore effettivo di ciascuna;
// - non prova nulla sul CONTENUTO delle pagine (T-234) ne sul loro rendering (T-231/T-235);
// - non prova che il set derivato sia "bello": lo stile non e' oracolabile (P1 §6-bis p.8).
//
// CIO' CHE RESTA DICHIARATO E NON ASSERITO (declared coverage), perche' chi rivede non
// debba scoprirlo da solo:
// - `justifying_blocks` HA UNA VOCE SOLA PER OGNI RUOLO, quindi la differenza fra "tutti i
//   blocchi che giustificano la pagina esistono" e "almeno uno esiste" NON e' osservabile
//   oggi — MISURATO: la mutazione `every` -> `some` lascia verdi tutte e 29 le asserzioni. Il
//   modulo ha scelto `every` e lo dichiara; il caso che distingue le due letture non e'
//   costruibile da qui, perche' `pagesFor` non riceve un catalogo come parametro.
// - LA FORMA `shape` E' RIDONDANTE con `pagine.length === 1`: una one-pager ha una pagina e
//   una pagina sola e' sempre una one-pager. Il campo esiste perche' la DoD nomina la forma
//   e perche' `resolve` (T-214) riceve un SOTTOINSIEME di pagine e su quel sottoinsieme il
//   conteggio non dice nulla. Il test la pinna caso per caso; non e' una difesa in piu'.
// - IL 404 INTERNO E' IRRAPPRESENTABILE **RELATIVAMENTE ALL'ARGOMENTO**, non al set generato,
//   e la prima versione di questo file lo dichiarava come proprieta' assoluta. `PageSpec` e' un
//   tipo esportato, senza brand ne validazione: una destinazione che nessuna pagina possiede e'
//   scrivibile in una riga, e questo stesso file ne fabbrica tre a mano per esercitare i
//   confini (il set senza home della fase 2, e la coppia di slug in cui uno e' prefisso
//   dell'altro). MISURATO: `navigationFor` su una `PageSpec` con uno slug che nessun `pagesFor`
//   produce restituisce quella destinazione. Cio' che il modulo garantisce, e che ha denti, e'
//   che la destinazione sia COPIATA dalla pagina e mai composta da un ruolo, e che non ci sia
//   ne' una voce in piu' ne' una in meno rispetto all'argomento. CHE L'ARGOMENTO SIA IL SET
//   GENERATO E' PRECONDIZIONE DEL CHIAMANTE. La versione forte — `pagesFor` che restituisce
//   set e navigazione insieme, cosi' che la seconda non possa nascere da un insieme diverso dal
//   primo — e' stata valutata e SCARTATA: sarebbe un emendamento alla DoD, che chiede due
//   funzioni esportate.
// - L'IDENTITA' PER RIFERIMENTO delle voci del catalogo restituite non e' giudicata, per la
//   stessa ragione strutturale misurata in T-212: `toEqual` e' un confronto strutturale e uno
//   spread superficiale condivide array e closure, quindi una copia e' uguale per costruzione.
// - IMMUTABILITA': il `readonly` di TypeScript e' del COMPILATORE. `PAGE_CATALOG` e le sue
//   voci sono MUTABILI a runtime, come RECIPES (T-212) e THEMES (T-211). Cio' che si
//   giudica qui e' che `pagesFor` non muti il catalogo (nessun `sort` in place), non che
//   nessun altro POSSA mutarlo: un `Object.freeze` sarebbe una decisione di MACROTASK, da
//   prendere insieme per i tre cataloghi.
// - RUOLO FUORI VOCABOLARIO: un `PageRole` che non sia uno dei sei e' IRRAPPRESENTABILE per
//   tipo, quindi non e' scrivibile qui senza una forzatura. `navigationFor` non lo
//   riconoscerebbe comunque come un caso speciale: e' una PROIEZIONE del suo argomento e
//   non consulta alcun catalogo (asserito piu' sotto), quindi copia il ruolo che riceve.
// - LA ONE-PAGER NON PERDE NULLA, con UN LIMITE: T-213 garantisce che ogni sezione
//   assorbita sia AMMESSA nella home (ogni blocco dichiara il ruolo 'home', T-210). Che una
//   DIREZIONE la renda davvero e' di T-212, e una delle cinque non lo fa: vedi l'oracolo
//   aggiuntivo dedicato, dove l'eccezione e' pinnata invece di essere scoperta a valle.
// - `isBriefComplete` (T-122) e' usato QUI solo per certificare il GIVEN di AC-213-1 ("il
//   brief piu' povero che possa essere 'confirmed'"). Il modulo NON lo importa: che P2 non
//   poggi su quella soglia e' materia di T-215 (AC-215-4).

// ── fixture ──────────────────────────────────────────────────────────────────
// Correzione di metodo n.1 di P1 (il difetto ripetutosi TRE volte con la suite verde):
// PIU' DI UN ELEMENTO, valori DISCORDANTI, e almeno un id che sia PREFISSO di un altro.
// 'Tagliere' e' prefisso di 'Tagliere della casa': un confronto scritto con startsWith
// invece che con uguaglianza deve poter essere osservato mentre sbaglia.
//
// SEI offerte in DUE sezioni, come chiede il given di AC-213-2: tre antipasti e tre primi,
// una col prezzo e una senza, una con descrizione e una senza.

const SEI_OFFERTE = [
  { name: 'Tagliere', price: '12,00', section: 'Antipasti' },
  { name: 'Tagliere della casa', description: 'Selezione del giorno', section: 'Antipasti' },
  { name: 'Crescentine', price: '6,00', section: 'Antipasti' },
  { name: 'Zuppa di ceci', price: '9,50', section: 'Primi' },
  { name: 'Tortelloni di ricotta', description: 'Tirati a mano', section: 'Primi' },
  { name: 'Tagliatelle al ragu', price: '11,00', section: 'Primi' },
];

// I DUE LATI DEL CONFINE della soglia della PAGINA offerte: la soglia della SEZIONE e' UNA
// voce (T-210, MIN_OFFERTE), quella della pagina e' piu' alta e questi due casi la pinnano.
const QUATTRO_OFFERTE = SEI_OFFERTE.slice(0, 4);
const TRE_OFFERTE = SEI_OFFERTE.slice(0, 3);

// Due chiavi con valori DISCORDANTI: un orario spezzato e uno continuato.
const ORARI = { 'lun-ven': '9:00-13:00 / 15:00-19:00', sabato: '9:00-13:00' };
// UNA chiave sola, e non e' un orario povero: 'lun-dom' copre la settimana intera. E' il
// caso che rende FALSA l'idea di misurare la ricchezza degli orari contando le chiavi.
const UN_ORARIO = { 'lun-dom': '12:00-15:00 / 19:00-23:00' };
// Chiavi presenti e orari VUOTI: il brief lo ammette (T-121) e T-210 lo tratta come
// assenza. Qui serve a distinguere "hours assente" da "hours senza informazione".
const ORARI_SENZA_ORARIO = { 'lun-ven': '', sabato: '  ' };

/** Il brief PIU' RICCO costruibile col Brief v1: ogni sorgente che un blocco puo' chiedere. */
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
  offerings: SEI_OFFERTE,
  hours: ORARI,
  geo: { lat: 44.4949, lng: 11.3426 },
  social_links: ['https://instagram.com/osteriadelponte', 'https://facebook.com/osteria'],
  brand_hints: 'tono caldo, niente superlativi',
};

/**
 * Costruisce un brief passando dal VALIDATORE vero (`applyBriefUpdate`): il brief sotto
 * test e' allora un brief che il dominio accetta davvero, non un oggetto scritto a mano che
 * gli somiglia. Una patch SCARTATA farebbe provare al caso qualcosa di diverso da cio' che
 * dichiara, quindi lo scarto e' rosso qui.
 */
function briefDa(patch: Record<string, unknown>): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

/**
 * Il brief ricco OMETTENDO i campi indicati e sovrascrivendo quelli passati. Si toglie per
 * OMISSIONE e non con la stringa vuota: `business_name` non ammette il vuoto (T-121),
 * quindi una patch con '' verrebbe scartata.
 */
function briefRicco(
  omessi: readonly string[] = [],
  override: Record<string, unknown> = {},
): Brief {
  const patch: Record<string, unknown> = { ...PATCH_RICCO, ...override };
  for (const campo of omessi) delete patch[campo];
  return briefDa(patch);
}

// Il brief PIU' POVERO che possa essere 'confirmed' (given di AC-213-1): solo
// business_name, primary_goal e locale; `vertical` resta al default 'altro' e `content` al
// default vuoto (T-121). Che sia davvero confermabile e' ASSERITO, non assunto.
function briefPoverissimo(): Brief {
  return briefDa({ business_name: 'Osteria del Ponte', primary_goal: 'contatta' });
}

// ── strumenti di lettura ─────────────────────────────────────────────────────

function slugs(pagine: readonly PageSpec[]): string[] {
  return pagine.map((pagina) => pagina.slug);
}

function ruoli(pagine: readonly PageSpec[]): PageRole[] {
  return pagine.map((pagina) => pagina.role);
}

/**
 * I ruoli SUPERSTITI leggendoli dal risultato: per ogni pagina il proprio ruolo, piu' i ruoli
 * che quella pagina ASSORBE. E' la lettura che vale in ENTRAMBE le forme — in una one-pager i
 * ruoli superstiti sono tutti assorbiti dalla home, in un sito multi-pagina in parte hanno una
 * pagina propria e in parte sono assorbiti — ed e' cio' che permette di giudicare la
 * precondizione di UNA pagina senza che la soglia PAGES_MIN nasconda il risultato.
 *
 * NB: il ruolo PROPRIO va aggiunto qui perche' `absorbed_roles` non lo contiene piu'. Il campo
 * si chiamava `section_roles` e includeva il ruolo della pagina, ma quel nome dichiarava di
 * elencare "le sezioni che la pagina rende" — falso su una home multi-pagina, dove le ricette
 * fanno comporre anche le sezioni dei ruoli che hanno una pagina propria (misurato). Ora il
 * campo dice una cosa sola e vera: chi e' rimasto senza casa.
 */
function ruoliSuperstiti(pagine: readonly PageSpec[]): PageRole[] {
  const visti = new Set<PageRole>();
  const unione: PageRole[] = [];
  for (const pagina of pagine) {
    for (const ruolo of [pagina.role, ...pagina.absorbed_roles]) {
      if (visti.has(ruolo)) continue;
      visti.add(ruolo);
      unione.push(ruolo);
    }
  }
  return unione;
}

function laHome(pagine: readonly PageSpec[]): PageSpec {
  const trovata = pagine.find((pagina) => pagina.role === 'home');
  if (!trovata) throw new Error(`set senza home: ${slugs(pagine).join(',')}`);
  return trovata;
}

function idBlocchi(brief: Brief, ruolo: PageRole): string[] {
  return blocksFor(brief, ruolo).map((blocco) => blocco.id);
}

function bloccoDelCatalogo(id: string): (typeof BLOCKS)[number] {
  const trovato = BLOCKS.find((blocco) => blocco.id === id);
  if (!trovato) throw new Error(`blocco assente dal catalogo: ${id}`);
  return trovato;
}

type VoceDiCatalogo = (typeof PAGE_CATALOG)[number];
type VoceHome = Extract<VoceDiCatalogo, { role: 'home' }>;
type VoceInterna = Exclude<VoceDiCatalogo, { role: 'home' }>;

function voceDelCatalogo(ruolo: PageRole): VoceDiCatalogo {
  const trovata = PAGE_CATALOG.find((voce) => voce.role === ruolo);
  if (!trovata) throw new Error(`ruolo assente da PAGE_CATALOG: ${ruolo}`);
  return trovata;
}

/**
 * La voce INTERNA del catalogo, cioe' quella che dichiara `justifying_blocks`.
 *
 * Il campo vive SOLO sulle voci interne: sulla home era inerte — `pagesFor` non lo leggeva mai
 * e la home esiste anche con 'hero' insoddisfatto — quindi era una dichiarazione che nessun
 * comportamento poteva smentire, e sostituirne il valore lasciava rossa la sola tabella
 * letterale. E' stato tolto, con la stessa logica per cui la precondizione della home non e'
 * scrivibile. Questo helper LANCIA sulla home invece di restituire un elenco vuoto: un chiamante
 * che ci arrivasse starebbe chiedendo cio' che la home non ha, e un [] silenzioso renderebbe
 * vacuo il ciclo che lo consuma.
 */
function voceInterna(ruolo: PageRole) {
  const voce = voceDelCatalogo(ruolo);
  if (voce.role === 'home') {
    throw new Error(`la home non dichiara blocchi giustificanti: chiesto per ${ruolo}`);
  }
  return voce;
}

function ruoliDelCatalogo(): PageRole[] {
  return PAGE_CATALOG.map((voce) => voce.role);
}

function destinazioni(voci: readonly NavigationEntry[]): string[] {
  return voci.map((voce) => voce.slug);
}

// I ruoli di pagina sono DERIVATI dal catalogo degli slot (T-201, contratto A MONTE): un
// ruolo nuovo la' entra da solo nelle iterazioni di questo file invece di restare fuori.
const RUOLI: readonly PageRole[] = [...new Set(SLOTS.map((slot) => slot.page_role))];

/**
 * IL VOCABOLARIO DEI RUOLI PRESO DAL TIPO, e non dal proxy (stessa guardia di T-212).
 * `RUOLI` e' un PROXY: gli id distinti dei `page_role` di SLOTS, perche' `PageRole` non e'
 * enumerabile a runtime. Un ruolo che nascesse in T-201 SENZA slot il proxy lo perderebbe, e
 * ogni ciclo di questo file smetterebbe di guardarlo restando verde. Il record e' TOTALE PER
 * TIPO: un ruolo nuovo non compila finche' non compare anche qui.
 */
const RUOLI_DEL_TIPO: Record<PageRole, true> = {
  home: true,
  offerings: true,
  hours: true,
  contact: true,
  reviews: true,
  faq: true,
};

// Il tetto NON ARTIFICIALE, DERIVATO dal contratto a monte (T-202) e mai riscritto a mano:
// e' il tetto di sicurezza del documento e quello che `appendPages` (T-204) impone sulla
// riga. Usarlo come `maxPages` significa "nessun tetto di piano", che e' il default
// dichiarato di P2 (P2-D13).
const SENZA_TETTO_DI_PIANO = DOCUMENT_LIMITS.max_pages;

// ── il catalogo atteso, voce per voce ────────────────────────────────────────
// La mappa e' LETTERALE e completa, scritta a mano: derivarla da PAGE_CATALOG la renderebbe
// vera per costruzione. La CHIAVE e' `PageRole` (T-201), quindi il record e' TOTALE PER
// TIPO — un ruolo nuovo la' rompe il typecheck qui invece di nascere senza slug, senza
// priorita' e senza giudice. E' l'unica derivazione ammessa: dal contratto, non dal dato.
//
// PERCHE' NON BASTA LA PROPRIETA' "le priorita' sono distinte": scambiare fra loro le
// priorita' di due ruoli, o due slug, conserva ogni conteggio e ogni distinzione — e'
// l'ASSEGNAZIONE (quale ruolo possiede quale slug e quale priorita') che resterebbe senza
// giudice, la stessa classe di buco misurata in T-210 e in T-212. Qui e' pinnata voce per
// voce.
//
// COSTO DICHIARATO: ritoccare uno slug o una priorita' rende rosso questo file. E' voluto —
// lo slug finisce nell'URL di un sito pubblicato e nel documento CONGELATO (T-202), e la
// priorita' decide quali pagine sopravvivono a un piano con tetto basso: sono esattamente le
// cose che devono passare sotto gli occhi di chi rivede.

type VoceAttesa = {
  readonly slug: string;
  readonly priority: number;
  readonly label_key: PageSpec['label_key'];
  /** OPZIONALE perche' la voce della HOME non lo dichiara: sulla home era inerte (vedi
   *  `voceInterna`), e l'assenza qui e' cio' che la tabella deve pretendere. */
  readonly justifying_blocks?: readonly string[];
};

const CATALOGO_ATTESO: Record<PageRole, VoceAttesa> = {
  // Nessun `justifying_blocks`: la home non ne ha, e il test qui sotto lo PRETENDE.
  home: { slug: 'home', priority: 100, label_key: 'site.nav.home' },
  offerings: {
    slug: 'offerte',
    priority: 90,
    label_key: 'site.nav.offerings',
    justifying_blocks: ['offerte'],
  },
  hours: { slug: 'orari', priority: 70, label_key: 'site.nav.hours', justifying_blocks: ['orari'] },
  contact: {
    slug: 'contatti',
    priority: 80,
    label_key: 'site.nav.contact',
    justifying_blocks: ['contatti'],
  },
  reviews: {
    slug: 'recensioni',
    priority: 50,
    label_key: 'site.nav.reviews',
    justifying_blocks: ['recensioni'],
  },
  faq: {
    slug: 'domande-frequenti',
    priority: 60,
    label_key: 'site.nav.faq',
    justifying_blocks: ['faq'],
  },
};

// L'ORDINE DI DICHIARAZIONE del catalogo, letterale: la home prima, poi i ruoli interni
// nell'ordine del vocabolario di T-201. Non pinnarlo lascerebbe senza giudice un riordino.
const ORDINE_DICHIARATO: readonly PageRole[] = [
  'home',
  'offerings',
  'hours',
  'contact',
  'reviews',
  'faq',
];

// L'ORDINE DI PRIORITA' decrescente, letterale: e' l'ordine in cui le pagine compaiono nel
// risultato e l'ordine in cui `maxPages` taglia.
const ORDINE_DI_PRIORITA: readonly PageRole[] = [
  'home',
  'offerings',
  'contact',
  'hours',
  'faq',
  'reviews',
];

// L'ORDINE ALFABETICO DEGLI SLUG, letterale: non e' un ordine che il modulo usi, ed e' qui
// perche' un'implementazione che ordinasse per slug (il modo piu' facile di ottenere un
// risultato "deterministico" senza rispettare la priorita') deve poter essere vista mentre
// sbaglia. Che sia davvero l'ordine alfabetico dei nostri slug e' asserito piu' sotto.
const ORDINE_ALFABETICO_DI_SLUG: readonly PageRole[] = [
  'contact',
  'faq',
  'home',
  'offerings',
  'hours',
  'reviews',
];

function atteso(ruolo: PageRole): VoceAttesa {
  const trovato = CATALOGO_ATTESO[ruolo];
  if (!trovato) throw new Error(`ruolo senza attesa dichiarata: ${ruolo}`);
  return trovato;
}

function slugDi(ruolo: PageRole): string {
  return atteso(ruolo).slug;
}

function slugAttesi(ruoli_: readonly PageRole[]): string[] {
  return ruoli_.map(slugDi);
}

// ── i casi, con il set atteso scritto a mano ─────────────────────────────────
// La tabella e' LETTERALE. Ogni caso dichiara TRE cose che non si implicano fra loro:
// - `ruoli_superstiti`: quali ruoli hanno la precondizione soddisfatta (INSIEME: l'ordine
//   dell'unione non e' una decisione di prodotto);
// - `pagine`: quali pagine esistono e IN QUALE ORDINE (sequenza: e' la decisione);
// - `forma` e `home_absorbed_roles`: la forma del sito e i ruoli che la home ASSORBE — quelli
//   la cui precondizione e' soddisfatta ma che NON hanno una pagina propria — in ordine di
//   priorita'. NB: la home non elenca se stessa, e il campo NON e' l'elenco delle sezioni che
//   la home rende: quelle le decide la ricetta (T-212), e su un sito multi-pagina includono
//   anche i ruoli che hanno una pagina propria.
// Derivarne una dalle altre rifarebbe dentro l'oracolo il lavoro della funzione sotto test.
//
// I CASI SONO COSTRUITI A COPPIE ATTORNO AI CONFINI, ed e' l'unica forma in cui una soglia
// e' davvero pinnata: tre offerte / quattro offerte, un recapito / due recapiti, due materie
// FAQ / tre materie FAQ, due pagine superstiti / tre pagine superstiti. Un caso solo per
// lato non distingue la soglia dal caso nominale.

type CasoAtteso = {
  readonly nome: string;
  readonly brief: () => Brief;
  readonly ruoli_superstiti: readonly PageRole[];
  readonly pagine: readonly PageRole[];
  readonly forma: PageSpec['shape'];
  readonly home_absorbed_roles: readonly PageRole[];
};

const CASI: readonly CasoAtteso[] = [
  {
    // AC-213-1: nessuna sorgente oltre al nome, quindi nessun ruolo interno esiste.
    nome: 'il brief piu povero che possa essere confirmed',
    brief: briefPoverissimo,
    ruoli_superstiti: ['home'],
    pagine: ['home'],
    forma: 'one-pager',
    home_absorbed_roles: [],
  },
  {
    nome: 'il brief piu ricco costruibile',
    brief: () => briefRicco(),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // AC-213-2: hours vuoto, nessuna recensione, sei offerte in due sezioni.
    nome: 'senza hours (AC-213-2)',
    brief: () => briefRicco(['hours']),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // Chiavi presenti e orari VUOTI: la pagina orari non esiste, come col campo assente.
    nome: 'hours con chiavi ma senza alcun orario',
    brief: () => briefRicco([], { hours: ORARI_SENZA_ORARIO }),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // UNA chiave sola che copre la settimana: la pagina orari ESISTE. E' il caso che
    // giustifica la scelta di NON alzare la soglia della pagina orari contando le chiavi.
    nome: 'hours con una sola chiave valorizzata',
    brief: () => briefRicco([], { hours: UN_ORARIO }),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // TRE offerte: la SEZIONE offerte esiste (T-210), la PAGINA no. E' il lato basso del
    // confine della soglia di pagina.
    nome: 'tre offerte: sezione si, pagina no',
    brief: () => briefRicco([], { offerings: TRE_OFFERTE }),
    ruoli_superstiti: ['home', 'contact', 'hours', 'faq'],
    pagine: ['home', 'contact', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // QUATTRO offerte: il lato alto dello stesso confine.
    nome: 'quattro offerte: la pagina esiste',
    brief: () => briefRicco([], { offerings: QUATTRO_OFFERTE }),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // UN solo recapito (il telefono): la SEZIONE contatti esiste, la PAGINA no.
    nome: 'un solo recapito: sezione si, pagina no',
    brief: () => briefRicco(['address', 'whatsapp', 'email']),
    ruoli_superstiti: ['home', 'offerings', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // DUE recapiti (indirizzo e telefono): il lato alto dello stesso confine.
    nome: 'due recapiti: la pagina esiste',
    brief: () => briefRicco(['whatsapp', 'email']),
    ruoli_superstiti: ['home', 'offerings', 'contact', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'contact', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // DUE materie FAQ (le offerte e gli orari): la sezione FAQ non esiste (T-210 ne chiede
    // tre), quindi la pagina nemmeno. E il set superstite e' di TRE pagine, cioe' ESATTAMENTE
    // PAGES_MIN: il sito resta multi-pagina.
    nome: 'due materie FAQ e tre pagine superstiti (confine di PAGES_MIN, lato alto)',
    brief: () =>
      briefDa({
        business_name: 'Osteria del Ponte',
        vertical: 'ristorazione',
        primary_goal: 'prenota',
        offerings: SEI_OFFERTE,
        hours: ORARI,
      }),
    ruoli_superstiti: ['home', 'offerings', 'hours'],
    pagine: ['home', 'offerings', 'hours'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // TRE materie FAQ (le offerte, gli orari e la descrizione): la pagina FAQ compare.
    nome: 'tre materie FAQ: la pagina FAQ compare',
    brief: () =>
      briefDa({
        business_name: 'Osteria del Ponte',
        vertical: 'ristorazione',
        primary_goal: 'prenota',
        description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
        offerings: SEI_OFFERTE,
        hours: ORARI,
      }),
    ruoli_superstiti: ['home', 'offerings', 'hours', 'faq'],
    pagine: ['home', 'offerings', 'hours', 'faq'],
    forma: 'multi-page',
    home_absorbed_roles: [],
  },
  {
    // AC-213-3: DUE pagine superstiti, cioe' sotto PAGES_MIN. Il sito resta una one-pager e
    // la sezione che sarebbe stata una pagina rientra nella home.
    nome: 'due pagine superstiti: la one-pager (AC-213-3, confine di PAGES_MIN, lato basso)',
    brief: () =>
      briefDa({
        business_name: 'Osteria del Ponte',
        vertical: 'ristorazione',
        primary_goal: 'prenota',
        description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
        offerings: SEI_OFFERTE,
      }),
    ruoli_superstiti: ['home', 'offerings'],
    pagine: ['home'],
    forma: 'one-pager',
    home_absorbed_roles: ['offerings'],
  },
];

// Il numero di casi e' LETTERALE: e' la guardia di vacuita' del ciclo tabellare. Una
// tabella svuotata renderebbe vero senza ispezionare nulla ogni controllo che la percorre.
const NUMERO_DI_CASI = 12;

// ── il catalogo: forma, totalita', assegnazione ──────────────────────────────

describe('T-213 PAGE_CATALOG — una voce per ogni ruolo, con slug, priorita e blocchi', () => {
  it('ha ESATTAMENTE i sei ruoli del vocabolario di T-201, nell ordine dichiarato', () => {
    // Il SEI e' LETTERALE: contarlo su PAGE_CATALOG o su RUOLI lo renderebbe vero per
    // costruzione anche su un catalogo vuoto.
    expect(PAGE_CATALOG).toHaveLength(6);
    expect(ruoliDelCatalogo()).toEqual(ORDINE_DICHIARATO);
    expect(new Set(ruoliDelCatalogo()).size).toBe(6);
    // Copertura ESATTA nei due versi contro il vocabolario a monte: nessun ruolo del
    // vocabolario resta senza voce (sarebbe una pagina che non puo' mai esistere, senza che
    // nulla lo dica) e nessuna voce cita un ruolo che non esiste.
    expect(new Set<string>(ruoliDelCatalogo())).toEqual(new Set<string>(RUOLI));
    // Un ruolo NUOVO senza la sua riga nella tabella attesa rende rosso questo file invece
    // di nascere col proprio slug e la propria priorita' non giudicati.
    expect(new Set(Object.keys(CATALOGO_ATTESO))).toEqual(new Set<string>(ruoliDelCatalogo()));
  });

  it('ogni voce porta ESATTAMENTE slug, priorita, etichetta e blocchi che le competono', () => {
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(
      6,
    );

    for (const voce of PAGE_CATALOG) {
      const sua = atteso(voce.role);
      expect(voce.slug, voce.role).toBe(sua.slug);
      expect(voce.priority, voce.role).toBe(sua.priority);
      expect(voce.label_key, voce.role).toBe(sua.label_key);
      // Uguaglianza su ARRAY, ordine compreso: e' l'elenco dei blocchi che giustificano la
      // pagina, non un insieme. E sulla HOME il campo NON DEVE ESISTERE: era una dichiarazione
      // inerte, tolta con la stessa logica per cui la home non ha precondizione. Che sia
      // assente e' asserito qui, non dato per scontato.
      if (voce.role === 'home') {
        expect('justifying_blocks' in voce, 'la home non deve dichiarare blocchi giustificanti').toBe(false);
        expect(sua.justifying_blocks, 'la tabella attesa non deve dichiararli per la home').toBeUndefined();
      } else {
        expect(voce.justifying_blocks, voce.role).toEqual(sua.justifying_blocks);
      }
    }
  });

  it('ogni blocco che giustifica una pagina esiste in BLOCKS e DICHIARA quel ruolo', () => {
    // La coerenza col catalogo a monte (T-210), nei due versi che contano: il blocco esiste,
    // e dichiara il ruolo della pagina che giustifica. Un blocco che non dichiarasse quel
    // ruolo non sarebbe MAI restituito da `blocksFor` per quel ruolo: la precondizione della
    // pagina sarebbe falsa per sempre e la pagina non esisterebbe mai, senza errore da
    // nessuna parte.
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(
      6,
    );
    let citazioni = 0;

    for (const voce of PAGE_CATALOG) {
      if (voce.role === 'home') continue; // la home non dichiara blocchi giustificanti
      expect(voce.justifying_blocks.length, voce.role).toBeGreaterThan(0);
      for (const id of voce.justifying_blocks) {
        // Appartenenza per UGUAGLIANZA (la lookup lancia se manca), mai per prefisso.
        expect(bloccoDelCatalogo(id).page_roles, `${voce.role}/${id}`).toContain(voce.role);
        citazioni += 1;
      }
    }

    // CINQUE citazioni, una per ciascuna pagina INTERNA. Era sei: la sesta era quella della
    // home, sparita insieme al campo inerte che la dichiarava. Il numero e' LETTERALE, perche'
    // derivarlo dal catalogo renderebbe la guardia vera per costruzione.
    expect(citazioni, 'poche citazioni: il ciclo sarebbe quasi vero per vacuita').toBe(5);
  });

  it('le priorita sono DISTINTE, positive, e la home ha la massima', () => {
    // ORACOLO AGGIUNTIVO 2 (non deriva da un AC). Due ruoli con la STESSA priorita'
    // renderebbero il taglio di `maxPages` arbitrario — quale delle due pagine cada
    // dipenderebbe dalla stabilita' dell'ordinamento — e AC-213-5 ("non arbitrario") sarebbe
    // vero per caso su un catalogo che non lo garantisce.
    const priorita = PAGE_CATALOG.map((voce) => voce.priority);
    // Il SEI e' letterale: `new Set(priorita).size === priorita.length` sarebbe vera anche su
    // un catalogo vuoto (0 === 0) e su un catalogo dimezzato.
    expect(new Set(priorita).size, priorita.join(',')).toBe(6);

    for (const voce of PAGE_CATALOG) {
      expect(Number.isInteger(voce.priority), voce.role).toBe(true);
      expect(voce.priority, voce.role).toBeGreaterThan(0);
    }

    // La home ha la priorita' MASSIMA. Non e' cio' che la tiene nel set — il modulo la
    // prende per RUOLO e non per posizione, e i casi con maxPages <= 0 lo mostrano — ma se
    // non fosse la massima l'ordine del risultato e la sua garanzia di presenza
    // divergerebbero, e nessuno se ne accorgerebbe.
    expect(voceDelCatalogo('home').priority).toBe(Math.max(...priorita));
  });

  it('nessuno slug e PREFISSO di un altro, e nessuno slug coincide con un altro', () => {
    // Non e' un AC. Gli slug finiscono in un percorso e vengono confrontati a valle
    // (l'allowlist di `parsePool`, l'unicita' di `parseDocument`, i link interni): un
    // confronto scritto con startsWith invece che con uguaglianza confonderebbe due pagine.
    // Questa riga dice che oggi nel catalogo quella confusione non e' nemmeno possibile —
    // e diventa rossa il giorno in cui si aggiunge uno slug che sia prefisso di un altro,
    // cosi' la decisione di come confrontarli torna sul tavolo.
    const tutti = PAGE_CATALOG.map((voce) => voce.slug);
    expect(tutti, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(6);
    expect(new Set(tutti).size, tutti.join(',')).toBe(6);

    for (const uno of tutti) {
      for (const altro of tutti) {
        if (uno === altro) continue;
        expect(uno.startsWith(altro), `${uno} ha per prefisso ${altro}`).toBe(false);
      }
    }
  });

  it('la voce di un ruolo INTERNO ha una precondizione, la home NON puo averla', () => {
    // Le due meta' di una scelta di TIPO, dichiarata: la DoD chiede una precondizione "per
    // ogni ruolo di pagina", ma sulla home una precondizione sarebbe un `true` che qualcuno
    // puo' modificare — e "la home e' sempre presente" e' anch'essa DoD. La voce della home
    // non ha percio' il campo: negare la home non e' SCRIVIBILE.
    //
    // Le due righe qui sotto sono oracoli del gate TYPECHECK, non del gate dei test: il tipo
    // dell'annotazione diventa `false` se la forma cambia, e allora `= true` non compila. Da
    // sapere per chi gira solo vitest: non aspettarsi un rosso da qui.
    const LA_VOCE_INTERNA_HA_PRECONDIZIONE: 'precondition' extends keyof VoceInterna
      ? true
      : false = true;
    const LA_HOME_NON_HA_PRECONDIZIONE: 'precondition' extends keyof VoceHome ? false : true = true;
    expect(LA_VOCE_INTERNA_HA_PRECONDIZIONE).toBe(true);
    expect(LA_HOME_NON_HA_PRECONDIZIONE).toBe(true);

    // E la stessa cosa a RUNTIME, perche' il tempo fra le due sarebbe cieco.
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(
      6,
    );
    let interneIspezionate = 0;
    for (const voce of PAGE_CATALOG) {
      if (voce.role === 'home') {
        expect(Object.hasOwn(voce, 'precondition'), 'la home dichiara una precondizione').toBe(
          false,
        );
        continue;
      }
      expect(typeof voce.precondition, voce.role).toBe('function');
      interneIspezionate += 1;
    }
    // Le pagine interne sono CINQUE: senza questo conteggio un catalogo con la sola home
    // renderebbe il ciclo vero per vacuita'.
    expect(interneIspezionate).toBe(5);
  });
});

// ── i tre ordini, e il fatto che siano diversi ───────────────────────────────

describe('T-213 i tre ordini del catalogo sono diversi fra loro', () => {
  it('dichiarazione, priorita e alfabetico degli slug sono tre sequenze DIVERSE', () => {
    // ORACOLO AGGIUNTIVO 3 — la guardia sui TERMINI DI CONFRONTO, non sul modulo, ed e' bene
    // sapere quale delle due cose e': dice che la copertura sull'ORDINE del taglio ESISTE. Se
    // i tre ordini coincidessero, ogni asserzione di questo file sull'ordine sarebbe vera per
    // caso e un taglio che ordina per dichiarazione o per slug passerebbe indisturbato.
    //
    // QUESTO CASO PASSA ANCHE SU UN MODULO INERTE, ed e' VOLUTO — misurato nel passo rosso
    // (era uno dei due su 29 che passavano sullo stub). Non tocca `PAGE_CATALOG` ne
    // `pagesFor`: giudica le TABELLE DI QUESTO FILE, e la sua preda e' un futuro ritocco che
    // renda due dei tre ordini uguali, svuotando di significato ogni confronto sull'ordine
    // altrove. Che le tabelle combacino col catalogo vero e' asserito nella sezione dedicata
    // al catalogo, che sullo stub e' rossa.
    expect(ORDINE_DICHIARATO).not.toEqual(ORDINE_DI_PRIORITA);
    expect(ORDINE_DICHIARATO).not.toEqual(ORDINE_ALFABETICO_DI_SLUG);
    expect(ORDINE_DI_PRIORITA).not.toEqual(ORDINE_ALFABETICO_DI_SLUG);
    // E i tre ordini sono PERMUTAZIONI dello stesso insieme: differiscono per ordine e non
    // perche' uno abbia perso un ruolo.
    expect(new Set(ORDINE_DICHIARATO)).toEqual(new Set(ORDINE_DI_PRIORITA));
    expect(new Set(ORDINE_DICHIARATO)).toEqual(new Set(ORDINE_ALFABETICO_DI_SLUG));

    // L'ordine alfabetico dichiarato a mano E' davvero quello dei nostri slug: il termine di
    // confronto e' derivato dalla TABELLA ATTESA (scritta a mano) e non dal modulo.
    const perSlug = [...ORDINE_DICHIARATO].sort((a, b) => slugDi(a).localeCompare(slugDi(b)));
    expect(perSlug).toEqual(ORDINE_ALFABETICO_DI_SLUG);

    // I ruoli sono SEI, e il proxy derivato dagli slot li vede tutti (stessa guardia di
    // T-212, R-09). Il SEI e' letterale: contarlo su SLOTS lo renderebbe vero per
    // costruzione. Questa riga e' un oracolo del gate TYPECHECK quanto dei test: un settimo
    // ruolo in T-201 non compila finche' non compare in RUOLI_DEL_TIPO, e allora il SEI
    // diventa rosso e obbliga a decidere.
    expect(Object.keys(RUOLI_DEL_TIPO)).toHaveLength(6);
    expect(new Set<string>(RUOLI)).toEqual(new Set(Object.keys(RUOLI_DEL_TIPO)));
  });
});

// ── AC-213-1, AC-213-2, AC-213-3 — il set derivato, caso per caso ────────────

describe('T-213 pagesFor — il set di pagine e DERIVATO dai dati', () => {
  // covers: AC-213-1
  it('il brief piu povero confermabile da ESATTAMENTE una pagina home in forma one-pager', () => {
    const povero = briefPoverissimo();
    // IL GIVEN E' ASSERITO, non assunto: e' davvero un brief che P1 considera completo
    // (business_name, vertical al default, primary_goal, locale), cioe' uno che puo' essere
    // 'confirmed'. Senza questa riga il caso proverebbe qualcosa su un brief qualunque.
    expect(isBriefComplete(povero)).toBe(true); // covers: AC-213-1
    expect(povero.vertical).toBe('altro'); // covers: AC-213-1 — il default, non una scelta
    expect(povero.content.offerings).toEqual([]); // covers: AC-213-1

    const pagine = pagesFor(povero, { maxPages: 10 });

    expect(pagine).toHaveLength(1); // covers: AC-213-1
    expect(ruoli(pagine)).toEqual(['home']); // covers: AC-213-1
    expect(slugs(pagine)).toEqual(['home']); // covers: AC-213-1
    expect(laHome(pagine).shape).toBe('one-pager'); // covers: AC-213-1
    // Nessun ruolo assorbito: non c'e' nulla da assorbire, ed e' diverso dal caso di
    // AC-213-3 in cui la sezione esiste e rientra nella home.
    expect(laHome(pagine).absorbed_roles).toEqual([]); // covers: AC-213-1

    // IL RAMO POSITIVO, senza il quale "esattamente una" potrebbe venire da una funzione che
    // ne restituisce sempre una: lo STESSO brief arricchito da piu' pagine.
    const arricchito = applyBriefUpdate(povero, {
      offerings: SEI_OFFERTE,
      hours: ORARI,
      address: 'Via dei Mille 4, Bologna',
      phone: '+39 051 000111',
    }).brief;
    expect(pagesFor(arricchito, { maxPages: 10 }).length).toBeGreaterThan(1); // covers: AC-213-1
  });

  // covers: AC-213-2
  it('senza hours e senza recensioni quelle pagine sono ASSENTI, e la pagina offerte e PRESENTE', () => {
    const senzaOrari = briefRicco(['hours']);
    // Il given, asserito: sei offerte in DUE sezioni, e nessuna sorgente di recensioni nel
    // Brief v1 (non c'e' alcun campo che ne porti — T-210 lo dichiara).
    expect(senzaOrari.content.offerings).toHaveLength(6); // covers: AC-213-2
    expect(new Set(senzaOrari.content.offerings.map((voce) => voce.section))).toEqual(
      new Set(['Antipasti', 'Primi']),
    ); // covers: AC-213-2
    expect(senzaOrari.hours).toBeUndefined(); // covers: AC-213-2

    const pagine = pagesFor(senzaOrari, { maxPages: 10 });

    // Uguaglianza ESATTA sulla SEQUENZA: dice in una riga quali pagine esistono, in quale
    // ordine, e che nessun'altra c'e'.
    expect(slugs(pagine)).toEqual(['home', 'offerte', 'contatti', 'domande-frequenti']); // covers: AC-213-2
    expect(ruoli(pagine)).not.toContain('hours'); // covers: AC-213-2 — assente, non vuota
    expect(ruoli(pagine)).not.toContain('reviews'); // covers: AC-213-2
    expect(slugs(pagine)).toContain('offerte'); // covers: AC-213-2

    // "nessuna pagina assente compare come voce vuota": ne' fra le pagine, ne' fra le
    // sezioni della home, ne' nella navigazione. E nessuna pagina ha uno slug vuoto o un
    // elenco di sezioni vuoto, che sarebbe la voce presente-e-vuota travestita da pagina.
    for (const pagina of pagine) {
      expect(pagina.slug.length, pagina.role).toBeGreaterThan(0); // covers: AC-213-2
      // NB: qui c'era un controllo che `section_roles` non fosse vuoto, che col campo nuovo non
      // vuole piu' dire nulla — una pagina interna assorbe [] per contratto. Che una pagina del
      // set abbia davvero un CONTENUTO e' provato dall'ORACOLO DI INTEGRAZIONE in fondo al file,
      // che lo chiede alla ricetta invece di dedurlo da un conteggio.
    }
    expect(ruoliSuperstiti(pagine)).not.toContain('hours'); // covers: AC-213-2
    expect(ruoliSuperstiti(pagine)).not.toContain('reviews'); // covers: AC-213-2
    expect(destinazioni(navigationFor(pagine))).toEqual([
      'home',
      'offerte',
      'contatti',
      'domande-frequenti',
    ]); // covers: AC-213-2

    // IL RAMO POSITIVO sullo STESSO brief: rimesso `hours`, la pagina orari compare. Cio'
    // che la fa sparire e' dunque il dato mancante e non un filtro che sbaglia.
    const conOrari = applyBriefUpdate(senzaOrari, { hours: ORARI }).brief;
    expect(slugs(pagesFor(conOrari, { maxPages: 10 }))).toEqual([
      'home',
      'offerte',
      'contatti',
      'orari',
      'domande-frequenti',
    ]); // covers: AC-213-2
    // E le recensioni NON tornano per nessun dato: e' l'unico ruolo che nessun brief v1 puo'
    // far esistere (T-210, `precondition: () => false`).
    expect(ruoli(pagesFor(conOrari, { maxPages: 10 }))).not.toContain('reviews'); // covers: AC-213-2
  });

  // covers: AC-213-3
  it('sotto PAGES_MIN il sito resta una ONE-PAGER e le sezioni rientrano nella home', () => {
    const dueSuperstiti = briefDa({
      business_name: 'Osteria del Ponte',
      vertical: 'ristorazione',
      primary_goal: 'prenota',
      description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
      offerings: SEI_OFFERTE,
    });

    const pagine = pagesFor(dueSuperstiti, { maxPages: SENZA_TETTO_DI_PIANO });

    // Nessuna pagina sottile: una pagina sola, ed e' la home in forma one-pager.
    expect(pagine).toHaveLength(1); // covers: AC-213-3
    expect(ruoli(pagine)).toEqual(['home']); // covers: AC-213-3
    expect(laHome(pagine).shape).toBe('one-pager'); // covers: AC-213-3

    // Il GIVEN e' ASSERITO invece di essere assunto: i ruoli superstiti sono DUE, cioe'
    // davvero MENO di PAGES_MIN. Senza questa riga il caso non saprebbe di essere il caso
    // che dichiara, e resterebbe verde anche se la one-pager arrivasse da un'altra ragione.
    expect(ruoliSuperstiti(pagine)).toEqual(['home', 'offerings']); // covers: AC-213-3
    expect(ruoliSuperstiti(pagine).length).toBeLessThan(PAGES_MIN); // covers: AC-213-3

    // "i blocchi che sarebbero stati pagine compaiono come sezioni della home": la sezione
    // assorbita e' dichiarata dalla home, e i blocchi che la giustificano sono davvero fra
    // quelli che il catalogo di T-210 ammette sulla home per QUESTO brief.
    expect(laHome(pagine).absorbed_roles).toEqual(['offerings']); // covers: AC-213-3
    for (const assorbito of laHome(pagine).absorbed_roles) {
      for (const id of voceInterna(assorbito).justifying_blocks) {
        expect(idBlocchi(dueSuperstiti, 'home'), `${assorbito}/${id}`).toContain(id); // covers: AC-213-3
      }
    }
    // E SI PASSA DAL CONTRATTO VERO che comporra' la pagina (`applyRecipe`, T-212): con
    // questo brief tutte e cinque le direzioni portano la sezione offerte nella home, quindi
    // la sezione non e' soltanto AMMESSA, e' composta.
    expect(RECIPES, 'catalogo di ricette vuoto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-213-3
    for (const ricetta of RECIPES) {
      const composti = applyRecipe(ricetta, dueSuperstiti, 'home').map((blocco) => blocco.id);
      expect(composti, `${ricetta.id}/home`).toContain('offerte'); // covers: AC-213-3
    }

    // IL RAMO POSITIVO, sullo STESSO brief piu' due sorgenti: superati i PAGES_MIN
    // superstiti, la pagina offerte esiste. Cio' che la fa rientrare nella home e' dunque la
    // SOGLIA e non l'incapacita' di produrla.
    const treSuperstiti = applyBriefUpdate(dueSuperstiti, {
      hours: ORARI,
      address: 'Via dei Mille 4, Bologna',
      phone: '+39 051 000111',
    }).brief;
    const multi = pagesFor(treSuperstiti, { maxPages: SENZA_TETTO_DI_PIANO });
    expect(slugs(multi)).toEqual(['home', 'offerte', 'contatti', 'orari', 'domande-frequenti']); // covers: AC-213-3
    expect(laHome(multi).shape).toBe('multi-page'); // covers: AC-213-3
    expect(laHome(multi).absorbed_roles).toEqual([]); // covers: AC-213-3
  });

  // covers: AC-213-1, AC-213-2, AC-213-3
  it('ogni caso dichiarato produce ESATTAMENTE il set, la forma e le sezioni attese', () => {
    // IL CICLO TABELLARE. Ogni caso pinna tre cose che non si implicano fra loro (i ruoli
    // superstiti, la sequenza delle pagine, la forma e le sezioni della home) e i casi sono
    // costruiti a COPPIE attorno ai confini delle soglie.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );

    for (const caso of CASI) {
      const brief = caso.brief();
      const pagine = pagesFor(brief, { maxPages: SENZA_TETTO_DI_PIANO });

      // La SEQUENZA delle pagine, per slug E per ruolo: due letture della stessa decisione,
      // e la seconda prende una coppia slug/ruolo scambiata fra due voci del catalogo.
      expect(slugs(pagine), caso.nome).toEqual(slugAttesi(caso.pagine)); // covers: AC-213-2
      expect(ruoli(pagine), caso.nome).toEqual(caso.pagine); // covers: AC-213-2
      // L'INSIEME dei ruoli superstiti (l'ordine dell'unione non e' una decisione).
      expect(new Set(ruoliSuperstiti(pagine)), caso.nome).toEqual(new Set(caso.ruoli_superstiti)); // covers: AC-213-2
      // La forma, su OGNI pagina: e' il sito ad avere una forma, quindi due pagine dello
      // stesso set non possono dichiararne due diverse.
      for (const pagina of pagine) {
        expect(pagina.shape, `${caso.nome}/${pagina.slug}`).toBe(caso.forma); // covers: AC-213-1
      }
      // I ruoli ASSORBITI dalla home, IN ORDINE: e' l'ordine di priorita'.
      expect(laHome(pagine).absorbed_roles, caso.nome).toEqual(caso.home_absorbed_roles); // covers: AC-213-3
      // R-01, IL VERSO CHE MANCAVA. L'unico oracolo sugli assorbiti guardava una direzione
      // sola (ogni assorbito e' AMMESSO sulla home) e non poteva vedere questa: un ruolo CON
      // pagina propria non deve comparire fra gli assorbiti, altrimenti la stessa sezione
      // sarebbe dichiarata due volte e la home rivendicherebbe una pagina che esiste altrove.
      for (const conPagina of ruoli(pagine)) {
        expect(laHome(pagine).absorbed_roles, `${caso.nome}/${conPagina}`).not.toContain(conPagina); // covers: AC-213-3
      }
      // E il verso complementare: un ruolo superstite SENZA pagina propria non resta fuori.
      for (const superstite of caso.ruoli_superstiti) {
        if (superstite === 'home' || ruoli(pagine).includes(superstite)) continue;
        expect(laHome(pagine).absorbed_roles, `${caso.nome}/${superstite}`).toContain(superstite); // covers: AC-213-3
      }

      // LE PROPRIETA' che valgono per ogni caso, e non un altro caso nominale:
      // - la home c'e' sempre ed e' la PRIMA (DoD);
      expect(ruoli(pagine)[0], caso.nome).toBe('home');
      // - nessuno slug e nessun ruolo si ripete (due pagine con lo stesso slug pretendono lo
      //   stesso indirizzo, e `parseDocument` le rifiuta: T-202);
      expect(new Set(slugs(pagine)).size, caso.nome).toBe(pagine.length);
      expect(new Set(ruoli(pagine)).size, caso.nome).toBe(pagine.length);
      // - una one-pager ha una pagina e una pagina sola implica la one-pager. R-05: qui si
      //   confrontano le DUE LETTURE DEL MODULO — il conteggio delle pagine e la `shape` che
      //   la home dichiara — e non due valori entrambi presi dalla tabella. Nella forma
      //   precedente (`toBe(caso.forma === 'one-pager')`) la riga non poteva fallire: la
      //   lunghezza era gia' pinnata dalla sequenza attesa e `caso.forma` e' una costante
      //   della tabella, quindi confrontava la tabella con se stessa;
      expect(pagine.length === 1, caso.nome).toBe(laHome(pagine).shape === 'one-pager');
      // - una pagina INTERNA non assorbe nulla: e' la home la sola che assorbe;
      for (const pagina of pagine) {
        if (pagina.role === 'home') continue;
        expect(pagina.absorbed_roles, `${caso.nome}/${pagina.slug}`).toEqual([]);
      }
      // - la sequenza e' ordinata per priorita' DECRESCENTE. La priorita' non e' piu' un campo
      //   di PageSpec (esporla consegnerebbe a valle la leva del riordino), quindi la si legge
      //   dal CATALOGO per ruolo: e' anche la lettura piu' forte, perche' una priorita'
      //   riportata sbagliata sulla pagina non potrebbe piu' mascherare un ordine sbagliato;
      const priorita = pagine.map((pagina) => atteso(pagina.role).priority);
      expect([...priorita].sort((a, b) => b - a), caso.nome).toEqual(priorita);
      // - ogni ruolo superstite o e' una pagina o e' una sezione della home: NESSUN DATO SI
      //   PERDE per strada (e' cio' che rende la one-pager una scelta e non una potatura).
      const conPaginaPropria = new Set<PageRole>(ruoli(pagine));
      for (const superstite of caso.ruoli_superstiti) {
        const eSezioneDellaHome = laHome(pagine).absorbed_roles.includes(superstite);
        expect(
          conPaginaPropria.has(superstite) || eSezioneDellaHome,
          `${caso.nome}: il ruolo ${superstite} sopravvive ma non e ne pagina ne sezione`,
        ).toBe(true);
      }

      // R-04 — I TETTI INSENSATI, DENTRO IL CICLO e non in un caso a parte. Tre difetti
      // indipendenti — la home tagliabile sotto un tetto nullo, NaN letto come "nessun tetto",
      // Math.ceil al posto di Math.floor — erano retti da UN SOLO `it`: misurato, ognuno dei
      // tre produceva esattamente un rosso, mentre le proprieta' che vivono qui dentro ne
      // producono da tre a tredici. Un indebolimento di quell'unico test avrebbe riportato le
      // tre regressioni verdi insieme.
      // Che il risultato sia la SOLA home per ogni tetto <= 1 e per NaN e' la lettura di
      // `tettoDiPagine`: il pavimento e' SOLO_LA_HOME, e NaN significa "nessun tetto DICHIARATO"
      // e non "nessun tetto".
      for (const tetto of [0, -1, -100, Number.NaN, 1]) {
        const soloHome = pagesFor(brief, { maxPages: tetto });
        expect(slugs(soloHome), `${caso.nome}/tetto=${tetto}`).toEqual(['home']);
        expect(ruoli(soloHome)[0], `${caso.nome}/tetto=${tetto}`).toBe('home');
        expect(laHome(soloHome).shape, `${caso.nome}/tetto=${tetto}`).toBe('one-pager');
      }
      // Un tetto FRAZIONARIO si arrotonda PER DIFETTO: 2.5 deve dare lo stesso set di 2, non
      // quello di 3. E' il solo confine che distingue Math.floor da Math.ceil, e senza un caso
      // frazionario la differenza fra i due non e' osservabile.
      expect(
        slugs(pagesFor(brief, { maxPages: 2.5 })),
        `${caso.nome}/tetto frazionario`,
      ).toEqual(slugs(pagesFor(brief, { maxPages: 2 })));
    }
  });

  it('la SEZIONE esiste dove la PAGINA non esiste: la soglia della pagina e piu alta', () => {
    // Non deriva da un AC: e' la distinzione che T-210 dichiara nel commento di MIN_OFFERTE
    // e che questo task deve onorare. Una sezione con poche voci dentro la home e'
    // legittima; una PAGINA con poche voci e' la pagina sottile che P2-D13 esclude.
    //
    // IL CASO E' DIFFERENZIALE su DUE campi diversi, perche' una soglia sola non dice che la
    // regola e' generale: tre offerte (la sezione offerte esiste, la pagina no) e un solo
    // recapito (la sezione contatti esiste, la pagina no).
    const treOfferte = briefRicco([], { offerings: TRE_OFFERTE });
    expect(treOfferte.content.offerings).toHaveLength(3);
    expect(idBlocchi(treOfferte, 'home')).toContain('offerte');
    expect(idBlocchi(treOfferte, 'offerings')).toContain('offerte');
    expect(ruoli(pagesFor(treOfferte, { maxPages: SENZA_TETTO_DI_PIANO }))).not.toContain(
      'offerings',
    );

    const unRecapito = briefRicco(['address', 'whatsapp', 'email']);
    expect(idBlocchi(unRecapito, 'home')).toContain('contatti');
    expect(idBlocchi(unRecapito, 'contact')).toContain('contatti');
    expect(ruoli(pagesFor(unRecapito, { maxPages: SENZA_TETTO_DI_PIANO }))).not.toContain('contact');

    // E LA SOGLIA DELLA PAGINA ORARI NON E' PIU' ALTA, che e' una scelta dichiarata e non una
    // dimenticanza: `hours` e' una mappa a CHIAVI LIBERE (P1-D13), quindi contare le chiavi
    // non misura quanta informazione la pagina porta — 'lun-dom' e' UNA chiave e copre la
    // settimana intera. Un tetto sul numero di chiavi rifiuterebbe una settimana completa
    // scritta bene. Questa riga pinna la scelta: con una sola chiave la pagina esiste.
    const unOrario = briefRicco([], { hours: UN_ORARIO });
    expect(Object.keys(unOrario.hours ?? {})).toHaveLength(1);
    expect(ruoli(pagesFor(unOrario, { maxPages: SENZA_TETTO_DI_PIANO }))).toContain('hours');
  });

  it('la pagina recensioni NON esiste per nessun brief, e la sua voce resta nel catalogo', () => {
    // IL NODO, deciso e non aggirato — la stessa scelta di T-210 e di T-212. Il Brief v1 non
    // ha alcun campo che porti recensioni, quindi il blocco 'recensioni' non e' soddisfatto
    // da nessun brief e la pagina non esiste mai. La VOCE resta in PAGE_CATALOG con il suo
    // slug e la sua priorita': cancellarla nasconderebbe la decisione, e il giorno in cui una
    // sorgente di recensioni entrera' nel brief la pagina nascera' da sola.
    expect(voceInterna('reviews').justifying_blocks).toEqual(['recensioni']);
    expect(bloccoDelCatalogo('recensioni').slots).toEqual(['reviews_title', 'reviews_intro']);

    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    for (const caso of CASI) {
      const pagine = pagesFor(caso.brief(), { maxPages: SENZA_TETTO_DI_PIANO });
      expect(ruoli(pagine), caso.nome).not.toContain('reviews');
      // E nemmeno come SEZIONE assorbita: una sezione senza sorgente e' il segnaposto che
      // P2-D7 vieta, quindi non deve comparire nemmeno nella home di una one-pager.
      expect(ruoliSuperstiti(pagine), caso.nome).not.toContain('reviews');
    }
    // Il ramo POSITIVO, senza il quale l'assenza potrebbe venire da un catalogo inerte: col
    // brief piu' ricco le ALTRE pagine ci sono tutte.
    expect(ruoli(pagesFor(briefRicco(), { maxPages: SENZA_TETTO_DI_PIANO }))).toEqual([
      'home',
      'offerings',
      'contact',
      'hours',
      'faq',
    ]);
  });
});

// ── AC-213-4, AC-213-5 — maxPages taglia in ordine, e in modo deterministico ──

describe('T-213 pagesFor — maxPages taglia per priorita, in modo deterministico', () => {
  // Il set che il brief piu' ricco produce SENZA tetto di piano, scritto a mano: e' il
  // termine di confronto di ogni caso di taglio.
  const RICCO_SENZA_TETTO: readonly PageRole[] = ['home', 'offerings', 'contact', 'hours', 'faq'];

  // QUANTE PAGINE IL BRIEF PIU' RICCO PUO' PRODURRE, e perche' il given di AC-213-4 ("un
  // brief ricco che produrrebbe otto pagine") NON E' COSTRUIBILE: i ruoli di pagina sono SEI
  // (T-201) e uno dei sei — 'reviews' — non e' soddisfacibile da alcun Brief v1, quindi il
  // set massimo e' di CINQUE pagine. Il numero e' LETTERALE e pinnato: il giorno in cui
  // nascera' un settimo ruolo, o una sorgente di recensioni, questa riga diventa rossa e la
  // lettura dell'AC torna sul tavolo invece di restare una discrepanza silenziosa. Cio' che
  // AC-213-4 chiede DAVVERO — maxPages=1 collassa alla sola home per qualunque ricchezza —
  // e' verificato sul brief PIU' RICCO COSTRUIBILE, che e' il caso peggiore disponibile.
  const PAGINE_AL_MASSIMO_DELLA_RICCHEZZA = 5;

  // covers: AC-213-4
  it('il brief piu ricco produce cinque pagine, non otto: il massimo e dichiarato', () => {
    const pagine = pagesFor(briefRicco(), { maxPages: SENZA_TETTO_DI_PIANO });
    expect(pagine).toHaveLength(PAGINE_AL_MASSIMO_DELLA_RICCHEZZA); // covers: AC-213-4
    expect(ruoli(pagine)).toEqual(RICCO_SENZA_TETTO); // covers: AC-213-4
    // Il set derivato sta sotto il tetto del DOCUMENTO, che e' derivato e non riscritto: il
    // giorno in cui i ruoli diventassero piu' di dieci, il documento rifiuterebbe il sito e
    // questa riga lo dice prima.
    expect(pagine.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.max_pages); // covers: AC-213-4
    expect(PAGE_CATALOG.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.max_pages); // covers: AC-213-4
  });

  // covers: AC-213-4
  it('con maxPages=1 il risultato e la sola home, per quanto ricco sia il brief', () => {
    const ricco = briefRicco();
    const pagine = pagesFor(ricco, { maxPages: 1 });

    expect(pagine).toHaveLength(1); // covers: AC-213-4
    expect(ruoli(pagine)).toEqual(['home']); // covers: AC-213-4
    expect(slugs(pagine)).toEqual(['home']); // covers: AC-213-4
    expect(laHome(pagine).shape).toBe('one-pager'); // covers: AC-213-4
    // E NULLA SI PERDE: i quattro ruoli tagliati rientrano nella home come sezioni, IN
    // ORDINE DI PRIORITA'. E' la riga che distingue un tetto di piano da una potatura.
    expect(laHome(pagine).absorbed_roles).toEqual(['offerings', 'contact', 'hours', 'faq']); // covers: AC-213-4
    // Il ramo POSITIVO sullo STESSO brief: senza tetto le cinque pagine ci sono. Cio' che le
    // riduce e' dunque maxPages e non i dati.
    expect(ruoli(pagesFor(ricco, { maxPages: SENZA_TETTO_DI_PIANO }))).toEqual(RICCO_SENZA_TETTO); // covers: AC-213-4
  });

  // covers: AC-213-5
  it('con maxPages=3 restano le TRE di priorita piu alta, e due chiamate danno lo stesso set', () => {
    const ricco = briefRicco();
    const prima = pagesFor(ricco, { maxPages: 3 });
    const dopo = pagesFor(ricco, { maxPages: 3 });

    // Le tre pagine, scritte a mano: sono le tre di priorita' piu' alta fra le superstiti.
    // Uguaglianza su SEQUENZA, ordine compreso.
    expect(slugs(prima)).toEqual(['home', 'offerte', 'contatti']); // covers: AC-213-5
    expect(ruoli(prima)).toEqual(['home', 'offerings', 'contact']); // covers: AC-213-5
    expect(prima).toHaveLength(3); // covers: AC-213-5
    // Le due chiamate danno lo STESSO risultato, e non solo gli stessi slug: il confronto e'
    // sull'oggetto intero, quindi prende anche una forma o un elenco di sezioni che cambino
    // fra due chiamate.
    expect(dopo).toEqual(prima); // covers: AC-213-5

    // IL TAGLIO NON E' ARBITRARIO — ORACOLO AGGIUNTIVO 3, la lezione di T-210/T-212: un
    // confronto fra INSIEMI non prova nulla sull'ordine. Le tre superstiti di priorita' piu'
    // alta NON sono le prime tre dell'ordine di DICHIARAZIONE (che darebbero orari al posto
    // di contatti) ne le prime tre dell'ordine ALFABETICO degli slug.
    const primeTrePerDichiarazione = ORDINE_DICHIARATO.filter((ruolo) =>
      RICCO_SENZA_TETTO.includes(ruolo),
    ).slice(0, 3);
    const primeTrePerSlug = ORDINE_ALFABETICO_DI_SLUG.filter((ruolo) =>
      RICCO_SENZA_TETTO.includes(ruolo),
    ).slice(0, 3);
    expect(primeTrePerDichiarazione).toEqual(['home', 'offerings', 'hours']); // covers: AC-213-5
    expect(primeTrePerSlug).toEqual(['contact', 'faq', 'home']); // covers: AC-213-5
    expect(ruoli(prima)).not.toEqual(primeTrePerDichiarazione); // covers: AC-213-5
    expect(ruoli(prima)).not.toEqual(primeTrePerSlug); // covers: AC-213-5

    // E le due pagine tagliate rientrano nella home, in ordine di priorita'.
    expect(laHome(prima).absorbed_roles).toEqual(['hours', 'faq']); // covers: AC-213-5
    expect(laHome(prima).shape).toBe('multi-page'); // covers: AC-213-5
  });

  // covers: AC-213-5
  it('il taglio NON RIORDINA: a ogni tetto le superstiti conservano l ordine di priorita', () => {
    // La PROPRIETA' invece del caso nominale: per ogni tetto da 1 a 6, la sequenza prodotta
    // e' il PREFISSO dell'ordine di priorita' fra le superstiti — mai una permutazione, mai
    // un taglio dalla testa. Gli attesi sono scritti a mano, tetto per tetto.
    const ricco = briefRicco();
    const ATTESI_PER_TETTO: Record<number, readonly PageRole[]> = {
      1: ['home'],
      2: ['home'],
      3: ['home', 'offerings', 'contact'],
      4: ['home', 'offerings', 'contact', 'hours'],
      5: ['home', 'offerings', 'contact', 'hours', 'faq'],
      6: ['home', 'offerings', 'contact', 'hours', 'faq'],
    };
    // Il tetto 2 e' il caso che merita di essere letto due volte: DUE pagine superstiti sono
    // sotto PAGES_MIN, quindi il sito NON diventa un due-pagine — resta una one-pager. Un
    // tetto di piano non puo' produrre la pagina sottile che P2-D13 esclude.
    const FORMA_PER_TETTO: Record<number, PageSpec['shape']> = {
      1: 'one-pager',
      2: 'one-pager',
      3: 'multi-page',
      4: 'multi-page',
      5: 'multi-page',
      6: 'multi-page',
    };

    for (const tetto of [1, 2, 3, 4, 5, 6]) {
      const pagine = pagesFor(ricco, { maxPages: tetto });
      expect(ruoli(pagine), `maxPages=${tetto}`).toEqual(ATTESI_PER_TETTO[tetto]); // covers: AC-213-5
      expect(laHome(pagine).shape, `maxPages=${tetto}`).toBe(FORMA_PER_TETTO[tetto]); // covers: AC-213-5
      // E il numero di pagine non supera mai il tetto chiesto (la sola eccezione dichiarata
      // e' la home, che sotto il tetto 1 resta comunque).
      expect(pagine.length, `maxPages=${tetto}`).toBeLessThanOrEqual(Math.max(1, tetto)); // covers: AC-213-5
      // Ogni ruolo superstite che non e' pagina e' sezione della home: il taglio non perde
      // nulla a nessun tetto.
      expect(new Set(ruoliSuperstiti(pagine)), `maxPages=${tetto}`).toEqual(
        new Set(RICCO_SENZA_TETTO),
      ); // covers: AC-213-5
    }
  });

  // covers: AC-213-5
  it('due chiamate con argomenti DIVERSI danno risultati diversi, e il catalogo non si muove', () => {
    // IL VERSO CHE LA SOLA RIPETIZIONE NON COPRE (lezione R-04 di T-212): ripetere la stessa
    // chiamata prende lo stato che SPORCA, non quello che CONGELA. Una memoizzazione sul
    // solo brief, che ignorasse `maxPages`, soddisfa ogni riga del caso precedente. Qui le
    // chiamate sono INTERPOSTE e con argomenti diversi, e la differenza attesa e' scritta a
    // mano.
    const ricco = briefRicco();
    const povero = briefPoverissimo();
    const primaDelleChiamate = JSON.stringify(PAGE_CATALOG);
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il confronto sarebbe vero per vacuita').toHaveLength(
      6,
    ); // covers: AC-213-5

    const conTre = pagesFor(ricco, { maxPages: 3 });
    const conPovero = pagesFor(povero, { maxPages: 3 });
    const senzaTetto = pagesFor(ricco, { maxPages: SENZA_TETTO_DI_PIANO });
    const conTreDiNuovo = pagesFor(ricco, { maxPages: 3 });

    expect(ruoli(conTre)).toEqual(['home', 'offerings', 'contact']); // covers: AC-213-5
    expect(ruoli(conPovero)).toEqual(['home']); // covers: AC-213-5
    expect(ruoli(senzaTetto)).toEqual(RICCO_SENZA_TETTO); // covers: AC-213-5
    // Lo STESSO argomento dopo le interposizioni da' lo stesso risultato.
    expect(conTreDiNuovo).toEqual(conTre); // covers: AC-213-5
    // E argomenti diversi danno risultati che li DISTINGUONO: e' la seconda meta' del
    // determinismo su cui T-214 poggia.
    expect(ruoli(conTre)).not.toEqual(ruoli(senzaTetto)); // covers: AC-213-5
    expect(ruoli(conTre)).not.toEqual(ruoli(conPovero)); // covers: AC-213-5

    // L'ORACOLO DI CORRUZIONE: `sort` ordina IN PLACE, e una `pagesFor` che ordinasse il
    // catalogo esportato lo corromperebbe alla prima chiamata — l'ordine di dichiarazione
    // diventerebbe quello di priorita' e ogni oracolo sull'ordine di dichiarazione cadrebbe
    // DOPO, in un altro test, per una ragione difficile da leggere.
    //
    // QUANTO E' FORTE, MISURATO invece che affermato: il modulo ordina l'array FRESCO che
    // `filter` produce, quindi la corruzione non e' scrivibile senza un cast che tolga il
    // `readonly`. Con quel cast — `(PAGE_CATALOG as PageDefinition[]).sort(...)` — questa riga
    // E' rossa (verificato). Una versione precedente del modulo ordinava una lista INTERNA
    // parallela al catalogo, e allora la stessa riga NON vedeva nulla: il cast in place era
    // verde su tutte e 29 le asserzioni. La lista parallela e' stata tolta per quello, non per
    // eleganza — un oracolo che non puo' fallire e' copertura che non esiste.
    expect(JSON.stringify(PAGE_CATALOG)).toBe(primaDelleChiamate); // covers: AC-213-5
    expect(ruoliDelCatalogo()).toEqual(ORDINE_DICHIARATO); // covers: AC-213-5
  });

  it('la HOME NON E TAGLIABILE: nessun valore di maxPages la fa sparire', () => {
    // ORACOLO AGGIUNTIVO 4 (non deriva da un AC). Il tipo di `maxPages` e' `number`, quindi
    // lo zero, i negativi, i non interi e i non finiti sono TUTTI rappresentabili — la
    // colonna del DB li vincola (T-204: intero, min 1, max DOCUMENT_LIMITS.max_pages), ma la
    // funzione e' pura e chiunque puo' chiamarla. "La home e' sempre presente per qualunque
    // brief confermato" e' DoD, e qui si chiede che valga anche per qualunque tetto.
    const ricco = briefRicco();
    const CASI_DI_TETTO: readonly { readonly maxPages: number; readonly pagine: number }[] = [
      { maxPages: 0, pagine: 1 },
      { maxPages: -1, pagine: 1 },
      { maxPages: Number.NEGATIVE_INFINITY, pagine: 1 },
      { maxPages: Number.NaN, pagine: 1 },
      // Non intero: 2,7 pagine sono al piu' DUE pagine, e due sono sotto PAGES_MIN.
      { maxPages: 2.7, pagine: 1 },
      // 3,2 pagine sono al piu' TRE, che e' PAGES_MIN: il sito resta multi-pagina.
      { maxPages: 3.2, pagine: 3 },
      // Nessun tetto: tutte le superstiti.
      { maxPages: Number.POSITIVE_INFINITY, pagine: 5 },
    ];

    for (const caso of CASI_DI_TETTO) {
      const pagine = pagesFor(ricco, { maxPages: caso.maxPages });
      expect(pagine.length, `maxPages=${caso.maxPages}`).toBe(caso.pagine);
      expect(ruoli(pagine)[0], `maxPages=${caso.maxPages}`).toBe('home');
      expect(slugs(pagine), `maxPages=${caso.maxPages}`).toContain('home');
      // E anche col tetto azzerato nulla si perde: le sezioni superstiti restano nella home.
      expect(new Set(ruoliSuperstiti(pagine)), `maxPages=${caso.maxPages}`).toEqual(
        new Set(RICCO_SENZA_TETTO),
      );
    }

    // E vale anche col brief piu' povero, dove non c'e' nulla da assorbire: la home non e'
    // tenuta in vita da una sezione, e' tenuta in vita dalla propria regola.
    expect(ruoli(pagesFor(briefPoverissimo(), { maxPages: 0 }))).toEqual(['home']);
  });
});

// ── AC-213-6 — la navigazione e i link interni ───────────────────────────────

describe('T-213 navigationFor — una voce per pagina, e nessun 404 interno', () => {
  // covers: AC-213-6
  it('ogni destinazione e lo slug di una pagina del set, e la pagina scartata non compare', () => {
    const ricco = briefRicco();
    const senzaTetto = pagesFor(ricco, { maxPages: SENZA_TETTO_DI_PIANO });
    const conTre = pagesFor(ricco, { maxPages: 3 });

    // IL GIVEN, asserito: due pagine POTENZIALI sono state scartate dal tetto — cioe' la loro
    // precondizione E' soddisfatta, e senza tetto esisterebbero. Senza questa riga il caso
    // proverebbe l'assenza di una pagina che non sarebbe potuta esistere comunque, che e' una
    // cosa diversa e piu' facile.
    expect(slugs(senzaTetto)).toContain('orari'); // covers: AC-213-6
    expect(slugs(senzaTetto)).toContain('domande-frequenti'); // covers: AC-213-6
    expect(slugs(conTre)).toEqual(['home', 'offerte', 'contatti']); // covers: AC-213-6

    const voci = navigationFor(conTre);

    // UNA VOCE PER CIASCUNA PAGINA E PER NESSUN'ALTRA, in ordine: la sequenza degli slug e
    // dei ruoli coincide con quella del set.
    expect(voci).toHaveLength(conTre.length); // covers: AC-213-6
    expect(destinazioni(voci)).toEqual(['home', 'offerte', 'contatti']); // covers: AC-213-6
    expect(voci.map((voce) => voce.role)).toEqual(['home', 'offerings', 'contact']); // covers: AC-213-6
    // Le etichette sono CHIAVI i18n (P2-D10) e vengono dal catalogo: mai una stringa gia'
    // tradotta, mai un testo del brief.
    expect(voci.map((voce) => voce.label_key)).toEqual([
      'site.nav.home',
      'site.nav.offerings',
      'site.nav.contact',
    ]); // covers: AC-213-6

    // LA PROPRIETA': ogni destinazione e' lo slug di una pagina PRESENTE nel set. Il
    // confronto e' per UGUAGLIANZA ESATTA, mai per prefisso.
    const presenti = new Set(slugs(conTre));
    for (const voce of voci) {
      expect(presenti.has(voce.slug), voce.slug).toBe(true); // covers: AC-213-6
    }

    // E NESSUNA VOCE, NESSUNA DESTINAZIONE verso le pagine scartate: nessun 404 interno.
    // Gli slug scartati sono nominati a mano — 'orari' e 'domande-frequenti' sono le due
    // pagine POTENZIALI tagliate dal tetto, 'recensioni' quella che nessun dato produce.
    for (const scartato of ['orari', 'domande-frequenti', 'recensioni']) {
      expect(destinazioni(voci), scartato).not.toContain(scartato); // covers: AC-213-6
    }
    // Lo stesso, detto sui RUOLI: e' cosi' che una voce si sbaglia (lo slug lo si copia dalla
    // pagina, il ruolo lo si sceglie).
    for (const scartato of ['hours', 'faq', 'reviews'] as const) {
      expect(
        voci.some((voce) => voce.role === scartato),
        scartato,
      ).toBe(false); // covers: AC-213-6
    }
  });

  // covers: AC-213-6
  it('navigationFor NON consulta il catalogo: su un set vuoto o parziale non inventa voci', () => {
    // E' LA RIGA CHE REGGE L'IRRAPPRESENTABILITA'. `navigationFor` e' una PROIEZIONE del set
    // che riceve: la destinazione e' copiata dalla pagina, quindi una voce verso una pagina
    // che non esiste non e' scrivibile. Una versione che leggesse PAGE_CATALOG per sapere
    // quali voci esistono potrebbe emetterne una per un ruolo che il set non contiene — ed e'
    // esattamente cio' che questi due casi prendono.
    expect(navigationFor([])).toEqual([]); // covers: AC-213-6

    // Un set PARZIALE, senza la home: nessuna voce 'home' viene inventata. E' il caso vero
    // della fase 2 (T-235), che ragiona su un sottoinsieme di pagine.
    const soloContatti: readonly PageSpec[] = [
      {
        role: 'contact',
        slug: 'contatti',
        label_key: 'site.nav.contact',
        shape: 'multi-page',
        absorbed_roles: [],
      },
    ];
    expect(destinazioni(navigationFor(soloContatti))).toEqual(['contatti']); // covers: AC-213-6
    expect(navigationFor(soloContatti)).toHaveLength(1); // covers: AC-213-6
  });

  // covers: AC-213-6
  it('due slug di cui uno e PREFISSO dell altro restano due voci distinte', () => {
    // La trappola del prefisso, che nel catalogo vero non e' costruibile (asserito piu'
    // sopra) e che qui e' fabbricata: una proiezione scritta con un dedup per prefisso, o una
    // lookup con startsWith, perderebbe una delle due voci.
    const conPrefisso: readonly PageSpec[] = [
      {
        role: 'offerings',
        slug: 'offerte',
        label_key: 'site.nav.offerings',
        shape: 'multi-page',
        absorbed_roles: [],
      },
      {
        role: 'offerings',
        slug: 'offerte-speciali',
        label_key: 'site.nav.offerings',
        shape: 'multi-page',
        absorbed_roles: [],
      },
    ];
    expect(destinazioni(navigationFor(conPrefisso))).toEqual(['offerte', 'offerte-speciali']); // covers: AC-213-6
  });

  // covers: AC-213-6
  it('per OGNI caso dichiarato la navigazione combacia esattamente col set', () => {
    // La PROPRIETA' su tutti i casi, invece del solo caso nominale di maxPages=3.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );

    for (const caso of CASI) {
      const pagine = pagesFor(caso.brief(), { maxPages: SENZA_TETTO_DI_PIANO });
      const voci = navigationFor(pagine);
      const presenti = new Set(slugs(pagine));

      // MISURATO NEL PASSO ROSSO: senza queste due righe il caso passava sullo STUB INERTE
      // (`pagesFor` e `navigationFor` che restituiscono []), perche' ogni confronto era fra
      // due elenchi vuoti e ogni ciclo era vacuo. Il numero atteso viene dalla TABELLA
      // scritta a mano, non da `pagine`.
      expect(pagine, caso.nome).toHaveLength(caso.pagine.length); // covers: AC-213-6
      expect(voci.length, caso.nome).toBeGreaterThan(0); // covers: AC-213-6
      expect(voci, caso.nome).toHaveLength(pagine.length); // covers: AC-213-6
      expect(destinazioni(voci), caso.nome).toEqual(slugs(pagine)); // covers: AC-213-6
      expect(
        voci.map((voce) => voce.role),
        caso.nome,
      ).toEqual(ruoli(pagine)); // covers: AC-213-6
      for (const voce of voci) {
        expect(presenti.has(voce.slug), `${caso.nome}/${voce.slug}`).toBe(true); // covers: AC-213-6
        expect(voce.label_key, `${caso.nome}/${voce.slug}`).toBe(atteso(voce.role).label_key); // covers: AC-213-6
      }
      // E nessuna voce verso un ruolo che il set non contiene: il verso opposto della stessa
      // proprieta', detto sui RUOLI perche' e' cosi' che una voce si sbaglia (lo slug lo si
      // copia, il ruolo lo si sceglie).
      const ruoliDelSet = new Set(ruoli(pagine));
      for (const voce of voci) {
        expect(ruoliDelSet.has(voce.role), `${caso.nome}/${voce.role}`).toBe(true); // covers: AC-213-6
      }
    }
  });
});

// ── oracolo AGGIUNTIVO 1 — il page_role degli slot, pinnato qui ──────────────

describe('T-213 oracoli aggiuntivi — il page_role degli slot regge PAGE_CATALOG', () => {
  // ORACOLO AGGIUNTIVO 1, e la voce di copertura dichiarata che lo chiede: "il `page_role` di
  // uno slot non e' pinnato (T-201): cambiarlo lascia la suite verde; va pinnato dove
  // qualcuno vi appoggera' una decisione (T-210 o T-213)".
  //
  // DOVE T-213 VI SI APPOGGIA, detto con precisione perche' l'appoggio non e' diretto:
  // `pagesFor` NON legge `slot.page_role` — chiede a `blocksFor` (T-210), che filtra sui
  // `page_roles` del BLOCCO. Cio' che questo modulo decide e' che il ruolo X abbia una pagina
  // propria giustificata dai blocchi dichiarati in `justifying_blocks`, e quella pagina ha
  // senso solo se la PROSA che il modello scrivera' per il ruolo X e' la prosa di quei
  // blocchi. Quella corrispondenza vive nel `page_role` degli slot, e senza di essa la pagina
  // 'orari' esisterebbe mentre i suoi slot appartengono a un'altra pagina — cioe' T-220
  // concederebbe al modello i permessi di scrittura sbagliati per quella pagina.
  //
  // COSA QUESTA SEZIONE NON DICE, per non dedurne di piu': NON dice che ogni slot reso su una
  // pagina abbia il `page_role` di quella pagina — in una one-pager la home porta anche gli
  // slot dei ruoli interni, e T-201 lo dichiara. Dice che gli slot dei blocchi che
  // GIUSTIFICANO il ruolo X dichiarano il ruolo X.
  //
  // DUE EQUIVALENZE MISURATE, e non coperte da alcun oracolo di questo file perche' non sono
  // difetti: sono lo stesso comportamento scritto in due modi.
  // (1) `sezioniPresenti` chiede a `blocksFor` IL RUOLO DELLA PAGINA; passargli 'home' da' oggi
  //     lo STESSO risultato per ogni brief, perche' ogni blocco giustificante dichiara ANCHE
  //     'home' (invariante di T-210, asserito qui sotto). Distinguere le due letture
  //     richiederebbe un blocco che dichiari un ruolo interno e NON 'home', che nel catalogo di
  //     T-210 non esiste e che questo file non puo' costruire: `pagesFor` non riceve un catalogo
  //     come parametro. Il ruolo della pagina resta l'argomento giusto per SIGNIFICATO.
  // (2) `pagesFor` prende la home PER RUOLO e non come prima voce dell'ordinamento; poiche' la
  //     home ha la priorita' MASSIMA le due letture coincidono, quindi la scelta strutturale non
  //     e' osservabile da sola. Cio' che la tiene osservabile e' l'asserzione "la home ha la
  //     priorita' massima": abbassare quella priorita' e' rosso, e la scelta strutturale e' cio'
  //     che fa restare la home nel set anche in quel caso.

  it('gli slot dei blocchi che giustificano il ruolo X dichiarano page_role X', () => {
    const ruoloDelloSlot = new Map(SLOTS.map((slot) => [slot.id, slot.page_role]));
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(
      6,
    );
    let ispezionati = 0;

    for (const voce of PAGE_CATALOG) {
      if (voce.role === 'home') continue; // la home non dichiara blocchi giustificanti
      for (const id of voce.justifying_blocks) {
        const blocco = bloccoDelCatalogo(id);
        expect(blocco.slots.length, `${voce.role}/${id}`).toBeGreaterThan(0);
        // OGNI BLOCCO GIUSTIFICANTE DICHIARA ANCHE 'home', ed e' la riga che spiega perche' una
        // delle mutazioni sopravvive (vedi il commento sopra): e' l'invariante di T-210 su cui
        // poggiano insieme il collasso in one-pager (le sezioni hanno dove andare) e
        // l'equivalenza fra chiedere a `blocksFor` il ruolo della pagina o il ruolo 'home'. Il
        // giorno in cui un blocco perdesse 'home', questa riga diventa rossa e quell'equivalenza
        // va rimisurata invece di restare una nota vecchia.
        expect(blocco.page_roles, `${voce.role}/${id}`).toContain('home');
        for (const slot of blocco.slots) {
          // La lookup e' una Map e non un oggetto indicizzato: un id di slot non e' un dato
          // non fidato, ma un oggetto risolverebbe comunque i membri di Object.prototype e
          // farebbe "esistere" uno slot chiamato 'constructor'.
          expect(ruoloDelloSlot.get(slot), `${voce.role}/${id}/${slot}`).toBe(voce.role);
          ispezionati += 1;
        }
      }
    }

    // I DIECI slot ispezionati: due per ciascuno dei cinque blocchi che giustificano una
    // pagina INTERNA. Erano tredici quando la home dichiarava 'hero' fra i propri blocchi
    // giustificanti (tre slot); quel campo e' stato tolto perche' era inerte, e con lui sono
    // usciti dal conto i tre slot dell'hero. Il numero resta LETTERALE — derivarlo da SLOTS o
    // da BLOCKS renderebbe la guardia vera per costruzione, e senza di essa un catalogo di
    // blocchi con gli slot svuotati renderebbe il ciclo vero per vacuita'.
    expect(ispezionati).toBe(10);
  });
});

// ── oracolo AGGIUNTIVO — la one-pager non perde nulla, col suo limite ────────

describe('T-213 oracoli aggiuntivi — le sezioni assorbite sono AMMESSE nella home', () => {
  // NON deriva da un AC alla lettera: AC-213-3 chiede che i blocchi che sarebbero stati
  // pagine "compaiano come sezioni della home". T-213 puo' garantire che siano AMMESSI —
  // ogni blocco del catalogo dichiara il ruolo 'home' (T-210), quindi la sezione ha un posto
  // dove andare — mentre CHI la compone davvero e' di T-212.
  //
  // IL LIMITE, PINNATO INVECE CHE SCOPERTO A VALLE: una delle cinque direzioni —
  // 'scatto-alla-conversione@1' — NON porta la sezione FAQ nella propria home, per scelta
  // dichiarata in T-212 ("qui la domanda a cui si vuole rispondere e' una sola e la si
  // risponde in chat"). Ne segue che con quella direzione una pagina FAQ assorbita non
  // diventa una sezione visibile: la si perde. E' una conseguenza reale della combinazione
  // fra il tetto di piano e quella direzione, e vive qui perche' e' qui che si vede.

  const HOME_SENZA_LA_SEZIONE: Record<string, readonly string[]> = {
    'vetrina-dell-offerta@1': [],
    'racconto-di-bottega@1': [],
    'scatto-alla-conversione@1': ['faq'],
    'mappa-e-orari@1': [],
    'scheda-sobria@1': [],
  };

  it('ogni blocco di ogni ruolo assorbito e AMMESSO sulla home dal catalogo di T-210', () => {
    const ricco = briefRicco();
    // maxPages=1 e' il caso con il maggior numero di ruoli assorbiti: quattro.
    const pagine = pagesFor(ricco, { maxPages: 1 });
    const assorbiti = laHome(pagine).absorbed_roles;
    expect(assorbiti, 'nessun ruolo assorbito: il ciclo sarebbe vero per vacuita').toEqual([
      'offerings',
      'contact',
      'hours',
      'faq',
    ]);

    const ammessiSullaHome = new Set(idBlocchi(ricco, 'home'));
    for (const ruolo of assorbiti) {
      for (const id of voceInterna(ruolo).justifying_blocks) {
        expect(bloccoDelCatalogo(id).page_roles, `${ruolo}/${id}`).toContain('home');
        expect(ammessiSullaHome.has(id), `${ruolo}/${id}`).toBe(true);
      }
    }
  });

  it('una direzione su cinque NON porta la sezione FAQ nella home: il limite e pinnato', () => {
    const ricco = briefRicco();
    const pagine = pagesFor(ricco, { maxPages: 1 });
    const assorbiti = laHome(pagine).absorbed_roles;
    expect(RECIPES, 'catalogo di ricette vuoto: il ciclo sarebbe vero per vacuita').toHaveLength(5);
    expect(new Set(Object.keys(HOME_SENZA_LA_SEZIONE))).toEqual(new Set(RECIPES.map((r) => r.id)));

    for (const ricetta of RECIPES) {
      const composti = new Set(applyRecipe(ricetta, ricco, 'home').map((blocco) => blocco.id));
      const mancanti: string[] = [];
      for (const ruolo of assorbiti) {
        for (const id of voceInterna(ruolo).justifying_blocks) {
          if (!composti.has(id)) mancanti.push(id);
        }
      }
      // L'elenco atteso e' scritto a mano, direzione per direzione: quattro direzioni non
      // perdono nulla, una perde la sezione FAQ. Un elenco vuoto da un lato e'
      // un'informazione, non una lacuna.
      expect(mancanti, ricetta.id).toEqual(HOME_SENZA_LA_SEZIONE[ricetta.id]);
    }
  });
});

// ── oracolo AGGIUNTIVO — lo slug passa dai gate veri (T-202 e T-201) ─────────

describe('T-213 oracoli aggiuntivi — la FORMA dello slug e una precondizione misurata', () => {
  // NON e' un AC: e' la precondizione DICHIARATA E PINNATA da T-201/T-202 (P2-D20,
  // AC-201-9). Lo slug di pagina e' vincolato per FORMA dentro il documento congelato
  // (minuscole, cifre e trattini singoli) e uno slug fuori forma fa cadere l'INTERO
  // documento, non solo il campo. E' la stessa forma che `PoolSchema` impone alle chiavi
  // della mappa delle pagine, dove serve a escludere per costruzione le chiavi speciali di
  // JavaScript da una mappa che nasce da JSON non fidato.
  //
  // IL CONTROLLO E' DERIVATO DAL CONTRATTO A MONTE, mai riscritto: la regex non compare in
  // questo file. Si usa lo schema di T-202 e si passa dai GATE veri (`parseDocument`,
  // `parsePool`), come fa tests/generation-themes.test.ts per gli id versionati — cosi' il
  // giorno in cui la forma cambia la' questo file diventa rosso invece di continuare a
  // giudicare con una regola sua.
  const SCHEMA_SLUG = SiteDocumentSchema.innerType().shape.pages.element.shape.slug;

  /** Il documento valido piu' piccolo che T-202 accetti, con le pagine del set sotto esame. */
  function documentoCon(pagine: readonly { readonly slug: string; readonly role: string }[]) {
    return {
      recipe_id: 'ricetta-di-prova@1',
      theme_id: 'tema-di-prova@1',
      pages: pagine.map((pagina) => ({
        slug: pagina.slug,
        role: pagina.role,
        title: 'Osteria del Ponte',
        meta_description: 'Osteria di quartiere a Bologna, cucina di stagione.',
        blocks: [{ id: 'hero', content: {}, data: {}, brief_fields_rendered: [], images: [] }],
      })),
    };
  }

  it('ogni slug del catalogo passa lo schema di T-202 e sta sotto il tetto di lunghezza', () => {
    expect(PAGE_CATALOG, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(
      6,
    );

    for (const voce of PAGE_CATALOG) {
      expect(SCHEMA_SLUG.safeParse(voce.slug).success, voce.slug).toBe(true);
      expect(voce.slug.length, voce.slug).toBeLessThanOrEqual(DOCUMENT_LIMITS.page_slug);
    }
  });

  it('il set derivato entra nel documento congelato, e uno slug fuori forma lo fa cadere INTERO', () => {
    const pagine = pagesFor(briefRicco(), { maxPages: SENZA_TETTO_DI_PIANO });
    expect(pagine).toHaveLength(5);

    // IL RAMO POSITIVO: il set vero, coi suoi slug e i suoi ruoli, passa il gate.
    expect(parseDocument(documentoCon(pagine)).ok).toBe(true);

    // IL RAMO NEGATIVO, costruito guastando UN solo slug — e il guasto non e' l'oracolo
    // (l'oracolo resta `parseDocument`): serve a fabbricare il controesempio. La maiuscola e'
    // la forma piu' facile da scrivere per sbaglio in uno slug derivato da un nome.
    const guastato = pagine.map((pagina, indice) =>
      indice === 1 ? { ...pagina, slug: 'Offerte' } : pagina,
    );
    expect(SCHEMA_SLUG.safeParse('Offerte').success).toBe(false);
    expect(parseDocument(documentoCon(guastato)).ok).toBe(false);
    // E gli altri quattro slug erano validi: cio' che fa cadere il documento e' quell'uno.
    expect(parseDocument(documentoCon(guastato.filter((_, i) => i !== 1))).ok).toBe(true);
  });

  it('gli slug del set sono l allowlist del pool: una pagina scartata non riceve contenuto', () => {
    // L'altra sede della stessa precondizione (T-201): `parsePool` riceve come allowlist gli
    // slug delle pagine che ESISTONO per questa generazione, cioe' proprio il set derivato
    // qui. Una pagina scartata non puo' quindi nemmeno ricevere prosa dal modello — che e'
    // AC-213-6 visto dal lato del contenuto invece che dal lato dei link.
    const conTre = pagesFor(briefRicco(), { maxPages: 3 });
    const ammessi = slugs(conTre);
    expect(ammessi).toEqual(['home', 'offerte', 'contatti']);

    expect(
      parsePool({ pages: { home: { hero_title: 'Osteria del Ponte' }, offerte: {} } }, {
        allowedSlugs: ammessi,
      }).ok,
    ).toBe(true);
    // Lo slug della pagina SCARTATA e' rifiutato dall'allowlist derivata dal set.
    expect(parsePool({ pages: { orari: {} } }, { allowedSlugs: ammessi }).ok).toBe(false);
  });
});

// ── R-02 — L'ORACOLO DI INTEGRAZIONE fra T-212 e T-213 ───────────────────────
// NON deriva da un AC: nasce da un buco MISURATO da una verifica avversariale, e vive qui
// perche' questo e' l'unico file in cui i due cataloghi si vedono insieme.
//
// IL BUCO. `PAGE_CATALOG` afferma che la pagina del ruolo X ESISTE perche' certi dati ci sono;
// solo `inner_page_rules` (T-212) puo' consegnarle un CONTENUTO; e nessun invariante dei due
// moduli lega le due affermazioni. Misurato in tre passi: (1) facendo dichiarare a tutte e
// cinque le direzioni `faq: ['chi-siamo']`, questo file restava interamente VERDE — T-213 non
// protestava affatto; (2) sulla suite intera protestava solo T-212, e per un'altra ragione (la
// sua tabella letterale); (3) la conseguenza vera e' che la pagina entra nel set, `applyRecipe`
// compone [] per quel ruolo, e `parseDocument` (T-202) RIFIUTA il documento — cioe' la
// generazione FALLISCE.
//
// PERCHE' L'INVARIANTE DI T-212 NON BASTA. La' si asserisce che ogni blocco citato per un ruolo
// DICHIARI quel ruolo, e prende il caso di sopra ('chi-siamo' dichiara 'home', non 'faq'). Ma
// non prende il caso in cui la ricetta citi un blocco che dichiara il ruolo giusto SENZA essere
// la sostanza della pagina: la pagina nascerebbe con un contenuto che non e' quello che la
// giustifica, e nessuno se ne accorgerebbe.
describe('T-213 x T-212 — ogni pagina del set ha DAVVERO un contenuto da ogni direzione', () => {
  it('per ogni caso e ogni direzione, ogni pagina interna riceve i blocchi che la giustificano', () => {
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    expect(RECIPES, 'catalogo di ricette vuoto: il ciclo sarebbe vero per vacuita').toHaveLength(5);
    let pagineIspezionate = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      const pagine = pagesFor(brief, { maxPages: SENZA_TETTO_DI_PIANO });

      for (const pagina of pagine) {
        if (pagina.role === 'home') continue; // la home non ha blocchi giustificanti
        for (const ricetta of RECIPES) {
          const composti = applyRecipe(ricetta, brief, pagina.role).map((blocco) => blocco.id);
          // (a) NON VUOTA: una pagina senza blocchi fa cadere l'INTERO documento in
          //     `parseDocument`, quindi questa riga e' la differenza fra una generazione che
          //     riesce e una che fallisce.
          expect(
            composti.length,
            `${caso.nome} / ${ricetta.id} / ${pagina.slug}: pagina nel set e composta VUOTA`,
          ).toBeGreaterThan(0);
          // (b) CONTIENE LA PROPRIA SOSTANZA: i blocchi che GIUSTIFICANO la pagina sono fra
          //     quelli che la direzione le consegna. Senza questo verso, una ricetta potrebbe
          //     comporre la pagina 'offerte' con un blocco qualunque che dichiari il ruolo
          //     'offerings' e la pagina esisterebbe senza cio' che la rende quella pagina.
          for (const id of voceInterna(pagina.role).justifying_blocks) {
            expect(
              composti,
              `${caso.nome} / ${ricetta.id} / ${pagina.slug}: manca il blocco giustificante ${id}`,
            ).toContain(id);
          }
          pagineIspezionate += 1;
        }
      }
    }

    // Guardia anti-vacuita' col numero LETTERALE: se i casi producessero solo one-pager il
    // ciclo non entrerebbe mai nel corpo e resterebbe verde senza guardare nulla.
    expect(pagineIspezionate, 'nessuna pagina interna ispezionata').toBeGreaterThan(40);
  });
});
