// T-214 (macrotask generation-engine, P2) — RESOLVE: da pool + ricetta + tema + brief +
// set di pagine al SITE DOCUMENT (T-202), cioe' all'artefatto CONGELATO che P3 modifichera'
// e P4 pubblichera'. Dominio PURO: nessun accesso al DB, nessun I/O, nessun side effect,
// nessuna lettura dell'orologio ne del random — gli stessi argomenti danno lo stesso
// documento, byte per byte, ed e' su questo che poggia tutto cio' che sta a valle.
//
// E' IL PUNTO IN CUI LE CINQUE DICHIARAZIONI DI MONTE SI INCONTRANO, e nessuna delle cinque
// viene riscritta qui: CHI esiste lo decide il catalogo dei blocchi (T-210, attraverso
// `applyRecipe`), IN CHE ORDINE lo decide la ricetta (T-212), QUALI pagine esistono lo
// decide il set (T-213), COSA C'E' DENTRO viene dal pool del modello (T-201) e dal brief
// (T-121), e la FORMA di cio' che esce e' quella del documento (T-202). Questo modulo
// COMPONE: ogni volta che avrebbe potuto decidere di nuovo qualcosa che un altro modulo ha
// gia' deciso, ha chiesto invece di riscrivere — due verita' sulla stessa cosa diventano
// prima o poi due verita' diverse.
//
// RESOLVE NON E' UN GATE, e distinguere le due cose e' il contratto di questo file: non
// valida il proprio risultato e non RIFIUTA (sul non lanciare, vedi il paragrafo seguente:
// la totalita' ha un confine e sta scritto). Il documento che restituisce passa da
// `parseDocument` (T-202) prima di essere scritto (T-204) e prima di essere reso (T-231), e
// se un pool incompleto lo rende invalido e' il gate a dirlo — non un rifiuto silenzioso
// qui. Cio' che questo modulo garantisce e' di essere TOTALE sui propri dati e di RIPORTARE
// cio' che ha perso per strada.
//
// FIN DOVE ARRIVA LA TOTALITA', scritto perche' "non lancia mai" letto largo e' falso e un
// chiamante ci si appoggerebbe. SONO CHIUSE, con un caso a testa nel test: il pool che non
// ha la mappa delle pagine; il pool che non ha QUELLA pagina; la pagina del pool che non e'
// un oggetto proprio (null compreso); il PageSpec senza `absorbed_roles`; il blocco che non
// dichiara alcuno slot; il set di pagine vuoto; il brief povero.
// RESTA APERTO, ed e' una PRECONDIZIONE DEL CHIAMANTE e non un difetto di questo modulo: i
// cinque argomenti devono essere quello che il loro tipo dice. Un `role` fuori dal
// vocabolario di T-201 (o assente), e un `absorbed_roles` che ne contiene uno, fanno lanciare
// DENTRO `applyRecipe` (T-212, il for-of sulla sequenza dichiarata: `inner_page_rules[ruolo]`
// e' `undefined` e non e' iterabile) — non qui, e non si chiudono qui: riscrivere il
// vocabolario dei ruoli in questo file sarebbe la seconda copia di un catalogo di monte. Il
// test ESERCITA quei tre input e nomina dove cadono, invece di lasciarlo scoprire.
// Allo stesso modo un `pool`, un `brief`, un `recipe`, un `theme` o un `pageSpecs` NULLO cade
// sulla prima lettura (cinque TypeError misurati, uno per argomento): quelli sono DICHIARATI
// dal test e non asseriti, perche' difendersene vorrebbe dire riscrivere qui la forma di
// cinque contratti di monte gia' tipizzati — la decisione e' di T-230, che li costruisce.
//
// RESOLVE NON SANIFICA (OWASP A05:2025): il documento incorpora testo NON FIDATO — la prosa
// del modello attraverso il pool, e i dati del brief che possono venire da `fromUrl` (T-141)
// o da `update_brief` (T-132). Il contratto di cio' che va sanificato e' dichiarato dai
// blocchi (`brief_fields_rendered`, T-210) e imposto nel RENDERING (T-231/T-237). Ripulire
// qui darebbe l'illusione che il rendering sia sicuro per costruzione, che e' peggio del
// problema: chi viene dopo si appoggerebbe a una difesa che non c'e'. Qui il testo viene
// TRASPORTATO, e lo si dice.
//
// LE QUATTRO DECISIONI DI QUESTO TASK, ciascuna col proprio costo dichiarato:
//
// 1. LA PARTIZIONE, cioe' UN BLOCCO AL PIU' UNA VOLTA PER PAGINA (vedi `blocchiDellaPagina`).
//    E' una precondizione EREDITATA e MISURATA da T-202 (2026-07-28): il documento e'
//    accettato fino a `DOCUMENT_LIMITS.max_bytes` (8 MiB), e il caso peggiore in cui lo
//    STESSO campo pesante del brief (le offerte al tetto di P1-D17) e' reso da DUE blocchi
//    della stessa pagina misura 11.813.858 byte — un documento legittimo, RIFIUTATO. Il caso
//    peggiore PARTIZIONATO misura 6.397.198 byte e passa con circa il 31% di margine.
//    Il catalogo di T-210 aiuta (nessun campo pesante e' dichiarato da due blocchi diversi)
//    ma NON basta: `applyRecipe` non deduplica e accetta una ricetta qualunque, e sulla home
//    di una one-pager le sequenze dei ruoli ASSORBITI si sovrappongono per costruzione a
//    quella della home. La deduplicazione per id e' cio' che rende quella sovrapposizione
//    IDEMPOTENTE invece di raddoppiare il blocco piu' pesante del sito.
//    RIMISURATO SU CIO' CHE QUESTO MODULO PRODUCE DAVVERO (T-214, e i numeri sono degli
//    ordini di grandezza dei precedenti, non gli stessi: la fixture di T-202 metteva ogni
//    slot e ogni campo su dodici blocchi per pagina, qui i blocchi componibili sono sette):
//    partizionato 6.156.391 byte, il 73,4% del tetto, margine 36,3%.
//    IL CONTROFATTUALE, e va detto COME e' stato ottenuto perche' la prima misura di questo
//    commento era piu' bassa del vero: non un blocco pesante clonato a mano nel documento
//    gia' prodotto (11.622.131 byte), ma la deduplicazione SPENTA lasciando produrre resolve,
//    cioe' la concatenazione delle sequenze dichiarate senza dedup. Sono 12.185.391 byte, il
//    145,3% del tetto, RIFIUTATO — con DODICI blocchi per pagina (esattamente
//    `DOCUMENT_LIMITS.blocks_per_page`) e 'offerte', 'orari', 'contatti', 'cta-whatsapp' e
//    'faq' DUE volte, perche' ogni ruolo assorbito ripete blocchi che la home ha gia'.
//    Le due misure e il loro rapporto (x1,979) sono riportate dal test, che ricostruisce il
//    controfattuale concatenando le stesse sequenze.
//    COSTO DICHIARATO: la deduplicazione e' per BLOCCO e non per CAMPO. `whatsapp` resta
//    reso due volte sulla stessa pagina — dal blocco contatti e dalla CTA — perche' T-210 lo
//    dichiara e ne ha misurato il costo (~800 byte sul documento intero): partizionare per
//    campo cancellerebbe una scelta di prodotto presa a monte.
//
// 2. LA CHIAVE DEGLI ORARI: la voce non rappresentabile e' SCARTATA (vedi
//    `orariRappresentabili`), mai normalizzata. E' l'altra precondizione ereditata: nel
//    documento la chiave di `hours` e' vincolata nella FORMA (alfanumerico Unicode ai due
//    bordi, separatori singoli interni) mentre `brief.ts` non impone nulla (P1-D13), quindi
//    un brief VALIDO puo' portare una chiave che fa RIFIUTARE il documento intero.
//    PERCHE' SCARTARE E NON NORMALIZZARE: (a) normalizzare RISCRIVE un dato dell'utente — un
//    ' sabato ' o un 'lun--ven' diventerebbero etichette che nessuno ha scritto — e non
//    copre comunque i casi in cui non c'e' nulla da normalizzare ('__proto__', una chiave di
//    soli separatori), quindi servirebbe COMUNQUE una via di scarto: due meccanismi invece di
//    uno; (b) la normalizzazione puo' far COLLIDERE due chiavi distinte (' sabato ' e
//    'sabato') e la collisione perderebbe una voce IN SILENZIO, cioe' la corruzione che
//    P1-D17 vieta; (c) lo scarto e' PER VOCE, quindi il costo e' la singola riga e non la
//    sezione.
//    COSTO DICHIARATO: lo scarto NON e' riportato in `dropped` — quel campo ha un contratto
//    preciso (il blocco e lo SLOT che manca al pool) e allargarlo a un'unione lo
//    trasformerebbe in un log, togliendo a T-230 il modo di distinguere un pool incompleto da
//    un pool sbagliato. Una voce di orario perduta e' quindi visibile solo confrontando il
//    brief col documento. E se NESSUNA chiave e' rappresentabile, il campo non entra affatto:
//    la sezione orari resta con la sua prosa e senza righe, che e' un documento valido con una
//    sezione povera invece di una generazione fallita per una chiave.
//
// 3. IL TITOLO E LA META DESCRIPTION sono PROSA DEL MODELLO, non testo fabbricato (vedi
//    `titoloEMeta`). Nessun AC dice da dove vengano e il documento li pretende non vuoti: la
//    scelta e' di questo task. Sono il primo valore di testo dei blocchi composti che ENTRA
//    nel tetto del documento, e il primo dei successivi per la meta description. Un valore
//    fuori scala e' SALTATO e mai TAGLIATO (nessun troncamento: troncare e' corruzione
//    silenziosa, P1-D17/T-201). Il PAVIMENTO e' lo slug della pagina — un identificatore
//    nostro, dichiarato da T-213 — perche' una pagina senza titolo non e' un documento valido
//    e il pavimento non puo' dipendere dal modello.
//    COSTO DICHIARATO: sulla home il primo testo e' l'OCCHIELLO del blocco hero (T-201: "che
//    cosa e' l'attivita e dove si trova"), non il titolo della home. resolve non conosce la
//    semantica degli slot — il catalogo non la dichiara — e qualunque preferenza per uno slot
//    particolare sarebbe una TABELLA NUOVA, cioe' un terzo catalogo destinato a divergere da
//    T-201. L'unica informazione d'ordine disponibile e' quella che il catalogo DICHIARA.
//
// 4. L'IMAGERY: UNO slot immagine per pagina, sul blocco che la APRE, con la sorgente
//    `theme-placeholder` e il token che nomina quel blocco. In v1 le immagini sono imagery
//    del TEMA (P2-D12) e il documento non ha alcun campo in cui un indirizzo possa stare;
//    l'altra variante (`uploaded`) aspetta l'upload di P4 e resolve non puo' emetterla, perche'
//    non esiste un asset caricato da nominare.
//    COSTO DICHIARATO: il catalogo dei token del tema non e' di questo task (T-211 lo dichiara
//    fuori scope), quindi il token e' l'id del blocco e chi lo risolvera' in un asset e' il
//    rendering (T-231), leggendo `theme_id`. Zero slot immagine sarebbe stato piu' prudente e
//    avrebbe reso VUOTA l'asserzione di sicurezza di AC-214-6 su cio' che uno slot immagine
//    puo' contenere. La forma dell'id di blocco (T-202 ammette l'underscore) e' piu' larga di
//    quella del token: che ogni id del catalogo sia un token valido e' PINNATO dal test, non
//    sperato.
//
// COSA RESOLVE NON GIUDICA, dichiarato perche' non si deduce:
// - l'ACCOPPIAMENTO ricetta-tema: registra l'id del TEMA RICEVUTO, non `recipe.theme_id`.
//   Quale tema vada con quale direzione lo dichiara T-212 e lo scegle chi genera (T-230);
// - la FORMA degli id versionati e degli slug: la impone il documento (T-202) e la verifica
//   il suo gate. Riscriverne qui le regex ne creerebbe una seconda copia;
// - la COERENZA fra il set di pagine e il pool: una pagina che il pool non contiene perde
//   tutti i suoi blocchi, che finiscono in `dropped`. resolve NON omette la pagina, e non e'
//   pigrizia: ometterla farebbe divergere il documento dal set e dalla navigazione derivata
//   (T-213), cioe' produrrebbe un 404 interno per riparare un pool incompleto.

import {
  DOCUMENT_LIMITS,
  SiteDocumentSchema,
  type SiteBlock,
  type SiteDocument,
  type SitePage,
} from '@/domain/generation/document';
import { isPlainObject, testoPresente } from '@/domain/generation/gate';
import { applyRecipe, type SiteRecipe } from '@/domain/generation/recipes';
import type { Pool } from '@/domain/generation/pool';
import type { SiteTheme } from '@/domain/generation/themes';
import type { PageSpec } from '@/domain/generation/pages';
import type { SlotId } from '@/domain/generation/slots';
import type { Brief } from '@/domain/onboarding/brief';

/**
 * Una voce del catalogo dei blocchi (T-210), DERIVATA dal tipo di ritorno di `applyRecipe`
 * perche' `BlockDefinition` non e' esportata: ricopiarne la forma qui creerebbe un secondo
 * contratto destinato a divergere dal primo. E' la stessa derivazione che fa T-212.
 */
type BlockDefinition = ReturnType<typeof applyRecipe>[number];

/** I contenuti risolti di un blocco: la forma del documento (T-202), non una copia. */
type ContenutoBlocco = SiteBlock['content'];

/** I campi del brief resi direttamente: la forma del documento, senza `photo_ref`. */
type DatiResi = SiteBlock['data'];

/** I nomi nominabili in `brief_fields_rendered`, dal vocabolario del documento. */
type NomeCampoReso = SiteBlock['brief_fields_rendered'][number];

/** Il valore di uno slot: testo, lista o coppie domanda/risposta (T-201). */
type ValoreDiSlot = ContenutoBlocco[SlotId];

/** Una voce di uno slot di kind 'list' o 'qa', derivata senza nominare alcuno slot. */
type VoceDiSlot = Extract<ValoreDiSlot, readonly unknown[]>[number];

/** Una voce dell'offerta come vive nel documento (senza `photo_ref`, P2-D12). */
type OffertaResa = Exclude<DatiResi['offerings'], undefined>[number];

/**
 * LA FORMA AMMESSA PER LA CHIAVE DEGLI ORARI, camminata dallo schema del documento invece di
 * essere riscritta: documento -> pagine -> blocchi -> dati -> `hours` -> chiave. E' la stessa
 * derivazione che `document.ts` usa per costruirla dal brief, nell'altro verso.
 * Se qui ci fosse una regex propria, il giorno in cui T-202 stringesse o allargasse quella
 * forma resolve scarterebbe le voci sbagliate — e nessun controllo se ne accorgerebbe,
 * perche' i due elenchi non si guardano.
 */
const CHIAVE_ORARI = SiteDocumentSchema.innerType()
  .shape.pages.element.shape.blocks.element.shape.data.shape.hours.unwrap()
  .innerType().keySchema;

/**
 * Una voce di `dropped`: il blocco che non e' entrato nel documento e LO SLOT che gli manca
 * nel pool, sulla pagina in cui mancava.
 *
 * E' UN CONTRATTO E NON UN LOG. Lo slot c'e' perche' un dropped col solo id direbbe CHE si e'
 * perso qualcosa senza dire cosa manca al pool, e T-230 non potrebbe distinguere un pool
 * INCOMPLETO (si richiede al modello lo slot mancante) da un pool SBAGLIATO. Lo slug della
 * pagina c'e' perche' il pool e' per pagina e lo stesso blocco vive su piu' pagine: senza di
 * esso l'informazione non basterebbe a sapere DOVE riempire.
 * UNA VOCE PER SLOT MANCANTE, non una per blocco: un blocco a cui mancano due slot ne produce
 * due, altrimenti chi riempie il pool tornerebbe due volte.
 *
 * `missing_slot` E' NULL nel solo caso in cui non ci sia uno slot da nominare, cioe' il blocco
 * che non ne dichiara ALCUNO (vedi `resolve`). E' l'allargamento MINIMO del contratto — un
 * valore in piu' sullo stesso campo — e le due alternative sono state scartate per ragioni
 * diverse:
 * - un campo `reason` a due valori ACCANTO a `missing_slot` sarebbe una SECONDA verita' sulla
 *   stessa cosa: `reason` direbbe 'senza-slot' se e solo se lo slot manca, quindi il giorno in
 *   cui i due campi divergessero T-230 non avrebbe modo di sapere quale credere. Due verita'
 *   sulla stessa cosa diventano prima o poi due verita' diverse — e' la regola che governa
 *   tutto questo file;
 * - la CHIAVE OMESSA (`missing_slot?: SlotId`) non si distingue da un campo PERDUTO: dopo un
 *   giro in JSON, o dopo un ramo che si e' dimenticato di scriverlo, l'assenza dice la stessa
 *   cosa di "non c'e' uno slot da nominare". `null` e' un'affermazione POSITIVA e obbliga chi
 *   legge a trattare il caso invece di inciamparvi.
 * COSTO DICHIARATO: chi consuma `missing_slot` deve ora escludere `null` prima di usarlo come
 * nome di slot. E' il costo di sapere che quel blocco non e' riempibile riempiendo il pool —
 * l'informazione che T-230 non avrebbe da una voce muta.
 */
type DroppedBlock = {
  readonly page_slug: string;
  readonly block_id: string;
  readonly missing_slot: SlotId | null;
};

type ResolveResult = {
  readonly document: SiteDocument;
  readonly dropped: readonly DroppedBlock[];
};

// ── presenza dei dati ────────────────────────────────────────────────────────


/**
 * Lo slot PORTA DAVVERO un contenuto. Il pool ammette la stringa vuota e la lista vuota
 * (T-201 non mette alcun `min` sui valori: quali slot debbano esistere e' una precondizione
 * dei blocchi, non del suo gate), quindi "la chiave c'e'" non basta a dire che il blocco ha
 * di che essere reso.
 *
 * NON RIPULISCE LA LISTA: una lista con una voce vuota fra tre buone passa intera, perche'
 * resolve TRASPORTA e non corregge il modello. Cio' che si giudica qui e' se lo slot ha
 * almeno un contenuto — non la qualita' di ogni voce.
 */
function portaContenuto(valore: ValoreDiSlot): boolean {
  if (valore === undefined) return false;
  if (typeof valore === 'string') return testoPresente(valore);
  const voci: readonly VoceDiSlot[] = valore;
  return voci.some((voce) =>
    typeof voce === 'string'
      ? testoPresente(voce)
      : testoPresente(voce.question) && testoPresente(voce.answer),
  );
}

// ── il pool ──────────────────────────────────────────────────────────────────

/**
 * Il contenuto che il modello ha scritto per QUESTA pagina, o `undefined` se il pool non la
 * contiene — che e' un caso vero e non un'ipotesi: nella fase 1 il pool porta la sola home e
 * le pagine interne arrivano nella fase 2 (P2-D13).
 *
 * LA LETTURA E' SU PROPRIETA' PROPRIE (`Object.hasOwn`) e non con un accesso nudo: `pool.pages`
 * e' una `z.record` che nasce da JSON non fidato, e un accesso per stringa risolverebbe anche
 * i membri EREDITATI da Object.prototype — uno slug chiamato 'constructor' restituirebbe una
 * funzione al posto del contenuto di una pagina. Gli slug vengono da T-213, ma la difesa costa
 * una chiamata e non dipende da chi scrivera' il chiamante.
 * LE DUE GUARDIE servono a non far cadere una funzione pura se il chiamante passa un oggetto
 * costruito a mano: e' la stessa scelta di T-210 sui campi di `content`. Quella su `pages`
 * copre la mappa che non c'e'; quella sulla PAGINA copre il valore che non e' un oggetto
 * proprio — misurato, `pool.pages.<slug> = null` faceva lanciare `Object.hasOwn` in
 * `slotMancanti` ("Cannot convert undefined or null to object"), cioe' la difesa era
 * DICHIARATA e incompleta. Una pagina che non e' un oggetto e' trattata come ASSENTE: i suoi
 * blocchi finiscono in `dropped`, che e' cio' che questo modulo fa di un pool che non porta il
 * contenuto promesso, e non un'eccezione dentro una funzione che sui propri dati promette di
 * non lanciare.
 * IL PREDICATO E' QUELLO DEI GATE (`isPlainObject`, gate.ts, usato da T-201 e T-202) e non un
 * secondo predicato scritto qui: dire due volte che cosa sia un oggetto semplice — col `try`
 * intorno a `getPrototypeOf` che rende totale anche il caso del Proxy — vorrebbe dire due
 * difese destinate a divergere.
 * LA GUARDIA E' AL PUNTO DI LETTURA e non presso ogni uso: da qui in poi il contenuto della
 * pagina e' `undefined` oppure un oggetto proprio, quindi `slotMancanti` e `bloccoRisolto` non
 * hanno un caso in piu' da difendere.
 */
function paginaDelPool(pool: Pool, slug: string): ContenutoBlocco | undefined {
  const pagine = pool.pages ?? {};
  if (!Object.hasOwn(pagine, slug)) return undefined;
  const pagina = pagine[slug];
  return isPlainObject(pagina) ? pagina : undefined;
}

/** Gli slot che il blocco dichiara e che il pool non gli da', nell'ordine dichiarato. */
function slotMancanti(
  pagina: ContenutoBlocco | undefined,
  slots: readonly SlotId[],
): readonly SlotId[] {
  if (pagina === undefined) return slots;
  return slots.filter((slot) => !(Object.hasOwn(pagina, slot) && portaContenuto(pagina[slot])));
}

/**
 * Copia UNO slot dal pool al blocco. La funzione e' generica sulla chiave e non e' una
 * cerimonia di tipi: con una chiave di tipo unione i due lati dell'assegnazione sarebbero due
 * unioni indipendenti e servirebbe un cast, cioe' il punto in cui un valore di kind sbagliato
 * potrebbe entrare senza che nessuno lo veda. Con `K` legato, i due lati sono lo STESSO tipo.
 */
function copiaSlot<K extends SlotId>(out: ContenutoBlocco, pagina: ContenutoBlocco, slot: K): void {
  out[slot] = pagina[slot];
}

// ── i dati del brief ─────────────────────────────────────────────────────────

/**
 * La voce dell'offerta come entra nel documento: TUTTO tranne `photo_ref`.
 *
 * Il campo e' TOLTO da una copia, non evitato ricostruendo la voce coi campi buoni: un campo
 * nuovo nel brief continuerebbe ad arrivare al documento (e se il documento non lo ammettesse,
 * il suo gate lo direbbe rumorosamente), mentre un elenco di campi buoni lo perderebbe in
 * silenzio. La copia e' superficiale ed e' NUOVA: la voce del brief non viene toccata.
 * PERCHE' PROPRIO QUESTO CAMPO (P2-D12): `photo_ref` e' l'URL di una foto di terzi raccolto da
 * `fromUrl` (T-141). Nel documento NON ESISTE il campo che possa portarlo — lo schema di T-202
 * lo omette ed e' strict — quindi copiare la voce tale e quale non farebbe passare l'URL: farebbe
 * CADERE il documento. La difesa e' l'irrappresentabilita', e questa riga e' cio' che le
 * permette di non essere anche una generazione fallita.
 */
function offertaResa(offerta: Brief['content']['offerings'][number]): OffertaResa {
  const resa = { ...offerta };
  delete resa.photo_ref;
  return resa;
}

/**
 * Gli orari RAPPRESENTABILI nel documento, o `undefined` se non ne resta nessuno (vedi la
 * decisione 2 in testa al file).
 *
 * L'ORDINE DEI DUE CONTROLLI CONTA, e non solo per il risultato: la chiave e' filtrata PRIMA di
 * essere usata per scrivere. Senza il filtro, `resi[chiave] = valore` con chiave '__proto__'
 * non aggiungerebbe una voce — cambierebbe il PROTOTIPO della mappa che finisce nel documento.
 * La forma imposta da T-202 (alfanumerico ai due bordi) esclude quel nome per costruzione, ed e'
 * per questo che il predicato e' DERIVATO da quello schema e non riscritto.
 * `Object.entries` legge le sole proprieta' PROPRIE: una chiave portata dal prototipo della
 * mappa non entra nemmeno in gioco.
 */
function orariRappresentabili(orari: Brief['hours']): Record<string, string> | undefined {
  if (orari === undefined) return undefined;
  const resi: Record<string, string> = {};
  for (const [chiave, valore] of Object.entries(orari)) {
    if (!testoPresente(valore)) continue;
    if (!CHIAVE_ORARI.safeParse(chiave).success) continue;
    resi[chiave] = valore;
  }
  return Object.keys(resi).length > 0 ? resi : undefined;
}

/**
 * LA VISTA PIATTA DEL BRIEF: ogni campo che un blocco potrebbe dichiarare di rendere, nella
 * forma FLAT che il documento usa (i campi di `content` salgono al top level, come nella patch
 * di T-121), con i soli valori che PORTANO qualcosa.
 *
 * E' TOTALE sui campi del brief e non solo su quelli che i blocchi rendono oggi: un blocco che
 * domani dichiarasse `description` la troverebbe qui, invece di dichiarare un campo che non
 * arriva. Cio' che entra nel documento resta comunque il solo elenco che i blocchi DICHIARANO —
 * la selezione e' in `bloccoRisolto`, e i campi che il brief fa solo CONSULTARE (vertical,
 * primary_goal, locale) non sono dichiarati da nessun blocco (T-210) e quindi non entrano.
 *
 * IL PREZZO DELLA TOTALITA', dichiarato e MISURATO invece di lasciarlo scoprire: sei dei
 * quindici campi (vertical, primary_goal, locale, description, highlights, brand_hints) non
 * sono dichiarati da ALCUN blocco del catalogo di oggi, quindi le loro righe non hanno effetto
 * osservabile e NESSUN test puo' renderle rosse — resolve non riceve il catalogo dei blocchi
 * come parametro, quindi non esiste un caso in cui un blocco dichiari uno di quei campi.
 * Misurato: togliere `dati.description`, `dati.vertical` o `dati.highlights` lascia verdi tutti
 * e 51 i casi di tests/generation-resolve.test.ts. Restano perche' l'alternativa e' un
 * BUCO SILENZIOSO — il blocco che domani dichiarasse `description` non renderebbe nulla e
 * nemmeno lo direbbe — e perche' una vista parziale codificherebbe qui le scelte di T-210,
 * cioe' una seconda copia di quel catalogo.
 *
 * LE COLLEZIONI SONO NUOVE, non condivise col brief: `offerings` e `hours` perche' la
 * trasformazione lo impone, `social_links`, `highlights` e `geo` perche' la stessa lettura
 * valga per tutte — chi a valle mutasse il documento non muterebbe il brief. Il POOL, invece, e'
 * trasportato per riferimento: il gate di T-202 costruisce comunque la propria copia campo per
 * campo, e una copia profonda della prosa qui sarebbe un secondo passaggio su tutto il testo.
 */
function datiDelBrief(brief: Brief): DatiResi {
  const contenuto = brief.content;
  const dati: DatiResi = {};

  if (testoPresente(brief.business_name)) dati.business_name = brief.business_name;
  dati.vertical = brief.vertical;
  if (testoPresente(brief.description)) dati.description = brief.description;
  if (testoPresente(brief.address)) dati.address = brief.address;
  if (brief.geo !== undefined) dati.geo = { ...brief.geo };
  const orari = orariRappresentabili(brief.hours);
  if (orari !== undefined) dati.hours = orari;
  if (testoPresente(brief.phone)) dati.phone = brief.phone;
  if (testoPresente(brief.whatsapp)) dati.whatsapp = brief.whatsapp;
  if (testoPresente(brief.email)) dati.email = brief.email;
  if (brief.primary_goal !== undefined) dati.primary_goal = brief.primary_goal;
  dati.locale = brief.locale;

  const offerte = contenuto?.offerings ?? [];
  if (offerte.length > 0) dati.offerings = offerte.map(offertaResa);
  const social = contenuto?.social_links ?? [];
  if (social.length > 0) dati.social_links = [...social];
  const evidenze = contenuto?.highlights ?? [];
  if (evidenze.length > 0) dati.highlights = [...evidenze];
  if (testoPresente(contenuto?.brand_hints)) dati.brand_hints = contenuto.brand_hints;

  return dati;
}

/**
 * Copia UN campo dalla vista piatta ai dati del blocco, e dice se c'era. Generica sulla chiave
 * per la stessa ragione di `copiaSlot`: con una chiave di tipo unione servirebbe un cast, e un
 * cast qui vorrebbe dire un valore di un campo assegnato al nome di un altro.
 */
function copiaCampo<K extends NomeCampoReso>(out: DatiResi, tutti: DatiResi, campo: K): boolean {
  const valore = tutti[campo];
  if (valore === undefined) return false;
  out[campo] = valore;
  return true;
}

// ── la composizione di una pagina ────────────────────────────────────────────

/**
 * I BLOCCHI DI UNA PAGINA: la sequenza che la ricetta dichiara per il RUOLO della pagina, piu'
 * quella dichiarata per ogni ruolo che la pagina ASSORBE (T-213), con OGNI ID AL PIU' UNA VOLTA
 * e la PRIMA posizione dichiarata che vince.
 *
 * I RUOLI ASSORBITI sono quelli la cui precondizione e' soddisfatta ma che non hanno una pagina
 * propria — su una one-pager sono tutti (T-213). "Prendere in casa un ruolo" significa comporlo
 * come la ricetta lo compone: leggere `absorbed_roles` senza farne nulla lo renderebbe un campo
 * che nessun comportamento smentisce, che e' precisamente il difetto che T-213 ha corretto
 * TOGLIENDO un campo inerte.
 * CONSEGUENZA DICHIARATA: su una one-pager una direzione riceve nella home anche i blocchi che
 * aveva messo su una pagina interna — la 'scheda-sobria' ritrova il bottone WhatsApp, che teneva
 * sulla PAGINA contatti. La direzione dichiara DOVE vive l'invito, non che debba sparire quando
 * quella pagina non esiste.
 *
 * LA DEDUPLICAZIONE E' PORTANTE E NON DIFENSIVA: la sequenza della home contiene di norma gia'
 * i blocchi dei ruoli interni (ogni blocco dichiara il ruolo 'home', invariante di T-210),
 * quindi senza di essa OGNI one-pager avrebbe il blocco offerte due volte — cioe' il campo piu'
 * pesante del brief reso due volte sulla stessa pagina, che e' il caso misurato che sfonda il
 * tetto di byte del documento (vedi la decisione 1).
 *
 * L'indice e' un `Set` di id e il confronto e' per UGUAGLIANZA: gli id vengono dal nostro
 * catalogo, ma un oggetto indicizzato per stringa risolverebbe i membri di Object.prototype e
 * farebbe "esistere" un blocco chiamato 'constructor'. Nessun `sort` e nessun `reverse`: le
 * sequenze dichiarate arrivano da oggetti ESPORTATI e ordinarle in place le corromperebbe per
 * sempre.
 *
 * `absorbed_roles ?? []` — un PageSpec senza quel campo assorbe NULLA, non fa cadere resolve.
 * Il tipo lo pretende e `pagesFor` (T-213) lo scrive sempre, anche vuoto; ma il set puo'
 * arrivare da un artefatto salvato o da un chiamante scritto a mano, e misurato senza questa
 * riga era un "Cannot read properties of undefined (reading 'map')" DENTRO resolve, cioe' la
 * totalita' dichiarata in testa al file smentita da un campo mancante. Nessuna pagina, e non
 * un'eccezione: una pagina che non dichiara di assorbire nulla non assorbe nulla.
 */
function blocchiDellaPagina(
  recipe: SiteRecipe,
  brief: Brief,
  spec: PageSpec,
): readonly BlockDefinition[] {
  const assorbiti = spec.absorbed_roles ?? [];
  const sequenze: readonly (readonly BlockDefinition[])[] = [
    applyRecipe(recipe, brief, spec.role),
    ...assorbiti.map((ruolo) => applyRecipe(recipe, brief, ruolo)),
  ];

  const visti = new Set<string>();
  const composti: BlockDefinition[] = [];
  for (const sequenza of sequenze) {
    for (const blocco of sequenza) {
      if (visti.has(blocco.id)) continue;
      visti.add(blocco.id);
      composti.push(blocco);
    }
  }
  return composti;
}

/**
 * UN BLOCCO RISOLTO: il proprio id, la prosa degli slot che dichiara, i campi del brief che
 * dichiara di rendere E che il brief porta davvero, e lo slot immagine se apre la pagina.
 *
 * `brief_fields_rendered` elenca i campi PRESENTI, non quelli dichiarati dal catalogo: un campo
 * dichiarato ma assente sarebbe un campo vuoto travestito da campo reso, e T-231 lo
 * sanificherebbe a vuoto mentre la pagina mostrerebbe una riga senza contenuto. Le due letture
 * coincidono su un brief ricco e divergono esattamente dove conta.
 */
function bloccoRisolto(
  blocco: BlockDefinition,
  pagina: ContenutoBlocco,
  tutti: DatiResi,
  apreLaPagina: boolean,
): SiteBlock {
  const content: ContenutoBlocco = {};
  for (const slot of blocco.slots) copiaSlot(content, pagina, slot);

  const data: DatiResi = {};
  const resi: NomeCampoReso[] = [];
  for (const campo of blocco.brief_fields_rendered) {
    if (copiaCampo(data, tutti, campo)) resi.push(campo);
  }

  return {
    id: blocco.id,
    content,
    data,
    brief_fields_rendered: resi,
    images: apreLaPagina ? [{ source: 'theme-placeholder', token: blocco.id }] : [],
  };
}

/** I valori di TESTO della pagina, nell'ordine dei blocchi e degli slot dichiarati. */
function testiDellaPagina(blocks: readonly SiteBlock[]): readonly string[] {
  const testi: string[] = [];
  for (const blocco of blocks) {
    for (const valore of Object.values(blocco.content)) {
      if (typeof valore === 'string') testi.push(valore);
    }
  }
  return testi;
}

/**
 * IL TITOLO E LA META DESCRIPTION della pagina (vedi la decisione 3 in testa al file): il primo
 * testo che entra nel tetto del titolo, e il primo dei SUCCESSIVI che entra nel tetto della meta
 * description. La ricerca riparte dall'indice del titolo e non confronta i valori, cosi' due
 * slot con la stessa prosa non si annullano a vicenda.
 * I tetti sono letti da `DOCUMENT_LIMITS`, mai riscritti: sono code unit UTF-16, la stessa unita'
 * che il documento conta.
 */
function titoloEMeta(
  blocks: readonly SiteBlock[],
  slug: string,
): { readonly title: string; readonly meta_description: string } {
  const testi = testiDellaPagina(blocks);
  const indiceTitolo = testi.findIndex((testo) => testo.length <= DOCUMENT_LIMITS.page_title);
  const title = indiceTitolo >= 0 ? testi[indiceTitolo] : slug;
  const meta = testi
    .slice(indiceTitolo + 1)
    .find((testo) => testo.length <= DOCUMENT_LIMITS.meta_description);
  return { title, meta_description: meta ?? title };
}

// ── la funzione ──────────────────────────────────────────────────────────────

/**
 * COSTRUISCE IL DOCUMENTO: per ciascuna pagina del set applica la ricetta, riempie gli slot dei
 * blocchi col contenuto del pool di QUELLA pagina, e incorpora i campi del brief che i blocchi
 * rendono direttamente. Registra l'id VERSIONATO della ricetta e del tema usati.
 *
 * E' CHIAMABILE SU UN SOTTOINSIEME di pagine: la fase 1 la chiama sulla sola home (P2-D13), e in
 * quel caso il documento ha una pagina sola. Non c'e' nulla di speciale in quel caso — e' il
 * caso generale con un argomento piu' corto.
 *
 * UN BLOCCO IL CUI SLOT MANCA DAL POOL E' SCARTATO E RIPORTATO, mai reso vuoto: un blocco senza
 * prosa e' una sezione a metà, cioe' la pagina sottile prodotta in silenzio che P2-D7 e P2-D13
 * escludono. Lo stesso vale per il blocco che non dichiara ALCUNO slot, con `missing_slot: null`
 * perche' non c'e' uno slot da nominare. Un blocco la cui PRECONDIZIONE non e' soddisfatta,
 * invece, non compare in `dropped`: quello non e' stato scartato, non esiste (P2-D7). Mescolare
 * le due cose direbbe a T-230 che il pool ha un buco dove invece manca un DATO del brief.
 *
 * PURA E DETERMINISTICA: non legge nulla fuori dai propri argomenti, non muta ne' loro ne' i
 * cataloghi, non porta stato fra due chiamate. Gli stessi argomenti danno lo stesso documento
 * byte per byte (AC-214-1); argomenti diversi danno documenti che li distinguono, che e' l'altra
 * meta' della stessa proprieta'. Sulla TOTALITA' — che cosa fa cadere resolve e che cosa no —
 * vedi le due liste in testa al file: e' un contratto col chiamante, non un "non lancia mai".
 */
export function resolve(
  pool: Pool,
  recipe: SiteRecipe,
  theme: SiteTheme,
  brief: Brief,
  pageSpecs: readonly PageSpec[],
): ResolveResult {
  // La vista piatta del brief e' calcolata UNA VOLTA per chiamata: i dati resi sono gli stessi
  // su ogni pagina — e' il documento a ripeterli, non il brief a cambiare.
  const dati = datiDelBrief(brief);
  const dropped: DroppedBlock[] = [];
  const pages: SitePage[] = [];

  for (const spec of pageSpecs) {
    const contenutoDelPool = paginaDelPool(pool, spec.slug);
    const blocks: SiteBlock[] = [];

    for (const blocco of blocchiDellaPagina(recipe, brief, spec)) {
      // IL BLOCCO CHE NON DICHIARA ALCUNO SLOT E' SCARTATO, e lo e' SEMPRE — anche quando la
      // pagina esiste nel pool. Senza questo ramo entrava nel documento col contenuto VUOTO e
      // il gate lo ACCETTAVA (misurato: `parseDocument` su un blocco con `content: {}` ritorna
      // ok, perche' in T-201 ogni slot e' opzionale), cioe' produceva in silenzio proprio il
      // blocco vuoto che AC-214-4 vieta. Nessun blocco del catalogo di T-210 e' cosi' oggi — il
      // test lo PINNA, cosi' che il giorno in cui ne nascesse uno il rosso arrivi qui — quindi
      // il rischio e' FUTURO: un blocco senza prosa nascerebbe muto invece di essere riportato.
      // La voce di `dropped` e' UNA e ha `missing_slot: null`: non c'e' uno slot da nominare, e
      // riempire il pool non farebbe comparire questo blocco (vedi `DroppedBlock`).
      if (blocco.slots.length === 0) {
        dropped.push({ page_slug: spec.slug, block_id: blocco.id, missing_slot: null });
        continue;
      }
      const mancanti = slotMancanti(contenutoDelPool, blocco.slots);
      // La prima condizione e' cio' che rende `contenutoDelPool` non-`undefined` PER TIPO nella
      // riga che compone il blocco. Non e' un ramo di comportamento: con almeno uno slot
      // dichiarato, una pagina assente dal pool da' `mancanti` non vuoto e la seconda
      // condizione basterebbe — ma il compilatore non lo deduce, e togliere la prima non
      // compila. Il verso in cui vale la pena essere ridondanti.
      if (contenutoDelPool === undefined || mancanti.length > 0) {
        for (const slot of mancanti) {
          dropped.push({ page_slug: spec.slug, block_id: blocco.id, missing_slot: slot });
        }
        continue;
      }
      blocks.push(bloccoRisolto(blocco, contenutoDelPool, dati, blocks.length === 0));
    }

    pages.push({
      slug: spec.slug,
      role: spec.role,
      ...titoloEMeta(blocks, spec.slug),
      blocks,
    });
  }

  return { document: { recipe_id: recipe.id, theme_id: theme.id, pages }, dropped };
}
