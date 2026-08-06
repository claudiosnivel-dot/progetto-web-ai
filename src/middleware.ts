import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { getUserFromRequest } from './data/supabase-ssr';

// Middleware UNICO: compone il routing per locale di next-intl (T-080) con la
// guardia auth di route (T-041). Il routing di locale NON viene mai
// corto-circuitato: la guardia intercetta solo le route protette senza sessione,
// tutto il resto prosegue nel normale flusso next-intl (es. /es/dashboard non
// autenticato → /es/login, non /it/login).
const handleI18n = createMiddleware(routing);

// Route protette: /{locale}/dashboard, /{locale}/onboarding (T-150), /{locale}/generate
// (T-230), /{locale}/preview (T-235) e /{locale}/editor (T-311), con ogni sotto-route. Il locale
// è vincolato ai locali supportati (unica sorgente di verità: routing.locales), mai a input libero.
// Gli endpoint /api (turno chat di T-150, POST /api/generate di T-230) vivono sotto /api,
// che il matcher esclude del tutto: la loro guardia è nel route handler stesso (401/403 JSON,
// non un 307 verso il login, che un fetch non potrebbe leggere).
// PROMEMORIA (T-230/T-235/T-311, come per onboarding): il matcher esclude ogni pathname con un
// punto, quindi per un siteId come 'a.b' questa guardia non parte affatto — la difesa resta la
// guardia server-side nella pagina (getUser in ./guard). Non si affida nulla al middleware.
// /editor entra qui per PARITÀ di hardening con /preview (T-311, D4): la guardia-pagina resta
// comunque l'unica difesa per un siteId con un punto, ma /editor non deve essere pubblica quando
// il pathname è "pulito".
const PROTECTED_SEGMENTS = ['dashboard', 'onboarding', 'generate', 'preview', 'editor'] as const;
// ESPORTATA per l'audit degli oracoli (tests/auth-middleware.test.ts): e' la regex REALE che
// decide se una rotta e' GUARDATA — derivata da PROTECTED_SEGMENTS. `config.matcher` dice solo
// SE il middleware gira (catch-all), non se protegge, quindi la membership di /generate e
// /preview va asserita contro QUESTA, cosi' togliere un segmento fa cadere anche l'audit.
export const protectedRoute = new RegExp(
  `^/(${routing.locales.join('|')})/(?:${PROTECTED_SEGMENTS.join('|')})(?:/.*)?$`,
);

// P4-D4 — /s/<slug> è la rotta pubblica STANDALONE, servita FUORI dal segmento
// [locale]. 's' è uno slug RISERVATO, MAI un locale: il routing per locale di
// next-intl NON deve toccare questo prefisso (niente redirect da Accept-Language,
// niente prefisso /it|/es aggiunto). Cattura ESATTAMENTE `/s` e i suoi sotto-path
// (`/s/...`), non un path qualsiasi che inizia per 's' (es. /support, /services).
// ESPORTATA per rendere OSSERVABILE la decisione nei test (T-406), come protectedRoute.
export const PUBLIC_STANDALONE_PREFIX = '/s';
export const isPublicStandalonePath = (pathname: string): boolean =>
  pathname === PUBLIC_STANDALONE_PREFIX ||
  pathname.startsWith(`${PUBLIC_STANDALONE_PREFIX}/`);

// La funzione NON è async: per le route non protette ritorna in modo SINCRONO la
// response di next-intl (preserva il comportamento verificato in T-080). Solo per
// le route protette delega alla guardia asincrona, che legge la sessione
// server-side.
export default function middleware(
  request: NextRequest,
): NextResponse | Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  // P4-D4: /s/* è pubblica e standalone → ESCLUSA dal routing per locale
  // (handleI18n NON viene invocato: nessun prefisso di locale, nessuna
  // negoziazione Accept-Language, nessun rewrite verso segmenti autenticati).
  // Il middleware CONTINUA comunque a girare su questo path (NextResponse.next())
  // per non perdere le protezioni globali: si esclude SOLO il locale, non la
  // sicurezza (A05:2025). Va PRIMA della guardia auth: /s/* non tocca /{locale}.
  if (isPublicStandalonePath(pathname)) {
    return NextResponse.next();
  }
  const match = pathname.match(protectedRoute);
  if (match) {
    return guardProtectedRoute(request, match[1]);
  }
  // Route pubbliche (login, signup, callback, home, …) e asset esclusi dal
  // matcher: nessuna guardia, prosegue il routing di locale.
  return handleI18n(request);
}

// Guardia server-side (A01:2025): nega l'accesso alle route protette senza
// identità valida. getUserFromRequest è isolato in @/data/supabase-ssr (anon +
// cookie, RLS attiva) ed è mockabile nei test.
async function guardProtectedRoute(
  request: NextRequest,
  locale: string,
): Promise<NextResponse> {
  const user = await getUserFromRequest(request);
  if (!user) {
    // Destinazione FISSA e interna (/{locale}/login), mai da input utente
    // (anti open-redirect). Il locale corrente è preservato.
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `/${locale}/login`;
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl, 307);
  }
  // Utente valido: prosegue nel flusso di locale next-intl (NextResponse.next).
  return handleI18n(request);
}

export const config = {
  // Esclude /api, /_next, /_vercel e ogni percorso con estensione (file statici,
  // es. favicon.ico): né il routing di locale né la guardia vengono applicati lì.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
