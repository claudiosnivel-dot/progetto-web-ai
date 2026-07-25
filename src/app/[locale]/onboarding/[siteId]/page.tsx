import { notFound, redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { getUser } from '@/data/supabase-ssr';
import { listSites } from '@/data/sites';
import { getBrief } from '@/data/briefs';
import { routing } from '@/i18n/routing';

// T-150 (macrotask onboarding-ui, P1) — rotta localizzata e protetta
// /{locale}/onboarding/{siteId}, resa dentro AppShell (T-022). Rende lo STATO
// CORRENTE del brief caricato via getBrief (T-123). E' il segnaposto del flusso: i
// pannelli chat/brief live/import sono T-151, la schermata Rivedi&conferma e' T-152,
// il CTA dalla dashboard e' T-153 — qui non ci sono.
//
// Sicurezza (A01:2025):
//  - la rotta e' protetta a DUE livelli: la guardia di route nel middleware (T-041,
//    estesa a /{locale}/onboarding da T-150) e questo getUser server-side. Il secondo
//    non e' ridondanza inutile, ed esiste un caso CONCRETO in cui e' l'unica difesa: il
//    matcher del middleware (`/((?!api|_next|_vercel|.*\..*).*)`) esclude ogni pathname
//    che contenga un punto, quindi per /it/onboarding/a.b la guardia di route non parte
//    affatto. Pinnato da un test; e non si affida nulla al nascondere elementi di UI.
//  - PROPRIETA' DEL SITO (P1-D21): getBrief ritorna brief:null sia per "sito mio
//    senza brief" (legittimo) sia per "sito di un altro tenant" (filtrato dalla RLS),
//    quindi `brief === null` NON distingue i due casi e non puo' fare da gate. La
//    proprieta' si accerta con listSites, che e' RLS-backed: un siteId che non e' fra
//    i propri siti riceve la STESSA risposta di un sito inesistente (404), cosi' la
//    rotta non diventa un oracolo di enumerazione dei siti altrui (stessa logica di
//    P1-D16). Il controllo sta PRIMA di getBrief: del sito altrui non si legge nulla.
//  - R7: nessuna service_role nel percorso; listSites/getBrief usano il client con
//    sessione (RLS attiva).
//  - Il segmento [locale] e' input controllabile dal client: e' vincolato
//    all'allowlist routing.locales PRIMA di essere interpolato in una destinazione
//    (come il route handler di T-044) — mai il valore grezzo in un path.
//  - Il testo del brief e' input NON FIDATO in rendering (§7 p.4: puo' arrivare da
//    una pagina ostile via url-import). Qui finisce SOLO in nodi di testo JSX, mai in
//    innerHTML ne' in un href. La sanitizzazione per gli usi ricchi e' T-151/T-152.

type OnboardingPageProps = {
  params: Promise<{ locale: string; siteId: string }>;
};

export default async function OnboardingPage({ params }: OnboardingPageProps) {
  const { locale: rawLocale, siteId } = await params;
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;

  const user = await getUser();
  if (!user) {
    // Destinazione interna FISSA con locale dall'allowlist (anti open-redirect).
    redirect(`/${locale}/login`);
  }

  // Proprieta' del sito prima di qualunque lettura del brief (vedi P1-D21 sopra).
  //
  // GUASTO NOSTRO ≠ NON TROVATO. Un `ok:false` di listSites (500 dal DB, o 401 se la
  // sessione muore fra getUser e questa lettura) non dice NULLA sull'esistenza del sito:
  // trattarlo come "sito assente" faceva uscire un notFound(), cioe' presentava un guasto
  // transitorio di infrastruttura come un 404 definitivo — un'affermazione falsa su un
  // dato che non si e' potuto leggere, che manda l'utente a cercare l'errore nell'URL.
  // L'endpoint /api i due casi li distingueva gia' (500 'unavailable' vs 404
  // 'not-found'); qui si lancia, cosi' il guasto resta un errore server (500 via error
  // boundary di Next) invece di una risposta che mente.
  //
  // La distinzione introdotta e' SOLO fra "errore nostro" e "non trovato": "sito non tuo"
  // e "sito inesistente" restano la STESSA risposta, perche' passano entrambi dall'unico
  // notFound() qui sotto — distinguerli renderebbe la pagina un oracolo di enumerazione
  // dei site_id altrui, che P1-D21 vieta.
  const sitesResult = await listSites();
  if (!sitesResult.ok) {
    // Messaggio GENERICO: nessun siteId e nessuno stato interno, che finirebbero nei log
    // del server e, in sviluppo, nella pagina d'errore.
    throw new Error('onboarding: elenco siti non disponibile');
  }
  const site = sitesResult.sites.find((candidate) => candidate.id === siteId);
  if (!site) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const briefResult = await getBrief(siteId);
  const brief = briefResult.ok ? briefResult.brief : null;
  const status = briefResult.ok ? briefResult.status : null;

  // Solo i campi di TESTO LIBERO e contatto. vertical e primary_goal sono enum e
  // renderne il valore grezzo ('salone_studio') non sarebbe localizzato: le etichette
  // dei valori enum arrivano col pannello brief di T-151, che e' la sede del rendering
  // completo. I campi vuoti non si mostrano: sono i buchi che la chat deve riempire.
  const entries: [string, string | undefined][] = brief
    ? [
        [t('fields.businessName'), brief.business_name],
        [t('fields.description'), brief.description],
        [t('fields.address'), brief.address],
        [t('fields.phone'), brief.phone],
        [t('fields.whatsapp'), brief.whatsapp],
        [t('fields.email'), brief.email],
      ]
    : [];
  const fields = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  );

  return (
    <AppShell navItems={[{ href: `/${locale}/dashboard`, label: tNav('dashboard') }]}>
      <div className="mx-auto flex max-w-2xl flex-col gap-lg">
        <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{site.name}</p>

        {status !== null ? (
          <p className="text-sm text-muted-foreground">
            {t('statusLabel')}
            {': '}
            <span className="font-medium text-foreground">
              {status === 'confirmed' ? t('statusConfirmed') : t('statusDraft')}
            </span>
          </p>
        ) : null}

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('briefEmpty')}</p>
        ) : (
          <dl className="flex flex-col gap-sm">
            {fields.map(([label, value]) => (
              <div key={label} className="flex flex-col">
                <dt className="text-sm font-medium text-foreground">{label}</dt>
                <dd className="text-sm text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </AppShell>
  );
}
