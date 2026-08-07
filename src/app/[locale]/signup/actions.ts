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

  // (deploy pass) — MURO DEI SIGNUP, DIFESA IN PROFONDITA' (non il muro unico). Questo gate
  // chiude SOLO questa via (la Server Action email/password): un'email non in allowlist riceve
  // lo STESSO messaggio generico di un fallimento qualsiasi (anti user-enumeration) e
  // supabase.auth.signUp NON viene mai invocato. In sviluppo l'allowlist e' vuota => aperto.
  //
  // LIMITE DICHIARATO (rilievo verifier B1): un account nasce da QUALSIASI insert in auth.users,
  // e questa Server Action non e' l'unico percorso — l'endpoint Supabase /auth/v1/signup (anon key
  // pubblica) e l'OAuth la scavalcano. Il MURO VERO del pre-lancio e' a livello PIATTAFORMA e va
  // configurato nel deploy: (1) Supabase Auth `enable_signup = false` + invito del founder dalla
  // dashboard (chiude l'endpoint diretto e l'auto-provisioning); OAuth esterni disabilitati fino al
  // lancio; (2) Cloudflare Access sull'app (chiude la UI/API su ulaba.net). Questa allowlist resta
  // come cintura per il giorno in cui i signup verranno riaperti con gating (P5).
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
