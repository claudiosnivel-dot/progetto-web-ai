import { notFound, redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { getUser } from '@/data/supabase-ssr';
import { listSites, type SiteSummary } from '@/data/sites';
import { routing } from '@/i18n/routing';

// T-150 / T-152 — L'INGRESSO alle rotte di onboarding, in UNA sola sede.
//
// PERCHE' esiste: la catena era scritta due volte, identica, nella pagina di T-150 e in
// quella di Rivedi&conferma (T-152) — perche' la seconda doveva "seguire la stessa catena,
// non una variante". Ed e' proprio quello il problema: una catena di SICUREZZA duplicata e'
// il modo classico in cui una delle due copie, alla prossima modifica, perde un controllo e
// nessuno se ne accorge. Il controllo dead-code del checkpoint l'ha misurata come 4
// duplicazioni fra i due file. Questa non e' un'astrazione speculativa: e' la stessa
// de-duplicazione fatta in T-121 per i tetti di P1-D17, cioe' togliere copie di una
// proprieta' che DEVE essere una sola.
//
// COSA e' condiviso e cosa NON lo e': qui sta solo cio' che nelle due rotte era IDENTICO.
// La lettura del brief resta in ciascuna pagina, perche' le due la trattano in modo
// DELIBERATAMENTE diverso: la rotta di T-150 tollera `ok:false` (i pannelli partono da un
// brief vuoto), mentre Rivedi&conferma LANCIA — la' un guasto di lettura reso come recap
// vuoto permetterebbe di confermare un brief mai visto. Unificarla appiattirebbe una
// differenza voluta, e sarebbe estrarre l'apparentemente simile invece dell'identico.
//
// ORDINE dei controlli, che e' la parte che conta:
//  1. il `locale` del segmento e' input controllabile dal client → vincolato all'allowlist
//     `routing.locales` PRIMA di finire in QUALUNQUE destinazione (come T-044). Mai il
//     valore grezzo in un path.
//  2. identita' server-side (`getUser`, che rivalida il token): assente → redirect al login
//     con destinazione interna FISSA. E' difesa in profondita': il middleware (T-041, esteso
//     al segmento `onboarding` da T-150) reindirizza gia', ma non e' nel percorso quando la
//     pagina e' invocata come funzione — e il matcher esclude i pathname che contengono un
//     punto, quindi per un siteId del genere questa e' l'UNICA guardia.
//  3. proprieta' del sito via `listSites` (RLS-backed) PRIMA di ogni lettura del brief:
//     del sito altrui non si legge nulla (P1-D21).
//
// GUASTO NOSTRO != NON TROVATO. Un `ok:false` di `listSites` (500 dal DB, o 401 se la
// sessione muore fra `getUser` e questa lettura) non dice NULLA sull'esistenza del sito:
// trattarlo come "sito assente" farebbe uscire un notFound(), cioe' presenterebbe un guasto
// transitorio come un 404 definitivo e manderebbe l'utente a cercare l'errore nell'URL.
// La distinzione introdotta e' SOLO fra "errore nostro" e "non trovato": **"sito non tuo" e
// "sito inesistente" restano la STESSA risposta**, perche' passano entrambi dall'unico
// notFound() qui sotto — distinguerli renderebbe la rotta un oracolo di enumerazione dei
// site_id altrui, che P1-D21 vieta.
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
  const locale = hasLocale(routing.locales, params.locale)
    ? params.locale
    : routing.defaultLocale;

  const user = await getUser();
  if (!user) {
    // Destinazione interna FISSA con locale dall'allowlist (anti open-redirect).
    redirect(`/${locale}/login`);
  }

  const sitesResult = await listSites();
  if (!sitesResult.ok) {
    // Messaggio GENERICO: nessun siteId e nessuno stato interno, che finirebbero nei log
    // del server e, in sviluppo, nella pagina d'errore.
    throw new Error('onboarding: elenco siti non disponibile');
  }
  // Uguaglianza ESATTA dell'id: un confronto rilassato (per prefisso) lascerebbe aprire
  // l'onboarding di un sito diverso dal proprio. E' pinnato da una fixture il cui id e'
  // prefisso di uno posseduto.
  const site = sitesResult.sites.find((candidate) => candidate.id === params.siteId);
  if (!site) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  return { locale, site, t, tNav };
}
