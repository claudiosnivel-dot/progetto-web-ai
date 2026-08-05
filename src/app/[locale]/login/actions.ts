'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { loginSchema, type LoginState } from '@/domain/auth/validation';
import { createServerSupabaseClient } from '@/data/supabase-ssr';
import { routing } from '@/i18n/routing';

// Server Action di login/logout e avvio dell'OAuth Google (T-043).
//
// Vive nel layer `app` (co-locata con login/page.tsx): sono azioni framework-bound
// — leggono next/headers, lasciano che l'adapter SSR muti i cookie di sessione e
// chiamano redirect(). app puo' toccare `data` (@/data/supabase-ssr) e `domain`
// (la validazione zod, che resta in @/domain/auth/validation) senza violare il
// contratto di altitudine.
//
// Sicurezza (security_notes HARD del blueprint):
//  - A07:2025 (authentication failures): a credenziali errate si ritorna SEMPRE
//    lo STESSO messaggio generico (GENERIC_LOGIN_ERROR), identico per email
//    inesistente e per password errata → nessuna user-enumeration. Nessun ramo
//    rivela quale campo è sbagliato.
//  - Validazione input server-side: presenza + formato delle credenziali sono
//    verificati con zod (loginSchema) PRIMA di ogni contatto con l'auth server;
//    nessuna fiducia nel client.
//  - R7 / A02:2025: si usa il client SSR (anon key + cookie, RLS attiva) via
//    createServerSupabaseClient. MAI la service_role / supabase-admin.
//  - OWASP redirect: le destinazioni post-login/logout sono path interni FISSI
//    (/{locale}/dashboard, /{locale}/login), mai derivati da input utente; il
//    locale è vincolato all'allowlist (routing.locales).

// Messaggio d'errore UNICO e generico per OGNI fallimento di login (input
// malformato o credenziali rifiutate dall'auth server): stessa identica stringa
// in tutti i rami → anti user-enumeration.
const GENERIC_LOGIN_ERROR = 'Credenziali non valide.';

// Vincola il locale ricevuto (input controllabile dal client, es. bound dalla
// pagina) all'allowlist prima di comporre qualsiasi path di redirect.
function safeLocale(locale: string): string {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

// Origine assoluta same-app derivata dagli header della richiesta: serve a
// costruire il redirectTo ASSOLUTO richiesto da signInWithOAuth. Nessun valore
// hardcoded; in mancanza dell'host si fallisce esplicitamente.
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (!host) {
    throw new Error("Host non disponibile: impossibile costruire il redirectTo OAuth.");
  }
  return `${proto}://${host}`;
}

// Login email/password. La validazione è ESCLUSIVAMENTE server-side: se
// loginSchema fallisce, signInWithPassword non viene mai chiamato. A credenziali
// rifiutate NON viene creata alcuna sessione (nessun cookie) e si ritorna il
// messaggio generico. Al successo il client SSR imposta i cookie di sessione e si
// reindirizza alla dashboard del locale.
export async function login(
  locale: string,
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { status: 'error', message: GENERIC_LOGIN_ERROR };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Nessuna sessione creata; messaggio generico e uniforme (identico per
    // email inesistente e password errata).
    return { status: 'error', message: GENERIC_LOGIN_ERROR };
  }

  // Successo: i cookie di sessione sono stati scritti dall'adapter del client
  // SSR. Redirect interno FISSO alla dashboard del locale.
  redirect(`/${safeLocale(locale)}/dashboard`);
}

// Logout: invalida la sessione lato auth server e pulisce i cookie di sessione
// (signOut passa dall'adapter cookie del client SSR), poi reindirizza al login.
export async function logout(locale: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect(`/${safeLocale(locale)}/login`);
}

// Avvio dell'OAuth Google (PREDISPOSTO): signInWithOAuth con provider 'google' e
// redirectTo ASSOLUTO verso /{locale}/auth/callback (dove T-044 scambia il code
// per la sessione). Lato server signInWithOAuth NON reindirizza da solo: ritorna
// l'URL di autorizzazione, verso cui si reindirizza esplicitamente.
export async function signInWithGoogle(locale: string): Promise<void> {
  const lc = safeLocale(locale);
  const supabase = await createServerSupabaseClient();
  const redirectTo = new URL(`/${lc}/auth/callback`, await siteOrigin()).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });

  if (error || !data.url) {
    // Fallimento nell'avvio dell'OAuth: torna al login con un errore generico,
    // senza stabilire alcuna sessione.
    redirect(`/${lc}/login?error=auth`);
  }

  // URL di autorizzazione emesso dall'auth server (non da input utente): è la
  // destinazione attesa del flusso OAuth.
  redirect(data.url);
}
