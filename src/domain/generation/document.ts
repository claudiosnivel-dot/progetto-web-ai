// T-202 (macrotask generation-model, P2) — schema del SITE DOCUMENT, cioe' l'artefatto
// CONGELATO che P3 modifichera' e P4 pubblichera': `{ pages: [{ slug, role, title,
// meta_description, blocks: [...] }] }`, con almeno la home. Dominio PURO: nessun
// accesso al DB, nessun side effect, nessun client Supabase.
//
// E' UN GATE, come PoolSchema (T-201) e per la stessa ragione: la colonna
// site_generations.document e' jsonb OPACO — il DB non valida nulla — e il documento
// incorpora testo che viene dal MODELLO (attraverso il pool) e da SITI TERZI
// (attraverso `fromUrl`, T-141). E' quindi input NON FIDATO (OWASP A05:2025 / ASVS
// Validation & Business Logic), validato con schema strict PRIMA di essere scritto e
// prima di essere reso.
//
// UNA DIFESA DI QUESTO MODULO NON E' UN CONTROLLO: E' UN'IMPOSSIBILITA' DI
// RAPPRESENTAZIONE (P2-D12). Lo slot immagine e' un'unione discriminata su `source`
// con DUE varianti — `theme-placeholder` (con un token del tema) e `uploaded` (con
// l'id di un asset caricato) — e NESSUNA delle due ha un campo che possa contenere un
// indirizzo. Non esiste il posto dove mettere un `photo_ref` di terzi: non perche'
// qualcuno lo sorvegli, ma perche' il tipo non lo prevede. Ne segue che nessun bug
// futuro di rendering e nessun input ostile puo' far diventare QUEL valore un attributo
// di rete nel sito generato — il che conserva vera l'asserzione di P1 secondo cui
// photo_ref non finisce in un `src`. Chi legga questo file dovrebbe vederlo subito, e
// chi aggiunga un giorno una terza variante o un campo libero dovrebbe trovare rosso il
// test che lo pinna (tests/site-document-schema.test.ts).
//
// FIN DOVE ARRIVA QUELL'ARGOMENTO, ED E' IMPORTANTE NON DEDURNE DI PIU' (P2-D21,
// rilievo V-202-01 misurato su 18 punti del documento): l'irrappresentabilita' per TIPO
// copre LO SLOT IMMAGINE e PHOTO_REF, non il documento intero. I dati del brief resi
// direttamente (vedi `RENDERED_BRIEF_FIELDS`) portano campi di testo LIBERO che un URL
// lo accettano — `social_links` su tutti, che il repo stesso destina a un href
// (src/ui/onboarding/BriefPanel.tsx, src/ui/onboarding/ReviewConfirm.tsx,
// src/domain/import/fromUrl.ts) ed e' scrivibile dal modello attraverso il tool
// `update_brief` (src/domain/onboarding/interview.ts). E' una scelta, non una svista: i
// link ai profili social sono una funzione legittima del prodotto e restano.
// Ne segue che "nessuna richiesta verso host fuori allowlist" (T-241) NON e' vera per
// tipo su questa strada: e' vera solo se il VALIDATORE DEL CAMPO al momento di
// costruire l'href (T-237) la rende tale, e l'asserzione sull'EFFETTO (T-241) la
// verifica. Sono due precondizioni dichiarate su quei task, non conseguenze di questo
// schema. Un'affermazione di sicurezza falsa e' peggio della sua assenza, perche' chi
// viene dopo ci si appoggia.
//
// I VOCABOLARI E I TETTI SONO DERIVATI, MAI RICOPIATI:
// - i RUOLI di pagina vengono dal catalogo degli slot (slots.ts): due elenchi
//   divergenti sarebbero il difetto contro cui quel file mette in guardia;
// - i CONTENUTI risolti di un blocco hanno la forma della pagina del POOL (pool.ts),
//   quindi portano gli stessi tetti di POOL_LIMITS: il documento trasporta i valori
//   che il pool ha gia' fatto passare, e una seconda dichiarazione dei tetti
//   divergerebbe in silenzio;
// - i CAMPI DEL BRIEF resi direttamente hanno la forma della patch flat del brief
//   (brief.ts), quindi portano i tetti di BRIEF_LIMITS (P1-D17) — e la stessa
//   derivazione produce sia i valori ammessi sia i NOMI ammessi in
//   `brief_fields_rendered`, che percio' non possono divergere fra loro.
//
// COSA NON C'E' QUI, deliberatamente:
// - la COSTRUZIONE del documento (`resolve`, T-214) e il RENDERING dei blocchi
//   (T-231): questo modulo dichiara la forma e la valida, non la produce;
// - il catalogo dei BLOCCHI (T-210, macrotask generation-engine) non esiste ancora:
//   l'`id` di un blocco e' percio' vincolato nella FORMA e nella LUNGHEZZA e NON
//   confrontato con un catalogo. Vincolarlo qui inventerebbe una dipendenza su un
//   task non costruito.

import { z } from 'zod';
import { BRIEF_LIMITS, BriefUpdateSchema } from '@/domain/onboarding/brief';
import { isPlainObject, limitIssues } from '@/domain/generation/gate';
import { PoolSchema } from '@/domain/generation/pool';
import { SLOTS, type PageRole } from '@/domain/generation/slots';

// UNITA' DI MISURA: le lunghezze sono CODE UNIT UTF-16 (String.prototype.length, cio'
// che .max() conta), stessa scelta e stessa avvertenza di POOL_LIMITS e BRIEF_LIMITS —
// un'emoji o un carattere fuori dal BMP pesa due. `max_bytes` invece e' in BYTE della
// serializzazione UTF-8, perche' e' cio' che occupa la colonna jsonb e cio' che
// attraversa la rete: le due unita' non coincidono ed e' voluto che il tetto totale
// sia nell'unita' della cosa che limita.
//
// E LE DUE UNITA' DIVERGONO DAVVERO (P2-D21, rilievo V-202-03, misurato dal test):
// lo STESSO documento agli STESSI tetti pesa 3.357.278 byte riempito di ASCII e
// 6.397.198 (x1,905) riempito con le lettere accentate di italiano e spagnolo, cioe' i
// due locale del prodotto. Con la politica di NON TRONCAMENTO un tetto tarato
// sull'ASCII non taglierebbe quel documento: farebbe FALLIRE la generazione nelle sole
// due lingue che serviamo. Il tetto sta percio' sopra la misura MULTIBYTE.
//
// PERCHE' questi numeri:
// - `max_pages` = il tetto alto di P2-D13 ("one-pager e multi-pagina semplice, 5-10
//   pagine"). E' il tetto di SICUREZZA sul set derivato da T-213, non la sua politica.
// - `page_title` e `meta_description` sono circa il doppio di cio' che un motore di
//   ricerca mostra (~60 e ~160): un titolo legittimamente lungo non viene rifiutato,
//   un testo di taglia arbitraria non entra.
// - `page_slug` e' generoso per un segmento di percorso leggibile
//   ('chi-siamo-e-come-lavoriamo'), e chiude comunque la crescita di una chiave che
//   finisce in un URL.
// - `blocks_per_page`, `images_per_block` e `block_id` sono dimensionati sui blocchi
//   nominati dalla spec di design §7 (hero, offerte, chi-siamo, orari, contatti/mappa,
//   recensioni, FAQ, CTA WhatsApp) con margine: un documento non e' una pagina
//   infinita. La GALLERIA, che una versione precedente di questo commento elencava,
//   e' fuori dal catalogo v1 (P2-D24, 2026-07-29): i tetti restano questi e il
//   margine e' semmai piu' largo, quindi nessun numero cambia.
// - `image_token` e' un identificatore di imagery del tema, non un testo.
// - `versioned_id` e' il tetto di `recipe_id` e `theme_id`: sono identificatori
//   dichiarati a mano da noi (T-211/T-212), non testo, e la loro FORMA li tiene corti.
// - `error_issues` e `error_chars` sono i tetti del RAMO DI ERRORE, e valgono quanto i
//   loro omonimi di POOL_LIMITS perche' T-204 traduce i due errori nella stessa
//   colonna `failure_reason`. Sono qui e non importati da pool.ts per la stessa ragione
//   per cui i tetti di contenuto stanno accanto allo schema che governano: e'
//   condivisa la FUNZIONE che limita (gate.ts), non il numero.
// - `max_bytes` e' il BOUND TOTALE, ed e' l'unico tetto che i precedenti non danno: il
//   peso del documento e' un PRODOTTO (pagine x blocchi x campi) e nessun tetto per
//   campo lo limita. Il numero e' 8 MiB, scelto sopra il caso peggiore MULTIBYTE
//   MISURATO da AC-202-7 (6.397.198 byte, cioe' il 76,3% del tetto: dieci pagine che
//   portano ciascuna un brief a ogni tetto di P1-D17 e l'intero catalogo di slot ai
//   tetti di POOL_LIMITS, riempiti di lettere accentate) con un margine del 31,1% —
//   non sopra il caso peggiore ASCII (3.357.278 byte), che lascerebbe fuori italiano e
//   spagnolo.
//   COSA QUESTO TETTO NON COPRE, dichiarato e non lasciato implicito: il caso peggiore
//   in CJK pesa 9.437.118 byte e sfonderebbe. Il CJK non e' un locale del prodotto —
//   `BriefUpdateSchema.shape.locale` ammette 'it' e 'es' — e il test lo pinna, cosi'
//   il giorno in cui si aggiunge un locale ideografico questa riga diventa rossa invece
//   di restare una sorpresa in produzione.
//   In P1 lo stesso genere di numero (~405 KB per la riga del brief) era un limite
//   SENZA ORACOLO (§6-bis p.10): qui il caso peggiore e' costruito, misurato e
//   riportato da un test, e il tetto e' APPLICATO da parseDocument.
export const DOCUMENT_LIMITS = {
  /** Numero massimo di pagine del documento (P2-D13). */
  max_pages: 10,
  /** Tetto in code unit dello slug di una pagina. */
  page_slug: 80,
  /** Tetto in code unit del titolo di una pagina. */
  page_title: 120,
  /** Tetto in code unit della meta description di una pagina. */
  meta_description: 320,
  /** Numero massimo di blocchi in una pagina. */
  blocks_per_page: 12,
  /** Tetto in code unit dell'id di un blocco. */
  block_id: 64,
  /** Numero massimo di slot immagine in un blocco. */
  images_per_block: 8,
  /** Tetto in code unit del token di imagery del tema. */
  image_token: 48,
  /** Tetto in code unit dell'id VERSIONATO della ricetta e del tema. */
  versioned_id: 64,
  /** Numero massimo di issue riportati dal ramo di errore, e di elementi in ognuno. */
  error_issues: 24,
  /** Lunghezza massima, in code unit, di OGNI stringa riportata dal ramo di errore. */
  error_chars: 120,
  /** Tetto in BYTE (UTF-8) della serializzazione JSON dell'intero documento. */
  max_bytes: 8388608,
} as const;

// ── slot immagine ────────────────────────────────────────────────────────────

// FORMA DEL TOKEN: minuscole, cifre e trattini singoli. Non e' cerimonia — e' cio' che
// impedisce al SOLO campo di testo libero della variante `theme-placeholder` di
// diventare una scorciatoia per un indirizzo: senza ':' senza '/' e senza '.', un
// token non puo' essere ne un URL, ne un percorso, ne uno schema 'javascript:'.
const ImageTokenSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(DOCUMENT_LIMITS.image_token);

/**
 * LO SLOT IMMAGINE — il punto in cui questo modulo rende IRRAPPRESENTABILE cio' che
 * altrove sarebbe sorvegliato (P2-D12).
 *
 * Due varianti, discriminate da `source`, ed entrambe strict:
 * - `theme-placeholder`: l'imagery del TEMA, nominata da un token (v1);
 * - `uploaded`: un asset caricato dall'utente, nominato dal suo id (da P4).
 *
 * NESSUNA delle due ha `url`, `src`, `href` o qualunque altro campo che possa
 * contenere un indirizzo, e l'unione e' CHIUSA: una terza sorgente non esiste. Un
 * `photo_ref` proveniente da un sito terzo (T-141) non ha quindi alcun posto in cui
 * stare dentro il documento — non e' filtrato, e' impossibile da scrivere.
 *
 * `asset_id` e' un uuid come ogni identificatore di riga del progetto: la forma piu'
 * stretta possibile, e per costruzione priva di ':' '/' e '.', cosi' che nemmeno la
 * variante destinata a P4 possa un giorno ospitare un indirizzo travestito da id.
 */
const ImageSlotSchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('theme-placeholder'), token: ImageTokenSchema }).strict(),
  z.object({ source: z.literal('uploaded'), asset_id: z.string().uuid() }).strict(),
]);

// ── contenuti di un blocco ───────────────────────────────────────────────────

/**
 * I CONTENUTI RISOLTI di un blocco: la stessa forma della pagina del POOL (T-201),
 * cioe' gli id di slot del catalogo, ciascuno col valore del proprio kind e col
 * proprio tetto di POOL_LIMITS, e nessuna chiave sconosciuta.
 *
 * DERIVATA e non ricopiata: il documento trasporta i valori che il pool ha gia' fatto
 * passare, quindi un secondo elenco di slot (o una seconda dichiarazione dei tetti)
 * potrebbe solo divergere — e divergerebbe in silenzio, perche' nessuno confronta due
 * schemi scritti a mano in file diversi.
 */
const BlockContentSchema = PoolSchema.shape.pages.valueSchema;

// FORMA DELLA CHIAVE DEGLI ORARI. `hours` e' una mappa a CHIAVI LIBERE ereditata dal
// brief (P1-D13), e in una mappa del genere che nasce da JSON non fidato le chiavi
// speciali di JavaScript sono proprieta' PROPRIE: '__proto__' passava la validazione e
// poi SPARIVA dal documento restituito — `ok: true` su un risultato diverso
// dall'ingresso, cioe' la corruzione silenziosa che P1-D17 e T-201 vietano. Vincolata
// la forma, quella chiave diventa un RIFIUTO NOMINATO. E' la stessa difesa che pool.ts
// da' agli slug, con UNA differenza deliberata: la chiave degli orari non e' un
// segmento di URL, e' un'ETICHETTA RESA nella lingua dell'utente ('lunedi', 'lunedì',
// 'lun-ven', 'lunes'). Restringerla all'ASCII minuscolo come uno slug rifiuterebbe un
// documento legittimo in italiano o spagnolo, quindi la forma ammette le lettere di
// QUALUNQUE alfabeto e le cifre, con separatori singoli interni, e pretende un
// alfanumerico ai due bordi — che e' cio' che esclude '__proto__' e ogni chiave che
// cominci o finisca con un carattere strutturale.
// Solo DENTRO IL DOCUMENTO: brief.ts e' P1, gia' checkpointato, e non si tocca.
const HoursRecordSchema = BriefUpdateSchema.shape.hours.unwrap().innerType();
const HoursKeySchema = HoursRecordSchema.keySchema.regex(
  /^[\p{L}\p{N}]+(?:[ ./-][\p{L}\p{N}]+)*$/u,
);

/**
 * I CAMPI DEL BRIEF che un blocco rende DIRETTAMENTE (le offerte, gli orari, i
 * contatti e l'indirizzo non passano dal modello, P2-D4): stessa forma FLAT della
 * patch del brief (T-121), quindi stessi tetti di BRIEF_LIMITS (P1-D17), tutti i campi
 * opzionali e nessuna chiave sconosciuta.
 *
 * CON DUE DIFFERENZE, ed e' la ragione per cui questa forma e' derivata invece di
 * essere riusata tale e quale:
 * - `photo_ref` — l'URL di una foto di terzi raccolto da `fromUrl` (T-141) — e'
 *   RIMOSSO dalla voce di offerta: nel documento non esiste il campo che possa
 *   portarlo, quindi su QUELLA strada la proprieta' e' vera per TIPO e non dipende
 *   dalla diligenza di chi scrivera' `resolve` (T-214);
 * - la CHIAVE di `hours` e' vincolata nella forma (vedi `HoursKeySchema`).
 *
 * CIO' CHE RESTA, E VA LETTO COME UNA PRECONDIZIONE E NON COME UNA GARANZIA (P2-D21):
 * gli altri campi sono TESTO LIBERO e un URL lo accettano. `social_links` e' fatto
 * proprio per portarne uno, resta nel documento perche' i link ai profili social sono
 * una funzione legittima, ed e' scrivibile dal modello via `update_brief`. Non
 * dedurre da questo schema che un URL di terzi non possa arrivare a un href: la difesa
 * e' il VALIDATORE DEL CAMPO al momento di costruire il link (T-237) e l'asserzione
 * sull'effetto (T-241). Il test pinna la scelta — social_links accettato, photo_ref
 * rifiutato — cosi' che sia una decisione visibile e non un commento.
 */
const RENDERED_BRIEF_FIELDS = {
  ...BriefUpdateSchema.shape,
  offerings: BriefUpdateSchema.shape.offerings
    .unwrap()
    .element.omit({ photo_ref: true })
    .array()
    .max(BRIEF_LIMITS.offerings_items)
    .optional(),
  hours: z
    .record(HoursKeySchema, HoursRecordSchema.valueSchema)
    // Lo stesso tetto sul NUMERO di chiavi che il brief impone (P1-D13): ricostruire il
    // record per cambiarne la chiave perde il refine dell'originale, e senza di esso il
    // documento accetterebbe una mappa piu' grande di quella da cui viene.
    .refine((orari) => Object.keys(orari).length <= BRIEF_LIMITS.hours_keys)
    .optional(),
};

const RenderedBriefDataSchema = z.object(RENDERED_BRIEF_FIELDS).strict();

/**
 * I NOMI dei campi del brief che il blocco dichiara di rendere. Vengono dalla STESSA
 * derivazione dei valori qui sopra, quindi il vocabolario dei nomi e quello dei dati
 * non possono divergere: un campo che il brief non ha non e' nominabile.
 * Il cast e' sicuro per costruzione — sono le chiavi dell'oggetto di shape appena
 * dichiarato, e sono almeno una.
 */
const BRIEF_FIELD_NAMES = Object.keys(RENDERED_BRIEF_FIELDS) as [
  keyof z.infer<typeof BriefUpdateSchema>,
  ...(keyof z.infer<typeof BriefUpdateSchema>)[],
];

// ── blocco, pagina, documento ────────────────────────────────────────────────

// FORMA DELL'ID DI BLOCCO: minuscole, cifre, trattini o underscore singoli interni. Il
// catalogo dei blocchi nasce in T-210 e qui NON esiste: l'id e' percio' vincolato
// nella forma e nella lunghezza e non confrontato con un elenco. La forma esclude
// comunque per COSTRUZIONE le chiavi speciali di JavaScript ('__proto__' su tutte) e
// qualunque carattere che renda un id utilizzabile come percorso o come markup.
const BlockIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
  .max(DOCUMENT_LIMITS.block_id);

/**
 * UN BLOCCO del documento: il proprio id, i contenuti risolti, i dati del brief che
 * rende direttamente coi nomi dei campi corrispondenti, e i propri slot immagine.
 *
 * I quattro campi sono RICHIESTI anche quando sono vuoti (`{}` / `[]`): il documento e'
 * l'artefatto congelato che P3 modifichera' e P4 pubblichera', e in un contratto
 * "assente" e "vuoto" devono essere la stessa cosa detta in un modo solo, altrimenti
 * ogni consumatore a valle inventa la propria interpretazione della differenza.
 */
const BlockSchema = z
  .object({
    id: BlockIdSchema,
    content: BlockContentSchema,
    data: RenderedBriefDataSchema,
    brief_fields_rendered: z.array(z.enum(BRIEF_FIELD_NAMES)).max(BRIEF_FIELD_NAMES.length),
    images: z.array(ImageSlotSchema).max(DOCUMENT_LIMITS.images_per_block),
  })
  .strict();

// FORMA DELLO SLUG: la stessa di PoolSchema (T-201) — minuscole, cifre e trattini
// singoli — perche' e' lo stesso slug, quello che T-213 derivera' e che finira' nel
// percorso della pagina pubblicata. Qui porta anche un tetto di lunghezza, che nel
// pool non serviva perche' li' gli slug arrivano da un'allowlist.
const PageSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(DOCUMENT_LIMITS.page_slug);

// I RUOLI ammessi sono quelli del catalogo degli slot: derivati, non ricopiati. Il
// cast asserisce la sola cosa che il tipo non sa da solo, cioe' che l'elenco non e'
// vuoto; il tipo di uscita resta PageRole, quindi un vocabolario che divergesse da
// quello di slots.ts non compilerebbe.
const PAGE_ROLES = [...new Set(SLOTS.map((slot) => slot.page_role))] as [PageRole, ...PageRole[]];

// IL RUOLO CHE DEVE ESISTERE. La dichiarazione e' tipizzata su PageRole, quindi se il
// catalogo perdesse il ruolo 'home' questa riga non compilerebbe: l'invariante non puo'
// sopravvivere alla sparizione della cosa su cui poggia.
const HOME_ROLE: PageRole = 'home';

// FORMA DELL'ID VERSIONATO di ricetta e tema: uno slug minuscolo, poi '@' e un numero
// di versione. La versione e' DENTRO la forma, non accanto: un id senza '@n' e'
// rifiutato, quindi "versionato" e' imposto e non sperato — che e' tutto il punto di
// P2-D21 (un ritocco futuro a una ricetta non deve poter riscrivere un sito gia'
// pubblicato senza che l'id cambi).
// NON E' UN CONFRONTO CON UN CATALOGO, deliberatamente: i cataloghi di ricette e temi
// nascono in T-212 e T-211 e qui non esistono; vincolarli ora inventerebbe una
// dipendenza su task non costruiti. Restano la FORMA e la LUNGHEZZA — che bastano a
// escludere per costruzione ':' '/' '.' e le chiavi speciali di JavaScript, cioe' a
// impedire che un id diventi un percorso, un indirizzo o un markup.
const VersionedIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+$/)
  .max(DOCUMENT_LIMITS.versioned_id);

/**
 * UNA PAGINA: slug, ruolo, titolo, meta description e blocchi.
 *
 * Titolo e meta description sono RICHIESTI e NON VUOTI: una stringa vuota qui sarebbe
 * un campo mancante travestito da campo presente, cioe' la pagina sottile prodotta in
 * silenzio che P2-D7 esclude. Per la stessa ragione una pagina ha almeno un blocco:
 * una pagina senza blocchi e' una pagina vuota pubblicata.
 */
const PageSchema = z
  .object({
    slug: PageSlugSchema,
    role: z.enum(PAGE_ROLES),
    title: z.string().min(1).max(DOCUMENT_LIMITS.page_title),
    meta_description: z.string().min(1).max(DOCUMENT_LIMITS.meta_description),
    blocks: z.array(BlockSchema).min(1).max(DOCUMENT_LIMITS.blocks_per_page),
  })
  .strict();

/**
 * IL DOCUMENTO: gli id versionati della ricetta e del tema che l'hanno prodotto, e le
 * pagine. `pages` ha almeno un elemento e al piu' `max_pages`.
 *
 * RICETTA E TEMA SONO REGISTRATI QUI (P2-D21) benche' li produca `resolve` (T-214,
 * AC-214-2): questo schema e' STRICT, quindi due chiavi in piu' non si aggiungono a
 * valle senza riaprire un artefatto gia' passato dal checkpoint del proprio macrotask.
 * Servono a P3: un ritocco futuro a una ricetta non deve riscrivere un sito gia'
 * generato, e per saperlo bisogna sapere con quale VERSIONE e' stato generato.
 *
 * LA HOME E' IMPOSTA, non solo dichiarata: almeno una pagina ha ruolo 'home'. Era
 * scritta in tre punti in prosa e non la controllava nessuno — un documento la cui
 * unica pagina aveva ruolo 'faq' passava. Che le home siano ESATTAMENTE una NON e'
 * richiesto da alcuna decisione (P2-D13 dice che la home esiste sempre, non che sia
 * sola) e non e' imposto: sarebbe un vincolo inventato qui.
 *
 * Gli slug sono UNIVOCI nel documento: due pagine con lo stesso slug sono due pagine
 * che pretendono lo stesso indirizzo, e una delle due sarebbe irraggiungibile. Il
 * confronto e' per UGUAGLIANZA ESATTA e mai per prefisso: 'offerte' e
 * 'offerte-speciali' sono due pagine legittime, e un controllo scritto con
 * startsWith/includes le confonderebbe.
 *
 * NON e' il gate: quello e' `parseDocument`, che aggiunge la guardia di provenienza e
 * il tetto di byte. Questo schema e' esportato perche' e' la FORMA condivisa —
 * `resolve` (T-214) vi si conforma e i tipi qui sotto ne derivano.
 */
export const SiteDocumentSchema = z
  .object({
    recipe_id: VersionedIdSchema,
    theme_id: VersionedIdSchema,
    pages: z.array(PageSchema).min(1).max(DOCUMENT_LIMITS.max_pages),
  })
  .strict()
  .superRefine((documento, ctx) => {
    const visti = new Set<string>();
    documento.pages.forEach((pagina, indice) => {
      if (visti.has(pagina.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          // Lo slug viaggia nel PATH, che lo INDICA senza interpolarlo in una frase:
          // e' la stessa scelta del ramo di errore di parsePool (T-201). Qui e' gia'
          // passato dalla forma e dal tetto di PageSlugSchema, quindi non e' testo
          // libero — ma comporlo dentro un messaggio nasconderebbe comunque, a chi
          // legge l'errore, che quella stringa viene dal dato e non dal codice.
          path: ['pages', indice, 'slug'],
          message: 'slug di pagina duplicato',
        });
      }
      visti.add(pagina.slug);
    });

    if (!documento.pages.some((pagina) => pagina.role === HOME_ROLE)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages'],
        // Il messaggio nomina il RUOLO mancante, che e' un valore del codice e non del
        // dato: qui non c'e' niente di non fidato da interpolare.
        message: `nessuna pagina ha il ruolo '${HOME_ROLE}'`,
      });
    }
  });

export type SiteDocument = z.infer<typeof SiteDocumentSchema>;
export type SitePage = SiteDocument['pages'][number];
export type SiteBlock = SitePage['blocks'][number];
export type ImageSlot = SiteBlock['images'][number];

// ── il gate ──────────────────────────────────────────────────────────────────

/**
 * Il ramo di errore di `parseDocument`. NON e' la ZodError originale: e' LIMITATO ALLA
 * FONTE esattamente come quello di `parsePool` (P2-D20), e dallo STESSO limitatore
 * (gate.ts) — al piu' `DOCUMENT_LIMITS.error_issues` issue e nessuna stringa oltre
 * `DOCUMENT_LIMITS.error_chars` code unit.
 *
 * Serve qui quanto serve li': il documento incorpora testo del modello (via il pool) e
 * di siti terzi (via `fromUrl`, T-141), e le CHIAVI sconosciute di un input ostile
 * finirebbero verbatim e senza tetto nell'errore — cioe' proprio in cio' che T-204
 * traduce in `failure_reason`. Che parsePool fosse chiuso e parseDocument no era un
 * buco nella stessa colonna del DB.
 */
type DocumentValidationError = { readonly issues: readonly z.ZodIssue[] };

type ParseDocumentResult =
  | { readonly ok: true; readonly document: SiteDocument }
  | { readonly ok: false; readonly error: DocumentValidationError };

// L'unico costruttore del ramo di errore: nessuna via che non passi di qui, altrimenti
// il tetto dipenderebbe da chi scrive il return.
function limitedFailure(issues: readonly z.ZodIssue[]): ParseDocumentResult {
  return { ok: false, error: { issues: limitIssues(issues, DOCUMENT_LIMITS) } };
}

// La serializzazione, o `undefined` se il valore non e' serializzabile (un riferimento
// circolare, un BigInt). Un documento che non si puo' serializzare non si puo'
// nemmeno scrivere in una colonna jsonb: qui e' un rifiuto, mai un'eccezione.
function serializza(value: unknown): string | undefined {
  try {
    const json: string | undefined = JSON.stringify(value);
    return json;
  } catch {
    return undefined;
  }
}

/**
 * IL GATE sul documento — il solo da chiamare prima di scriverlo (T-204) e prima di
 * renderlo (T-231). Non LANCIA mai: restituisce il documento tipizzato oppure gli
 * issue di validazione, e chi chiama decide cosa farne.
 *
 * Tre controlli in quest'ordine, e l'ordine conta:
 * 1. PROVENIENZA — solo un oggetto semplice (vedi `isPlainObject`);
 * 2. PESO — il documento intero sta sotto `DOCUMENT_LIMITS.max_bytes`. E' prima della
 *    forma perche' e' il solo tetto che limita il PRODOTTO (pagine x blocchi x campi),
 *    che nessun tetto per campo limita, ed e' anche cio' che evita di far lavorare la
 *    validazione di forma su un input di taglia arbitraria. La misura e' sull'INPUT:
 *    lo schema e' strict e non aggiunge default, quindi cio' che esce non e' mai piu'
 *    grande di cio' che entra;
 * 3. FORMA — SiteDocumentSchema, strict a ogni livello, con l'unicita' degli slug.
 *
 * COSA IL GATE NON GARANTISCE, e chi consuma non deve dedurre:
 * - `ok: true` NON significa "il sito e' completo": quali blocchi debbano esistere in
 *   una pagina e' una precondizione dei BLOCCHI (T-210) e delle ricette (T-212), che
 *   qui non sono noti;
 * - `ok: true` NON significa "nessun URL di terzi e' nel documento": lo slot immagine e
 *   la voce di offerta non possono portarne uno, gli altri campi di testo del brief
 *   si' (vedi `RENDERED_BRIEF_FIELDS` e l'intestazione del modulo). La difesa sul link
 *   e' di T-237, l'asserzione sull'effetto di T-241;
 * - l'errore NON e' l'errore di validazione grezzo ne un elenco completo: e' troncato
 *   nel numero di issue e nella lunghezza di ogni stringa (vedi
 *   `DocumentValidationError`), quindi va bene per dire QUALE campo ha rotto il parse,
 *   non per contare i problemi ne per ricostruire l'input.
 */
export function parseDocument(input: unknown): ParseDocumentResult {
  if (!isPlainObject(input)) {
    return limitedFailure([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'il documento non e un oggetto semplice',
      },
    ]);
  }

  const json = serializza(input);
  if (json === undefined) {
    return limitedFailure([
      { code: z.ZodIssueCode.custom, path: [], message: 'il documento non e serializzabile' },
    ]);
  }

  const byte = new TextEncoder().encode(json).length;
  if (byte > DOCUMENT_LIMITS.max_bytes) {
    return limitedFailure([
      {
        code: z.ZodIssueCode.too_big,
        type: 'string',
        maximum: DOCUMENT_LIMITS.max_bytes,
        inclusive: true,
        path: [],
        // Il PESO misurato non compare nel messaggio: e' un numero che dipende
        // dall'input, e l'errore non deve raccontare l'input. Il tetto, che dipende
        // dal codice, sta in `maximum`.
        message: 'il documento supera il tetto di byte',
      },
    ]);
  }

  // Il risultato e' `parsed.data`, cioe' la COPIA che zod costruisce, mai `input`: cio'
  // che esce e' passato dalla validazione campo per campo e non condivide alcun oggetto
  // con l'ingresso, quindi nessuno a valle puo' ritrovarsi in mano una chiave che lo
  // schema non ha ammesso.
  const parsed = SiteDocumentSchema.safeParse(input);
  return parsed.success ? { ok: true, document: parsed.data } : limitedFailure(parsed.error.issues);
}
