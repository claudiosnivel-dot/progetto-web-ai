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

// Route protette: /{locale}/dashboard e ogni sotto-route. Il locale è vincolato
// ai locali supportati (unica sorgente di verità: routing.locales), mai a input
// libero.
const protectedRoute = new RegExp(`^/(${routing.locales.join('|')})/dashboard(?:/.*)?$`);

// La funzione NON è async: per le route non protette ritorna in modo SINCRONO la
// response di next-intl (preserva il comportamento verificato in T-080). Solo per
// le route protette delega alla guardia asincrona, che legge la sessione
// server-side.
export default function middleware(
  request: NextRequest,
): NextResponse | Promise<NextResponse> {
  const match = request.nextUrl.pathname.match(protectedRoute);
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
