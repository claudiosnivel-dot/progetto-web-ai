// T-212 (macrotask generation-engine, P2) — LE CINQUE RICETTE: le direzioni fra cui
// l'utente scegle. Ogni ricetta ha un id stabile e VERSIONATO, la sequenza ORDINATA dei
// blocchi della home, il tema associato (T-211) e le regole di composizione delle pagine
// interne. Dominio PURO: nessun accesso al DB, nessun I/O, nessun side effect — e la sola
// dipendenza a runtime e' `blocksFor` (T-210), perche' la composizione non riscrive le
// precondizioni: le CHIEDE al catalogo.
//
// P2-D1 COME PROPRIETA' DEL CODICE, non come frase in un prompt: la struttura del sito e'
// DICHIARATA QUI, a mano, da noi. Il modello non sceglie ne quali sezioni esistono, ne in
// che ordine stanno, ne su quale pagina finiscono — scrive prosa dentro gli slot che T-220
// gli concede. Ne segue la conseguenza di sicurezza: un'iniezione riuscita nel testo del
// brief NON PUO' alterare la struttura del sito generato, perche' non esiste alcun percorso
// dal testo del brief a questo file. E' la prima delle due leve che il modello non ha;
// l'altra e' il tema (T-211, dove `brand_hints` e' escluso come selettore per la stessa
// ragione). E' anche il punto in cui la garanzia di bellezza diventa codice: cinque
// direzioni scelte da noi non possono degenerare, una struttura improvvisata a ogni
// generazione si'.
//
// CINQUE DIREZIONI UNIVERSALI, NON CINQUE PER VERTICALE (P2-D1): sono cinque modi di
// mettere in fila le stesse sezioni — cosa si dice per primo e a chi si parla — non cinque
// settori. La specializzazione di settore vive nel BLOCCO OFFERTE (T-210,
// `resolveOfferings`: etichetta, layout, presenza del prezzo per `vertical`), ed e' per
// questo che le direzioni sono cinque e non venticinque.
//
// GLI ID NASCONO VERSIONATI, ed e' una PRECONDIZIONE EREDITATA e misurata (T-202,
// 2026-07-28): il documento congelato REGISTRA `recipe_id` nella forma 'nome-kebab@N' e un
// id senza '@N' fa cadere l'INTERO documento, non solo il campo. La versione e' DENTRO l'id
// e non accanto perche' e' cosi' che un ritocco futuro a una ricetta non riscrive un sito
// GIA' SCELTO: cambiare la sequenza di 'vetrina-dell-offerta@1' senza passare a '@2'
// significa cambiare sotto i piedi i siti che quell'id citano. Chi ritocca una sequenza
// alza la versione; chi non vuole alzarla non ritocca.
//
// IL CARATTERE DI OGNI DIREZIONE E' DICHIARATO IN UN COMMENTO, MA IL COMMENTO NON E'
// UN'ASSERZIONE (L-COL-006): "la vetrina", "il racconto di bottega", "chi vive del
// passaggio" dicono a chi parla la direzione e cosa mette davanti, e servono a chi in futuro
// dovra' scegliere dove mettere le mani. Nessun test prova che una direzione sia BELLA ne
// che converta meglio di un'altra — lo stile non e' oracolabile (P1 §6-bis p.8). Cio' che i
// test provano e' che le cinque sequenze sono davvero CINQUE E DIVERSE, che ogni
// riferimento esiste ed e' coerente col catalogo, e che la composizione scarta per
// precondizione conservando l'ordine dichiarato.
//
// LE PAGINE INTERNE SI ASSOMIGLIANO, e va detto perche' invece di lasciarlo notare: le
// regole di composizione delle pagine interne sono quasi identiche fra le cinque direzioni,
// e NON e' una scorciatoia. E' cio' che il catalogo di T-210 permette — per il ruolo
// 'offerings' l'unico blocco che lo dichiara e' 'offerte', per 'hours' e' 'orari', per
// 'reviews' e' 'recensioni', per 'faq' e' 'faq'. L'UNICA pagina interna su cui una
// direzione ha una scelta vera e' 'contact', dove convivono 'contatti' e 'cta-whatsapp': ed
// e' li' che la scelta e' esercitata. Inventare varieta' citando altri blocchi
// produrrebbe regole MUTE (un blocco che non dichiara quel ruolo non verra' mai composto,
// senza errore da nessuna parte), che e' precisamente il difetto che il test pinna. La
// direzione vive dunque nella HOME, dove tutti i blocchi possono comparire.
//
// IL BLOCCO RECENSIONI — IL NODO, deciso e non aggirato. Il Brief v1 non ha alcun campo che
// porti recensioni, quindi la precondizione di quel blocco non e' soddisfatta da nessun
// brief (T-210, `precondition: () => false`). LA DECISIONE PRESA QUI: 'recensioni' e'
// citato nelle regole della pagina 'reviews' di tutte e cinque le direzioni, e in NESSUNA
// `home_blocks`.
// - CITATO fra le regole della pagina reviews perche' la STRUTTURA la dichiariamo noi e
//   sono i DATI a decidere se una sezione esiste (P2-D1 + P2-D7): il giorno in cui una
//   sorgente di recensioni entrera' nel brief, la pagina si comporra' da sola senza che
//   qualcuno debba ricordarsi di riaprire cinque ricette. E' la stessa scelta con cui T-210
//   ha tenuto la voce nel catalogo invece di cancellarla: cancellarla nasconderebbe la
//   decisione.
// - FUORI da `home_blocks` perche' la home e' l'unica pagina che esiste SEMPRE (P2-D13) e va
//   composta con cio' che c'e': un blocco che nessun dato puo' soddisfare, messo fra i
//   blocchi della home, renderebbe per giunta non verificabile l'acceptance criterion
//   AC-212-2, che chiede un brief per cui TUTTI i blocchi della home soddisfino la propria
//   precondizione. Un criterio che nessun dato puo' soddisfare non e' un criterio severo:
//   e' un criterio morto.
// CONSEGUENZA DICHIARATA: fino a quel giorno la pagina 'reviews' non compone nulla e T-213
// non la produrra'. E' pinnata da tests/generation-recipes.test.ts, che diventa rosso quando
// la sorgente arrivera' — cosi' la decisione torna sul tavolo invece di restare implicita.
//
// COSA NON C'E' QUI, deliberatamente:
// - QUALI pagine esistono (T-213): qui c'e' come si compone una pagina di un certo RUOLO,
//   non se quella pagina esista. Il set di pagine lo derivano i dati;
// - la COSTRUZIONE del documento (T-214): questo modulo non riempie slot, non tocca il pool
//   e non produce alcun SiteDocument — dice solo quali blocchi, e in che ordine;
// - il RENDERING (T-231) e la sanificazione: il contratto di cio' che va sanificato e' dei
//   blocchi (`brief_fields_rendered`, T-210), e questo modulo non lo tocca;
// - la VARIANTE del blocco offerte: e' di T-210 (`resolveOfferings`), e ridichiararla qui la
//   scriverebbe due volte.

import { blocksFor } from '@/domain/generation/blocks';
import type { Brief } from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';

/**
 * Una voce del catalogo dei blocchi (T-210). E' DERIVATA dal tipo di ritorno di
 * `blocksFor` perche' `BlockDefinition` non e' esportata la': ricopiarne la forma qui
 * creerebbe un secondo contratto che divergerebbe in silenzio dal primo.
 */
type BlockDefinition = ReturnType<typeof blocksFor>[number];

/**
 * Il ruolo della home. E' `satisfies PageRole` e non `: PageRole` per due ragioni insieme:
 * il tipo resta il letterale 'home' (quindi il confronto in `applyRecipe` RESTRINGE il
 * parametro ai soli ruoli interni, e l'accesso a `inner_page_rules` e' totale per tipo), e
 * il valore e' comunque verificato contro il vocabolario di T-201 — se quel catalogo
 * perdesse il ruolo 'home' questa riga non compilerebbe.
 */
const RUOLO_HOME = 'home' satisfies PageRole;

/**
 * I ruoli delle PAGINE INTERNE: tutti quelli del vocabolario di T-201 tranne la home, la
 * cui sequenza vive in `home_blocks`. Derivato e non elencato a mano: un ruolo di pagina
 * nuovo in T-201 rompe il typecheck di ogni ricetta e obbliga a DECIDERE come si compone
 * quella pagina, invece di lasciarla nascere vuota.
 */
type InnerPageRole = Exclude<PageRole, typeof RUOLO_HOME>;

/**
 * UNA DIREZIONE.
 *
 * `home_blocks` e `inner_page_rules` sono SEQUENZE, non insiemi: l'ordine e' il contenuto
 * della decisione, ed e' cio' che distingue una direzione da un'altra piu' spesso di quali
 * sezioni ci siano. Gli id dei blocchi sono `string` e non un'unione chiusa perche' il
 * catalogo di T-210 e' tipizzato `readonly BlockDefinition[]` e non come tupla letterale:
 * al livello dei tipi l'id non e' derivabile, quindi l'assenza di riferimenti pendenti e'
 * un oracolo di RUNTIME (AC-212-3) e non una garanzia del compilatore. E' una precondizione
 * dichiarata, non una svista.
 */
export type SiteRecipe = {
  /**
   * Identificatore STABILE e VERSIONATO nella forma 'nome-kebab@N', che e' quella richiesta
   * da `SiteDocumentSchema` (T-202) per `recipe_id`. Qui non e' confrontato con quello
   * schema — il confronto vive dove il documento si costruisce (T-214) — ma e' scelto per
   * passarlo, e il test lo verifica DERIVANDO il controllo da quello schema e passando dal
   * gate vero (`parseDocument`).
   */
  readonly id: string;
  /** L'id versionato del tema associato: uno dei cinque di T-211, distinto per ogni ricetta. */
  readonly theme_id: string;
  /** La sequenza ORDINATA dei blocchi della home, con gli id del catalogo di T-210. */
  readonly home_blocks: readonly string[];
  /**
   * Per ogni ruolo di pagina INTERNO, quali blocchi comporre e in quale ordine. Il record e'
   * TOTALE PER TIPO: una regola mancante non compila, perche' una pagina senza blocchi non
   * e' un documento valido (T-202 chiede almeno un blocco per pagina).
   */
  readonly inner_page_rules: Readonly<Record<InnerPageRole, readonly string[]>>;
};

/**
 * LE CINQUE DIREZIONI, nell'ordine in cui vengono offerte. Ogni tema di T-211 e' usato da
 * esattamente una direzione: sono cinque coppie, non cinque sequenze piu' un tema a caso.
 *
 * COME LEGGERE LE SEQUENZE: la home apre sempre con 'hero' — e' l'unica sezione che
 * dichiara il solo ruolo 'home' (T-210) e la sola che nomina l'attivita' — e cio' che viene
 * SUBITO DOPO e' la direzione. Il resto della sequenza dice cosa la direzione considera
 * accessorio, e cosa non mette affatto.
 */
export const RECIPES: readonly SiteRecipe[] = [
  {
    // VETRINA DELL'OFFERTA — per chi ha qualcosa da leggere e scegliere: osterie,
    // trattorie, forni, gastronomie. Dopo l'apertura viene subito CIO' CHE SI VENDE, poi
    // QUANDO si e' aperti (in questo mestiere si decide sapendo se si mangia stasera), e
    // solo dopo il racconto. Chiude con le domande, i contatti e l'invito a scrivere.
    id: 'vetrina-dell-offerta@1',
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
  {
    // RACCONTO DI BOTTEGA — per chi vende fiducia prima del listino: laboratori, negozi di
    // quartiere, produttori. Il RACCONTO viene prima dell'offerta, perche' qui si compra la
    // persona e il mestiere; gli orari scendono in coda, perche' si passa dopo aver deciso.
    // E' la stessa sequenza della vetrina con le prime due sezioni scambiate: la differenza
    // fra le due direzioni e' TUTTA nell'ordine, ed e' voluto che si veda.
    id: 'racconto-di-bottega@1',
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
  {
    // SCATTO ALLA CONVERSIONE — per chi vive di prove e primi contatti: palestre, box di
    // functional training, scuole. L'INVITO A SCRIVERE risale subito sotto l'apertura, e la
    // home resta CORTA: nessuna sezione FAQ, perche' qui la domanda a cui si vuole
    // rispondere e' una sola e la si risponde in chat, non in un elenco. E' l'unica
    // direzione che rinuncia a una sezione per accorciare la strada verso l'azione.
    id: 'scatto-alla-conversione@1',
    theme_id: 'scatto-vitale@1',
    home_blocks: ['hero', 'cta-whatsapp', 'offerte', 'chi-siamo', 'contatti', 'orari'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      // L'unica pagina interna su cui una direzione ha una scelta, ed e' esercitata: qui
      // l'invito a scrivere sta PRIMA dell'elenco dei recapiti, coerentemente con la home.
      contact: ['cta-whatsapp', 'contatti'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
  {
    // MAPPA E ORARI — per chi vive del passaggio fisico: B&B, stabilimenti, servizi al
    // turismo, attivita' che si trovano prima di essere scelte. QUANDO e DOVE stanno in
    // cima, prima di qualunque altra cosa; l'offerta e il racconto vengono dopo, perche' chi
    // guarda ha gia' deciso cosa cerca e deve solo capire se ci arriva.
    id: 'mappa-e-orari@1',
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
  {
    // SCHEDA SOBRIA — per studi professionali, consulenti, saloni con clientela urbana: chi
    // non vuole insistere. Il racconto e le domande frequenti vengono prima del listino, e
    // la home NON PORTA il bottone WhatsApp — il numero resta fra i recapiti della sezione
    // contatti, dove chi lo cerca lo trova, e l'invito a scrivere vive sulla PAGINA
    // contatti. NESSUN DATO SI PERDE: `whatsapp` e' reso anche dal blocco contatti (T-210 lo
    // dichiara e ne ha misurato il costo), quindi togliere la CTA dalla home toglie
    // l'insistenza, non il recapito.
    id: 'scheda-sobria@1',
    theme_id: 'linea-essenziale@1',
    home_blocks: ['hero', 'chi-siamo', 'faq', 'offerte', 'orari', 'contatti'],
    inner_page_rules: {
      offerings: ['offerte'],
      hours: ['orari'],
      // Qui l'invito a scrivere c'e': e' la pagina in cui e' atteso, e non e' un'insistenza.
      contact: ['contatti', 'cta-whatsapp'],
      reviews: ['recensioni'],
      faq: ['faq'],
    },
  },
];

/**
 * La ricetta con questo id, o `undefined` se non esiste. Il confronto e' per UGUAGLIANZA
 * ESATTA e mai per prefisso: gli id sono versionati, quindi 'vetrina-dell-offerta' e
 * 'vetrina-dell-offerta@1' sono due stringhe diverse e la prima non e' una ricetta — un
 * confronto lasco farebbe registrare nel documento (T-202) un id che nessuna versione ha mai
 * prodotto.
 *
 * LA RICERCA E' SULL'ARRAY, non su un oggetto indicizzato per id, e non e' un dettaglio di
 * stile: l'id puo' arrivare da un artefatto salvato (il `recipe_id` di un documento gia'
 * scritto), quindi con una mappa-oggetto le chiavi speciali di JavaScript ('__proto__',
 * 'constructor', 'toString') risolverebbero il membro EREDITATO da Object.prototype e questa
 * funzione restituirebbe qualcosa che non e' una ricetta.
 */
export function recipeFor(recipeId: string): SiteRecipe | undefined {
  return RECIPES.find((ricetta) => ricetta.id === recipeId);
}

/**
 * COMPONE una pagina: i blocchi che questa direzione dichiara per quel ruolo e che ESISTONO
 * per questo brief, NELL'ORDINE DICHIARATO DALLA RICETTA.
 *
 * DUE COSE SI INCONTRANO QUI, e nessuna delle due e' riscritta:
 * - CHI ESISTE lo decide il catalogo (`blocksFor`, T-210), che applica la precondizione sui
 *   dati e il filtro sul ruolo di pagina. Riscrivere quelle regole qui vorrebbe dire due
 *   verita' sulla stessa cosa, e prima o poi due verita' diverse;
 * - IN CHE ORDINE lo decide la RICETTA. E' il verso che conta: `blocksFor` restituisce i
 *   superstiti nell'ordine di DICHIARAZIONE DEL CATALOGO, e comporre in quell'ordine
 *   ridurrebbe le cinque direzioni a cinque copie della stessa pagina con cinque temi
 *   diversi.
 *
 * UN BLOCCO SCARTATO NON LASCIA TRACCIA: non diventa un segnaposto, non diventa una sezione
 * vuota, non fa slittare nulla — gli altri conservano il loro ordine relativo (P2-D7). E il
 * silenzio ha un limite dichiarato: se una regola citasse un blocco che non dichiara quel
 * ruolo, il blocco verrebbe scartato allo stesso modo e la regola sarebbe MUTA. Quel caso
 * non e' difeso qui — e' un errore di DICHIARAZIONE, e il suo giudice e' il test che pinna
 * la coerenza fra ricette e catalogo.
 *
 * PURA E DETERMINISTICA: non legge nulla fuori dai propri argomenti, non muta la sequenza
 * dichiarata (nessun `sort` ne `reverse` in place, che corromperebbero il catalogo alla prima
 * chiamata) e non porta stato fra due chiamate. Gli stessi argomenti danno lo stesso
 * risultato, che e' cio' su cui T-214 poggia per essere deterministica a sua volta.
 *
 * L'indice dei superstiti e' una `Map` e non un oggetto: gli id vengono dal nostro codice,
 * ma un oggetto indicizzato per stringa risolverebbe comunque i membri di Object.prototype e
 * farebbe "esistere" un blocco chiamato 'constructor'.
 */
export function applyRecipe(
  recipe: SiteRecipe,
  brief: Brief,
  pageRole: PageRole,
): readonly BlockDefinition[] {
  const dichiarati =
    pageRole === RUOLO_HOME ? recipe.home_blocks : recipe.inner_page_rules[pageRole];
  const esistenti = new Map(blocksFor(brief, pageRole).map((blocco) => [blocco.id, blocco]));

  const composti: BlockDefinition[] = [];
  for (const id of dichiarati) {
    const blocco = esistenti.get(id);
    if (blocco === undefined) continue;
    composti.push(blocco);
  }
  return composti;
}
