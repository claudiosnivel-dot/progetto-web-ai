import { getTranslations } from 'next-intl/server';
import { enterSiteRoute } from '@/app/[locale]/_shared/site-route-guard';
import { routing } from '@/i18n/routing';

// T-235 (macrotask generation-ui, P2) — L'INGRESSO alla rotta /preview.
//
// STESSA CATENA DI SICUREZZA di /generate e /onboarding, ora in UNA sola sede (`enterSiteRoute`)
// e NON ricopiata: la protezione del middleware su /preview e' RIASSERITA — /preview e' fra i
// PROTECTED_SEGMENTS — e per giunta il matcher del middleware esclude ogni pathname con un punto,
// quindi per un siteId come 'a.b' la guardia-pagina e' l'UNICA difesa. Non si affida nulla al
// middleware. Cio' che e' PROPRIO di /preview e non condiviso e' il catalogo i18n: qui si carica
// SOLO il namespace 'preview', quindi la guardia comune resta parametrizzata dal solo messaggio
// d'errore, e il catalogo lo compone questa funzione dopo.
//
// L'anti-enumerazione (stesso `notFound()` per non-tuo/inesistente), l'allowlist del locale e il
// redirect al login FISSO vivono ora in `enterSiteRoute`, invariati (AC-235-3, P1-D21).

type PreviewEntry = {
  locale: (typeof routing.locales)[number];
  t: Awaited<ReturnType<typeof getTranslations>>;
};

/**
 * Apre la rotta /preview: vincola il locale, esige l'identita', accerta la proprieta' del sito
 * (catena comune `enterSiteRoute`) e carica il catalogo 'preview'. Non legge il documento: lo fa
 * la pagina, con una lettura dedicata di site_generations (mai i pool, AC-235-1).
 * @param params i segmenti di rotta, non fidati.
 * @returns locale vincolato e il traduttore del namespace 'preview'.
 */
export async function enterPreview(params: {
  locale: string;
  siteId: string;
}): Promise<PreviewEntry> {
  const { locale } = await enterSiteRoute(params, {
    errorLabel: 'preview: elenco siti non disponibile',
  });

  const t = await getTranslations({ locale, namespace: 'preview' });

  return { locale, t };
}
