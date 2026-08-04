import { getTranslations } from 'next-intl/server';
import { enterSiteRoute } from '@/app/[locale]/_shared/site-route-guard';
import { type SiteSummary } from '@/data/sites';
import { routing } from '@/i18n/routing';

// T-150 / T-152 — L'INGRESSO alle rotte di onboarding.
//
// PERCHE' esiste: la catena era scritta due volte, identica, nella pagina di T-150 e in
// quella di Rivedi&conferma (T-152). Una catena di SICUREZZA duplicata e' il modo classico
// in cui una delle copie, alla prossima modifica, perde un controllo e nessuno se ne accorge.
// La stessa catena serve poi a /generate (T-230) e /preview (T-235): tutte e tre passano ora
// dall'unica sede `enterSiteRoute` (nessuna copia della catena in questo file).
//
// COSA e' condiviso e cosa NON lo e': in `enterSiteRoute` sta solo cio' che nelle rotte era
// IDENTICO (locale vincolato -> identita' -> proprieta' del sito, con lo stesso notFound() per
// non-tuo/inesistente). La lettura del brief resta in ciascuna pagina, perche' le due la
// trattano in modo DELIBERATAMENTE diverso: la rotta di T-150 tollera `ok:false` (i pannelli
// partono da un brief vuoto), mentre Rivedi&conferma LANCIA — la' un guasto di lettura reso
// come recap vuoto permetterebbe di confermare un brief mai visto. Cio' che DIVERGE qui e' il
// catalogo i18n: onboarding carica 'onboarding' e 'nav', e li compone dopo la catena comune.
type OnboardingEntry = {
  locale: (typeof routing.locales)[number];
  site: SiteSummary;
  t: Awaited<ReturnType<typeof getTranslations>>;
  tNav: Awaited<ReturnType<typeof getTranslations>>;
};

/**
 * Apre una rotta di onboarding: vincola il locale, esige l'identita', accerta la
 * proprieta' del sito e carica i cataloghi. Non legge il brief: lo fa la pagina.
 * @param params i segmenti di rotta, non fidati.
 * @returns locale vincolato, sito posseduto e i due traduttori.
 */
export async function enterOnboarding(params: {
  locale: string;
  siteId: string;
}): Promise<OnboardingEntry> {
  const { locale, site } = await enterSiteRoute(params, {
    errorLabel: 'onboarding: elenco siti non disponibile',
  });

  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  return { locale, site, t, tNav };
}
