import { notFound, redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { ReviewConfirm } from '@/ui/onboarding/ReviewConfirm';
import { getUser } from '@/data/supabase-ssr';
import { listSites } from '@/data/sites';
import { getBrief } from '@/data/briefs';
import { emptyBrief } from '@/domain/onboarding/brief';
import { routing } from '@/i18n/routing';

// T-152 (macrotask onboarding-ui, P1) — step di rotta della schermata Rivedi&conferma:
// /{locale}/onboarding/{siteId}/review, reso dentro AppShell (T-022). Carica lo stato
// corrente del brief via getBrief (T-123) e lo consegna a <ReviewConfirm>, che e' l'UNICO
// punto da cui quel componente e' raggiungibile dall'applicazione (T151-V05: senza questa
// riga il build lo escluderebbe dal bundle e l'unica cosa che lo eseguirebbe sarebbe il
// suo test).
//
// La pagina resta un SERVER COMPONENT: i dati sono caricati QUI, dietro le guardie, e
// passati come props a un componente client. Un 'use client' su questo file tirerebbe
// getUser/listSites/getBrief nel grafo del bundle browser e smonterebbe le guardie.
//
// CATENA DI GUARDIE: e' la STESSA della pagina di T-150 (../page.tsx), nello stesso
// ordine, e non una variante —
//   1) middleware (T-041, esteso da T-150 a `onboarding` e a OGNI sotto-rotta:
//      `^/(it|es)/(?:dashboard|onboarding)(?:/.*)?$`, quindi anche /review);
//   2) getUser() server-side: non e' ridondanza inutile, ed esiste un caso CONCRETO in cui
//      e' l'unica difesa — il matcher del middleware esclude ogni pathname che contenga un
//      punto, quindi per /it/onboarding/a.b/review la guardia di route non parte affatto;
//   3) PROPRIETA' DEL SITO via listSites (P1-D21) PRIMA di leggere il brief: `brief===null`
//      non distingue "sito mio senza brief" da "sito di un altro tenant filtrato dalla
//      RLS", quindi non puo' fare da gate. "Sito non tuo" e "sito inesistente" ricevono la
//      STESSA risposta (l'unico notFound() qui sotto): distinguerli renderebbe la rotta un
//      oracolo di enumerazione dei site_id altrui;
//   4) getBrief (RLS attiva, nessuna service_role nel percorso — R7).
// La duplicazione della catena rispetto a ../page.tsx e' deliberata ed e' la convenzione di
// casa (ogni pagina protetta ri-verifica l'identita': dashboard, onboarding, questa):
// estrarla in un helper condiviso avrebbe toccato una rotta chiusa e verde. Il prezzo — due
// copie che potrebbero divergere — e' pagato con un oracolo: tests/onboarding-review.test.tsx
// pinna OGNI anello su QUESTA rotta, non solo su quella di T-150.
//
// GUASTO NOSTRO != NON TROVATO: un `ok:false` di listSites (500 del DB, o 401 se la
// sessione muore fra getUser e questa lettura) non dice NULLA sull'esistenza del sito;
// trattarlo come "sito assente" presenterebbe un guasto transitorio come un 404 definitivo.
// Si lancia, cosi' resta un errore server, con messaggio GENERICO (nessun siteId, che
// finirebbe nei log e, in sviluppo, nella pagina d'errore).
//
// Sicurezza (A01:2025): l'autorizzazione della CONFERMA non e' qui e non e' nella UI — e'
// la RLS dentro confirmBrief (T-123). Questa rotta protegge la lettura; nascondere elementi
// di UI non protegge niente. Il segmento [locale] e' input controllabile dal client:
// vincolato all'allowlist routing.locales PRIMA di essere interpolato in qualunque
// destinazione (come T-044), mai il valore grezzo in un path.

type ReviewPageProps = {
  params: Promise<{ locale: string; siteId: string }>;
};

export default async function OnboardingReviewPage({ params }: ReviewPageProps) {
  const { locale: rawLocale, siteId } = await params;
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;

  const user = await getUser();
  if (!user) {
    // Destinazione interna FISSA con locale dall'allowlist (anti open-redirect).
    redirect(`/${locale}/login`);
  }

  const sitesResult = await listSites();
  if (!sitesResult.ok) {
    throw new Error('onboarding: elenco siti non disponibile');
  }
  const site = sitesResult.sites.find((candidate) => candidate.id === siteId);
  if (!site) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: 'onboarding' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const briefResult = await getBrief(siteId);
  // GUASTO NOSTRO != BRIEF ASSENTE, la stessa distinzione che questa pagina fa già su
  // listSites e che la pagina di T-150 ha introdotto. Un `ok:false` di getBrief e' 401 o
  // 500 (T-123): non dice NULLA sul contenuto del brief. Trattarlo come "brief da
  // compilare" — cioe' renderlo come emptyBrief — presentava un guasto di lettura come una
  // schermata di revisione VUOTA: l'utente poteva confermare, con la conferma esplicita, un
  // brief che non ha mai visto, e confirmBrief avrebbe portato a status='confirmed' un
  // contenuto ignoto (che e' l'artefatto che P2 consumera'). Si lancia, cosi' il guasto
  // resta un errore server invece di una schermata che mente.
  //
  // La distinzione introdotta e' SOLO fra "errore nostro" e "brief non trovato": "sito non
  // tuo" e "sito inesistente" restano indistinguibili (P1-D21) perche' passano entrambi
  // dall'unico notFound() qui sopra, e getBrief non ha uno status 404 da cui si possa
  // dedurre l'esistenza di un brief altrui — il cross-tenant filtrato dalla RLS torna
  // `ok:true, brief:null`, esattamente come un sito proprio senza brief.
  if (!briefResult.ok) {
    // Messaggio GENERICO: nessun siteId e nessuno status, che finirebbero nei log e, in
    // sviluppo, nella pagina d'errore.
    throw new Error('onboarding: brief non disponibile');
  }
  // `brief === null` resta un caso LEGITTIMO, non un errore: e' il sito PROPRIO senza brief
  // ancora creato. Parte da emptyBrief(locale), lo stesso valore da cui parte la pagina di
  // T-150, cosi' il recap e' compilabile da subito; la conferma di un brief che non esiste
  // la rifiuta confirmBrief con 404 (il gate, non la UI).
  const brief = briefResult.brief ?? emptyBrief(locale);

  return (
    <AppShell navItems={[{ href: `/${locale}/dashboard`, label: tNav('dashboard') }]}>
      <div className="mx-auto flex max-w-2xl flex-col gap-lg">
        <h1 className="text-lg font-semibold text-foreground">{t('review.title')}</h1>
        <p className="text-sm text-muted-foreground">{site.name}</p>

        <ReviewConfirm siteId={siteId} brief={brief} locale={locale} />
      </div>
    </AppShell>
  );
}
