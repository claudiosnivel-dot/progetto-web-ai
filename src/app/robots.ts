import type { MetadataRoute } from 'next';
import { getSiteBaseUrl } from '@/config/env';

// T-411 (macrotask seo-base, P4) — robots.txt del dominio. DUE regole, entrambe di sicurezza-per-
// visibilita':
//
//  - ALLOW /s/ : il serving pubblico dei siti (/s/<slug>, T-405) DEVE essere indicizzabile — e' il
//    prodotto. Nessun Disallow lo copre.
//
//  - DISALLOW editor e preview : le rotte protette /{locale}/editor/{siteId} e
//    /{locale}/preview/{siteId} sono superfici dell'app, non pagine pubbliche. Sono locale-prefissate,
//    quindi il pattern e' `/*/editor` e `/*/preview` (il `*` copre il segmento di locale, it/es).
//    E' difesa in profondita' insieme al `robots: noindex` che quelle pagine portano nei metadati
//    (T-411): il robots scoraggia il crawl, il noindex impedisce l'indicizzazione anche se raggiunte.
//
// SITEMAP: una sitemap INDEX GLOBALE (che elenchi tutte le sitemap per-sito) e' FUORI SCOPE in M3 —
// le sitemap sono PER-SITO, a `/s/<slug>/sitemap.xml`, e non esiste un catalogo pubblico di tutti gli
// slug da cui comporne un indice senza esporre l'enumerazione dei siti. La riga `Sitemap:` deve
// comunque esistere (convenzione robots), quindi punta a `<base>/sitemap.xml`: la sede convenzionale
// dove un futuro indice globale vivrebbe e dove i crawler la cercano per default. Scelta documentata.
//
// La base e' da config (getSiteBaseUrl), l'origine con cui il sito e' servito — mai testo libero.

export default function robots(): MetadataRoute.Robots {
  const base = getSiteBaseUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/s/',
      disallow: ['/*/editor', '/*/preview'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
