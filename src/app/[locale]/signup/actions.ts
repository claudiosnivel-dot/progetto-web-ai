'use server';

import { signupSchema, isSignupAllowed, type SignupState } from '@/domain/auth/validation';
import { getSignupAllowlist } from '@/config/env';
import { createServerSupabaseClient } from '@/data/supabase-ssr';

// Server Action di signup email/password. Vive nel layer `app` (co-locata con
// signup/page.tsx): app puo' toccare `data` (@/data/supabase-ssr) e `domain` (la
// validazione zod, che resta in @/domain/auth/validation) senza violare il
// contratto di altitudine.
//
// La validazione è ESCLUSIVAMENTE server-side (non ci si fida del client):
// signupSchema.safeParse gira PRIMA di ogni contatto con l'auth server e, se
// fallisce, supabase.auth.signUp non viene mai invocato. Lo schema fa strip dei
// campi extra → nessun privilegio (role/account_id) iniettato dal client raggiunge
// signUp (A01:2025). L'hashing della password è delegato a Supabase Auth/bcrypt
// (A04:2025); si usa la API tipata signUp, nessuna interpolazione di stringhe
// (A05:2025). Il client SSR usa la anon key + cookie (RLS attiva), mai la
// service_role (R7).
export async function signup(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { status: 'error', message: 'Dati di registrazione non validi.' };
  }

  // (deploy pass) — MURO DEI SIGNUP: pre-lancio le registrazioni sono chiuse a chiunque
  // tranne l'allowlist (getSignupAllowlist da config). L'email non autorizzata riceve lo
  // STESSO messaggio generico di un fallimento qualsiasi (anti user-enumeration: non si
  // rivela "registrazioni chiuse" vs "email gia' presente"), e supabase.auth.signUp NON
  // viene mai invocato. In sviluppo l'allowlist e' vuota => aperto (nessun cambiamento).
  if (!isSignupAllowed(parsed.data.email, getSignupAllowlist())) {
    return { status: 'error', message: 'Registrazione non riuscita. Riprova.' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Messaggio generico: non distingue la causa (anti user-enumeration).
    return { status: 'error', message: 'Registrazione non riuscita. Riprova.' };
  }

  return { status: 'success', message: 'Registrazione completata.' };
}
