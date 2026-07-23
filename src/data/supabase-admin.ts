import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Client Supabase con service_role: BYPASSA la RLS. Vive SOLO server-side
// (import 'server-only' fa fallire il build se importato in un contesto client).
// Ogni handler che lo usa deve applicare authz esplicita (R7 / A01:2025).
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Variabili d'ambiente mancanti: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
