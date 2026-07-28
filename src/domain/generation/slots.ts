// T-201 (macrotask generation-model, P2) — vocabolario degli SLOT di contenuto.
// Dominio PURO: nessun accesso al DB, nessun side effect, nessuna dipendenza dallo
// schema zod (i tetti vivono in pool.ts).
//
// E' un CONTRATTO, non un abbozzo: questo catalogo e' la sola sede in cui esistono
// gli identificatori di contenuto, e lo consumeranno i blocchi (T-210), le pagine
// (T-213) e la `description` del tool strict (T-222). Cambiare un id qui significa
// cambiarlo ovunque, ed e' voluto.
//
// COSA E' UNO SLOT: un pezzo di PROSA che il modello scrive. Non e' un dato del
// brief (P2-D4: le offerte, i contatti, gli orari e l'indirizzo NON passano dal
// modello, il sito li rende tali e quali), non e' un'etichetta (P2-D10: le etichette
// vengono dai cataloghi i18n) e non e' una leva strutturale (P2-D4, "nessuna leva in
// uscita": nessun URL, href, src, HTML, nome di blocco, nome di tema, colore).
//
// DA DOVE VIENE: ogni slot e' riconducibile a uno dei BLOCCHI nominati nella spec di
// design §7 — hero, offerte, chi-siamo, orari, contatti/mappa, recensioni, FAQ, CTA
// WhatsApp — e a uno dei RUOLI DI PAGINA che il set derivato di P2-D13 puo'
// produrre. Niente slot speculativi "per dopo": il catalogo e' minimo e giustificato.
//
// COSA NON C'E' QUI, deliberatamente:
// - la PRECONDIZIONE sui campi del brief. La tabella §5 della spec la collocava qui,
//   ma il blueprint la assegna ai BLOCCHI (T-210) e la definition_of_done di T-201
//   elenca per ogni slot solo id, page_role, kind e descrizione. Vale la DoD.
// - i TETTI di lunghezza: stanno in POOL_LIMITS (pool.ts), che e' anche il solo
//   posto in cui sono applicati.

/** I tre modi in cui un contenuto puo' presentarsi. Il kind determina lo schema del valore (pool.ts). */
type SlotKind = 'text' | 'list' | 'qa';

/**
 * I ruoli di pagina del set derivato (P2-D13). La home esiste sempre; le altre
 * esistono solo se i dati del brief le giustificano — quella decisione e' di T-213.
 * Il RUOLO non e' lo SLUG: la mappa slug->ruolo nasce in T-213, quindi qui e nel
 * parse del pool il ruolo e' pura annotazione e non viene confrontato con la pagina
 * in cui lo slot compare (in una one-pager la home porta anche gli slot dei ruoli
 * interni).
 *
 * ESPORTATO per il documento (T-202): il `role` di una pagina del SiteDocument usa
 * QUESTO vocabolario invece di riscriverne una copia. Due elenchi di ruoli scritti in
 * due moduli diversi sono esattamente il difetto contro cui mette in guardia il
 * commento in testa a questo file — divergerebbero in silenzio.
 */
export type PageRole = 'home' | 'offerings' | 'hours' | 'contact' | 'reviews' | 'faq';

type SlotDefinition = {
  /** Identificatore stabile: e' la chiave nel pool, nel documento e nello schema del tool. */
  readonly id: string;
  /** Il ruolo di pagina a cui il contenuto appartiene. */
  readonly page_role: PageRole;
  readonly kind: SlotKind;
  /**
   * Cosa il modello deve scrivere in questo slot, in prosa e senza numeri: e' il
   * testo destinato alla `description` del tool strict (T-222), che i tetti li
   * derivera' da POOL_LIMITS invece di riscriverli qui.
   */
  readonly description: string;
};

export const SLOTS = [
  // --- blocco hero ---------------------------------------------------------
  // L'occhiello e' un elemento del blocco hero (la riga breve sopra il titolo) e il
  // suo id lo dichiara come qualificatore del titolo. E' anche la coppia di
  // identificatori in cui uno e' PREFISSO dell'altro che la spec §9 chiede di avere
  // nel catalogo: un confronto scritto con startsWith invece che con uguaglianza
  // deve poter essere osservato mentre sbaglia.
  {
    id: 'hero_title_kicker',
    page_role: 'home',
    kind: 'text',
    description:
      "Occhiello sopra il titolo della home: che cosa e' l'attivita e dove si trova, in poche parole.",
  },
  {
    id: 'hero_title',
    page_role: 'home',
    kind: 'text',
    description: 'Titolo principale della home: la promessa dell attivita in una riga sola.',
  },
  {
    id: 'hero_subtitle',
    page_role: 'home',
    kind: 'text',
    description:
      'Sottotitolo della home: una o due frasi che spiegano il titolo e danno un motivo per restare.',
  },
  // --- blocco chi-siamo ----------------------------------------------------
  {
    id: 'about_title',
    page_role: 'home',
    kind: 'text',
    description: 'Titolo della sezione che racconta chi e l attivita.',
  },
  {
    id: 'about_body',
    page_role: 'home',
    kind: 'text',
    description:
      'Il racconto dell attivita: storia, persone, modo di lavorare. Solo cio che il brief dichiara, mai dettagli inventati.',
  },
  {
    id: 'about_points',
    page_role: 'home',
    kind: 'list',
    description:
      'I punti di forza dell attivita, uno per voce, ciascuno una frase breve e diversa dalle altre.',
  },
  // --- blocco CTA WhatsApp -------------------------------------------------
  // Solo la riga di invito: l'etichetta del bottone nasce da primary_goal nei
  // cataloghi i18n (P2-D10) e il numero e un dato del brief, quindi non passano di qui.
  {
    id: 'whatsapp_cta_title',
    page_role: 'home',
    kind: 'text',
    description: 'Riga di invito a scrivere su WhatsApp: cosa ottiene chi scrive, senza numeri.',
  },
  // --- blocco offerte ------------------------------------------------------
  // Le voci dell'offerta NON passano dal modello (P2-D4): qui c'e' solo la cornice.
  {
    id: 'offerings_title',
    page_role: 'offerings',
    kind: 'text',
    description: 'Titolo della sezione con il menu, i servizi o il catalogo dell attivita.',
  },
  {
    id: 'offerings_intro',
    page_role: 'offerings',
    kind: 'text',
    description:
      'Introduzione alla sezione delle offerte: come e composta e cosa la caratterizza, senza elencare le singole voci.',
  },
  // --- blocco orari --------------------------------------------------------
  {
    id: 'hours_title',
    page_role: 'hours',
    kind: 'text',
    description: 'Titolo della sezione degli orari di apertura.',
  },
  {
    id: 'hours_intro',
    page_role: 'hours',
    kind: 'text',
    description:
      'Nota che accompagna gli orari (per esempio la stagionalita o il momento migliore per passare). Gli orari veri sono un dato del brief e non si riscrivono qui.',
  },
  // --- blocco contatti/mappa ----------------------------------------------
  {
    id: 'contact_title',
    page_role: 'contact',
    kind: 'text',
    description: 'Titolo della sezione dei contatti.',
  },
  {
    id: 'contact_intro',
    page_role: 'contact',
    kind: 'text',
    description:
      'Invito a mettersi in contatto: quale canale conviene e cosa aspettarsi. Nessun recapito, nessun indirizzo: sono dati del brief.',
  },
  // --- blocco recensioni ---------------------------------------------------
  {
    id: 'reviews_title',
    page_role: 'reviews',
    kind: 'text',
    description: 'Titolo della sezione con le testimonianze dei clienti.',
  },
  {
    id: 'reviews_intro',
    page_role: 'reviews',
    kind: 'text',
    description:
      'Introduzione alle testimonianze. Non inventare recensioni ne citazioni: le voci arrivano dai dati.',
  },
  // --- blocco FAQ ----------------------------------------------------------
  {
    id: 'faq_title',
    page_role: 'faq',
    kind: 'text',
    description: 'Titolo della sezione delle domande frequenti.',
  },
  {
    id: 'faq_items',
    page_role: 'faq',
    kind: 'qa',
    description:
      'Le domande frequenti, come coppie domanda/risposta. Una domanda per ogni dubbio che il brief permette davvero di sciogliere, mai una risposta inventata.',
  },
] as const satisfies readonly SlotDefinition[];

/** L'unione degli id del catalogo: e' il vocabolario chiuso delle chiavi del pool. */
export type SlotId = (typeof SLOTS)[number]['id'];
