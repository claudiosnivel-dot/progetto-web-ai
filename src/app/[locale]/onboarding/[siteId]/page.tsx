import { notFound, redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { OnboardingWorkspace } from '@/ui/onboarding/OnboardingWorkspace';
import { getUser } from '@/data/supabase-ssr';
import { listSites } from '@/data/sites';
import { getBrief } from '@/data/briefs';
import { emptyBrief } from '@/domain/onboarding/brief';
import { routing } from '@/i18n/routing';

// T-150 (macrotask onboarding-ui, P1) — rotta localizzata e protetta
// /{locale}/onboarding/{siteId}, resa dentro AppShell (T-022). Carica lo STATO
// CORRENTE del brief via getBrief (T-123) e lo consegna ai pannelli di T-151. La
// schermata Rivedi&conferma e' T-152, il CTA dalla dashboard e' T-153 — qui non ci sono.
//
// T-151 — MONTAGGIO dei pannelli. Il riepilogo statico che stava qui era il segnaposto
// dichiarato di T-150 e ora e' sostituito da <OnboardingWorkspace>, che e' l'UNICO punto
// da cui i componenti di src/ui/onboarding sono raggiungibili dall'applicazione: senza
// questa riga il build li escludeva dal bundle (assenti da .next/static) e l'unica cosa
// che li eseguiva era il loro test.
//  - La pagina resta un SERVER COMPONENT. I dati sono caricati QUI (dietro le guardie
//    sotto) e passati come props a un componente client: rendere 'use client' questo file
//    tirerebbe getUser/listSites/getBrief nel grafo del bundle browser e smonterebbe le
//    guardie che seguono.
//  - Le stringhe dei pannelli arrivano da next-intl LATO CLIENT (useTranslations). Il
//    provider e' NextIntlClientProvider in src/app/[locale]/layout.tsx, che avvolge ogni
//    rotta sotto /[locale] — quindi anche questa: verificato leggendo il layout, non
//    dedotto.
//  - `initialBrief` non e' nullable: un sito PROPRIO senza brief ancora creato
//    (getBrief → brief:null, caso legittimo) parte da emptyBrief(locale), che e' lo
//    stesso valore da cui parte l'endpoint di turno. Cosi' il pannello e' editabile da
//    subito — altrimenti il primo dato di un sito nuovo potrebbe entrare solo dalla chat.
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
//    una pagina ostile via url-import). Questo file non lo rende piu' da se': lo passa
//    al pannello di T-151, che lo mette SOLO in `value` di input e in nodi di testo JSX
//    — mai in innerHTML, mai in un href/src. Pinnato dall'oracolo di T-151.

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

        <OnboardingWorkspace siteId={siteId} initialBrief={brief ?? emptyBrief(locale)} />
      </div>
    </AppShell>
  );
}
