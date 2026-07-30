import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from '@/domain/generation/resolve';
import { BLOCKS } from '@/domain/generation/blocks';
import { RECIPES, applyRecipe, recipeFor, type SiteRecipe } from '@/domain/generation/recipes';
import { THEMES, type SiteTheme } from '@/domain/generation/themes';
import { PAGE_CATALOG, pagesFor, type PageSpec } from '@/domain/generation/pages';
import {
  DOCUMENT_LIMITS,
  SiteDocumentSchema,
  parseDocument,
  type SiteBlock,
  type SiteDocument,
  type SitePage,
} from '@/domain/generation/document';
import { POOL_LIMITS, parsePool, type Pool } from '@/domain/generation/pool';
import { SLOTS, type PageRole, type SlotId } from '@/domain/generation/slots';
import { BRIEF_LIMITS, applyBriefUpdate, emptyBrief, type Brief } from '@/domain/onboarding/brief';

// T-214 (macrotask generation-engine, P2) — RESOLVE: da pool + ricetta + tema + brief +
// set di pagine al SITE DOCUMENT. Le asserzioni DERIVANO dagli acceptance_criteria
// AC-214-1..AC-214-6 (docs/blueprint/P2-generation/02-generation-engine.md); i describe
// marcati "oracolo aggiuntivo" sono dichiarati come tali e nominano cio' che provano.
// Dominio puro: nessun DB, nessuna rete, nessun mock, nessun orologio.
//
// IL GATE VERO, SEMPRE, ed e' la regola che tiene in vita le tre precondizioni ereditate
// da T-202: ogni documento che questo file dichiara VALIDO ci passa da `parseDocument`, e
// ogni documento che dichiara RIFIUTATO viene rifiutato DA LUI. Un documento giudicato a
// mano sulla sua forma sarebbe una seconda verita' sullo schema — e le tre precondizioni
// (il peso, l'id versionato, la chiave degli orari) vivono proprio dentro quel gate.
//
// LE FIXTURE PASSANO DAI GATI DI MONTE per la stessa ragione: il brief nasce da
// `applyBriefUpdate` (T-121) e il pool da `parsePool` (T-201). Un brief scritto a mano che
// il dominio non accetterebbe, o un pool che il gate rifiuterebbe, farebbe provare a
// questo file qualcosa che non succede mai in produzione.
//
// Disciplina delle fixture (correzione di metodo n.1 di P1, il difetto ripetutosi tre
// volte con la suite verde): PIU' DI UN ELEMENTO, valori DISCORDANTI, e almeno un id che
// sia PREFISSO di un altro — 'Pane di grano duro' e 'Pane di grano duro integrale' fra le
// offerte, 'hero_title' e 'hero_title_kicker' fra gli slot (T-201 li dichiara apposta).
//
// CIO' CHE QUESTO FILE NON PROVA, scritto invece che sottinteso (L-COL-006):
// - non prova che il documento sia BELLO ne che il titolo scelto sia il migliore per la
//   SEO: lo stile non e' oracolabile (P1 §6-bis p.8). Prova che il titolo esiste sempre,
//   che non e' inventato e che non e' troncato;
// - non prova nulla sul RENDERING (T-231) ne sulla PERSISTENZA (T-203/T-204);
// - non prova che il documento sia SANIFICATO: resolve TRASPORTA il testo non fidato del
//   brief e del pool, e lo dichiara. La sanificazione e' di T-231/T-237.
//
// CIO' CHE RESTA DICHIARATO E NON ASSERITO (declared coverage):
// - RESOLVE NON E' UN GATE. Un pool a cui manchi tutto produce una pagina SENZA BLOCCHI, e
//   quel documento e' RIFIUTATO da `parseDocument` (asserito piu' sotto). resolve non
//   omette la pagina, e la ragione e' dichiarata nel modulo: ometterla farebbe divergere il
//   documento dal set di pagine e dalla navigazione di T-213, cioe' produrrebbe un 404
//   interno per riparare un pool incompleto.
// - L'ACCOPPIAMENTO ricetta-tema NON e' verificato da resolve: il documento registra l'id
//   del TEMA RICEVUTO, non `recipe.theme_id`. E' asserito con una coppia DISCORDANTE, cosi'
//   che si veda quale dei due valori viene letto; che la coppia sia coerente e'
//   precondizione del chiamante (T-230).
// - IL TOKEN DELL'IMAGERY e' l'id del blocco che apre la pagina. Il catalogo dei token del
//   tema non e' di questo task (T-211 lo dichiara fuori scope), quindi qui non c'e' modo di
//   provare che quel token esista davvero: cio' che si prova e' che ha la FORMA che il
//   documento ammette e che la sorgente e' sempre 'theme-placeholder'.
// - I VALORI DEL POOL sono trasportati PER RIFERIMENTO (nessuna copia profonda): il gate di
//   T-202 costruisce comunque la propria copia campo per campo. Cio' che si asserisce e' che
//   resolve non MUTA nulla, non che il documento sia disgiunto dal pool.
// - IMMUTABILITA' dei cataloghi: il `readonly` di TypeScript e' del compilatore. Qui si
//   giudica che resolve non li muti (serializzazione prima/dopo), non che nessuno POSSA.
//   Un `Object.freeze` sarebbe una decisione di macrotask, come dichiarato in T-211/T-213.
// - L'ORDINE DELLE CHIAVI di `content` e di `data` e' un contratto del solo documento
//   GREZZO. `parseDocument` restituisce la copia che zod costruisce, e zod ricostruisce ogni
//   oggetto nell'ordine della propria SHAPE: per `content` e' l'ordine del catalogo SLOTS
//   (T-201), per `data` quello dei campi del brief (T-121). Ogni asserzione d'ordine su
//   quelle chiavi guarda percio' `res.document`; sul documento accettato si confrontano
//   INSIEMI. Chi a valle vuole l'ordine dichiarato dal blocco legge
//   `brief_fields_rendered`, che e' un array e lo conserva.
// - LE COLLEZIONI DEL BRIEF nel documento GREZZO sono NUOVE rispetto al brief ma CONDIVISE
//   fra i blocchi e fra le pagine: la vista piatta e' calcolata una volta per chiamata e lo
//   stesso riferimento e' assegnato a ogni blocco che dichiara quel campo. Non e' una
//   garanzia per-blocco, ed e' asserito nei due versi (grezzo condiviso / dopo il gate
//   distinto) invece di essere lasciato dedurre dal titolo di un describe.
// - `DOCUMENT_LIMITS.blocks_per_page` e' rispettato PER COSTRUZIONE e non da un controllo:
//   resolve non conta i blocchi di una pagina. Il tetto regge perche' la partizione fa
//   comparire ogni id al piu' una volta e il catalogo di T-210 ha OTTO voci (asserito). Con
//   la deduplicazione spenta una home che assorbe i cinque ruoli interni arriva a
//   ESATTAMENTE dodici blocchi, cioe' al tetto: il margine e' la dedup.
// - LA CHIAVE DELLA MAPPA DEGLI ORARI e' TESTO DELL'UTENTE che entra nel documento come
//   CHIAVE di oggetto, non un'etichetta del codice. La forma la vincola T-202 e la lunghezza
//   il brief (BRIEF_LIMITS.hours_key), ma il contratto di sanificazione dei blocchi (T-210)
//   nomina il CAMPO 'hours': T-231 deve trattare le chiavi come dato dell'utente.
// - LA TOTALITA' DI resolve HA UN CONFINE, e le assi aperte sono nominate col punto in cui
//   cadono (vedi il describe 'totalita e limiti dichiarati'). Oltre a quelle asserite la',
//   resta che i CINQUE ARGOMENTI devono essere quello che il loro tipo dice: `pool` nullo
//   cade in `paginaDelPool`, `brief` nullo in `datiDelBrief`, `pageSpecs` nullo sul for-of di
//   `resolve`, `theme` nullo sulla riga che ne legge l'id, `recipe` nullo dentro
//   `applyRecipe` (T-212). MISURATO, non dedotto: sono cinque TypeError sulla prima lettura.
//   Difendersi da un argomento nullo vorrebbe dire, in un dominio puro con cinque contratti
//   di monte tipizzati, riscrivere qui la loro forma — la decisione e' di T-230, che li
//   costruisce.

// ── il brief ─────────────────────────────────────────────────────────────────

/**
 * CINQUE offerte con valori DISCORDANTI, e i loro nomi non compaiono in nessuno slot del
 * pool (given di AC-214-5, ASSERITO piu' sotto e non sperato). La seconda voce ha per nome
 * il PREFISSO della prima piu' una parola: un confronto scritto con startsWith invece che
 * con uguaglianza deve poter essere osservato mentre sbaglia.
 */
const CINQUE_OFFERTE = [
  { name: 'Pane di grano duro', price: '4,50', section: 'Pane' },
  { name: 'Pane di grano duro integrale', description: 'Macinato a pietra', section: 'Pane' },
  { name: 'Focaccia al rosmarino', price: '3,00', section: 'Forno' },
  { name: 'Crostata di visciole', description: 'Solo il sabato', price: '18,00', section: 'Dolci' },
  { name: 'Cornetto vuoto', section: 'Colazione' },
];

/** Due chiavi di orario con valori DISCORDANTI: una settimana spezzata e un sabato solo. */
const ORARI = { 'lun-ven': '7:00-13:30 / 16:00-19:30', sabato: '7:00-13:30' };

/** Il brief piu' ricco costruibile col Brief v1: ogni sorgente che un blocco puo' chiedere. */
const PATCH_RICCO: Record<string, unknown> = {
  business_name: 'Panificio Aurora',
  vertical: 'ristorazione',
  description: 'Panificio di quartiere dal 1953, lievito madre e farine macinate a pietra.',
  address: 'Via Roma 12, Bologna',
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@panificioaurora.it',
  primary_goal: 'ordina',
  highlights: ['Lievito madre', 'Farine macinate a pietra', 'Forno a legna'],
  offerings: CINQUE_OFFERTE,
  hours: ORARI,
  geo: { lat: 44.4949, lng: 11.3426 },
  social_links: ['https://instagram.com/panificioaurora'],
  brand_hints: 'tono caldo, niente superlativi',
};

/**
 * Costruisce un brief passando dal VALIDATORE vero (`applyBriefUpdate`, T-121): il brief
 * sotto test e' allora un brief che il dominio accetta davvero. Una patch SCARTATA farebbe
 * provare al caso qualcosa di diverso da cio' che dichiara, quindi lo scarto e' rosso qui.
 */
function briefDa(patch: Record<string, unknown>): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

/** Il brief ricco, omettendo i campi indicati e sovrascrivendo quelli passati. */
function briefRicco(
  omessi: readonly string[] = [],
  override: Record<string, unknown> = {},
): Brief {
  const patch: Record<string, unknown> = { ...PATCH_RICCO, ...override };
  for (const campo of omessi) delete patch[campo];
  return briefDa(patch);
}

// ── il pool ──────────────────────────────────────────────────────────────────

/** La forma del contenuto di una pagina, DERIVATA dal documento (T-202) e non riscritta. */
type ContenutoPagina = SiteBlock['content'];

/**
 * LA PROSA DEL MODELLO, scritta a mano: un valore per ogni slot del catalogo di T-201, del
 * kind che quel catalogo dichiara. Che la copertura sia COMPLETA e' asserito piu' sotto
 * confrontandola col catalogo — se un giorno nascesse uno slot nuovo, questa tabella
 * diventerebbe incompleta e i blocchi che lo consumano verrebbero scartati per un motivo
 * che non c'entra col caso sotto test.
 *
 * NESSUNA di queste stringhe contiene un nome delle offerte del brief (asserito in
 * AC-214-5): e' cio' che rende osservabile la provenienza delle offerte.
 */
const PROSA = {
  hero_title_kicker: 'Panificio di quartiere in via Roma dal 1953',
  hero_title: 'Il pane di ogni giorno, sfornato tre volte',
  hero_subtitle: 'Lievito madre rinfrescato ogni notte e farine macinate a pietra.',
  about_title: 'Tre generazioni dietro lo stesso banco',
  about_body: 'Si apre alle cinque, si impasta, si aspetta. Il forno e quello del 1953.',
  about_points: ['Lievito madre rinfrescato ogni notte', 'Farine macinate a pietra'],
  whatsapp_cta_title: 'Scrivici per mettere da parte il pane',
  offerings_title: 'Il banco di oggi',
  offerings_intro: 'Cambia con le stagioni e con la farina che arriva dal mulino.',
  hours_title: 'Quando siamo aperti',
  hours_intro: 'La domenica solo su prenotazione, fino a esaurimento.',
  contact_title: 'Come raggiungerci',
  contact_intro: 'Un messaggio e la via piu rapida: rispondiamo entro la mattina.',
  reviews_title: 'Chi ci viene a trovare',
  reviews_intro: 'Le voci di chi passa dal banco ogni settimana.',
  faq_title: 'Domande che ci fanno spesso',
  faq_items: [
    { question: 'Fate consegne in centro?', answer: 'Fino alle undici, entro i viali.' },
    { question: 'Il pane e senza lattosio?', answer: 'Tutti i pani lo sono; le focacce no.' },
  ],
} satisfies ContenutoPagina;

/** Il tag di pagina: rende visibile uno scambio di pagine. E' un artificio della fixture. */
function conTag(valore: string, slug: string): string {
  return `${valore} — ${slug}`;
}

/**
 * La prosa di UNA pagina del pool: la tabella qui sopra, con ogni stringa marcata dallo
 * slug della pagina. `omessi` toglie uno slot (il caso di AC-214-4), `override` ne
 * sostituisce il valore senza il tag.
 */
function prosaDi(
  slug: string,
  opzioni: { omessi?: readonly SlotId[]; override?: Partial<ContenutoPagina> } = {},
): ContenutoPagina {
  const omessi = new Set<string>(opzioni.omessi ?? []);
  const fuori: Record<string, unknown> = { ...opzioni.override };
  const pagina: Record<string, unknown> = {};

  for (const [slot, valore] of Object.entries(PROSA)) {
    if (omessi.has(slot)) continue;
    if (Object.hasOwn(fuori, slot)) {
      pagina[slot] = fuori[slot];
      continue;
    }
    if (typeof valore === 'string') {
      pagina[slot] = conTag(valore, slug);
      continue;
    }
    pagina[slot] = valore.map((voce) =>
      typeof voce === 'string'
        ? conTag(voce, slug)
        : { question: conTag(voce.question, slug), answer: conTag(voce.answer, slug) },
    );
  }
  return pagina;
}

/**
 * Il pool delle pagine indicate, passato dal GATE VERO (`parsePool`, T-201) con l'allowlist
 * dei propri slug: cio' che entra in resolve e' allora un pool che il dominio accetta.
 */
function poolDi(pagine: Readonly<Record<string, ContenutoPagina>>): Pool {
  const res = parsePool({ pages: pagine }, { allowedSlugs: Object.keys(pagine) });
  if (!res.ok) throw new Error(`pool non valido: ${JSON.stringify(res.error.issues)}`);
  return res.pool;
}

/** Il pool completo per un insieme di slug: ogni pagina porta ogni slot del catalogo. */
function poolCompleto(slugs: readonly string[]): Pool {
  return poolDi(Object.fromEntries(slugs.map((slug) => [slug, prosaDi(slug)])));
}

// ── ricette e temi, presi dai cataloghi di monte ─────────────────────────────

function ricettaDi(id: string): SiteRecipe {
  const ricetta = recipeFor(id);
  if (!ricetta) throw new Error(`ricetta '${id}' assente dal catalogo (T-212)`);
  return ricetta;
}

function temaDi(id: string): SiteTheme {
  const tema = THEMES.find((voce) => voce.id === id);
  if (!tema) throw new Error(`tema '${id}' assente dal catalogo (T-211)`);
  return tema;
}

const VETRINA = ricettaDi('vetrina-dell-offerta@1');
const SOLE = temaDi('sole-mediterraneo@1');

// ── strumenti di lettura ─────────────────────────────────────────────────────

type Risultato = ReturnType<typeof resolve>;

/** Il documento passato dal GATE VERO, o un fallimento leggibile del test. */
function accettato(res: Risultato): SiteDocument {
  const gate = parseDocument(res.document);
  if (!gate.ok) {
    throw new Error(`il documento doveva validare: ${JSON.stringify(gate.error.issues)}`);
  }
  return gate.document;
}

/** Gli issue del RIFIUTO dal gate vero, o un fallimento leggibile del test. */
function rifiutato(res: Risultato) {
  const gate = parseDocument(res.document);
  if (gate.ok) throw new Error('il documento NON doveva validare');
  return gate.error.issues;
}

function paginaDi(documento: SiteDocument, slug: string): SitePage {
  const pagina = documento.pages.find((voce) => voce.slug === slug);
  if (!pagina) throw new Error(`pagina '${slug}' assente dal documento`);
  return pagina;
}

function bloccoDi(pagina: SitePage, id: string): SiteBlock {
  const blocco = pagina.blocks.find((voce) => voce.id === id);
  if (!blocco) throw new Error(`blocco '${id}' assente dalla pagina '${pagina.slug}'`);
  return blocco;
}

function idBlocchi(pagina: SitePage): string[] {
  return pagina.blocks.map((blocco) => blocco.id);
}

/** Tutte le stringhe che il documento porta come VALORI (mai le chiavi). */
function stringheDi(valore: unknown, raccolte: string[] = []): string[] {
  if (typeof valore === 'string') {
    raccolte.push(valore);
    return raccolte;
  }
  if (Array.isArray(valore)) {
    for (const voce of valore) stringheDi(voce, raccolte);
    return raccolte;
  }
  if (valore !== null && typeof valore === 'object') {
    for (const voce of Object.values(valore)) stringheDi(voce, raccolte);
  }
  return raccolte;
}

/** Byte della serializzazione JSON (UTF-8): la misura del peso, come in T-202. */
function pesoInByte(valore: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valore)).length;
}

/**
 * Lo schema del TOKEN dell'imagery del tema, camminando dal documento esportato: documento
 * -> pagine -> blocchi -> immagini -> variante 'theme-placeholder'. Derivato e non
 * riscritto: la forma del token la dichiara T-202 e qui si prova solo che gli id dei
 * blocchi la rispettano.
 */
function schemaDelToken() {
  const unione =
    SiteDocumentSchema.innerType().shape.pages.element.shape.blocks.element.shape.images.element;
  for (const variante of unione.options) {
    const forma = variante.shape;
    if ('token' in forma) return forma.token;
  }
  throw new Error("l'unione dello slot immagine non ha piu' la variante 'theme-placeholder'");
}

// ── le sequenze attese, scritte a mano ───────────────────────────────────────

// LA HOME DELLE CINQUE DIREZIONI col brief ricco: le sequenze sono SCRITTE A MANO e non
// lette da RECIPES, perche' derivarle dal modulo che devono giudicare le renderebbe vere
// per costruzione. Col brief ricco ogni blocco della home soddisfa la propria
// precondizione, quindi la sequenza attesa e' quella dichiarata dalla direzione: cio' che
// queste righe pinnano e' che resolve non riordina, non aggiunge e non toglie.
const HOME_PER_RICETTA: Readonly<Record<string, readonly string[]>> = {
  'vetrina-dell-offerta@1': ['hero', 'offerte', 'orari', 'chi-siamo', 'faq', 'contatti', 'cta-whatsapp'],
  'racconto-di-bottega@1': ['hero', 'chi-siamo', 'offerte', 'faq', 'contatti', 'orari', 'cta-whatsapp'],
  'scatto-alla-conversione@1': ['hero', 'cta-whatsapp', 'offerte', 'chi-siamo', 'contatti', 'orari'],
  'mappa-e-orari@1': ['hero', 'orari', 'contatti', 'offerte', 'chi-siamo', 'cta-whatsapp', 'faq'],
  'scheda-sobria@1': ['hero', 'chi-siamo', 'faq', 'offerte', 'orari', 'contatti'],
};

// I CAMPI DEL BRIEF che ogni blocco della home rende, scritti a mano: e' la tabella che
// rende osservabile un campo reso da un blocco che non lo dichiara (o non reso da chi lo
// dichiara). L'ordine e' quello di `brief_fields_rendered` in T-210.
const CAMPI_PER_BLOCCO: Readonly<Record<string, readonly string[]>> = {
  hero: ['business_name'],
  offerte: ['offerings'],
  orari: ['hours'],
  'chi-siamo': [],
  faq: [],
  contatti: ['address', 'geo', 'phone', 'email', 'whatsapp', 'social_links'],
  'cta-whatsapp': ['whatsapp'],
};

// GLI SLOT DI PROSA che ogni blocco consuma, scritti a mano (T-201/T-210). Sono anche
// l'ORDINE in cui il contenuto del blocco li porta — ma quell'ordine si giudica sul documento
// GREZZO e non su quello accettato, e la distinzione non e' pignoleria: zod ricostruisce
// `content` nell'ordine della propria SHAPE, cioe' quello del catalogo SLOTS di T-201, quindi
// il confronto DOPO `parseDocument` e' vero qualunque sia l'ordine in cui resolve ha inserito
// le chiavi. MISURATO (V-214-02): con un `sort` in place su `blocco.slots`, prima del gate le
// chiavi dell'hero diventano ['hero_subtitle','hero_title','hero_title_kicker'] e dopo il gate
// tornano nell'ordine della shape — la sola asserzione post-gate resta VERDE. L'asserzione che
// prova qualcosa e' quella su `res.document`, piu' sotto; questa tabella serve a entrambe.
const SLOT_PER_BLOCCO: Readonly<Record<string, readonly string[]>> = {
  hero: ['hero_title_kicker', 'hero_title', 'hero_subtitle'],
  offerte: ['offerings_title', 'offerings_intro'],
  orari: ['hours_title', 'hours_intro'],
  'chi-siamo': ['about_title', 'about_body', 'about_points'],
  faq: ['faq_title', 'faq_items'],
  contatti: ['contact_title', 'contact_intro'],
  'cta-whatsapp': ['whatsapp_cta_title'],
};

/** Il set di pagine del brief ricco, senza tetto di piano: cinque pagine (T-213). */
const SLUG_MULTIPAGINA = ['home', 'offerte', 'contatti', 'orari', 'domande-frequenti'];

// ── i cataloghi di monte, fotografati PRIMA di qualunque caso ─────────────────

// V-214-03 (a). Lo snapshot dei cataloghi va preso PRIMA che qualunque caso chiami resolve, e
// non dentro il caso che lo confronta: una corruzione IDEMPOTENTE (un `sort` in place) applicata
// da un caso PRECEDENTE dello stesso file finisce nello snapshot, e "prima == dopo" diventa vero
// mentre il catalogo e' gia' corrotto. MISURATO: con un `sort` in place su BLOCKS[i].slots il
// file intero da' 5 rossi ma l'oracolo dei cataloghi di AC-214-1 resta VERDE; eseguito DA SOLO
// lo stesso caso e' ROSSO — cioe' l'oracolo dipendeva dall'ordine dei casi.
// Il `beforeAll` e' in testa al FILE e nulla al livello di modulo chiama resolve, quindi questo
// e' lo stato dei cataloghi come li ha importati il runner. Il confronto e' in CODA al file
// (ultimo describe), cosi' vede la corruzione di qualunque caso, in qualunque ordine.
const SNAPSHOT = { blocchi: '', ricette: '', temi: '', pagine: '' };

beforeAll(() => {
  SNAPSHOT.blocchi = JSON.stringify(BLOCKS);
  SNAPSHOT.ricette = JSON.stringify(RECIPES);
  SNAPSHOT.temi = JSON.stringify(THEMES);
  SNAPSHOT.pagine = JSON.stringify(PAGE_CATALOG);
});

// GLI ORDINI CHE NESSUN COMPORTAMENTO RIVELA, pinnati a mano dai contratti di monte
// (T-210/T-212). Non sono ridondanti con le tabelle di sopra, e la ragione e' misurata
// (V-214-03 b): un `sort` in place su BLOCKS[i].page_roles sopravvive a TUTTI i 51 casi, perche'
// `blocksFor` guarda `includes` e l'ordine di quell'elenco non ha alcun effetto osservabile in
// nessun documento. Una corruzione COMPORTAMENTALMENTE NEUTRA non la vede nessun altro oracolo,
// per definizione: queste tabelle esistono solo per quella.
const ID_DEL_CATALOGO: readonly string[] = [
  'hero',
  'offerte',
  'chi-siamo',
  'orari',
  'contatti',
  'recensioni',
  'faq',
  'cta-whatsapp',
];

const PAGE_ROLES_PER_BLOCCO: Readonly<Record<string, readonly string[]>> = {
  hero: ['home'],
  offerte: ['offerings', 'home'],
  'chi-siamo': ['home'],
  orari: ['hours', 'home'],
  contatti: ['contact', 'home'],
  recensioni: ['reviews', 'home'],
  faq: ['faq', 'home'],
  'cta-whatsapp': ['home', 'contact'],
};

// Gli slot del solo blocco che NESSUN documento porta: 'recensioni' non e' soddisfacibile da
// alcun Brief v1 (T-210), quindi SLOT_PER_BLOCCO — che elenca i blocchi della home — non lo ha.
// E' il caso estremo della corruzione invisibile: nemmeno la sua ESISTENZA e' osservabile in un
// documento.
const SLOT_DI_RECENSIONI: readonly string[] = ['reviews_title', 'reviews_intro'];

// La sequenza DICHIARATA della home, direzione per direzione (T-212). E' un'altra cosa da
// HOME_PER_RICETTA, che pinna la sequenza COMPOSTA: le due coincidono col brief ricco perche'
// ogni blocco soddisfa la propria precondizione, e divergerebbero il giorno in cui una
// precondizione cambiasse. Un catalogo corrotto DOPO il caso delle cinque direzioni non lo
// vedrebbe nessuno.
const HOME_BLOCKS_DICHIARATI: Readonly<Record<string, readonly string[]>> = {
  'vetrina-dell-offerta@1': ['hero', 'offerte', 'orari', 'chi-siamo', 'faq', 'contatti', 'cta-whatsapp'],
  'racconto-di-bottega@1': ['hero', 'chi-siamo', 'offerte', 'faq', 'contatti', 'orari', 'cta-whatsapp'],
  'scatto-alla-conversione@1': ['hero', 'cta-whatsapp', 'offerte', 'chi-siamo', 'contatti', 'orari'],
  'mappa-e-orari@1': ['hero', 'orari', 'contatti', 'offerte', 'chi-siamo', 'cta-whatsapp', 'faq'],
  'scheda-sobria@1': ['hero', 'chi-siamo', 'faq', 'offerte', 'orari', 'contatti'],
};

// ─────────────────────────────────────────────────────────────────────────────

describe('T-214 le fixture sono quelle che gli AC descrivono', () => {
  it('la prosa del pool copre ESATTAMENTE il catalogo degli slot (T-201)', () => {
    // Se la tabella fosse incompleta, i blocchi che consumano lo slot mancante verrebbero
    // scartati e ogni caso "nominale" di questo file misurerebbe un altro fenomeno.
    expect(Object.keys(PROSA).sort()).toEqual(SLOTS.map((slot) => slot.id).sort());
  });

  it('il set di pagine del brief ricco e quello che T-213 deriva', () => {
    const pagine = pagesFor(briefRicco(), { maxPages: DOCUMENT_LIMITS.max_pages });
    expect(pagine.map((pagina) => pagina.slug)).toEqual(SLUG_MULTIPAGINA);
    expect(pagine.map((pagina) => pagina.role)).toEqual([
      'home',
      'offerings',
      'contact',
      'hours',
      'faq',
    ]);
    expect(pagine[0].shape).toBe('multi-page');
    expect(pagine[0].absorbed_roles).toEqual([]);
  });

  it('ogni id di blocco ha la FORMA del token di imagery che il documento ammette', () => {
    // Il token dell'imagery e' l'id del blocco che apre la pagina: `BlockIdSchema` (T-202)
    // ammette l'underscore e la forma del token NO, quindi un id nuovo con un underscore
    // farebbe cadere l'intero documento. Questa riga lo rende rosso qui invece che in
    // produzione. Il controllo e' DERIVATO dallo schema, non una regex riscritta.
    const token = schemaDelToken();
    expect(BLOCKS.length).toBeGreaterThan(0);
    for (const blocco of BLOCKS) {
      expect(token.safeParse(blocco.id).success, `id '${blocco.id}'`).toBe(true);
    }
  });
});

describe('T-214 AC-214-2 — il documento passa dal gate vero e registra gli id versionati', () => {
  // covers: AC-214-2
  it('un brief ricco con set di pagine multiplo produce un documento che parseDocument ACCETTA', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const res = resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine);

    const documento = accettato(res); // covers: AC-214-2 — la validazione ha successo
    expect(res.dropped).toEqual([]); // covers: AC-214-2 — nulla e' stato scartato

    // Gli id VERSIONATI di ricetta e tema, per VALORE e non per presenza.
    expect(documento.recipe_id).toBe('vetrina-dell-offerta@1'); // covers: AC-214-2
    expect(documento.theme_id).toBe('sole-mediterraneo@1'); // covers: AC-214-2
    expect(documento.recipe_id).not.toBe(documento.theme_id); // covers: AC-214-2

    // Le pagine sono quelle del set, nello stesso ORDINE e con gli stessi ruoli.
    expect(documento.pages.map((pagina) => pagina.slug)).toEqual(SLUG_MULTIPAGINA); // covers: AC-214-2
    expect(documento.pages.map((pagina) => pagina.role)).toEqual(
      pagine.map((pagina) => pagina.role),
    ); // covers: AC-214-2

    // La home porta la sequenza della direzione, scritta a mano.
    expect(idBlocchi(paginaDi(documento, 'home'))).toEqual(
      HOME_PER_RICETTA['vetrina-dell-offerta@1'],
    ); // covers: AC-214-2

    // Le pagine interne portano cio' che la ricetta dichiara per il loro RUOLO.
    expect(idBlocchi(paginaDi(documento, 'offerte'))).toEqual(['offerte']); // covers: AC-214-2
    expect(idBlocchi(paginaDi(documento, 'contatti'))).toEqual(['contatti', 'cta-whatsapp']); // covers: AC-214-2
    expect(idBlocchi(paginaDi(documento, 'orari'))).toEqual(['orari']); // covers: AC-214-2
    expect(idBlocchi(paginaDi(documento, 'domande-frequenti'))).toEqual(['faq']); // covers: AC-214-2
  });

  // covers: AC-214-2
  it('il contenuto di ogni blocco viene dal pool DELLA SUA PAGINA, slot per slot', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const documento = accettato(
      resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine),
    );

    const home = paginaDi(documento, 'home');
    for (const blocco of home.blocks) {
      // Gli slot del blocco, nell'ordine dichiarato: ne' uno in piu' ne' uno in meno.
      expect(Object.keys(blocco.content), blocco.id).toEqual(SLOT_PER_BLOCCO[blocco.id]); // covers: AC-214-2
    }
    // I VALORI, non solo le chiavi, e col tag della PROPRIA pagina.
    expect(bloccoDi(home, 'hero').content.hero_title).toBe(conTag(PROSA.hero_title, 'home')); // covers: AC-214-2
    expect(bloccoDi(home, 'hero').content.hero_title_kicker).toBe(
      conTag(PROSA.hero_title_kicker, 'home'),
    ); // covers: AC-214-2
    expect(bloccoDi(home, 'chi-siamo').content.about_points).toEqual([
      conTag(PROSA.about_points[0], 'home'),
      conTag(PROSA.about_points[1], 'home'),
    ]); // covers: AC-214-2
    expect(bloccoDi(home, 'faq').content.faq_items).toEqual([
      {
        question: conTag(PROSA.faq_items[0].question, 'home'),
        answer: conTag(PROSA.faq_items[0].answer, 'home'),
      },
      {
        question: conTag(PROSA.faq_items[1].question, 'home'),
        answer: conTag(PROSA.faq_items[1].answer, 'home'),
      },
    ]); // covers: AC-214-2

    // La pagina 'offerte' prende dal POOL DI 'offerte' e SOLO gli slot del suo blocco: il
    // pool porta tutti e diciassette gli slot per ogni pagina, quindi se resolve copiasse
    // il pool invece degli slot dei blocchi composti, questa riga lo vedrebbe.
    const offerte = paginaDi(documento, 'offerte');
    expect(Object.keys(bloccoDi(offerte, 'offerte').content)).toEqual([
      'offerings_title',
      'offerings_intro',
    ]); // covers: AC-214-2
    expect(bloccoDi(offerte, 'offerte').content.offerings_title).toBe(
      conTag(PROSA.offerings_title, 'offerte'),
    ); // covers: AC-214-2
    // ...e NON quello della home: un tag di pagina sbagliato e' uno scambio di pagine.
    expect(bloccoDi(offerte, 'offerte').content.offerings_title).not.toBe(
      bloccoDi(home, 'offerte').content.offerings_title,
    ); // covers: AC-214-2
  });

  // covers: AC-214-2
  it("l'ORDINE degli slot nel contenuto e quello dichiarato dal blocco, sul documento GREZZO", () => {
    // V-214-02. L'asserzione gemella sul documento ACCETTATO (nel caso qui sopra) NON PUO'
    // FALLIRE: `parseDocument` restituisce la copia che zod costruisce, e zod ricostruisce
    // `content` nell'ordine della propria SHAPE — l'ordine del catalogo SLOTS di T-201 — non in
    // quello in cui resolve ha inserito le chiavi. MISURATO: con un `sort` in place su
    // `blocco.slots`, prima del gate le chiavi dell'hero diventano
    // ['hero_subtitle','hero_title','hero_title_kicker'] e dopo il gate tornano nell'ordine
    // della shape; l'asserzione post-gate resta verde. Questa guarda `res.document`, che e' cio'
    // che questo modulo controlla davvero — la stessa correzione gia' fatta per `data` in
    // AC-214-5.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const res = resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine);
    // Il documento e' comunque VALIDO: cio' che cambia fra i due e' l'ordine delle chiavi.
    accettato(res);

    const homeGrezza = res.document.pages[0];
    // Il ciclo sarebbe vero per vacuita' su una pagina senza blocchi.
    expect(homeGrezza.blocks).toHaveLength(7); // covers: AC-214-2
    for (const blocco of homeGrezza.blocks) {
      expect(Object.keys(blocco.content), blocco.id).toEqual(SLOT_PER_BLOCCO[blocco.id]); // covers: AC-214-2
    }
    // La riga che rende visibile la differenza fra i due ordini: nel catalogo di T-201 l'occhiello
    // dell'hero precede il titolo, e nel blocco anche — se resolve ordinasse gli slot per nome,
    // 'hero_subtitle' verrebbe per primo QUI e non nel documento accettato.
    expect(Object.keys(homeGrezza.blocks[0].content)).toEqual([
      'hero_title_kicker',
      'hero_title',
      'hero_subtitle',
    ]); // covers: AC-214-2

    const offerteGrezza = res.document.pages[1];
    expect(offerteGrezza.slug).toBe('offerte'); // covers: AC-214-2
    expect(Object.keys(offerteGrezza.blocks[0].content)).toEqual([
      'offerings_title',
      'offerings_intro',
    ]); // covers: AC-214-2
  });

  // covers: AC-214-2
  it('un id NON versionato fa cadere l INTERO documento al gate (la versione e dentro la forma)', () => {
    // PRECONDIZIONE EREDITATA (2) da T-202: la versione e' DENTRO la forma dell'id, e un id
    // senza '@n' fa cadere il documento intero. Qui non si riscrive quella regex: si prova
    // l'EFFETTO passando dal gate vero, con una ricetta e un tema FABBRICATI che
    // differiscono dai cataloghi per la SOLA versione.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: 1 });
    const pool = poolCompleto(['home']);

    const senzaVersione: SiteRecipe = { ...VETRINA, id: 'vetrina-dell-offerta' };
    const resRicetta = resolve(pool, senzaVersione, SOLE, brief, pagine);
    expect(resRicetta.document.recipe_id).toBe('vetrina-dell-offerta'); // covers: AC-214-2
    const issuesRicetta = rifiutato(resRicetta);
    expect(issuesRicetta.some((issue) => issue.path.includes('recipe_id'))).toBe(true); // covers: AC-214-2

    const temaSenzaVersione: SiteTheme = { ...SOLE, id: 'sole-mediterraneo' };
    const resTema = resolve(pool, VETRINA, temaSenzaVersione, brief, pagine);
    const issuesTema = rifiutato(resTema);
    expect(issuesTema.some((issue) => issue.path.includes('theme_id'))).toBe(true); // covers: AC-214-2

    // Gemello ACCETTATO: cambia UNA sola variabile, la versione nell'id.
    expect(accettato(resolve(pool, VETRINA, SOLE, brief, pagine)).recipe_id).toBe(
      'vetrina-dell-offerta@1',
    ); // covers: AC-214-2
  });

  // covers: AC-214-2
  it('registra il tema RICEVUTO, non quello che la ricetta cita: la coppia e discordante', () => {
    // resolve non giudica l'accoppiamento ricetta-tema (T-212 lo dichiara, T-230 lo scegle):
    // registra cio' che riceve. Con una coppia DISCORDANTE si vede QUALE dei due valori
    // viene letto — con una coppia coerente le due letture sarebbero indistinguibili.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: 1 });
    const altroTema = temaDi('scatto-vitale@1');
    expect(altroTema.id).not.toBe(VETRINA.theme_id);

    const documento = accettato(resolve(poolCompleto(['home']), VETRINA, altroTema, brief, pagine));
    expect(documento.theme_id).toBe('scatto-vitale@1'); // covers: AC-214-2
    expect(documento.theme_id).not.toBe(VETRINA.theme_id); // covers: AC-214-2
    expect(documento.recipe_id).toBe(VETRINA.id); // covers: AC-214-2
  });

  // covers: AC-214-2
  it('le CINQUE direzioni producono cinque documenti validi, ciascuno col proprio ordine', () => {
    // La tabella e' scritta a mano (HOME_PER_RICETTA) e il tema di ciascuna direzione viene
    // dal catalogo di monte: se resolve componesse nell'ordine del CATALOGO DEI BLOCCHI
    // invece che in quello della ricetta, quattro di queste cinque righe cadrebbero.
    expect(RECIPES).toHaveLength(5);
    const brief = briefRicco();
    // Il set MULTI-PAGINA, non la one-pager: qui si giudica la sequenza della HOME dichiarata
    // dalla direzione, e su una one-pager la home assorbe anche i ruoli interni (l'oracolo
    // dedicato piu' sotto misura proprio quella differenza).
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);
    const visti = new Set<string>();

    for (const ricetta of RECIPES) {
      const documento = accettato(
        resolve(pool, ricetta, temaDi(ricetta.theme_id), brief, pagine),
      );
      expect(documento.recipe_id, ricetta.id).toBe(ricetta.id); // covers: AC-214-2
      expect(documento.theme_id, ricetta.id).toBe(ricetta.theme_id); // covers: AC-214-2
      expect(idBlocchi(paginaDi(documento, 'home')), ricetta.id).toEqual(
        HOME_PER_RICETTA[ricetta.id],
      ); // covers: AC-214-2
      visti.add(documento.theme_id);
    }
    // Cinque temi DISTINTI: se resolve registrasse un tema fisso, questa riga cadrebbe.
    expect(visti.size).toBe(5); // covers: AC-214-2
  });
});

describe('T-214 AC-214-3 — la forma della fase 1: la sola home', () => {
  // covers: AC-214-3
  it('con pageSpecs contenente la sola home il documento ha ESATTAMENTE una pagina di ruolo home', () => {
    const brief = briefRicco();
    // La home del set MULTI-PAGINA, cioe' cio' che la fase 1 riceve quando il sito avra'
    // cinque pagine: e' un SOTTOINSIEME, e il documento della fase 1 ne porta una sola.
    const multi = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const soloHome = [multi[0]];
    expect(soloHome[0].role).toBe('home');
    expect(soloHome[0].absorbed_roles).toEqual([]);

    const res = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, soloHome);
    const documento = accettato(res); // covers: AC-214-3

    expect(documento.pages).toHaveLength(1); // covers: AC-214-3
    expect(documento.pages[0].role).toBe('home'); // covers: AC-214-3
    expect(documento.pages[0].slug).toBe('home'); // covers: AC-214-3
    expect(res.dropped).toEqual([]); // covers: AC-214-3
    // I blocchi sono quelli della home della direzione: la fase 1 non porta le sezioni
    // delle pagine che esisteranno (quelle hanno una pagina propria).
    expect(idBlocchi(documento.pages[0])).toEqual(HOME_PER_RICETTA['vetrina-dell-offerta@1']); // covers: AC-214-3

    // E il gemello che cambia UNA variabile — il set intero invece del sottoinsieme —
    // produce cinque pagine: la differenza e' il set, non il brief.
    expect(
      accettato(resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, multi)).pages,
    ).toHaveLength(5); // covers: AC-214-3
  });

  // covers: AC-214-3
  it('anche la home di una ONE-PAGER e una pagina sola, ma porta piu blocchi', () => {
    // L'altra forma con cui la fase 1 chiama resolve: il set di un sito che RESTA una
    // one-pager (maxPages=1). La pagina e' sempre una, e i blocchi sono di piu' perche' la
    // home assorbe i ruoli superstiti — vedi l'oracolo dedicato piu' sotto.
    const brief = briefRicco();
    const onePager = pagesFor(brief, { maxPages: 1 });
    expect(onePager).toHaveLength(1);
    expect(onePager[0].shape).toBe('one-pager');

    const documento = accettato(resolve(poolCompleto(['home']), VETRINA, SOLE, brief, onePager));
    expect(documento.pages).toHaveLength(1); // covers: AC-214-3
    expect(documento.pages[0].role).toBe('home'); // covers: AC-214-3
  });
});

describe('T-214 AC-214-4 — un blocco senza il proprio slot e SCARTATO e riportato', () => {
  // covers: AC-214-4
  it("il blocco il cui slot manca dal pool non compare, e dropped ne dice l'id E lo slot", () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    // La precondizione del blocco 'orari' E' soddisfatta (il brief ha gli orari): cio' che
    // manca e' UNO slot del pool, e solo sulla home. Una variabile sola cambia rispetto al
    // caso nominale.
    const pool = poolDi({
      home: prosaDi('home', { omessi: ['hours_intro'] }),
      offerte: prosaDi('offerte'),
      contatti: prosaDi('contatti'),
      orari: prosaDi('orari'),
      'domande-frequenti': prosaDi('domande-frequenti'),
    });
    const res = resolve(pool, VETRINA, SOLE, brief, pagine);
    const documento = accettato(res); // covers: AC-214-4 — il documento resta valido

    // IL CONTRATTO di dropped: l'id del blocco E lo slot mancante, con la pagina che dice
    // A QUALE pool manca. Un dropped col solo id non distinguerebbe un pool incompleto da
    // un pool sbagliato (T-230).
    expect(res.dropped).toEqual([
      { page_slug: 'home', block_id: 'orari', missing_slot: 'hours_intro' },
    ]); // covers: AC-214-4

    // Il blocco NON compare nella home, e nessun blocco vuoto lo sostituisce.
    expect(idBlocchi(paginaDi(documento, 'home'))).toEqual([
      'hero',
      'offerte',
      'chi-siamo',
      'faq',
      'contatti',
      'cta-whatsapp',
    ]); // covers: AC-214-4
    expect(idBlocchi(paginaDi(documento, 'home'))).not.toContain('orari'); // covers: AC-214-4
    // Gli altri blocchi non si riordinano e non slittano: 'orari' era il terzo.
    expect(idBlocchi(paginaDi(documento, 'home'))[2]).toBe('chi-siamo'); // covers: AC-214-4

    // LO SCARTO E' PER PAGINA: la pagina 'orari', il cui pool e' completo, porta il blocco.
    expect(idBlocchi(paginaDi(documento, 'orari'))).toEqual(['orari']); // covers: AC-214-4
    expect(bloccoDi(paginaDi(documento, 'orari'), 'orari').content.hours_intro).toBe(
      conTag(PROSA.hours_intro, 'orari'),
    ); // covers: AC-214-4

    // CONSEGUENZA DICHIARATA: col blocco se ne va anche il campo del brief che rendeva. Il
    // dato non e' perso (la pagina orari lo porta), ma la home non lo mostra piu'.
    const campiDellaHome = paginaDi(documento, 'home').blocks.flatMap(
      (blocco) => blocco.brief_fields_rendered,
    );
    expect(campiDellaHome).not.toContain('hours'); // covers: AC-214-4
    expect(
      paginaDi(documento, 'orari').blocks.flatMap((blocco) => blocco.brief_fields_rendered),
    ).toContain('hours'); // covers: AC-214-4

    // GEMELLO ACCETTATO: lo stesso caso col pool completo. Cambia UNA variabile.
    const completo = resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine);
    expect(completo.dropped).toEqual([]); // covers: AC-214-4
    expect(idBlocchi(paginaDi(accettato(completo), 'home'))).toContain('orari'); // covers: AC-214-4
  });

  // covers: AC-214-4
  it('due slot mancanti sullo stesso blocco danno DUE voci, nell ordine dichiarato dal blocco', () => {
    // Un dropped che riportasse il solo PRIMO slot mancante direbbe a T-230 una verita'
    // incompleta: chi riempie il pool tornerebbe due volte. Le voci sono una per slot.
    const brief = briefRicco();
    const pool = poolDi({ home: prosaDi('home', { omessi: ['faq_title', 'faq_items'] }) });
    const res = resolve(pool, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));

    expect(res.dropped).toEqual([
      { page_slug: 'home', block_id: 'faq', missing_slot: 'faq_title' },
      { page_slug: 'home', block_id: 'faq', missing_slot: 'faq_items' },
    ]); // covers: AC-214-4
    expect(idBlocchi(accettato(res).pages[0])).not.toContain('faq'); // covers: AC-214-4
  });

  // covers: AC-214-4
  it('uno slot PRESENTE ma vuoto conta come mancante: un blocco vuoto non entra nel documento', () => {
    // Il pool ammette la stringa vuota (T-201: nessun `min(1)` sui valori), quindi
    // "presente" non basta. Tre forme di vuoto, tutte sullo stesso slot, una per volta:
    // stringa vuota, soli spazi, lista di sole stringhe vuote.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: 1 });

    for (const vuoto of ['', '   ']) {
      const pool = poolDi({ home: prosaDi('home', { override: { hours_intro: vuoto } }) });
      const res = resolve(pool, VETRINA, SOLE, brief, pagine);
      expect(res.dropped, JSON.stringify(vuoto)).toEqual([
        { page_slug: 'home', block_id: 'orari', missing_slot: 'hours_intro' },
      ]); // covers: AC-214-4
      expect(idBlocchi(accettato(res).pages[0]), JSON.stringify(vuoto)).not.toContain('orari'); // covers: AC-214-4
    }

    // Anche una LISTA senza alcuna voce utile e' un blocco senza contenuto.
    for (const lista of [[], ['', '  ']]) {
      const pool = poolDi({ home: prosaDi('home', { override: { about_points: lista } }) });
      const res = resolve(pool, VETRINA, SOLE, brief, pagine);
      expect(res.dropped, JSON.stringify(lista)).toEqual([
        { page_slug: 'home', block_id: 'chi-siamo', missing_slot: 'about_points' },
      ]); // covers: AC-214-4
      expect(idBlocchi(accettato(res).pages[0]), JSON.stringify(lista)).not.toContain('chi-siamo'); // covers: AC-214-4
    }

    // GEMELLO ACCETTATO: lo stesso slot con una voce sola non vuota basta.
    const buono = poolDi({ home: prosaDi('home', { override: { about_points: ['Una riga'] } }) });
    const res = resolve(buono, VETRINA, SOLE, brief, pagine);
    expect(res.dropped).toEqual([]); // covers: AC-214-4
    expect(bloccoDi(accettato(res).pages[0], 'chi-siamo').content.about_points).toEqual([
      'Una riga',
    ]); // covers: AC-214-4
  });

  // covers: AC-214-4
  it('un blocco che rende un campo del brief viene scartato ANCHE SE quel campo c e', () => {
    // Il dato del brief non salva il blocco: senza la prosa la sezione avrebbe le offerte e
    // nessun titolo, cioe' sarebbe la sezione a metà che P2-D7 esclude. La variabile che
    // cambia e' UNA: manca 'offerings_title' dal pool della home.
    const brief = briefRicco();
    expect(brief.content.offerings).toHaveLength(5);
    const pool = poolDi({ home: prosaDi('home', { omessi: ['offerings_title'] }) });
    const res = resolve(pool, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));

    expect(res.dropped).toEqual([
      { page_slug: 'home', block_id: 'offerte', missing_slot: 'offerings_title' },
    ]); // covers: AC-214-4
    const documento = accettato(res);
    expect(idBlocchi(documento.pages[0])).not.toContain('offerte'); // covers: AC-214-4
    // E le offerte non finiscono in un altro blocco per compensare: il campo se ne va col
    // blocco che lo dichiarava.
    expect(
      documento.pages[0].blocks.flatMap((blocco) => blocco.brief_fields_rendered),
    ).not.toContain('offerings'); // covers: AC-214-4
    expect(JSON.stringify(documento)).not.toContain('Focaccia al rosmarino'); // covers: AC-214-4
  });
});

describe('T-214 AC-214-4 — il blocco che non dichiara ALCUNO slot e SCARTATO, non reso vuoto', () => {
  // V-214-07 e mandato (C). PRIMA della correzione un blocco senza slot non aveva slot mancanti,
  // quindi: con la pagina PRESENTE nel pool entrava nel documento col contenuto VUOTO — e il
  // gate lo ACCETTAVA, perche' in T-201 ogni slot e' opzionale (MISURATO: `parseDocument` su un
  // blocco con `content: {}` ritorna ok = true) — mentre con la pagina ASSENTE usciva in
  // SILENZIO, senza alcuna voce in `dropped`. Cioe' esattamente il blocco vuoto che AC-214-4
  // vieta, prodotto senza che nessuno lo dicesse. Il commento del modulo dichiarava di coprire
  // il caso, e lo copriva solo a metà.
  //
  // IL CASO NON E' RAGGIUNGIBILE DALLA SUPERFICIE di resolve, e va detto: i blocchi arrivano da
  // `applyRecipe` (T-212), che li prende dal catalogo di T-210, e OGNI voce di quel catalogo
  // dichiara almeno uno slot (asserito qui sotto). Il rischio e' FUTURO e SILENZIOSO. Per
  // esercitare la guardia il catalogo viene percio' ESTESO con una voce fabbricata e RIPRISTINATO
  // sempre: e' una FIXTURE, non una corruzione — il ripristino e' ASSERITO qui, e l'oracolo dei
  // cataloghi in coda al file confronta con lo snapshot preso PRIMA di ogni caso, quindi se il
  // ripristino non fosse esatto lo direbbe comunque.

  /** Il tipo di una voce del catalogo, DERIVATO come fa resolve: `BlockDefinition` non e' esportata. */
  type VoceDelCatalogo = ReturnType<typeof applyRecipe>[number];

  /** Un blocco che non consuma prosa: il caso che il catalogo di oggi non contiene. */
  const SENZA_SLOT: VoceDelCatalogo = {
    id: 'senza-slot',
    page_roles: ['home'],
    slots: [],
    brief_fields_rendered: [],
    precondition: () => true,
  };

  /** La direzione che lo cita: una ricetta FABBRICATA, con l'id versionato che il gate pretende. */
  const CON_SENZA_SLOT: SiteRecipe = {
    ...VETRINA,
    id: 'con-blocco-senza-slot@1',
    home_blocks: ['hero', 'senza-slot'],
  };

  /** Esegue `fn` col catalogo ESTESO dalla voce fabbricata, e lo ripristina in ogni caso. */
  function conBloccoSenzaSlot(fn: () => void): void {
    const prima = JSON.stringify(BLOCKS);
    (BLOCKS as VoceDelCatalogo[]).push(SENZA_SLOT);
    try {
      fn();
    } finally {
      (BLOCKS as VoceDelCatalogo[]).pop();
    }
    expect(JSON.stringify(BLOCKS)).toBe(prima);
  }

  it('OGGI nessuna voce del catalogo e senza slot: il rischio della guardia e FUTURO', () => {
    // La misura di quanto la guardia sia raggiungibile in produzione: zero. Se un blocco nuovo
    // nascesse senza slot, il rosso arriverebbe QUI — nel file che dichiara futuro quel caso —
    // invece di far comparire una sezione muta in un sito pubblicato.
    expect(BLOCKS).toHaveLength(8);
    for (const blocco of BLOCKS) {
      expect(blocco.slots.length, blocco.id).toBeGreaterThan(0);
    }
  });

  // covers: AC-214-4
  it('con la pagina NEL POOL il blocco senza slot non entra, e dropped ha missing_slot null', () => {
    const brief = briefRicco();
    const spec: PageSpec = { ...pagesFor(brief, { maxPages: 1 })[0], absorbed_roles: [] };

    conBloccoSenzaSlot(() => {
      // Il given, MISURATO e non supposto: `applyRecipe` compone davvero il blocco fabbricato,
      // quindi arriva fino a resolve. Senza questa riga il caso sarebbe verde per vacuita'.
      expect(applyRecipe(CON_SENZA_SLOT, brief, 'home').map((blocco) => blocco.id)).toEqual([
        'hero',
        'senza-slot',
      ]);

      const res = resolve(poolCompleto(['home']), CON_SENZA_SLOT, SOLE, brief, [spec]);
      const documento = accettato(res); // covers: AC-214-4 — il documento resta valido

      expect(idBlocchi(documento.pages[0])).toEqual(['hero']); // covers: AC-214-4
      expect(res.dropped).toEqual([
        { page_slug: 'home', block_id: 'senza-slot', missing_slot: null },
      ]); // covers: AC-214-4
      // Il blocco non compare in NESSUNA forma: ne' vuoto, ne' come token di imagery. La ricerca
      // e' sulle PAGINE e non sul documento intero, perche' l'id della ricetta fabbricata contiene
      // quella stessa stringa — e un oracolo che si compiace di un falso rosso e' peggio di uno
      // che non c'e'.
      expect(JSON.stringify(res.document.pages)).not.toContain('senza-slot'); // covers: AC-214-4
      // Lo slot immagine resta sul blocco che APRE la pagina, che e' ancora 'hero': se il blocco
      // vuoto fosse entrato in coda, questa riga sarebbe verde comunque — ma la prima no.
      expect(documento.pages[0].blocks[0].images).toEqual([
        { source: 'theme-placeholder', token: 'hero' },
      ]); // covers: AC-214-4
    });
  });

  // covers: AC-214-4
  it('con la pagina ASSENTE dal pool la voce e UNA, non zero: lo scarto non e piu silenzioso', () => {
    // L'altra metà del difetto: qui il blocco senza slot usciva dal documento comunque, ma
    // senza dirlo — `dropped` non aveva alcuna voce per lui, e T-230 non avrebbe modo di sapere
    // che una sezione dichiarata dalla direzione non e' mai stata composta.
    const brief = briefRicco();
    const spec: PageSpec = { ...pagesFor(brief, { maxPages: 1 })[0], absorbed_roles: [] };

    conBloccoSenzaSlot(() => {
      const res = resolve(poolDi({ altra: prosaDi('altra') }), CON_SENZA_SLOT, SOLE, brief, [spec]);
      // L'elenco COMPLETO, scritto a mano e in ordine: tre slot dell'hero (che li dichiara) e
      // UNA voce col `missing_slot: null` per il blocco che non ne dichiara nessuno.
      expect(res.dropped).toEqual([
        { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_title_kicker' },
        { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_title' },
        { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_subtitle' },
        { page_slug: 'home', block_id: 'senza-slot', missing_slot: null },
      ]); // covers: AC-214-4
      expect(res.document.pages[0].blocks).toEqual([]); // covers: AC-214-4
      // LA DISTINZIONE CHE IL CONTRATTO PORTA: le tre voci dell'hero si riparano riempiendo il
      // pool, la quarta no. E' l'informazione che un dropped col solo id non darebbe.
      expect(res.dropped.filter((voce) => voce.missing_slot === null)).toHaveLength(1); // covers: AC-214-4
      expect(res.dropped.filter((voce) => voce.missing_slot !== null)).toHaveLength(3); // covers: AC-214-4
    });
  });
});

describe('T-214 AC-214-5 — le offerte vengono dal BRIEF, non dal modello', () => {
  // covers: AC-214-5
  it('i nomi delle cinque offerte NON compaiono in nessuno slot del pool (il given, asserito)', () => {
    const pool = poolCompleto(SLUG_MULTIPAGINA);
    const prosa = JSON.stringify(pool).toLowerCase();
    expect(CINQUE_OFFERTE).toHaveLength(5); // covers: AC-214-5
    for (const offerta of CINQUE_OFFERTE) {
      expect(prosa, offerta.name).not.toContain(offerta.name.toLowerCase()); // covers: AC-214-5
    }
  });

  // covers: AC-214-5
  it('tutte e cinque le offerte compaiono nel documento con i nomi del BRIEF, in ordine', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const documento = accettato(
      resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine),
    );

    const blocco = bloccoDi(paginaDi(documento, 'home'), 'offerte');
    expect(blocco.brief_fields_rendered).toEqual(['offerings']); // covers: AC-214-5
    const offerte = blocco.data.offerings;
    if (!offerte) throw new Error('il blocco offerte non porta le offerte del brief');

    expect(offerte).toHaveLength(5); // covers: AC-214-5
    // I NOMI, nell'ordine del brief e per VALORE — compresa la coppia in cui uno e'
    // PREFISSO dell'altro, che un confronto lasco confonderebbe.
    expect(offerte.map((voce) => voce.name)).toEqual([
      'Pane di grano duro',
      'Pane di grano duro integrale',
      'Focaccia al rosmarino',
      'Crostata di visciole',
      'Cornetto vuoto',
    ]); // covers: AC-214-5
    // E gli altri campi della voce, VOCE PER VOCE: un'asserzione aggregata lascerebbe
    // passare un prezzo o una sezione attaccati alla voce sbagliata.
    expect(offerte[0]).toEqual({ name: 'Pane di grano duro', price: '4,50', section: 'Pane' }); // covers: AC-214-5
    expect(offerte[1]).toEqual({
      name: 'Pane di grano duro integrale',
      description: 'Macinato a pietra',
      section: 'Pane',
    }); // covers: AC-214-5
    expect(offerte[3]).toEqual({
      name: 'Crostata di visciole',
      description: 'Solo il sabato',
      price: '18,00',
      section: 'Dolci',
    }); // covers: AC-214-5
    expect(offerte[4]).toEqual({ name: 'Cornetto vuoto', section: 'Colazione' }); // covers: AC-214-5

    // La pagina 'offerte' porta le STESSE voci: il dato non cambia da pagina a pagina.
    expect(bloccoDi(paginaDi(documento, 'offerte'), 'offerte').data.offerings).toEqual(offerte); // covers: AC-214-5
  });

  // covers: AC-214-5
  it('gli orari, i contatti e l indirizzo vengono dal BRIEF, campo per campo', () => {
    // definition_of_done p.4. Le asserzioni sono per CAMPO e per VALORE: un'unica riga
    // aggregata ("il blocco contatti ha dei dati") non distinguerebbe l'indirizzo del brief
    // da uno scritto dal modello.
    const brief = briefRicco();
    const res = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));
    const documento = accettato(res);
    const home = documento.pages[0];

    const contatti = bloccoDi(home, 'contatti');
    expect(contatti.data.address).toBe('Via Roma 12, Bologna'); // covers: AC-214-5
    expect(contatti.data.phone).toBe('+39 051 000111'); // covers: AC-214-5
    expect(contatti.data.email).toBe('ciao@panificioaurora.it'); // covers: AC-214-5
    expect(contatti.data.whatsapp).toBe('+39 340 0001112'); // covers: AC-214-5
    expect(contatti.data.geo).toEqual({ lat: 44.4949, lng: 11.3426 }); // covers: AC-214-5
    expect(contatti.data.social_links).toEqual(['https://instagram.com/panificioaurora']); // covers: AC-214-5
    expect(contatti.brief_fields_rendered).toEqual(CAMPI_PER_BLOCCO.contatti); // covers: AC-214-5

    expect(bloccoDi(home, 'orari').data.hours).toEqual(ORARI); // covers: AC-214-5
    expect(bloccoDi(home, 'hero').data.business_name).toBe('Panificio Aurora'); // covers: AC-214-5

    // OGNI blocco dichiara esattamente i campi che porta, nell'ORDINE dichiarato da T-210:
    // la tabella e' scritta a mano.
    for (const blocco of home.blocks) {
      expect(blocco.brief_fields_rendered, blocco.id).toEqual(CAMPI_PER_BLOCCO[blocco.id]); // covers: AC-214-5
      // I DUE ELENCHI COINCIDONO COME INSIEMI e NON come sequenze, e la ragione va detta
      // perche' e' una scoperta di questo test e un'informazione per T-231: `parseDocument`
      // restituisce la COPIA che zod costruisce, e zod ricostruisce l'oggetto nell'ordine
      // della propria SHAPE — che per `data` e' l'ordine dei campi del BRIEF (T-121), non
      // quello in cui il blocco li dichiara. Chi a valle vuole l'ordine dichiarato legge
      // `brief_fields_rendered`, che e' un array e lo conserva; l'ordine delle CHIAVI di
      // `data` non e' un contratto.
      expect(Object.keys(blocco.data).sort(), blocco.id).toEqual(
        [...CAMPI_PER_BLOCCO[blocco.id]].sort(),
      ); // covers: AC-214-5
    }

    // ...e nel documento COME RESOLVE LO COSTRUISCE (prima del gate) l'ordine di inserimento
    // e' quello dichiarato dal blocco: e' cio' che questo modulo controlla davvero.
    const contattiGrezzo = res.document.pages[0].blocks.find((blocco) => blocco.id === 'contatti');
    expect(Object.keys(contattiGrezzo?.data ?? {})).toEqual(CAMPI_PER_BLOCCO.contatti); // covers: AC-214-5
  });

  // covers: AC-214-5
  it('un campo del brief ASSENTE non e dichiarato come reso: nessun campo vuoto travestito', () => {
    // Il verso NEGATIVO dello stesso contratto. Il brief perde l'indirizzo e i social; il
    // blocco contatti esiste ancora (restano i canali) ma non dichiara piu' cio' che non
    // rende — altrimenti T-231 sanificherebbe un campo che non c'e' e la pagina mostrerebbe
    // una riga vuota.
    const brief = briefRicco(['address', 'social_links', 'geo']);
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const contatti = bloccoDi(documento.pages[0], 'contatti');

    expect(contatti.brief_fields_rendered).toEqual(['phone', 'email', 'whatsapp']); // covers: AC-214-5
    // Come INSIEME, per la ragione detta sopra: zod ricostruisce `data` nell'ordine della
    // propria shape, non in quello in cui il blocco dichiara i campi.
    expect(Object.keys(contatti.data).sort()).toEqual(['email', 'phone', 'whatsapp']); // covers: AC-214-5
    expect(contatti.data.address).toBeUndefined(); // covers: AC-214-5

    // Un indirizzo di SOLI SPAZI e' un valore valido per il brief (T-121 trima solo
    // business_name) e non deve diventare una riga vuota nel sito.
    const conSpazi = briefRicco([], { address: '   ' });
    expect(conSpazi.address).toBe('   ');
    const altro = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, conSpazi, pagesFor(conSpazi, { maxPages: 1 })),
    );
    expect(bloccoDi(altro.pages[0], 'contatti').brief_fields_rendered).not.toContain('address'); // covers: AC-214-5
    expect(bloccoDi(altro.pages[0], 'contatti').data.address).toBeUndefined(); // covers: AC-214-5
  });

  it('i campi che il brief CONSULTA senza renderli non entrano nel documento', () => {
    // Non deriva da un AC: e' il contratto di T-210 ("vertical, primary_goal e locale
    // selezionano fra valori del CODICE, non testo che finisce nella pagina"). Se resolve
    // riversasse il brief intero nel blocco, questa riga cadrebbe.
    const brief = briefRicco();
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const campi = documento.pages[0].blocks.flatMap((blocco) => Object.keys(blocco.data));
    for (const consultato of ['vertical', 'primary_goal', 'locale', 'description', 'brand_hints']) {
      expect(campi, consultato).not.toContain(consultato);
    }
    // 'description' e 'highlights' passano dal MODELLO e tornano come prosa: nel documento
    // stanno negli slot, non fra i dati resi.
    expect(JSON.stringify(documento)).not.toContain('tono caldo, niente superlativi');
  });
});

describe('T-214 AC-214-6 — il photo_ref di terzi non entra nel documento (P2-D12)', () => {
  /** L'URL di terzi che `fromUrl` (T-141) puo' raccogliere e che il sito non deve chiedere. */
  const OSTILE = 'https://evil.example/foto-del-piatto.jpg';

  function briefConPhotoRef(): Brief {
    return briefRicco([], {
      offerings: CINQUE_OFFERTE.map((offerta) => ({ ...offerta, photo_ref: OSTILE })),
    });
  }

  // covers: AC-214-6
  it("l'URL di terzi non compare in NESSUN punto del documento serializzato", () => {
    const brief = briefConPhotoRef();
    // Il given, asserito: il brief PORTA davvero il photo_ref. Senza questa riga il caso
    // sarebbe verde per assenza di materia.
    expect(brief.content.offerings.every((offerta) => offerta.photo_ref === OSTILE)).toBe(true);
    expect(JSON.stringify(brief)).toContain('evil.example');

    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const res = resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine);
    const documento = accettato(res); // covers: AC-214-6 — e' un documento VALIDO

    // La ricerca e' su TUTTO il documento serializzato, non sul solo blocco offerte: se
    // resolve lo copiasse in un altro campo, questa riga lo vedrebbe.
    const serializzato = JSON.stringify(documento);
    expect(serializzato).not.toContain(OSTILE); // covers: AC-214-6
    expect(serializzato).not.toContain('evil.example'); // covers: AC-214-6
    expect(serializzato).not.toContain('photo_ref'); // covers: AC-214-6
    // ...e nemmeno nel risultato grezzo di resolve (documento + dropped), che e' cio' che il
    // chiamante ha in mano prima del gate.
    expect(JSON.stringify(res)).not.toContain('evil.example'); // covers: AC-214-6

    // LE OFFERTE CI SONO COMUNQUE, tutte e cinque: la difesa non e' "buttare le offerte".
    const offerte = bloccoDi(paginaDi(documento, 'home'), 'offerte').data.offerings;
    expect(offerte).toHaveLength(5); // covers: AC-214-6
    expect(offerte?.[0]).toEqual({ name: 'Pane di grano duro', price: '4,50', section: 'Pane' }); // covers: AC-214-6
    for (const offerta of offerte ?? []) {
      expect(Object.keys(offerta), offerta.name).not.toContain('photo_ref'); // covers: AC-214-6
    }
  });

  // covers: AC-214-6
  it('il documento e IDENTICO a quello del brief senza photo_ref: quel campo non ha effetti', () => {
    // La forma piu' forte dell'asserzione: non "l'URL non c'e'", ma "il photo_ref non
    // cambia NIENTE nel documento". Se resolve lo spostasse in un token, in un titolo o in
    // una meta description, questa riga cadrebbe pur restando vero che l'URL non compare.
    const pagine = pagesFor(briefRicco(), { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);
    const con = resolve(pool, VETRINA, SOLE, briefConPhotoRef(), pagine);
    const senza = resolve(pool, VETRINA, SOLE, briefRicco(), pagine);

    // GUARDIA DI NON VACUITA': due documenti VUOTI sono identici. Sullo stub inerte questa
    // riga era la sola cosa che teneva in piedi il caso, e passava.
    expect(accettato(con).pages).toHaveLength(5); // covers: AC-214-6
    expect(bloccoDi(paginaDi(accettato(con), 'home'), 'offerte').data.offerings).toHaveLength(5); // covers: AC-214-6

    expect(JSON.stringify(con.document)).toBe(JSON.stringify(senza.document)); // covers: AC-214-6
    expect(con.dropped).toEqual(senza.dropped); // covers: AC-214-6
  });

  // covers: AC-214-6
  it("gli slot immagine presenti hanno source 'theme-placeholder', e ce n'e almeno uno", () => {
    const brief = briefConPhotoRef();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const documento = accettato(
      resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine),
    );

    const immagini = documento.pages.flatMap((pagina) =>
      pagina.blocks.flatMap((blocco) => blocco.images),
    );
    // NON VUOTO: l'asserzione sulla sorgente sarebbe vera per vacuita' su zero slot.
    expect(immagini.length).toBeGreaterThan(0); // covers: AC-214-6
    expect(immagini).toHaveLength(documento.pages.length); // covers: AC-214-6
    for (const immagine of immagini) {
      expect(immagine.source).toBe('theme-placeholder'); // covers: AC-214-6
      // La variante 'uploaded' esistera' con l'upload (P4): resolve non puo' emetterla,
      // perche' non esiste un asset caricato da nominare.
      expect(Object.keys(immagine).sort()).toEqual(['source', 'token']); // covers: AC-214-6
    }

    // UNO slot per pagina, sul blocco che la APRE, col token che nomina quel blocco:
    // l'imagery del tema (P2-D12) e non una foto del brief.
    for (const pagina of documento.pages) {
      expect(pagina.blocks[0].images, pagina.slug).toEqual([
        { source: 'theme-placeholder', token: pagina.blocks[0].id },
      ]); // covers: AC-214-6
      for (const blocco of pagina.blocks.slice(1)) {
        expect(blocco.images, `${pagina.slug}/${blocco.id}`).toEqual([]); // covers: AC-214-6
      }
    }
    expect(paginaDi(documento, 'home').blocks[0].images).toEqual([
      { source: 'theme-placeholder', token: 'hero' },
    ]); // covers: AC-214-6
    expect(paginaDi(documento, 'offerte').blocks[0].images).toEqual([
      { source: 'theme-placeholder', token: 'offerte' },
    ]); // covers: AC-214-6
  });
});

describe('T-214 AC-214-1 — determinismo, nei DUE versi', () => {
  // covers: AC-214-1
  it('due chiamate con gli stessi argomenti danno due serializzazioni identiche byte per byte', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);

    const prima = resolve(pool, VETRINA, SOLE, brief, pagine);
    const dopo = resolve(pool, VETRINA, SOLE, brief, pagine);

    const jsonPrima = JSON.stringify(prima.document);
    const jsonDopo = JSON.stringify(dopo.document);

    // GUARDIA DI NON VACUITA': due documenti VUOTI hanno la stessa serializzazione, e
    // "identiche byte per byte" sarebbe vero per assenza di materia. Sullo stub inerte
    // questo caso passava.
    expect(accettato(prima).pages).toHaveLength(5); // covers: AC-214-1
    expect(jsonPrima).toContain('Pane di grano duro integrale'); // covers: AC-214-1
    expect(jsonPrima).toContain(PROSA.hero_title); // covers: AC-214-1

    expect(jsonDopo).toBe(jsonPrima); // covers: AC-214-1
    expect(pesoInByte(dopo.document)).toBe(pesoInByte(prima.document)); // covers: AC-214-1 — byte per byte
    expect(dopo.dropped).toEqual(prima.dropped); // covers: AC-214-1
    // ...e non e' lo STESSO oggetto: due chiamate producono due documenti, non un
    // documento memoizzato che qualcuno a valle potrebbe mutare per tutti.
    expect(dopo.document).not.toBe(prima.document); // covers: AC-214-1
  });

  // covers: AC-214-1
  it('argomenti DIVERSI danno documenti diversi, e la differenza attesa e scritta a mano', () => {
    // IL VERSO CHE LA SOLA RIPETIZIONE NON COPRE (lezione R-04 di T-212): in una funzione
    // pura "due chiamate uguali danno lo stesso risultato" e' quasi vero per costruzione,
    // e una funzione che ignorasse un argomento lo soddisferebbe. Qui ogni argomento e'
    // cambiato UNO PER VOLTA, e cio' che deve cambiare nel documento e' dichiarato.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);
    const base = resolve(pool, VETRINA, SOLE, brief, pagine);
    const jsonBase = JSON.stringify(base.document);

    // 1. LA RICETTA: cambia l'ordine dei blocchi della home e l'id registrato.
    const altraRicetta = ricettaDi('mappa-e-orari@1');
    const conAltraRicetta = resolve(pool, altraRicetta, SOLE, brief, pagine);
    expect(JSON.stringify(conAltraRicetta.document)).not.toBe(jsonBase); // covers: AC-214-1
    expect(idBlocchi(accettato(conAltraRicetta).pages[0])).toEqual(
      HOME_PER_RICETTA['mappa-e-orari@1'],
    ); // covers: AC-214-1
    expect(idBlocchi(accettato(conAltraRicetta).pages[0])).not.toEqual(
      idBlocchi(accettato(base).pages[0]),
    ); // covers: AC-214-1

    // 2. IL TEMA: cambia il solo theme_id.
    const conAltroTema = resolve(pool, VETRINA, temaDi('brezza-costiera@1'), brief, pagine);
    expect(conAltroTema.document.theme_id).toBe('brezza-costiera@1'); // covers: AC-214-1
    expect(JSON.stringify(conAltroTema.document)).not.toBe(jsonBase); // covers: AC-214-1

    // 3. IL POOL: cambia la prosa, non la struttura.
    const altroPool = poolDi(
      Object.fromEntries(
        SLUG_MULTIPAGINA.map((slug) => [
          slug,
          prosaDi(slug, { override: { hero_title: 'Un titolo diverso da ogni altro' } }),
        ]),
      ),
    );
    const conAltroPool = resolve(altroPool, VETRINA, SOLE, brief, pagine);
    expect(
      bloccoDi(paginaDi(accettato(conAltroPool), 'home'), 'hero').content.hero_title,
    ).toBe('Un titolo diverso da ogni altro'); // covers: AC-214-1
    expect(JSON.stringify(conAltroPool.document)).not.toBe(jsonBase); // covers: AC-214-1

    // 4. IL BRIEF: cambia il dato reso, non la prosa.
    const altroBrief = briefRicco([], { business_name: 'Forno Bellini' });
    const conAltroBrief = resolve(pool, VETRINA, SOLE, altroBrief, pagine);
    expect(
      bloccoDi(paginaDi(accettato(conAltroBrief), 'home'), 'hero').data.business_name,
    ).toBe('Forno Bellini'); // covers: AC-214-1
    expect(JSON.stringify(conAltroBrief.document)).not.toBe(jsonBase); // covers: AC-214-1

    // 5. IL SET DI PAGINE: cambia quante pagine il documento ha.
    const conMenoPagine = resolve(pool, VETRINA, SOLE, brief, [pagine[0]]);
    expect(accettato(conMenoPagine).pages).toHaveLength(1); // covers: AC-214-1
    expect(JSON.stringify(conMenoPagine.document)).not.toBe(jsonBase); // covers: AC-214-1

    // E il documento di partenza non e' cambiato sotto i piedi di nessuno.
    expect(JSON.stringify(base.document)).toBe(jsonBase); // covers: AC-214-1
  });

  // covers: AC-214-1
  it('i CATALOGHI di monte non si corrompono fra due chiamate', () => {
    // L'altra meta' del determinismo (lezione di T-212): la forza dell'oracolo sta nel
    // controllo che i cataloghi non vengano MUTATI — un `sort` in place su BLOCKS o su
    // RECIPES cambierebbe l'ordine di ogni generazione successiva, e la ripetizione della
    // stessa chiamata resterebbe verde perche' entrambe le chiamate vedrebbero il catalogo
    // gia' corrotto.
    // LIMITE DICHIARATO: `JSON.stringify` non serializza le funzioni, quindi le
    // precondizioni di BLOCKS e di PAGE_CATALOG non sono coperte da questo confronto — cio'
    // che copre e' l'ORDINE, la cardinalita' e ogni valore serializzabile.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);

    const primaBlocchi = JSON.stringify(BLOCKS);
    const primaRicette = JSON.stringify(RECIPES);
    const primaTemi = JSON.stringify(THEMES);
    const primaPagine = JSON.stringify(PAGE_CATALOG);
    const idBlocchiPrima = BLOCKS.map((blocco) => blocco.id);
    const idRicettePrima = RECIPES.map((ricetta) => ricetta.id);

    for (const ricetta of RECIPES) {
      const multi = resolve(pool, ricetta, temaDi(ricetta.theme_id), brief, pagine);
      const uno = resolve(pool, ricetta, temaDi(ricetta.theme_id), brief, pagesFor(brief, { maxPages: 1 }));
      // GUARDIA DI NON VACUITA': una resolve che non producesse nulla non toccherebbe alcun
      // catalogo, e il confronto prima/dopo sarebbe vero senza dire niente. Sullo stub
      // inerte questo caso passava.
      expect(accettato(multi).pages, ricetta.id).toHaveLength(5); // covers: AC-214-1
      expect(accettato(uno).pages[0].blocks.length, ricetta.id).toBeGreaterThan(5); // covers: AC-214-1
    }

    expect(JSON.stringify(BLOCKS)).toBe(primaBlocchi); // covers: AC-214-1
    expect(JSON.stringify(RECIPES)).toBe(primaRicette); // covers: AC-214-1
    expect(JSON.stringify(THEMES)).toBe(primaTemi); // covers: AC-214-1
    expect(JSON.stringify(PAGE_CATALOG)).toBe(primaPagine); // covers: AC-214-1
    expect(BLOCKS.map((blocco) => blocco.id)).toEqual(idBlocchiPrima); // covers: AC-214-1
    expect(RECIPES.map((ricetta) => ricetta.id)).toEqual(idRicettePrima); // covers: AC-214-1
    // Il confronto sarebbe vero per vacuita' su cataloghi vuoti.
    expect(BLOCKS).toHaveLength(8); // covers: AC-214-1
    expect(RECIPES).toHaveLength(5); // covers: AC-214-1
  });
});

describe('T-214 oracolo aggiuntivo: LA PARTIZIONE (precondizione ereditata 1)', () => {
  /** Una direzione FABBRICATA che ripete un id nella sequenza della home. */
  const RIPETUTA: SiteRecipe = {
    ...VETRINA,
    id: 'ripetizione-di-offerte@1',
    home_blocks: [
      'hero',
      'offerte',
      'orari',
      'offerte',
      'chi-siamo',
      'faq',
      'contatti',
      'cta-whatsapp',
    ],
  };

  it("applyRecipe (T-212) NON deduplica: la ripetizione arriva davvero fino a resolve", () => {
    // Il given, misurato invece di supposto: se applyRecipe deduplicasse, la decisione di
    // resolve sarebbe irrilevante e questo intero describe sarebbe vero per vacuita'.
    const composti = applyRecipe(RIPETUTA, briefRicco(), 'home').map((blocco) => blocco.id);
    expect(composti).toHaveLength(8);
    expect(composti.filter((id) => id === 'offerte')).toHaveLength(2);
  });

  it('resolve DEDUPLICA per id di blocco, tenendo la PRIMA posizione dichiarata', () => {
    // LA DECISIONE: un blocco compare AL PIU' UNA VOLTA per pagina. La ragione e' misurata
    // (precondizione ereditata 1): il campo pesante reso due volte sulla stessa pagina
    // porta il caso peggiore a sfondare il tetto di byte del documento, e un documento
    // legittimo verrebbe RIFIUTATO. La prima posizione vince, cosi' l'ordine della
    // direzione resta quello dichiarato.
    const brief = briefRicco();
    const res = resolve(poolCompleto(['home']), RIPETUTA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));
    const pagina = accettato(res).pages[0];

    expect(idBlocchi(pagina)).toEqual(HOME_PER_RICETTA['vetrina-dell-offerta@1']);
    expect(idBlocchi(pagina).filter((id) => id === 'offerte')).toHaveLength(1);
    expect(res.dropped).toEqual([]);
    // IL CAMPO PESANTE UNA VOLTA SOLA sulla pagina: e' la partizione, ed e' la ragione per
    // cui il documento entra nel tetto.
    const chePortanoLeOfferte = pagina.blocks.filter((blocco) =>
      blocco.brief_fields_rendered.includes('offerings'),
    );
    expect(chePortanoLeOfferte).toHaveLength(1);
  });

  it('la ripetizione dichiarata di un campo PICCOLO resta: la partizione e per BLOCCO', () => {
    // Il verso opposto, e il confine della decisione. T-210 dichiara che `whatsapp` e' reso
    // DUE volte — il recapito nell'elenco dei contatti e il numero dietro al bottone — e ne
    // ha misurato il costo (~800 byte sul documento intero). resolve NON deduplica per
    // CAMPO: se lo facesse, toglierebbe una scelta di prodotto presa a monte. Se
    // deduplicasse solo per blocco, come fa, questa riga resta verde.
    const brief = briefRicco();
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const pagina = documento.pages[0];
    const chePortanoWhatsapp = pagina.blocks.filter((blocco) =>
      blocco.brief_fields_rendered.includes('whatsapp'),
    );
    expect(chePortanoWhatsapp.map((blocco) => blocco.id)).toEqual(['contatti', 'cta-whatsapp']);
    for (const blocco of chePortanoWhatsapp) {
      expect(blocco.data.whatsapp, blocco.id).toBe('+39 340 0001112');
    }
  });
});

describe('T-214 oracolo aggiuntivo: LA MISURA del peso, non la stima', () => {
  // I DUE NUMERI DI RIFERIMENTO, misurati durante il BUILD di generation-model sulla
  // fixture di T-202 (dieci pagine x DOCUMENT_LIMITS.blocks_per_page blocchi, con OGNI slot
  // del catalogo e OGNI campo del brief su ogni pagina).
  // NON SONO CONFRONTABILI PER UGUAGLIANZA con le misure qui sotto, ed e' meglio dirlo che
  // farlo scoprire: la fixture di questo file e' quella che RESOLVE puo' davvero produrre —
  // sette blocchi per pagina (il catalogo ne ha otto e 'recensioni' non e' soddisfacibile),
  // quindici slot invece di diciassette, e i soli nove campi del brief che i blocchi
  // dichiarano. Cio' che va confrontato e' l'ORDINE DI GRANDEZZA e il RAPPORTO fra il caso
  // partizionato e quello non partizionato; le due misure e la loro divergenza dai
  // riferimenti sono RIPORTATE dal test.
  const RIFERIMENTO_PARTIZIONATO = 6397198;
  const RIFERIMENTO_NON_PARTIZIONATO = 11813858;

  // I DUE NUMERI CHE IL COMMENTO IN TESTA A resolve.ts CITA, misurati su cio' che questo modulo
  // produce davvero (30/07/2026). Sono asseriti per UGUAGLIANZA nel caso in coda a questo
  // describe, e non per ordine di grandezza: e' il solo modo per cui un numero scritto in un
  // commento resti vero invece di diventare folklore. Le fixture sono deterministiche (ogni
  // valore e' al tetto e non c'e' random), quindi l'uguaglianza non e' fragile: cambia solo se
  // cambiano i tetti, il catalogo o la ricetta — e allora il commento va rimisurato, non
  // aggiustato.
  const PARTIZIONATO_MISURATO = 6156391;
  const NON_PARTIZIONATO_MISURATO = 12185391;

  /** Le lettere accentate di italiano e spagnolo: 1 code unit, 2 byte. */
  const ACCENTATE = 'àèéìíòóùúñü';

  /** Stringa lunga ESATTAMENTE `limite` code unit, col `tag` in testa. */
  function accentata(limite: number, tag: string): string {
    if (tag.length > limite) throw new Error(`tag '${tag}' piu lungo del tetto ${limite}`);
    let out = tag;
    for (let i = 0; i < limite - tag.length; i += 1) out += ACCENTATE[i % ACCENTATE.length];
    return out;
  }

  function ascii(limite: number, tag: string): string {
    if (tag.length > limite) throw new Error(`tag '${tag}' piu lungo del tetto ${limite}`);
    return tag + 'x'.repeat(limite - tag.length);
  }

  function voci<T>(quanti: number, make: (indice: number) => T): T[] {
    return Array.from({ length: quanti }, (_unused, indice) => make(indice));
  }

  /** Il brief con OGNI campo e OGNI collezione al tetto di P1-D17, in lettere accentate. */
  function briefAiTetti(): Brief {
    return briefDa({
      business_name: accentata(BRIEF_LIMITS.business_name, 'nome-'),
      vertical: 'ristorazione',
      description: accentata(BRIEF_LIMITS.description, 'descrizione-'),
      address: accentata(BRIEF_LIMITS.address, 'indirizzo-'),
      geo: { lat: 45.4642035, lng: 9.1899795 },
      // La CHIAVE degli orari e' al tetto e CONFORME alla forma che il documento impone
      // (alfanumerico ai due bordi): se non lo fosse, resolve la scarterebbe e la fixture
      // non sarebbe piu' al tetto.
      hours: Object.fromEntries(
        voci(BRIEF_LIMITS.hours_keys, (i) => [
          accentata(BRIEF_LIMITS.hours_key, `g${i}-`),
          accentata(BRIEF_LIMITS.hours_value, `orario${i}-`),
        ]),
      ),
      phone: accentata(BRIEF_LIMITS.phone, '390'),
      whatsapp: accentata(BRIEF_LIMITS.whatsapp, '391'),
      email: accentata(BRIEF_LIMITS.email, 'email-'),
      primary_goal: 'ordina',
      offerings: voci(BRIEF_LIMITS.offerings_items, (i) => ({
        name: accentata(BRIEF_LIMITS.offering_name, `offerta${i}-`),
        description: accentata(BRIEF_LIMITS.offering_description, `desc${i}-`),
        price: accentata(BRIEF_LIMITS.offering_price, `p${i}-`),
        section: accentata(BRIEF_LIMITS.offering_section, `sezione${i}-`),
      })),
      social_links: voci(BRIEF_LIMITS.social_links_items, (i) =>
        accentata(BRIEF_LIMITS.social_link, `social${i}-`),
      ),
      highlights: voci(BRIEF_LIMITS.highlights_items, (i) =>
        accentata(BRIEF_LIMITS.highlight, `punto${i}-`),
      ),
      brand_hints: accentata(BRIEF_LIMITS.brand_hints, 'brand-'),
    });
  }

  /** Ogni slot del catalogo col proprio valore al tetto di POOL_LIMITS, per una pagina. */
  function contenutoAiTetti(indice: number): ContenutoPagina {
    const pagina: Record<string, unknown> = {};
    SLOTS.forEach((slot, posizione) => {
      const firma = `p${indice}s${posizione}-`;
      if (slot.kind === 'text') {
        pagina[slot.id] = accentata(POOL_LIMITS.text, firma);
      } else if (slot.kind === 'list') {
        pagina[slot.id] = voci(POOL_LIMITS.list_items, (i) =>
          accentata(POOL_LIMITS.list_item, `${firma}${i}-`),
        );
      } else {
        pagina[slot.id] = voci(POOL_LIMITS.qa_pairs, (i) => ({
          question: accentata(POOL_LIMITS.qa_question, `${firma}d${i}-`),
          answer: accentata(POOL_LIMITS.qa_answer, `${firma}r${i}-`),
        }));
      }
    });
    return pagina;
  }

  /** Lo slug al tetto: ASCII, perche' la forma dello slug (T-202) non ammette altro. */
  function slugAlTetto(indice: number): string {
    return ascii(DOCUMENT_LIMITS.page_slug, `pagina-${indice}-`);
  }

  // I ruoli INTERNI, scritti a mano: e' cio' che una home assorbe in una one-pager.
  const RUOLI_INTERNI: readonly PageRole[] = ['offerings', 'contact', 'hours', 'reviews', 'faq'];

  /**
   * Il set di pagine del CASO PEGGIORE: dieci pagine (il tetto di T-202), ognuna di ruolo
   * 'home' e con TUTTI i ruoli interni assorbiti, cosi' che ognuna porti il massimo numero
   * di blocchi che resolve puo' comporre.
   *
   * E' FABBRICATO A MANO e `pagesFor` non lo produce (il vocabolario dei ruoli e' di sei e
   * la home e' una): e' un BOUND su cio' che resolve puo' essere chiamato a produrre, come
   * la fixture ai tetti di T-202 e' un bound su cio' che il gate puo' accettare.
   */
  function specAiTetti(indice: number): PageSpec {
    return {
      role: 'home',
      slug: slugAlTetto(indice),
      label_key: 'site.nav.home',
      shape: 'one-pager',
      absorbed_roles: RUOLI_INTERNI,
    };
  }

  it('il caso peggiore PARTIZIONATO passa il gate, e il peso e RIPORTATO', () => {
    const brief = briefAiTetti();
    const pagine = voci(DOCUMENT_LIMITS.max_pages, specAiTetti);
    const pool = poolDi(
      Object.fromEntries(pagine.map((spec, indice) => [spec.slug, contenutoAiTetti(indice)])),
    );
    const res = resolve(pool, VETRINA, SOLE, brief, pagine);
    const byte = pesoInByte(res.document);
    const documento = accettato(res);

    const divergenza = (byte - RIFERIMENTO_PARTIZIONATO) / RIFERIMENTO_PARTIZIONATO;
    const rapporto =
      `[T-214 peso] caso peggiore PARTIZIONATO che RESOLVE puo' produrre: ${byte} byte ` +
      `(${(byte / 1024 / 1024).toFixed(3)} MiB), ${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% ` +
      `del tetto di ${DOCUMENT_LIMITS.max_bytes}; margine ` +
      `${((DOCUMENT_LIMITS.max_bytes / byte - 1) * 100).toFixed(1)}%.\n` +
      `  composizione: ${documento.pages.length} pagine x ${documento.pages[0].blocks.length} blocchi, ` +
      `${Object.keys(documento.pages[0].blocks[1].content).length + Object.keys(documento.pages[0].blocks[0].content).length} slot sui primi due blocchi, ` +
      `brief a ogni tetto di P1-D17 in lettere accentate.\n` +
      `  riferimento T-202 (fixture DIVERSA: 12 blocchi, 17 slot, ogni campo su ogni pagina) ` +
      `= ${RIFERIMENTO_PARTIZIONATO} byte, divergenza ${(divergenza * 100).toFixed(1)}%.`;
    console.log(rapporto);

    // Il fatto portante: il caso peggiore partizionato ENTRA, ed e' un documento valido.
    expect(byte, rapporto).toBeLessThan(DOCUMENT_LIMITS.max_bytes);
    expect(documento.pages, rapporto).toHaveLength(DOCUMENT_LIMITS.max_pages);
    expect(pesoInByte(documento), rapporto).toBe(byte); // nessun troncamento al gate
    expect(res.dropped, rapporto).toEqual([]);

    // NON VUOTO PER VACUITA': la fixture e' davvero al tetto, altrimenti la misura non
    // sarebbe il caso peggiore ma un documento qualunque.
    expect(byte, rapporto).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes * 0.6);
    const offerte = documento.pages[0].blocks.flatMap((blocco) => blocco.data.offerings ?? []);
    expect(offerte).toHaveLength(BRIEF_LIMITS.offerings_items);
    const orari = documento.pages[0].blocks.flatMap((blocco) =>
      Object.keys(blocco.data.hours ?? {}),
    );
    expect(orari).toHaveLength(BRIEF_LIMITS.hours_keys);
    expect(documento.pages[0].slug).toHaveLength(DOCUMENT_LIMITS.page_slug);
    expect(documento.pages[0].blocks.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.blocks_per_page);
  });

  it('lo STESSO documento NON partizionato sfonda il tetto ed e RIFIUTATO', () => {
    // Il caso che la decisione di resolve rende non producibile, costruito a mano: lo stesso
    // campo pesante (le offerte al tetto di P1-D17) su DUE blocchi della stessa pagina. E'
    // esattamente cio' che una resolve senza deduplicazione emetterebbe per una ricetta che
    // ripete UN id — e il documento, pur legittimo nella forma, verrebbe RIFIUTATO.
    // NON E' IL CASO PEGGIORE: il controfattuale vero della deduplicazione e' una ONE-PAGER che
    // assorbe i cinque ruoli interni, dove i blocchi ripetuti sono CINQUE e non uno. Quel caso
    // e' il prossimo di questo describe e pesa 12.185.391 byte invece di 11.622.131 — cioe' il
    // numero che questa costruzione a mano da' e' piu' BASSO del vero.
    const brief = briefAiTetti();
    const pagine = voci(DOCUMENT_LIMITS.max_pages, specAiTetti);
    const pool = poolDi(
      Object.fromEntries(pagine.map((spec, indice) => [spec.slug, contenutoAiTetti(indice)])),
    );
    const partizionato = resolve(pool, VETRINA, SOLE, brief, pagine).document;
    const bytePartizionato = pesoInByte(partizionato);

    const nonPartizionato: SiteDocument = JSON.parse(JSON.stringify(partizionato));
    for (const pagina of nonPartizionato.pages) {
      const pesante = pagina.blocks.find((blocco) =>
        blocco.brief_fields_rendered.includes('offerings'),
      );
      if (!pesante) throw new Error('attesa una pagina con un blocco che rende le offerte');
      pagina.blocks.push(JSON.parse(JSON.stringify(pesante)));
    }
    const byte = pesoInByte(nonPartizionato);

    const divergenza = (byte - RIFERIMENTO_NON_PARTIZIONATO) / RIFERIMENTO_NON_PARTIZIONATO;
    const rapportoFraCasi = byte / bytePartizionato;
    const rapporto =
      `[T-214 peso] caso peggiore NON PARTIZIONATO (il campo pesante su DUE blocchi della ` +
      `stessa pagina): ${byte} byte (${(byte / 1024 / 1024).toFixed(3)} MiB), ` +
      `${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del tetto: NON entra.\n` +
      `  rapporto non-partizionato/partizionato = x${rapportoFraCasi.toFixed(3)} ` +
      `(riferimento T-202: x${(RIFERIMENTO_NON_PARTIZIONATO / RIFERIMENTO_PARTIZIONATO).toFixed(3)}).\n` +
      `  riferimento T-202 = ${RIFERIMENTO_NON_PARTIZIONATO} byte, divergenza ` +
      `${(divergenza * 100).toFixed(1)}%.`;
    console.log(rapporto);

    expect(byte, rapporto).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes);
    const issues = rifiutato({ document: nonPartizionato, dropped: [] });
    const troppoPesante = issues.find((issue) => issue.code === 'too_big');
    if (troppoPesante?.code !== 'too_big') throw new Error('atteso un too_big sul peso');
    expect(troppoPesante.maximum, rapporto).toBe(DOCUMENT_LIMITS.max_bytes);
    expect(troppoPesante.path, rapporto).toEqual([]);

    // Il rapporto fra i due casi e' la misura della partizione: se il campo duplicato non
    // fosse quello PESANTE, il rapporto sarebbe vicino a uno e il caso non proverebbe nulla.
    expect(rapportoFraCasi, rapporto).toBeGreaterThan(1.5);
    // E il gemello ACCETTATO e' il documento partizionato, che differisce per quel solo
    // blocco in piu' per pagina.
    expect(parseDocument(partizionato).ok, rapporto).toBe(true);
  });

  it('il caso peggiore NON PARTIZIONATO VERO — la dedup spenta — e DODICI blocchi per pagina', () => {
    // LA CORREZIONE DI NUMERO. Il caso qui sopra clona a mano UN blocco pesante nel documento
    // gia' prodotto e misura 11.622.131 byte: sfonda il tetto, ma non e' il controfattuale della
    // deduplicazione. Quello vero e' la dedup SPENTA lasciando produrre resolve su una one-pager
    // che assorbe i cinque ruoli interni, e il verifier di T-214 lo ha misurato cosi':
    // 12.185.391 byte, il 145,3% del tetto, DODICI blocchi per pagina — esattamente
    // `DOCUMENT_LIMITS.blocks_per_page`, cioe' il tetto sui blocchi NON salva il documento — con
    // 'offerte', 'contatti', 'cta-whatsapp', 'orari' e 'faq' due volte.
    //
    // COME QUESTO CASO OTTIENE LO STESSO NUMERO SENZA TOCCARE resolve: la sequenza che una
    // resolve senza dedup emetterebbe e' la CONCATENAZIONE di cio' che `applyRecipe` (T-212)
    // dichiara per la home e per ciascun ruolo assorbito, nell'ordine del set — quella sequenza
    // e' LETTA da T-212 e non riscritta qui, e in ogni pagina si mette il blocco GIA' RISOLTO da
    // resolve per quell'id, con lo slot immagine sul solo primo (e' la regola di resolve: apre la
    // pagina il primo blocco). I blocchi sono i suoi; e' l'ORDINE a venire dalla ricetta. Non e'
    // una seconda copia di resolve, ed e' l'unico modo di misurare il caso vero senza spegnere
    // una decisione del modulo dal test.
    const brief = briefAiTetti();
    const pagine = voci(DOCUMENT_LIMITS.max_pages, specAiTetti);
    const pool = poolDi(
      Object.fromEntries(pagine.map((spec, indice) => [spec.slug, contenutoAiTetti(indice)])),
    );
    const partizionato = resolve(pool, VETRINA, SOLE, brief, pagine).document;
    const bytePartizionato = pesoInByte(partizionato);

    const senzaDedup: string[] = [];
    for (const ruolo of ['home', ...RUOLI_INTERNI] as readonly PageRole[]) {
      for (const blocco of applyRecipe(VETRINA, brief, ruolo)) senzaDedup.push(blocco.id);
    }
    // Il given, SCRITTO A MANO: dodici voci, cinque delle quali ripetute. Se `applyRecipe`
    // deduplicasse — o se la home della vetrina non contenesse gia' i blocchi dei ruoli interni —
    // questo caso non misurerebbe il controfattuale che dichiara.
    expect(senzaDedup).toEqual([
      'hero',
      'offerte',
      'orari',
      'chi-siamo',
      'faq',
      'contatti',
      'cta-whatsapp',
      'offerte',
      'contatti',
      'cta-whatsapp',
      'orari',
      'faq',
    ]);
    expect(senzaDedup).toHaveLength(DOCUMENT_LIMITS.blocks_per_page);
    expect(partizionato.pages[0].blocks).toHaveLength(7);

    const nonPartizionato: SiteDocument = JSON.parse(JSON.stringify(partizionato));
    for (const pagina of nonPartizionato.pages) {
      const perId = new Map(pagina.blocks.map((blocco) => [blocco.id, blocco]));
      const ricomposti: SiteBlock[] = [];
      for (const id of senzaDedup) {
        const risolto = perId.get(id);
        if (!risolto) throw new Error(`atteso il blocco '${id}' fra quelli risolti da resolve`);
        const copia: SiteBlock = JSON.parse(JSON.stringify(risolto));
        ricomposti.push({ ...copia, images: ricomposti.length === 0 ? copia.images : [] });
      }
      pagina.blocks = ricomposti;
    }
    const byte = pesoInByte(nonPartizionato);
    const rapportoFraCasi = byte / bytePartizionato;
    const rapporto =
      `[T-214 peso] caso peggiore NON PARTIZIONATO VERO (deduplicazione spenta, one-pager che ` +
      `assorbe i cinque ruoli interni): ${byte} byte (${(byte / 1024 / 1024).toFixed(3)} MiB), ` +
      `${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del tetto: NON entra.\n` +
      `  composizione: ${nonPartizionato.pages.length} pagine x ${nonPartizionato.pages[0].blocks.length} ` +
      `blocchi (tetto ${DOCUMENT_LIMITS.blocks_per_page}), ripetuti ` +
      `${JSON.stringify(senzaDedup.slice(partizionato.pages[0].blocks.length))}.\n` +
      `  rapporto non-partizionato/partizionato = x${rapportoFraCasi.toFixed(3)}; il ` +
      `partizionato misura ${bytePartizionato} byte.`;
    console.log(rapporto);

    // I DUE NUMERI CHE IL COMMENTO DI resolve.ts CITA, per UGUAGLIANZA: se una di queste due
    // righe diventa rossa, quel commento e' diventato falso e va RIMISURATO.
    expect(bytePartizionato, rapporto).toBe(PARTIZIONATO_MISURATO);
    expect(byte, rapporto).toBe(NON_PARTIZIONATO_MISURATO);

    // Il fatto portante, e la ragione per cui il numero conta: il controfattuale vero sfonda il
    // tetto di piu' della costruzione a mano del caso precedente (138,5%).
    expect(byte, rapporto).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes);
    expect(byte / DOCUMENT_LIMITS.max_bytes, rapporto).toBeGreaterThan(1.4);
    expect(byte, rapporto).toBeGreaterThan(pesoInByte(partizionato) * 1.9);
    // DODICI blocchi per pagina: il tetto sui blocchi e' rispettato e NON basta. Cio' che tiene
    // il documento sotto il tetto di byte e' la deduplicazione, non un controllo sul numero.
    expect(nonPartizionato.pages[0].blocks, rapporto).toHaveLength(
      DOCUMENT_LIMITS.blocks_per_page,
    );
    // Il campo PESANTE reso DUE volte sulla stessa pagina: senza questa riga il salto potrebbe
    // venire da cinque blocchi leggeri qualunque, e il caso non proverebbe la partizione.
    expect(
      nonPartizionato.pages[0].blocks.filter((blocco) =>
        blocco.brief_fields_rendered.includes('offerings'),
      ),
      rapporto,
    ).toHaveLength(2);

    const issues = rifiutato({ document: nonPartizionato, dropped: [] });
    const troppoPesante = issues.find((issue) => issue.code === 'too_big');
    if (troppoPesante?.code !== 'too_big') throw new Error('atteso un too_big sul peso');
    expect(troppoPesante.maximum, rapporto).toBe(DOCUMENT_LIMITS.max_bytes);
    expect(troppoPesante.path, rapporto).toEqual([]);
    // Gemello ACCETTATO: lo stesso documento con la deduplicazione, cioe' quello che resolve
    // produce davvero. Cambia UNA variabile: i cinque blocchi ripetuti.
    expect(parseDocument(partizionato).ok, rapporto).toBe(true);
  });
});

describe('T-214 oracolo aggiuntivo: la ONE-PAGER e i ruoli ASSORBITI (T-213)', () => {
  // Su una one-pager la home ASSORBE i ruoli superstiti (T-213): resolve compone allora la
  // sequenza della home PIU' quella che la ricetta dichiara per ciascun ruolo assorbito, e
  // la deduplicazione per id rende l'operazione IDEMPOTENTE — senza di essa il blocco
  // 'offerte' comparirebbe due volte su ogni home di one-pager, perche' la sequenza della
  // home lo contiene gia'.
  // LE TABELLE SONO SCRITTE A MANO, direzione per direzione: e' l'unico modo di vedere
  // l'unica differenza osservabile, cioe' i blocchi che ENTRANO nella home solo per
  // assorbimento.
  const ONE_PAGER_PER_RICETTA: Readonly<Record<string, readonly string[]>> = {
    // La vetrina porta gia' tutti i sette blocchi nella home: l'assorbimento non aggiunge
    // nulla, ed e' il caso in cui la deduplicazione e' l'unica cosa che si vede.
    'vetrina-dell-offerta@1': ['hero', 'offerte', 'orari', 'chi-siamo', 'faq', 'contatti', 'cta-whatsapp'],
    'racconto-di-bottega@1': ['hero', 'chi-siamo', 'offerte', 'faq', 'contatti', 'orari', 'cta-whatsapp'],
    // Questa direzione NON porta la FAQ nella home (rinuncia a una sezione per accorciare
    // la strada verso l'azione): sulla one-pager la sezione rientra per assorbimento, in
    // coda, perche' il ruolo 'faq' non ha piu' una pagina propria.
    'scatto-alla-conversione@1': ['hero', 'cta-whatsapp', 'offerte', 'chi-siamo', 'contatti', 'orari', 'faq'],
    'mappa-e-orari@1': ['hero', 'orari', 'contatti', 'offerte', 'chi-siamo', 'cta-whatsapp', 'faq'],
    // Questa direzione tiene il bottone WhatsApp FUORI dalla home e lo mette sulla PAGINA
    // contatti. Su una one-pager quella pagina non esiste, quindi il bottone rientra nella
    // home: la direzione dichiara DOVE vive l'invito, non che debba sparire quando la sua
    // pagina non c'e'. E' una CONSEGUENZA DICHIARATA della lettura di absorbed_roles.
    'scheda-sobria@1': ['hero', 'chi-siamo', 'faq', 'offerte', 'orari', 'contatti', 'cta-whatsapp'],
  };

  it('la home della one-pager porta i blocchi della home PIU quelli dei ruoli assorbiti', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: 1 });
    // Il given, asserito: la home assorbe davvero quattro ruoli. Senza questa riga il caso
    // resterebbe verde su un assorbimento vuoto.
    expect(pagine[0].absorbed_roles).toEqual(['offerings', 'contact', 'hours', 'faq']);
    const pool = poolCompleto(['home']);

    for (const ricetta of RECIPES) {
      const documento = accettato(resolve(pool, ricetta, temaDi(ricetta.theme_id), brief, pagine));
      expect(documento.pages, ricetta.id).toHaveLength(1);
      expect(idBlocchi(documento.pages[0]), ricetta.id).toEqual(ONE_PAGER_PER_RICETTA[ricetta.id]);

      // LA PARTIZIONE REGGE anche qui, che e' il caso in cui piu' ruoli finiscono sulla
      // stessa pagina: ogni id compare una volta sola e il campo pesante una volta sola.
      const ids = idBlocchi(documento.pages[0]);
      expect(new Set(ids).size, ricetta.id).toBe(ids.length);
      expect(
        documento.pages[0].blocks.filter((blocco) =>
          blocco.brief_fields_rendered.includes('offerings'),
        ),
        ricetta.id,
      ).toHaveLength(1);
      expect(documento.pages[0].blocks.length, ricetta.id).toBeLessThanOrEqual(
        DOCUMENT_LIMITS.blocks_per_page,
      );
    }
  });

  it("l'assorbimento AGGIUNGE davvero: due direzioni portano nella home un blocco che la loro sequenza non ha", () => {
    // La differenza fra "resolve legge absorbed_roles" e "resolve lo ignora" e' osservabile
    // solo su queste due direzioni: le altre tre hanno gia' tutto nella home. Il confronto
    // e' col set MULTI-PAGINA, dove gli stessi ruoli hanno una pagina propria e la home NON
    // porta quei blocchi.
    const brief = briefRicco();
    const onePager = pagesFor(brief, { maxPages: 1 });
    const multi = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);

    const scatto = ricettaDi('scatto-alla-conversione@1');
    expect(scatto.home_blocks).not.toContain('faq');
    expect(idBlocchi(accettato(resolve(pool, scatto, temaDi(scatto.theme_id), brief, onePager)).pages[0])).toContain('faq');
    expect(
      idBlocchi(
        paginaDi(accettato(resolve(pool, scatto, temaDi(scatto.theme_id), brief, multi)), 'home'),
      ),
    ).not.toContain('faq');

    const sobria = ricettaDi('scheda-sobria@1');
    expect(sobria.home_blocks).not.toContain('cta-whatsapp');
    expect(idBlocchi(accettato(resolve(pool, sobria, temaDi(sobria.theme_id), brief, onePager)).pages[0])).toContain('cta-whatsapp');
    expect(
      idBlocchi(
        paginaDi(accettato(resolve(pool, sobria, temaDi(sobria.theme_id), brief, multi)), 'home'),
      ),
    ).not.toContain('cta-whatsapp');
  });

  it("l'ORDINE dei ruoli assorbiti e quello del SET, e una home fabbricata lo rende visibile", () => {
    // V-214-04. Il modulo dichiara di comporre "una sequenza per ogni ruolo che la pagina
    // assorbe, nell'ordine dichiarato", e coi cinque ricettari VERI quell'ordine non e'
    // osservabile: ogni direzione riceve per assorbimento AL PIU' UN blocco (le altre sezioni
    // sono gia' nella home), quindi con un solo blocco aggiunto due ordini danno lo stesso
    // documento. MISURATO: invertendo `absorbed_roles` su una copia, per tutte e cinque le
    // direzioni il documento e' BYTE-IDENTICO.
    // Serve percio' una home MINIMA e DUE ruoli assorbiti che portino un blocco ciascuno. La
    // ricetta e' FABBRICATA (il file ne fabbrica gia' una per la partizione) e le due sequenze
    // attese sono SCRITTE A MANO: prendono la mutazione che ordina, inverte o insiemifica
    // `absorbed_roles`, e quella che compone gli assorbiti nell'ordine del vocabolario dei ruoli
    // invece che in quello del set.
    const brief = briefRicco();
    const pool = poolCompleto(['home']);
    const homeMinima: SiteRecipe = { ...VETRINA, id: 'home-minima@1', home_blocks: ['hero'] };
    const base = pagesFor(brief, { maxPages: 1 })[0];

    // Il given, asserito: la home della direzione fabbricata porta UN SOLO blocco, quindi ogni
    // blocco oltre il primo e' entrato per assorbimento e la sua posizione e' la cosa sotto test.
    expect(applyRecipe(homeMinima, brief, 'home').map((blocco) => blocco.id)).toEqual(['hero']);

    const offertePrima = resolve(pool, homeMinima, SOLE, brief, [
      { ...base, absorbed_roles: ['offerings', 'hours'] },
    ]);
    const orariPrima = resolve(pool, homeMinima, SOLE, brief, [
      { ...base, absorbed_roles: ['hours', 'offerings'] },
    ]);

    expect(idBlocchi(accettato(offertePrima).pages[0])).toEqual(['hero', 'offerte', 'orari']);
    expect(idBlocchi(accettato(orariPrima).pages[0])).toEqual(['hero', 'orari', 'offerte']);
    // ...e i due documenti DIFFERISCONO: se resolve normalizzasse l'ordine degli assorbiti — un
    // sort, un Set di ruoli, l'ordine del catalogo — le due righe sopra non potrebbero essere
    // entrambe vere, e questa sarebbe l'ultima a cadere.
    expect(JSON.stringify(orariPrima.document)).not.toBe(JSON.stringify(offertePrima.document));
    // Il resto del documento e' lo STESSO: cambia l'ordine, non il contenuto. Cosi' la
    // differenza sopra non puo' venire da un'altra variabile.
    expect(idBlocchi(accettato(orariPrima).pages[0]).slice().sort()).toEqual(
      idBlocchi(accettato(offertePrima).pages[0]).slice().sort(),
    );
    expect(orariPrima.dropped).toEqual([]);
    expect(offertePrima.dropped).toEqual([]);
  });

  it('un ruolo assorbito che nessun dato soddisfa non porta nulla (recensioni)', () => {
    // 'reviews' non e' soddisfacibile da alcun Brief v1 (T-210), quindi non compare mai fra
    // gli assorbiti di T-213. Qui il ruolo e' messo A MANO fra gli assorbiti: resolve chiede
    // alla ricetta e la ricetta chiede al catalogo, che non ne restituisce nulla — nessun
    // blocco 'recensioni' e nessuna sezione vuota.
    const brief = briefRicco();
    const spec: PageSpec = {
      role: 'home',
      slug: 'home',
      label_key: 'site.nav.home',
      shape: 'one-pager',
      absorbed_roles: ['reviews', 'offerings'],
    };
    const documento = accettato(resolve(poolCompleto(['home']), VETRINA, SOLE, brief, [spec]));

    expect(idBlocchi(documento.pages[0])).not.toContain('recensioni');
    expect(idBlocchi(documento.pages[0])).toEqual(HOME_PER_RICETTA['vetrina-dell-offerta@1']);
    expect(JSON.stringify(documento)).not.toContain('reviews_title');
  });
});

describe('T-214 oracolo aggiuntivo: la CHIAVE degli orari (precondizione ereditata 3)', () => {
  // LA DECISIONE: resolve SCARTA la voce la cui chiave non e' rappresentabile nel documento,
  // e conserva le altre. NON normalizza, per tre ragioni misurabili qui sotto:
  // 1. normalizzare RISCRIVE un dato dell'utente (' sabato ' e 'dom--fest' diventerebbero
  //    etichette che nessuno ha scritto) e non copre comunque i casi in cui non c'e' nulla
  //    da normalizzare ('__proto__', una chiave di soli separatori): servirebbe COMUNQUE una
  //    via di scarto, cioe' due meccanismi invece di uno;
  // 2. la normalizzazione puo' far COLLIDERE due chiavi distinte (' sabato ' e 'sabato'), e
  //    la collisione perderebbe una voce IN SILENZIO — la corruzione che P1-D17 vieta;
  // 3. lo scarto e' PER VOCE: il costo e' la singola riga non rappresentabile, non la
  //    sezione.
  // COSTO DICHIARATO: lo scarto NON e' riportato in `dropped`, che ha un contratto preciso
  // (il blocco e lo slot che manca al pool) e che diventerebbe un log se lo si allargasse.
  // Una voce di orario perduta e' quindi visibile solo confrontando il brief col documento.
  const ORARI_MISTI: Record<string, string> = {
    'lun-ven': '7:00-13:30',
    ' sabato ': '9:00-13:00',
    'dom--fest': 'chiuso',
    'mer gio': '16:00-19:30',
  };

  it('le chiavi non rappresentabili sono scartate, le conformi restano, il documento VALIDA', () => {
    const brief = briefRicco([], { hours: ORARI_MISTI });
    // Il given: il BRIEF le accetta tutte e quattro. brief.ts non impone nessuna forma alla
    // chiave (P1-D13), quindi e' un brief VALIDO che porterebbe un documento invalido.
    expect(Object.keys(brief.hours ?? {})).toEqual(['lun-ven', ' sabato ', 'dom--fest', 'mer gio']);

    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const orari = bloccoDi(documento.pages[0], 'orari').data.hours;

    // Le conformi restano, col loro VALORE: 'mer gio' ha uno spazio INTERNO e la forma del
    // documento lo ammette (e' un'etichetta resa, non uno slug).
    expect(orari).toEqual({ 'lun-ven': '7:00-13:30', 'mer gio': '16:00-19:30' });
    // Le non conformi sono via, e NON riscritte: nessuna chiave normalizzata compare.
    expect(Object.keys(orari ?? {})).not.toContain('sabato');
    expect(Object.keys(orari ?? {})).not.toContain('dom-fest');
    expect(JSON.stringify(documento)).not.toContain('9:00-13:00');
    expect(JSON.stringify(documento)).not.toContain('chiuso');
  });

  it('senza lo scarto lo STESSO documento sarebbe RIFIUTATO: la scelta ha un effetto misurato', () => {
    // La prova che la decisione non e' cerimonia: si rimette a mano nel documento la voce
    // scartata e il gate lo rifiuta, nominando la chiave.
    const brief = briefRicco([], { hours: ORARI_MISTI });
    const res = resolve(
      poolCompleto(['home']),
      VETRINA,
      SOLE,
      brief,
      pagesFor(brief, { maxPages: 1 }),
    );
    const documento: SiteDocument = JSON.parse(JSON.stringify(res.document));
    const blocco = documento.pages[0].blocks.find((voce) => voce.id === 'orari');
    if (!blocco?.data.hours) throw new Error('atteso il blocco orari con la mappa degli orari');
    blocco.data.hours[' sabato '] = '9:00-13:00';

    const gate = parseDocument(documento);
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error('il documento con la chiave non conforme non doveva validare');
    expect(gate.error.issues.some((issue) => issue.path.includes('hours'))).toBe(true);

    // Gemello ACCETTATO: lo stesso documento senza quella voce.
    expect(parseDocument(res.document).ok).toBe(true);
  });

  it('una voce di orario SENZA orario non entra: presente-e-vuoto e assente', () => {
    const brief = briefRicco([], { hours: { 'lun-ven': '7:00-13:30', domenica: '   ' } });
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    expect(bloccoDi(documento.pages[0], 'orari').data.hours).toEqual({ 'lun-ven': '7:00-13:30' });
  });

  it('se NESSUNA chiave e rappresentabile il campo non entra, e il documento resta valido', () => {
    // Il confine della decisione, e il suo costo dichiarato: la sezione orari esiste (la sua
    // precondizione guarda i VALORI, T-210) ma non porta alcuna riga. Il documento resta
    // valido — che e' il punto: resolve non presume che ogni brief valido produca un
    // documento valido, e scegle di non far cadere l'intera generazione per una chiave.
    const brief = briefRicco([], { hours: { ' sabato ': '9:00-13:00', 'dom--fest': 'chiuso' } });
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const blocco = bloccoDi(documento.pages[0], 'orari');

    expect(blocco.data.hours).toBeUndefined();
    expect(blocco.brief_fields_rendered).toEqual([]);
    expect(Object.keys(blocco.data)).toEqual([]);
    // La sezione c'e' con la sua prosa: cio' che manca sono le righe degli orari.
    expect(blocco.content.hours_title).toBe(conTag(PROSA.hours_title, 'home'));
  });

  it("una chiave '__proto__' non corrompe la mappa degli orari del documento", () => {
    // DIFESA IN PROFONDITA', e va detto fin dove arriva: un brief passato da `applyBriefUpdate`
    // NON puo' portare '__proto__' come chiave PROPRIA (zod ricostruisce la mappa e
    // l'assegnazione a quel nome cambia il prototipo invece di aggiungere una chiave),
    // quindi il brief qui e' FABBRICATO con Object.defineProperty. Cio' che si prova e' che
    // il filtro sulla forma della chiave viene PRIMA dell'assegnazione: senza di esso
    // resolve scriverebbe `resi['__proto__'] = valore` e cambierebbe il prototipo della mappa
    // che finisce nel documento.
    const hours = Object.defineProperty({ 'lun-ven': '7:00-13:30' }, '__proto__', {
      value: '9:00-12:00',
      enumerable: true,
      writable: true,
      configurable: true,
    }) as Record<string, string>;
    expect(Object.keys(hours)).toEqual(['lun-ven', '__proto__']);
    const brief: Brief = { ...briefRicco(), hours };

    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const orari = bloccoDi(documento.pages[0], 'orari').data.hours;
    expect(orari).toEqual({ 'lun-ven': '7:00-13:30' });
    expect(Object.getPrototypeOf(orari)).toBe(Object.prototype);
    expect(Object.keys(orari ?? {})).not.toContain('__proto__');
  });

  it('la CHIAVE superstite e TESTO DELL UTENTE, non un etichetta del codice (per T-231)', () => {
    // V-214-09, e non e' una modifica di comportamento: e' l'informazione che manca a chi rende.
    // La chiave di `hours` entra nel documento come CHIAVE DI OGGETTO e viene dal BRIEF, cioe'
    // da `fromUrl` (T-141) o da `update_brief` (T-132). Il contratto di sanificazione che i
    // blocchi dichiarano (`brief_fields_rendered`, T-210) nomina il CAMPO 'hours' e non le sue
    // chiavi: T-231 deve trattarle come dato dell'utente, non come etichette nostre.
    // FIN DOVE ARRIVA LA FORMA DI T-202, detto nei due versi e MISURATO qui: restano
    // rappresentabili parole qualunque con spazi, punti, barre e trattini INTERNI, quindi la
    // chiave e' testo libero; NON sono rappresentabili '<', '>', '&', '"' e '_', perche' la forma
    // ammette solo lettere e cifre Unicode con separatori singoli fra ' ./-'. La LUNGHEZZA la
    // vincola il brief (BRIEF_LIMITS.hours_key = 20), non questo modulo.
    const parlate = {
      'mer gio': '16:00-19:30',
      'lunedi/sabato': '7:00-13:30',
      'lun.ven': 'chiuso il 15',
    };
    const brief = briefRicco([], { hours: parlate });
    // Il given, asserito: le tre chiavi sono nel BRIEF e nessuna e' una parola del codice.
    expect(Object.keys(brief.hours ?? {})).toEqual(['mer gio', 'lunedi/sabato', 'lun.ven']);
    const documento = accettato(
      resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    // VERBATIM: nessuna e' riscritta, nessuna e' sostituita da un'etichetta.
    expect(bloccoDi(documento.pages[0], 'orari').data.hours).toEqual(parlate);
    // E le chiavi del documento sono quelle del brief, non nomi del nostro vocabolario: se
    // resolve normalizzasse la chiave in un giorno della settimana canonico, questa riga
    // cadrebbe.
    expect(Object.keys(bloccoDi(documento.pages[0], 'orari').data.hours ?? {})).toEqual([
      'mer gio',
      'lunedi/sabato',
      'lun.ven',
    ]);

    // IL BORDO SUPERIORE del rischio, misurato: i caratteri che contano per chi rende HTML non
    // sono rappresentabili, quindi la chiave non puo' portare marcatura — resta pero' TESTO, e
    // questa e' la ragione per cui la riga di sopra e' un'informazione per T-231 e non una
    // rassicurazione. Una chiave per volta, con una chiave buona accanto per non misurare il
    // caso "nessuna chiave rappresentabile".
    for (const ostile of ['<b>lun</b>', 'lun&ven', 'lun_ven', '"lun"']) {
      const conOstile = briefRicco([], {
        hours: { [ostile]: '9:00-13:00', 'lun-ven': '7:00-13:30' },
      });
      expect(Object.keys(conOstile.hours ?? {}), ostile).toContain(ostile); // il given
      const doc = accettato(
        resolve(
          poolCompleto(['home']),
          VETRINA,
          SOLE,
          conOstile,
          pagesFor(conOstile, { maxPages: 1 }),
        ),
      );
      expect(bloccoDi(doc.pages[0], 'orari').data.hours, ostile).toEqual({
        'lun-ven': '7:00-13:30',
      });
      expect(JSON.stringify(doc), ostile).not.toContain('9:00-13:00');
    }
  });
});

describe('T-214 oracolo aggiuntivo: NESSUN SEGNAPOSTO, come proprieta', () => {
  /** I marcatori che un segnaposto lascerebbe. Le parole sono ancorate ai confini. */
  const SEGNAPOSTI = /\bTODO\b|\bFIXME\b|\blorem\b|\bipsum\b|\bsegnaposto\b|\bplaceholder\b|\.\.\.|…|\{\{/i;

  /** I documenti su cui la proprieta' vale: nominali e non, con e senza scarti. */
  function documenti(): readonly { readonly nome: string; readonly res: Risultato }[] {
    const ricco = briefRicco();
    const multi = pagesFor(ricco, { maxPages: DOCUMENT_LIMITS.max_pages });
    const onePager = pagesFor(ricco, { maxPages: 1 });
    const povero = briefDa({ business_name: 'Forno Bellini', primary_goal: 'contatta' });

    return [
      {
        nome: 'multi-pagina',
        res: resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, ricco, multi),
      },
      {
        nome: 'one-pager',
        res: resolve(poolCompleto(['home']), VETRINA, SOLE, ricco, onePager),
      },
      {
        nome: 'con blocchi scartati',
        res: resolve(
          poolDi({ home: prosaDi('home', { omessi: ['hours_intro', 'faq_items'] }) }),
          VETRINA,
          SOLE,
          ricco,
          onePager,
        ),
      },
      {
        nome: 'brief povero',
        res: resolve(
          poolCompleto(['home']),
          VETRINA,
          SOLE,
          povero,
          pagesFor(povero, { maxPages: DOCUMENT_LIMITS.max_pages }),
        ),
      },
      {
        nome: 'altra direzione',
        res: resolve(
          poolCompleto(['home']),
          ricettaDi('scheda-sobria@1'),
          temaDi('linea-essenziale@1'),
          ricco,
          onePager,
        ),
      },
    ];
  }

  it('nessun blocco e vuoto e nessuna stringa del documento porta un marcatore di segnaposto', () => {
    const casi = documenti();
    expect(casi).toHaveLength(5); // il ciclo sarebbe vero per vacuita' su una tabella vuota
    const idSlot = SLOTS.map((slot) => slot.id);

    for (const caso of casi) {
      const documento = accettato(caso.res);
      expect(documento.pages.length, caso.nome).toBeGreaterThan(0);
      expect(documento.pages.length, caso.nome).toBeLessThanOrEqual(DOCUMENT_LIMITS.max_pages);

      for (const pagina of documento.pages) {
        expect(pagina.blocks.length, `${caso.nome}/${pagina.slug}`).toBeGreaterThan(0);
        expect(pagina.blocks.length, `${caso.nome}/${pagina.slug}`).toBeLessThanOrEqual(
          DOCUMENT_LIMITS.blocks_per_page,
        );
        // Un id per pagina, una volta sola: la partizione vale su ogni documento.
        expect(new Set(idBlocchi(pagina)).size, `${caso.nome}/${pagina.slug}`).toBe(
          pagina.blocks.length,
        );

        for (const blocco of pagina.blocks) {
          const etichetta = `${caso.nome}/${pagina.slug}/${blocco.id}`;
          // NESSUN BLOCCO VUOTO: ogni blocco porta almeno uno slot di prosa, e ogni valore
          // di quello slot porta davvero un contenuto.
          expect(Object.keys(blocco.content).length, etichetta).toBeGreaterThan(0);
          for (const [slot, valore] of Object.entries(blocco.content)) {
            if (typeof valore === 'string') {
              expect(valore.trim().length, `${etichetta}/${slot}`).toBeGreaterThan(0);
              continue;
            }
            expect(valore?.length, `${etichetta}/${slot}`).toBeGreaterThan(0);
          }
          // Il blocco dichiara ESATTAMENTE i campi del brief che porta: ne' un campo
          // dichiarato e assente dai dati (che T-231 sanificherebbe a vuoto e la pagina
          // renderebbe come una riga senza contenuto), ne' un campo presente e non
          // dichiarato (che il rendering NON sanificherebbe: e' il difetto grave di T-210).
          // Il confronto e' fra INSIEMI: l'ordine delle chiavi di `data` e' quello della
          // shape di zod dopo il gate, e non e' un contratto (vedi AC-214-5).
          expect([...blocco.brief_fields_rendered].sort(), etichetta).toEqual(
            Object.keys(blocco.data).sort(),
          );
        }
      }

      // NESSUN SEGNAPOSTO, e nessun NOME DI SLOT usato come valore: un titolo che dicesse
      // 'hero_title' sarebbe la sezione riempita col nome del proprio buco.
      const stringhe = stringheDi(documento);
      expect(stringhe.length, caso.nome).toBeGreaterThan(0);
      for (const stringa of stringhe) {
        // L'UNICA ESENZIONE, e non e' una scappatoia: 'theme-placeholder' e' il
        // DISCRIMINANTE dell'unione dello slot immagine, cioe' un valore del CODICE che
        // nomina la difesa per tipo di P2-D12 (T-202 lo dichiara come `z.literal`). Non e'
        // testo mostrato a nessuno, e la sorgente degli slot immagine ha il proprio oracolo
        // per VALORE in AC-214-6. L'esenzione e' per UGUAGLIANZA ESATTA: una prosa che
        // CONTENESSE quella parola resterebbe rossa.
        if (stringa === 'theme-placeholder') continue;
        expect(SEGNAPOSTI.test(stringa), `${caso.nome}: '${stringa}'`).toBe(false);
        for (const slot of idSlot) {
          expect(stringa.includes(slot), `${caso.nome}: '${stringa}' contiene '${slot}'`).toBe(
            false,
          );
        }
      }

      // Ogni titolo e ogni meta description esistono e non sono vuoti (T-202 non ammette il
      // vuoto, ma il gate lo dice sul documento: qui si dice su ogni pagina).
      for (const pagina of documento.pages) {
        expect(pagina.title.trim().length, `${caso.nome}/${pagina.slug}`).toBeGreaterThan(0);
        expect(pagina.meta_description.trim().length, `${caso.nome}/${pagina.slug}`).toBeGreaterThan(
          0,
        );
      }
    }
  });
});

describe('T-214 il titolo e la meta description: prosa del modello, mai un troncamento', () => {
  // NON DERIVA DA UN AC. Nessun AC e nessuna riga della DoD dice da dove vengano il titolo
  // e la meta description, e il documento (T-202) li pretende NON VUOTI: la scelta e' di
  // questo task e va dichiarata.
  // LA SCELTA: sono la PROSA che il modello ha scritto per QUESTA pagina — il primo valore
  // di testo dei blocchi composti che ENTRA nel tetto del documento diventa il titolo, il
  // primo dei successivi che entra nel tetto della meta description la diventa. Un valore
  // fuori scala e' SALTATO e mai TAGLIATO (nessun troncamento, P1-D17/T-201).
  // IL PAVIMENTO E' LO SLUG della pagina, perche' una pagina senza titolo non e' un
  // documento valido e il pavimento non puo' dipendere dal modello.
  // COSTO DICHIARATO: sulla home il primo testo e' l'OCCHIELLO del blocco hero (T-201: "che
  // cosa e' l'attivita e dove si trova"), non il titolo della home. resolve non conosce la
  // semantica degli slot — il catalogo non la dichiara — quindi qualunque preferenza per uno
  // slot particolare sarebbe una TABELLA NUOVA, cioe' un terzo catalogo che divergerebbe da
  // T-201. L'unica informazione d'ordine disponibile e' quella DICHIARATA dal catalogo.

  it('titolo e meta description sono i primi due testi della pagina, pinnati per valore', () => {
    const brief = briefRicco();
    const documento = accettato(
      resolve(
        poolCompleto(SLUG_MULTIPAGINA),
        VETRINA,
        SOLE,
        brief,
        pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages }),
      ),
    );

    const home = paginaDi(documento, 'home');
    expect(home.title).toBe(conTag(PROSA.hero_title_kicker, 'home'));
    expect(home.meta_description).toBe(conTag(PROSA.hero_title, 'home'));

    const offerte = paginaDi(documento, 'offerte');
    expect(offerte.title).toBe(conTag(PROSA.offerings_title, 'offerte'));
    expect(offerte.meta_description).toBe(conTag(PROSA.offerings_intro, 'offerte'));

    const contatti = paginaDi(documento, 'contatti');
    expect(contatti.title).toBe(conTag(PROSA.contact_title, 'contatti'));
    expect(contatti.meta_description).toBe(conTag(PROSA.contact_intro, 'contatti'));

    // La pagina FAQ ha UN SOLO slot di testo (l'altro e' una lista di coppie): la meta
    // description ricade sul titolo, ed e' il PAVIMENTO dichiarato invece di una stringa
    // inventata. Il costo e' visibile qui e non nascosto in un commento.
    const faq = paginaDi(documento, 'domande-frequenti');
    expect(faq.title).toBe(conTag(PROSA.faq_title, 'domande-frequenti'));
    expect(faq.meta_description).toBe(faq.title);

    // Due pagine non condividono il titolo: se resolve prendesse il testo dal pool della
    // pagina sbagliata, questa riga lo vedrebbe.
    const titoli = documento.pages.map((pagina) => pagina.title);
    expect(new Set(titoli).size).toBe(titoli.length);
  });

  it('un testo fuori scala e SALTATO, non tagliato: il titolo e il primo che entra nel tetto', () => {
    const brief = briefRicco();
    const lungo = 'A'.repeat(DOCUMENT_LIMITS.page_title + 1);
    expect(lungo.length).toBeGreaterThan(DOCUMENT_LIMITS.page_title);
    const pool = poolDi({ home: prosaDi('home', { override: { hero_title_kicker: lungo } }) });

    const documento = accettato(
      resolve(pool, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const home = documento.pages[0];

    // Il titolo e' il testo SUCCESSIVO, per intero: nessun prefisso del valore fuori scala.
    expect(home.title).toBe(conTag(PROSA.hero_title, 'home'));
    expect(home.title.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.page_title);
    expect(home.title).not.toContain('A'.repeat(20));
    // Il valore fuori scala resta INTATTO dove il modello lo ha scritto: nel contenuto.
    expect(bloccoDi(home, 'hero').content.hero_title_kicker).toBe(lungo);
  });

  it('se nessun testo entra nel tetto il titolo e lo SLUG, e non e mai vuoto', () => {
    const brief = briefRicco();
    // Ogni slot di testo fuori scala per il titolo: il pavimento e' l'unica via che resta.
    const lungo = 'B'.repeat(DOCUMENT_LIMITS.page_title + 1);
    const override: Partial<ContenutoPagina> = {};
    for (const slot of SLOTS) {
      if (slot.kind === 'text') Object.assign(override, { [slot.id]: lungo });
    }
    const documento = accettato(
      resolve(
        poolDi({ home: prosaDi('home', { override }) }),
        VETRINA,
        SOLE,
        brief,
        pagesFor(brief, { maxPages: 1 }),
      ),
    );

    expect(documento.pages[0].title).toBe('home');
    expect(documento.pages[0].title.length).toBeGreaterThan(0);
    // La meta description ha il tetto piu' alto: quel testo vi entra, quindi non ricade.
    expect(documento.pages[0].meta_description).toBe(lungo);
    expect(lungo.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.meta_description);
  });
});

describe('T-214 la provenienza: il POOL non puo scrivere i dati del brief', () => {
  it('un pool che INVENTA indirizzo, orari e piatti non cambia un solo dato del documento', () => {
    // definition_of_done p.4, nella forma avversariale: il modello scrive prosa che
    // CONTRADDICE il brief. Il documento deve portare i dati del BRIEF, e la prosa deve
    // restare dov'e' — negli slot — senza contaminare i campi resi.
    const brief = briefRicco();
    const pool = poolDi({
      home: prosaDi('home', {
        override: {
          contact_intro: 'Ci trovate in Via Falsa 1 e rispondiamo al +39 999 9999999.',
          hours_intro: 'Aperti 24 ore su 24, sette giorni su sette.',
          offerings_intro: 'Provate la Pizza inventata dal modello.',
        },
      }),
    });
    const documento = accettato(
      resolve(pool, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 })),
    );
    const home = documento.pages[0];

    expect(bloccoDi(home, 'contatti').data.address).toBe('Via Roma 12, Bologna');
    expect(bloccoDi(home, 'contatti').data.phone).toBe('+39 051 000111');
    expect(bloccoDi(home, 'orari').data.hours).toEqual(ORARI);
    expect(
      bloccoDi(home, 'offerte').data.offerings?.map((offerta) => offerta.name),
    ).not.toContain('Pizza inventata dal modello');

    // La prosa inventata c'e' ancora, ma SOLO negli slot: resolve trasporta, non promuove.
    const dati = JSON.stringify(home.blocks.map((blocco) => blocco.data));
    expect(dati).not.toContain('Via Falsa 1');
    expect(dati).not.toContain('24 ore su 24');
    expect(dati).not.toContain('Pizza inventata dal modello');
    expect(bloccoDi(home, 'contatti').content.contact_intro).toContain('Via Falsa 1');
  });
});

describe('T-214 totalita e limiti dichiarati: resolve costruisce, non giudica', () => {
  it('un pool senza alcuno slot utile scarta TUTTI i blocchi, e il gate rifiuta la pagina vuota', () => {
    // IL LIMITE DICHIARATO. resolve non omette la pagina rimasta senza blocchi: ometterla
    // farebbe divergere il documento dal set di pagine e dalla navigazione di T-213 (un 404
    // interno per riparare un pool incompleto). Il documento e' quindi RIFIUTATO dal gate, e
    // `dropped` dice esattamente cosa manca al pool — che e' l'informazione con cui T-230
    // distingue un pool incompleto da un pool sbagliato.
    const brief = briefRicco();
    const res = resolve(
      poolDi({ home: {} }),
      VETRINA,
      SOLE,
      brief,
      pagesFor(brief, { maxPages: 1 }),
    );

    // L'elenco COMPLETO, scritto a mano: un blocco per riga di sequenza, uno slot per voce,
    // nell'ordine dichiarato dalla ricetta e poi da ciascun blocco.
    expect(res.dropped).toEqual([
      { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_title_kicker' },
      { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_title' },
      { page_slug: 'home', block_id: 'hero', missing_slot: 'hero_subtitle' },
      { page_slug: 'home', block_id: 'offerte', missing_slot: 'offerings_title' },
      { page_slug: 'home', block_id: 'offerte', missing_slot: 'offerings_intro' },
      { page_slug: 'home', block_id: 'orari', missing_slot: 'hours_title' },
      { page_slug: 'home', block_id: 'orari', missing_slot: 'hours_intro' },
      { page_slug: 'home', block_id: 'chi-siamo', missing_slot: 'about_title' },
      { page_slug: 'home', block_id: 'chi-siamo', missing_slot: 'about_body' },
      { page_slug: 'home', block_id: 'chi-siamo', missing_slot: 'about_points' },
      { page_slug: 'home', block_id: 'faq', missing_slot: 'faq_title' },
      { page_slug: 'home', block_id: 'faq', missing_slot: 'faq_items' },
      { page_slug: 'home', block_id: 'contatti', missing_slot: 'contact_title' },
      { page_slug: 'home', block_id: 'contatti', missing_slot: 'contact_intro' },
      { page_slug: 'home', block_id: 'cta-whatsapp', missing_slot: 'whatsapp_cta_title' },
    ]);
    expect(res.document.pages[0].blocks).toEqual([]);

    const issues = rifiutato(res);
    const vuota = issues.find((issue) => issue.path.includes('blocks'));
    if (vuota?.code !== 'too_small') throw new Error('atteso un too_small sui blocchi');
    expect(vuota.path).toEqual(['pages', 0, 'blocks']);
    expect(vuota.minimum).toBe(1);
  });

  it('un pool senza la pagina, o senza la mappa delle pagine, non fa LANCIARE resolve', () => {
    // UNA DELLE ASSI della totalita', non la totalita'. V-214-01: questa riga diceva "resolve
    // non lancia mai, qualunque cosa riceva" esercitando la sola pagina assente — le altre assi
    // chiuse hanno un caso a testa qui sotto, e quelle che restano APERTE sono nominate col punto
    // in cui cadono. Il pool della fase 1 non contiene le pagine interne (la fase 2 le aggiunge),
    // quindi "pagina assente dal pool" e' un caso vero e non un'ipotesi.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const soloHome = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagine);

    // La home e' completa, le altre quattro pagine non esistono nel pool: i loro blocchi
    // sono tutti scartati e riportati.
    expect(idBlocchi(soloHome.document.pages[0])).toEqual(
      HOME_PER_RICETTA['vetrina-dell-offerta@1'],
    );
    expect(soloHome.document.pages.slice(1).every((pagina) => pagina.blocks.length === 0)).toBe(
      true,
    );
    expect(soloHome.dropped.map((voce) => voce.page_slug)).toEqual([
      'offerte',
      'offerte',
      'contatti',
      'contatti',
      'contatti',
      'orari',
      'orari',
      'domande-frequenti',
      'domande-frequenti',
    ]);
    expect(soloHome.dropped.map((voce) => voce.missing_slot)).toEqual([
      'offerings_title',
      'offerings_intro',
      'contact_title',
      'contact_intro',
      'whatsapp_cta_title',
      'hours_title',
      'hours_intro',
      'faq_title',
      'faq_items',
    ]);

    // Un pool a cui manca perfino la mappa delle pagine: la guardia serve a non far cadere
    // una funzione pura se il chiamante passa un oggetto costruito a mano. Il cast e'
    // deliberato — il TIPO non permette di scriverlo, e la totalita' va comunque provata.
    const malformato = { } as unknown as Pool;
    const res = resolve(malformato, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));
    expect(res.document.pages[0].blocks).toEqual([]);
    expect(res.dropped).toHaveLength(15);
    expect(parseDocument(res.document).ok).toBe(false);
  });

  it('non legge una pagina EREDITATA dal prototipo della mappa del pool', () => {
    // `pool.pages` e' una `z.record` che nasce da JSON non fidato: un accesso NUDO per
    // stringa risolve anche i membri EREDITATI, quindi comporrebbe la pagina con un
    // contenuto che il gate del pool non ha mai visto (e, per uno slug chiamato
    // 'constructor', con una funzione). La lettura e' percio' su proprieta' PROPRIE.
    // Il pool qui e' FABBRICATO, e va detto fin dove arriva la difesa: `parsePool` (T-201)
    // rifiuta una mappa delle pagine che non sia un oggetto semplice, quindi un pool
    // VALIDATO non puo' portare questo caso. E' difesa in profondita', non l'unica linea.
    const brief = briefRicco();
    const ereditata = poolCompleto(['home']).pages.home;
    const pool: Pool = { pages: Object.create({ home: ereditata }) as Pool['pages'] };
    // La pagina E' raggiungibile per catena di prototipi: se non lo fosse, il caso non
    // distinguerebbe una lettura propria da una lettura nuda.
    expect(pool.pages.home).toBe(ereditata);
    expect(Object.hasOwn(pool.pages, 'home')).toBe(false);

    const res = resolve(pool, VETRINA, SOLE, brief, pagesFor(brief, { maxPages: 1 }));
    expect(res.document.pages[0].blocks).toEqual([]);
    expect(res.dropped).toHaveLength(15);
    expect(parseDocument(res.document).ok).toBe(false);
  });

  it('una PAGINA del pool che non e un oggetto proprio conta come ASSENTE, e non fa lanciare', () => {
    // V-214-01, asse ora CHIUSA. Il modulo dichiarava di difendersi la' da "un oggetto costruito
    // a mano", e la difesa c'era ma era INCOMPLETA: MISURATO prima della correzione, con
    // `pool.pages.home = null`, "TypeError: Cannot convert undefined or null to object" da
    // `Object.hasOwn` dentro `slotMancanti`. Una pagina che non e' un oggetto e' ora trattata
    // come ASSENTE — i suoi blocchi finiscono in `dropped`, che e' cio' che questo modulo fa di
    // un pool che non porta il contenuto promesso — e non come un'eccezione.
    // LA TABELLA E' PIU' LARGA DEL DIFETTO, e va detto quali righe sono difesa in profondita' e
    // quali erano il buco: solo `null` e `undefined` facevano LANCIARE (`Object.hasOwn` li
    // rifiuta di convertire); numero, stringa, array e oggetto-con-prototipo passavano gia' per
    // conto loro, perche' `Object.hasOwn` su di essi non lancia e restituisce false. Ora tutte e
    // sei prendono la STESSA strada — quella dichiarata — invece di due strade che si somigliano.
    // Il predicato riusato e' quello dei gate (`isPlainObject`, T-201/T-202) e non un secondo
    // predicato scritto nel modulo.
    // I cast sono deliberati: il TIPO non permette di scrivere questi casi, e la totalita' va
    // comunque provata.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: 1 });
    const rotte: readonly [string, unknown][] = [
      ['null', null],
      ['undefined', undefined],
      ['numero', 42],
      ['stringa', 'hero_title'],
      ['array', ['hero_title']],
      ['con prototipo', Object.create({ hero_title: 'ereditato' })],
    ];

    for (const [nome, rotta] of rotte) {
      const pool = { pages: { home: rotta } } as unknown as Pool;
      const res = resolve(pool, VETRINA, SOLE, brief, pagine);
      expect(res.document.pages[0].blocks, nome).toEqual([]);
      expect(res.dropped, nome).toHaveLength(15);
      // Ogni voce nomina uno slot vero: se la pagina fosse stata letta a metà, qui comparirebbe
      // un blocco composto invece di uno scartato.
      expect(res.dropped.map((voce) => voce.block_id)[0], nome).toBe('hero');
      expect(parseDocument(res.document).ok, nome).toBe(false);
    }

    // GEMELLO ACCETTATO: la stessa pagina come oggetto proprio. Cambia UNA variabile.
    const buono = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, pagine);
    expect(buono.dropped).toEqual([]);
    expect(accettato(buono).pages[0].blocks).toHaveLength(7);
  });

  it('un PageSpec senza absorbed_roles non fa lanciare: non assorbe NULLA', () => {
    // V-214-01, asse ora CHIUSA. Il tipo pretende il campo e `pagesFor` lo scrive sempre (anche
    // vuoto), ma il set puo' arrivare da un artefatto salvato o da un chiamante scritto a mano.
    // MISURATO prima della correzione: "TypeError: Cannot read properties of undefined (reading
    // 'map')" dentro `blocchiDellaPagina`.
    // LA DIREZIONE E' 'scheda-sobria', non la vetrina, e non e' un dettaglio: e' l'unica in cui
    // "assorbe nulla" e' DISTINGUIBILE da "assorbe i quattro ruoli della one-pager", perche' la
    // vetrina porta gia' tutti i sette blocchi nella home.
    const brief = briefRicco();
    const base = pagesFor(brief, { maxPages: 1 })[0];
    const sobria = ricettaDi('scheda-sobria@1');
    const pool = poolCompleto(['home']);
    const senzaCampo = {
      role: base.role,
      slug: base.slug,
      label_key: base.label_key,
      shape: base.shape,
    } as unknown as PageSpec;
    // Il given, asserito: il campo non c'e' davvero, e nel set vero c'e' e non e' vuoto.
    expect(Object.hasOwn(senzaCampo, 'absorbed_roles')).toBe(false);
    expect(base.absorbed_roles).toEqual(['offerings', 'contact', 'hours', 'faq']);

    const res = resolve(pool, sobria, temaDi(sobria.theme_id), brief, [senzaCampo]);
    expect(idBlocchi(accettato(res).pages[0])).toEqual(HOME_PER_RICETTA['scheda-sobria@1']);
    expect(res.dropped).toEqual([]);
    // Il GEMELLO col campo valorizzato dalla one-pager di T-213 porta un blocco in piu': la
    // differenza fra i due e' quel solo campo, quindi "assorbe nulla" non e' vero per vacuita'.
    expect(
      idBlocchi(accettato(resolve(pool, sobria, temaDi(sobria.theme_id), brief, [base])).pages[0]),
    ).toContain('cta-whatsapp');
    expect(idBlocchi(accettato(res).pages[0])).not.toContain('cta-whatsapp');
  });

  it('le assi che restano APERTE cadono dentro applyRecipe (T-212): precondizione del chiamante', () => {
    // V-214-01, il verso che NON si chiude qui e che va detto invece di lasciarlo scoprire a
    // T-230. Un `role` fuori dal vocabolario di T-201, un `role` assente e un `absorbed_roles`
    // che ne contiene uno fuori vocabolario fanno LANCIARE — e non in questo modulo: dentro
    // `applyRecipe`, sul for-of della sequenza dichiarata (`recipe.inner_page_rules[ruolo]` e'
    // `undefined` e `undefined` non e' iterabile, recipes.ts). MISURATO: tre TypeError, tutti e
    // tre con la stessa provenienza.
    // NON SI CHIUDONO QUI: difendersi vorrebbe dire riscrivere in questo file il vocabolario dei
    // ruoli, cioe' la seconda copia di un catalogo di monte — l'errore che tutto questo modulo
    // evita. `pagesFor` (T-213) non puo' produrre un set cosi', e chi lo fabbrica se ne assume la
    // precondizione. Le righe sono qui perche' il giorno in cui T-212 si indurisse diventerebbero
    // rosse e questa dichiarazione andrebbe riscritta: un limite MISURATO, non un commento.
    const brief = briefRicco();
    const pool = poolCompleto(['home']);
    const base = pagesFor(brief, { maxPages: 1 })[0];
    const fuoriVocabolario = 'ruolo-inesistente' as PageRole;

    expect(() =>
      resolve(pool, VETRINA, SOLE, brief, [{ ...base, role: fuoriVocabolario }]),
    ).toThrow(TypeError);
    expect(() =>
      resolve(pool, VETRINA, SOLE, brief, [{ ...base, role: undefined } as unknown as PageSpec]),
    ).toThrow(TypeError);
    expect(() =>
      resolve(pool, VETRINA, SOLE, brief, [{ ...base, absorbed_roles: [fuoriVocabolario] }]),
    ).toThrow(TypeError);
    // I GEMELLI CHE NON LANCIANO: gli stessi tre input col vocabolario rispettato. Senza queste
    // righe le tre di sopra sarebbero verdi anche se resolve lanciasse su QUALUNQUE input.
    expect(() => resolve(pool, VETRINA, SOLE, brief, [{ ...base, role: 'home' }])).not.toThrow();
    expect(() =>
      resolve(pool, VETRINA, SOLE, brief, [{ ...base, absorbed_roles: ['offerings'] }]),
    ).not.toThrow();
  });

  it('piu di max_pages pagine: resolve le emette TUTTE e il gate rifiuta il documento', () => {
    // V-214-08. Il terzo confine di "resolve non e' un gate": gli altri due — la pagina senza
    // blocchi e gli slug duplicati — sono asseriti in questo stesso describe, questo era solo
    // sottinteso benche' sia il piu' facile da provocare da un chiamante (un set piu' lungo del
    // tetto). resolve NON taglia il set: tagliarlo farebbe divergere il documento dalla
    // navigazione di T-213, che e' la stessa ragione per cui non omette una pagina senza blocchi.
    const brief = briefRicco();
    const specs: PageSpec[] = Array.from(
      { length: DOCUMENT_LIMITS.max_pages + 1 },
      (_unused, indice) => ({
        role: 'home',
        slug: `pagina-${indice}`,
        label_key: 'site.nav.home',
        shape: 'multi-page',
        absorbed_roles: [],
      }),
    );
    expect(specs).toHaveLength(11);
    const pool = poolCompleto(specs.map((spec) => spec.slug));
    const res = resolve(pool, VETRINA, SOLE, brief, specs);

    // Le pagine ci sono tutte e undici, e il documento e' PIENO: non e' rifiutato per un pool
    // incompleto ma per il numero di pagine, che e' il confine sotto test.
    expect(res.document.pages).toHaveLength(11);
    expect(res.dropped).toEqual([]);
    expect(res.document.pages.every((pagina) => pagina.blocks.length === 7)).toBe(true);

    const troppe = rifiutato(res).find((issue) => issue.path.includes('pages'));
    if (troppe?.code !== 'too_big') throw new Error('atteso un too_big sulle pagine');
    expect(troppe.maximum).toBe(DOCUMENT_LIMITS.max_pages);
    expect(troppe.path).toEqual(['pages']);

    // GEMELLO ACCETTATO: le stesse pagine meno una. Cambia UNA variabile, il numero.
    expect(accettato(resolve(pool, VETRINA, SOLE, brief, specs.slice(0, 10))).pages).toHaveLength(
      DOCUMENT_LIMITS.max_pages,
    );
  });

  it('blocks_per_page e rispettato PER COSTRUZIONE, non da un controllo', () => {
    // COPERTURA DICHIARATA (V-214-08), resa asserzione dove si puo': resolve non conta i blocchi
    // di una pagina e non ne taglia nessuno. Il tetto regge perche' la partizione fa comparire
    // ogni id AL PIU' UNA VOLTA e il catalogo di T-210 ha OTTO voci — otto sta sotto dodici, e il
    // conto e' questa riga. La mutazione che prende: cinque blocchi nuovi nel catalogo senza
    // alzare il tetto del documento.
    // MISURATO col controfattuale (l'oracolo del peso): con la deduplicazione spenta una home che
    // assorbe i cinque ruoli interni arriva a ESATTAMENTE dodici blocchi, cioe' al tetto. Il
    // margine e' la dedup, non un controllo sul numero.
    expect(BLOCKS.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.blocks_per_page);
    expect(BLOCKS).toHaveLength(8);
    expect(DOCUMENT_LIMITS.blocks_per_page).toBe(12);
  });

  it('un set di pagine VUOTO produce un documento senza pagine, che il gate rifiuta', () => {
    const brief = briefRicco();
    const res = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, []);
    expect(res.document.pages).toEqual([]);
    expect(res.dropped).toEqual([]);
    expect(res.document.recipe_id).toBe(VETRINA.id);
    const issues = rifiutato(res);
    expect(issues.some((issue) => issue.path.includes('pages'))).toBe(true);
  });

  it('due pagine con lo STESSO slug non vengono riparate da resolve: le rifiuta il gate', () => {
    // La stessa scelta di `navigationFor` (T-213): riparare qui toglierebbe il rosso al solo
    // giudice che un set malformato ha. Il set arriva da `pagesFor`, che non produce
    // duplicati; questo caso e' fabbricato per esercitare il confine.
    const brief = briefRicco();
    const spec = pagesFor(brief, { maxPages: 1 })[0];
    const res = resolve(poolCompleto(['home']), VETRINA, SOLE, brief, [spec, spec]);

    expect(res.document.pages).toHaveLength(2);
    const doppio = rifiutato(res).find((issue) => issue.path.includes('slug'));
    expect(doppio?.path).toEqual(['pages', 1, 'slug']);
  });

  it('un brief POVERO produce comunque un documento valido: la home esiste sempre', () => {
    // Il brief piu' povero che possa essere 'confirmed' (T-122): solo il nome e l'obiettivo.
    // Sopravvive il solo blocco 'hero', e il documento e' valido — cioe' il caso limite
    // della fase 1 non e' una generazione fallita.
    const povero = briefDa({ business_name: 'Forno Bellini', primary_goal: 'contatta' });
    const pagine = pagesFor(povero, { maxPages: DOCUMENT_LIMITS.max_pages });
    expect(pagine).toHaveLength(1);

    const res = resolve(poolCompleto(['home']), VETRINA, SOLE, povero, pagine);
    const documento = accettato(res);
    expect(idBlocchi(documento.pages[0])).toEqual(['hero']);
    expect(bloccoDi(documento.pages[0], 'hero').data.business_name).toBe('Forno Bellini');
    // I blocchi la cui precondizione NON e' soddisfatta non sono "scartati": non esistono
    // (P2-D7). `dropped` riporta i soli blocchi caduti per un pool incompleto, e mescolare
    // le due cose direbbe a T-230 che il pool ha un buco dove invece manca un DATO.
    expect(res.dropped).toEqual([]);
  });
});

describe('T-214 purezza: nessuna mutazione degli argomenti', () => {
  it('brief, pool e set di pagine sono identici prima e dopo la chiamata', () => {
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const pool = poolCompleto(SLUG_MULTIPAGINA);

    const primaBrief = JSON.stringify(brief);
    const primaPool = JSON.stringify(pool);
    const primaPagine = JSON.stringify(pagine);

    const prima = resolve(pool, VETRINA, SOLE, brief, pagine);
    resolve(pool, ricettaDi('scheda-sobria@1'), temaDi('linea-essenziale@1'), brief, pagine);

    // GUARDIA DI NON VACUITA': una resolve che non leggesse i propri argomenti non li
    // muterebbe nemmeno. Sullo stub inerte questo caso passava.
    expect(accettato(prima).pages).toHaveLength(5);
    expect(bloccoDi(paginaDi(accettato(prima), 'home'), 'orari').data.hours).toEqual(ORARI);

    expect(JSON.stringify(brief)).toBe(primaBrief);
    expect(JSON.stringify(pool)).toBe(primaPool);
    expect(JSON.stringify(pagine)).toBe(primaPagine);
  });

  it('anche il set ONE-PAGER, dove absorbed_roles NON e vuoto, e identico prima e dopo', () => {
    // V-214-05. Il caso qui sopra esercita il set MULTI-PAGINA, dove OGNI PageSpec ha
    // `absorbed_roles` vuoto: una mutazione in place di quell'array e' invisibile per costruzione
    // — un array vuoto rovesciato resta un array vuoto. MISURATO: un `reverse` IN PLACE su
    // `spec.absorbed_roles` dentro resolve (che muta davvero il PageSpec del chiamante) lasciava
    // verdi tutti e 51 i casi; la stessa classe di mutazione su un catalogo che questo file
    // confronta con snapshot NON VUOTI e' presa con 14 rossi. La one-pager e' l'asse dove
    // l'array ha quattro voci, cioe' quella dove la mutazione in place e' piu' facile da
    // scrivere.
    const brief = briefRicco();
    const onePager = pagesFor(brief, { maxPages: 1 });
    // IL GIVEN NON VACUO, pinnato per VALORE e in ordine: quattro voci. Senza questa riga il
    // confronto prima/dopo tornerebbe a essere vero per assenza di materia.
    expect(onePager).toHaveLength(1);
    expect(onePager[0].absorbed_roles).toEqual(['offerings', 'contact', 'hours', 'faq']);

    const prima = JSON.stringify(onePager);
    const primaAssorbiti = [...onePager[0].absorbed_roles];

    // La direzione e' 'scheda-sobria': e' quella in cui l'assorbimento AGGIUNGE un blocco, quindi
    // la riga successiva prova che `absorbed_roles` e' stato LETTO davvero. Una resolve che lo
    // ignorasse non lo muterebbe nemmeno.
    const sobria = ricettaDi('scheda-sobria@1');
    const res = resolve(poolCompleto(['home']), sobria, temaDi(sobria.theme_id), brief, onePager);
    expect(sobria.home_blocks).not.toContain('cta-whatsapp');
    expect(idBlocchi(accettato(res).pages[0])).toContain('cta-whatsapp');

    expect(JSON.stringify(onePager)).toBe(prima);
    // ...e l'ORDINE per valore, non solo la serializzazione: due letture della stessa cosa, e la
    // seconda dice quale voce sarebbe finita dove.
    expect([...onePager[0].absorbed_roles]).toEqual(primaAssorbiti);
    expect(onePager[0].absorbed_roles).toEqual(['offerings', 'contact', 'hours', 'faq']);
  });

  it('le collezioni sono CONDIVISE dentro il documento grezzo e DISTINTE dopo il gate', () => {
    // V-214-06. Il caso qui sotto prova che le collezioni del documento sono nuove RISPETTO AL
    // BRIEF, e il titolo di questo describe si puo' leggere come una garanzia PER BLOCCO che non
    // c'e': la vista piatta del brief e' calcolata UNA VOLTA per chiamata (resolve.ts lo dichiara
    // e ne da' la ragione) e lo STESSO riferimento e' assegnato a ogni blocco che dichiara quel
    // campo. Qui si asserisce cio' che e' vero, nei due versi, cosi' che chi a valle muta un
    // documento sappia quale dei due ha in mano.
    // LE MUTAZIONI CHE PRENDE: una copia per blocco farebbe cadere il primo `toBe`; un gate che
    // riusasse i riferimenti dell'ingresso invece di ricostruire campo per campo farebbe cadere
    // i due `not.toBe` — ed e' quel secondo fatto che rende l'effetto CONFINATO al documento
    // grezzo.
    const brief = briefRicco();
    const pagine = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages });
    const res = resolve(poolCompleto(SLUG_MULTIPAGINA), VETRINA, SOLE, brief, pagine);

    const grezzoHome = bloccoDi(res.document.pages[0], 'offerte').data.offerings;
    const grezzoPagina = bloccoDi(paginaDi(res.document, 'offerte'), 'offerte').data.offerings;
    // Non vacuo: due collezioni VUOTE sarebbero lo stesso riferimento senza dire niente.
    expect(grezzoHome).toHaveLength(5);
    expect(grezzoHome).toBe(grezzoPagina);
    expect(grezzoHome).not.toBe(brief.content.offerings);

    const documento = accettato(res);
    const dopoHome = bloccoDi(paginaDi(documento, 'home'), 'offerte').data.offerings;
    const dopoPagina = bloccoDi(paginaDi(documento, 'offerte'), 'offerte').data.offerings;
    expect(dopoHome).toHaveLength(5);
    expect(dopoHome).not.toBe(dopoPagina);
    // ...e VOCE PER VOCE, che e' il livello a cui una mutazione a valle farebbe danno.
    expect(dopoHome?.[0]).not.toBe(dopoPagina?.[0]);
    // "distinto" non vuol dire "diverso": i valori sono gli stessi.
    expect(dopoHome).toEqual(dopoPagina);
  });

  it('le collezioni del brief nel documento sono NUOVE: mutare il documento non tocca il brief', () => {
    // Le due collezioni che resolve TRASFORMA (le offerte, senza photo_ref, e gli orari,
    // senza le chiavi non rappresentabili) sono nuove per costruzione; `social_links` e'
    // copiata perche' la stessa lettura valga per tutte. Il pool, invece, e' trasportato per
    // riferimento — dichiarato in testa al file.
    const brief = briefRicco();
    const res = resolve(
      poolCompleto(['home']),
      VETRINA,
      SOLE,
      brief,
      pagesFor(brief, { maxPages: 1 }),
    );
    const home = res.document.pages[0];
    const offerte = bloccoDi(home, 'offerte').data.offerings;
    const contatti = bloccoDi(home, 'contatti').data;

    expect(offerte).not.toBe(brief.content.offerings);
    expect(offerte?.[0]).not.toBe(brief.content.offerings[0]);
    expect(contatti.social_links).not.toBe(brief.content.social_links);
    expect(bloccoDi(home, 'orari').data.hours).not.toBe(brief.hours);
    expect(contatti.geo).not.toBe(brief.geo);
    // ...e i VALORI sono gli stessi: "nuovo" non vuol dire "diverso".
    expect(offerte?.[0]).toEqual({ name: 'Pane di grano duro', price: '4,50', section: 'Pane' });
    expect(contatti.social_links).toEqual(brief.content.social_links);
  });
});

// QUESTO DESCRIBE STA IN CODA AL FILE DI PROPOSITO: confronta i cataloghi con lo snapshot preso
// dal `beforeAll` in testa al file, quindi vede la corruzione di QUALUNQUE caso precedente. Se
// stesse piu' su, un caso successivo potrebbe corrompere un catalogo senza che nulla lo dica.
describe('T-214 i CATALOGHI di monte, giudicati senza dipendere dall ORDINE dei casi', () => {
  it('i quattro cataloghi sono quelli di PRIMA che qualunque caso chiamasse resolve', () => {
    // V-214-03 (a). L'oracolo di AC-214-1 prende lo snapshot "prima" DENTRO il proprio caso, e
    // una corruzione IDEMPOTENTE — un `sort` in place, che applicato due volte non cambia piu'
    // niente — applicata da un caso PRECEDENTE dello stesso file e' gia' nello snapshot: prima ==
    // dopo mentre il catalogo e' corrotto. MISURATO: con un `sort` in place su BLOCKS[i].slots il
    // file intero da' 5 rossi ma quell'oracolo resta VERDE; ESEGUITO DA SOLO lo stesso caso e'
    // ROSSO, cioe' il verdetto dipendeva dall'ordine dei casi. Qui lo snapshot e' del `beforeAll`
    // e il confronto e' in coda: nessuno dei due dipende dall'ordine.
    expect(SNAPSHOT.blocchi.length).toBeGreaterThan(0); // il beforeAll ha girato davvero
    expect(JSON.stringify(BLOCKS)).toBe(SNAPSHOT.blocchi);
    expect(JSON.stringify(RECIPES)).toBe(SNAPSHOT.ricette);
    expect(JSON.stringify(THEMES)).toBe(SNAPSHOT.temi);
    expect(JSON.stringify(PAGE_CATALOG)).toBe(SNAPSHOT.pagine);
    // Il confronto sarebbe vero per vacuita' su cataloghi vuoti (LIMITE DICHIARATO invariato:
    // `JSON.stringify` non serializza le funzioni, quindi le PRECONDIZIONI di BLOCKS e di
    // PAGE_CATALOG non sono coperte — cio' che copre e' l'ordine, la cardinalita' e ogni valore
    // serializzabile).
    expect(BLOCKS).toHaveLength(8);
    expect(RECIPES).toHaveLength(5);
    expect(THEMES).toHaveLength(5);
    expect(PAGE_CATALOG).toHaveLength(6);
  });

  it('gli ORDINI che nessun comportamento rivela sono pinnati a mano, voce per voce', () => {
    // V-214-03 (b). Una corruzione COMPORTAMENTALMENTE NEUTRA non la vede nessun altro oracolo,
    // per definizione — MISURATO: un `sort` in place su BLOCKS[i].page_roles sopravvive a tutti e
    // 51 i casi, perche' `blocksFor` (T-210) guarda `includes` e l'ordine di quell'elenco non ha
    // alcun effetto osservabile in nessun documento. Le tabelle sono SCRITTE A MANO dai contratti
    // di monte e la loro unica funzione e' quella: rendere rossa una corruzione che nessun
    // documento mostrerebbe.
    expect(BLOCKS.map((blocco) => blocco.id)).toEqual(ID_DEL_CATALOGO);
    for (const blocco of BLOCKS) {
      expect(blocco.page_roles, blocco.id).toEqual(PAGE_ROLES_PER_BLOCCO[blocco.id]);
      // Gli slot voce per voce: SLOT_PER_BLOCCO elenca i blocchi della home, e 'recensioni' —
      // che nessun Brief v1 soddisfa (T-210) e che quindi non compare in ALCUN documento — ha la
      // propria riga. E' il caso estremo dell'invisibilita': nemmeno la sua esistenza si vede.
      expect(blocco.slots, blocco.id).toEqual(
        blocco.id === 'recensioni' ? SLOT_DI_RECENSIONI : SLOT_PER_BLOCCO[blocco.id],
      );
    }
    for (const ricetta of RECIPES) {
      expect(ricetta.home_blocks, ricetta.id).toEqual(HOME_BLOCKS_DICHIARATI[ricetta.id]);
    }
    // Le due tabelle NON sono la stessa cosa, e la riga qui sotto e' la misura della loro
    // coincidenza: HOME_PER_RICETTA pinna la sequenza COMPOSTA (cio' che resolve emette col brief
    // ricco), questa la sequenza DICHIARATA. Coincidono oggi perche' col brief ricco ogni blocco
    // della home soddisfa la propria precondizione; divergerebbero il giorno in cui una
    // precondizione cambiasse, e allora sarebbe questa tabella — non quella — a dire che cosa
    // T-212 dichiara.
    for (const ricetta of RECIPES) {
      expect(HOME_BLOCKS_DICHIARATI[ricetta.id], ricetta.id).toEqual(HOME_PER_RICETTA[ricetta.id]);
    }
    // LE DUE DIREZIONI CHE DICHIARANO SEI BLOCCHI invece di sette, e cio' che ciascuna lascia
    // fuori: sono le sole due su cui l'assorbimento della one-pager e' osservabile, ed e' il
    // given dell'oracolo dedicato. Scritte qui perche' una tabella che sbagliasse proprio quelle
    // due voci renderebbe vacuo quell'oracolo senza far cadere nulla.
    expect(HOME_BLOCKS_DICHIARATI['scatto-alla-conversione@1']).toHaveLength(6);
    expect(HOME_BLOCKS_DICHIARATI['scatto-alla-conversione@1']).not.toContain('faq');
    expect(HOME_BLOCKS_DICHIARATI['scheda-sobria@1']).toHaveLength(6);
    expect(HOME_BLOCKS_DICHIARATI['scheda-sobria@1']).not.toContain('cta-whatsapp');
  });
});
