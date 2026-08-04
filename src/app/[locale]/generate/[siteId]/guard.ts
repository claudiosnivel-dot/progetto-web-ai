import { getTranslations } from 'next-intl/server';
import { enterSiteRoute } from '@/app/[locale]/_shared/site-route-guard';
import { type SiteSummary } from '@/data/sites';
import { routing } from '@/i18n/routing';

// T-230 (macrotask generation-ui, P2) — L'INGRESSO alla rotta /generate.
//
// STESSA CATENA DI SICUREZZA di /onboarding e /preview, ora in UNA sola sede (`enterSiteRoute`) e
// NON ricopiata. Cio' che DIVERGE resta qui: /generate carica DUE cataloghi ('generate' e 'nav')
// e ritorna anche il `site` posseduto (la pagina lo usa), mentre l'anteprima no. La catena — locale
// vincolato, identita', proprieta' del sito, stesso `notFound()` per non-tuo/inesistente — e'
// quella comune, invariata (P1-D21, AC-230-2).
//
// La pagina tratta la lettura del brief in modo DELIBERATAMENTE diverso (un guasto di lettura e'
// uno STATO D'ERRORE esplicito, non un throw ne' un "brief povero", AC-230-4): per questo il brief
// NON entra nella catena comune e resta alla pagina.
type GenerateEntry = {
  locale: (typeof routing.locales)[number];
  site: SiteSummary;
  t: Awaited<ReturnType<typeof getTranslations>>;
  tNav: Awaited<ReturnType<typeof getTranslations>>;
};

/**
 * Apre la rotta /generate: vincola il locale, esige l'identita', accerta la proprieta' del sito
 * (catena comune `enterSiteRoute`) e carica i cataloghi. Non legge il brief: lo fa la pagina.
 * @param params i segmenti di rotta, non fidati.
 * @returns locale vincolato, sito posseduto e i due traduttori.
 */
export async function enterGenerate(params: {
  locale: string;
  siteId: string;
}): Promise<GenerateEntry> {
  const { locale, site } = await enterSiteRoute(params, {
    errorLabel: 'generate: elenco siti non disponibile',
  });

  const t = await getTranslations({ locale, namespace: 'generate' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  return { locale, site, t, tNav };
}
