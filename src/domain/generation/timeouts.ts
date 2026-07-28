// T-203 (macrotask generation-model, P2) — i tempi della RICONCILIAZIONE (P2-D15).
//
// Dominio PURO: nessun accesso al DB, nessun side effect, nessuna dipendenza da Supabase.
//
// PERCHE' STANNO QUI E NON IN src/data/generations.ts (EMENDAMENTO P2-D22): quel modulo e
// 'use server' e puo esportare SOLO funzioni async, quindi finche questi numeri erano un
// `const` locale nessun test puro poteva leggerli. Conseguenza misurata dal verifier: con
// `phase1: 1 minuto, phase2: 1 minuto` la suite di T-203 restava 14/14 verde, e restava
// verde anche coi due valori SCAMBIATI — le fixture stanno a 24 ore contro 0, quindi
// qualunque soglia fra tre secondi e ventiquattro ore passa. L'invariante era dichiarata a
// parole nel modulo e nulla la imponeva. Da qui e asseribile (AC-203-7).

const MINUTO_MS = 60_000;

/**
 * I tempi della riconciliazione e il tetto a cui vanno confrontati. Tutti in MILLISECONDI.
 *
 * L'INVARIANTE, che e la ragione per cui questi numeri stanno insieme in un solo posto:
 * OGNI timeout deve stare SOPRA `max_request_lifetime`. Un timeout piu corto libererebbe
 * l'indice UNIQUE parziale di site_generations SOTTO una generazione ancora viva,
 * autorizzando un secondo scrittore sulla stessa riga — cioe esattamente cio che
 * quell'indice esiste per rendere impossibile. Un timeout troppo lungo, all'opposto, costa
 * solo attesa: l'asimmetria e il motivo per cui la disuguaglianza ha un verso solo.
 *
 * I valori sono STIME dichiarate, come i numeri di P2-D17: la misura vera arrivera da
 * T-225. Cio che non e una stima e la RELAZIONE fra loro.
 */
export const GENERATION_TIMEOUTS = {
  /**
   * La vita MASSIMA possibile della richiesta che POSSIEDE la riga 'generating': il tetto
   * di esecuzione della piattaforma (oggi al piu ~13 minuti), dentro il quale sta anche il
   * `timeout` del client del modello che nascera in GENERATION_BUDGET (T-223). Finche la
   * richiesta puo essere ancora viva, la sua riga non e abbandonata e non va riconciliata.
   */
  max_request_lifetime: 13 * MINUTO_MS,
  /** I due timeout veri e propri, uno per FASE della generazione (P2-D13). */
  phases: {
    /** La singola chiamata al modello che produce il pool della home (P2-D2/D6). */
    phase1: 15 * MINUTO_MS,
    /**
     * Le pagine interne a chunk dopo la scelta della variante: piu chiamate in fila,
     * quindi il doppio della fase 1.
     */
    phase2: 30 * MINUTO_MS,
  },
} as const;
