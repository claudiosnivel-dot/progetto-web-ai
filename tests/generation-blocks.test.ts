import { describe, it, expect } from 'vitest';
import { BLOCKS, blocksFor, resolveOfferings, slotsForBlocks } from '@/domain/generation/blocks';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { SLOTS, type PageRole } from '@/domain/generation/slots';
import {
  applyBriefUpdate,
  emptyBrief,
  BRIEF_LIMITS,
  BriefUpdateSchema,
  type Brief,
} from '@/domain/onboarding/brief';

// T-210 (macrotask generation-engine, P2) — catalogo dei blocchi, precondizioni sui
// dati, ruoli di pagina, varianti del blocco offerte. Le asserzioni DERIVANO dagli
// acceptance_criteria AC-210-1..6 (docs/blueprint/P2-generation/02-generation-engine.md);
// gli oracoli in fondo sono dichiarati come AGGIUNTIVI e nominano cio' che provano.
// Dominio puro: nessun DB, nessuna rete, nessun mock.

// ── fixture ──────────────────────────────────────────────────────────────────
// Correzione di metodo n.1 di P1 (ripetutasi TRE volte con la suite verde): PIU' DI
// UN ELEMENTO, valori DISCORDANTI, e almeno un id che sia PREFISSO di un altro. Una
// fixture con un solo elemento non prova nulla sull'identita' di quell'elemento.
//
// CINQUE offerte come chiede AC-210-5: nomi tutti diversi, una col prezzo e una
// senza, una con la sezione. E 'Tagliere' e' PREFISSO di 'Tagliere della casa':
// un confronto scritto con startsWith invece che con uguaglianza deve poter essere
// osservato mentre sbaglia (sull'ordine e sull'identita' delle voci).
const CINQUE_OFFERTE = [
  { name: 'Tagliere', price: '12,00' },
  { name: 'Tagliere della casa', description: 'Selezione del giorno', section: 'Antipasti' },
  { name: 'Zuppa di ceci', price: '9,50', section: 'Primi' },
  { name: 'Acqua naturale' },
  { name: 'Caffe', price: '1,20' },
];

const TRE_OFFERTE = CINQUE_OFFERTE.slice(0, 3);

// Due chiavi con valori DISCORDANTI: un orario spezzato e uno continuato.
const ORARI = { 'lun-ven': '9:00-13:00 / 15:00-19:00', sabato: '9:00-13:00' };

const BASE = {
  business_name: 'Osteria del Ponte',
  vertical: 'ristorazione',
  description: 'Osteria di quartiere aperta dal 1998, cucina di stagione.',
  address: 'Via dei Mille 4, Bologna',
  phone: '+39 051 000111',
  whatsapp: '+39 340 0001112',
  email: 'ciao@osteriadelponte.it',
  primary_goal: 'prenota',
  highlights: ['Pasta fatta in casa', 'Cantina naturale', 'Dehors sul canale'],
  offerings: CINQUE_OFFERTE,
};

/**
 * Costruisce la fixture passando dal VALIDATORE vero (applyBriefUpdate): cosi' il
 * brief sotto test e' un brief che il dominio accetta davvero, non un oggetto scritto
 * a mano che gli somiglia. Se una patch venisse SCARTATA il test proverebbe qualcosa
 * di diverso da cio' che dichiara, quindi lo scarto e' rosso qui.
 */
function brief(patch: Record<string, unknown> = {}): Brief {
  const { brief: costruito, rejected } = applyBriefUpdate(emptyBrief('it'), { ...BASE, ...patch });
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return costruito;
}

function idBlocchi(brief_: Brief, ruolo: Parameters<typeof blocksFor>[1]): string[] {
  return blocksFor(brief_, ruolo).map((blocco) => blocco.id);
}

function bloccoDelCatalogo(id: string) {
  const trovato = BLOCKS.find((blocco) => blocco.id === id);
  if (!trovato) throw new Error(`blocco assente dal catalogo: ${id}`);
  return trovato;
}

// I ruoli di pagina sono DERIVATI dal catalogo degli slot (T-201): un ruolo nuovo
// entra da solo nelle iterazioni di questo file invece di essere dimenticato.
const RUOLI = [...new Set(SLOTS.map((slot) => slot.page_role))];

// Il brief PIU' RICCO costruibile: BASE piu' TUTTE le altre sorgenti che il Brief v1
// espone (orari, coordinate, social, tono). E' il punto di partenza dei casi di
// soppressione: da un brief in cui ogni blocco con sorgente esiste si TOGLIE una
// sorgente alla volta, cosi' cio' che sparisce dal risultato e' attribuibile a quella
// sola sorgente e non a un'altra rimasta indietro.
const PATCH_RICCO: Record<string, unknown> = {
  ...BASE,
  hours: ORARI,
  geo: { lat: 44.4949, lng: 11.3426 },
  social_links: ['https://instagram.com/osteriadelponte', 'https://facebook.com/osteria'],
  brand_hints: 'tono caldo, niente superlativi',
};

// UNA sola offerta: e' il CONFINE della soglia del blocco offerte, che le fixture da
// zero, tre e cinque voci non toccano mai.
const UNA_OFFERTA = [{ name: 'Tagliere', price: '12,00' }];

/**
 * Costruisce un brief dalla patch ricca OMETTENDO i campi indicati e sovrascrivendo
 * quelli passati. Si toglie per OMISSIONE, non con la stringa vuota: `business_name`
 * non ammette il vuoto (T-121), quindi una patch con '' verrebbe SCARTATA e il caso
 * proverebbe una cosa diversa da quella che dichiara. Come `brief`, passa dal
 * validatore vero e lo scarto e' rosso qui.
 */
function briefCaso(omessi: readonly string[] = [], override: Record<string, unknown> = {}): Brief {
  const patch: Record<string, unknown> = { ...PATCH_RICCO, ...override };
  for (const campo of omessi) delete patch[campo];
  const { brief: costruito, rejected } = applyBriefUpdate(emptyBrief('it'), patch);
  expect(rejected, `patch scartata: ${rejected.join(',')}`).toEqual([]);
  return costruito;
}

// ── AC-210-1, AC-210-5 — le precondizioni sui dati ───────────────────────────

describe('T-210 blocksFor — un blocco senza dati non esiste', () => {
  // covers: AC-210-1
  it("il blocco orari e' ASSENTE col brief senza hours e PRESENTE con hours valorizzato", () => {
    const senzaOrari = brief();
    const conOrari = applyBriefUpdate(senzaOrari, { hours: ORARI }).brief;

    const idsSenza = idBlocchi(senzaOrari, 'home');
    const idsCon = idBlocchi(conOrari, 'home');

    expect(idsSenza).not.toContain('orari'); // covers: AC-210-1 — assente, non vuoto
    expect(idsCon).toContain('orari'); // covers: AC-210-1

    // I due risultati differiscono ESATTAMENTE per il blocco orari, nell'ordine
    // dichiarato. Che nel primo non ci sia alcun SEGNAPOSTO (una voce che non supera la
    // propria precondizione) NON e' provato qui, ed e' una correzione a cio' che questo
    // commento dichiarava: l'asserzione che lo diceva riusava il predicato che blocksFor
    // aveva appena applicato per filtrare, quindi era vera per costruzione (V-210-09) e
    // sopravviveva a QUALUNQUE mutazione delle precondizioni. Il giudice di quel ramo e'
    // il ciclo tabellare 'ogni precondizione del catalogo decide da sola' piu' sotto, che
    // pinna l'elenco atteso caso per caso.
    expect(idsCon.filter((id) => id !== 'orari')).toEqual(idsSenza); // covers: AC-210-1

    // Il blocco che compare e' quello che porta davvero il dato.
    expect(bloccoDelCatalogo('orari').brief_fields_rendered).toContain('hours'); // covers: AC-210-1
  });

  // covers: AC-210-1
  it("hours presente ma senza alcun orario leggibile non fa esistere il blocco", () => {
    // Il brief ammette una mappa di orari con valori vuoti: un blocco che esistesse
    // su quella base renderebbe righe vuote, cioe' il segnaposto che P2-D7 vieta.
    const vuoti = applyBriefUpdate(brief(), { hours: { 'lun-ven': '', sabato: '  ' } }).brief;
    expect(idBlocchi(vuoti, 'home')).not.toContain('orari'); // covers: AC-210-1
  });

  // covers: AC-210-5
  it('il blocco offerte e assente con offerings vuoto e presente con cinque offerte', () => {
    const senzaOfferte = brief({ offerings: [] });
    const conOfferte = brief();

    expect(senzaOfferte.content.offerings).toHaveLength(0);
    expect(conOfferte.content.offerings).toHaveLength(5);

    for (const ruolo of ['home', 'offerings'] as const) {
      expect(idBlocchi(senzaOfferte, ruolo), ruolo).not.toContain('offerte'); // covers: AC-210-5
      expect(idBlocchi(conOfferte, ruolo), ruolo).toContain('offerte'); // covers: AC-210-5
    }
  });

  // covers: AC-210-5
  it('la risoluzione del blocco offerte elenca tutte e cinque le offerte nell ordine del brief', () => {
    const conOfferte = brief();
    const risolto = resolveOfferings(conOfferte);

    // Uguaglianza ESATTA sui nomi e sull'ordine: 'Tagliere' e' prefisso di 'Tagliere
    // della casa', quindi un confronto per prefisso o un dedup sbagliato si vede.
    expect(risolto.items.map((voce) => voce.name)).toEqual([
      'Tagliere',
      'Tagliere della casa',
      'Zuppa di ceci',
      'Acqua naturale',
      'Caffe',
    ]); // covers: AC-210-5

    // I valori DISCORDANTI arrivano interi: una col prezzo, una senza, una con sezione.
    expect(risolto.items[0]?.price).toBe('12,00'); // covers: AC-210-5
    expect(risolto.items[3]?.price).toBeUndefined(); // covers: AC-210-5
    expect(risolto.items[1]?.section).toBe('Antipasti'); // covers: AC-210-5
  });
});

// ── V-210-01 / V-210-04 — il ruolo di pagina filtra, e l'ordine e' quello dichiarato ──

// La mappa e' LETTERALE, scritta a mano: derivarla da BLOCKS la renderebbe vera per
// costruzione, cioe' sarebbe lo stesso difetto che chiude in forma piu' elegante. La
// CHIAVE e' PageRole (T-201), quindi il record e' TOTALE PER TIPO: un ruolo nuovo la'
// rompe il typecheck qui invece di restare senza giudice. I valori sono nell'ordine di
// DICHIARAZIONE del catalogo, che e' cio' che blocksFor promette di conservare.
// Il brief e' quello RICCO, dove ogni blocco con una sorgente esiste: qui si giudica il
// filtro per RUOLO, non le precondizioni.
const BLOCCHI_PER_RUOLO: Record<PageRole, readonly string[]> = {
  home: ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'],
  offerings: ['offerte'],
  hours: ['orari'],
  contact: ['contatti', 'cta-whatsapp'],
  reviews: [],
  faq: ['faq'],
};

describe('T-210 blocksFor — il ruolo di pagina filtra davvero', () => {
  it('ogni ruolo riceve ESATTAMENTE i suoi blocchi, nell ordine del catalogo', () => {
    const ricco = briefCaso();

    // I ruoli su cui si cicla sono DERIVATI da T-201 (contratto A MONTE): la mappa
    // attesa deve coprirli tutti, altrimenti un ruolo nuovo resterebbe fuori dal ciclo
    // e il suo filtro non avrebbe oracolo.
    expect(new Set(Object.keys(BLOCCHI_PER_RUOLO))).toEqual(new Set(RUOLI));

    for (const ruolo of RUOLI) {
      // Uguaglianza ESATTA, ordine compreso. Prende M02 e M33 (filtro per page_role
      // rimosso, oppure fatto sul letterale 'home' invece che sul parametro: sulla home
      // sono no-op, su 'offerings'/'hours'/'contact'/'faq' no), M30 e M35 (i page_roles
      // di una voce cambiati), M03 e M25 (risultato o catalogo rovesciati: l'ordine su
      // 'home' e su 'contact' e' pinnato qui).
      expect(idBlocchi(ricco, ruolo), ruolo).toEqual(BLOCCHI_PER_RUOLO[ruolo]);
    }
  });

  it('nessun blocco compare in un ruolo che non dichiara, e due ruoli non danno lo stesso elenco', () => {
    const ricco = briefCaso();

    // La PROPRIETA', non un altro caso nominale: vale per ogni ruolo del vocabolario e
    // per ogni blocco superstite. Prende M02 e M33.
    for (const ruolo of RUOLI) {
      for (const blocco of blocksFor(ricco, ruolo)) {
        expect(blocco.page_roles, `${blocco.id}/${ruolo}`).toContain(ruolo);
      }
    }

    // Il lato POSITIVO: un filtro che restringesse tutto a zero renderebbe il ciclo qui
    // sopra vero per VACUITA'. Sulla home i blocchi sono piu' d'uno, e i risultati di
    // due ruoli diversi non coincidono.
    expect(blocksFor(ricco, 'home').length).toBeGreaterThan(1);
    expect(idBlocchi(ricco, 'home')).not.toEqual(idBlocchi(ricco, 'offerings'));
  });
});

// ── V-210-02 / V-210-08 — ogni precondizione del catalogo ha il suo giudice ───

// I blocchi che esistono sulla home col brief RICCO, in ordine di dichiarazione:
// elenco LETTERALE, scritto a mano (recensioni non c'e', non ha sorgente nel Brief v1).
const RICCO_HOME = ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'];

type CasoPrecondizione = {
  readonly nome: string;
  /** I campi TOLTI dalla patch ricca, per omissione (vedi `briefCaso`). */
  readonly omessi?: readonly string[];
  /** I campi SOVRASCRITTI nella patch ricca. */
  readonly override?: Record<string, unknown>;
  /** I blocchi che restano sulla home: elenco LETTERALE, mai derivato dal catalogo. */
  readonly attesi_home: readonly string[];
};

// Ogni caso toglie UNA sorgente e dichiara chi resta. L'atteso e' un ELENCO e non un
// singolo id perche' due sorgenti sono condivise: `whatsapp` regge la CTA e compare fra
// i recapiti dei contatti, e ogni sorgente conta anche come MATERIA per la FAQ — un
// caso che dichiarasse solo "sparisce X" nasconderebbe il resto della conseguenza.
const CASI: readonly CasoPrecondizione[] = [
  // Il ramo POSITIVO di ogni precondizione: tutte le sorgenti al loro posto.
  { nome: 'brief ricco: esiste ogni blocco che ha una sorgente', attesi_home: RICCO_HOME },
  {
    // prende M07 (precondizione di hero sostituita da () => true)
    nome: 'senza business_name: sparisce il solo hero',
    omessi: ['business_name'],
    attesi_home: ['offerte', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // Le altre cinque materie restano, quindi la FAQ non si muove: la sparizione e'
    // attribuibile alla sola sorgente tolta.
    nome: 'senza offerte: sparisce il solo blocco offerte',
    omessi: ['offerings'],
    attesi_home: ['hero', 'chi-siamo', 'orari', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // prende M12 (MIN_OFFERTE 1 -> 2): e' il CONFINE della soglia, che nessuna fixture
    // esercitava (zero, tre e cinque voci stanno tutte lontane dal confine).
    nome: 'una sola offerta: il blocco offerte esiste (confine della soglia)',
    override: { offerings: UNA_OFFERTA },
    attesi_home: RICCO_HOME,
  },
  {
    // prende M11 (precondizione di chi-siamo sostituita da () => true)
    nome: 'senza description e senza highlights: sparisce il solo chi-siamo',
    omessi: ['description', 'highlights'],
    attesi_home: ['hero', 'offerte', 'orari', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // PRESENTI-E-VUOTE: lo schema del brief non trima ne description ne gli highlights
    // (T-121), quindi le due sorgenti esistono come valori di soli spazi. Prende una
    // precondizione scritta con un controllo di sola esistenza invece che con il trim.
    nome: 'description e highlights di soli spazi: chi-siamo non esiste lo stesso',
    override: { description: '   ', highlights: ['  ', ''] },
    attesi_home: ['hero', 'offerte', 'orari', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // prende M34 ('||' -> '&&' su chi-siamo): CIASCUNA delle due sorgenti, DA SOLA,
    // deve bastare — e' quello che il modulo promette.
    nome: 'la sola description basta a chi-siamo',
    omessi: ['highlights'],
    attesi_home: RICCO_HOME,
  },
  {
    // prende M34, dall'altro lato
    nome: 'i soli highlights bastano a chi-siamo',
    omessi: ['description'],
    attesi_home: RICCO_HOME,
  },
  {
    nome: 'senza hours: sparisce il solo blocco orari',
    omessi: ['hours'],
    attesi_home: ['hero', 'offerte', 'chi-siamo', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // prende M09 (contatti sostituito da () => true), M26 (la sola `geo` fa esistere i
    // contatti, contro la spec §7 citata verbatim nel commento del blocco: qui `geo`
    // C'E' e i contatti devono sparire lo stesso) e M10 (la CTA sostituita da () => true,
    // che qui perde il numero insieme agli altri recapiti).
    nome: 'solo geo e nessun recapito: spariscono contatti e CTA WhatsApp',
    omessi: ['address', 'phone', 'whatsapp', 'email'],
    attesi_home: ['hero', 'offerte', 'chi-siamo', 'orari', 'faq'],
  },
  {
    // prende M10, isolato: l'indirizzo e gli altri canali restano, quindi i contatti
    // esistono ancora e a sparire e' la sola CTA.
    nome: 'senza whatsapp: sparisce la sola CTA WhatsApp',
    omessi: ['whatsapp'],
    attesi_home: ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq'],
  },
  {
    // N-01 — `haCanale` compone TRE rami e finora ne era esercitato uno solo: in ogni
    // caso in cui doveva essere vero il `phone` era presente, quindi ridurre il
    // predicato a `testoPresente(brief.phone)` lasciava la suite verde. Qui l'indirizzo
    // e' tolto insieme a phone e whatsapp: e' l'EMAIL, da sola, a dover far esistere i
    // contatti — cioe' il blocco che dichiara address/geo/phone/email/whatsapp/social_links,
    // la superficie di rendering di A05:2025. La CTA sparisce perche' perde il numero.
    nome: 'la sola email fa esistere i contatti (senza indirizzo, telefono, whatsapp)',
    omessi: ['address', 'phone', 'whatsapp'],
    attesi_home: ['hero', 'offerte', 'chi-siamo', 'orari', 'contatti', 'faq'],
  },
  {
    // N-01, il terzo ramo: il solo whatsapp regge sia i contatti sia la CTA.
    nome: 'il solo whatsapp fa esistere contatti e CTA (senza indirizzo, telefono, email)',
    omessi: ['address', 'phone', 'email'],
    attesi_home: RICCO_HOME,
  },
  {
    // N-02 — il confine a TRE materie costruito con le ALTRE tre sorgenti. Il caso a tre
    // materie qui sotto poggia su description + hours + address, quindi rendeva portanti
    // solo quelle: togliere `haCanale`, `highlights` o `offerings` dal conteggio di
    // `materieFaq` lasciava la suite verde, e una sorgente che smette di contare abbassa
    // la soglia di fatto — cioe' decide se il modello riceve faq_title/faq_items, il
    // permesso di scrivere domande e risposte (P2-D7).
    // Le tre materie qui sono highlights + offerings + un canale (whatsapp): tolta
    // QUALUNQUE delle tre dal conteggio si scende a due e la FAQ deve sparire.
    nome: 'tre materie dalle altre tre sorgenti: la FAQ esiste (highlights + offerte + un canale)',
    omessi: ['description', 'hours', 'address', 'phone', 'email'],
    attesi_home: ['hero', 'offerte', 'chi-siamo', 'contatti', 'faq', 'cta-whatsapp'],
  },
  {
    // ESATTAMENTE DUE materie, contate sulle sei sorgenti di `materieFaq`: description
    // (rimasta) e address (rimasto). Fuori: highlights, offerings, hours e ogni canale
    // fra phone/whatsapp/email. Prende M08 (faq sostituita da () => true) e M27
    // (soglia 3 -> 1, che nessuna fixture con 2 materie poteva osservare).
    nome: 'due sole materie: la FAQ non esiste (confine della soglia, dal basso)',
    omessi: ['highlights', 'offerings', 'hours', 'phone', 'whatsapp', 'email'],
    attesi_home: ['hero', 'chi-siamo', 'contatti'],
  },
  {
    // Il caso precedente PIU' gli orari: description + hours + address = TRE materie,
    // il confine dall'alto. Prende una soglia alzata (3 -> 4).
    nome: 'tre materie: la FAQ esiste (confine della soglia, dall alto)',
    omessi: ['highlights', 'offerings', 'phone', 'whatsapp', 'email'],
    attesi_home: ['hero', 'chi-siamo', 'orari', 'contatti', 'faq'],
  },
];

describe('T-210 blocksFor — ogni precondizione del catalogo decide da sola', () => {
  it.each([...CASI])('$nome', (caso) => {
    const briefDelCaso = briefCaso(caso.omessi ?? [], caso.override ?? {});
    // Uguaglianza ESATTA con l'elenco atteso: dice sia cosa sparisce sia cosa RESTA,
    // quindi un indebolimento che facesse esistere un blocco senza dati e' rosso qui
    // anche quando non e' il blocco del caso.
    expect(idBlocchi(briefDelCaso, 'home')).toEqual(caso.attesi_home);
  });

  it('ogni voce del catalogo ha un caso che la fa esistere e uno che la fa sparire', () => {
    // Il ciclo e' SUL CATALOGO, non su un elenco a mano: un nono blocco che nascesse
    // senza i suoi casi renderebbe rosso questo test invece di entrare in produzione
    // senza oracolo, che e' il modo in cui cinque precondizioni su otto sono arrivate
    // fin qui senza giudice (V-210-02).
    const SENZA_SORGENTE_NEL_BRIEF_V1 = ['recensioni'];

    for (const blocco of BLOCKS) {
      const esiste = CASI.some((caso) => caso.attesi_home.includes(blocco.id));
      const sparisce = CASI.some((caso) => !caso.attesi_home.includes(blocco.id));

      if (SENZA_SORGENTE_NEL_BRIEF_V1.includes(blocco.id)) {
        // La sua assenza e' pinnata dagli oracoli aggiuntivi in fondo al file.
        expect(esiste, `${blocco.id} non ha sorgente nel Brief v1: non deve esistere mai`).toBe(
          false,
        );
        continue;
      }
      expect(esiste, `nessun caso fa ESISTERE ${blocco.id}`).toBe(true);
      expect(sparisce, `nessun caso fa SPARIRE ${blocco.id}`).toBe(true);
    }
  });
});

// ── AC-210-2, AC-210-3 — le varianti per vertical ────────────────────────────

describe('T-210 blocco offerte — varianti per vertical', () => {
  // covers: AC-210-2
  it('ristorazione e salone_studio differiscono per etichetta, layout e presenza del prezzo', () => {
    const ristorazione = resolveOfferings(brief({ vertical: 'ristorazione', offerings: TRE_OFFERTE }));
    const salone = resolveOfferings(brief({ vertical: 'salone_studio', offerings: TRE_OFFERTE }));
    const generica = resolveOfferings(brief({ vertical: 'altro', offerings: TRE_OFFERTE }));

    expect(ristorazione.label_key).not.toBe(salone.label_key); // covers: AC-210-2 — etichetta
    expect(ristorazione.show_price).not.toBe(salone.show_price); // covers: AC-210-2 — prezzo
    expect(ristorazione.layout).not.toBe(salone.layout); // covers: AC-210-2 — layout

    // NESSUNA delle due e' la variante generica: differiscono da essa sia per
    // etichetta sia per layout (il confronto e' per uguaglianza, mai per prefisso).
    expect(ristorazione.label_key).not.toBe(generica.label_key); // covers: AC-210-2
    expect(salone.label_key).not.toBe(generica.label_key); // covers: AC-210-2
    expect(ristorazione.layout).not.toBe(generica.layout); // covers: AC-210-2
    expect(salone.layout).not.toBe(generica.layout); // covers: AC-210-2

    // I due brief sono identici TRANNE vertical: le tre offerte sono le stesse.
    expect(ristorazione.items.map((v) => v.name)).toEqual(salone.items.map((v) => v.name)); // covers: AC-210-2
  });

  // covers: AC-210-3
  it("vertical='altro' ottiene la variante GENERICA, e nessun verticale vero la ottiene", () => {
    const generica = resolveOfferings(brief({ vertical: 'altro', offerings: TRE_OFFERTE }));

    // 'altro' e' l'ASSENZA di scelta (emptyBrief lo porta comunque), quindi la sua
    // variante e' quella neutra: etichetta e layout sono pinnati per identita'.
    expect(generica.label_key).toBe('site.offerings.generic'); // covers: AC-210-3
    expect(generica.layout).toBe('simple-list'); // covers: AC-210-3
    expect(resolveOfferings(emptyBrief('it')).label_key).toBe(generica.label_key); // covers: AC-210-3

    // L'elenco dei verticali e' DERIVATO dallo schema del brief (T-121): un vertical
    // nuovo entra da solo in questo controllo invece di restare non provato.
    const verticali = BriefUpdateSchema.shape.vertical.unwrap().options;
    for (const vertical of verticali) {
      if (vertical === 'altro') continue;
      const variante = resolveOfferings(brief({ vertical, offerings: TRE_OFFERTE }));
      expect(variante.label_key, vertical).not.toBe(generica.label_key); // covers: AC-210-3
    }
  });

  // ── V-210-06 ──
  // La mappa e' LETTERALE, scritta a mano: OFFERINGS_VARIANTS non e' nemmeno esportato,
  // e derivarla lo stesso la renderebbe vera per costruzione. La CHIAVE e'
  // Brief['vertical'], quindi il record e' TOTALE PER TIPO come quello del modulo: un
  // vertical nuovo in T-121 rompe il typecheck anche qui, non solo la'.
  const VARIANTI_ATTESE: Record<
    Brief['vertical'],
    { readonly label_key: string; readonly layout: string; readonly show_price: boolean }
  > = {
    ristorazione: { label_key: 'site.offerings.menu', layout: 'menu-sections', show_price: true },
    fitness: { label_key: 'site.offerings.courses', layout: 'course-grid', show_price: true },
    salone_studio: {
      label_key: 'site.offerings.services',
      layout: 'service-list',
      show_price: false,
    },
    negozio_artigiano: {
      label_key: 'site.offerings.catalog',
      layout: 'catalog-grid',
      show_price: true,
    },
    altro: { label_key: 'site.offerings.generic', layout: 'simple-list', show_price: true },
  };

  it('ogni vertical ottiene la propria variante, col VALORE atteso e non solo una differenza', () => {
    // L'elenco dei verticali e' DERIVATO da T-121 (contratto A MONTE, unica derivazione
    // ammessa). Il confronto fra i due insiemi di chiavi e' cio' che rende ROSSO questo
    // test quando un vertical nuovo entra nello schema senza la sua variante: il ciclo
    // per DIFFERENZA lo superava per VACUITA', perche' OFFERINGS_VARIANTS[vertical]
    // undefined produce label_key undefined e undefined non e' la generica. Prende M36.
    const verticali = BriefUpdateSchema.shape.vertical.unwrap().options;
    expect(new Set(verticali)).toEqual(new Set(Object.keys(VARIANTI_ATTESE)));

    for (const vertical of verticali) {
      const atteso = VARIANTI_ATTESE[vertical];
      const variante = resolveOfferings(brief({ vertical, offerings: TRE_OFFERTE }));

      // Il VALORE, non la differenza: prende M36 (label_key/layout undefined) e M17
      // (fitness reso identico a ristorazione).
      expect(variante.label_key, vertical).toBe(atteso.label_key);
      expect(variante.layout, vertical).toBe(atteso.layout);
      // show_price DEFINITO e booleano: con la variante mancante sarebbe undefined, e
      // un rendering che lo legge come falsy nasconderebbe i prezzi in silenzio (M36).
      expect(typeof variante.show_price, vertical).toBe('boolean');
      // Il prezzo e' una DECISIONE DI PRODOTTO argomentata nel modulo (il listino di un
      // salone non si mostra, il menu si): merita un giudice. Prende M18
      // (negozio_artigiano da true a false).
      expect(variante.show_price, vertical).toBe(atteso.show_price);
    }

    // INIETTIVITA' su tutti i verticali: due settori diversi non condividono ne
    // etichetta ne layout — avere CINQUE ricette invece di venticinque (P2-D1) sta
    // tutto qui. Prende M17, che il confronto a due (ristorazione vs salone) non vede.
    const etichette = verticali.map(
      (v) => resolveOfferings(brief({ vertical: v, offerings: TRE_OFFERTE })).label_key,
    );
    const layout = verticali.map(
      (v) => resolveOfferings(brief({ vertical: v, offerings: TRE_OFFERTE })).layout,
    );
    expect(new Set(etichette).size, etichette.join(',')).toBe(verticali.length);
    expect(new Set(layout).size, layout.join(',')).toBe(verticali.length);
  });
});

// ── AC-210-4 — unione esatta degli slot ──────────────────────────────────────

describe('T-210 slotsForBlocks — unione esatta, senza duplicati e senza estranei', () => {
  // covers: AC-210-4
  it('tre blocchi con cinque slot distinti, uno condiviso da due, danno esattamente i cinque', () => {
    // I tre blocchi sono voci VERE del catalogo con gli slot ridichiarati, cosi' la
    // fixture resta della forma che la funzione riceve in produzione.
    // 'hero_title' e' PREFISSO di 'hero_title_kicker' (deliberato in T-201): un dedup
    // scritto con startsWith/includes invece che con uguaglianza qui perde uno slot.
    const tre = [
      { ...bloccoDelCatalogo('hero'), slots: ['hero_title', 'hero_title_kicker'] as const },
      { ...bloccoDelCatalogo('chi-siamo'), slots: ['hero_title_kicker', 'about_title'] as const },
      { ...bloccoDelCatalogo('offerte'), slots: ['about_body', 'offerings_title'] as const },
    ];

    const unione = slotsForBlocks(tre);

    expect([...unione]).toEqual([
      'hero_title',
      'hero_title_kicker',
      'about_title',
      'about_body',
      'offerings_title',
    ]); // covers: AC-210-4 — esattamente i cinque, in ordine dichiarato
    expect(unione).toHaveLength(5); // covers: AC-210-4 — nessun duplicato
    expect(new Set(unione).size).toBe(5); // covers: AC-210-4

    // Nessuno slot estraneo: ogni slot del risultato e' dichiarato da uno dei tre.
    const dichiarati = new Set<string>(tre.flatMap((blocco) => [...blocco.slots]));
    for (const slot of unione) expect(dichiarati.has(slot), slot).toBe(true); // covers: AC-210-4
    expect(unione).not.toContain('hero_subtitle'); // covers: AC-210-4 — slot del blocco hero NON dichiarato qui
  });

  // covers: AC-210-4
  it('sul catalogo intero non produce duplicati ne slot fuori dal catalogo di T-201', () => {
    const unione = slotsForBlocks(BLOCKS);
    const idSlot = new Set<string>(SLOTS.map((slot) => slot.id));
    expect(new Set(unione).size).toBe(unione.length); // covers: AC-210-4
    for (const slot of unione) expect(idSlot.has(slot), slot).toBe(true); // covers: AC-210-4
  });

  // ── V-210-07 ──
  it('ogni slot appartiene a UN blocco solo, e i blocchi coprono esattamente il catalogo T-201', () => {
    const unione = slotsForBlocks(BLOCKS);
    const dichiarati = BLOCKS.flatMap((blocco) => [...blocco.slots]);

    // (a) PARTIZIONE: il commento del catalogo promette "ogni slot appartiene a UN
    // blocco solo" e nessuno lo giudicava — il dedup di slotsForBlocks assorbe la
    // duplicazione in silenzio, e la stessa prosa comparirebbe due volte nella stessa
    // pagina (nella one-pager, sempre). Prende M20 (faq che dichiara anche about_title).
    expect(unione.length, dichiarati.join(',')).toBe(dichiarati.length);

    // (b) COPERTURA ESATTA, nel verso opposto: uno slot di T-201 che nessun blocco
    // dichiara non verrebbe mai chiesto al modello (T-220) e quel contenuto sparirebbe
    // in silenzio. L'insieme atteso e' DERIVATO da T-201, il contratto A MONTE: e'
    // proprio cio' che deve far diventare rosso questo test quando la' nasce uno slot
    // nuovo. Prende M19 (hero che perde hero_subtitle).
    expect(new Set(unione)).toEqual(new Set(SLOTS.map((slot) => slot.id)));
  });
});

// ── AC-210-6 — integrita' del catalogo ───────────────────────────────────────

describe('T-210 catalogo BLOCKS — ogni voce e completa', () => {
  // covers: AC-210-6
  it('ogni voce ha page_roles non vuoto, slots esistenti in T-201 e una precondition funzione', () => {
    // Un catalogo vuoto renderebbe VACUAMENTE vere tutte le asserzioni del ciclo.
    expect(BLOCKS.length).toBeGreaterThan(0); // covers: AC-210-6

    const idSlot = new Set<string>(SLOTS.map((slot) => slot.id));
    const ruoli = new Set<string>(RUOLI);

    for (const blocco of BLOCKS) {
      expect(blocco.page_roles.length, blocco.id).toBeGreaterThan(0); // covers: AC-210-6
      for (const ruolo of blocco.page_roles) {
        expect(ruoli.has(ruolo), `${blocco.id}/${ruolo}`).toBe(true); // covers: AC-210-6
      }
      // Appartenenza per UGUAGLIANZA (Set.has), mai per prefisso: con startsWith uno
      // slot inventato 'hero_' passerebbe perche' e' prefisso di 'hero_title'.
      for (const slot of blocco.slots) {
        expect(idSlot.has(slot), `${blocco.id}/${slot}`).toBe(true); // covers: AC-210-6
      }
      expect(typeof blocco.precondition, blocco.id).toBe('function'); // covers: AC-210-6
    }
  });

  // ── V-210-03 / V-210-05 / V-210-10 ──
  // La mappa e' LETTERALE, scritta a mano: id -> ruoli di pagina e campi del brief resi
  // DIRETTAMENTE. Derivarla da BLOCKS la renderebbe vera per costruzione. Il confronto
  // e' per UGUAGLIANZA ESATTA perche' l'oracolo AGGREGATO (piu' sotto: "il campo e'
  // dichiarato da QUALCUNO") non vede ne il campo TOLTO a un blocco che continua a
  // renderlo, ne il campo dichiarato IN PIU' da un blocco che non lo rende — e
  // `brief_fields_rendered` e' il contratto di sicurezza A05:2025, l'elenco su cui
  // T-231/T-237 decideranno cosa sanificare.
  // Gli SLOT sono nella mappa per la stessa ragione degli altri due campi, e per una
  // misurata a parte: l'ASSEGNAZIONE slot -> blocco non era giudicata da nulla. Il test
  // di partizione piu' sopra confronta il CONTEGGIO e l'INSIEME dell'unione, e SPOSTARE
  // uno slot da un blocco a un altro conserva entrambi. Misurato: portando
  // 'hero_subtitle' dal blocco hero al blocco faq la suite restava 37/37 VERDE, e la
  // conseguenza sarebbe silenziosa — con un brief sotto la soglia della FAQ quel blocco
  // non esiste, quindi lo slot non verrebbe mai chiesto al modello (T-220) e il
  // sottotitolo della home sparirebbe senza errore da nessuna parte.
  const CATALOGO_ATTESO: Record<
    string,
    {
      readonly page_roles: readonly PageRole[];
      readonly slots: readonly string[];
      readonly brief_fields_rendered: readonly string[];
    }
  > = {
    hero: {
      page_roles: ['home'],
      slots: ['hero_title_kicker', 'hero_title', 'hero_subtitle'],
      brief_fields_rendered: ['business_name'],
    },
    offerte: {
      page_roles: ['offerings', 'home'],
      slots: ['offerings_title', 'offerings_intro'],
      brief_fields_rendered: ['offerings'],
    },
    'chi-siamo': {
      page_roles: ['home'],
      slots: ['about_title', 'about_body', 'about_points'],
      brief_fields_rendered: [],
    },
    orari: {
      page_roles: ['hours', 'home'],
      slots: ['hours_title', 'hours_intro'],
      brief_fields_rendered: ['hours'],
    },
    contatti: {
      page_roles: ['contact', 'home'],
      slots: ['contact_title', 'contact_intro'],
      brief_fields_rendered: ['address', 'geo', 'phone', 'email', 'whatsapp', 'social_links'],
    },
    recensioni: {
      page_roles: ['reviews', 'home'],
      slots: ['reviews_title', 'reviews_intro'],
      brief_fields_rendered: [],
    },
    faq: {
      page_roles: ['faq', 'home'],
      slots: ['faq_title', 'faq_items'],
      brief_fields_rendered: [],
    },
    'cta-whatsapp': {
      page_roles: ['home', 'contact'],
      slots: ['whatsapp_cta_title'],
      brief_fields_rendered: ['whatsapp'],
    },
  };

  it('ogni voce dichiara ESATTAMENTE i ruoli e i campi del brief che le competono', () => {
    // L'ordine di DICHIARAZIONE del catalogo, letterale: e' l'ordine che blocksFor
    // conserva, ed e' il riferimento degli elenchi attesi degli altri cicli (V-210-04).
    expect(BLOCKS.map((blocco) => blocco.id)).toEqual([
      'hero',
      'offerte',
      'chi-siamo',
      'orari',
      'contatti',
      'recensioni',
      'faq',
      'cta-whatsapp',
    ]);
    // Un blocco NUOVO senza la sua riga qui rende rosso questo test invece di nascere
    // con i propri ruoli e i propri campi resi non giudicati.
    expect(new Set(Object.keys(CATALOGO_ATTESO))).toEqual(new Set(BLOCKS.map((b) => b.id)));

    for (const blocco of BLOCKS) {
      const atteso: (typeof CATALOGO_ATTESO)[string] | undefined = CATALOGO_ATTESO[blocco.id];
      expect(atteso, `voce del catalogo senza attesa dichiarata: ${blocco.id}`).toBeDefined();
      if (!atteso) continue;

      // prende M30 (hero da ['home'] a ['contact']) e M35 (cta-whatsapp che perde 'contact')
      expect(blocco.page_roles, blocco.id).toEqual(atteso.page_roles);
      // L'ASSEGNAZIONE degli slot, che il test di partizione non puo' vedere: prende lo
      // SPOSTAMENTO di uno slot fra due blocchi (conteggio e insieme invariati) e il
      // riordino degli slot dentro un blocco, che decide l'ordine in cui T-220 li
      // presenta al modello. COSTO DICHIARATO: riordinare gli slot di un blocco rende
      // rosso questo test: e' lo stesso prezzo gia' pagato per i ruoli e per i campi
      // resi, e chi riordina aggiorna la riga sotto gli occhi della revisione.
      expect(blocco.slots, blocco.id).toEqual(atteso.slots);
      // prende M14 (hero che perde 'business_name' pur continuando a renderlo), M15
      // (contatti che perde 'geo'), M31 (contatti che perde 'whatsapp') e M28 (hero che
      // dichiara 'description' senza renderla: la SOVRA-dichiarazione, che il conteggio
      // delle occorrenze >= 2 non vede).
      expect(blocco.brief_fields_rendered, blocco.id).toEqual(atteso.brief_fields_rendered);
      // L'invariante che il commento del modulo dichiara e nessuno asseriva: OGNI voce
      // porta il ruolo 'home', perche' sotto la soglia di T-213 il sito resta una
      // one-pager e le sezioni tornano tutte nella home (AC-213-3).
      expect(blocco.page_roles, blocco.id).toContain('home');
      // I NOMI dei campi sono DERIVATI dallo schema del brief (T-121, contratto A
      // MONTE): un campo che il brief non ha non e' nominabile, e questa riga diventa
      // rossa il giorno in cui lo schema perde un campo che un blocco rende.
      for (const campo of blocco.brief_fields_rendered) {
        expect(Object.hasOwn(BriefUpdateSchema.shape, campo), `${blocco.id}/${campo}`).toBe(true);
      }
    }
  });
});

// ── oracoli AGGIUNTIVI dichiarati (non derivano da un AC) ────────────────────

describe('T-210 oracoli aggiuntivi — partizione dei campi pesanti', () => {
  // NON e' un AC: e' una precondizione MISURATA ed EREDITATA da T-202/T-214
  // (2026-07-28). Se lo STESSO campo del brief e' reso da PIU' BLOCCHI, il caso
  // peggiore in italiano/spagnolo accentato misura 11.813.858 byte e il documento
  // viene RIFIUTATO dal tetto di DOCUMENT_LIMITS.max_bytes; partizionato ne misura
  // 6.397.198 e passa col 31% di margine. Il vincolo e' GLOBALE e non per page_role,
  // perche' nella one-pager (AC-213-3) tutti i blocchi tornano sulla home.
  const CAMPI_PESANTI = ['offerings', 'description', 'hours', 'highlights'] as const;

  // Il caso peggiore PARTIZIONATO misurato da AC-202-7, e il margine che resta.
  const PESO_PARTIZIONATO = 6_397_198;
  const MARGINE = DOCUMENT_LIMITS.max_bytes - PESO_PARTIZIONATO;
  // Le lettere accentate di italiano e spagnolo pesano due byte in UTF-8: il fattore
  // misurato in T-202 e' 1,905 e qui si usa 2, che e' il limite superiore.
  const BYTE_PER_CODE_UNIT = 2;

  // Le sole ripetizioni ammesse, coi loro tetti in CODE UNIT (P1-D17): campi piccoli
  // e scalari. Ogni voce e' una scelta dichiarata, non una svista tollerata.
  const RIPETIZIONI_DICHIARATE: Record<string, number> = { whatsapp: BRIEF_LIMITS.whatsapp };

  function quantiBlocchiRendono(campo: string): number {
    return BLOCKS.filter((blocco) => (blocco.brief_fields_rendered as readonly string[]).includes(campo))
      .length;
  }

  it('nessun campo PESANTE del brief e reso da due blocchi diversi', () => {
    for (const campo of CAMPI_PESANTI) {
      expect(quantiBlocchiRendono(campo), `campo pesante reso piu volte: ${campo}`).toBeLessThanOrEqual(1);
    }
  });

  it('le uniche ripetizioni sono campi piccoli dichiarati, e il loro costo sta nel margine', () => {
    const tutti = new Set<string>(BLOCKS.flatMap((blocco) => [...blocco.brief_fields_rendered]));
    let costoByte = 0;

    for (const campo of tutti) {
      const volte = quantiBlocchiRendono(campo);
      if (volte <= 1) continue;
      const tetto = RIPETIZIONI_DICHIARATE[campo];
      expect(tetto, `ripetizione non dichiarata: ${campo}`).toBeDefined();
      // Caso peggiore: il campo ripetuto al proprio tetto, su ogni pagina del documento.
      costoByte += (volte - 1) * (tetto ?? 0) * BYTE_PER_CODE_UNIT * DOCUMENT_LIMITS.max_pages;
    }

    expect(costoByte).toBeLessThan(MARGINE);
  });

  it('ogni campo tenuto FUORI dalla proiezione e reso da almeno un blocco', () => {
    // L'altra meta' del contratto di A05:2025, e il suo complemento esatto: la
    // partizione vieta che un campo pesante sia dichiarato DUE volte, questo vieta che
    // un campo che il sito deve rendere non sia dichiarato NESSUNA volta. La spec di
    // design §8 tiene fuori dalla proiezione verso il modello i contatti, gli orari,
    // l'indirizzo, i social e le offerte: sono i campi che il SITO rende tali e quali
    // (P2-D4). Se nessun blocco li dichiara, quel dato non arriva ne dal modello ne dal
    // sito — sparisce dal risultato, e la superficie di rendering torna implicita.
    const FUORI_DALLA_PROIEZIONE = [
      'offerings',
      'hours',
      'address',
      'phone',
      'whatsapp',
      'email',
      'social_links',
    ] as const;

    const dichiarati = new Set<string>(BLOCKS.flatMap((blocco) => [...blocco.brief_fields_rendered]));
    for (const campo of FUORI_DALLA_PROIEZIONE) {
      expect(dichiarati.has(campo), `campo reso dal sito ma non dichiarato: ${campo}`).toBe(true);
    }
  });
});

describe('T-210 oracoli aggiuntivi — il blocco recensioni non ha sorgente nel Brief v1', () => {
  // NON e' un AC: e' il PIN della decisione presa in T-210. Il blocco recensioni ha i
  // suoi slot in T-201 e la spec di design §7 lo elenca, ma il Brief v1 non ha alcun
  // campo che porti recensioni. La precondizione dice la verita' su quell'assenza; il
  // giorno in cui una sorgente esistera', questi due test diventano rossi e la
  // decisione torna sul tavolo invece di restare implicita.
  function briefPiuRiccoPossibile(): Brief {
    return applyBriefUpdate(brief(), {
      hours: ORARI,
      geo: { lat: 44.4949, lng: 11.3426 },
      social_links: ['https://instagram.com/osteriadelponte', 'https://facebook.com/osteria'],
      brand_hints: 'tono caldo, niente superlativi',
    }).brief;
  }

  it('non compare per nessun ruolo di pagina, nemmeno col brief piu ricco costruibile', () => {
    const ricco = briefPiuRiccoPossibile();
    for (const ruolo of RUOLI) {
      expect(idBlocchi(ricco, ruolo), ruolo).not.toContain('recensioni');
    }
    // E' comunque nel catalogo, coi suoi slot: la sezione non e' stata cancellata,
    // e' dichiarata senza sorgente (cosi' T-220 non riceve i suoi slot, P2-D7).
    expect(bloccoDelCatalogo('recensioni').slots).toEqual(['reviews_title', 'reviews_intro']);
    expect(bloccoDelCatalogo('recensioni').brief_fields_rendered).toEqual([]);
  });

  it('il Brief v1 non espone alcun campo che possa portare recensioni', () => {
    const campi = Object.keys(BriefUpdateSchema.shape);
    const sorgenti = campi.filter((campo) => /recens|review|testimon|rating|voto|stelle/i.test(campo));
    expect(sorgenti, `sorgente di recensioni comparsa nel brief: ${sorgenti.join(',')}`).toEqual([]);
  });
});

describe('T-210 oracoli aggiuntivi — il giunto fra la voce offerte e resolveOfferings', () => {
  // NON e' un AC e non e' un difetto di comportamento (V-210-11): il legame fra la voce
  // 'offerte' del catalogo e la funzione che ne risolve la variante e' oggi una STRINGA
  // MAGICA che il consumatore (T-212/T-214) deve conoscere, perche' la BlockDefinition
  // non porta la variante. Qui il giunto e' DICHIARATO invece che lasciato implicito:
  // se si rompe, si rompe in questo file e non a valle.
  it("la voce 'offerte' e' quella che resolveOfferings serve, e le due esistenze coincidono", () => {
    const offerte = bloccoDelCatalogo('offerte');
    expect(offerte.slots).toEqual(['offerings_title', 'offerings_intro']);
    expect(offerte.brief_fields_rendered).toEqual(['offerings']);

    // Il blocco ESISTE esattamente quando la risoluzione ha voci da mostrare. Se le due
    // decisioni divergessero, T-214 costruirebbe una sezione vuota (il segnaposto che
    // P2-D7 vieta) oppure butterebbe voci che l'utente ha scritto. Prende M12
    // (MIN_OFFERTE 1 -> 2: con UNA offerta il blocco sparirebbe mentre la risoluzione
    // avrebbe ancora la sua voce).
    const casi = [briefCaso(), briefCaso(['offerings']), briefCaso([], { offerings: UNA_OFFERTA })];
    for (const b of casi) {
      const esiste = idBlocchi(b, 'offerings').includes('offerte');
      const voci = resolveOfferings(b).items.length;
      expect(voci > 0, `blocco=${esiste} voci=${voci}`).toBe(esiste);
    }

    // Le voci sono QUELLE DEL BRIEF, non una copia ripulita: `photo_ref` viaggia ancora
    // qui e toglierlo e' di T-214/T-202 (P2-D12), dove il TIPO del documento non ha un
    // campo in cui possa stare. Una sanificazione anticipata qui darebbe l'illusione che
    // la difesa viva in questo modulo.
    const conFoto = briefCaso([], {
      offerings: [{ name: 'Tagliere', photo_ref: 'https://esempio.test/tagliere.jpg' }],
    });
    expect(resolveOfferings(conFoto).items[0]?.photo_ref).toBe(
      'https://esempio.test/tagliere.jpg',
    );
  });
});
