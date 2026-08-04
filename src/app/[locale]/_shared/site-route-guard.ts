import { notFound, redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getUser } from '@/data/supabase-ssr';
import { listSites, type SiteSummary } from '@/data/sites';
import { routing } from '@/i18n/routing';

// macrotask generation-ui, P2 — LA CATENA DI INGRESSO alle rotte-pagina che rendono un sito
// posseduto, in UNA sola sede. Prima viveva scritta a mano, IDENTICA, in enterOnboarding
// (T-150/T-152), enterGenerate (T-230) ed enterPreview (T-235): tre copie della STESSA catena
// di SICUREZZA, che e' il modo classico in cui una copia, alla prossima modifica, perde un
// controllo senza che nessuno se ne accorga (misurato come duplicazione dal controllo dead-code
// del checkpoint). Qui sta SOLO cio' che nelle tre rotte era IDENTICO — la catena; cio' che
// DIVERGE (i namespace i18n caricati, e la forma del valore di ritorno) resta in ciascuna guardia
// e viene composto DOPO questa chiamata.
//
// ORDINE dei controlli, che e' la parte che conta:
//  1. il `locale` del segmento e' input controllabile dal client -> vincolato all'allowlist
//     `routing.locales` PRIMA di finire in QUALUNQUE destinazione. Mai il valore grezzo in un
//     path (difetto T-102/T-153).
//  2. identita' server-side (`getUser`, che rivalida il token): assente -> redirect al login con
//     destinazione interna FISSA (anti open-redirect). Difesa in profondita': il middleware
//     reindirizza gia', ma non e' nel percorso quando la pagina e' invocata come funzione, e il
//     matcher esclude i pathname con un punto — per un siteId del genere questa e' l'UNICA guardia.
//  3. proprieta' del sito via `listSites` (RLS-backed): del sito altrui non si legge nulla (P1-D21).
//
// GUASTO NOSTRO != NON TROVATO. Un `ok:false` di `listSites` (500 dal DB, o 401 se la sessione
// muore fra `getUser` e questa lettura) non dice nulla sull'esistenza del sito: e' un errore, non
// un 404. La distinzione e' SOLO fra "errore nostro" e "non trovato": **"sito non tuo" e "sito
// inesistente" restano la STESSA risposta**, perche' passano entrambi dall'unico `notFound()` qui
// sotto — distinguerli renderebbe la rotta un oracolo di enumerazione dei site_id altrui (P1-D21).

/** Il locale vincolato all'allowlist e il sito POSSEDUTO che la catena ha accertato. */
type SiteRouteEntry = {
  locale: (typeof routing.locales)[number];
  site: SiteSummary;
};

/**
 * Applica la catena di ingresso comune (locale vincolato -> identita' -> proprieta' del sito) a
 * una rotta-pagina, e non ritorna finche' non e' passata: senza sessione fa `redirect` al login,
 * su un guasto di `listSites` LANCIA, su un sito non proprio/inesistente fa `notFound`. Chi chiama
 * riceve il locale gia' vincolato e il proprio sito, e da li' carica i cataloghi che gli servono.
 *
 * @param params i segmenti di rotta, non fidati.
 * @param opts `errorLabel` — il messaggio GENERICO dell'errore di `listSites` (nessun siteId ne'
 *   stato interno nei log del server), proprio della rotta chiamante.
 * @returns locale vincolato e sito posseduto.
 */
export async function enterSiteRoute(
  params: { locale: string; siteId: string },
  opts: { errorLabel: string },
): Promise<SiteRouteEntry> {
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
    // Messaggio GENERICO: nessun siteId e nessuno stato interno nei log del server.
    throw new Error(opts.errorLabel);
  }
  // Uguaglianza ESATTA dell'id: un confronto per prefisso lascerebbe aprire la rotta di un sito
  // diverso dal proprio. Pinnato da una fixture il cui id e' prefisso di uno posseduto.
  const site = sitesResult.sites.find((candidate) => candidate.id === params.siteId);
  if (!site) {
    notFound();
  }

  return { locale, site };
}
