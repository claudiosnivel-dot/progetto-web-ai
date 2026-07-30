// T-215 (macrotask generation-engine, P2) — LA NOZIONE DI GENERABILE PROPRIA DI P2: questo
// brief vale una chiamata a un modello A PAGAMENTO? Dominio PURO: nessun accesso al DB, nessun
// I/O, nessun side effect, nessuna lettura dell'orologio — e le sole dipendenze a runtime sono
// `blocksFor` (T-210) e `pagesFor` (T-213), perche' questo modulo non riscrive nessuna
// precondizione sui dati: le CHIEDE ai cataloghi che le dichiarano.
//
// PERCHE' ESISTE, ed e' bene dirlo senza gonfiarlo: non e' sicurezza in senso stretto, e' il
// CONTENIMENTO DEL COSTO. Una generazione e' una chiamata a un modello a pagamento, e un brief
// che non puo' produrre un sito presentabile la spenderebbe per un risultato da buttare. Qui si
// decide PRIMA di spendere, con codice puro e deterministico che P5 potra' contabilizzare.
//
// P2 NON POGGIA SU `isBriefComplete` (T-122), e questo modulo NON lo importa. La ragione e'
// scritta in P1 §7 p.1: quella funzione verifica la PRESENZA e non la PROVENIENZA, vincola
// davvero soltanto due campi — `vertical` ha un default e `locale` e' richiesto dallo schema,
// quindi restano `business_name` e `primary_goal` — ed e' percio' dichiarata aggirabile in un
// solo turno da un modello sotto injection. Un gate che decide una SPESA non deve dipendere da
// una funzione dichiarata aggirabile: le due nozioni sono distinte per costruzione, e
// tests/generation-generatable.test.ts lo asserisce leggendo GLI IMPORT di questo file invece di
// sperarlo (AC-215-4, che chiude un carry-over aperto da P1).
// COSA QUESTO MODULO NON RISOLVE, per non dedurne di piu': nemmeno `generatable` verifica la
// PROVENIENZA dei dati. Un modello sotto injection che scriva sei offerte inventate ottiene un
// brief generabile. Cio' che si guadagna e' che la soglia non e' piu' DUE CAMPI DI TESTO: per
// passarla servono almeno due sorgenti distinte, e quel testo finira' comunque sotto gli occhi
// dell'utente nella schermata di conferma (P1) prima di diventare un sito.
//
// LA SOGLIA E' SUI BLOCCHI SUPERSTITI, NON SU UN CONTEGGIO DI CAMPI (DoD), e la differenza non e'
// formale: contare i campi valorizzati direbbe che un brief con `geo`, `social_links` e
// `brand_hints` e' ricco, mentre nessuno dei tre fa esistere una sezione — il sito resterebbe la
// pagina vuota che P2-D7 vieta. Cio' che conta e' quanta SOSTANZA il sito puo' mostrare, e la
// sostanza sono i blocchi che sopravvivono alle precondizioni di T-210.
//
// `missing` E' UNA GUIDA, NON LA SPIEGAZIONE DI `ok`, e i due si leggono separatamente: `ok` e'
// la soglia, `missing` e' l'elenco di cio' che ancora manca. Un brief generabile puo' avere voci
// in `missing` (il vertical non scelto e' il caso tipico). Il testo che l'utente leggera' e la
// sua i18n sono di T-230: qui ci sono identificatori, mai stringhe da mostrare.
//
// COSA NON C'E' QUI, deliberatamente:
// - i MESSAGGI e l'i18n dell'elenco (T-230), e il BLOCCO effettivo della generazione a livello di
//   rotta (T-230): questo modulo risponde, non obbedisce e non parla;
// - una SOGLIA sulle pagine: la home esiste sempre (T-213), quindi `pages` non e' mai zero e non
//   aggiunge nulla al gate. Legare `ok` alle pagine renderebbe il TETTO DI PIANO (il giunto verso
//   P5) capace di dichiarare non generabile un sito ricco, cioe' farebbe leggere all'utente
//   "aggiungi dei dati" per un problema di listino. AC-215-6 lo vieta.

import { blocksFor } from '@/domain/generation/blocks';
import { pagesFor } from '@/domain/generation/pages';
import type { Brief, BriefUpdateSchema } from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';

/**
 * I nomi dei campi del brief nominabili in `missing`: le chiavi della patch FLAT (T-121), che
 * sono anche quelle che il tool `update_brief` (T-132) consuma e quelle che l'utente vedra'
 * nominate a valle. Derivati e mai ricopiati — la stessa derivazione che T-210 usa per
 * `brief_fields_rendered`. Un campo che il brief non ha non e' nominabile, quindi una voce non
 * puo' suggerire di riempire qualcosa che non esiste.
 *
 * La ripetizione della derivazione (T-210 la fa per conto suo) e' dichiarata: quel modulo non
 * esporta il tipo, ed e' committato e verificato. Non e' una seconda VERITA' — le due espressioni
 * leggono lo stesso schema e non possono divergere.
 */
type BriefFieldName = keyof (typeof BriefUpdateSchema)['shape'];

/**
 * IL RUOLO 'home'. `satisfies` e non `:` per la stessa ragione di T-212 e T-213: il tipo resta il
 * letterale, e il valore e' comunque verificato contro il vocabolario di T-201 — se quel catalogo
 * perdesse il ruolo 'home' questa riga non compilerebbe.
 */
const RUOLO_HOME = 'home' satisfies PageRole;

/**
 * 'altro' NON E' UN VERTICALE, e' l'ASSENZA di scelta (stessa lettura di P1-D24 e del commento di
 * T-210 sulle varianti): `emptyBrief` lo porta comunque, quindi un brief mai toccato lo dichiara.
 * E' percio' riportato come NON scelto, e la costante e' verificata contro l'enum di T-121.
 */
const VERTICAL_NON_SCELTO = 'altro' satisfies Brief['vertical'];

/**
 * LA SOGLIA: sotto questo numero di blocchi superstiti il brief non vale una chiamata a
 * pagamento.
 *
 * PERCHE' QUATTRO, con la misura invece che a occhio. Due ancore, entrambe misurate e pinnate dal
 * file di test (che le ricava dai cataloghi a monte, non da qui):
 * 1. IL MASSIMO RAGGIUNGIBILE E' SETTE, non otto: il catalogo di T-210 ha otto voci e
 *    'recensioni' non e' soddisfacibile da alcun Brief v1 (nessun campo porta recensioni). Una
 *    soglia sopra sette sarebbe una soglia che nessun brief puo' passare.
 * 2. UN BRIEF CHE DICE UNA COSA SOLA ARRIVA AL PIU' A TRE. Misurato partendo dal brief piu' povero
 *    che possa essere 'confirmed' (il pavimento vero di P2, che riceve solo brief confermati) e
 *    aggiungendo UN campo per volta: l'hero c'e' sempre — il nome e' il minimo per essere
 *    confermati — e il campo che sblocca di piu' e' `whatsapp`, che ne sblocca DUE perche' il
 *    numero e' insieme un recapito (la sezione contatti) e la destinazione del bottone (la CTA).
 *    Ogni altro campo, da solo, ne sblocca al piu' uno.
 * QUATTRO e' percio' il primo numero che un brief il quale dice UNA COSA SOLA non puo'
 * raggiungere: chiede almeno DUE sorgenti distinte oltre al nome. E' la differenza fra un sito e
 * un'insegna.
 *
 * COSA QUESTO NUMERO NON E': non e' una misura di qualita' del testo (non e' oracolabile) e non e'
 * PAGES_MIN (T-213), che vale sulle PAGINE ed e' una misura diversa — un sito puo' avere tre
 * pagine e tre soli blocchi, e il test pinna proprio quel caso. E' una DECISIONE DI PRODOTTO presa
 * qui e visibile qui, con le sue due ancore; il test la pinna dai due lati con casi adiacenti
 * (tre blocchi: no; quattro blocchi: si') invece di leggere questa costante.
 */
export const GENERATABLE_MIN_BLOCKS = 4;

/**
 * UNA VOCE DI `missing`: un campo del brief e UN bersaglio — un blocco (T-210) o una pagina
 * (T-213) — con il verbo che dice cosa quel campo fa a quel bersaglio.
 *
 * UNA VOCE PER COPPIA (campo, bersaglio), NON UNA VOCE PER CAMPO CON PIU' ID, ed e' la decisione
 * portante di questo modulo. Un campo puo' toccare piu' di un bersaglio — `offerings` fa esistere
 * il blocco 'offerte' (T-210: una voce basta) e la pagina 'offerings' (T-213: ne chiede quattro) —
 * e i due NON si sbloccano insieme. Con tre offerte il blocco c'e' e la pagina no: una voce sola
 * per il campo `offerings` dovrebbe allora o sparire (perdendo la guida sulla pagina) o elencare
 * anche 'offerte' (promettendo di sbloccare cio' che e' gia' sbloccato). Una voce per COPPIA dice
 * la cosa vera, ed e' anche la sola forma in cui ogni voce e' una promessa VERIFICABILE da sola.
 * IL COSTO E' DICHIARATO: lo stesso campo puo' comparire piu' volte, quindi chi mostrera'
 * l'elenco (T-230) dovra' raggrupparlo per campo invece di stamparlo riga per riga.
 */
export type MissingEntry = {
  /** Il nome del campo del brief, dalle chiavi della patch di T-121. */
  readonly field: BriefFieldName;
  /** Che cosa nomina `id`: un blocco del catalogo di T-210 o una pagina di quello di T-213. */
  readonly kind: 'block' | 'page';
  /**
   * L'id del blocco, oppure il RUOLO della pagina.
   *
   * PER LE PAGINE E' IL RUOLO E NON LO SLUG, e la ragione e' misurabile: lo slug della pagina
   * 'offerings' e' 'offerte', che e' ESATTAMENTE l'id del blocco 'offerte'. Con gli slug i due
   * bersagli avrebbero lo stesso identificatore e solo `kind` li distinguerebbe; col ruolo sono
   * due nomi diversi per due cose diverse. Lo slug e' inoltre la chiave di un artefatto
   * pubblicato (T-202), non l'identita' di una voce di catalogo.
   */
  readonly id: string;
  /**
   * COSA IL CAMPO FA AL BERSAGLIO, dichiarato invece che sottinteso:
   * - 'unlocks': il bersaglio oggi NON esiste, e valorizzare quel campo lo fa esistere;
   * - 'specializes': il bersaglio esiste o no per conto suo, e quel campo ne cambia la FORMA.
   * La sola voce della seconda specie e' quella del `vertical`, e il verbo esiste per non dire il
   * falso: il vertical non e' la precondizione di alcun blocco — scegliere 'ristorazione' non fa
   * nascere la sezione offerte, la fa diventare un menu (T-210, `resolveOfferings`).
   */
  readonly effect: 'unlocks' | 'specializes';
};

/** L'esito del gate. */
export type GeneratableResult = {
  /** Se il brief vale una chiamata a un modello a pagamento. */
  readonly ok: boolean;
  /** Quanti blocchi sopravvivono alle precondizioni di T-210 per questo brief. */
  readonly surviving_blocks: number;
  /** Quante pagine ha il set derivato da T-213 sotto questo tetto. */
  readonly pages: number;
  /** Cosa manca ancora, una voce per coppia (campo, bersaglio). */
  readonly missing: readonly MissingEntry[];
};

/**
 * Una regola dell'elenco. Il bersaglio e' un'unione DISCRIMINATA: l'id di una pagina e' tipizzato
 * `PageRole`, quindi una regola che citasse un ruolo inesistente non compila. Per i blocchi la
 * stessa garanzia non e' scrivibile (gli id di T-210 sono `string`), e a giudicarli e' il test,
 * che deriva l'insieme ammesso dal catalogo a monte (AC-215-2).
 */
type Regola = {
  readonly field: BriefFieldName;
  readonly effect: MissingEntry['effect'];
} & (
  | { readonly kind: 'block'; readonly id: string }
  | { readonly kind: 'page'; readonly id: PageRole }
);

/**
 * LE REGOLE, dichiarate a mano nell'ordine dei cataloghi a monte: prima i BLOCCHI nell'ordine di
 * `BLOCKS` (T-210), poi le PAGINE nell'ordine di `PAGE_CATALOG` (T-213). L'ordine e' quello in cui
 * l'utente leggera' i suggerimenti, quindi e' una decisione e non un caso: il test lo pinna.
 *
 * UNA REGOLA ESISTE SOLO DOVE UN CAMPO, DA SOLO, BASTA. E' il criterio che rende ogni voce una
 * promessa mantenibile, ed e' anche cio' che tiene fuori tre bersagli. Le esclusioni sono
 * dichiarate qui perche' sono la parte che si nasconde piu' facilmente:
 * - il blocco 'faq' e la pagina 'faq': la precondizione conta TRE MATERIE su sei sorgenti diverse
 *   (T-210, `materieFaq`). Nessun campo singolo le raggiunge da un brief povero, e quale campo
 *   basti dipende da cosa c'e' gia'. Una voce che ne nominasse uno prometterebbe cio' che il
 *   codice non mantiene. Riscrivere qui quel conteggio (`materieFaq` non e' esportata) sarebbe una
 *   SECONDA VERITA' sulla stessa cosa, che e' il difetto contro cui T-213 mette in guardia in
 *   testa al proprio file;
 * - la pagina 'contact': chiede DUE recapiti (T-213, `PAGE_MIN_RECAPITI`, non esportata) e vale
 *   lo stesso ragionamento — da zero recapiti nessun campo singolo la sblocca. La sezione contatti
 *   invece SI', e le sue quattro regole restano;
 * - il blocco 'recensioni' e la pagina 'reviews': il Brief v1 non ha ALCUN campo che porti
 *   recensioni (T-210 lo dichiara invece di aggirarlo), quindi non esiste un campo da suggerire.
 *   Inventarne uno sarebbe la promessa piu' disonesta delle tre.
 * CONSEGUENZA DICHIARATA: l'utente non riceve la guida "ti manca UN secondo recapito" ne' "ti
 * manca UNA terza materia". E' il prezzo per non avere voci che mentono, ed e' scritto anche nel
 * file di test come copertura dichiarata.
 *
 * PERCHE' NESSUNA REGOLA E' DERIVATA DAI CATALOGHI: la corrispondenza campo -> bersaglio non e'
 * dichiarata da nessuna parte a monte. `brief_fields_rendered` (T-210) dice quali campi un blocco
 * RENDE, che e' una cosa diversa dal dire quali lo fanno ESISTERE — il blocco 'chi-siamo' non
 * rende alcun campo e nasce da `description` o `highlights`, il blocco 'faq' non ne rende nessuno
 * e nasce da sei. Derivare le regole da quell'elenco produrrebbe suggerimenti sbagliati con
 * l'aria di essere derivati; qui si dichiarano, e il test verifica UNA PER UNA che valorizzare
 * quel campo faccia davvero comparire quel bersaglio.
 */
const MISSING_RULES: readonly Regola[] = [
  // 'hero' — l'apertura della home. Il nome e' anche il minimo perche' un brief sia 'confirmed'
  // (T-122), quindi questa voce compare solo su un brief che non lo e' ancora.
  { field: 'business_name', kind: 'block', id: 'hero', effect: 'unlocks' },
  // 'offerte' — la sezione esiste con UNA voce (T-210, `MIN_OFFERTE`).
  { field: 'offerings', kind: 'block', id: 'offerte', effect: 'unlocks' },
  // Il vertical SPECIALIZZA la sezione offerte (etichetta, layout, prezzo) e non la sblocca:
  // vedi `effect`. E' emesso finche' il vertical e' 'altro', ANCHE se la sezione non esiste
  // ancora, perche' e' una SCELTA mancante del brief e non una conseguenza dei dati.
  { field: 'vertical', kind: 'block', id: 'offerte', effect: 'specializes' },
  // 'chi-siamo' — la precondizione e' una DISGIUNZIONE (descrizione OPPURE evidenze), quindi
  // ciascuno dei due campi basta da solo ed entrambi meritano una voce.
  { field: 'description', kind: 'block', id: 'chi-siamo', effect: 'unlocks' },
  { field: 'highlights', kind: 'block', id: 'chi-siamo', effect: 'unlocks' },
  // 'orari' — basta una voce con un orario dentro (T-210 tratta le chiavi senza valore come
  // assenza).
  { field: 'hours', kind: 'block', id: 'orari', effect: 'unlocks' },
  // 'contatti' — disgiunzione fra il luogo e i tre canali: quattro voci, una per campo.
  { field: 'address', kind: 'block', id: 'contatti', effect: 'unlocks' },
  { field: 'phone', kind: 'block', id: 'contatti', effect: 'unlocks' },
  { field: 'whatsapp', kind: 'block', id: 'contatti', effect: 'unlocks' },
  { field: 'email', kind: 'block', id: 'contatti', effect: 'unlocks' },
  // 'cta-whatsapp' — senza numero il bottone non ha destinazione. E' il secondo bersaglio dello
  // stesso campo `whatsapp`, ed e' la ragione per cui quel campo ne sblocca DUE (vedi la soglia).
  { field: 'whatsapp', kind: 'block', id: 'cta-whatsapp', effect: 'unlocks' },
  // Le PAGINE. La pagina 'offerings' dipende dal SOLO campo `offerings`, come la sezione, ma con
  // una soglia piu' alta: la voce nomina percio' il CAMPO su cui lavorare e non la quantita' che
  // serve — quel numero vive in T-213 e questo modulo non lo ricopia. Conseguenza dichiarata: con
  // tre offerte la voce compare ancora, ed e' corretta (e' la quarta offerta a sbloccare la
  // pagina).
  { field: 'offerings', kind: 'page', id: 'offerings', effect: 'unlocks' },
  // La pagina 'orari' non ha soglia propria oltre a quella della sezione (T-213 lo dichiara e ne
  // scrive la ragione: `hours` ha chiavi libere e contarle non misura nulla).
  { field: 'hours', kind: 'page', id: 'hours', effect: 'unlocks' },
];

/**
 * Se la regola va segnalata per questo brief.
 *
 * 'specializes' non guarda i bersagli: cio' che manca e' una SCELTA, e la scelta manca finche' il
 * vertical e' quello di default. 'unlocks' guarda il bersaglio nel catalogo che gli compete —
 * mai il campo del brief: un campo valorizzato che NON basta al proprio bersaglio (tre offerte
 * per la pagina 'offerings') deve continuare a comparire, altrimenti la guida sparirebbe proprio
 * quando e' piu' facile da seguire.
 *
 * L'appartenenza e' per UGUAGLIANZA (`Set.has`) e mai per prefisso, e gli indici sono `Set` e non
 * oggetti: gli id vengono dal nostro codice, ma un oggetto indicizzato per stringa risolverebbe
 * comunque i membri di Object.prototype e farebbe "esistere" un bersaglio chiamato 'constructor'.
 * QUANTO VALE, MISURATO invece che affermato: la differenza fra uguaglianza e prefisso NON e'
 * oggi osservabile — nessun id di blocco e' prefisso di un altro, e lo stesso vale per i ruoli di
 * pagina — quindi la mutazione che riscrive questo confronto con `startsWith` lascia il file di
 * test interamente verde. E' una scelta presa in anticipo, non una proprieta' provata; il test
 * pinna l'ASSENZA di prefissi, cosi' il giorno in cui un id nuovo la rendera' osservabile la
 * decisione torna sul tavolo.
 */
function daSegnalare(
  regola: Regola,
  brief: Brief,
  blocchiEsistenti: ReadonlySet<string>,
  ruoliSuperstiti: ReadonlySet<PageRole>,
): boolean {
  if (regola.effect === 'specializes') return brief.vertical === VERTICAL_NON_SCELTO;
  if (regola.kind === 'block') return !blocchiEsistenti.has(regola.id);
  return !ruoliSuperstiti.has(regola.id);
}

/**
 * IL GATE. Ritorna se il brief e' generabile, quanti blocchi e quante pagine sopravvivono alle
 * precondizioni, e — per ogni cosa che manca — quale blocco o quale pagina sbloccherebbe.
 *
 * I DUE CONTEGGI SONO CHIESTI AI CONTRATTI A MONTE e non ricalcolati, perche' due verita' sulla
 * stessa cosa divergono in silenzio il giorno in cui una delle due cambia:
 * - `surviving_blocks` viene da `blocksFor` (T-210). Il ruolo passato e' 'home' perche' OGNI
 *   blocco del catalogo dichiara quel ruolo (invariante di T-210, pinnato dal test): chiedere la
 *   home significa quindi chiedere TUTTI i blocchi soddisfatti, non un sottoinsieme. Il giorno in
 *   cui un blocco smettesse di dichiarare 'home' il test diventa rosso e questa lettura va
 *   rimisurata.
 * - `pages` viene da `pagesFor` (T-213), con lo STESSO tetto ricevuto.
 *
 * I RUOLI SUPERSTITI SI LEGGONO DALLO STESSO RISULTATO di `pagesFor`, e la lettura e' quella che
 * il file di test di T-213 usa: il ruolo di ogni pagina PIU' i ruoli che la home ASSORBE. E' la
 * sola lettura che dice "la precondizione della pagina e' soddisfatta" indipendentemente da
 * `maxPages`, perche' una pagina tagliata dal tetto di piano non sparisce: rientra nella home
 * come sezione. Contare le sole pagine del set direbbe che manca un DATO quando a mancare e' il
 * PIANO PAGATO — cioe' chiederebbe all'utente di scrivere altro per riparare un problema di
 * listino. Una sola chiamata, due letture: non c'e' un secondo set da cui divergere.
 *
 * PURA E DETERMINISTICA: non legge nulla fuori dai propri argomenti, non muta il brief, non muta
 * i cataloghi e non porta stato fra due chiamate. LE VOCI DI `missing` SONO COPIE delle righe di
 * `MISSING_RULES`, non le righe stesse: restituire la tabella condivisa permetterebbe a un
 * consumatore che ritocca una voce (per tradurla, per marcarla come vista) di corrompere OGNI
 * chiamata successiva del processo — un difetto che si manifesterebbe altrove e molto dopo. Il
 * costo e' un oggetto nuovo per voce; il test lo pinna guastandone una.
 */
export function generatable(
  brief: Brief,
  options: { readonly maxPages: number },
): GeneratableResult {
  const blocchi = blocksFor(brief, RUOLO_HOME);
  const blocchiEsistenti = new Set(blocchi.map((blocco) => blocco.id));

  const pagine = pagesFor(brief, options);
  const ruoliSuperstiti = new Set<PageRole>(
    pagine.flatMap((pagina) => [pagina.role, ...pagina.absorbed_roles]),
  );

  const missing = MISSING_RULES.filter((regola) =>
    daSegnalare(regola, brief, blocchiEsistenti, ruoliSuperstiti),
  ).map((regola) => ({
    field: regola.field,
    kind: regola.kind,
    id: regola.id,
    effect: regola.effect,
  }));

  return {
    ok: blocchi.length >= GENERATABLE_MIN_BLOCKS,
    surviving_blocks: blocchi.length,
    pages: pagine.length,
    missing,
  };
}
