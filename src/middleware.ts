import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Middleware next-intl: applica il routing per locale (redirect al default,
// negoziazione del prefisso). Questo unico file verrà ESTESO da T-041 con la
// guardia auth, senza indebolire il routing di locale.
export default createMiddleware(routing);

export const config = {
  // Esclude /api, /_next, /_vercel e ogni percorso con estensione (file
  // statici, es. favicon.ico): il prefisso di locale non viene applicato lì.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
