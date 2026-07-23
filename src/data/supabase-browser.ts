import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client Supabase per il browser: usa ESCLUSIVAMENTE la anon key (pubblica per
// design e sicura con RLS attiva). Non tocca mai la service_role.
export function createBrowserClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Variabili d'ambiente mancanti: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createClient(url, anonKey);
}
