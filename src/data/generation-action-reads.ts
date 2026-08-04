import { getBrief } from '@/data/briefs';
import { getGeneration, type GenerationSummary } from '@/data/generations';
import type { Brief } from '@/domain/onboarding/brief';

// macrotask generation-ui, P2 — LE DUE LETTURE-CON-ESITO condivise dalle server action della
// generazione (selectVariant/T-233, runPhase2/T-234, regenerateVariant/T-232). Ognuna leggeva il
// brief e la generazione CORRENTE del sito con la STESSA catena — lettura AUTOREVOLE (che applica
// la riconciliazione di P2-D15), un GUASTO di lettura tenuto DISTINTO da un dato assente (P2-D16),
// e la mappatura dello status al motivo NOMINATO dell'azione — copiata verbatim (misurata come
// duplicazione dal controllo dead-code del checkpoint fra generation-choose e generation-phase2).
// Qui vive UNA volta; il motivo dell'esito resta NOMINATO e proprio dell'azione, perche' il solo
// punto che DIVERGE fra i chiamanti (il motivo del mismatch siteId<->generationId) e' un parametro.
//
// NESSUN cambio di semantica: la coerenza siteId<->generationId (`gen.generation.id !== generationId`)
// resta l'unica difesa contro l'avvelenamento cross-sito del pool dato che la RLS scopa per ACCOUNT
// e non per SITO (nota in testa a regenerateVariant); un id di un altro tenant filtra a null e
// riceve il motivo di mismatch, mai un errore che ne riveli l'esistenza (P1-D21).

/**
 * Il BRIEF del sito, o l'esito NOMINATO del suo mancato caricamento. Un `ok:false` di `getBrief`
 * (500/401) e' un GUASTO, non un brief assente (P2-D16): i due hanno motivi distinti.
 * @param siteId il sito di cui leggere il brief (RLS-backed, mai dal client).
 */
export async function loadOwnBrief(
  siteId: string,
): Promise<
  | { ok: true; brief: Brief }
  | { ok: false; reason: 'non_autorizzato' | 'brief_non_leggibile' | 'brief_assente' }
> {
  const briefResult = await getBrief(siteId);
  if (!briefResult.ok) {
    return { ok: false, reason: briefResult.status === 401 ? 'non_autorizzato' : 'brief_non_leggibile' };
  }
  if (briefResult.brief === null) return { ok: false, reason: 'brief_assente' };
  return { ok: true, brief: briefResult.brief };
}

/**
 * La generazione CORRENTE del sito, PRETESA coincidente con `generationId`, o l'esito NOMINATO del
 * suo mancato caricamento. Legge con `getGeneration` (lettura AUTOREVOLE, riconciliazione P2-D15) e
 * pretende `gen.generation.id === generationId`: e' la coerenza siteId<->generationId, l'unica
 * difesa contro il cross-sito quando la RLS scopa per account.
 * @param siteId il sito di cui leggere lo stato (RLS-backed).
 * @param generationId la generazione ATTESA; un mismatch (o sito altrui -> null) da' `mismatchReason`.
 * @param mismatchReason il motivo NOMINATO del mismatch, proprio dell'azione chiamante
 *   ('generazione_assente' per scegli/fase2, 'sito_incoerente' per la rigenerazione).
 */
export async function loadOwnGeneration<M extends string>(
  siteId: string,
  generationId: string,
  mismatchReason: M,
): Promise<
  | { ok: true; generation: GenerationSummary }
  | { ok: false; reason: 'non_autorizzato' | 'generazione_non_leggibile' | M }
> {
  const gen = await getGeneration(siteId);
  if (!gen.ok) {
    return {
      ok: false,
      reason: gen.status === 401 ? 'non_autorizzato' : 'generazione_non_leggibile',
    };
  }
  if (gen.generation === null || gen.generation.id !== generationId) {
    return { ok: false, reason: mismatchReason };
  }
  return { ok: true, generation: gen.generation };
}
