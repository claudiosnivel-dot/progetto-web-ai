import { describe, it, expect } from 'vitest';
import {
  BRIEF_LIMITS,
  BriefUpdateSchema,
  applyBriefUpdate,
  emptyBrief,
  type Brief,
} from '@/domain/onboarding/brief';
import {
  PROJECTION_ALLOWLIST,
  PROJECTION_LIMITS,
  briefProjection,
  type BriefProjection,
  type ProjectionProfile,
} from '@/domain/generation/projection';

// T-220 (macrotask generation-llm, P2) — la PROIEZIONE del brief verso il modello.
// Le asserzioni derivano dagli acceptance_criteria AC-220-1..6 (03-generation-llm.md).
// Dominio PURO: nessun DB, nessun confine LLM mockato — briefProjection non chiama nulla.
//
// LIMITE DICHIARATO di questo file, ereditato dalle security_notes di T-220 (e da P1
// §6-bis p.6-bis): l'asserzione anti-fuga e' un MATCH PER SOTTOSTRINGA su
// JSON.stringify. Prova che QUESTA implementazione non perde, NON che nessuna
// implementazione possa perdere: una fuga TRASFORMATA (base64, percent-encoding,
// collasso degli spazi) le sfuggirebbe. La proprieta' e' tenuta da un oracolo, non dal
// design — fra il Brief e la proiezione non c'e' alcuna barriera di TIPO, perche'
// briefProjection riceve il Brief INTERO.

// Il token comune in testa a OGNI valore FUORI ALLOWLIST delle fixture. Non compare mai
// in un valore ammesso, quindi la sua sola presenza nella proiezione e' una fuga — ed e'
// anche il PREFISSO COMUNE che l'asserzione anti-fuga cerca per catturare le fughe
// TRONCATE (un campo che perdesse i primi 40 caratteri di un valore non farebbe comparire
// alcun marcatore INTERO).
const MARCA = 'Qvornyxel';

// ---------------------------------------------------------------------------
// I CAMPI FUORI ALLOWLIST, DERIVATI e non riscritti a mano.
//
// Sono le chiavi della patch FLAT del brief (T-121) meno l'allowlist DICHIARATA dal
// modulo. Derivarli e' cio' che rende l'oracolo indipendente da questo file: un campo
// nuovo del brief entra qui da solo e diventa subito materia di fuga; un campo spostato
// nell'allowlist smette di esserlo solo passando dalla costante esportata, cioe' da una
// decisione visibile nel diff.
const CAMPI_FUORI_ALLOWLIST: readonly string[] = Object.keys(BriefUpdateSchema.shape).filter(
  (campo) => !(PROJECTION_ALLOWLIST as readonly string[]).includes(campo),
);

// I sottocampi della VOCE dell'offerta, anch'essi DERIVATI dallo schema: l'allowlist
// ammette il solo campione di `name` + `section` (definition_of_done), quindi tutto il
// resto della voce — descrizione, prezzo, riferimento alla foto — e' fuori.
const SOTTOCAMPI_OFFERTA_FUORI_ALLOWLIST: readonly string[] = Object.keys(
  BriefUpdateSchema.shape.offerings.unwrap().element.shape,
).filter((campo) => campo !== 'name' && campo !== 'section');

/**
 * Le FOGLIE testuali di un valore del brief: stringhe e numeri, ricorsivamente. I numeri
 * ci sono per `geo`, che e' l'unico campo fuori allowlist il cui valore non e' testo e la
 * cui fuga sarebbe altrimenti inosservabile.
 */
function foglie(valore: unknown): readonly string[] {
  if (typeof valore === 'string') return valore.trim() === '' ? [] : [valore];
  if (typeof valore === 'number') return [String(valore)];
  if (Array.isArray(valore)) return valore.flatMap(foglie);
  if (valore !== null && typeof valore === 'object') return Object.values(valore).flatMap(foglie);
  return [];
}

/**
 * I MARCATORI: i valori dei campi fuori allowlist ESTRATTI DAL BRIEF a runtime.
 *
 * NON sono riscritti a mano, ed e' la differenza fra provare una cosa e provarne un'altra:
 * un elenco di letterali proverebbe che quelle STRINGHE non compaiono, mentre qui si prova
 * che non compare cio' che il brief CONTIENE DAVVERO — se una fixture cambia, cambiano i
 * marcatori con lei, e un campo aggiunto al brief e' sorvegliato senza toccare il test.
 *
 * Le CHIAVI di `hours` sono lette a parte perche' in quella mappa le chiavi sono DATO e
 * non nomi di campo (P1-D13: chiavi libere, che arrivano dal pannello o dal JSON-LD di un
 * terzo). Le chiavi di ogni altro oggetto sono nomi di campo e non entrano.
 */
function marcatoriFuoriAllowlist(brief: Brief): readonly string[] {
  // Vista FLAT del brief: i campi core stanno al top level, quelli di `content`
  // (social_links, offerings, ...) un livello sotto, mentre le chiavi della patch sono
  // tutte allo stesso livello.
  const flat: Record<string, unknown> = { ...brief, ...brief.content };
  const marcatori: string[] = CAMPI_FUORI_ALLOWLIST.flatMap((campo) => foglie(flat[campo]));

  marcatori.push(...Object.keys(brief.hours ?? {}));

  for (const offerta of brief.content?.offerings ?? []) {
    const voce: Record<string, unknown> = { ...offerta };
    marcatori.push(...SOTTOCAMPI_OFFERTA_FUORI_ALLOWLIST.flatMap((campo) => foglie(voce[campo])));
  }

  return [...new Set(marcatori)];
}

/**
 * Il PREFISSO COMUNE dei marcatori TESTUALI, calcolato sui marcatori estratti e non
 * dichiarato: cattura la fuga TRONCATA, che nessun confronto per marcatore intero vede.
 * I marcatori numerici (le coordinate di `geo`) sono esclusi dal calcolo, altrimenti
 * azzererebbero il prefisso e l'asserzione diventerebbe vuota.
 */
function prefissoComune(marcatori: readonly string[]): string {
  const testuali = marcatori.filter((marcatore) => /^[A-Za-z]/.test(marcatore));
  expect(
    testuali.length,
    'meno di due marcatori testuali: il prefisso non direbbe nulla',
  ).toBeGreaterThan(1);
  let prefisso = testuali[0];
  for (const marcatore of testuali) {
    while (prefisso.length > 0 && !marcatore.toLowerCase().startsWith(prefisso.toLowerCase())) {
      prefisso = prefisso.slice(0, -1);
    }
  }
  return prefisso;
}

/**
 * L'asserzione di ASSENZA, in due letture perche' una sola non basta:
 *  - per marcatore INTERO, cosi' il fallimento dice QUALE valore e' uscito;
 *  - sul PREFISSO COMUNE, che chiude la fuga troncata.
 * Entrambe CASE-INSENSITIVE: un valore passato in maiuscolo e' la stessa fuga.
 */
function attendiNessunaFuga(
  serializzato: string,
  marcatori: readonly string[],
  dove: string,
): void {
  const pagliaio = serializzato.toLowerCase();
  expect(
    marcatori.filter((marcatore) => pagliaio.includes(marcatore.toLowerCase())),
    `marcatori INTERI trovati in ${dove}`,
  ).toEqual([]);

  const prefisso = prefissoComune(marcatori);
  // Anti-vacuita': un prefisso di uno o due caratteri comparirebbe ovunque o da nessuna
  // parte per caso, e la riga sotto non proverebbe niente.
  expect(
    prefisso.length,
    `prefisso comune troppo corto in ${dove}: '${prefisso}'`,
  ).toBeGreaterThanOrEqual(6);
  expect(
    pagliaio.includes(prefisso.toLowerCase()),
    `prefisso '${prefisso}' trovato in ${dove}`,
  ).toBe(false);
}

/**
 * CONTRO-PROVA, da fare prima di ogni asserzione di assenza: i marcatori sono DAVVERO nel
 * brief che la proiezione riceve. Senza, una fixture costruita male renderebbe verde per
 * il motivo sbagliato tutto cio' che segue.
 */
function attendiMarcatoriNelBrief(
  brief: Brief,
  marcatori: readonly string[],
  minimo: number,
  dove: string,
): void {
  expect(marcatori.length, `troppo pochi marcatori estratti da ${dove}`).toBeGreaterThanOrEqual(
    minimo,
  );
  const briefJson = JSON.stringify(brief).toLowerCase();
  expect(
    marcatori.filter((marcatore) => !briefJson.includes(marcatore.toLowerCase())),
    `marcatori assenti dal brief ${dove}`,
  ).toEqual([]);
}

/**
 * La soglia di presenza RICALCOLATA QUI, e non importata da `@/domain/generation/gate`:
 * un oracolo che riusasse la funzione di presenza della produzione approverebbe qualunque
 * cosa quella funzione decidesse. Un testo di soli spazi e' ASSENTE.
 */
function conTesto(valore: unknown): valore is string {
  return typeof valore === 'string' && valore.trim() !== '';
}

/**
 * FEDELTA' VALORE<->CAMPO, campo per campo: ogni campo ammesso porta ESATTAMENTE il valore
 * del brief — non un valore costante, non il valore di un ALTRO campo, non una versione
 * TRONCATA — e un campo la cui materia manca (o e' presente-e-vuota) non compare affatto.
 *
 * PERCHE' non basta il confronto degli INSIEMI DI NOMI di campo (AC-220-1): misurato, con
 * il solo confronto dei nomi restavano VERDI cinque mutazioni su otto campi — `vertical`
 * reso costante 'altro', `primary_goal` reso costante 'ordina', `description` che porta il
 * valore di `business_name`, `description` troncata a 100 code unit, `brand_hints` troncato
 * a 10. Una proiezione che manda al modello il settore sbagliato o una description mutilata
 * e' la corruzione silenziosa che il progetto vieta altrove (P1-D17: mai troncare).
 *
 * Il campione delle offerte non passa di qui: e' l'unico campo che per contratto NON porta
 * il valore del brief tale e quale (taglia a PROJECTION_LIMITS.offering_sample e cambia
 * forma col profilo), ed e' asserito da AC-220-3 e AC-220-5.
 */
function attendiValoriFedeli(brief: Brief, proiezione: BriefProjection, dove: string): void {
  // I campi da enum CHIUSO: sempre presenti, sempre col valore del brief.
  expect(proiezione.vertical, `vertical in ${dove}`).toBe(brief.vertical);
  expect(proiezione.locale, `locale in ${dove}`).toBe(brief.locale);

  if (brief.primary_goal !== undefined) {
    expect(proiezione.primary_goal, `primary_goal in ${dove}`).toBe(brief.primary_goal);
  } else {
    expect(Object.hasOwn(proiezione, 'primary_goal'), `primary_goal in ${dove}`).toBe(false);
  }

  // I campi di TESTO: col valore esatto del brief se il brief ne porta testo, altrimenti
  // ASSENTI — non presenti e vuoti (Object.hasOwn e non `=== undefined`, perche' una
  // chiave presente con valore undefined sparisce da JSON.stringify e passerebbe).
  for (const [campo, valore] of [
    ['business_name', brief.business_name],
    ['description', brief.description],
    ['brand_hints', brief.content?.brand_hints],
  ] as const) {
    if (conTesto(valore)) expect(proiezione[campo], `${campo} in ${dove}`).toBe(valore);
    else expect(Object.hasOwn(proiezione, campo), `${campo} in ${dove}`).toBe(false);
  }

  const evidenze = (brief.content?.highlights ?? []).filter(conTesto);
  if (evidenze.length > 0) {
    expect([...(proiezione.highlights ?? [])], `highlights in ${dove}`).toEqual(evidenze);
  } else {
    expect(Object.hasOwn(proiezione, 'highlights'), `highlights in ${dove}`).toBe(false);
  }
}

/** Ogni NOME DI CHIAVE della proiezione, a qualunque profondita'. */
function chiaviProfonde(valore: unknown): readonly string[] {
  if (Array.isArray(valore)) return valore.flatMap(chiaviProfonde);
  if (valore !== null && typeof valore === 'object') {
    return Object.entries(valore).flatMap(([chiave, annidato]) => [
      chiave,
      ...chiaviProfonde(annidato),
    ]);
  }
  return [];
}

// ---------------------------------------------------------------------------
// FIXTURE. Ogni collezione ha PIU' DI UN elemento, con valori DISCORDANTI, e almeno una
// chiave che e' PREFISSO di un'altra (nomi delle offerte, sezioni, chiavi degli orari,
// link social): un confronto scritto con startsWith invece che con uguaglianza — nel
// raggruppamento per sezione, per esempio — deve poter essere osservato mentre sbaglia.

/**
 * Costruisce la fixture passando dallo schema del brief (T-121). Se una patch venisse
 * SCARTATA la fixture non avrebbe il campo che il caso deve provare, e ogni asserzione di
 * assenza sarebbe verde per il motivo sbagliato: qui il rifiuto e' rumoroso.
 */
function briefDa(locale: Brief['locale'], patch: Record<string, unknown>): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief(locale), patch);
  expect(rejected, 'la fixture non e un brief valido').toEqual([]);
  return brief;
}

/** Brief con TUTTI i campi valorizzati: i soli fuori allowlist portano il marcatore. */
function briefCompleto(locale: Brief['locale']): Brief {
  return briefDa(locale, {
    business_name: 'Trattoria Nove',
    vertical: 'ristorazione',
    description: 'Cucina di mercato in centro, aperta dal 1953.',
    primary_goal: 'prenota',
    brand_hints: 'Toni caldi, legno e ottone.',
    highlights: ['Forno a legna', 'Terrazza sul fiume'],
    address: `${MARCA} Via delle Rose 9`,
    geo: { lat: 45.123456789, lng: 9.876543211 },
    hours: {
      [`${MARCA}-gio`]: `${MARCA} 09:00-23:00`,
      [`${MARCA}-giov`]: `${MARCA} 10:00-24:30`,
    },
    phone: `${MARCA}-telefono-0011`,
    whatsapp: `${MARCA}-whatsapp-0033`,
    email: `${MARCA}-email-0022`,
    social_links: [`${MARCA}-social-uno`, `${MARCA}-social-uno-bis`],
    offerings: [
      {
        name: 'Antipasto della casa',
        section: 'Antipasti',
        description: `${MARCA} descrizione della voce`,
        price: `${MARCA} 12`,
        photo_ref: `${MARCA}-foto-ref`,
      },
      {
        name: 'Antipasto della casa speciale',
        section: 'Antipasti Freddi',
        description: `${MARCA} altra descrizione`,
        price: `${MARCA} 18`,
        photo_ref: `${MARCA}-foto-ref-due`,
      },
    ],
  });
}

/**
 * Brief come lo lascia un IMPORT da URL (T-141): i campi fuori allowlist valorizzati,
 * TRANNE address, whatsapp e geo, che restano vuoti di proposito.
 */
function briefImportato(locale: Brief['locale']): Brief {
  return briefDa(locale, {
    business_name: 'Trattoria Nove',
    vertical: 'ristorazione',
    description: 'Cucina di mercato in centro, aperta dal 1953.',
    primary_goal: 'prenota',
    brand_hints: 'Toni caldi, legno e ottone.',
    highlights: ['Forno a legna', 'Terrazza sul fiume'],
    hours: {
      [`${MARCA}-gio`]: `${MARCA} 09:00-23:00`,
      [`${MARCA}-giov`]: `${MARCA} 10:00-24:30`,
    },
    phone: `${MARCA}-telefono-0011`,
    email: `${MARCA}-email-0022`,
    social_links: [`${MARCA}-social-uno`, `${MARCA}-social-uno-bis`],
    offerings: [
      {
        name: 'Antipasto della casa',
        section: 'Antipasti',
        description: `${MARCA} descrizione della voce`,
        price: `${MARCA} 12`,
        photo_ref: `${MARCA}-foto-ref`,
      },
      {
        name: 'Antipasto della casa speciale',
        section: 'Antipasti Freddi',
        description: `${MARCA} altra descrizione`,
        price: `${MARCA} 18`,
        photo_ref: `${MARCA}-foto-ref-due`,
      },
    ],
  });
}

/**
 * Il caso a RUOLI INVERTITI: valorizzati SOLO i campi che `briefImportato` lascia vuoti.
 * L'UNIONE dei due casi rende osservabile la fuga di OGNI campo fuori allowlist — un campo
 * lasciato vuoto non ha un valore da perdere, quindi un caso solo non basta.
 */
function briefRuoliInvertiti(locale: Brief['locale']): Brief {
  return briefDa(locale, {
    business_name: 'Officina Rossi',
    vertical: 'salone_studio',
    description: 'Riparazioni e tagliandi su appuntamento.',
    primary_goal: 'contatta',
    address: `${MARCA} Via delle Rose 9`,
    whatsapp: `${MARCA}-whatsapp-0033`,
    geo: { lat: 45.123456789, lng: 9.876543211 },
  });
}

/**
 * Il caso PRESENTE-E-VUOTO, che nessun'altra fixture costruisce: `description` di soli
 * spazi, `brand_hints` di soli caratteri di spaziatura, `highlights` con voci piene e voci
 * vuote MESCOLATE, e `business_name` OMESSO.
 *
 * E' costruibile e reale, non un caso di laboratorio: `applyBriefUpdate` trima il solo
 * `business_name` (`z.string().trim().min(1)`, quindi un nome di soli spazi e' SCARTATO e
 * il caso costruibile e' l'assenza), mentre `description`, `brand_hints` e le voci di
 * `highlights` sono `z.string().max(...)` senza trim: un testo di soli spazi e' un valore
 * VALIDO che arriva fin qui — e nel prompt occuperebbe posto dicendo al modello che
 * qualcosa c'e'.
 *
 * Le offerte sono ESATTAMENTE UNA, ed e' il punto: il confine `campione.length === 0`
 * distingue il campione vuoto da quello con una sola voce, e con due voci un confine
 * spostato di uno resterebbe invisibile.
 */
function briefTestiVuoti(): Brief {
  return briefDa('it', {
    vertical: 'salone_studio',
    description: '   ',
    primary_goal: 'contatta',
    brand_hints: '\t\n ',
    highlights: ['Taglio e piega', '   ', 'Colore vegetale', ''],
    offerings: [{ name: 'Consulenza', section: 'Servizi' }],
  });
}

/** Brief con 200 offerte (il tetto di P1-D17), ciascuna con tutti i sottocampi. */
function briefDuecentoOfferte(): Brief {
  return briefDa('it', {
    business_name: 'Trattoria Nove',
    vertical: 'ristorazione',
    primary_goal: 'ordina',
    // 'Voce 1' e' PREFISSO di 'Voce 10' e 'Sezione 1' di 'Sezione 10': la coppia nasce
    // dalla numerazione, e un dedup o un raggruppamento scritto per prefisso la perderebbe.
    offerings: Array.from({ length: BRIEF_LIMITS.offerings_items }, (_ignorato, indice) => ({
      name: `Voce ${indice}`,
      section: `Sezione ${indice % 12}`,
      description: `${MARCA} descrizione ${indice}`,
      price: `${MARCA} prezzo ${indice}`,
      photo_ref: `${MARCA}-foto-${indice}`,
    })),
  });
}

/** Una stringa esattamente al tetto, riconoscibile dalla testa. */
function alTetto(limite: number, testa: string): string {
  return testa + 'x'.repeat(limite - testa.length);
}

/**
 * Brief con OGNI campo e OGNI collezione al tetto di P1-D17. E' il caso peggiore vero
 * della proiezione: `vertical` e `primary_goal` portano il valore piu' lungo dei rispettivi
 * enum, e ogni offerta ha una sezione DIVERSA — cosi' il profilo 'inner' produce tanti
 * gruppi quante sono le voci del campione, che e' la sua forma piu' pesante.
 */
function briefAiTetti(): Brief {
  return briefDa('it', {
    business_name: alTetto(BRIEF_LIMITS.business_name, 'nome-'),
    vertical: 'negozio_artigiano',
    description: alTetto(BRIEF_LIMITS.description, 'descrizione-'),
    primary_goal: 'contatta',
    address: alTetto(BRIEF_LIMITS.address, 'indirizzo-'),
    geo: { lat: 45.123456789, lng: 9.876543211 },
    phone: alTetto(BRIEF_LIMITS.phone, 'tel-'),
    whatsapp: alTetto(BRIEF_LIMITS.whatsapp, 'wa-'),
    email: alTetto(BRIEF_LIMITS.email, 'mail-'),
    brand_hints: alTetto(BRIEF_LIMITS.brand_hints, 'stile-'),
    hours: Object.fromEntries(
      Array.from({ length: BRIEF_LIMITS.hours_keys }, (_ignorato, indice) => [
        alTetto(BRIEF_LIMITS.hours_key, `g${indice}-`),
        alTetto(BRIEF_LIMITS.hours_value, `orario${indice}-`),
      ]),
    ),
    highlights: Array.from({ length: BRIEF_LIMITS.highlights_items }, (_ignorato, indice) =>
      alTetto(BRIEF_LIMITS.highlight, `punto${indice}-`),
    ),
    social_links: Array.from({ length: BRIEF_LIMITS.social_links_items }, (_ignorato, indice) =>
      alTetto(BRIEF_LIMITS.social_link, `social${indice}-`),
    ),
    offerings: Array.from({ length: BRIEF_LIMITS.offerings_items }, (_ignorato, indice) => ({
      name: alTetto(BRIEF_LIMITS.offering_name, `voce${indice}-`),
      section: alTetto(BRIEF_LIMITS.offering_section, `sez${indice}-`),
      description: alTetto(BRIEF_LIMITS.offering_description, `desc${indice}-`),
      price: alTetto(BRIEF_LIMITS.offering_price, `prezzo${indice}-`),
      photo_ref: alTetto(BRIEF_LIMITS.offering_photo_ref, `foto${indice}-`),
    })),
  });
}

/** Sei offerte distribuite in tre sezioni, di cui una PREFISSO di un'altra. */
function briefSeiOfferteTreSezioni(): Brief {
  return briefDa('it', {
    business_name: 'Trattoria Nove',
    vertical: 'ristorazione',
    description: 'Cucina di mercato in centro, aperta dal 1953.',
    primary_goal: 'prenota',
    brand_hints: 'Toni caldi, legno e ottone.',
    highlights: ['Forno a legna', 'Terrazza sul fiume'],
    offerings: [
      { name: 'Bruschetta', section: 'Antipasti' },
      { name: 'Tagliatelle', section: 'Primi' },
      { name: 'Vitello tonnato', section: 'Antipasti Freddi' },
      { name: 'Bruschetta al pomodoro', section: 'Antipasti' },
      { name: 'Gnocchi', section: 'Primi' },
      { name: 'Insalata russa', section: 'Antipasti Freddi' },
    ],
  });
}

/**
 * Sei offerte di cui DUE SENZA SEZIONE. In un brief importato da un sito (T-141) l'offerta
 * senza sezione e' il caso NORMALE, non l'eccezione: nessuna delle altre fixture ne aveva
 * una, e il ramo del modulo che la governa non veniva mai eseguito.
 *
 * Le due senza sezione stanno IN MEZZO, non in coda: il gruppo che le raccoglie deve
 * nascere nell'ordine di PRIMA COMPARIZIONE come ogni altro, e messo in fondo sarebbe
 * l'ultimo anche con un ordinamento sbagliato. 'Antipasti' e' PREFISSO di 'Antipasti
 * Freddi' anche qui, cosi' il caso senza sezione non fa perdere la coppia che rende
 * osservabile un raggruppamento scritto con startsWith.
 */
function briefOfferteSenzaSezione(): Brief {
  return briefDa('it', {
    business_name: 'Trattoria Nove',
    vertical: 'ristorazione',
    primary_goal: 'ordina',
    offerings: [
      { name: 'Bruschetta', section: 'Antipasti' },
      { name: 'Coperto' },
      { name: 'Vitello tonnato', section: 'Antipasti Freddi' },
      { name: 'Bruschetta al pomodoro', section: 'Antipasti' },
      { name: 'Coperto festivo' },
      { name: 'Insalata russa', section: 'Antipasti Freddi' },
    ],
  });
}

/**
 * Sei offerte in tre sezioni i cui NOMI sono membri di Object.prototype. Le sezioni sono
 * testo del brief, cioe' input NON FIDATO usato come chiave del raggruppamento: e' il caso
 * che rende falsificabile la difesa che il modulo dichiara (la `Map` invece dell'oggetto
 * letterale). Misurato: senza questa fixture, sostituire la `Map` con un oggetto letterale
 * lasciava la suite verde con 11 test su 11, cioe' un gruppo '__proto__' sarebbe sparito
 * in silenzio senza che nulla diventasse rosso.
 *
 * '__proto__' e' PREFISSO di '__proto__ speciale' e i nomi 'Ostile uno' / 'Ostile uno bis'
 * cadono in due gruppi DIVERSI: la coppia-prefisso ha qualcosa da far sbagliare, non e'
 * disciplina applicata alla lettera.
 */
function briefSezioniOstili(): Brief {
  return briefDa('it', {
    business_name: 'Officina Rossi',
    vertical: 'negozio_artigiano',
    primary_goal: 'contatta',
    offerings: [
      { name: 'Ostile uno', section: '__proto__' },
      { name: 'Ostile due', section: 'constructor' },
      { name: 'Ostile uno bis', section: '__proto__ speciale' },
      { name: 'Ostile tre', section: '__proto__' },
      { name: 'Ostile quattro', section: 'constructor' },
      { name: 'Ostile cinque', section: '__proto__ speciale' },
    ],
  });
}

const PROFILI: readonly ProjectionProfile[] = ['home', 'inner'];

/** Il campione della proiezione, con la guardia che c'e' davvero. */
function campioneDi(proiezione: BriefProjection): NonNullable<BriefProjection['offerings']> {
  const campione = proiezione.offerings;
  expect(campione, 'la proiezione non porta alcun campione di offerte').toBeDefined();
  return campione ?? [];
}

// ---------------------------------------------------------------------------

describe('T-220 proiezione del brief: allowlist nominata, due profili', () => {
  // Pin dei numeri: sono l'unico posto in cui sono scritti a mano, tutte le altre
  // asserzioni li derivano dalla costante. Senza, cambiare un tetto (o aggiungerne uno
  // senza deciderlo) resterebbe verde.
  it('PROJECTION_LIMITS ha esattamente le tre costanti nominate della DoD', () => {
    expect(PROJECTION_LIMITS).toEqual({
      home: 16_000,
      inner: 17_000,
      offering_sample: 24,
    }); // DoD T-220 — tetto in code unit per profilo, piu offering_sample
  });

  it("l'allowlist e una struttura esplicita ed enumerata, non una serie di accessi sparsi", () => {
    expect([...PROJECTION_ALLOWLIST]).toEqual([
      'business_name',
      'vertical',
      'description',
      'primary_goal',
      'locale',
      'brand_hints',
      'highlights',
      'offerings',
    ]); // DoD T-220
    // I campi fuori allowlist esistono davvero e sono piu' di uno: senza questa riga
    // un'allowlist che coprisse l'intero brief renderebbe vuote tutte le asserzioni di fuga.
    expect([...CAMPI_FUORI_ALLOWLIST].sort()).toEqual([
      'address',
      'email',
      'geo',
      'hours',
      'phone',
      'social_links',
      'whatsapp',
    ]); // DoD T-220
    expect([...SOTTOCAMPI_OFFERTA_FUORI_ALLOWLIST].sort()).toEqual([
      'description',
      'photo_ref',
      'price',
    ]); // DoD T-220
  });

  // covers: AC-220-1
  // La fixture "tutto pieno" e' l'unica con TUTTI i campi fuori allowlist valorizzati
  // insieme alle offerte complete, ed e' proiettata con ENTRAMBI i profili: provarla sul
  // solo 'home' lasciava la copertura del caso peggiore di fase 2 alle sole fixture di
  // AC-220-2, che pero' tengono address, whatsapp e geo vuoti di proposito.
  it('un brief con TUTTI i campi: la proiezione porta i soli campi dell allowlist, coi valori del brief e nessun valore fuori', () => {
    const brief = briefCompleto('it');
    const marcatori = marcatoriFuoriAllowlist(brief);
    // 2 chiavi + 2 valori di hours, phone, whatsapp, email, address, lat, lng,
    // 2 social, 2x3 sottocampi delle offerte = 18.
    attendiMarcatoriNelBrief(brief, marcatori, 18, 'briefCompleto'); // covers: AC-220-1

    for (const profilo of PROFILI) {
      const proiezione = briefProjection(brief, profilo);

      // I SOLI campi presenti sono quelli dell'allowlist dichiarata, per uguaglianza esatta
      // dell'insieme: ne' uno in piu' (una fuga) ne' uno in meno (un campo perso).
      expect(Object.keys(proiezione).sort(), profilo).toEqual([...PROJECTION_ALLOWLIST].sort()); // covers: AC-220-1
      // ...e ciascuno porta ESATTAMENTE il valore del brief. I valori della fixture sono
      // DISCORDANTI fra loro (il nome non e' la description, che non e' il brand_hints):
      // senza questa riga lo scambio fra due campi resta invisibile all'uguaglianza degli
      // insiemi di NOMI, che e' quanto l'AC chiede alla lettera.
      attendiValoriFedeli(brief, proiezione, `briefCompleto/${profilo}`); // DoD T-220 — l'objective enumera i campi ammessi CON il loro contenuto
      // Nessun NOME di campo fuori allowlist compare come chiave, a nessuna profondita'.
      expect(
        chiaviProfonde(proiezione).filter((chiave) => CAMPI_FUORI_ALLOWLIST.includes(chiave)),
        profilo,
      ).toEqual([]); // covers: AC-220-1
      // La stessa verifica per i sottocampi dell'offerta, ma RISTRETTA al campione: al top
      // level 'description' e' un campo del brief AMMESSO, e cercarlo ovunque confonderebbe
      // il campo legittimo con la descrizione della voce, che ammessa non e'.
      expect(
        chiaviProfonde(campioneDi(proiezione)).filter((chiave) =>
          SOTTOCAMPI_OFFERTA_FUORI_ALLOWLIST.includes(chiave),
        ),
        profilo,
      ).toEqual([]); // covers: AC-220-1
      for (const voce of campioneDi(proiezione)) {
        expect(Object.keys(voce).sort(), profilo).toEqual(
          profilo === 'home' ? ['name', 'section'] : ['names', 'section'],
        ); // covers: AC-220-1
      }

      attendiNessunaFuga(JSON.stringify(proiezione), marcatori, `proiezione '${profilo}'`); // covers: AC-220-1

      // Controllo di senso opposto: la proiezione NON e' vuota — cio' che l'allowlist
      // ammette c'e' davvero, altrimenti ogni asserzione di assenza sarebbe verde per il
      // motivo sbagliato (una proiezione che non parte non perde nulla).
      const serializzata = JSON.stringify(proiezione);
      expect(serializzata, profilo).toContain('Trattoria Nove'); // covers: AC-220-1
      expect(serializzata, profilo).toContain('Forno a legna'); // covers: AC-220-1
      expect(serializzata, profilo).toContain('Antipasto della casa speciale'); // covers: AC-220-1
    }
  });

  // covers: AC-220-2
  // Il PRODOTTO CARTESIANO {it, es} x {import, ruoli invertiti}, e per ciascuna
  // combinazione ENTRAMBI i profili: una fuga presente nel solo ramo 'es' o nel solo
  // profilo di fase 2 sarebbe invisibile a un oracolo che prova un caso solo, e una fuga
  // in una lingua e' una fuga.
  for (const locale of ['it', 'es'] as const) {
    for (const [nomeCaso, costruisci, minimoMarcatori, chiaviAttese] of [
      ['import', briefImportato, 14, PROJECTION_ALLOWLIST],
      [
        'ruoli invertiti',
        briefRuoliInvertiti,
        4,
        ['business_name', 'vertical', 'description', 'primary_goal', 'locale'],
      ],
    ] as const) {
      it(`nessun valore fuori allowlist raggiunge la proiezione (locale ${locale}, ${nomeCaso})`, () => {
        const brief = costruisci(locale);
        const marcatori = marcatoriFuoriAllowlist(brief);
        attendiMarcatoriNelBrief(brief, marcatori, minimoMarcatori, `${nomeCaso}/${locale}`); // covers: AC-220-2

        for (const profilo of PROFILI) {
          const proiezione = briefProjection(brief, profilo);
          const serializzata = JSON.stringify(proiezione);
          attendiNessunaFuga(serializzata, marcatori, `${nomeCaso}/${locale}/${profilo}`); // covers: AC-220-2
          // Anti-vacuita' per ciascuna delle quattro combinazioni e per ciascun profilo:
          // una proiezione vuota non perderebbe nulla e sarebbe verde per il motivo
          // sbagliato.
          expect(serializzata, `${nomeCaso}/${locale}/${profilo}`).toContain(
            String(brief.business_name),
          ); // covers: AC-220-2
          expect(proiezione.locale, `${nomeCaso}/${locale}/${profilo}`).toBe(locale); // covers: AC-220-2

          // Un campo ASSENTE dal brief non compare AFFATTO, invece di comparire vuoto: al
          // modello va detto cosa c'e', e un campo vuoto e' un invito a inventare (P1-D24).
          // 'ruoli invertiti' non ha ne' offerte, ne' highlights, ne' brand_hints, e il suo
          // insieme di chiavi lo dice per UGUAGLIANZA ESATTA. Misurato: senza questa riga
          // restavano verdi `offerings: []` sempre presente e `highlights` sempre presente.
          expect(Object.keys(proiezione).sort(), `${nomeCaso}/${locale}/${profilo}`).toEqual(
            [...chiaviAttese].sort(),
          ); // DoD T-220 — l'objective enumera i campi ammessi, e un campo senza materia non e uno di essi
          attendiValoriFedeli(brief, proiezione, `${nomeCaso}/${locale}/${profilo}`); // DoD T-220
        }
      });
    }
  }

  // covers: AC-220-2
  // La copertura dell'UNIONE delle due fixture, DETTA e non lasciata ai conteggi minimi:
  // 'import' valorizza hours/phone/email/social_links, 'ruoli invertiti' address/whatsapp/
  // geo, e insieme coprono tutti e sette i campi fuori allowlist. Senza questa riga un
  // campo NUOVO del brief entrerebbe in CAMPI_FUORI_ALLOWLIST da solo — quindi nei
  // marcatori attesi — ma non in alcuna fixture, e i minimi 14/4 non se ne accorgerebbero:
  // il prodotto cartesiano resterebbe verde su un campo che nessun brief porta.
  it("l'unione delle due fixture di AC-220-2 valorizza OGNI campo fuori allowlist", () => {
    const valorizzati = (brief: Brief): readonly string[] => {
      const flat: Record<string, unknown> = { ...brief, ...brief.content };
      return CAMPI_FUORI_ALLOWLIST.filter((campo) => foglie(flat[campo]).length > 0);
    };
    const unione = new Set([
      ...valorizzati(briefImportato('it')),
      ...valorizzati(briefRuoliInvertiti('it')),
    ]);
    expect([...unione].sort()).toEqual([...CAMPI_FUORI_ALLOWLIST].sort()); // covers: AC-220-2
  });

  // covers: AC-220-3
  it('con 200 offerte il campione si ferma a PROJECTION_LIMITS.offering_sample e porta solo name e section', () => {
    const brief = briefDuecentoOfferte();
    expect(brief.content.offerings).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-220-3

    const proiezione = briefProjection(brief, 'home');
    const campione = campioneDi(proiezione);

    expect(campione).toHaveLength(PROJECTION_LIMITS.offering_sample); // covers: AC-220-3
    for (const voce of campione) {
      expect(Object.keys(voce).sort()).toEqual(['name', 'section']); // covers: AC-220-3
    }

    // Nessuna description, nessun price, nessun photo_ref: sono 600 marcatori estratti
    // dalle 200 voci, e la loro assenza e' asserita valore per valore.
    const marcatori = marcatoriFuoriAllowlist(brief);
    attendiMarcatoriNelBrief(brief, marcatori, 600, 'briefDuecentoOfferte'); // covers: AC-220-3
    attendiNessunaFuga(JSON.stringify(proiezione), marcatori, '200 offerte'); // covers: AC-220-3

    // I nomi del campione sono i PRIMI del brief, nell'ordine del brief: il campione
    // taglia, non rimescola.
    expect(JSON.stringify(campione)).toContain('Voce 0'); // covers: AC-220-3
    expect(JSON.stringify(proiezione)).not.toContain(`"Voce ${PROJECTION_LIMITS.offering_sample}"`); // covers: AC-220-3
  });

  // covers: AC-220-4
  it('al tetto di P1-D17 i due profili restano sotto PROJECTION_LIMITS, e i due valori MISURATI sono riportati', () => {
    const brief = briefAiTetti();

    // La fixture e' davvero AI TETTI: se un tetto smettesse di essere saturo il numero
    // misurato non sarebbe piu' il caso peggiore, e il bound non direbbe nulla.
    expect(brief.business_name).toHaveLength(BRIEF_LIMITS.business_name); // covers: AC-220-4
    expect(brief.description).toHaveLength(BRIEF_LIMITS.description); // covers: AC-220-4
    expect(brief.content.brand_hints).toHaveLength(BRIEF_LIMITS.brand_hints); // covers: AC-220-4
    expect(brief.content.highlights).toHaveLength(BRIEF_LIMITS.highlights_items); // covers: AC-220-4
    expect(brief.content.highlights[0]).toHaveLength(BRIEF_LIMITS.highlight); // covers: AC-220-4
    expect(brief.content.offerings).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-220-4
    expect(brief.content.offerings[0].name).toHaveLength(BRIEF_LIMITS.offering_name); // covers: AC-220-4
    expect(brief.content.offerings[0].section).toHaveLength(BRIEF_LIMITS.offering_section); // covers: AC-220-4

    const proiezioneHome = briefProjection(brief, 'home');
    const proiezioneInner = briefProjection(brief, 'inner');
    const misuraHome = JSON.stringify(proiezioneHome).length;
    const misuraInner = JSON.stringify(proiezioneInner).length;

    // Il campione e' SATURO in entrambi i profili, e in 'inner' ogni voce ha una sezione
    // diversa: e' la forma piu' pesante che il raggruppamento possa produrre.
    expect(campioneDi(proiezioneHome)).toHaveLength(PROJECTION_LIMITS.offering_sample); // covers: AC-220-4
    expect(campioneDi(proiezioneInner)).toHaveLength(PROJECTION_LIMITS.offering_sample); // covers: AC-220-4

    // IL BOUND DAL BASSO. Le due asserzioni di tetto provano che la proiezione non SFONDA,
    // non che porti ancora cio' che deve portare: misurato, troncare gli highlights al
    // primo elemento (-3800 code unit, il 24% del budget di 'home') lasciava tutto verde —
    // il "budget e' anche la difesa" reggeva nella sola direzione dell'eccesso. Questo e'
    // anche l'unico brief in cui description (2000) e brand_hints (500) sono abbastanza
    // lunghi da rendere osservabile un troncamento silenzioso.
    attendiValoriFedeli(brief, proiezioneHome, "tetti/'home'"); // DoD T-220
    attendiValoriFedeli(brief, proiezioneInner, "tetti/'inner'"); // DoD T-220

    const rapporto =
      `[AC-220-4] proiezione MISURATA su un brief con OGNI campo e OGNI collezione al ` +
      `tetto di P1-D17 (~405 KB di brief): profilo 'home' ${misuraHome} code unit su un ` +
      `tetto di ${PROJECTION_LIMITS.home} ` +
      `(${((misuraHome / PROJECTION_LIMITS.home) * 100).toFixed(1)}% del budget), profilo ` +
      `'inner' ${misuraInner} code unit su un tetto di ${PROJECTION_LIMITS.inner} ` +
      `(${((misuraInner / PROJECTION_LIMITS.inner) * 100).toFixed(1)}%). Col proxy ~4:1 ` +
      `dichiarato da P2-D17 sono ~${Math.round(misuraHome / 4)} e ` +
      `~${Math.round(misuraInner / 4)} token: il brief intero ne varrebbe ~100k.`;
    console.log(rapporto);

    expect(misuraHome, rapporto).toBeLessThan(PROJECTION_LIMITS.home); // covers: AC-220-4
    expect(misuraInner, rapporto).toBeLessThan(PROJECTION_LIMITS.inner); // covers: AC-220-4
  });

  // covers: AC-220-5
  it("sei offerte in tre sezioni: 'inner' e raggruppato, 'home' e piatto, e i NOMI DI CAMPO coincidono", () => {
    const brief = briefSeiOfferteTreSezioni();
    const proiezioneHome = briefProjection(brief, 'home');
    const proiezioneInner = briefProjection(brief, 'inner');

    // NESSUN CAMPO NUOVO PER LA FASE 2: l'insieme dei nomi di campo della proiezione e'
    // identico nei due profili, ed e' esattamente l'allowlist dichiarata.
    expect(Object.keys(proiezioneHome).sort()).toEqual(Object.keys(proiezioneInner).sort()); // covers: AC-220-5
    expect(Object.keys(proiezioneHome).sort()).toEqual([...PROJECTION_ALLOWLIST].sort()); // covers: AC-220-5
    // E nessun nome di campo del brief fuori allowlist entra da nessuna delle due parti,
    // a nessuna profondita'.
    for (const proiezione of [proiezioneHome, proiezioneInner]) {
      expect(
        chiaviProfonde(proiezione).filter((chiave) => CAMPI_FUORI_ALLOWLIST.includes(chiave)),
      ).toEqual([]); // covers: AC-220-5
    }

    // 'home' e' PIATTO: una voce per offerta, nell'ordine del brief.
    const piatto = campioneDi(proiezioneHome);
    expect(piatto).toHaveLength(6); // covers: AC-220-5
    expect(piatto.map((voce) => ('name' in voce ? voce.name : null))).toEqual([
      'Bruschetta',
      'Tagliatelle',
      'Vitello tonnato',
      'Bruschetta al pomodoro',
      'Gnocchi',
      'Insalata russa',
    ]); // covers: AC-220-5

    // 'inner' e' RAGGRUPPATO PER SEZIONE: tre gruppi, nell'ordine di prima comparizione,
    // ciascuno coi soli nomi della propria sezione. 'Antipasti' e' PREFISSO di
    // 'Antipasti Freddi': un raggruppamento scritto con startsWith invece che con
    // uguaglianza ne produrrebbe due invece di tre, e sbaglierebbe qui.
    const raggruppato = campioneDi(proiezioneInner);
    expect(raggruppato).toHaveLength(3); // covers: AC-220-5
    expect(
      raggruppato.map((gruppo) =>
        'names' in gruppo ? { section: gruppo.section, names: [...gruppo.names] } : null,
      ),
    ).toEqual([
      { section: 'Antipasti', names: ['Bruschetta', 'Bruschetta al pomodoro'] },
      { section: 'Primi', names: ['Tagliatelle', 'Gnocchi'] },
      { section: 'Antipasti Freddi', names: ['Vitello tonnato', 'Insalata russa'] },
    ]); // covers: AC-220-5

    // I due profili portano gli STESSI nomi di offerta: cambia la forma del campione, non
    // il campione.
    expect(
      raggruppato.flatMap((gruppo) => ('names' in gruppo ? [...gruppo.names] : [])).sort(),
    ).toEqual(piatto.flatMap((voce) => ('name' in voce ? [voce.name] : [])).sort()); // covers: AC-220-5
  });

  // covers: AC-220-5
  // Lo STESSO caso dell'AC — sei offerte in tre sezioni, i due profili a confronto — con
  // le sezioni scelte fra i membri di Object.prototype. E' la prova eseguibile della difesa
  // che il modulo DICHIARA (la `Map` invece dell'oggetto letterale, perche' le sezioni sono
  // input non fidato usato come chiave): misurato, senza questo caso la sostituzione della
  // `Map` con un oggetto letterale restava verde con 11 test su 11, cioe' il gruppo
  // '__proto__' sarebbe sparito in silenzio. Un commento che rivendica una difesa senza
  // oracolo e' la forma di falso via libera che il macrotask vieta (L-COL-006).
  it("sezioni che sono membri di Object.prototype: i gruppi ci sono tutti, coi nomi giusti", () => {
    const brief = briefSezioniOstili();
    const proiezioneHome = briefProjection(brief, 'home');
    const proiezioneInner = briefProjection(brief, 'inner');

    expect(Object.keys(proiezioneHome).sort()).toEqual(Object.keys(proiezioneInner).sort()); // covers: AC-220-5

    const piatto = campioneDi(proiezioneHome);
    expect(piatto.map((voce) => ('name' in voce ? voce.name : null))).toEqual([
      'Ostile uno',
      'Ostile due',
      'Ostile uno bis',
      'Ostile tre',
      'Ostile quattro',
      'Ostile cinque',
    ]); // covers: AC-220-5

    const raggruppato = campioneDi(proiezioneInner);
    expect(
      raggruppato.map((gruppo) =>
        'names' in gruppo ? { ...gruppo, names: [...gruppo.names] } : null,
      ),
    ).toStrictEqual([
      { section: '__proto__', names: ['Ostile uno', 'Ostile tre'] },
      { section: 'constructor', names: ['Ostile due', 'Ostile quattro'] },
      { section: '__proto__ speciale', names: ['Ostile uno bis', 'Ostile cinque'] },
    ]); // covers: AC-220-5
  });

  // Il gruppo SENZA sezione. Nessun AC lo nomina: discende dalla definition_of_done "il
  // campione delle offerte ... riporta solo name e section" e dall'objective ("un campione
  // di soli NOMI di offerte con la loro sezione") — un'offerta che nel brief non ha sezione
  // non ne ha una nella proiezione, e non porta affatto la chiave `section` invece di
  // portarla vuota. Il modulo lo dichiara ("non e' una sezione chiamata 'altro', che sarebbe
  // un nome inventato in grado di collidere con una vera") e nessuna fixture lo eseguiva:
  // misurato, includere sempre `section` nella voce e nel gruppo restava verde su 11 test.
  // Il confronto e' toStrictEqual e non toEqual perche' e' l'unico che distingue una chiave
  // ASSENTE da una chiave presente con valore undefined — che JSON.stringify poi cancella.
  it('le offerte senza sezione: la voce e il gruppo non portano affatto la chiave section', () => {
    const brief = briefOfferteSenzaSezione();

    const piatto = campioneDi(briefProjection(brief, 'home'));
    expect(piatto.map((voce) => ('name' in voce ? { ...voce } : null))).toStrictEqual([
      { name: 'Bruschetta', section: 'Antipasti' },
      { name: 'Coperto' },
      { name: 'Vitello tonnato', section: 'Antipasti Freddi' },
      { name: 'Bruschetta al pomodoro', section: 'Antipasti' },
      { name: 'Coperto festivo' },
      { name: 'Insalata russa', section: 'Antipasti Freddi' },
    ]); // DoD T-220

    const raggruppato = campioneDi(briefProjection(brief, 'inner'));
    expect(
      raggruppato.map((gruppo) =>
        'names' in gruppo ? { ...gruppo, names: [...gruppo.names] } : null,
      ),
    ).toStrictEqual([
      { section: 'Antipasti', names: ['Bruschetta', 'Bruschetta al pomodoro'] },
      { names: ['Coperto', 'Coperto festivo'] },
      { section: 'Antipasti Freddi', names: ['Vitello tonnato', 'Insalata russa'] },
    ]); // DoD T-220
  });

  // La soglia di PRESENZA. Nessun AC la nomina: discende dall'objective, che enumera i campi
  // ammessi con la materia che portano — un testo di soli spazi non e' materia da cui
  // scrivere, e nel prompt occuperebbe posto dicendo al modello che qualcosa c'e'.
  // E' un caso costruibile e reale, non di laboratorio: `applyBriefUpdate` trima il solo
  // `business_name`, quindi una description di soli spazi e un highlight vuoto sono valori
  // VALIDI che arrivano fin qui. Misurato: togliere il trim dalla soglia di description e di
  // brand_hints, e togliere il filtro degli highlights vuoti, restava verde su 11 test.
  it('i testi presenti-e-vuoti sono assenti dalla proiezione, come il campo che il brief non porta', () => {
    const brief = briefTestiVuoti();
    // Contro-prova sulla fixture: i valori vuoti ci sono DAVVERO. Se lo schema li avesse
    // trimati o scartati, ogni asserzione di assenza qui sotto sarebbe verde per il motivo
    // sbagliato.
    expect(brief.business_name, 'business_name deve essere assente').toBeUndefined();
    expect(brief.description, 'description deve essere di soli spazi').toBe('   ');
    expect(brief.content.brand_hints, 'brand_hints deve essere di soli spazi').toBe('\t\n ');
    expect(brief.content.highlights, 'due highlights pieni e due vuoti').toHaveLength(4);

    for (const profilo of PROFILI) {
      const proiezione = briefProjection(brief, profilo);
      expect(Object.keys(proiezione).sort(), profilo).toEqual([
        'highlights',
        'locale',
        'offerings',
        'primary_goal',
        'vertical',
      ]); // DoD T-220
      attendiValoriFedeli(brief, proiezione, `testi vuoti/${profilo}`); // DoD T-220
      // Il campione c'e' con la sua UNICA voce: il confine che distingue il campione VUOTO
      // (nessun campo `offerings` nella proiezione) da quello con una sola voce sta a zero,
      // e con due voci uno spostamento di uno sarebbe cieco.
      expect(campioneDi(proiezione), profilo).toHaveLength(1); // DoD T-220
    }
  });

  // covers: AC-220-6
  it('e PURA: il brief in ingresso e invariato dopo entrambe le proiezioni', () => {
    const brief = briefCompleto('es');
    const prima = structuredClone(brief);
    const primaSerializzato = JSON.stringify(brief);

    briefProjection(brief, 'home');
    briefProjection(brief, 'inner');

    expect(brief).toEqual(prima); // covers: AC-220-6
    expect(JSON.stringify(brief)).toBe(primaSerializzato); // covers: AC-220-6 — nemmeno l'ordine delle chiavi

    // La proiezione non CONDIVIDE le collezioni col brief: senza questa riga un consumatore
    // che ordinasse in place il campione o gli highlights riscriverebbe il brief, e la
    // purezza varrebbe per la sola chiamata.
    const proiezione = briefProjection(brief, 'home');
    expect(proiezione.highlights).not.toBe(brief.content.highlights); // DoD T-220 — funzione pura
    expect(campioneDi(proiezione)).not.toBe(brief.content.offerings); // DoD T-220 — funzione pura
    expect(brief).toEqual(prima); // covers: AC-220-6
  });
});
