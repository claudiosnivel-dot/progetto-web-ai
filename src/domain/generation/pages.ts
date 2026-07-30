// T-213 (macrotask generation-engine, P2) — IL SET DI PAGINE DERIVATO DAI DATI, con la sua
// navigazione e i suoi link interni. Dominio PURO: nessun accesso al DB, nessun I/O, nessun
// side effect — e la sola dipendenza a runtime e' `blocksFor` (T-210), perche' questo modulo
// non riscrive le precondizioni sui dati: le CHIEDE al catalogo dei blocchi.
//
// P2-D13 COME PROPRIETA' DEL CODICE, non come linea guida: la HOME esiste sempre; ogni altra
// pagina ha una precondizione sui dati e, se non e' soddisfatta, LA PAGINA NON ESISTE — non
// esiste vuota, non esiste come voce di menu senza contenuto, non esiste affatto. Sotto la
// soglia di `PAGES_MIN` pagine superstiti il sito resta una ONE-PAGER e le sezioni RIENTRANO
// nella home invece di diventare pagine sottili. Pubblicare pagine sottili e' il
// comportamento che il Google June 2026 Spam Update punisce, e qui e' STRUTTURALMENTE
// impossibile: non c'e' un limite raccomandato da rispettare, c'e' un set che non le contiene.
//
// L'INTEGRITA' DELLA NAVIGAZIONE E' UN'IMPOSSIBILITA' DI RAPPRESENTAZIONE — RELATIVA AL PROPRIO
// ARGOMENTO, e il confine va detto esatto perche' una verifica avversariale ha misurato che la
// versione assoluta era falsa. `navigationFor` e' una PROIEZIONE del set che riceve: la
// destinazione di ogni voce e' COPIATA dalla pagina, quindi NON esiste modo di emettere una voce
// che punti fuori dall'insieme ricevuto. Non consulta `PAGE_CATALOG` — e' la differenza che
// conta: una versione che leggesse il catalogo per sapere quali voci esistono POTREBBE emettere
// una voce per un ruolo che il set non contiene, e avrebbe bisogno di una guardia.
// CHE L'ARGOMENTO SIA IL SET GENERATO E' PRECONDIZIONE DEL CHIAMANTE, non un teorema di questo
// modulo: `PageSpec` e' un tipo esportato, senza brand ne validazione, quindi una destinazione
// che nessuna pagina possiede e' scrivibile in una riga (misurato: `navigationFor` su una
// `PageSpec` fabbricata a mano con uno slug inesistente restituisce quella destinazione; lo
// stesso file di test ne fabbrica tre, per esercitare i confini). La versione forte — far
// restituire a `pagesFor` la coppia set+navigazione, cosi' che la seconda non possa nascere da
// un insieme diverso dal primo — e' stata VALUTATA E SCARTATA dall'utente: sarebbe un
// emendamento alla DoD, che chiede due funzioni esportate. Resta quindi come copertura
// dichiarata, ed e' scritta anche nel file di test.
//
// IL MODELLO NON HA ALCUNA LEVA SULLA STRUTTURA (P2-D4, "nessuna leva in uscita"): gli slug e
// le priorita' sono dichiarati QUI, a mano, e non esiste alcun percorso dal testo del brief a
// questo file. Un'iniezione riuscita nel brief ottiene un copy diverso; non ottiene una pagina
// in piu', un URL nuovo o un link fuori dal sito. E' la stessa forma di garanzia con cui T-212
// tiene la struttura della pagina fuori dalla portata del modello.
//
// DUE CATALOGHI CHE SEMBRANO DIRE LA STESSA COSA, e la scelta e' dichiarata qui perche' e' il
// nodo di questo task. La DoD chiede che `PAGE_CATALOG` dichiari "i blocchi che la
// compongono", ma la COMPOSIZIONE per ruolo e' gia' dichiarata dalle ricette (T-212,
// `inner_page_rules`) e ogni ricetta la dichiara DIVERSA — e' il senso stesso delle cinque
// direzioni. Due elenchi che dicono la stessa cosa in due moduli divergono in silenzio, ed e'
// il difetto contro cui mette in guardia il commento in testa a slots.ts.
// LA SCELTA: i blocchi di `PAGE_CATALOG` sono quelli che GIUSTIFICANO la pagina — la sua
// precondizione, cioe' "senza questi dati la pagina non esiste" — e il campo si chiama
// `justifying_blocks` proprio per non poter essere letto come una sequenza di composizione.
// CHI compone la pagina e IN QUALE ORDINE resta di T-212 e non e' nominato qui. Il costo
// dichiarato e' che leggendo questo file non si sa come sara' fatta la pagina 'offerte' — per
// saperlo si legge la ricetta, che e' il posto dove la decisione vive.
// CIO' CHE PERO' PUO' DIVERGERE, e la prima versione di questo commento lo negava a torto: non
// gli ELENCHI, ma la PRETESA. `PAGE_CATALOG` afferma che la pagina del ruolo X esiste perche'
// certi dati ci sono; solo `inner_page_rules` puo' consegnarle un CONTENUTO; e nessun invariante
// dei due moduli lega le due affermazioni. MISURATO: facendo dichiarare a tutte e cinque le
// direzioni `faq: ['chi-siamo']`, il set continua a contenere la pagina faq, `applyRecipe`
// compone [] per quella pagina, e `parseDocument` (T-202) RIFIUTA il documento — cioe' la
// generazione fallisce, e nessun test di questo file protestava. L'invariante di T-212 "ogni
// blocco citato dichiara quel ruolo" non copre il caso, perche' 'chi-siamo' dichiara 'home' e
// non 'faq': lo prende, ma un blocco che dichiarasse il ruolo giusto senza essere la SOSTANZA
// della pagina lo passerebbe indenne. L'oracolo che lega le due dichiarazioni vive percio' nel
// file di test di QUESTO task, che e' l'unico posto in cui i due cataloghi si vedono insieme.
//
// LE PRECONDIZIONI DI PAGINA NON SONO QUELLE DI SEZIONE, ed e' la seconda decisione portante.
// T-210 dichiara la soglia della SEZIONE (`MIN_OFFERTE = 1`) e assegna esplicitamente a
// questo task la soglia PIU' ALTA: una sezione con una voce dentro la home e' legittima
// (nasconderla vorrebbe dire buttare cio' che l'utente ha scritto), una PAGINA con una voce
// sola e' la pagina sottile che P2-D13 esclude. Ogni precondizione di questo modulo e' percio'
// la CONGIUNZIONE di due cose: (1) i blocchi che giustificano la pagina ESISTONO per quel
// ruolo — chiesto a `blocksFor`, mai riscritto — e (2) la soglia propria della pagina, dove
// esiste una misura onesta da fare. Dove quella misura NON esiste la soglia resta quella
// della sezione, e il perche' e' scritto sulla voce: una soglia inventata rifiuterebbe un sito
// legittimo, che e' un modo peggiore di sbagliare.
//
// COSA NON C'E' QUI, deliberatamente:
// - il CONTENUTO delle pagine (T-234) e la loro COSTRUZIONE nel documento (T-214): questo
//   modulo dice QUALI pagine esistono, con quale slug e in quale ordine — non cosa c'e' dentro;
// - il RENDERING della navigazione (T-231/T-235): qui c'e' la voce con la sua destinazione e
//   la CHIAVE i18n della sua etichetta (P2-D10: le etichette vengono dai cataloghi, mai una
//   stringa gia' tradotta e mai testo del brief), non il markup;
// - la DEFINIZIONE di `maxPages`, che e' il giunto verso P5: P2 riceve un tetto e lo applica.
//   Il tetto di SICUREZZA globale (`DOCUMENT_LIMITS.max_pages`, T-202) NON e' importato qui e
//   non e' una dimenticanza: il set derivato e' limitato dal VOCABOLARIO DEI RUOLI (T-201, sei
//   in tutto), quindi non puo' sfondarlo, e imporlo di nuovo qui sarebbe una seconda guardia
//   su un bound gia' strutturalmente soddisfatto. Il tetto della RIGA lo impone `appendPages`
//   (T-204), dove si scrive; che il set ci stia sotto e' ASSERITO dal test, derivando il
//   numero da T-202 invece di ricopiarlo.

import { blocksFor } from '@/domain/generation/blocks';
import type { Brief } from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';

/**
 * Il ruolo della home. E' `satisfies PageRole` e non `: PageRole` per la stessa ragione di
 * T-212: il tipo resta il letterale 'home', quindi la voce del catalogo che lo porta e'
 * distinguibile per TIPO dalle altre — ed e' cio' che rende impossibile scrivere una
 * precondizione sulla home. Il valore resta comunque verificato contro il vocabolario di
 * T-201: se quel catalogo perdesse il ruolo 'home' questa riga non compilerebbe.
 */
const RUOLO_HOME = 'home' satisfies PageRole;

/**
 * I ruoli delle PAGINE INTERNE: tutti quelli del vocabolario di T-201 tranne la home.
 * Derivato e non elencato a mano — un ruolo di pagina nuovo la' rompe il typecheck del
 * catalogo qui sotto e obbliga a DECIDERE slug, priorita' e precondizione di quella pagina,
 * invece di lasciarla nascere senza.
 */
type InnerPageRole = Exclude<PageRole, typeof RUOLO_HOME>;

/**
 * La CHIAVE i18n dell'etichetta di una voce di navigazione (P2-D10). E' un identificatore,
 * non un testo: il catalogo delle etichette del SITO GENERATO nasce col rendering
 * (T-231/T-233) ed e' distinto da quello del builder. La stessa scelta che T-210 fa per
 * l'etichetta della sezione offerte, e per la stessa ragione: qui non passa nulla di
 * traducibile e nulla che venga dal brief.
 */
type NavLabelKey =
  | 'site.nav.home'
  | 'site.nav.offerings'
  | 'site.nav.hours'
  | 'site.nav.contact'
  | 'site.nav.reviews'
  | 'site.nav.faq';

type PageDefinitionBase = {
  /**
   * Lo SLUG: il segmento di percorso della pagina nel sito pubblicato, e la chiave con cui il
   * documento congelato (T-202) e il pool (T-201) la nominano. La FORMA e' quella che
   * `PageSlugSchema` impone la' — minuscole, cifre e trattini singoli — perche' uno slug
   * fuori forma fa cadere l'INTERO documento; qui non e' confrontato con quello schema (e'
   * scelto per passarlo), e il test ne prova l'EFFETTO passando dai gate veri.
   *
   * LO SLUG NON DIPENDE DAL LOCALE, ed e' una decisione con un costo dichiarato: per un sito
   * 'es' il segmento di percorso resta in italiano. La ragione e' che lo slug e' la CHIAVE di
   * un artefatto CONGELATO — le pagine della fase 2 si aggiungono a un documento gia' scritto
   * (`appendPages`, T-204) e devono usare gli stessi slug della fase 1 — mentre `locale` e' un
   * campo del brief che P1 permette di cambiare. Uno slug derivato dal locale farebbe
   * divergere il set della fase 2 da quello congelato nella fase 1, cioe' produrrebbe pagine
   * irraggiungibili e un'allowlist del pool che non combacia. URL localizzati sono una
   * decisione di prodotto legittima e vanno prese dove la chiave del documento si puo'
   * versionare, non qui di soppiatto.
   *
   * QUATTRO SLUG SU SEI COINCIDONO COL NOME DEL BLOCCO che li giustifica ('offerte', 'orari',
   * 'contatti', 'recensioni'), ed e' una coincidenza di lingua e non un accoppiamento: sono
   * la stessa parola italiana per la stessa cosa. Il test pinna l'assegnazione voce per voce,
   * quindi una sostituzione dell'una con l'altro e' comunque rossa.
   */
  readonly slug: string;
  /**
   * La PRIORITA' dichiarata: le pagine compaiono in ordine DECRESCENTE e `maxPages` taglia in
   * quell'ordine. Le priorita' sono DISTINTE (asserito dal test) e non e' cerimonia: due
   * ruoli a pari merito renderebbero arbitrario quale delle due pagine cade sotto un tetto
   * basso, cioe' renderebbero il tetto di piano imprevedibile per l'utente che lo paga.
   * I NUMERI SONO SPAZIATI DI DIECI per lasciare posto a una pagina nuova senza rinumerare
   * tutto — rinumerare cambierebbe quali pagine sopravvivono ai piani bassi di TUTTI i siti.
   */
  readonly priority: number;
  /** La chiave i18n dell'etichetta di navigazione (vedi `NavLabelKey`). */
  readonly label_key: NavLabelKey;
};

/**
 * La voce della HOME. NON HA una precondizione, ed e' il punto: "la home e' sempre presente,
 * per qualunque brief confermato" e' DoD, e una precondizione sulla home sarebbe un `true`
 * che qualcuno puo' modificare. Qui la home non e' negabile perche' non esiste il campo in
 * cui scrivere il diniego — la stessa forma di difesa che T-202 usa per lo slot immagine.
 * `pagesFor` la prende per RUOLO e non per posizione nell'ordinamento, quindi nemmeno una
 * priorita' sbagliata potrebbe farla cadere.
 *
 * NON HA NEMMENO `justifying_blocks`, e per la stessa ragione — resa esplicita dopo che una
 * verifica avversariale l'ha misurata. Quel campo e' documentato come "senza i loro dati la
 * pagina non esiste", e sulla home quella frase e' FALSA per costruzione: `pagesFor` non lo
 * legge mai per la home, e la home esiste anche con 'hero' insoddisfatto. Sostituire il valore
 * ('chi-siamo' al posto di 'hero') lasciava rossa la sola tabella letterale del test, perche'
 * nessun COMPORTAMENTO dipendeva da quel valore: era una dichiarazione che niente poteva
 * smentire. Con la precondizione si e' scelto di rendere il diniego NON SCRIVIBILE; qui si fa
 * la cosa simmetrica e si toglie il campo inerte, invece di tenerlo con una nota che ne limiti
 * la portata.
 */
type HomePageDefinition = PageDefinitionBase & { readonly role: typeof RUOLO_HOME };

type InnerPageDefinition = PageDefinitionBase & {
  readonly role: InnerPageRole;
  /**
   * I BLOCCHI CHE GIUSTIFICANO LA PAGINA: senza i loro dati la pagina non esiste. NON e' la
   * sequenza che la compone (vedi l'intestazione: quella e' di T-212). Non vuoto per tipo —
   * una pagina che nessun dato giustifica non deve essere scrivibile. Sta QUI e non sulla base
   * perche' sulla home non condizionerebbe nulla (vedi `HomePageDefinition`).
   */
  readonly justifying_blocks: readonly [string, ...string[]];
  /**
   * La precondizione sui dati: se non e' soddisfatta la pagina NON ESISTE. Pura e totale —
   * non lancia, non legge nulla fuori dal brief, non dipende dall'ordine delle chiamate.
   * E' costruita da `paginaInterna` come congiunzione fra l'esistenza dei blocchi
   * giustificanti (chiesta a T-210) e la soglia propria della pagina.
   */
  readonly precondition: (brief: Brief) => boolean;
};

type PageDefinition = HomePageDefinition | InnerPageDefinition;

/**
 * LA SPECIFICA DI UNA PAGINA che esiste: cio' che `resolve` (T-214) e il rendering
 * (T-231/T-235) consumano.
 *
 * NON porta `justifying_blocks` ne la precondizione, e non e' una dimenticanza: la
 * precondizione ha gia' fatto il proprio lavoro (una pagina e' nel set PERCHE' era
 * soddisfatta) e i blocchi che la compongono li decide la ricetta. Portarli qui inviterebbe
 * un consumatore a comporre la pagina con l'elenco sbagliato.
 *
 * NON PORTA NEMMENO LA `priority`, e la ragione e' la stessa un passo piu' avanti: nessun AC e
 * nessuna riga della DoD la chiedono nel RISULTATO — chiedono il set ORDINATO e una voce di
 * navigazione per pagina. Esporla consegnerebbe a valle esattamente la leva che questo modulo
 * dichiara di tenere: un consumatore potrebbe riordinare o ritagliare il set fuori da
 * `pagesFor`, e "il taglio e' deterministico e in ordine" diventerebbe una proprieta' del solo
 * punto di produzione invece che dell'artefatto. La priorita' resta dichiarata in
 * `PAGE_CATALOG`, che e' la sua sede.
 */
export type PageSpec = {
  readonly role: PageRole;
  readonly slug: string;
  readonly label_key: NavLabelKey;
  /**
   * LA FORMA DEL SITO di cui questa pagina fa parte. E' RIDONDANTE con il conteggio delle
   * pagine — una one-pager ha una pagina sola e una pagina sola e' sempre una one-pager — e
   * il campo esiste comunque per due ragioni: la forma e' una DECISIONE (la soglia PAGES_MIN
   * l'ha presa) e dirla e' meglio che farla dedurre da un conteggio; e `resolve` e' chiamabile
   * su un SOTTOINSIEME di pagine (la fase 1 la chiama sulla sola home), dove il conteggio non
   * dice nulla sul sito.
   */
  readonly shape: 'one-pager' | 'multi-page';
  /**
   * I RUOLI ASSORBITI: quelli la cui precondizione e' soddisfatta ma che NON hanno una pagina
   * propria — perche' il sito e' una one-pager o perche' `maxPages` li ha tagliati — e che
   * questa pagina prende in casa. Sulla home e' l'elenco degli assorbiti, in ordine di
   * priorita'; su una pagina interna e' VUOTO, perche' una pagina interna non assorbe nulla.
   *
   * NON E' L'ELENCO DELLE SEZIONI CHE LA PAGINA RENDE, e la distinzione e' costata una
   * verifica avversariale: il campo si chiamava `section_roles` e il suo JSDoc diceva "i ruoli
   * le cui sezioni questa pagina porta", cosa FALSA su una home MULTI-PAGINA. Misurato: col
   * brief piu' ricco e `maxPages: 10` la home valeva ['home'], mentre tutte e cinque le
   * direzioni le fanno comporre anche le sezioni di offerte, orari, contatti e faq — che hanno
   * una pagina propria. Il motivo e' un invariante di T-210 (OGNI blocco dichiara il ruolo
   * 'home') piu' le `home_blocks` delle ricette. Quali sezioni una pagina renda davvero lo
   * decide la RICETTA (T-212, `applyRecipe`), non questo campo: qui c'e' solo l'informazione
   * che la ricetta non ha, cioe' quali ruoli sono rimasti senza casa.
   *
   * E' CIO' CHE RENDE LA ONE-PAGER UNA SCELTA E NON UNA POTATURA: nessun dato si perde, le
   * sezioni tornano dove possono stare. Che possano davvero starci e' l'invariante di T-210;
   * che una delle cinque direzioni non porti la sezione FAQ nella home e' pinnato dal test
   * invece di essere lasciato scoprire a valle.
   */
  readonly absorbed_roles: readonly PageRole[];
};

/** Una voce di navigazione: dove va, che ruolo raggiunge, con quale etichetta i18n. */
export type NavigationEntry = {
  readonly role: PageRole;
  readonly slug: string;
  readonly label_key: NavLabelKey;
};

// ── le soglie ────────────────────────────────────────────────────────────────

/**
 * LA SOGLIA DELLA FORMA: sotto questo numero di pagine superstiti il sito resta una ONE-PAGER
 * e le sezioni rientrano nella home.
 *
 * PERCHE' TRE: due pagine sono una home piu' una pagina che ripete una sezione che la home
 * porta gia' — cioe' un secondo indirizzo da indicizzare per lo stesso contenuto, che e'
 * esattamente il caso che P2-D13 vuole evitare. Servono ALMENO DUE pagine interne perche' un
 * menu di navigazione abbia qualcosa da offrire e perche' il sito sia davvero "multi-pagina
 * semplice". Il numero e' una decisione di prodotto e il test lo pinna dai due lati (due
 * superstiti collassano, tre no), non leggendo questa costante.
 *
 * L'INVARIANTE CHE QUESTO NUMERO DEVE RISPETTARE, dichiarato perche' non e' ovvio: deve
 * essere ALMENO 2, altrimenti un risultato di una pagina sola verrebbe dichiarato
 * 'multi-page' e le due letture della forma divergerebbero.
 */
export const PAGES_MIN = 3;

/**
 * La soglia della PAGINA offerte, contro l'una della SEZIONE (T-210, `MIN_OFFERTE`). Sotto
 * quattro voci l'elenco sta bene dentro la home e una pagina dedicata sarebbe mezza vuota;
 * da quattro in su la pagina ha un contenuto proprio. NON e' una seconda copia della
 * precondizione di T-210 — quella la chiede `blocksFor` — e' una soglia PIU' ALTA sullo
 * stesso campo, che il commento di T-210 assegna esplicitamente a questo task.
 */
const PAGE_MIN_OFFERTE = 4;

/**
 * La soglia della PAGINA contatti: almeno DUE recapiti fra indirizzo, telefono, whatsapp ed
 * email, contro l'UNO (in OR con l'indirizzo) che basta alla sezione (T-210). Una pagina il
 * cui intero contenuto e' un numero di telefono e' la pagina sottile; due recapiti — o un
 * indirizzo e un canale — sono una pagina di contatti vera.
 */
const PAGE_MIN_RECAPITI = 2;

// ── predicati sui dati del brief ─────────────────────────────────────────────

/**
 * Un testo del brief e' "presente" solo se non e' vuoto DOPO il trim: lo schema del brief
 * trima il solo `business_name` (T-121), quindi un `address` di soli spazi e' un valore valido
 * che conterebbe come recapito senza esserlo.
 *
 * E' LA STESSA LETTURA CHE T-210 APPLICA, e la ripetizione e' dichiarata: quel modulo e'
 * committato e verificato e non espone il predicato. Contare i recapiti con una nozione di
 * "presente" diversa dalla sua farebbe divergere le due soglie proprio sul confine — un
 * indirizzo di soli spazi renderebbe esistente la pagina e vuota la riga. Il costo e' questa
 * funzione di due righe; l'alternativa sarebbe aprire un artefatto gia' passato dal
 * checkpoint del proprio macrotask.
 */
function testoPresente(valore: string | undefined): boolean {
  return typeof valore === 'string' && valore.trim().length > 0;
}

/**
 * Le voci dell'offerta. `content` e le sue liste hanno un default nello schema (T-121), quindi
 * su un Brief validato ci sono sempre: la guardia serve solo a non far cadere una funzione
 * pura se il chiamante passa un oggetto costruito a mano.
 */
function quanteOfferte(brief: Brief): number {
  return (brief.content?.offerings ?? []).length;
}

/** Quanti RECAPITI il brief porta. L'indirizzo conta: e' il modo di raggiungere un luogo. */
function quantiRecapiti(brief: Brief): number {
  return [brief.address, brief.phone, brief.whatsapp, brief.email].filter(testoPresente).length;
}

// ── il catalogo ──────────────────────────────────────────────────────────────

/**
 * I blocchi che giustificano la pagina ESISTONO per quel ruolo — chiesto a T-210, che applica
 * la precondizione sui dati e il filtro sul ruolo. Non si riscrive nessuna delle due regole:
 * riscriverle vorrebbe dire due verita' sulla stessa cosa, e prima o poi due verita' diverse.
 *
 * E' UNA CONGIUNZIONE (`every`) e non una disgiunzione: i blocchi giustificanti sono la
 * SOSTANZA della pagina, quindi se ne manca uno la pagina non ha piu' cio' che la giustifica.
 * DICHIARATO E MISURATO: oggi ogni ruolo ne elenca UNO SOLO, quindi la differenza fra le due
 * letture non e' osservabile — la mutazione `every` -> `some` lascia verde l'intero file di
 * test. E' una scelta presa in anticipo, non una proprieta' provata.
 *
 * IL RUOLO PASSATO A `blocksFor` E' QUELLO DELLA PAGINA, e anche qui la misura e' stata fatta
 * invece di essere supposta: passare 'home' darebbe oggi lo STESSO risultato per ogni brief,
 * perche' ogni blocco giustificante dichiara ANCHE il ruolo 'home' (invariante di T-210, che il
 * test pinna). Le due scritture sono percio' equivalenti oggi e non lo sarebbero il giorno in
 * cui un blocco smettesse di dichiarare 'home': l'argomento giusto per SIGNIFICATO e' il ruolo
 * della pagina, ed e' quello che resta.
 *
 * L'appartenenza e' per UGUAGLIANZA (`Set.has`) e mai per prefisso, e l'indice e' un `Set` e
 * non un oggetto: gli id vengono dal nostro codice, ma un oggetto indicizzato per stringa
 * risolverebbe comunque i membri di Object.prototype e farebbe "esistere" un blocco chiamato
 * 'constructor'.
 */
function sezioniPresenti(
  brief: Brief,
  ruolo: PageRole,
  blocchi: readonly [string, ...string[]],
): boolean {
  const esistenti = new Set(blocksFor(brief, ruolo).map((blocco) => blocco.id));
  return blocchi.every((id) => esistenti.has(id));
}

/**
 * Costruisce la voce di una pagina interna DICHIARANDO GLI ID UNA VOLTA SOLA: la precondizione
 * e' derivata da `justifying_blocks` invece di ripeterli, cosi' i due non possono divergere.
 * `soglia_di_pagina` e' la parte PROPRIA della pagina, quella piu' alta della sezione; dove e'
 * omessa la soglia della pagina coincide con quella della sezione e il perche' e' scritto
 * sulla voce.
 */
function paginaInterna(voce: {
  readonly role: InnerPageRole;
  readonly slug: string;
  readonly priority: number;
  readonly label_key: NavLabelKey;
  readonly justifying_blocks: readonly [string, ...string[]];
  readonly soglia_di_pagina?: (brief: Brief) => boolean;
}): InnerPageDefinition {
  const { soglia_di_pagina, ...dichiarato } = voce;
  return {
    ...dichiarato,
    precondition: (brief) =>
      sezioniPresenti(brief, voce.role, voce.justifying_blocks) &&
      (soglia_di_pagina === undefined || soglia_di_pagina(brief)),
  };
}

/**
 * LA HOME. Priorita' massima, e la sola voce priva di precondizione E di blocchi giustificanti
 * (vedi `HomePageDefinition`): la home esiste per qualunque brief confermato, quindi non c'e'
 * nulla che la giustifichi e nulla che la possa negare. Il blocco 'hero' e' cio' che la APRE —
 * esiste appena c'e' un nome, il minimo perche' un brief sia 'confirmed' (T-122) — ma quella e'
 * una proprieta' del catalogo dei blocchi e delle ricette, non di questa voce, e tenerla scritta
 * qui aveva prodotto una dichiarazione che nessun comportamento poteva smentire.
 */
const PAGINA_HOME: HomePageDefinition = {
  role: RUOLO_HOME,
  slug: 'home',
  priority: 100,
  label_key: 'site.nav.home',
};

/**
 * LE PAGINE INTERNE, in un record TOTALE PER TIPO: un ruolo di pagina nuovo in T-201 non
 * compila finche' non compare anche qui, e allora bisogna DECIDERE il suo slug, la sua
 * priorita' e la sua precondizione invece di lasciarlo nascere come una pagina che non esiste
 * mai (o, peggio, che esiste sempre).
 *
 * L'ORDINE DI DICHIARAZIONE e' quello del vocabolario di T-201 e NON quello di priorita': e'
 * deliberato, perche' un taglio che seguisse l'ordine di dichiarazione invece di quello di
 * priorita' deve poter essere osservato mentre sbaglia. Le chiavi sono stringhe non numeriche,
 * quindi `Object.values` le enumera in ordine di inserimento (specifica del linguaggio) e
 * l'ordine del catalogo e' deterministico; il test lo pinna.
 */
const PAGINE_INTERNE_PER_RUOLO: Readonly<Record<InnerPageRole, InnerPageDefinition>> = {
  // Cio' che si vende, ed e' la pagina interna che vale di piu' per un'attivita' locale: e' la
  // ragione per cui qualcuno cerca il sito. Priorita' massima fra le interne, quindi e' la
  // prima a sopravvivere a un tetto di piano basso.
  offerings: paginaInterna({
    role: 'offerings',
    slug: 'offerte',
    priority: 90,
    label_key: 'site.nav.offerings',
    justifying_blocks: ['offerte'],
    soglia_di_pagina: (brief) => quanteOfferte(brief) >= PAGE_MIN_OFFERTE,
  }),
  // QUANDO si e' aperti. LA SOGLIA DELLA PAGINA E' QUELLA DELLA SEZIONE, ed e' una scelta
  // dichiarata e non una dimenticanza: `hours` e' una mappa a CHIAVI LIBERE (P1-D13), quindi
  // contarne le chiavi NON misura quanta informazione la pagina porta — 'lun-dom' e' UNA
  // chiave e copre la settimana intera, mentre sette chiavi possono dire meno. Qualunque
  // tetto sul numero di chiavi rifiuterebbe una settimana completa scritta bene, cioe'
  // farebbe sparire una pagina legittima per far posto a una regola. Contro la pagina sottile
  // qui difende PAGES_MIN, che e' una misura sul SITO e non una misura inventata sul dato.
  hours: paginaInterna({
    role: 'hours',
    slug: 'orari',
    priority: 70,
    label_key: 'site.nav.hours',
    justifying_blocks: ['orari'],
  }),
  // COME si viene raggiunti. La soglia della pagina e' piu' alta di quella della sezione
  // (vedi `PAGE_MIN_RECAPITI`).
  contact: paginaInterna({
    role: 'contact',
    slug: 'contatti',
    priority: 80,
    label_key: 'site.nav.contact',
    justifying_blocks: ['contatti'],
    soglia_di_pagina: (brief) => quantiRecapiti(brief) >= PAGE_MIN_RECAPITI,
  }),
  // RECENSIONI — IL NODO, dichiarato invece che aggirato, ed e' la stessa scelta che T-210 ha
  // fatto sul blocco e T-212 sulle ricette. Il Brief v1 NON HA alcun campo che porti
  // recensioni, quindi il blocco 'recensioni' non e' soddisfatto da alcun brief
  // (`precondition: () => false`, T-210) e questa pagina non esiste mai.
  // LA VOCE RESTA NEL CATALOGO, col suo slug e la sua priorita': cancellarla nasconderebbe la
  // decisione, e il giorno in cui una sorgente di recensioni entrera' nel brief la pagina
  // nascera' da sola senza che qualcuno debba ricordarsi di riaprire questo file. La sua
  // precondizione NON e' un `false` scritto qui: e' DERIVATA da `blocksFor`, quindi dice la
  // verita' su quell'assenza ed e' l'assenza a decidere, non questo modulo. E' pinnata dal
  // test, che diventa rosso il giorno in cui la sorgente arrivera'.
  reviews: paginaInterna({
    role: 'reviews',
    slug: 'recensioni',
    priority: 50,
    label_key: 'site.nav.reviews',
    justifying_blocks: ['recensioni'],
  }),
  // Le domande frequenti. LA SOGLIA DELLA PAGINA E' QUELLA DELLA SEZIONE, e la ragione e'
  // diversa da quella degli orari: alzarla vorrebbe dire contare le "materie" del brief, e
  // quel conteggio vive in T-210 (`materieFaq`, non esportato, e quel modulo non si tocca).
  // Riscriverlo qui sarebbe una SECONDA verita' sulla stessa cosa — esattamente il difetto
  // che questo modulo evita non riscrivendo `blocksFor` — e divergerebbe in silenzio il primo
  // giorno in cui una delle due cambia. Fra una soglia piu' alta e una sola verita' si scegle
  // la seconda, e si dichiara la conseguenza: con esattamente tre materie la pagina FAQ
  // esiste, e la difesa contro il sito sottile resta PAGES_MIN.
  // Lo slug NON e' 'faq': 'domande-frequenti' e' cio' che un visitatore legge nell'URL, ed e'
  // anche il solo slug che non coincide col nome del blocco che lo giustifica.
  faq: paginaInterna({
    role: 'faq',
    slug: 'domande-frequenti',
    priority: 60,
    label_key: 'site.nav.faq',
    justifying_blocks: ['faq'],
  }),
};

/**
 * IL CATALOGO DELLE PAGINE: per ogni ruolo di pagina, lo slug, la priorita', l'etichetta di
 * navigazione, i blocchi che la giustificano e — per le sole pagine interne — la precondizione
 * sui dati. La home prima, poi le interne nell'ordine di dichiarazione.
 *
 * Esportato perche' e' la DICHIARAZIONE: chi deve sapere quali pagine il prodotto conosce
 * legge questa lista e non il corpo di `pagesFor`. Ed e' anche la lista che `pagesFor` LEGGE —
 * non una copia parallela: una seconda lista interna renderebbe possibile un catalogo esportato
 * che dice una cosa e una derivazione che ne usa un'altra, cioe' una dichiarazione che il test
 * giudica e un comportamento che nessuno giudica.
 */
export const PAGE_CATALOG: readonly PageDefinition[] = [
  PAGINA_HOME,
  ...Object.values(PAGINE_INTERNE_PER_RUOLO),
];

/**
 * Restringe al tipo delle pagine INTERNE, cioe' a quelle che hanno una precondizione. Il
 * confronto e' col letterale del ruolo home: e' il discriminante dell'unione, quindi dopo
 * questa guardia l'accesso a `precondition` e' totale per tipo e non c'e' alcun ramo in cui
 * possa essere `undefined`.
 */
function eInterna(voce: PageDefinition): voce is InnerPageDefinition {
  return voce.role !== RUOLO_HOME;
}

// ── le due funzioni pure ─────────────────────────────────────────────────────

/**
 * Il numero minimo di pagine che un set puo' avere: la home, che non e' tagliabile. E' anche
 * il valore a cui qualunque `maxPages` insensato viene ricondotto.
 */
const SOLO_LA_HOME = 1;

/**
 * Il tetto EFFETTIVO di pagine. `maxPages` e' un `number` e la funzione e' pura, quindi lo
 * zero, i negativi, i non interi e i non finiti sono tutti rappresentabili anche se la colonna
 * del DB li vincola (T-204: intero, fra 1 e `DOCUMENT_LIMITS.max_pages`). "La home esiste
 * sempre" e' DoD e vale anche per un tetto insensato, quindi il risultato non scende mai sotto
 * uno.
 * - `Math.floor` perche' un tetto di 2,7 pagine sono al piu' DUE pagine;
 * - `NaN` non e' un tetto e non e' confrontabile: si ricade sulla sola home, che e' il verso
 *   prudente (`Math.max(1, NaN)` sarebbe NaN e uno `slice` con NaN taglierebbe TUTTO, home
 *   compresa);
 * - `+Infinity` significa "nessun tetto" e attraversa `floor` e `max` intatto.
 */
function tettoDiPagine(maxPages: number): number {
  if (Number.isNaN(maxPages)) return SOLO_LA_HOME;
  return Math.max(SOLO_LA_HOME, Math.floor(maxPages));
}

/** Priorita' DECRESCENTE. Le priorita' sono distinte, quindi l'ordine e' totale. */
function perPrioritaDecrescente(a: PageDefinition, b: PageDefinition): number {
  return b.priority - a.priority;
}

function specDi(
  voce: PageDefinition,
  shape: PageSpec['shape'],
  absorbed_roles: readonly PageRole[],
): PageSpec {
  return {
    role: voce.role,
    slug: voce.slug,
    label_key: voce.label_key,
    shape,
    absorbed_roles,
  };
}

/**
 * IL SET DI PAGINE che esistono per questo brief sotto questo tetto, in ordine di priorita'
 * DECRESCENTE.
 *
 * Quattro passi, e l'ordine fra loro e' il contenuto della decisione:
 * 1. SUPERSTITI: le pagine interne la cui precondizione e' soddisfatta, ordinate per
 *    priorita'. `filter` PRIMA di `sort` non e' un caso: `sort` ordina IN PLACE, e ordinare il
 *    catalogo esportato lo corromperebbe alla prima chiamata — l'ordine di dichiarazione
 *    diventerebbe quello di priorita' e la differenza fra i due, su cui poggia l'oracolo del
 *    taglio, sparirebbe per sempre. Qui `sort` lavora sull'array FRESCO che `filter` produce,
 *    quindi la corruzione non e' scrivibile senza un cast esplicito che tolga il `readonly`.
 * 2. TAGLIO a `maxPages`, sulle sole interne: la home occupa il primo posto e non e' in gioco.
 * 3. FORMA: se le pagine tenute sono MENO di `PAGES_MIN`, il sito e' una ONE-PAGER e le
 *    interne rientrano tutte nella home. La soglia si applica DOPO il taglio e non prima, ed
 *    e' l'unica lettura coerente: un tetto di due pagine non deve produrre un sito di due
 *    pagine dichiarato "multi-pagina", deve produrre una one-pager.
 * 4. ASSORBIMENTO: ogni ruolo superstite senza pagina propria diventa una sezione della home,
 *    in ordine di priorita'. Nessun dato si perde per strada.
 *
 * LA HOME E' PRESA PER RUOLO e non per posizione nell'ordinamento: e' cio' che rende "la home
 * esiste sempre" una proprieta' del codice invece di una conseguenza di un numero. Che abbia
 * anche la priorita' massima — quindi che il primo posto sia anche il suo posto nell'ordine —
 * e' una coerenza che il test pinna. MISURATO, e va detto invece di vantarlo: finche' quella
 * coerenza vale, prendere la prima voce dell'ordinamento darebbe lo stesso risultato, quindi la
 * scelta strutturale NON e' osservabile da sola. Cio' che la rende utile e' il caso in cui la
 * coerenza si rompe — una priorita' modificata per sbaglio — e la' la home resta comunque.
 *
 * PURA E DETERMINISTICA: non legge nulla fuori dai propri argomenti, non muta il catalogo, non
 * porta stato fra due chiamate. Gli stessi argomenti danno lo stesso risultato e argomenti
 * diversi danno risultati che li distinguono — sono DUE proprieta', ed e' su entrambe che
 * `resolve` (T-214) poggia per essere deterministica a sua volta.
 */
export function pagesFor(
  brief: Brief,
  options: { readonly maxPages: number },
): readonly PageSpec[] {
  const superstiti = PAGE_CATALOG.filter(eInterna)
    .sort(perPrioritaDecrescente)
    .filter((voce) => voce.precondition(brief));

  const tenute = superstiti.slice(0, tettoDiPagine(options.maxPages) - SOLO_LA_HOME);
  const onePager = SOLO_LA_HOME + tenute.length < PAGES_MIN;
  const shape: PageSpec['shape'] = onePager ? 'one-pager' : 'multi-page';

  const interne = onePager ? [] : tenute;
  const conPaginaPropria = new Set<PageRole>(interne.map((voce) => voce.role));
  const assorbiti = superstiti
    .map((voce) => voce.role)
    .filter((ruolo) => !conPaginaPropria.has(ruolo));

  // La home porta gli ASSORBITI e non se stessa: il proprio ruolo lo dice gia' `role`, e
  // includerlo qui aveva reso il campo un elenco di "sezioni rese" che su una home
  // multi-pagina diceva il falso. Una pagina interna non assorbe nulla.
  return [
    specDi(PAGINA_HOME, shape, assorbiti),
    ...interne.map((voce) => specDi(voce, shape, [])),
  ];
}

/**
 * LA NAVIGAZIONE del set: una voce per ciascuna pagina, nell'ordine del set, e per nessun'altra.
 *
 * E' UNA PROIEZIONE, ed e' tutto il punto (vedi l'intestazione): la destinazione e' COPIATA
 * dalla pagina, quindi non esiste modo di scrivere una voce verso una pagina che il set non
 * contiene — nessun 404 interno, non perche' qualcuno lo sorvegli ma perche' non c'e' la
 * strada. Non consulta `PAGE_CATALOG`: se lo facesse potrebbe emettere una voce per un ruolo
 * assente dal set, e servirebbe una guardia. Su un set vuoto non inventa nulla, su un set
 * senza home non inventa la home.
 *
 * E' ANCHE LA SOLA SORGENTE DEI LINK INTERNI, e va detto perche' non si deduce: chi a valle
 * (T-231/T-235) vuole rimandare a un'altra pagina prende la destinazione da qui, non
 * componendo un percorso da un ruolo. Un ruolo che non e' nel set non ha voce, quindi non ha
 * destinazione da cui copiare.
 *
 * NON DEDUPLICA e non riordina: riproduce fedelmente il set che riceve, come `applyRecipe`
 * (T-212) riproduce la sequenza dichiarata. Che gli slug siano univoci e' una proprieta' di
 * `pagesFor` (un ruolo, uno slug) e un vincolo del documento (`parseDocument`, T-202):
 * ripararlo qui toglierebbe il rosso al solo giudice che un set malformato ha.
 */
export function navigationFor(pageSpecs: readonly PageSpec[]): readonly NavigationEntry[] {
  return pageSpecs.map((pagina) => ({
    role: pagina.role,
    slug: pagina.slug,
    label_key: pagina.label_key,
  }));
}
