import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GENERATABLE_MIN_BLOCKS,
  generatable,
  type MissingEntry,
} from '@/domain/generation/generatable';
import { BLOCKS, blocksFor, resolveOfferings } from '@/domain/generation/blocks';
import { PAGES_MIN, PAGE_CATALOG, pagesFor, type PageSpec } from '@/domain/generation/pages';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import {
  BriefUpdateSchema,
  applyBriefUpdate,
  emptyBrief,
  isBriefComplete,
  type Brief,
} from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';

// T-215 (macrotask generation-engine, P2) — IL GATE CHE DECIDE SE SPENDERE UNA CHIAMATA A UN
// MODELLO A PAGAMENTO. Le asserzioni DERIVANO dagli acceptance_criteria AC-215-1..AC-215-6
// (docs/blueprint/P2-generation/02-generation-engine.md); i describe marcati "oracoli
// aggiuntivi" sono dichiarati come tali e nominano cio' che provano. Dominio puro: nessun DB,
// nessuna rete, nessun mock.
//
// PERCHE' QUESTO FILE E' PIU' SEVERO DEL SOLITO: e' l'ultimo task del macrotask ed e' il gate
// che precede una spesa. Un oracolo debole qui non produce un test verde e un difetto latente:
// produce una chiamata pagata per un brief che non puo' dare un sito presentabile (spreco), o
// il rifiuto di un brief che invece lo darebbe (un utente che non riesce a generare il sito).
//
// TRE COSE CHE QUESTO FILE PROVA E CHE NON SI IMPLICANO FRA LORO, ed e' bene tenerle distinte:
// - il CONTEGGIO (`surviving_blocks`, `pages`) coincide con quello dei contratti a monte;
// - la SOGLIA (`GENERATABLE_MIN_BLOCKS`) e' pinnata dai due lati con casi ADIACENTI;
// - l'elenco `missing` e' AZIONABILE voce per voce, cioe' e' una promessa verificata e non un
//   elenco descrittivo.
//
// CIO' CHE QUESTO FILE NON PROVA, scritto invece che sottinteso (L-COL-006):
// - non prova che QUATTRO sia il numero giusto per il prodotto: prova che e' il primo numero
//   che un brief il quale dice UNA COSA SOLA non puo' raggiungere (la misura e' nella tabella
//   UN_SOLO_CAMPO) e che sta sotto il massimo raggiungibile. Che quello sia il confine
//   commerciale giusto e' una decisione, non una proprieta' oracolabile;
// - non prova che il sito generato sara' BELLO ne che il modello scrivera' una buona prosa: lo
//   stile non e' oracolabile (P1 §6-bis p.8) e non e' materia di questo gate;
// - non prova nulla sui MESSAGGI mostrati all'utente ne sulla loro i18n (T-230, fuori scopo):
//   `missing` porta identificatori, non testo;
// - non prova che la generazione venga davvero BLOCCATA a livello di rotta (T-230): qui c'e' la
//   funzione pura che risponde, non il chiamante che obbedisce.
//
// CIO' CHE RESTA DICHIARATO E NON ASSERITO (declared coverage), perche' chi rivede non debba
// scoprirlo da solo:
// - `missing` NON E' LA SPIEGAZIONE DI `ok`, e i due si leggono separatamente: `ok` e' una
//   soglia sui blocchi superstiti, `missing` e' l'elenco di cio' che ancora manca. Un brief
//   generabile puo' avere voci in `missing` (il caso del vertical non scelto, C7) e questo file
//   lo pinna invece di lasciarlo dedurre;
// - `missing` ELENCA CIO' CHE MANCA AL BERSAGLIO, non i campi vuoti del brief. Un campo
//   VALORIZZATO puo' comparire lo stesso, perche' la PAGINA che lo cita chiede piu' della
//   SEZIONE (T-213 alza la soglia di T-210): e' il caso C4, tre offerte, dove il blocco
//   'offerte' esiste e la pagina 'offerings' no. E' la ragione per cui `missing` ha una voce
//   per COPPIA (campo, bersaglio) e non una voce per campo con piu' id — vedi il describe
//   dedicato;
// - LA SOGLIA DELLA PAGINA CONTATTI (due recapiti) e LA SOGLIA DELLE MATERIE FAQ (tre sorgenti)
//   NON HANNO VOCI in `missing`, ed e' una scelta con un costo PIU' ALTO di quanto questa riga
//   dichiarasse. La versione precedente diceva "nessun campo SINGOLO le sblocca": e' vero solo
//   DA UN BRIEF POVERO — da zero recapiti servono due campi, da zero materie ne servono tre — ed
//   e' falso da ogni stato intermedio, che e' poi lo stato in cui un utente si trova davvero.
//   MISURATO IN QUESTO FILE, dal contatore `eccezioniIncontrate` del verso complementare:
//   QUATTORDICI coppie (campo, bersaglio) in cui UN SOLO campo sblocca 'faq' o 'contact' fra i
//   casi qui presenti. Esempi: dal brief ricco di AC-215-3 il solo `phone` sblocca la pagina
//   'contact'; da description + hours il solo `address` sblocca il blocco 'faq' E la pagina.
//   Il file MISURAVA gia' quei controesempi e in testa dichiarava il contrario: e' la classe
//   "dichiarazione che dice piu' del vero" gia' pagata in T-213 e T-214.
//   LA SCELTA RESTA, e la ragione e' invariata: riscrivere qui quelle soglie
//   (PAGE_MIN_RECAPITI e materieFaq non sono esportate) sarebbe una seconda verita' sulla stessa
//   cosa, il difetto contro cui T-213 mette in guardia in testa al proprio file. Il COSTO VERO,
//   detto per intero: l'utente che ha gia' UN recapito, o DUE materie su tre, non riceve la
//   guida "te ne manca uno" benche' un solo campo basterebbe;
// - QUANTI CASI DI QUESTO FILE NON GIUDICANO IL COMPORTAMENTO: CINQUE, non tre. Tre giudicano
//   i contratti A MONTE (sono marcati caso per caso piu' sotto); gli altri DUE sono gli oracoli
//   sugli import, che leggono il SORGENTE del modulo e non possono fallire per una ragione
//   comportamentale. MISURATO su uno stub inerte che CONSERVA gli import: 23 rossi e 5 verdi.
//   La misura del passo rosso ne contava tre perche' quello stub aveva perso gli import;
// - LA PROVENIENZA DEI RUOLI SUPERSTITI NON E' OSSERVABILE, e va detto perche' il modulo
//   dichiara di leggerli dal risultato di `pagesFor` invece di ricalcolarli. MISURATO: tre
//   mutazioni che introducono proprio quella seconda verita' — rileggere le precondizioni di
//   PAGE_CATALOG, una seconda chiamata a `pagesFor` con un tetto suo, una seconda a `blocksFor`
//   — lasciano tutte 28 verdi. Sono MUTANTI EQUIVALENTI: l'unione role + absorbed_roles coincide
//   per costruzione con l'insieme dei ruoli a precondizione soddisfatta, per ogni tetto. La
//   scelta resta giusta (una sola verita' non puo' divergere) ma NON e' asserita: e' architettura;
// - `generatable` NON E' SONDATA su un Brief che non venga dal validatore di P1: tutte le
//   fixture passano da `applyBriefUpdate`, che e' la scelta giusta per il realismo e qui e'
//   dichiarata. Il comportamento su un oggetto costruito a mano (`content` assente, `vertical`
//   fuori enum, `hours` non oggetto) non e' misurato da questa suite: il modulo non ha guardie
//   proprie e delega a blocksFor/pagesFor, che hanno le loro. Nessun AC lo chiede;
// - IL CONFRONTO PER UGUAGLIANZA sugli id (il modulo usa `Set.has` e mai `startsWith`) NON E'
//   OSSERVABILE oggi — MISURATO: la mutazione che lo riscrive con `startsWith` lascia verdi tutte
//   e 28 le asserzioni, perche' nel catalogo di T-210 nessun id di blocco e' prefisso di un altro
//   e lo stesso vale per i ruoli di T-213. La scelta e' presa in anticipo; cio' che il file pinna
//   e' l'ASSENZA di prefissi, cosi' la decisione torna sul tavolo quando smettera' di essere
//   gratuita;
// - IMMUTABILITA': il `readonly` di TypeScript e' del COMPILATORE. Qui si giudica che
//   `generatable` non muti i cataloghi, il brief ricevuto ne la propria tabella di regole (una
//   voce restituita e' una COPIA: asserito), non che nessun altro POSSA mutarli;
// - `isBriefComplete` (T-122) e' importato DA QUESTO FILE perche' AC-215-4 lo chiede: e' il
//   termine di paragone. Che il MODULO non lo importi e' asserito leggendone il sorgente.

// ── fixture ──────────────────────────────────────────────────────────────────
// Correzione di metodo n.1 di P1 (il difetto ripetutosi TRE volte con la suite verde): PIU' DI
// UN ELEMENTO, valori DISCORDANTI, e almeno un id che sia PREFISSO di un altro. 'Tagliere' e'
// prefisso di 'Tagliere della casa': un confronto scritto con startsWith invece che con
// uguaglianza deve poter essere osservato mentre sbaglia — e qui conta due volte, perche'
// `applyBriefUpdate` fonde le offerte PER NOME (T-122) e una fusione per prefisso
// sovrascriverebbe la voce sbagliata mentre il conteggio resta plausibile.

const SEI_OFFERTE = [
  { name: 'Tagliere', price: '12,00', section: 'Antipasti' },
  { name: 'Tagliere della casa', description: 'Selezione del giorno', section: 'Antipasti' },
  { name: 'Crescentine', price: '6,00', section: 'Antipasti' },
  { name: 'Zuppa di ceci', price: '9,50', section: 'Primi' },
  { name: 'Tortelloni di ricotta', description: 'Tirati a mano', section: 'Primi' },
  { name: 'Tagliatelle al ragu', price: '11,00', section: 'Primi' },
];

// I DUE LATI del confine della soglia della PAGINA offerte (T-213: quattro voci) contro quella
// della SEZIONE (T-210: una voce). TRE offerte e' il caso in cui il blocco esiste e la pagina no.
const QUATTRO_OFFERTE = SEI_OFFERTE.slice(0, 4);
const TRE_OFFERTE = SEI_OFFERTE.slice(0, 3);

// Due chiavi con valori DISCORDANTI: un orario spezzato e uno continuato.
const ORARI = { 'lun-ven': '9:00-13:00 / 15:00-19:00', sabato: '9:00-13:00' };

const TRE_EVIDENZE = ['Pasta fatta in casa', 'Cantina naturale', 'Dehors sul canale'];

const DESCRIZIONE = 'Osteria di quartiere aperta dal 1998, cucina di stagione.';

/**
 * Costruisce un brief passando dal VALIDATORE vero (`applyBriefUpdate`, T-122): il brief sotto
 * test e' allora un brief che il dominio accetta davvero, non un oggetto scritto a mano che gli
 * somiglia. Una patch SCARTATA farebbe provare al caso qualcosa di diverso da cio' che dichiara,
 * quindi lo scarto e' rosso qui.
 */
function briefDa(patch: Record<string, unknown>): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return brief;
}

/** Aggiunge UNA patch a un brief gia' costruito, sempre passando dal validatore vero. */
function piu(brief: Brief, patch: Record<string, unknown>): Brief {
  const applicato = applyBriefUpdate(brief, patch);
  expect(applicato.rejected, `patch scartata: ${applicato.rejected.join(',')}`).toEqual([]);
  return applicato.brief;
}

/** Il brief VUOTO: nemmeno confermabile (manca il nome). E' il pavimento assoluto. */
function briefVuoto(): Brief {
  return emptyBrief('it');
}

/**
 * Il brief PIU' POVERO che possa essere 'confirmed' (given di AC-215-1): solo business_name,
 * primary_goal e locale — i campi che `isBriefComplete` vincola davvero — con `vertical` al
 * default 'altro' e `content` al default vuoto (T-121).
 */
function briefPoverissimo(): Brief {
  return briefDa({ business_name: 'Osteria del Ponte', primary_goal: 'contatta' });
}

/** Il brief RICCO descritto dal given di AC-215-3: descrizione, sei offerte in due sezioni,
 *  orari, indirizzo, tre evidenze. Il vertical NON e' nominato dall'AC, quindi resta 'altro'. */
function briefRiccoDellAc(): Brief {
  return briefDa({
    business_name: 'Osteria del Ponte',
    primary_goal: 'prenota',
    description: DESCRIZIONE,
    offerings: SEI_OFFERTE,
    hours: ORARI,
    address: 'Via dei Mille 4, Bologna',
    highlights: TRE_EVIDENZE,
  });
}

/** Il brief PIU' RICCO costruibile col Brief v1: ogni sorgente che un blocco puo' chiedere. */
function briefRiccoMassimo(): Brief {
  return briefDa({
    business_name: 'Osteria del Ponte',
    vertical: 'ristorazione',
    description: DESCRIZIONE,
    address: 'Via dei Mille 4, Bologna',
    phone: '+39 051 000111',
    whatsapp: '+39 340 0001112',
    email: 'ciao@osteriadelponte.it',
    primary_goal: 'prenota',
    highlights: TRE_EVIDENZE,
    offerings: SEI_OFFERTE,
    hours: ORARI,
    geo: { lat: 44.4949, lng: 11.3426 },
    social_links: ['https://instagram.com/osteriadelponte', 'https://facebook.com/osteria'],
    brand_hints: 'tono caldo, niente superlativi',
  });
}

// ── strumenti di lettura, tutti DERIVATI dai contratti a monte ───────────────

/**
 * I blocchi che sopravvivono davvero alle precondizioni di T-210, chiesti a `blocksFor`. Il
 * ruolo e' 'home' perche' OGNI blocco del catalogo dichiara quel ruolo (invariante di T-210,
 * asserito piu' sotto invece che assunto): chiedere la home significa quindi chiedere TUTTI i
 * blocchi soddisfatti, non un sottoinsieme.
 */
function idBlocchiSuperstiti(brief: Brief): string[] {
  return blocksFor(brief, 'home').map((blocco) => blocco.id);
}

/**
 * I RUOLI DI PAGINA superstiti letti dal risultato di `pagesFor`: per ogni pagina il proprio
 * ruolo, piu' i ruoli che quella pagina ASSORBE. E' la stessa lettura che usa il file di test di
 * T-213, ed e' quella giusta qui per una ragione precisa: un ruolo la cui precondizione E'
 * soddisfatta ma che il tetto di piano ha tagliato compare fra gli ASSORBITI della home, quindi
 * questa lettura NON dipende da `maxPages`. Contare invece le sole pagine del set direbbe che il
 * dato manca quando a mancare e' il piano pagato — cioe' chiederebbe all'utente di scrivere
 * altro per riparare un tetto commerciale.
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

function ruoliSuperstitiDi(brief: Brief, maxPages: number): PageRole[] {
  return ruoliSuperstiti(pagesFor(brief, { maxPages }));
}

// I NOMI DEI CAMPI del brief, DERIVATI dallo schema di T-121 e mai ricopiati: sono le chiavi
// della patch FLAT, cioe' la stessa derivazione che T-210 usa per `brief_fields_rendered`. Un
// campo che il brief non ha non e' nominabile, e i due elenchi non possono divergere in silenzio.
type CampoDelBrief = keyof (typeof BriefUpdateSchema)['shape'];

// I VALORI con cui un campo viene "valorizzato" nella misura della soglia e nell'oracolo di
// azionabilita'. La tabella e' TOTALE PER TIPO sulle chiavi della patch di T-121: un campo nuovo
// nel brief non compila finche' non gli si sceglie un valore, invece di restare fuori da entrambe
// le misure senza che nulla protesti.
const VALORE_PER_CAMPO: Readonly<Record<CampoDelBrief, unknown>> = {
  business_name: 'Osteria del Ponte',
  vertical: 'ristorazione',
  description: DESCRIZIONE,
  address: 'Via dei Mille 4, Bologna',
  geo: { lat: 44.4949, lng: 11.3426 },
  hours: ORARI,
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@osteriadelponte.it',
  primary_goal: 'prenota',
  locale: 'it',
  offerings: SEI_OFFERTE,
  social_links: ['https://instagram.com/osteriadelponte'],
  highlights: TRE_EVIDENZE,
  brand_hints: 'tono caldo, niente superlativi',
};

// Gli ID AMMESSI, DERIVATI DAI CATALOGHI A MONTE (AC-215-2 lo chiede espressamente): mai
// riscritti a mano. Un id nuovo la' entra da solo nell'insieme ammesso; un id che sparisse la'
// rende rossa ogni voce che lo cita.
const ID_DI_BLOCCO: readonly string[] = BLOCKS.map((blocco) => blocco.id);
const ID_DI_PAGINA: readonly PageRole[] = PAGE_CATALOG.map((voce) => voce.role);

// Il tetto NON ARTIFICIALE, DERIVATO dal contratto a monte (T-202): usarlo come `maxPages`
// significa "nessun tetto di piano", che e' il default dichiarato di P2 (P2-D13).
const SENZA_TETTO_DI_PIANO = DOCUMENT_LIMITS.max_pages;

/**
 * La forma con cui le voci di `missing` si confrontano con la tabella attesa: una TUPLA
 * (campo, tipo di bersaglio, id, effetto). Il confronto e' su ARRAY e non su insieme, quindi
 * pinna anche l'ORDINE — che e' una decisione (l'ordine dei cataloghi a monte) e non un caso.
 */
type VoceAttesa = readonly [CampoDelBrief, MissingEntry['kind'], string, MissingEntry['effect']];

function come(missing: readonly MissingEntry[]): VoceAttesa[] {
  return missing.map((voce) => [voce.field, voce.kind, voce.id, voce.effect] as const);
}

// ── la tabella dei casi, scritta a mano ──────────────────────────────────────
// Ogni caso dichiara QUATTRO cose che non si implicano fra loro: quanti blocchi sopravvivono, se
// il brief e' generabile, quante pagine escono a ciascun tetto, e l'elenco ESATTO di `missing`.
// Derivarne una dalle altre rifarebbe dentro l'oracolo il lavoro della funzione sotto test.
//
// I CASI SONO COSTRUITI A COPPIE ATTORNO AI CONFINI, ed e' l'unica forma in cui una soglia e'
// davvero pinnata: tre blocchi / quattro blocchi (i due lati di GENERATABLE_MIN_BLOCKS), tre
// offerte / sei offerte (i due lati della soglia di pagina di T-213), vertical 'altro' / vertical
// scelto (AC-215-5).
//
// L'ORDINE DI `missing` E' QUELLO DEI CATALOGHI A MONTE, e il caso C0 lo mostra per intero:
// prima i BLOCCHI nell'ordine di BLOCKS (hero, offerte, chi-siamo, orari, contatti,
// cta-whatsapp — 'recensioni' e 'faq' non hanno voci, vedi la copertura dichiarata), e dentro
// ciascun blocco i campi che da soli lo sbloccherebbero; poi le PAGINE nell'ordine di
// PAGE_CATALOG (offerings, hours).

type CasoAtteso = {
  readonly nome: string;
  readonly brief: () => Brief;
  readonly blocchi: number;
  readonly ok: boolean;
  /** Quante pagine a ciascun tetto. Le chiavi sono i tetti, i valori scritti a mano. */
  readonly pagine: Readonly<Record<number, number>>;
  readonly missing: readonly VoceAttesa[];
};

// I tetti su cui ogni caso e' misurato. Comprendono il confine di PAGES_MIN (2 e 3) perche' e'
// li' che il set collassa in one-pager.
const TETTI: readonly number[] = [1, 2, 3, SENZA_TETTO_DI_PIANO];

const CASI: readonly CasoAtteso[] = [
  {
    // Il pavimento assoluto: nemmeno il nome. Nessun blocco esiste, nemmeno l'hero — ed e' il
    // solo caso in cui la voce 'business_name' compare in `missing`, cioe' il solo che esercita
    // la prima riga della tabella delle regole.
    nome: 'il brief vuoto, nemmeno confermabile',
    brief: briefVuoto,
    blocchi: 0,
    ok: false,
    pagine: { 1: 1, 2: 1, 3: 1, 10: 1 },
    missing: [
      ['business_name', 'block', 'hero', 'unlocks'],
      ['offerings', 'block', 'offerte', 'unlocks'],
      ['vertical', 'block', 'offerte', 'specializes'],
      ['description', 'block', 'chi-siamo', 'unlocks'],
      ['highlights', 'block', 'chi-siamo', 'unlocks'],
      ['hours', 'block', 'orari', 'unlocks'],
      ['address', 'block', 'contatti', 'unlocks'],
      ['phone', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'contatti', 'unlocks'],
      ['email', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
      ['hours', 'page', 'hours', 'unlocks'],
    ],
  },
  {
    // AC-215-1: il brief piu' povero che P1 considera completo. UN solo blocco (l'hero, che
    // esiste appena c'e' un nome) contro una soglia di quattro.
    nome: 'il brief piu povero che possa essere confirmed (AC-215-1)',
    brief: briefPoverissimo,
    blocchi: 1,
    ok: false,
    pagine: { 1: 1, 2: 1, 3: 1, 10: 1 },
    missing: [
      ['offerings', 'block', 'offerte', 'unlocks'],
      ['vertical', 'block', 'offerte', 'specializes'],
      ['description', 'block', 'chi-siamo', 'unlocks'],
      ['highlights', 'block', 'chi-siamo', 'unlocks'],
      ['hours', 'block', 'orari', 'unlocks'],
      ['address', 'block', 'contatti', 'unlocks'],
      ['phone', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'contatti', 'unlocks'],
      ['email', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
      ['hours', 'page', 'hours', 'unlocks'],
    ],
  },
  {
    // IL LATO BASSO DEL CONFINE della soglia: TRE blocchi. E' anche il brief che dice UNA COSA
    // SOLA (un numero di whatsapp) e che pero' sblocca DUE blocchi — il recapito e il bottone —
    // cioe' esattamente la misura da cui il valore quattro e' derivato.
    nome: 'povero + whatsapp: TRE blocchi, il lato basso della soglia',
    brief: () => piu(briefPoverissimo(), { whatsapp: '+39 340 0001112' }),
    blocchi: 3,
    ok: false,
    pagine: { 1: 1, 2: 1, 3: 1, 10: 1 },
    missing: [
      ['offerings', 'block', 'offerte', 'unlocks'],
      ['vertical', 'block', 'offerte', 'specializes'],
      ['description', 'block', 'chi-siamo', 'unlocks'],
      ['highlights', 'block', 'chi-siamo', 'unlocks'],
      ['hours', 'block', 'orari', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
      ['hours', 'page', 'hours', 'unlocks'],
    ],
  },
  {
    // IL LATO ALTO DELLO STESSO CONFINE: un solo campo in piu' (la descrizione) e i blocchi
    // diventano QUATTRO. E' il primo caso generabile del file, e il sito e' ancora una one-pager:
    // la generabilita' non e' il numero di pagine.
    nome: 'povero + whatsapp + description: QUATTRO blocchi, il lato alto della soglia',
    brief: () =>
      piu(briefPoverissimo(), { whatsapp: '+39 340 0001112', description: DESCRIZIONE }),
    blocchi: 4,
    ok: true,
    pagine: { 1: 1, 2: 1, 3: 1, 10: 1 },
    missing: [
      ['offerings', 'block', 'offerte', 'unlocks'],
      ['vertical', 'block', 'offerte', 'specializes'],
      ['hours', 'block', 'orari', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
      ['hours', 'page', 'hours', 'unlocks'],
    ],
  },
  {
    // IL CASO CHE DECIDE LA FORMA DI `missing`: con TRE offerte il BLOCCO 'offerte' esiste
    // (T-210, una voce basta) e la PAGINA 'offerings' no (T-213, ne chiede quattro). Il campo
    // `offerings` compare percio' UNA volta sola e nomina la PAGINA, non il blocco.
    nome: 'tre offerte: il blocco esiste, la pagina no',
    brief: () =>
      briefDa({
        business_name: 'Osteria del Ponte',
        primary_goal: 'prenota',
        description: DESCRIZIONE,
        offerings: TRE_OFFERTE,
        hours: ORARI,
        address: 'Via dei Mille 4, Bologna',
        highlights: TRE_EVIDENZE,
      }),
    blocchi: 6,
    ok: true,
    pagine: { 1: 1, 2: 1, 3: 3, 10: 3 },
    missing: [
      ['vertical', 'block', 'offerte', 'specializes'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
    ],
  },
  {
    // AC-215-3: il brief ricco che l'AC descrive. Il vertical non e' nominato dal given, quindi
    // resta 'altro' e compare in `missing` benche' il brief sia generabile.
    nome: 'il brief ricco di AC-215-3',
    brief: briefRiccoDellAc,
    blocchi: 6,
    ok: true,
    pagine: { 1: 1, 2: 1, 3: 3, 10: 4 },
    missing: [
      ['vertical', 'block', 'offerte', 'specializes'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
    ],
  },
  {
    // Il massimo raggiungibile: SETTE blocchi su otto, perche' 'recensioni' non e' soddisfacibile
    // da alcun Brief v1 (T-210). `missing` e' VUOTO, ed e' il ramo positivo senza il quale
    // l'elenco potrebbe essere una costante che nessun dato svuota.
    nome: 'il brief piu ricco costruibile (AC-215-5, variante con vertical scelto)',
    brief: briefRiccoMassimo,
    blocchi: 7,
    ok: true,
    pagine: { 1: 1, 2: 1, 3: 3, 10: 5 },
    missing: [],
  },
  {
    // AC-215-5: lo STESSO brief con vertical='altro'. Nulla cambia nei conteggi — il vertical non
    // e' la precondizione di alcun blocco — e cambia una sola voce di `missing`.
    nome: 'il piu ricco con vertical altro (AC-215-5, variante non scelta)',
    brief: () => piu(briefRiccoMassimo(), { vertical: 'altro' }),
    blocchi: 7,
    ok: true,
    pagine: { 1: 1, 2: 1, 3: 3, 10: 5 },
    missing: [['vertical', 'block', 'offerte', 'specializes']],
  },
  {
    // LE DUE SOGLIE SONO MISURE DIVERSE, e questo caso lo mostra invece di affermarlo: il set di
    // pagine e' MULTI-PAGINA (tre pagine, cioe' PAGES_MIN di T-213) e il brief NON e' generabile
    // (tre blocchi, sotto GENERATABLE_MIN_BLOCKS). Una soglia derivata dalle pagine direbbe di
    // si' qui.
    nome: 'tre pagine ma tre blocchi: le due soglie sono misure diverse',
    brief: () =>
      briefDa({
        business_name: 'Osteria del Ponte',
        primary_goal: 'prenota',
        offerings: QUATTRO_OFFERTE,
        hours: ORARI,
      }),
    blocchi: 3,
    ok: false,
    pagine: { 1: 1, 2: 1, 3: 3, 10: 3 },
    missing: [
      ['vertical', 'block', 'offerte', 'specializes'],
      ['description', 'block', 'chi-siamo', 'unlocks'],
      ['highlights', 'block', 'chi-siamo', 'unlocks'],
      ['address', 'block', 'contatti', 'unlocks'],
      ['phone', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'contatti', 'unlocks'],
      ['email', 'block', 'contatti', 'unlocks'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
    ],
  },
];

// Il numero di casi e' LETTERALE: e' la guardia di vacuita' dei cicli tabellari. Una tabella
// svuotata renderebbe vero senza ispezionare nulla ogni controllo che la percorre.
const NUMERO_DI_CASI = 9;

// Il numero TOTALE di voci di `missing` prodotte dai casi, LETTERALE: e' la guardia di vacuita'
// dell'oracolo di azionabilita', che itera sulle voci e non sui casi.
const VOCI_DI_MISSING_IN_TUTTO = 51;

// ── la soglia: da dove viene il numero ───────────────────────────────────────

describe('T-215 GENERATABLE_MIN_BLOCKS — la soglia e DERIVATA e pinnata dai due lati', () => {
  // IL VALORE E' LETTERALE, e la DERIVAZIONE e' misurata qui sotto invece di essere affermata nel
  // commento del modulo. Le due ancore:
  // (1) IL MASSIMO RAGGIUNGIBILE E' SETTE, non otto: il catalogo di T-210 ha otto voci e
  //     'recensioni' non e' soddisfacibile da alcun Brief v1. Una soglia sopra sette sarebbe una
  //     soglia che nessun brief puo' raggiungere.
  // (2) IL BRIEF CHE DICE UNA COSA SOLA arriva al piu' a TRE blocchi: l'hero (che c'e' per
  //     qualunque brief confermato, perche' il nome e' il minimo per esserlo) piu' i DUE che il
  //     campo `whatsapp` sblocca da solo — il recapito e il bottone. Ogni altro campo, da solo, ne
  //     sblocca al piu' uno. QUATTRO e' percio' il primo numero che pretende almeno DUE cose
  //     dette, ed e' questo che il gate deve distinguere: un sito che dice una cosa sola non vale
  //     una chiamata a pagamento.
  const MASSIMO_RAGGIUNGIBILE = 7;
  const MASSIMO_CON_UN_SOLO_CAMPO = 3;

  it('vale QUATTRO, e i due numeri da cui e derivata sono misurati qui', () => {
    expect(GENERATABLE_MIN_BLOCKS).toBe(4);
    // Il catalogo a monte ha OTTO voci (letterale: contarle su BLOCKS lo renderebbe vero per
    // costruzione anche su un catalogo svuotato).
    expect(BLOCKS).toHaveLength(8);
    // ...e il brief piu' ricco costruibile ne fa sopravvivere SETTE. La voce che manca e'
    // 'recensioni', nominata: e' il nodo che T-210 ha dichiarato invece di aggirare.
    const superstiti = idBlocchiSuperstiti(briefRiccoMassimo());
    expect(superstiti).toHaveLength(MASSIMO_RAGGIUNGIBILE);
    expect(superstiti).not.toContain('recensioni');
    expect(ID_DI_BLOCCO).toContain('recensioni');
    // La soglia e' RAGGIUNGIBILE (sotto il massimo) e non e' banale (sopra cio' che un solo
    // campo puo' dare). I due confronti sono i due lati della derivazione.
    expect(GENERATABLE_MIN_BLOCKS).toBeLessThanOrEqual(MASSIMO_RAGGIUNGIBILE);
    expect(GENERATABLE_MIN_BLOCKS).toBeGreaterThan(MASSIMO_CON_UN_SOLO_CAMPO);
    // E il MODULO conta gli stessi blocchi che l'ancora misura: senza questa riga il caso
    // giudicherebbe solo i cataloghi a monte e la costante — MISURATO nel passo rosso, era uno
    // dei sette che passavano sullo STUB INERTE.
    expect(
      generatable(briefRiccoMassimo(), { maxPages: SENZA_TETTO_DI_PIANO }).surviving_blocks,
    ).toBe(MASSIMO_RAGGIUNGIBILE);
  });

  it('nessun campo, da solo, porta il brief piu povero oltre TRE blocchi', () => {
    // LA MISURA DA CUI LA SOGLIA DERIVA, fatta invece che supposta: si parte dal brief piu' povero
    // CONFERMABILE (il pavimento vero di P2, che riceve solo brief confermati) e si aggiunge UN
    // campo per volta, uno solo. La tabella e' TOTALE PER TIPO sulle chiavi della patch di T-121:
    // un campo nuovo nel brief non compila finche' non gli si assegna qui un valore e non se ne
    // misura l'effetto, invece di entrare senza che nessuno guardi quanto sblocca.
    const UN_SOLO_CAMPO: Readonly<Record<CampoDelBrief, number>> = {
      business_name: 1,
      vertical: 1,
      description: 2,
      address: 2,
      geo: 1,
      hours: 2,
      phone: 2,
      whatsapp: 3,
      email: 2,
      primary_goal: 1,
      locale: 1,
      offerings: 2,
      social_links: 1,
      highlights: 2,
      brand_hints: 1,
    };

    const povero = briefPoverissimo();
    expect(idBlocchiSuperstiti(povero)).toEqual(['hero']);

    const campi = Object.keys(UN_SOLO_CAMPO) as CampoDelBrief[];
    // Quindici campi: la tabella copre TUTTA la patch di T-121, e il numero e' letterale perche'
    // derivarlo da `UN_SOLO_CAMPO` renderebbe la guardia vera per costruzione.
    expect(campi).toHaveLength(15);
    expect(new Set<string>(campi)).toEqual(new Set<string>(Object.keys(BriefUpdateSchema.shape)));

    for (const campo of campi) {
      const arricchito = piu(povero, { [campo]: VALORE_PER_CAMPO[campo] });
      const esito = generatable(arricchito, { maxPages: SENZA_TETTO_DI_PIANO });
      expect(idBlocchiSuperstiti(arricchito).length, campo).toBe(UN_SOLO_CAMPO[campo]);
      // Il MODULO conta gli stessi blocchi dell'ancora: senza questa riga il caso misurerebbe il
      // solo catalogo a monte e il `ok: false` qui sotto sarebbe vero anche su un modulo inerte
      // (MISURATO nel passo rosso: era uno dei sette che passavano sullo stub).
      expect(esito.surviving_blocks, campo).toBe(UN_SOLO_CAMPO[campo]);
      // E il gate dice NO a ciascuno di essi: nessun campo singolo rende generabile il brief piu'
      // povero. E' la proprieta', non il caso nominale.
      expect(esito.ok, campo).toBe(false);
    }

    // Il massimo della tabella e' TRE, ed e' `whatsapp` a raggiungerlo: e' l'unico campo che
    // sblocca due blocchi insieme, perche' il numero e' allo stesso tempo un recapito (la sezione
    // contatti) e la destinazione del bottone (la CTA).
    expect(Math.max(...Object.values(UN_SOLO_CAMPO))).toBe(MASSIMO_CON_UN_SOLO_CAMPO);
    expect(campi.filter((campo) => UN_SOLO_CAMPO[campo] === MASSIMO_CON_UN_SOLO_CAMPO)).toEqual([
      'whatsapp',
    ]);
  });

  it('la soglia e pinnata dai due lati con casi ADIACENTI che differiscono per UN campo', () => {
    // TRE blocchi (soglia meno uno) e QUATTRO blocchi (soglia), sullo stesso brief a meno di un
    // solo campo. Un caso solo per lato non distinguerebbe la soglia dal caso nominale: qui la
    // differenza fra il no e il si' e' una descrizione aggiunta.
    const sotto = piu(briefPoverissimo(), { whatsapp: '+39 340 0001112' });
    const sopra = piu(sotto, { description: DESCRIZIONE });

    const primo = generatable(sotto, { maxPages: SENZA_TETTO_DI_PIANO });
    const secondo = generatable(sopra, { maxPages: SENZA_TETTO_DI_PIANO });

    expect(primo.surviving_blocks).toBe(GENERATABLE_MIN_BLOCKS - 1);
    expect(primo.ok).toBe(false);
    expect(secondo.surviving_blocks).toBe(GENERATABLE_MIN_BLOCKS);
    expect(secondo.ok).toBe(true);
    // I due brief differiscono per UN SOLO campo, asserito e non affermato.
    expect(sotto.description).toBeUndefined();
    expect(secondo.surviving_blocks - primo.surviving_blocks).toBe(1);
    // E il blocco che entra e' quello che la voce di `missing` del primo prometteva.
    expect(come(primo.missing)).toContainEqual(['description', 'block', 'chi-siamo', 'unlocks']);
    expect(idBlocchiSuperstiti(sotto)).not.toContain('chi-siamo');
    expect(idBlocchiSuperstiti(sopra)).toContain('chi-siamo');
  });

  it('la soglia dei BLOCCHI e PAGES_MIN sono misure diverse, e i casi lo mostrano', () => {
    // NON deriva da un AC: e' la riga della DoD ("la soglia DERIVA dal numero di blocchi
    // superstiti, non da un conteggio di campi") vista dal lato che puo' confonderla con la sola
    // altra soglia del macrotask. PAGES_MIN vale sulle PAGINE, GENERATABLE_MIN_BLOCKS sui
    // BLOCCHI, e i due giudizi si separano nei due versi.
    //
    // Verso 1: generabile con UNA sola pagina (sotto PAGES_MIN).
    const unaPagina = piu(briefPoverissimo(), {
      whatsapp: '+39 340 0001112',
      description: DESCRIZIONE,
    });
    const conUnaPagina = generatable(unaPagina, { maxPages: SENZA_TETTO_DI_PIANO });
    expect(conUnaPagina.pages).toBe(1);
    expect(conUnaPagina.pages).toBeLessThan(PAGES_MIN);
    expect(conUnaPagina.ok).toBe(true);

    // Verso 2: NON generabile con TRE pagine (PAGES_MIN raggiunto).
    const trePagine = briefDa({
      business_name: 'Osteria del Ponte',
      primary_goal: 'prenota',
      offerings: QUATTRO_OFFERTE,
      hours: ORARI,
    });
    const conTrePagine = generatable(trePagine, { maxPages: SENZA_TETTO_DI_PIANO });
    expect(conTrePagine.pages).toBe(PAGES_MIN);
    expect(conTrePagine.surviving_blocks).toBe(3);
    expect(conTrePagine.ok).toBe(false);
  });
});

// ── AC-215-1 e AC-215-2 — il brief povero e la forma di `missing` ────────────

describe('T-215 generatable — il brief povero non vale una chiamata a pagamento', () => {
  // covers: AC-215-1
  it('col brief piu povero ok e false, i blocchi sono sotto la soglia e missing elenca description e offerings', () => {
    const povero = briefPoverissimo();
    // IL GIVEN E' ASSERITO, non assunto: sono valorizzati i tre campi che `isBriefComplete`
    // vincola davvero, e `vertical` e' al DEFAULT 'altro' — cioe' non e' una scelta.
    expect(povero.business_name).toBe('Osteria del Ponte'); // covers: AC-215-1
    expect(povero.primary_goal).toBe('contatta'); // covers: AC-215-1
    expect(povero.locale).toBe('it'); // covers: AC-215-1
    expect(povero.vertical).toBe('altro'); // covers: AC-215-1
    expect(povero.description).toBeUndefined(); // covers: AC-215-1
    expect(povero.content.offerings).toEqual([]); // covers: AC-215-1

    const esito = generatable(povero, { maxPages: SENZA_TETTO_DI_PIANO });

    expect(esito.ok).toBe(false); // covers: AC-215-1
    expect(esito.surviving_blocks).toBe(1); // covers: AC-215-1
    expect(esito.surviving_blocks).toBeLessThan(GENERATABLE_MIN_BLOCKS); // covers: AC-215-1
    // "missing elenca ALMENO description e offerings": i due campi sono nominati, e la voce
    // intera e' pinnata (campo, bersaglio, id, effetto) invece del solo nome del campo.
    expect(esito.missing.map((voce) => voce.field)).toContain('description'); // covers: AC-215-1
    expect(esito.missing.map((voce) => voce.field)).toContain('offerings'); // covers: AC-215-1
    expect(come(esito.missing)).toContainEqual(['description', 'block', 'chi-siamo', 'unlocks']); // covers: AC-215-1
    expect(come(esito.missing)).toContainEqual(['offerings', 'block', 'offerte', 'unlocks']); // covers: AC-215-1

    // IL RAMO POSITIVO, senza il quale `ok: false` potrebbe venire da una funzione che dice
    // sempre di no: lo STESSO brief arricchito e' generabile.
    const arricchito = piu(povero, {
      description: DESCRIZIONE,
      offerings: SEI_OFFERTE,
      hours: ORARI,
      address: 'Via dei Mille 4, Bologna',
    });
    expect(generatable(arricchito, { maxPages: SENZA_TETTO_DI_PIANO }).ok).toBe(true); // covers: AC-215-1
  });

  // covers: AC-215-2
  it('ogni voce nomina un campo del brief e un id che esiste nei cataloghi di T-210/T-213', () => {
    const esito = generatable(briefPoverissimo(), { maxPages: SENZA_TETTO_DI_PIANO });

    // Guardia di vacuita': senza queste righe il ciclo sarebbe vero su un elenco vuoto — che e'
    // esattamente cio' che restituiva lo STUB INERTE del passo rosso.
    expect(esito.missing.length, 'missing vuoto: il ciclo sarebbe vero per vacuita').toBe(12); // covers: AC-215-2
    // Gli insiemi ammessi sono DERIVATI dai cataloghi a monte, e non vuoti.
    expect(ID_DI_BLOCCO).toHaveLength(8); // covers: AC-215-2
    expect(ID_DI_PAGINA).toHaveLength(6); // covers: AC-215-2

    const campiDelBrief = new Set(Object.keys(BriefUpdateSchema.shape));
    expect(campiDelBrief.size).toBe(15); // covers: AC-215-2

    for (const voce of esito.missing) {
      const dove = `${voce.field}->${voce.kind}:${voce.id}`;
      // (a) il NOME DEL CAMPO esiste nello schema del brief (T-121): nessuna voce generica,
      //     nessun campo inventato.
      expect(campiDelBrief.has(voce.field), dove).toBe(true); // covers: AC-215-2
      expect(voce.field.length, dove).toBeGreaterThan(0); // covers: AC-215-2
      // (b) l'ID esiste nel catalogo GIUSTO, scelto dal `kind`: nessun id pendente. Il confronto
      //     e' per UGUAGLIANZA (Set.has) e mai per prefisso.
      const ammessi: readonly string[] = voce.kind === 'block' ? ID_DI_BLOCCO : ID_DI_PAGINA;
      expect(new Set(ammessi).has(voce.id), dove).toBe(true); // covers: AC-215-2
      // (c) l'EFFETTO e' uno dei due dichiarati: una voce senza verbo non direbbe cosa promette.
      expect(['unlocks', 'specializes'], dove).toContain(voce.effect); // covers: AC-215-2
    }
  });

  it('i due spazi di id NON sono lo stesso spazio: il kind decide quale catalogo interrogare', () => {
    // ORACOLO AGGIUNTIVO (non deriva da un AC): la guardia sul TERMINE DI CONFRONTO del caso
    // precedente. QUESTO CASO PASSA ANCHE SU UN MODULO INERTE, ed e' VOLUTO — misurato nel passo
    // rosso, era uno dei sette su 28: non chiama `generatable`, giudica i CATALOGHI A MONTE e la
    // forma del confronto che il caso precedente usa. La sua preda e' un futuro in cui i due
    // spazi di id si sovrappongano al punto da rendere indistinguibile un id di blocco da un
    // ruolo di pagina, cioe' in cui il controllo (b) diventi piu' debole senza che nulla lo dica.
    // Se i due cataloghi si potessero unire in un insieme solo, il controllo (b)
    // sarebbe piu' debole di quel che sembra e una voce di pagina che citasse un id di blocco
    // passerebbe indisturbata. Qui si misura che gli spazi si INTERSECANO in esattamente un id —
    // 'faq' e' insieme un blocco (T-210) e un ruolo di pagina (T-213) — quindi unirli sarebbe un
    // errore osservabile, e il `kind` non e' cerimonia.
    const comuni = ID_DI_BLOCCO.filter((id) => (ID_DI_PAGINA as readonly string[]).includes(id));
    expect(comuni).toEqual(['faq']);
    // E l'altra faccia della stessa cosa: uno stesso concetto ha nomi DIVERSI nei due cataloghi
    // (il blocco 'offerte' giustifica la pagina 'offerings'), quindi una voce che scambiasse i due
    // spazi sarebbe rossa in (b).
    expect(ID_DI_BLOCCO).toContain('offerte');
    expect(ID_DI_BLOCCO).not.toContain('offerings');
    expect(ID_DI_PAGINA).toContain('offerings');
    expect(ID_DI_PAGINA).not.toContain('offerte');

    // E DENTRO CIASCUN SPAZIO NESSUN ID E' PREFISSO DI UN ALTRO. E' la misura che dice quanto
    // vale davvero la scelta del modulo di confrontare per UGUAGLIANZA (`Set.has`) e mai per
    // prefisso — MISURATO, invece di vantarla: sostituendo quel confronto con uno scritto in
    // `startsWith` la suite resta VERDE, 28 su 28, perche' oggi la differenza non e'
    // COSTRUIBILE. La scelta e' presa in anticipo e dichiarata, non provata. Queste due coppie
    // di cicli diventano rosse il giorno in cui un id nuovo la rendera' osservabile, e allora
    // la decisione torna sul tavolo invece di restare implicita in un confronto lasco.
    expect(ID_DI_BLOCCO).toHaveLength(8);
    for (const uno of ID_DI_BLOCCO) {
      for (const altro of ID_DI_BLOCCO) {
        if (uno === altro) continue;
        expect(uno.startsWith(altro), `blocco ${uno} ha per prefisso ${altro}`).toBe(false);
      }
    }
    expect(ID_DI_PAGINA).toHaveLength(6);
    for (const uno of ID_DI_PAGINA) {
      for (const altro of ID_DI_PAGINA) {
        if (uno === altro) continue;
        expect(uno.startsWith(altro), `ruolo ${uno} ha per prefisso ${altro}`).toBe(false);
      }
    }
  });

  it('una voce per COPPIA (campo, bersaglio): il caso che rende la scelta osservabile', () => {
    // ORACOLO AGGIUNTIVO (non deriva da un AC): e' il NODO della forma di `missing`, e vive qui
    // perche' e' l'unico posto in cui si vede. Un campo puo' sbloccare PIU' di un bersaglio
    // (`offerings` sblocca il blocco 'offerte' e la pagina 'offerings'), e i due NON si sbloccano
    // insieme: T-210 fa esistere la sezione con UNA voce, T-213 chiede QUATTRO voci per la pagina.
    //
    // Con TRE offerte il blocco c'e' e la pagina no. Una voce PER CAMPO con piu' id avrebbe qui
    // due modi di sbagliare: sparire (e perdere la guida sulla pagina) oppure elencare anche
    // 'offerte' (e promettere di sbloccare cio' che e' gia' sbloccato). Una voce per COPPIA dice
    // la cosa vera: lavora ancora su `offerings`, e cio' che ne ottieni e' la PAGINA.
    const treOfferte = briefDa({
      business_name: 'Osteria del Ponte',
      primary_goal: 'prenota',
      description: DESCRIZIONE,
      offerings: TRE_OFFERTE,
      hours: ORARI,
      address: 'Via dei Mille 4, Bologna',
      highlights: TRE_EVIDENZE,
    });
    expect(treOfferte.content.offerings).toHaveLength(3);
    expect(idBlocchiSuperstiti(treOfferte)).toContain('offerte');
    expect(ruoliSuperstitiDi(treOfferte, SENZA_TETTO_DI_PIANO)).not.toContain('offerings');

    const conTre = generatable(treOfferte, { maxPages: SENZA_TETTO_DI_PIANO });
    const vociSuOfferings = come(conTre.missing).filter(([campo]) => campo === 'offerings');
    expect(vociSuOfferings).toEqual([['offerings', 'page', 'offerings', 'unlocks']]);

    // IL VERSO OPPOSTO, sullo stesso campo: con ZERO offerte le voci sono DUE, una per bersaglio,
    // ed e' la prova che la forma per coppia non e' una voce sola travestita.
    const senzaOfferte = briefPoverissimo();
    const conZero = come(generatable(senzaOfferte, { maxPages: SENZA_TETTO_DI_PIANO }).missing);
    expect(conZero.filter(([campo]) => campo === 'offerings')).toEqual([
      ['offerings', 'block', 'offerte', 'unlocks'],
      ['offerings', 'page', 'offerings', 'unlocks'],
    ]);

    // E il terzo stato: con SEI offerte il campo `offerings` sparisce del tutto da `missing`.
    const seiOfferte = piu(treOfferte, { offerings: SEI_OFFERTE });
    expect(seiOfferte.content.offerings).toHaveLength(6);
    const conSei = come(generatable(seiOfferte, { maxPages: SENZA_TETTO_DI_PIANO }).missing);
    expect(conSei.filter(([campo]) => campo === 'offerings')).toEqual([]);
  });
});

// ── AC-215-3 e AC-215-6 — il brief ricco e il tetto dei piani ────────────────

describe('T-215 generatable — il brief ricco e generabile, e il tetto di piano non lo nega', () => {
  // covers: AC-215-3
  it('col brief ricco ok e true, i blocchi superano la soglia e pages e il set derivato', () => {
    const ricco = briefRiccoDellAc();
    // IL GIVEN E' ASSERITO: descrizione, SEI offerte in DUE sezioni, orari, indirizzo, TRE
    // evidenze. Senza queste righe il caso proverebbe qualcosa su un brief qualunque.
    expect(ricco.description).toBe(DESCRIZIONE); // covers: AC-215-3
    expect(ricco.content.offerings).toHaveLength(6); // covers: AC-215-3
    expect(new Set(ricco.content.offerings.map((voce) => voce.section))).toEqual(
      new Set(['Antipasti', 'Primi']),
    ); // covers: AC-215-3
    expect(Object.keys(ricco.hours ?? {})).toHaveLength(2); // covers: AC-215-3
    expect(ricco.address).toBe('Via dei Mille 4, Bologna'); // covers: AC-215-3
    expect(ricco.content.highlights).toHaveLength(3); // covers: AC-215-3

    const esito = generatable(ricco, { maxPages: 10 });

    expect(esito.ok).toBe(true); // covers: AC-215-3
    expect(esito.surviving_blocks).toBe(6); // covers: AC-215-3
    expect(esito.surviving_blocks).toBeGreaterThanOrEqual(GENERATABLE_MIN_BLOCKS); // covers: AC-215-3
    // "pages riporta il numero di pagine del SET DERIVATO": il numero e' scritto a mano E
    // confrontato con cio' che `pagesFor` produce sullo stesso brief e sullo stesso tetto.
    expect(esito.pages).toBe(4); // covers: AC-215-3
    expect(esito.pages).toBe(pagesFor(ricco, { maxPages: 10 }).length); // covers: AC-215-3
  });

  // covers: AC-215-6
  it('con maxPages=1 il brief ricco resta generabile e pages e 1', () => {
    // Il tetto dei piani (il giunto verso P5) riduce le pagine ma NON puo' rendere non generabile
    // un sito: se lo facesse, un piano basso trasformerebbe un brief buono in un rifiuto e
    // l'utente leggerebbe "aggiungi dei dati" per un problema di listino.
    for (const ricco of [briefRiccoDellAc(), briefRiccoMassimo()]) {
      const conTetto = generatable(ricco, { maxPages: 1 });
      expect(conTetto.ok).toBe(true); // covers: AC-215-6
      expect(conTetto.pages).toBe(1); // covers: AC-215-6
      expect(conTetto.pages).toBe(pagesFor(ricco, { maxPages: 1 }).length); // covers: AC-215-6

      // E cio' che il tetto NON tocca: i blocchi superstiti e l'elenco di cio' che manca sono gli
      // stessi che senza tetto. E' la riga che impedisce a `missing` di chiedere all'utente di
      // scrivere altro per riparare un tetto commerciale.
      const senzaTetto = generatable(ricco, { maxPages: SENZA_TETTO_DI_PIANO });
      expect(conTetto.surviving_blocks).toBe(senzaTetto.surviving_blocks); // covers: AC-215-6
      expect(conTetto.missing).toEqual(senzaTetto.missing); // covers: AC-215-6
      // ...e il tetto FA la sua parte: senza di esso le pagine sono di piu'. Senza questa riga
      // l'uguaglianza qui sopra sarebbe vera anche in una funzione che ignora `maxPages`.
      expect(senzaTetto.pages).toBeGreaterThan(conTetto.pages); // covers: AC-215-6
    }
  });

  it('ne ok ne missing dipendono da maxPages, per ogni caso e ogni tetto', () => {
    // ORACOLO AGGIUNTIVO (generalizza AC-215-6 dal caso nominale alla PROPRIETA'): il tetto e' un
    // parametro del PIANO, e l'unica cosa che puo' cambiare e' `pages`. I tetti insensati sono
    // inclusi perche' `maxPages` e' un `number` e la funzione e' pura: chiunque puo' chiamarla.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );

    for (const caso of CASI) {
      const brief = caso.brief();
      const riferimento = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
      for (const tetto of [0, 1, 2, 3, 5, 2.5, -7, Number.NaN, Number.POSITIVE_INFINITY]) {
        const esito = generatable(brief, { maxPages: tetto });
        expect(esito.ok, `${caso.nome}/tetto=${tetto}`).toBe(riferimento.ok);
        expect(esito.surviving_blocks, `${caso.nome}/tetto=${tetto}`).toBe(
          riferimento.surviving_blocks,
        );
        expect(come(esito.missing), `${caso.nome}/tetto=${tetto}`).toEqual(come(riferimento.missing));
        // E `pages` non supera mai il tetto chiesto: la sola eccezione dichiarata e' la home, che
        // resta anche sotto un tetto insensato (T-213).
        expect(esito.pages, `${caso.nome}/tetto=${tetto}`).toBeGreaterThanOrEqual(1);
        expect(esito.pages, `${caso.nome}/tetto=${tetto}`).toBeLessThanOrEqual(
          Math.max(1, Number.isNaN(tetto) ? 1 : Math.floor(tetto)),
        );
      }
    }
  });
});

// ── AC-215-4 — P2 non poggia sulla soglia di P1 ──────────────────────────────

describe('T-215 generatable e isBriefComplete sono due nozioni DISTINTE (AC-215-4)', () => {
  // covers: AC-215-4
  it('un brief che isBriefComplete accetta puo NON essere generabile', () => {
    // IL CARRY-OVER DI P1 CHE QUESTO CASO CHIUDE (P1 §7 p.1): `isBriefComplete` verifica la
    // PRESENZA e non la PROVENIENZA, ed e' aggirabile in un solo turno da un modello sotto
    // injection. Il gate che decide se spendere una chiamata a pagamento non deve poggiare su di
    // essa — e qui si misura che non ci poggia, invece di dichiararlo nel commento del modulo.
    //
    // DUE brief, non uno: il primo e' il minimo che P1 accetta, il secondo ha anche un recapito
    // (tre blocchi superstiti) e resta comunque sotto la soglia. Un caso solo non distinguerebbe
    // "le due nozioni sono diverse" da "generatable e' piu' severo di un blocco".
    const casi: readonly { readonly nome: string; readonly brief: Brief }[] = [
      { nome: 'il minimo che P1 accetta', brief: briefPoverissimo() },
      {
        nome: 'il minimo piu un recapito',
        brief: piu(briefPoverissimo(), { whatsapp: '+39 340 0001112' }),
      },
    ];

    for (const caso of casi) {
      // Il given, asserito voce per voce: descrizione, offerte, orari, indirizzo ed evidenze sono
      // tutti VUOTI, come chiede AC-215-4.
      expect(caso.brief.description, caso.nome).toBeUndefined(); // covers: AC-215-4
      expect(caso.brief.content.offerings, caso.nome).toEqual([]); // covers: AC-215-4
      expect(caso.brief.hours, caso.nome).toBeUndefined(); // covers: AC-215-4
      expect(caso.brief.address, caso.nome).toBeUndefined(); // covers: AC-215-4
      expect(caso.brief.content.highlights, caso.nome).toEqual([]); // covers: AC-215-4

      expect(isBriefComplete(caso.brief), caso.nome).toBe(true); // covers: AC-215-4
      expect(generatable(caso.brief, { maxPages: SENZA_TETTO_DI_PIANO }).ok, caso.nome).toBe(false); // covers: AC-215-4
    }

    // IL RAMO POSITIVO, senza il quale la distinzione sarebbe soltanto "generatable dice sempre
    // di no": sul brief ricco le DUE nozioni concordano.
    const ricco = briefRiccoMassimo();
    expect(isBriefComplete(ricco)).toBe(true); // covers: AC-215-4
    expect(generatable(ricco, { maxPages: SENZA_TETTO_DI_PIANO }).ok).toBe(true); // covers: AC-215-4
  });

  // covers: AC-215-4
  it('isBriefComplete vincola davvero solo DUE campi: la misura che motiva AC-215-4', () => {
    // La frase di P1 §7 p.1 ("vincola davvero solo due campi") e' MISURATA qui invece di essere
    // citata: `vertical` ha un default e `locale` e' richiesto dallo schema, quindi su qualunque
    // brief costruito dal dominio sono sempre valorizzati. Cio' che resta a fare da soglia e'
    // `business_name` e `primary_goal` — due campi di testo che un modello sotto injection scrive
    // in un turno.
    const vuoto = emptyBrief('it');
    expect(vuoto.vertical).toBe('altro'); // covers: AC-215-4
    expect(vuoto.locale).toBe('it'); // covers: AC-215-4
    expect(isBriefComplete(vuoto)).toBe(false); // covers: AC-215-4

    const conNome = piu(vuoto, { business_name: 'Osteria del Ponte' });
    expect(isBriefComplete(conNome)).toBe(false); // covers: AC-215-4
    const conScopo = piu(conNome, { primary_goal: 'contatta' });
    expect(isBriefComplete(conScopo)).toBe(true); // covers: AC-215-4

    // DUE campi hanno ribaltato il giudizio di P1; gli stessi due lasciano il giudizio di P2 dov'era.
    expect(generatable(vuoto, { maxPages: SENZA_TETTO_DI_PIANO }).ok).toBe(false); // covers: AC-215-4
    expect(generatable(conScopo, { maxPages: SENZA_TETTO_DI_PIANO }).ok).toBe(false); // covers: AC-215-4
    // ...e cio' che P2 chiede al loro posto e' MISURATO qui, invece di lasciare il caso con il
    // solo ramo negativo: sono i BLOCCHI a muoversi, e il giudizio si ribalta quando si muovono
    // abbastanza. Senza queste due righe il caso passava sullo STUB INERTE (misurato nel passo
    // rosso: era uno dei sette su 28).
    expect(generatable(conScopo, { maxPages: SENZA_TETTO_DI_PIANO }).surviving_blocks).toBe(1); // covers: AC-215-4
    expect(generatable(briefRiccoMassimo(), { maxPages: SENZA_TETTO_DI_PIANO }).ok).toBe(true); // covers: AC-215-4
  });
});

// ── AC-215-5 — 'altro' non conta come vertical scelto ───────────────────────

describe("T-215 vertical uguale ad 'altro' e riportato come NON scelto (AC-215-5)", () => {
  // covers: AC-215-5
  it('lo stesso brief in due varianti: nel primo missing include vertical, nel secondo no', () => {
    // Le due varianti differiscono per il SOLO vertical: ogni altra differenza renderebbe il
    // confronto una coincidenza.
    const scelto = briefRiccoMassimo();
    const nonScelto = piu(scelto, { vertical: 'altro' });
    expect(scelto.vertical).toBe('ristorazione'); // covers: AC-215-5
    expect(nonScelto.vertical).toBe('altro'); // covers: AC-215-5
    expect({ ...nonScelto, vertical: 'ristorazione' }).toEqual(scelto); // covers: AC-215-5

    const conAltro = generatable(nonScelto, { maxPages: SENZA_TETTO_DI_PIANO });
    const conScelta = generatable(scelto, { maxPages: SENZA_TETTO_DI_PIANO });

    expect(conAltro.missing.map((voce) => voce.field)).toContain('vertical'); // covers: AC-215-5
    expect(conScelta.missing.map((voce) => voce.field)).not.toContain('vertical'); // covers: AC-215-5
    // La voce INTERA, non il solo nome del campo: nomina il blocco 'offerte' — l'unico che il
    // vertical tocca (T-210, `resolveOfferings`) — e dichiara di SPECIALIZZARLO, non di
    // sbloccarlo. Dire "unlocks" qui sarebbe falso: il blocco 'offerte' nasce dalle offerte, non
    // dal vertical, e questo file non vende una copertura che non esiste.
    expect(come(conAltro.missing)).toEqual([['vertical', 'block', 'offerte', 'specializes']]); // covers: AC-215-5
    expect(come(conScelta.missing)).toEqual([]); // covers: AC-215-5

    // E il resto del giudizio NON cambia: il vertical non e' la precondizione di nulla.
    expect(conAltro.ok).toBe(conScelta.ok); // covers: AC-215-5
    expect(conAltro.surviving_blocks).toBe(conScelta.surviving_blocks); // covers: AC-215-5
    expect(conAltro.pages).toBe(conScelta.pages); // covers: AC-215-5
  });

  // covers: AC-215-5
  it('la voce del vertical compare per OGNI brief con altro e per NESSUN brief con un vertical scelto', () => {
    // La PROPRIETA' invece del caso nominale: su tutti i casi della tabella, e sui quattro
    // verticali veri, e non solo sul brief piu' ricco. I quattro sono NOMINATI a mano — derivarli
    // dall'enum di T-121 renderebbe il ciclo cieco proprio a un'aggiunta non decisa.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    let conAltroVisti = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      const campi = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO }).missing.map(
        (voce) => voce.field,
      );
      if (brief.vertical === 'altro') {
        expect(campi, caso.nome).toContain('vertical'); // covers: AC-215-5
        conAltroVisti += 1;
      } else {
        expect(campi, caso.nome).not.toContain('vertical'); // covers: AC-215-5
      }

      for (const vertical of ['ristorazione', 'fitness', 'salone_studio', 'negozio_artigiano']) {
        const scelto = piu(brief, { vertical });
        expect(
          generatable(scelto, { maxPages: SENZA_TETTO_DI_PIANO }).missing.map((voce) => voce.field),
          `${caso.nome}/${vertical}`,
        ).not.toContain('vertical'); // covers: AC-215-5
      }
    }

    // Guardia di vacuita' col numero LETTERALE: otto dei nove casi hanno il vertical al default.
    expect(conAltroVisti).toBe(8); // covers: AC-215-5
  });
});

// ── la tabella: il giudizio completo, caso per caso ─────────────────────────

describe('T-215 ogni caso dichiarato produce ESATTAMENTE il giudizio atteso', () => {
  // covers: AC-215-1, AC-215-3, AC-215-5, AC-215-6
  it('blocchi, ok, pagine a ogni tetto e missing coincidono con la tabella scritta a mano', () => {
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    expect(TETTI).toHaveLength(4);

    for (const caso of CASI) {
      const brief = caso.brief();

      for (const tetto of TETTI) {
        const esito = generatable(brief, { maxPages: tetto });
        const dove = `${caso.nome}/tetto=${tetto}`;

        expect(esito.surviving_blocks, dove).toBe(caso.blocchi);
        expect(esito.ok, dove).toBe(caso.ok);
        expect(esito.pages, dove).toBe(caso.pagine[tetto]);
        // L'elenco INTERO, in ORDINE: pinna insieme quali voci ci sono, quali non ci sono, e la
        // sequenza in cui compaiono. Un confronto fra insiemi lascerebbe senza giudice un
        // riordino, che e' l'ordine in cui l'utente leggera' i suggerimenti (T-230).
        expect(come(esito.missing), dove).toEqual(caso.missing.map((voce) => [...voce]));
      }

      // LE PROPRIETA' che valgono per OGNI caso, e non un altro caso nominale:
      const esito = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
      // - `ok` e' ESATTAMENTE il confronto fra i blocchi superstiti e la soglia: nessun altro
      //   ingrediente (le pagine, i campi, la completezza di P1) entra nel giudizio;
      expect(esito.ok, caso.nome).toBe(esito.surviving_blocks >= GENERATABLE_MIN_BLOCKS);
      // - i conteggi sono interi non negativi e stanno nei limiti dei cataloghi a monte;
      expect(Number.isInteger(esito.surviving_blocks), caso.nome).toBe(true);
      expect(esito.surviving_blocks, caso.nome).toBeGreaterThanOrEqual(0);
      expect(esito.surviving_blocks, caso.nome).toBeLessThanOrEqual(BLOCKS.length);
      expect(esito.pages, caso.nome).toBeGreaterThanOrEqual(1);
      expect(esito.pages, caso.nome).toBeLessThanOrEqual(PAGE_CATALOG.length);
      // - nessuna voce di `missing` e' duplicata: la coppia (campo, bersaglio) e' l'identita' di
      //   una voce, e la stessa promessa fatta due volte sarebbe rumore in T-230.
      const chiavi = esito.missing.map((voce) => `${voce.field}|${voce.kind}|${voce.id}`);
      expect(new Set(chiavi).size, caso.nome).toBe(chiavi.length);
    }
  });

  it('i casi esercitano TUTTO il catalogo dei blocchi e TUTTI i ruoli di pagina soddisfacibili', () => {
    // ORACOLO AGGIUNTIVO (non deriva da un AC): la guardia sulla COPERTURA della tabella. Senza di
    // essa un blocco o una pagina potrebbero non comparire in nessun caso, e ogni asserzione di
    // questo file resterebbe verde ignorandoli. Gli attesi sono DERIVATI dai cataloghi a monte
    // meno le due voci che nessun Brief v1 puo' soddisfare, che sono NOMINATE.
    //
    // QUESTO CASO PASSA ANCHE SU UN MODULO INERTE, ed e' VOLUTO — misurato nel passo rosso, era
    // uno dei sette su 28: non chiama `generatable`, giudica le FIXTURE di questo file contro i
    // cataloghi a monte. La sua preda e' un ritocco futuro alla tabella dei casi che smetta di
    // esercitare un blocco o un ruolo, lasciando verdi tutti gli altri controlli su meno materia.
    const blocchiVisti = new Set<string>();
    const ruoliVisti = new Set<PageRole>();
    for (const caso of CASI) {
      const brief = caso.brief();
      for (const id of idBlocchiSuperstiti(brief)) blocchiVisti.add(id);
      for (const ruolo of ruoliSuperstitiDi(brief, SENZA_TETTO_DI_PIANO)) ruoliVisti.add(ruolo);
    }

    expect(blocchiVisti).toEqual(new Set(ID_DI_BLOCCO.filter((id) => id !== 'recensioni')));
    expect(blocchiVisti.size).toBe(7);
    expect(ruoliVisti).toEqual(new Set(ID_DI_PAGINA.filter((ruolo) => ruolo !== 'reviews')));
    expect(ruoliVisti.size).toBe(5);
  });
});

// ── oracolo AGGIUNTIVO 1 — il modulo non importa isBriefComplete ────────────

describe('T-215 oracoli aggiuntivi — il modulo NON importa isBriefComplete', () => {
  // E' una riga della DEFINITION OF DONE, quindi va ASSERITA e non sperata: si legge il SORGENTE
  // del modulo, come tests/supabase-clients.test.ts pinna la direttiva 'server-only'. NB: QUESTO
  // FILE invece lo importa — gli serve per AC-215-4 — e la differenza e' tutto il punto: il
  // termine di paragone puo' conoscerlo, il gate no.
  //
  // PERCHE' NON BASTA CHE IL TESTO NON CONTENGA IL NOME: il commento in testa al modulo DEVE
  // poterlo nominare, perche' e' li' che la decisione (e la ragione di sicurezza che la motiva)
  // e' scritta. L'oracolo guarda percio' due cose distinte: gli IMPORT, e il CODICE privato dei
  // commenti.
  const PERCORSO = 'src/domain/generation/generatable.ts';
  const SORGENTE = readFileSync(resolve(process.cwd(), PERCORSO), 'utf8');

  /** Le istruzioni di import, anche su piu' righe. */
  const IMPORT = SORGENTE.match(/^\s*import\b[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm) ?? [];

  /** Il sorgente PRIVATO DEI COMMENTI: e' li' che un uso reale del nome dovrebbe comparire. */
  const CODICE = SORGENTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('nessuna istruzione di import nomina isBriefComplete, e gli import veri sono stati letti', () => {
    // La guardia di vacuita' PRIMA dell'asserzione: un'estrazione che non trovasse nulla
    // renderebbe vero il controllo su qualunque modulo. Il numero e' letterale e gli import
    // attesi sono NOMINATI: e' il ramo positivo dell'estrazione.
    expect(IMPORT.length, 'nessun import estratto: il controllo sarebbe vero per vacuita').toBe(4);
    const tutti = IMPORT.join('\n');
    expect(tutti).toContain('blocksFor');
    expect(tutti).toContain('pagesFor');
    expect(tutti).toContain('@/domain/onboarding/brief');
    // Il QUARTO import, che la guardia non nominava: il conteggio a quattro e i tre nomi
    // lasciavano verde una sostituzione di questo con un altro modulo.
    expect(tutti).toContain('@/domain/generation/slots');

    for (const istruzione of IMPORT) {
      expect(istruzione.includes('isBriefComplete'), istruzione).toBe(false);
    }
  });

  it('il nome non compare nel CODICE, e compare nel COMMENTO che dichiara la decisione', () => {
    // Il verso forte: nemmeno un uso dinamico o una riesportazione. E insieme il controllo che lo
    // spogliatore di commenti non abbia mangiato il file — senza il quale l'assenza sarebbe vera
    // per costruzione.
    expect(CODICE).toContain('export function generatable');
    expect(CODICE).toContain('GENERATABLE_MIN_BLOCKS');
    expect(CODICE).toContain('blocksFor');
    expect(CODICE.includes('isBriefComplete')).toBe(false);
    // Il modulo DEVE dichiarare la decisione dove si legge: nel commento. Se qualcuno togliesse
    // la spiegazione, questa riga chiede di rimetterla invece di lasciare la scelta implicita.
    expect(SORGENTE).toContain('isBriefComplete');
  });
});

// ── oracolo AGGIUNTIVO 2 e 3 — coerenza con pagesFor e con blocksFor ────────

describe('T-215 oracoli aggiuntivi — i due conteggi vengono dai contratti a monte', () => {
  it('pages e ESATTAMENTE cio che pagesFor produce, su piu brief e piu tetti', () => {
    // Se `generatable` ricalcolasse il numero di pagine per conto proprio ci sarebbero DUE verita'
    // sulla stessa cosa, e i due numeri divergerebbero in silenzio il giorno in cui T-213 cambia
    // una soglia. L'uguaglianza qui e' la guardia di regressione; i numeri LETTERALI della tabella
    // dei casi sono cio' che rende l'oracolo non vacuo (un'uguaglianza fra due chiamate della
    // stessa funzione sarebbe vera anche se entrambe sbagliassero).
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    let confronti = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      for (const tetto of [0, 1, 2, 3, 4, 5, 2.5, Number.NaN, SENZA_TETTO_DI_PIANO]) {
        const esito = generatable(brief, { maxPages: tetto });
        expect(esito.pages, `${caso.nome}/tetto=${tetto}`).toBe(
          pagesFor(brief, { maxPages: tetto }).length,
        );
        confronti += 1;
      }
    }
    expect(confronti).toBe(81);

    // E i due numeri si MUOVONO insieme: sul brief piu' ricco il tetto li cambia entrambi negli
    // stessi punti. Senza questa riga l'uguaglianza sarebbe soddisfatta anche da due costanti.
    const ricco = briefRiccoMassimo();
    const perTetto = [1, 2, 3, 4, 5, 10].map((tetto) => generatable(ricco, { maxPages: tetto }).pages);
    expect(perTetto).toEqual([1, 1, 3, 4, 5, 5]);
    expect(perTetto).toEqual(
      [1, 2, 3, 4, 5, 10].map((tetto) => pagesFor(ricco, { maxPages: tetto }).length),
    );
  });

  it('surviving_blocks e ESATTAMENTE il numero di blocchi che T-210 fa sopravvivere', () => {
    // Stessa ragione: un conteggio parallelo divergerebbe dal catalogo il giorno in cui una
    // precondizione cambia. Il termine di confronto e' `blocksFor`, cioe' il contratto a monte.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );

    for (const caso of CASI) {
      const brief = caso.brief();
      const superstiti = idBlocchiSuperstiti(brief);
      expect(generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO }).surviving_blocks, caso.nome).toBe(
        superstiti.length,
      );
      // ...e i numeri della tabella non sono tutti uguali fra loro: senza questa varieta'
      // l'uguaglianza sarebbe soddisfatta anche da due costanti.
      expect(superstiti.length, caso.nome).toBe(caso.blocchi);
    }
    expect(new Set(CASI.map((caso) => caso.blocchi)).size).toBeGreaterThan(3);
  });

  it("OGNI blocco del catalogo dichiara il ruolo 'home': e cio che rende il conteggio completo", () => {
    // L'INVARIANTE DI T-210 SU CUI POGGIA LA LETTURA, pinnato qui come lo pinna il file di T-213 e
    // per la stessa ragione: `surviving_blocks` conta i blocchi superstiti CHIEDENDOLI PER IL
    // RUOLO 'home'. Finche' ogni blocco dichiara quel ruolo, quel conteggio e' il conteggio di
    // TUTTI i blocchi soddisfatti. Il giorno in cui un blocco perdesse 'home', questa riga
    // diventa rossa e la lettura va rimisurata invece di restare una nota vecchia.
    //
    // QUESTO CASO PASSA ANCHE SU UN MODULO INERTE, ed e' VOLUTO — misurato nel passo rosso, era
    // uno dei sette su 28: giudica l'INVARIANTE DEL CATALOGO A MONTE su cui la lettura poggia,
    // non il modulo. Che il modulo la usi davvero e' asserito dai due casi qui sopra.
    expect(BLOCKS, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(8);
    for (const blocco of BLOCKS) {
      expect(blocco.page_roles, blocco.id).toContain('home');
    }
    // E la conseguenza, misurata sul brief piu' ricco: i blocchi soddisfatti per la home sono
    // tutti quelli soddisfatti, quindi il conteggio non e' un sottoinsieme travestito.
    const ricco = briefRiccoMassimo();
    expect(idBlocchiSuperstiti(ricco)).toEqual(
      BLOCKS.filter((blocco) => blocco.precondition(ricco)).map((blocco) => blocco.id),
    );
  });
});

// ── oracolo AGGIUNTIVO 4 — monotonia ────────────────────────────────────────

describe('T-215 oracoli aggiuntivi — aggiungere un dato non fa MAI calare i blocchi', () => {
  // E' la proprieta' che rende `missing` una guida utile ("aggiungi questo e sblocchi quello")
  // invece di una promessa che il codice non mantiene: se aggiungere un dato potesse far calare i
  // superstiti, un utente che segue i suggerimenti potrebbe allontanarsi dalla generabilita'.
  //
  // LA CATENA E' CRESCENTE PER COSTRUZIONE (ogni passo aggiunge un campo e non ne toglie nessuno)
  // e i conteggi attesi sono scritti a mano: la monotonia da sola sarebbe soddisfatta anche da una
  // funzione che restituisce sempre zero.
  const CATENA: readonly {
    readonly nome: string;
    readonly patch: Record<string, unknown>;
    readonly blocchi: number;
    readonly voci: number;
  }[] = [
    { nome: 'povero', patch: {}, blocchi: 1, voci: 12 },
    { nome: '+whatsapp', patch: { whatsapp: '+39 340 0001112' }, blocchi: 3, voci: 7 },
    { nome: '+description', patch: { description: DESCRIZIONE }, blocchi: 4, voci: 5 },
    { nome: '+offerte', patch: { offerings: SEI_OFFERTE }, blocchi: 6, voci: 3 },
    { nome: '+orari', patch: { hours: ORARI }, blocchi: 7, voci: 1 },
    { nome: '+indirizzo', patch: { address: 'Via dei Mille 4, Bologna' }, blocchi: 7, voci: 1 },
    { nome: '+evidenze', patch: { highlights: TRE_EVIDENZE }, blocchi: 7, voci: 1 },
  ];

  it('lungo una catena di brief crescenti i blocchi salgono o restano, e missing cala o resta', () => {
    expect(CATENA, 'catena vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(7);
    let brief = briefPoverissimo();
    let precedenti = -1;
    let vociPrecedenti = Number.POSITIVE_INFINITY;

    for (const passo of CATENA) {
      brief = piu(brief, passo.patch);
      const esito = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });

      // I VALORI ATTESI, scritti a mano: sono cio' che distingue la monotonia da una costante.
      expect(esito.surviving_blocks, passo.nome).toBe(passo.blocchi);
      expect(esito.missing.length, passo.nome).toBe(passo.voci);
      // LA PROPRIETA': non cala mai, e l'elenco di cio' che manca non cresce mai.
      expect(esito.surviving_blocks, passo.nome).toBeGreaterThanOrEqual(precedenti);
      expect(esito.missing.length, passo.nome).toBeLessThanOrEqual(vociPrecedenti);
      // E `ok`, una volta acceso, non si spegne piu' lungo la catena: e' la stessa monotonia letta
      // sul giudizio invece che sul conteggio.
      if (precedenti >= GENERATABLE_MIN_BLOCKS) expect(esito.ok, passo.nome).toBe(true);

      precedenti = esito.surviving_blocks;
      vociPrecedenti = esito.missing.length;
    }

    // La catena SALE davvero: senza questa riga la monotonia sarebbe vera anche su una catena
    // piatta, e il ciclo non proverebbe nulla.
    expect(precedenti).toBe(7);
    expect(CATENA[0].blocchi).toBe(1);
  });

  it('la monotonia vale per OGNI campo aggiunto a OGNI caso, non solo lungo una catena', () => {
    // La PROPRIETA' invece del solo cammino scelto: si aggiunge UN campo per volta a OGNI caso
    // della tabella e si chiede che nulla cali. Sono quindici campi per nove casi, cioe' il
    // reticolo attorno a ciascun caso invece di una linea sola.
    //
    // LA MONOTONIA DA SOLA E' SODDISFATTA DA UNA COSTANTE — misurato nel passo rosso: questo caso
    // era uno dei sette su 28 che passavano sullo STUB INERTE, che restituisce zero per ogni
    // brief. Le due guardie che lo rendono non vacuo sono percio' LETTERALI: il conteggio di
    // partenza di ogni caso viene dalla tabella scritta a mano, e gli AUMENTI STRETTI del
    // reticolo sono contati e pinnati.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    let confronti = 0;
    let aumenti = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      const prima = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
      expect(prima.surviving_blocks, caso.nome).toBe(caso.blocchi);
      for (const campo of Object.keys(VALORE_PER_CAMPO) as CampoDelBrief[]) {
        const dopo = generatable(piu(brief, { [campo]: VALORE_PER_CAMPO[campo] }), {
          maxPages: SENZA_TETTO_DI_PIANO,
        });
        expect(dopo.surviving_blocks, `${caso.nome}/+${campo}`).toBeGreaterThanOrEqual(
          prima.surviving_blocks,
        );
        expect(dopo.missing.length, `${caso.nome}/+${campo}`).toBeLessThanOrEqual(
          prima.missing.length,
        );
        if (dopo.surviving_blocks > prima.surviving_blocks) aumenti += 1;
        confronti += 1;
      }
    }
    expect(confronti).toBe(135);
    // TRENTATRE aumenti stretti sui 135 confronti, contati a mano caso per caso (9+8+4+4+1+1+0+0+6
    // nell'ordine della tabella): e' il numero che distingue un reticolo che sale davvero da una
    // funzione piatta. I casi ricchi contribuiscono poco ed e' giusto cosi' — a sette blocchi non
    // c'e' piu' nulla da sbloccare, perche' l'ottavo e' 'recensioni'.
    expect(aumenti).toBe(33);
  });
});

// ── oracolo AGGIUNTIVO 5 — ogni voce di missing e AZIONABILE ────────────────

describe('T-215 oracoli aggiuntivi — ogni voce di missing e una promessa VERIFICATA', () => {
  it('valorizzare il campo di una voce fa davvero sopravvivere quel blocco o quella pagina', () => {
    // E' IL VERSO CHE TRASFORMA `missing` DA ELENCO DESCRITTIVO A PROMESSA: un oracolo debole si
    // sarebbe fermato a "l'id esiste nel catalogo" (AC-215-2), che e' vero anche per una voce che
    // suggerisce il campo sbagliato. Qui, per OGNI voce di OGNI caso, si valorizza QUEL campo e si
    // chiede che QUEL bersaglio compaia — e che PRIMA non ci fosse.
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    let vociVerificate = 0;
    let sbloccate = 0;
    let specializzate = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      const esito = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
      const blocchiPrima = idBlocchiSuperstiti(brief);
      const ruoliPrima = ruoliSuperstitiDi(brief, SENZA_TETTO_DI_PIANO);

      for (const voce of esito.missing) {
        const dove = `${caso.nome}: ${voce.field}->${voce.kind}:${voce.id}`;
        const arricchito = piu(brief, { [voce.field]: VALORE_PER_CAMPO[voce.field] });

        if (voce.effect === 'unlocks') {
          if (voce.kind === 'block') {
            // PRIMA non c'era (e' la ragione per cui la voce e' stata emessa)...
            expect(blocchiPrima, dove).not.toContain(voce.id);
            // ...e DOPO c'e'.
            expect(idBlocchiSuperstiti(arricchito), dove).toContain(voce.id);
          } else {
            expect(ruoliPrima, dove).not.toContain(voce.id);
            expect(ruoliSuperstitiDi(arricchito, SENZA_TETTO_DI_PIANO), dove).toContain(voce.id);
          }
          sbloccate += 1;
        } else {
          // 'specializes' e' l'altro verbo, e la promessa e' DIVERSA: il bersaglio non nasce e non
          // muore per questo campo — cambia. L'unica voce di questa forma e' quella del vertical,
          // e cio' che deve cambiare e' la variante del blocco 'offerte' (T-210).
          expect(voce.field, dove).toBe('vertical');
          expect(voce.id, dove).toBe('offerte');
          const prima = resolveOfferings(brief);
          const dopo = resolveOfferings(arricchito);
          expect(dopo.label_key, dove).not.toBe(prima.label_key);
          expect(dopo.layout, dove).not.toBe(prima.layout);
          expect(prima.label_key, dove).toBe('site.offerings.generic');
          specializzate += 1;
        }
        vociVerificate += 1;
      }
    }

    // Le guardie di vacuita' col numero LETTERALE: il ciclo itera sulle VOCI, quindi un elenco
    // svuotato lo renderebbe vero senza guardare nulla. E le due forme sono esercitate ENTRAMBE.
    expect(vociVerificate).toBe(VOCI_DI_MISSING_IN_TUTTO);
    expect(sbloccate).toBe(43);
    expect(specializzate).toBe(8);
  });

  it('un campo che NON compare in missing non avrebbe sbloccato nulla di nuovo', () => {
    // IL VERSO OPPOSTO, senza il quale `missing` potrebbe essere onesto e INCOMPLETO: per ogni
    // caso si prova ogni campo che l'elenco NON nomina e si chiede che aggiungerlo non faccia
    // nascere ne' un blocco ne' una pagina. Cio' che resta fuori e' dichiarato: i due bersagli che
    // nessun campo singolo sblocca (le materie della FAQ e il secondo recapito della pagina
    // contatti), che sono le eccezioni scritte nella copertura dichiarata in testa al file.
    const ECCEZIONI_DICHIARATE = new Set<string>(['faq', 'contact']);
    expect(CASI, 'tabella vuota o ridotta: il ciclo sarebbe vero per vacuita').toHaveLength(
      NUMERO_DI_CASI,
    );
    let campiProvati = 0;
    let eccezioniIncontrate = 0;

    for (const caso of CASI) {
      const brief = caso.brief();
      const esito = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
      const nominati = new Set(esito.missing.map((voce) => voce.field));
      const blocchiPrima = new Set(idBlocchiSuperstiti(brief));
      const ruoliPrima = new Set(ruoliSuperstitiDi(brief, SENZA_TETTO_DI_PIANO));

      for (const campo of Object.keys(VALORE_PER_CAMPO) as CampoDelBrief[]) {
        if (nominati.has(campo)) continue;
        const arricchito = piu(brief, { [campo]: VALORE_PER_CAMPO[campo] });
        const nuoviBlocchi = idBlocchiSuperstiti(arricchito).filter((id) => !blocchiPrima.has(id));
        const nuoviRuoli = ruoliSuperstitiDi(arricchito, SENZA_TETTO_DI_PIANO).filter(
          (ruolo) => !ruoliPrima.has(ruolo),
        );
        for (const nuovo of [...nuoviBlocchi, ...nuoviRuoli]) {
          expect(
            ECCEZIONI_DICHIARATE.has(nuovo),
            `${caso.nome}/+${campo}: sblocca ${nuovo} e missing non lo diceva`,
          ).toBe(true);
          eccezioniIncontrate += 1;
        }
        campiProvati += 1;
      }
    }

    expect(campiProvati).toBe(95);
    // Le eccezioni si incontrano DAVVERO, e il numero e' LETTERALE come ogni altro contatore di
    // questo file (95, 51, 43, 135, 33, 81, 12): era l'unico lasciato a toBeGreaterThan(0), cioe'
    // la PRESENZA asserita invece del VALORE — lo schema di oracolo debole che l'audit di P0/P1
    // ha catalogato. Con la sola presenza, un ritocco che allargasse la lacuna dichiarata (piu'
    // bersagli sbloccabili da un solo campo e taciuti) sarebbe restato verde.
    // QUATTORDICI e' MISURATO su queste fixture, non ripreso da altrove: e' anche il numero
    // citato dalla copertura dichiarata in testa al file, e le due righe cadono insieme.
    expect(eccezioniIncontrate).toBe(14);
  });
});

// ── purezza e determinismo ──────────────────────────────────────────────────

describe('T-215 generatable e PURA: stessi argomenti, stesso esito; nessuna scia', () => {
  it('due chiamate uguali danno lo stesso esito, e argomenti diversi lo distinguono', () => {
    // IL VERSO CHE LA SOLA RIPETIZIONE NON COPRE (lezione R-04 di T-212): ripetere la stessa
    // chiamata prende lo stato che SPORCA, non quello che CONGELA. Una memoizzazione sul solo
    // brief, che ignorasse `maxPages`, soddisfa la sola ripetizione. Qui le chiamate sono
    // INTERPOSTE e con argomenti diversi.
    const ricco = briefRiccoMassimo();
    const povero = briefPoverissimo();

    const primo = generatable(ricco, { maxPages: 3 });
    const conPovero = generatable(povero, { maxPages: 3 });
    const senzaTetto = generatable(ricco, { maxPages: SENZA_TETTO_DI_PIANO });
    const diNuovo = generatable(ricco, { maxPages: 3 });

    expect(diNuovo).toEqual(primo);
    expect(primo.pages).not.toBe(senzaTetto.pages);
    expect(conPovero.ok).not.toBe(primo.ok);
    expect(conPovero.missing.length).toBeGreaterThan(primo.missing.length);
  });

  it('non muta il brief ricevuto, ne i cataloghi a monte, ne le voci gia restituite', () => {
    const brief = briefRiccoDellAc();
    const primaDelBrief = JSON.stringify(brief);
    const primaDeiBlocchi = JSON.stringify(BLOCKS.map((blocco) => blocco.id));
    const primaDellePagine = JSON.stringify(PAGE_CATALOG);

    const esito = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
    expect(esito.missing.length, 'missing vuoto: il caso non proverebbe nulla').toBe(2);

    expect(JSON.stringify(brief)).toBe(primaDelBrief);
    expect(JSON.stringify(BLOCKS.map((blocco) => blocco.id))).toBe(primaDeiBlocchi);
    expect(JSON.stringify(PAGE_CATALOG)).toBe(primaDellePagine);

    // LE VOCI RESTITUITE SONO COPIE, non le righe della tabella interna del modulo. Se lo fossero,
    // un consumatore che ritocca una voce (per tradurla, per marcarla come vista) corromperebbe
    // OGNI chiamata successiva del processo — un difetto che si manifesterebbe altrove e molto
    // dopo. Il cast toglie il `readonly`, che e' del compilatore e non del runtime.
    (esito.missing[0] as { field: string }).field = 'campo-guasto';
    const dopo = generatable(brief, { maxPages: SENZA_TETTO_DI_PIANO });
    expect(dopo.missing[0].field).not.toBe('campo-guasto');
    expect(come(dopo.missing)).toEqual([
      ['vertical', 'block', 'offerte', 'specializes'],
      ['whatsapp', 'block', 'cta-whatsapp', 'unlocks'],
    ]);
    // E la seconda chiamata non condivide l'array con la prima.
    expect(dopo.missing).not.toBe(esito.missing);
  });
});
