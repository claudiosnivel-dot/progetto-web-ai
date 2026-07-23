import { NextResponse, type NextRequest } from 'next/server';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/data/supabase-ssr';

// Route handler GET /{locale}/auth/callback — completa il flusso OAuth/PKCE.
//
// Sicurezza (security_notes HARD del blueprint T-044):
//  - A01:2025 (broken access control): la sessione è stabilita SOLO tramite
//    exchangeCodeForSession con un code valido emesso dall'auth server. Senza
//    code (o con ?error) NON si scambia nulla e nessun cookie viene impostato.
//  - R7 (RLS standard): usa il client SSR (anon key + cookie, RLS attiva) via
//    createServerSupabaseClient. MAI la service_role / supabase-admin.
//  - A07:2025 (secret): le chiavi sono lette da env dentro il client SSR;
//    nessun segreto nel codice.
//  - OWASP open redirect: il parametro `next` è validato come path relativo
//    same-origin (vedi sanitizeNext) prima di costruire la destinazione.

// Sanitizza il parametro `next` (anti open-redirect). Approccio ORIGIN-BASED, non
// un semplice regex: si risolve `next` rispetto all'origin same-origin e si accetta
// SOLO se la destinazione risultante resta sullo stesso origin, ritornandone poi la
// sola parte interna (path + query + hash). Questo rifiuta in un colpo solo URL
// assolute ('https://evil'), protocol-relative ('//evil'), backslash-trick ('/\evil',
// normalizzato dai browser in '//') e lo smuggling via caratteri di controllo
// ('/\t//evil', che il parser WHATWG URL rimuove facendo risolvere la destinazione
// su un host esterno). I control-char sono inoltre rifiutati ESPLICITAMENTE prima di
// invocare il parser (difesa in profondità, senza affidarsi alla normalizzazione).
// Il valore grezzo non viene MAI interpolato in un header Location senza passare da
// questa validazione.
function sanitizeNext(next: string | null, origin: string, fallback: string): string {
  if (!next) {
    return fallback;
  }
  // Difesa esplicita: qualunque carattere di controllo ASCII (C0, da U+0000 a
  // U+001F, oppure DEL U+007F) è un vettore di smuggling — il parser URL li
  // strippa e potrebbe far risolvere la destinazione fuori same-origin. Li
  // rifiutiamo PRIMA del parser, senza affidarci alla sua normalizzazione.
  if (/[\u0000-\u001f\u007f]/.test(next)) {
    return fallback;
  }
  try {
    const u = new URL(next, origin);
    // Ogni destinazione che esce dal same-origin (assoluta, protocol-relative,
    // backslash-trick, ecc.) ricade sul default sicuro.
    if (u.origin !== origin) {
      return fallback;
    }
    // Same-origin garantito: ritorna la SOLA parte interna, mai l'origin.
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

type CallbackContext = { params: Promise<{ locale: string }> };

export async function GET(
  request: NextRequest,
  context: CallbackContext,
): Promise<NextResponse> {
  const { locale: rawLocale } = await context.params;
  // Il locale proviene dal path ([locale]) ed è input controllabile dal client:
  // lo si vincola all'allowlist (routing.locales) prima di costruire qualsiasi
  // destinazione, mai interpolando il valore grezzo (A05:2025 / anti path-injection).
  const locale = hasLocale(routing.locales, rawLocale)
    ? rawLocale
    : routing.defaultLocale;

  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Nessun code valido (assente o l'auth server ha segnalato un errore): NON si
  // chiama exchange, nessuna sessione viene creata. Redirect al login con un
  // parametro di errore generico (destinazione interna fissa).
  if (!code || error) {
    const loginUrl = new URL(`/${locale}/login`, url.origin);
    loginUrl.searchParams.set('error', 'auth');
    return NextResponse.redirect(loginUrl, 307);
  }

  // Default sicuro: la dashboard del locale corrente (path interno fisso).
  const fallback = `/${locale}/dashboard`;

  // Scambio code -> sessione tramite il client SSR (anon + cookie). È qui, e solo
  // qui con un code valido, che i cookie di sessione vengono impostati.
  const supabase = await createServerSupabaseClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    const loginUrl = new URL(`/${locale}/login`, url.origin);
    loginUrl.searchParams.set('error', 'auth');
    return NextResponse.redirect(loginUrl, 307);
  }

  // Destinazione validata: solo path relativi interni same-origin sono accettati;
  // tutto il resto ricade sul default sicuro same-origin.
  const destination = sanitizeNext(url.searchParams.get('next'), url.origin, fallback);
  return NextResponse.redirect(new URL(destination, url.origin), 307);
}
