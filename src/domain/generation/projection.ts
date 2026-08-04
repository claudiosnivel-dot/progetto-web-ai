// T-220 (macrotask generation-llm, P2) — LA PROIEZIONE: la sola porzione del brief che
// raggiunge il modello, in due profili. Dominio PURO: nessun accesso al DB, nessun side
// effect, nessuna chiamata al confine — e nessuna mutazione del brief in ingresso.
//
// E' LA DIFESA IN INGRESSO (P2-D4, OWASP A05:2025), e non una frase in un prompt.
// `description`, `highlights`, i nomi delle offerte e `business_name` provengono da siti
// terzi attraverso `fromUrl` (T-141): sono testo NON FIDATO che P2 deve per forza mandare
// al modello, perche' e' da li' che nasce il copy. P1-D24 aveva AZZERATO la superficie
// mandando al modello i soli NOMI dei campi; P2 non puo', quindi la CONTIENE con
// un'allowlist NOMINATA — lo stesso principio con un gradino in piu', non un'inversione.
// L'altra meta' della difesa non e' qui: e' l'assenza di leve in uscita (T-222, solo testo
// in slot nominati). Un'iniezione riuscita ottiene un copy diverso da quello atteso, in un
// mockup che l'utente guarda prima di pubblicare, e nient'altro.
//
// E' INSIEME IL BUDGET E LA DIFESA, e le due cose sono la stessa azione: il brief intero
// pesa ~405 KB (~100k token con il proxy ~4:1) e le offerte, che ne sono il 95%, al modello
// NON SERVONO — il sito le rende direttamente (T-214). Ridurre il payload e ridurre la
// superficie coincidono.
//
// L'ALLOWLIST E' UNA STRUTTURA ENUMERATA, non una serie di accessi sparsi ai campi: e' la
// differenza fra una difesa ISPEZIONABILE — un oracolo la confronta con le chiavi
// realmente prodotte (AC-220-1) e un lettore la legge in tre righe — e una convenzione che
// vive sparpagliata dentro un costruttore di oggetti. La FORMA della proiezione e' derivata
// da lei per TIPO (vedi `Proiezione`), quindi un campo che l'allowlist non nomina non e'
// nemmeno scrivibile.
//
// COSA NON PASSA, IN NESSUNO DEI DUE PROFILI: descrizioni delle offerte, prezzi,
// `photo_ref`, contatti (phone/whatsapp/email), orari, indirizzo, `geo`, `social_links`.
// Sono dati STRUTTURATI che il sito rende tali e quali (P2-D4): farli passare dal modello
// aggiungerebbe superficie di iniezione e peso senza aggiungere nulla al copy.
//
// LIMITE DICHIARATO (eredita P1 §6-bis p.6-bis). La proprieta' anti-fuga e' tenuta da un
// ORACOLO, non dal design: l'asserzione e' un match per SOTTOSTRINGA su JSON.stringify,
// quindi prova che QUESTA implementazione non perde, non che nessuna implementazione possa
// perdere — una fuga TRASFORMATA (base64, percent-encoding, collasso degli spazi) le
// sfuggirebbe. E non esiste barriera di TIPO fra il Brief e la proiezione: `briefProjection`
// riceve il Brief INTERO, cioe' ha in mano tutto cio' che non deve far uscire.
//
// I TETTI NON SONO IMPOSTI, SONO ASSERITI. `PROJECTION_LIMITS.home/inner` non troncano
// nulla a runtime: troncare sarebbe corruzione silenziosa (stesso contratto di P1-D17 e di
// POOL_LIMITS). Il tetto vale PER COSTRUZIONE, perche' ogni campo ammesso ha gia' il proprio
// in BRIEF_LIMITS e il campione delle offerte e' limitato nel numero — e la coincidenza fra
// il bound e la costante e' MISURATA da un test sul brief al tetto di P1-D17 (AC-220-4).
// Ne segue il costo dichiarato: un Brief costruito a mano OLTRE BRIEF_LIMITS (che nessun
// writer applicativo produce, ma che il tipo ammette) sfonderebbe il tetto senza che nulla
// qui se ne accorga.

import type { Brief, BriefUpdateSchema } from '@/domain/onboarding/brief';
import { testoPresente } from '@/domain/generation/gate';

/**
 * I nomi di campo nominabili dall'allowlist: le chiavi della patch FLAT del brief (T-121),
 * le stesse che i blocchi usano per dichiarare cio' che rendono (T-210). DERIVATI e mai
 * ricopiati — un'allowlist che nominasse un campo che il brief non ha sarebbe un errore di
 * typecheck invece che una voce morta.
 */
type NomeCampoDelBrief = keyof (typeof BriefUpdateSchema)['shape'];

/**
 * L'ALLOWLIST NOMINATA (P2-D4): gli unici campi del brief che raggiungono il modello.
 * Vale IDENTICA per i due profili — la fase 2 non aggiunge campi, cambia solo la forma del
 * campione delle offerte.
 *
 * PERCHE' proprio questi, e non altri: sono i campi da cui il modello deve SCRIVERE.
 * `business_name`, `description`, `highlights` e `brand_hints` sono la materia del copy;
 * `vertical`, `primary_goal` e `locale` sono enum CHIUSI (T-121), quindi non trasportano
 * testo iniettabile e dicono al modello settore, obiettivo e lingua; il campione delle
 * offerte gli dice di che cosa parla l'attivita' senza consegnargli il catalogo.
 * `brand_hints` entra come indicazione di TONO per il copy e non come leva sull'estetica:
 * il tema e' scelto da noi (P2-D1), e lasciarglielo scegliere sarebbe un canale — piccolo,
 * ma un canale.
 */
export const PROJECTION_ALLOWLIST = [
  'business_name',
  'vertical',
  'description',
  'primary_goal',
  'locale',
  'brand_hints',
  'highlights',
  'offerings',
] as const satisfies readonly NomeCampoDelBrief[];

type CampoAmmesso = (typeof PROJECTION_ALLOWLIST)[number];

/**
 * I tetti della proiezione, in CODE UNIT UTF-16 (String.prototype.length, cio' che misura
 * `JSON.stringify(...).length`) — stessa unita' e stessa avvertenza di BRIEF_LIMITS e di
 * POOL_LIMITS: un'emoji o un carattere fuori dal BMP pesa due.
 *
 * SONO STIME DICHIARATE PROVVISORIE (P2-D17), non misure: `count_tokens` e' un endpoint API
 * e senza chiave il proxy in code unit al rapporto ~4:1 e' tutto cio' che abbiamo. La sede
 * della taratura e' T-225, che gira solo in presenza di una chiave e altrimenti si dichiara
 * non eseguito, mai verde.
 *
 * COME SONO SCELTI. Il caso peggiore MISURATO su un brief con ogni campo e ogni collezione
 * al tetto di P1-D17 e' 14.714 code unit per 'home' e 14.786 per 'inner' (AC-220-4, il test
 * lo riporta a ogni esecuzione): i tetti stanno appena sopra, con l'8,7% e il 15,0% di
 * margine sul valore misurato.
 * Sono deliberatamente PIU' STRETTI della stima della spec di design §8 (~8k token per
 * 'home', ~10k per 'inner', cioe' ~32k e ~40k code unit): un tetto largo il doppio del caso
 * peggiore sarebbe verde qualunque cosa succeda, e questa costante esiste per diventare
 * ROSSA quando qualcuno allarga l'allowlist o alza `offering_sample` senza accorgersi di
 * cosa costa. 'inner' sta sopra 'home' perche' la forma raggruppata paga il nome della
 * sezione una volta per gruppo, e nel caso peggiore i gruppi sono tanti quante le voci.
 */
export const PROJECTION_LIMITS = {
  /** Tetto in code unit della proiezione del profilo 'home' (fase 1). */
  home: 16_000,
  /** Tetto in code unit della proiezione del profilo 'inner' (fase 2). */
  inner: 17_000,
  /**
   * Numero massimo di NOMI di offerta nel campione, in entrambi i profili.
   *
   * PERCHE' 24 e non 200 (il tetto di P1-D17): al modello il campione serve a sapere DI CHE
   * COSA si occupa l'attivita' — per l'occhiello, il racconto e l'introduzione alla sezione
   * offerte — e ventiquattro nomi glielo dicono quanto duecento. Mandarli tutti costerebbe
   * al tetto 200 x (200 + 100) code unit, cioe' da solo il quadruplo di tutto il resto
   * della proiezione messo insieme, per un contenuto che il sito rende comunque da se'
   * (T-214). Ventiquattro reggono anche il profilo 'inner', dove il campione deve coprire
   * PIU' SEZIONI: sei sezioni da quattro voci, o dodici da due.
   */
  offering_sample: 24,
} as const;

/** Una voce del campione PIATTO (profilo 'home'): il nome dell'offerta e la sua sezione. */
type VoceDelCampione = {
  readonly name: string;
  readonly section?: string;
};

/**
 * Un gruppo del campione RAGGRUPPATO (profilo 'inner'): i nomi di una sezione. Il gruppo
 * senza `section` raccoglie le voci che nel brief non ne dichiarano una — non e' una sezione
 * chiamata "altro", che sarebbe un nome inventato in grado di collidere con una vera.
 */
type GruppoDelCampione = {
  readonly section?: string;
  readonly names: readonly string[];
};

type CampionePiatto = readonly VoceDelCampione[];
type CampioneRaggruppato = readonly GruppoDelCampione[];

/**
 * Il valore che ciascun campo ammesso porta nella proiezione. `C` e' la forma del campione
 * delle offerte, cioe' l'UNICA cosa che cambia fra i due profili.
 */
type ValoriAmmessi<C> = {
  readonly business_name: string;
  readonly vertical: Brief['vertical'];
  readonly description: string;
  readonly primary_goal: NonNullable<Brief['primary_goal']>;
  readonly locale: Brief['locale'];
  readonly brand_hints: string;
  readonly highlights: readonly string[];
  readonly offerings: C;
};

/**
 * LA FORMA E' DERIVATA DALL'ALLOWLIST, non scritta accanto a lei: le chiavi sono
 * ESATTAMENTE le voci di `PROJECTION_ALLOWLIST`. Un campo aggiunto all'allowlist senza
 * dargli un valore qui e' un errore di typecheck; un campo aggiunto ai valori senza
 * nominarlo nell'allowlist semplicemente non esiste nella proiezione — cioe' non puo'
 * raggiungere il modello per distrazione.
 *
 * Ogni campo e' OPZIONALE perche' un campo ASSENTE dal brief non compare affatto, invece di
 * comparire vuoto: al modello va detto cosa c'e', e cio' che non gli e' disponibile glielo
 * dichiara il system prompt (T-223) invece di un campo vuoto da riempire.
 */
type Proiezione<C> = { readonly [K in CampoAmmesso]?: ValoriAmmessi<C>[K] };

/** La parte comune ai due profili: tutto tranne il campione delle offerte. */
type BaseComune = Omit<Proiezione<never>, 'offerings'>;

/** I due profili: 'home' e' la fase 1 (i cinque mockup), 'inner' la fase 2 (P2-D13). */
export type ProjectionProfile = 'home' | 'inner';

/**
 * La proiezione del brief. I NOMI DI CAMPO sono gli stessi nei due profili: differisce solo
 * la forma del campione delle offerte, piatta in 'home' e per sezione in 'inner'.
 */
export type BriefProjection = Proiezione<CampionePiatto> | Proiezione<CampioneRaggruppato>;

/**
 * I campi ammessi che non dipendono dal profilo. Un testo PRESENTE-E-VUOTO e' assente
 * (`testoPresente`, la stessa soglia con cui un blocco esiste o no in T-210): un
 * `description` di soli spazi non e' materia da cui scrivere, e occuperebbe posto nel
 * prompt dicendo al modello che qualcosa c'e'.
 */
function baseComune(brief: Brief): BaseComune {
  const evidenze = (brief.content?.highlights ?? []).filter(testoPresente);
  return {
    ...(testoPresente(brief.business_name) ? { business_name: brief.business_name } : {}),
    vertical: brief.vertical,
    ...(testoPresente(brief.description) ? { description: brief.description } : {}),
    ...(brief.primary_goal !== undefined ? { primary_goal: brief.primary_goal } : {}),
    locale: brief.locale,
    ...(testoPresente(brief.content?.brand_hints)
      ? { brand_hints: brief.content.brand_hints }
      : {}),
    ...(evidenze.length > 0 ? { highlights: evidenze } : {}),
  };
}

/**
 * Il campione: i PRIMI `PROJECTION_LIMITS.offering_sample` nomi di offerta, nell'ordine del
 * brief, ciascuno con la sola sezione. Taglia, non rimescola e non sceglie: un campione
 * "rappresentativo" scelto da noi sarebbe una decisione invisibile presa al posto
 * dell'utente, che ha gia' ordinato le sue voci.
 */
function campioneDelleOfferte(brief: Brief): CampionePiatto {
  const campione: VoceDelCampione[] = [];
  for (const offerta of brief.content?.offerings ?? []) {
    if (campione.length >= PROJECTION_LIMITS.offering_sample) break;
    // DIFESA IN PROFONDITA' DICHIARATA NON FALSIFICABILE. Nessun Brief prodotto da
    // `applyBriefUpdate` puo' attivare questa guardia, perche' `OfferingSchema.name` e'
    // `z.string().trim().min(1)`: il nome arriva gia' trimmato e non vuoto. Misurato dalla
    // verifica avversariale: toglierla e' un mutante EQUIVALENTE, nessun oracolo diventa
    // rosso — e nessuno puo' diventarlo, quindi la riga non e' coperta ne' copribile.
    // Resta perche' questa funzione riceve il Brief INTERO senza barriera di TIPO (il limite
    // dichiarato in testa al modulo) e il tipo `Brief` ammette un name vuoto costruito a
    // mano: nel campione sarebbe una voce senza contenuto, cioe' peso nel prompt che al
    // modello non dice nulla. Stessa forma con cui P2-D22(d) tiene il fallback
    // irraggiungibile di `comeStato`.
    if (!testoPresente(offerta.name)) continue;
    campione.push({
      name: offerta.name,
      ...(testoPresente(offerta.section) ? { section: offerta.section } : {}),
    });
  }
  return campione;
}

/**
 * Raggruppa il campione per sezione, nell'ordine di PRIMA COMPARIZIONE della sezione.
 *
 * IL RAGGRUPPAMENTO E' PER UGUAGLIANZA, mai per prefisso: 'Antipasti' e 'Antipasti Freddi'
 * sono due sezioni, e un confronto scritto con startsWith le fonderebbe in una — un errore
 * che il modello non potrebbe vedere e che finirebbe nel copy della pagina.
 *
 * La mappa e' una `Map` e non un oggetto: le sezioni sono testo del brief, cioe' input non
 * fidato, e usarle come chiavi di un oggetto letterale farebbe di '__proto__' un'assegnazione
 * al prototipo invece che una chiave — la voce sparirebbe in silenzio. Una `Map` confronta
 * per valore e non ha prototipo da toccare.
 */
function raggruppaPerSezione(campione: CampionePiatto): CampioneRaggruppato {
  const perSezione = new Map<string | undefined, string[]>();
  for (const voce of campione) {
    const nomi = perSezione.get(voce.section);
    if (nomi === undefined) perSezione.set(voce.section, [voce.name]);
    else nomi.push(voce.name);
  }
  return [...perSezione].map(([section, names]) => ({
    ...(section !== undefined ? { section } : {}),
    names,
  }));
}

/**
 * La sola porzione del brief che raggiunge il modello, secondo l'allowlist nominata di
 * P2-D4. Funzione PURA: non muta il brief e non ne condivide le collezioni — ogni array
 * restituito e' nuovo, quindi un consumatore che lo riordinasse in place non riscriverebbe
 * il brief.
 *
 * `profile` sceglie la forma del CAMPIONE e nient'altro: 'home' lo da' piatto (fase 1),
 * 'inner' raggruppato per sezione (fase 2, dove al modello serve per scrivere l'intro di
 * ciascuna sezione della pagina offerte). L'insieme dei campi e' identico nei due.
 *
 * RICEVE IL BRIEF INTERO: non c'e' barriera di tipo fra cio' che entra e cio' che esce, ed
 * e' il limite dichiarato in testa al modulo. La promessa che nulla fuori allowlist esca da
 * qui e' tenuta da un oracolo (AC-220-1, AC-220-2), non dalla firma.
 */
export function briefProjection(brief: Brief, profile: ProjectionProfile): BriefProjection {
  const base = baseComune(brief);
  const campione = campioneDelleOfferte(brief);
  if (campione.length === 0) return base;
  return profile === 'home'
    ? { ...base, offerings: campione }
    : { ...base, offerings: raggruppaPerSezione(campione) };
}
