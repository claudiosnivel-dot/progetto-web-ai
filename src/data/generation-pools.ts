'use server';

import { getAuthedClient } from '@/data/authed-client';

// T-232 (macrotask generation-ui, P2) — LETTURA dei pool 'home' di una generazione, per
// rendere le cinque card del selettore. Eseguita solo server-side col client legato alla
// SESSIONE (RLS attiva), MAI la service_role (R7): la policy `is_account_member` di
// generation_pools (T-200) scopa gia' il risultato agli account di cui l'utente e' membro, e i
// pool di un altro tenant filtrano a insieme vuoto — nessun filtro applicativo per account e
// nessuna enumerazione.
//
// UNA SOLA QUERY per tutti i pool 'home' (condiviso + per-variante): sono al piu' sei righe
// (l'UNIQUE (generation_id, scope, variant_index) di T-200 lo garantisce), quindi si leggono
// insieme e si partizionano in memoria. Colonne NOMINATE, mai select('*'): servono solo
// `variant_index` (per smistare) e `content` (da rendere).
//
// IL CONTENUTO E' jsonb OPACO e NON viene ri-validato qui: e' stato validato in SCRITTURA
// (`writePool` -> `parsePool`, T-201/T-204), e la ri-validazione in lettura richiederebbe
// l'allowlist degli slug che qui non c'e'. Il gate che protegge il RENDERING e' `parseDocument`
// (T-202), applicato a valle da `resolveVariantHome` (T-232) sul documento risolto: un pool
// incompleto produce una card vuota che quel gate scarta, non un albero non validato.

/**
 * Il risultato di `readHomePools`: il pool CONDIVISO (`shared`, `variant_index` null) e quelli
 * PER VARIANTE (`byVariant`, per indice 0..4). `shared` e' `null` se la generazione non ha (o
 * non mostra a questa identita') un pool condiviso — una generazione 'ready' ne ha sempre uno,
 * scritto dalla fase 1 (T-230).
 */
export type ReadHomePoolsResult =
  | { ok: true; shared: unknown; byVariant: Record<number, unknown> }
  | { ok: false; status: 401 | 500 };

/** L'ambito dei pool della fase 1: la sola pagina iniziale (T-213). Nostro, mai dal client. */
const AMBITO_HOME = 'home';

type RigaPoolHome = {
  variant_index: number | null;
  content: unknown;
};

/**
 * I pool 'home' della generazione, partizionati in condiviso e per-variante.
 *
 * @param generationId l'id della generazione, derivato server-side (getGeneration), non dal
 *   browser. Non e' rivalidato qui: un id malformato filtra a insieme vuoto o produce l'errore
 *   tipato del DB, non un bypass — `.eq()` e' parametrizzato (A05:2025).
 */
export async function readHomePools(generationId: string): Promise<ReadHomePoolsResult> {
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  const { data, error } = await supabase
    .from('generation_pools')
    .select('variant_index, content')
    .eq('generation_id', generationId)
    .eq('scope', AMBITO_HOME);
  if (error) return { ok: false, status: 500 };

  let shared: unknown = null;
  const byVariant: Record<number, unknown> = {};
  for (const riga of (data ?? []) as RigaPoolHome[]) {
    if (riga.variant_index === null) shared = riga.content;
    else byVariant[riga.variant_index] = riga.content;
  }

  return { ok: true, shared, byVariant };
}
