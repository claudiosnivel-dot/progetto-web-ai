import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// Utility di test riusabili: creano utenti e restituiscono client Supabase con la
// sessione JWT reale dell'utente, contro l'istanza Supabase locale. Sono il
// prerequisito trasversale affinché i test RLS esercitino le policy come ruolo
// 'authenticated' (auth.uid() reale), MAI come superuser (falso verde SQL editor).

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const anonKey = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY as string;

// Client service_role: SOLO per setup/teardown lato Node. Bypassa la RLS.
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function createTestUser(email: string, password: string): Promise<User> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

// Restituisce un client autenticato con la sessione reale dell'utente (RLS attiva).
export async function signInAs(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(supabaseUrl(), anonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

export async function deleteTestUser(userId: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(userId);
}
