'use server';

import { z } from 'zod';
import { loadOwnBrief, loadOwnGeneration } from '@/data/generation-action-reads';
import { writePool } from '@/data/generations';
import { runGenerationPhase1 } from '@/data/generation-phase1';

// T-232 (macrotask generation-ui, P2) — RIGENERA IL TESTO DI UNA VARIANTE (P2-D3,
// copia-su-scrittura). UNA sola chiamata al confine — `runGenerationPhase1` (dominio) esegue
// esattamente un turno del confine unico (T-224) — e UNA scrittura: `writePool` con
// scope='home' e `variant_index = i`. Le altre quattro varianti non sono toccate e continuano
// a rendere dal pool condiviso (poolForVariant, T-232): e' cio' che rende AC-232-3 verificabile
// contando le chiamate al modello, non l'effetto visivo.
//
// Vive in src/data/ e raggiunge il confine ATTRAVERSO l'orchestrazione `runGenerationPhase1`
// (co-locata in src/data, T-AH5), mai importando `@/data/anthropic` direttamente — la stessa forma con
// cui la rotta di fase 1 (T-230) tiene il segreto Anthropic dietro il confine server-only. Il
// client con SESSIONE (RLS attiva) e' quello di `getBrief`/`writePool`; nessuna service_role
// (R7), e l'account non arriva mai dal client (writePool lo deriva dalla riga, decisione (e) di
// T-204).
//
// LA DOPPIA RIGENERAZIONE E' IRRAPPRESENTABILE PER SCHEMA, NON SORVEGLIATA (AC-232-5,
// security_note): se una seconda rigenerazione della STESSA variante e' gia' in volo, la sua
// scrittura sbatte contro l'UNIQUE (generation_id, scope, variant_index) di T-200 e `writePool`
// torna 409 (decisione (h) di T-204). Qui quel 409 diventa `reason: 'conflitto'`, un errore
// riconoscibile: la UI non deve impedire il doppio invio, il vincolo lo rende impossibile.
//
// COSA NON FA, dichiarato: NON riconvalida `generatable`. La generazione ESISTE solo perche' il
// suo brief era generabile alla creazione (T-230), e la rigenerazione ne rifa' la fase 1 sullo
// stesso brief; un pre-controllo di generabilita' qui sarebbe una seconda copia di quella
// decisione.
//
// COSA FA PRIMA DEL CONFINE, e perche' e' SICUREZZA e non ripetizione: legge la generazione
// CORRENTE del sito e pretende (a) che sia ESATTAMENTE la `generationId` indicata — la coerenza
// siteId<->generationId, l'unica difesa contro l'avvelenamento cross-sito del pool dato che la
// RLS scopa per account e non per sito — e (b) che sia in 'ready'. Entrambi i controlli stanno
// PRIMA di `runGenerationPhase1`: cosi' un ramo che verrebbe comunque respinto non spende una
// chiamata a un modello a pagamento (contenimento del costo di AC-232-5). Contro la doppia
// rigenerazione della STESSA variante gia' scritta resta l'UNIQUE del DB (il 409 → 'conflitto'
// qui sotto): la UI non deve sorvegliarlo, il vincolo lo rende impossibile.

/** 5 mockup ⇒ indici 0..4 (P2-D13), lo stesso dominio del CHECK di T-200. */
const VARIANTI_MOCKUP = 5;

/** L'ambito dei pool della fase 1: la sola pagina iniziale (T-213). Nostro, mai dal client. */
const AMBITO_HOME = 'home';

// L'indice di variante e' input come ogni altro: validato PRIMA di spendere una chiamata al
// confine, cosi' un indice fuori 0..4 non costa un turno del modello.
const variantIndexSchema = z.number().int().min(0).max(VARIANTI_MOCKUP - 1);

/**
 * L'esito della rigenerazione. Il fallimento e' NOMINATO e distinto, perche' dice a chi chiama
 * cose diverse: 'conflitto' e' la seconda rigenerazione respinta dall'UNIQUE (AC-232-5),
 * 'confine_fallito' e' il modello che non ha prodotto un pool, 'brief_assente'/'non_leggibile'
 * sono i due esiti della lettura del brief (un guasto non e' un brief mancante, P2-D16).
 */
export type RegenerateVariantResult =
  | { ok: true; poolId: string }
  | {
      ok: false;
      reason:
        | 'indice_non_valido'
        | 'non_autorizzato'
        // la generazione indicata NON e' la generazione corrente del sito indicato (coerenza
        // siteId<->generationId): la RLS scopa per ACCOUNT, non per SITO, quindi questa e'
        // l'unica difesa contro l'avvelenamento cross-sito del pool (vedi la nota in testa).
        | 'sito_incoerente'
        // la generazione non e' in 'ready': non ci sono cinque varianti da rigenerare.
        | 'stato_non_valido'
        | 'generazione_non_leggibile'
        | 'brief_non_leggibile'
        | 'brief_assente'
        | 'confine_fallito'
        | 'conflitto'
        | 'non_scritto';
    };

/**
 * Rigenera il testo della variante `variantIndex` di una generazione, scrivendone il pool
 * proprio (P2-D3). UNA chiamata al confine, UNA scrittura.
 *
 * @param input `siteId` per leggere il brief (RLS), `generationId` per scrivere il pool,
 *   `variantIndex` 0..4. Entrambi gli id sono derivati server-side, non dal browser.
 */
export async function regenerateVariant(input: {
  readonly siteId: string;
  readonly generationId: string;
  readonly variantIndex: number;
}): Promise<RegenerateVariantResult> {
  const variante = variantIndexSchema.safeParse(input.variantIndex);
  if (!variante.success) return { ok: false, reason: 'indice_non_valido' };

  // COERENZA siteId<->generationId E CONTENIMENTO DEL COSTO, PRIMA di leggere il brief e PRIMA
  // di spendere la chiamata al confine (security_note di AC-232-5). La RLS di site_generations
  // scopa per ACCOUNT, non per SITO: senza questo controllo un utente dello stesso account
  // potrebbe passare il `generationId` del sito B col `siteId` del sito A e avvelenare il pool
  // della generazione di B col brief di A — RLS e writePool lascerebbero passare tutto, perche'
  // la generazione di B E' visibile a quell'account. Si legge percio' la generazione CORRENTE
  // del sito (getGeneration, la lettura AUTOREVOLE che applica la riconciliazione di P2-D15) e
  // si pretende che sia ESATTAMENTE quella indicata: la rigenerazione tocca SOLO la generazione
  // propria del sito. Un `siteId` di un altro tenant filtra a null → 'sito_incoerente', mai un
  // errore che riveli l'esistenza altrui — la stessa forma di `selectVariant` (T-233).
  const gen = await loadOwnGeneration(input.siteId, input.generationId, 'sito_incoerente');
  if (!gen.ok) return gen;
  // SOLO da 'ready' si rigenera: la fase 1 ha prodotto le cinque varianti e nessuna scelta e'
  // stata fatta. Un ramo che verrebbe comunque respinto (generazione non ancora pronta, gia'
  // scelta, completa o fallita) NON deve spendere una chiamata a un modello a pagamento — e' il
  // contenimento del costo di AC-232-5 imposto PRIMA del confine, non dopo.
  if (gen.generation.status !== 'ready') return { ok: false, reason: 'stato_non_valido' };

  // Il brief: un GUASTO di lettura (500/401) non e' un brief assente (P2-D16). Senza brief non
  // c'e' nulla da rigenerare — la generazione non dovrebbe esistere senza, ma non lo si assume.
  const briefResult = await loadOwnBrief(input.siteId);
  if (!briefResult.ok) return briefResult;

  // LA SOLA CHIAMATA AL CONFINE. Un'ECCEZIONE (rete/SDK) e un esito NOMINATO di fallimento sono
  // due cose distinte, ed entrambe qui sono 'confine_fallito': il pool non esiste, non si scrive.
  let phase1: Awaited<ReturnType<typeof runGenerationPhase1>>;
  try {
    phase1 = await runGenerationPhase1(briefResult.brief);
  } catch {
    return { ok: false, reason: 'confine_fallito' };
  }
  if (!phase1.ok) return { ok: false, reason: 'confine_fallito' };

  // LA SCRITTURA DEL POOL DELLA VARIANTE: scope 'home', `variant_index = i`, con la STESSA
  // allowlist con cui il pool e' stato validato (portata dalla fase 1, non ricalcolata).
  const written = await writePool(
    input.generationId,
    AMBITO_HOME,
    variante.data,
    phase1.pool,
    phase1.allowedSlugs,
  );
  if (!written.ok) {
    if (written.status === 401) return { ok: false, reason: 'non_autorizzato' };
    // 409 = quel pool esiste gia' (UNIQUE, decisione (h) di T-204) o la generazione e' in uno
    // stato terminale (decisione (g)): in entrambi i casi la rigenerazione non va rifatta.
    if (written.status === 409) return { ok: false, reason: 'conflitto' };
    return { ok: false, reason: 'non_scritto' };
  }

  return { ok: true, poolId: written.id };
}
