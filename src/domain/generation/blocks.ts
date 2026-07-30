// T-210 (macrotask generation-engine, P2) — LIBRERIA DEI BLOCCHI: quali sezioni del
// sito esistono, in quali RUOLI DI PAGINA possono comparire, quali SLOT di prosa
// consumano (T-201), quali CAMPI DEL BRIEF rendono direttamente, e la PRECONDIZIONE
// sui dati che ne determina l'esistenza. Dominio PURO: nessun accesso al DB, nessun
// I/O, nessun side effect — e nessun import a runtime, perche' il modulo e' un
// catalogo dichiarato piu' tre funzioni deterministiche.
//
// P2-D7 COME PROPRIETA' DEL CODICE, non come frase in un prompt: un blocco senza base
// dati NON ESISTE. Non esiste vuoto, non esiste col lorem ipsum, non esiste come
// segnaposto da riempire dopo. Ne segue che il modello non riceve nemmeno gli slot di
// quel blocco (T-220) e non ha la POSSIBILITA' di inventare la sezione: la visione §5
// vieta di inventare, e qui il divieto e' strutturale invece che sperato.
//
// `brief_fields_rendered` E' UN CONTRATTO DI SICUREZZA (OWASP A05:2025), non una nota
// descrittiva: dichiara ESPLICITAMENTE quali campi del brief ogni blocco rende
// DIRETTAMENTE, cioe' DOVE PASSA IL TESTO NON FIDATO che entra da `fromUrl` (T-141) e
// dal modello attraverso `update_brief` (T-132). E' l'elenco che T-231/T-237 devono
// sanificare: un campo reso ma NON dichiarato riporterebbe la superficie di rendering a
// essere implicita, ed e' il difetto grave di questo modulo. I NOMI dei campi sono
// DERIVATI dallo schema del brief (T-121) — la stessa derivazione che usa il documento
// (T-202) — quindi un campo che il brief non ha non e' nominabile e i due elenchi non
// possono divergere in silenzio.
//
// COSA UN CAMPO DICHIARATO SIGNIFICA, ed e' bene non dedurne di piu': significa "il
// sito mette questo valore del brief davanti agli occhi di chi guarda, tale e quale".
// NON sono dichiarati i campi che il blocco CONSULTA senza renderli: `vertical` sceglie
// la variante delle offerte, `primary_goal` sceglie l'etichetta della CTA, `locale`
// sceglie il catalogo i18n — sono enum chiusi (T-121) che selezionano fra valori del
// CODICE (P2-D10), non testo che finisce nella pagina. E non sono dichiarati i campi
// che passano dal MODELLO invece che dal sito: `description`, `highlights` e i nomi
// delle offerte entrano nella proiezione (spec di design §8) e tornano come PROSA negli
// slot, che ha il proprio contratto (T-201) e il proprio gate (PoolSchema).
//
// COSA NON C'E' QUI, deliberatamente:
// - la SEQUENZA dei blocchi di una pagina e il tema: sono le ricette (T-212). Qui
//   l'ordine e' quello di DICHIARAZIONE del catalogo, ed e' l'ordine in cui `blocksFor`
//   restituisce i superstiti;
// - QUALI pagine esistono (T-213): qui c'e' solo l'elenco dei ruoli in cui un blocco
//   PUO' comparire;
// - la SANIFICAZIONE (T-231/T-237) e la costruzione del documento (T-214): questo
//   modulo dichiara DOVE passa il testo non fidato, non lo ripulisce. Ripulirlo qui
//   darebbe l'illusione che il rendering sia sicuro per costruzione, che e' la stessa
//   avvertenza portata da `resolve`.
// - la GALLERIA (P2-D24): fuori dal catalogo v1. In v1 le immagini sono imagery del
//   tema (P2-D12) e `photo_ref` non entra nel documento, quindi un blocco galleria non
//   avrebbe ne dati del brief ne prosa del modello — sarebbe esattamente il blocco
//   segnaposto che P2-D7 vieta. Rientra quando esistera' l'upload (`source: 'uploaded'`,
//   gia' tipizzato in T-202).

import type { Brief, BriefUpdateSchema } from '@/domain/onboarding/brief';
import type { PageRole, SlotId } from '@/domain/generation/slots';
import { testoPresente } from '@/domain/generation/gate';

/**
 * I nomi dei campi del brief nominabili in `brief_fields_rendered`: le chiavi della
 * patch FLAT (T-121), che sono anche quelle che il documento ammette (T-202). Derivati
 * e mai ricopiati — un elenco scritto a mano divergerebbe dallo schema senza che nessun
 * controllo se ne accorga.
 */
type BriefFieldName = keyof (typeof BriefUpdateSchema)['shape'];

/** Una voce dell'offerta come vive nel brief (T-121). */
type Offerta = Brief['content']['offerings'][number];

type BlockDefinition = {
  /**
   * Identificatore stabile: e' cio' che le ricette (T-212) citeranno e cio' che finisce
   * nel documento congelato (T-202). La forma e' quella che `BlockIdSchema` impone la'
   * — minuscole, cifre, trattini singoli interni — perche' un id fuori forma farebbe
   * cadere l'INTERO documento; qui non e' confrontato con quello schema, e' scelto per
   * passarlo (il confronto vive dove il documento si costruisce, T-214).
   */
  readonly id: string;
  /**
   * I ruoli di pagina in cui il blocco puo' comparire. NON VUOTO PER TIPO: una lista
   * vuota sarebbe un blocco che non puo' esistere da nessuna parte, e non deve essere
   * scrivibile. Tutti i blocchi delle pagine interne portano anche 'home', perche'
   * sotto la soglia di T-213 il sito resta una one-pager e le sezioni tornano nella
   * home (AC-213-3).
   */
  readonly page_roles: readonly [PageRole, ...PageRole[]];
  /** Gli slot di prosa che il blocco consuma, dal catalogo di T-201. */
  readonly slots: readonly SlotId[];
  /** I campi del brief che il blocco rende DIRETTAMENTE (vedi l'intestazione). */
  readonly brief_fields_rendered: readonly BriefFieldName[];
  /**
   * La precondizione sui dati: se non e' soddisfatta il blocco NON ESISTE. Pura e
   * totale — non lancia, non legge nulla fuori dal brief, non dipende dall'ordine in
   * cui la si chiama.
   */
  readonly precondition: (brief: Brief) => boolean;
};

// ── predicati sui dati del brief ─────────────────────────────────────────────


/**
 * Le voci dell'offerta. `content` e le sue liste hanno un default nello schema (T-121),
 * quindi su un Brief validato ci sono sempre: la guardia serve solo a non far cadere
 * una funzione pura se il chiamante passa un oggetto costruito a mano.
 */
function offerte(brief: Brief): readonly Offerta[] {
  return brief.content?.offerings ?? [];
}

function evidenze(brief: Brief): readonly string[] {
  return brief.content?.highlights ?? [];
}

/**
 * Gli orari sono utili solo se almeno una voce porta un ORARIO, non solo una chiave:
 * `hours` ammette valori vuoti (T-121), e una mappa di sole chiavi produrrebbe righe
 * vuote — cioe' la sezione presente-e-vuota che P2-D7 esclude.
 */
function orariUtili(brief: Brief): boolean {
  return Object.values(brief.hours ?? {}).some(testoPresente);
}

/** Un canale su cui rispondere. L'indirizzo e' un LUOGO, non un canale: sta a parte. */
function haCanale(brief: Brief): boolean {
  return testoPresente(brief.phone) || testoPresente(brief.whatsapp) || testoPresente(brief.email);
}

/**
 * Soglia del blocco offerte: UNA voce basta perche' la sezione esista, perche' una
 * voce e' gia' un dato vero da mostrare e nasconderla vorrebbe dire buttare cio' che
 * l'utente ha scritto. La soglia PIU' ALTA — quella che evita la pagina sottile — e' di
 * T-213 e vale per la PAGINA: una sezione con una voce dentro la home e' legittima, una
 * PAGINA con una voce sola e' esattamente cio' che il gate di qualita' della visione
 * §10.3-B esclude. Sono due decisioni diverse e vivono in due posti diversi.
 */
const MIN_OFFERTE = 1;

/**
 * Soglia del blocco FAQ. La spec di design §7 chiede "abbastanza materia per generarne
 * un numero minimo": la materia qui e' contata come NUMERO DI DOMANDE FREQUENTI a cui
 * il brief sa gia' rispondere, una per sorgente distinta — chi siete (description),
 * cosa vi distingue (highlights), cosa offrite (offerings), quando siete aperti
 * (hours), come vi contatto (un canale), dove siete (address). Sotto questa soglia il
 * modello dovrebbe inventare le risposte per riempire la sezione, che e' precisamente
 * il comportamento vietato.
 */
const FAQ_MIN_MATERIE = 3;

function materieFaq(brief: Brief): number {
  const sorgenti = [
    testoPresente(brief.description),
    evidenze(brief).some(testoPresente),
    offerte(brief).length >= MIN_OFFERTE,
    orariUtili(brief),
    haCanale(brief),
    testoPresente(brief.address),
  ];
  return sorgenti.filter(Boolean).length;
}

// ── il blocco offerte e le sue varianti per vertical ─────────────────────────

/**
 * Il LAYOUT della sezione offerte. E' un identificatore che il rendering (T-231)
 * interpreta, non una classe CSS ne un valore di stile: qui si dichiara la FORMA della
 * lista, non il suo aspetto (che appartiene al tema, T-211).
 */
type OfferingsLayout =
  | 'menu-sections'
  | 'course-grid'
  | 'service-list'
  | 'catalog-grid'
  | 'simple-list';

/**
 * L'ETICHETTA della sezione e' una CHIAVE i18n, mai una stringa gia' tradotta (P2-D10):
 * le etichette vengono dai cataloghi, non dal modello e non da questo file. Il catalogo
 * delle etichette del SITO GENERATO nasce col rendering (T-231/T-233) ed e' distinto da
 * quello del builder (messages/{it,es}.json): qui vive solo l'identificatore.
 */
type OfferingsLabelKey =
  | 'site.offerings.menu'
  | 'site.offerings.courses'
  | 'site.offerings.services'
  | 'site.offerings.catalog'
  | 'site.offerings.generic';

type OfferingsVariant = {
  readonly label_key: OfferingsLabelKey;
  readonly layout: OfferingsLayout;
  /**
   * Se il prezzo della voce viene RESO. Non e' una preferenza estetica: e' cio' che
   * distingue un menu (dove il prezzo e' parte dell'informazione attesa) da un listino
   * di servizi che si quota di persona.
   */
  readonly show_price: boolean;
};

/**
 * LE VARIANTI PER VERTICAL — il modo per avere CINQUE ricette invece di venticinque
 * (P2-D1): le direzioni restano universali e la specializzazione di settore vive qui.
 *
 * IL RECORD E' TOTALE PER TIPO, ed e' il punto: la chiave e' `Brief['vertical']`, cioe'
 * l'enum di T-121. Un vertical nuovo aggiunto la' rompe `npm run typecheck` su questa
 * riga e obbliga a DECIDERE che aspetto ha la sua sezione offerte, invece di farlo
 * cadere in silenzio nella variante generica.
 *
 * PERCHE' queste differenze, e in particolare il prezzo:
 * - `ristorazione`: il menu e' l'informazione, ed e' raggruppato per portata — il campo
 *   `section` della voce (T-121) e' la sezione del menu. Il prezzo si mostra: un menu
 *   senza prezzi non e' un menu.
 * - `fitness`: corsi e abbonamenti in griglia; il prezzo si mostra perche' e' la prima
 *   domanda di chi cerca una palestra e nasconderlo costringe a telefonare.
 * - `salone_studio`: elenco di servizi, prezzo NON reso. In questo settore il prezzo
 *   dipende dalla persona e dal caso (una piega, una consulenza), e un numero fisso in
 *   vetrina informa meno di quanto fuorvii; il preventivo e' il canale giusto e la CTA
 *   e' li' accanto. CONSEGUENZA DICHIARATA: se l'utente ha scritto un prezzo per una
 *   voce, in questo vertical il sito non lo mostra. E' una scelta di prodotto presa qui
 *   e visibile qui, non un effetto collaterale del layout.
 * - `negozio_artigiano`: catalogo di prodotti in griglia, col prezzo.
 * - `altro`: la variante GENERICA. 'altro' e' l'ASSENZA di scelta e non un verticale
 *   (`emptyBrief` lo porta comunque, stessa lettura di P1-D24): la sezione resta un
 *   elenco semplice e neutro, e il prezzo si mostra quando c'e' perche' senza un
 *   settore da interpretare l'unica lettura onesta e' rendere cio' che l'utente ha
 *   scritto.
 */
const OFFERINGS_VARIANTS: Record<Brief['vertical'], OfferingsVariant> = {
  ristorazione: { label_key: 'site.offerings.menu', layout: 'menu-sections', show_price: true },
  fitness: { label_key: 'site.offerings.courses', layout: 'course-grid', show_price: true },
  salone_studio: { label_key: 'site.offerings.services', layout: 'service-list', show_price: false },
  negozio_artigiano: {
    label_key: 'site.offerings.catalog',
    layout: 'catalog-grid',
    show_price: true,
  },
  altro: { label_key: 'site.offerings.generic', layout: 'simple-list', show_price: true },
};

/**
 * Risolve il blocco offerte per un brief: la variante del suo `vertical` e le voci da
 * mostrare, NELL'ORDINE DEL BRIEF.
 *
 * NON E' UN GATE: chi la chiama ha gia' chiesto a `blocksFor` se il blocco esiste. Con
 * zero offerte restituisce zero voci — non ne fabbrica nessuna, che sarebbe il
 * segnaposto vietato da P2-D7, e non ne nasconde nessuna.
 *
 * LE VOCI SONO QUELLE DEL BRIEF, non una copia ripulita: `photo_ref` viaggia ancora
 * qui. Toglierlo e' di T-214/T-202 (P2-D12), dove il TIPO del documento non ha alcun
 * campo in cui possa stare — farlo qui darebbe l'illusione che la difesa viva in questo
 * modulo, mentre la difesa e' l'irrappresentabilita' del documento.
 */
export function resolveOfferings(
  brief: Brief,
): OfferingsVariant & { readonly items: readonly Offerta[] } {
  return { ...OFFERINGS_VARIANTS[brief.vertical], items: offerte(brief) };
}

// ── il catalogo ──────────────────────────────────────────────────────────────

/**
 * GLI OTTO BLOCCHI della spec di design §7, nell'ordine in cui la spec li nomina — che
 * e' anche l'ordine in cui `blocksFor` restituisce i superstiti. La galleria e' fuori
 * (P2-D24, vedi l'intestazione).
 *
 * L'assegnazione degli SLOT non e' una scelta di questo file: e' la stessa che il
 * catalogo di T-201 gia' dichiara nei propri raggruppamenti (`--- blocco hero ---`,
 * `--- blocco chi-siamo ---`, ...). Ogni slot appartiene a UN blocco solo, quindi la
 * stessa prosa non puo' comparire due volte nella stessa pagina.
 */
export const BLOCKS: readonly BlockDefinition[] = [
  {
    // L'apertura della home: il nome dell'attivita' e la promessa. Esiste appena c'e'
    // un nome — che e' anche il minimo perche' un brief sia 'confirmed' (T-122) —
    // perche' la home esiste sempre (P2-D13) e una pagina senza blocchi non e' un
    // documento valido (T-202).
    id: 'hero',
    page_roles: ['home'],
    slots: ['hero_title_kicker', 'hero_title', 'hero_subtitle'],
    brief_fields_rendered: ['business_name'],
    precondition: (brief) => testoPresente(brief.business_name),
  },
  {
    // La sezione offerte: menu, servizi, catalogo o portfolio secondo il vertical.
    // Le voci NON passano dal modello (P2-D4): sono dati del brief e il blocco le rende
    // tali e quali; dal modello viene solo la cornice (titolo e introduzione).
    id: 'offerte',
    page_roles: ['offerings', 'home'],
    slots: ['offerings_title', 'offerings_intro'],
    brief_fields_rendered: ['offerings'],
    precondition: (brief) => offerte(brief).length >= MIN_OFFERTE,
  },
  {
    // Chi siamo: qui il brief NON e' reso: `description` e `highlights` entrano nella
    // proiezione verso il modello (spec §8) e tornano come prosa in `about_body` e
    // `about_points`. `brief_fields_rendered` e' percio' VUOTO, ed e' un'informazione:
    // su questo blocco non c'e' nulla da sanificare che venga dal brief — c'e' da
    // sanificare l'uscita del modello, che ha il proprio gate (PoolSchema, T-201).
    // Senza almeno una delle due sorgenti il modello dovrebbe inventarsi la storia
    // dell'attivita', che e' il sito che mente contro cui la visione §5 e' scritta.
    id: 'chi-siamo',
    page_roles: ['home'],
    slots: ['about_title', 'about_body', 'about_points'],
    brief_fields_rendered: [],
    precondition: (brief) => testoPresente(brief.description) || evidenze(brief).some(testoPresente),
  },
  {
    // Gli orari: dato del brief reso tale e quale (P2-D4); dal modello viene la sola
    // nota di accompagnamento.
    id: 'orari',
    page_roles: ['hours', 'home'],
    slots: ['hours_title', 'hours_intro'],
    brief_fields_rendered: ['hours'],
    precondition: orariUtili,
  },
  {
    // Contatti e mappa. La precondizione e' quella della spec §7 — almeno uno fra
    // indirizzo, telefono, whatsapp ed email — e `geo` da solo NON basta: una mappa
    // senza un modo per raggiungere l'attivita' non e' una sezione contatti, e le
    // coordinate arrivano dalla geocodifica di un indirizzo, non da sole.
    // `social_links` e' reso QUI e in nessun altro blocco: e' il campo del brief che il
    // repo destina a un href, quindi la sua sanificazione (T-237) ha un solo posto in
    // cui essere applicata invece di due.
    id: 'contatti',
    page_roles: ['contact', 'home'],
    slots: ['contact_title', 'contact_intro'],
    brief_fields_rendered: ['address', 'geo', 'phone', 'email', 'whatsapp', 'social_links'],
    precondition: (brief) => testoPresente(brief.address) || haCanale(brief),
  },
  {
    // RECENSIONI — IL NODO, dichiarato invece che aggirato.
    // Il blocco ha i suoi slot in T-201 (reviews_title, reviews_intro) e la spec di
    // design §7 lo elenca, MA IL BRIEF v1 NON HA ALCUN CAMPO CHE PORTI RECENSIONI: non
    // il testo di una testimonianza, non un autore, non un voto, non una sorgente
    // esterna. La precondizione dice percio' la VERITA' su quell'assenza e non e'
    // soddisfatta da nessun brief v1.
    // NON e' agganciata a un campo proxy (social_links, highlights, vertical): un proxy
    // farebbe "esistere" la sezione su dati che non sono recensioni, cioe' produrrebbe
    // esattamente la sezione che mente. E per P2-D7 la conseguenza e' voluta: senza il
    // blocco, il modello non riceve reviews_title/reviews_intro (T-220) e non ha la
    // possibilita' di scrivere testimonianze inventate.
    // La voce RESTA nel catalogo, con i suoi slot: cancellarla nasconderebbe la
    // decisione. E' PINNATA da tests/generation-blocks.test.ts, che diventa rosso il
    // giorno in cui una sorgente di recensioni entrera' nel brief — cosi' la decisione
    // torna sul tavolo invece di restare implicita in un `return false`.
    id: 'recensioni',
    page_roles: ['reviews', 'home'],
    slots: ['reviews_title', 'reviews_intro'],
    brief_fields_rendered: [],
    precondition: () => false,
  },
  {
    // FAQ: nessun campo del brief e' reso: le domande e le risposte sono prosa del
    // modello, scritta a partire dai fatti che il brief dichiara (vedi `materieFaq`).
    id: 'faq',
    page_roles: ['faq', 'home'],
    slots: ['faq_title', 'faq_items'],
    brief_fields_rendered: [],
    precondition: (brief) => materieFaq(brief) >= FAQ_MIN_MATERIE,
  },
  {
    // La CTA WhatsApp: la riga di invito viene dal modello, l'ETICHETTA del bottone dal
    // catalogo i18n secondo `primary_goal` (P2-D10) e il numero dal brief. Senza numero
    // il bottone non ha destinazione, quindi il blocco non esiste.
    // Sta anche sulla pagina contatti perche' e' li' che la richiesta di scrivere ha il
    // suo posto naturale; quali ricette lo usino davvero e' di T-212.
    // RIPETIZIONE DICHIARATA DI UN CAMPO PICCOLO: `whatsapp` e' reso anche dal blocco
    // contatti (il recapito nell'elenco) e qui (il numero dietro al bottone). La
    // partizione dei campi PESANTI resta intatta; il costo e' BRIEF_LIMITS.whatsapp =
    // 40 code unit per pagina, cioe' al piu' ~800 byte sul documento intero (10 pagine
    // x 2 byte per code unit accentato) contro i 1.991.410 byte di margine misurati in
    // T-202 — ed e' il prezzo per non costringere chi vuole scrivere a cercare il
    // numero in fondo alla pagina.
    id: 'cta-whatsapp',
    page_roles: ['home', 'contact'],
    slots: ['whatsapp_cta_title'],
    brief_fields_rendered: ['whatsapp'],
    precondition: (brief) => testoPresente(brief.whatsapp),
  },
];

// ── le due funzioni pure ─────────────────────────────────────────────────────

/**
 * I blocchi che ESISTONO per questo brief in questo ruolo di pagina, nell'ordine
 * dichiarato dal catalogo. Un blocco la cui precondizione non e' soddisfatta non compare
 * — non compare vuoto, non compare disabilitato, non compare affatto (P2-D7).
 *
 * Il confronto sul ruolo e' per UGUAGLIANZA (`includes` su un elenco chiuso), mai per
 * prefisso: i ruoli sono un vocabolario piccolo e chiuso (T-201) e un confronto lasco
 * qui farebbe comparire sezioni su pagine a cui non appartengono.
 */
export function blocksFor(brief: Brief, pageRole: PageRole): readonly BlockDefinition[] {
  return BLOCKS.filter(
    (blocco) => blocco.page_roles.includes(pageRole) && blocco.precondition(brief),
  );
}

/**
 * L'unione ESATTA degli slot dei blocchi passati: ogni slot dichiarato compare una
 * volta sola, nell'ordine di prima comparizione, e nessuno slot che quei blocchi non
 * dichiarino entra nel risultato.
 *
 * E' cio' che T-220 mandera' al modello: uno slot in piu' sarebbe un permesso di
 * scrivere una sezione che non esiste, uno slot in meno un blocco senza contenuto che
 * T-214 dovrebbe scartare.
 *
 * IL DEDUP E' PER UGUAGLIANZA (Set), mai per prefisso: nel catalogo di T-201
 * 'hero_title' e' PREFISSO di 'hero_title_kicker' — deliberatamente — e un confronto
 * scritto con startsWith/includes al posto dell'uguaglianza perderebbe uno dei due.
 */
export function slotsForBlocks(blocks: readonly BlockDefinition[]): readonly SlotId[] {
  const visti = new Set<SlotId>();
  const unione: SlotId[] = [];
  for (const blocco of blocks) {
    for (const slot of blocco.slots) {
      if (visti.has(slot)) continue;
      visti.add(slot);
      unione.push(slot);
    }
  }
  return unione;
}
