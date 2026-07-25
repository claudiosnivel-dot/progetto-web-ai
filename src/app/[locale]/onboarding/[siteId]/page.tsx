import { AppShell } from '@/ui/shell/AppShell';
import { OnboardingWorkspace } from '@/ui/onboarding/OnboardingWorkspace';
import { getBrief } from '@/data/briefs';
import { emptyBrief } from '@/domain/onboarding/brief';
import { enterOnboarding } from './guard';

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
  // La catena di guardie (locale dall'allowlist → identita' → proprieta' del sito via
  // listSites, P1-D21) vive in UNA sede condivisa con Rivedi&conferma: vedi ./guard.
  // Duplicarla era il modo di farle perdere un controllo alla prossima modifica.
  const { locale, site, t, tNav } = await enterOnboarding({ locale: rawLocale, siteId });

  // La LETTURA del brief resta qui e non nella guardia, perche' questa rotta la tratta in
  // modo deliberatamente diverso da Rivedi&conferma: qui un `ok:false` e' tollerato (i
  // pannelli di T-151 partono da un brief vuoto e l'utente puo' comunque lavorare), la'
  // LANCIA — un recap vuoto renderebbe confermabile un brief mai visto.
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
