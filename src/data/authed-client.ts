import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/data/supabase-ssr';

// macrotask generation-ui, P2 — IL CLIENT CON SESSIONE + L'IDENTITA' GIA' VALIDATA, in una sola
// sede. E' il preambolo che ogni lettura/scrittura dati ripeteva identico:
//
//   const supabase = await createServerSupabaseClient();
//   const { data: { user } } = await supabase.auth.getUser();
//   if (!user) return { ok: false, status: 401 };
//
// misurato come duplicazione dal controllo dead-code del checkpoint (fra i moduli di src/data). Qui
// vive UNA volta: l'`ok:true` porta il client su cui la RLS e' ATTIVA (anon key + cookie
// dell'utente), MAI la service_role (R7 / A01:2025); `getUser()` rivalida il token contro l'auth
// server invece di fidarsi del cookie. Il campo `error` di getUser e' ignorato come nel codice
// inline che sostituisce — un errore lascia `user` nullo e il ramo 401 lo copre. NON cattura le
// eccezioni di `createServerSupabaseClient` (variabili d'ambiente mancanti): quello e' un guasto di
// configurazione, non un 401, e deve emergere come nel preambolo originale.
//
// PERCHE' UN MODULO A PARTE E NON dentro `supabase-ssr`: molti oracoli-test mockano
// `@/data/supabase-ssr` in modo PARZIALE (danno il solo `createServerSupabaseClient`, o il solo
// `getUser`) e poi esercitano la funzione dati REALE. Tenendo `getAuthedClient` FUORI da quel
// modulo, esso resta la funzione VERA anche sotto quei mock e consuma il `createServerSupabaseClient`
// mockato dal test — nessun test va toccato per il seam nuovo.

/** Il client con sessione (RLS attiva) e l'utente validato, oppure l'esito 401 se non c'e' sessione. */
export type AuthedClient =
  | { ok: true; supabase: SupabaseClient; user: User }
  | { ok: false; status: 401 };

/**
 * Il client Supabase legato alla SESSIONE piu' l'identita' gia' validata, oppure un 401.
 * @returns `{ ok: true, supabase, user }` sotto sessione valida; `{ ok: false, status: 401 }` senza.
 */
export async function getAuthedClient(): Promise<AuthedClient> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  return { ok: true, supabase, user };
}
