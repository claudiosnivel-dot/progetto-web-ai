import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { CreateSiteForm } from '@/ui/sites/CreateSiteForm';
import { SiteRow } from '@/ui/sites/SiteRow';
import { getUser } from '@/data/supabase-ssr';
import { listSites, createSiteForm } from '@/data/sites';
import { getBrief } from '@/data/briefs';
import { routing } from '@/i18n/routing';

// T-102 — Scheletro dashboard autenticato e localizzato (/it, /es). Elenca i siti
// dell'account dell'utente (listSites) e permette di crearne uno (createSiteForm),
// montato dentro AppShell (T-022) con le stringhe next-intl (T-081). È solo lo
// scheletro segnaposto: nessun editor, nessuna generazione AI.
//
// Sicurezza (A01:2025): la rotta è protetta lato server. La guardia di route
// (middleware T-041) reindirizza già le richieste non autenticate; qui si
// ri-verifica l'identità server-side (getUser, RLS-safe) e, in sua assenza, si
// reindirizza al login del locale — difesa in profondità, non affidata alla sola
// UI. R7: nessuna service_role nel percorso di pagina; i dati passano da
// listSites/createSite (client con sessione, RLS attiva).
//
// T-153 — AGGANCIO ALL'ONBOARDING. Ogni riga porta un CTA verso
// /{locale}/onboarding/{siteId} (rotta di T-150) e, se il brief del sito e'
// status='confirmed', un badge SEGNAPOSTO "pronto per generare": la generazione e' P2,
// quindi il badge NON e' un controllo e non linka nulla.
//
// COSTO DICHIARATO (scelta esplicita, non un dettaglio nascosto): lo stato del brief e'
// letto con `getBrief(siteId)` SITO PER SITO, cioe' **N query per ogni render della
// dashboard** (N = numero di siti dell'account), eseguite in parallelo con Promise.all
// ma comunque N round-trip verso PostgREST. Il blueprint ammette `getBrief` oppure una
// join; si e' scelto getBrief perche' l'alternativa in UNA query (leggere gli status di
// tutti i siti dell'account con un solo select su site_briefs) richiederebbe una NUOVA
// funzione dati in src/data/briefs.ts, che questo task non puo' toccare. La proposta e'
// riportata al posto di essere applicata. Oggi N e' piccolo (un micro-business ha 1-3
// siti) e la lettura resta RLS-backed, quindi il costo e' accettato consapevolmente.

type DashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale: rawLocale } = await params;
  // Il segmento [locale] e' input controllabile dal client: si vincola all'allowlist
  // routing.locales PRIMA di interpolarlo in qualunque destinazione (href del CTA e
  // redirect), come fa la rotta di T-150. Mai il valore grezzo in un percorso.
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;

  const user = await getUser();
  if (!user) {
    // Destinazione interna FISSA (anti open-redirect); locale corrente preservato.
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const result = await listSites();
  // GUASTO DI LETTURA ≠ NESSUN SITO. Un `listSites` che ritorna ok:false (401 se la
  // sessione muore fra getUser e la lettura, 500 dal DB) non dice che l'utente non ha
  // siti: renderlo come `emptyState` ("non hai ancora creato nessun sito") puo' spingerlo
  // a ricrearne uno che esiste gia'. E' lo stesso difetto corretto in T-152 e, poche
  // righe sotto, per i brief — questa riga e' pre-esistente a T-102 e lasciarla asimmetrica
  // dentro la stessa funzione sarebbe una svista dichiarata a meta'.
  const sitesUnavailable = !result.ok;
  const sites = result.ok ? result.sites : [];

  // Stato del brief per riga. L'accoppiamento sito↔brief e' STRUTTURALE (la coppia nasce
  // insieme), non per indice o per confronto di id a valle: due siti i cui id sono in
  // relazione di prefisso non possono scambiarsi lo stato.
  //
  // GUASTO DI LETTURA ≠ NESSUN BRIEF (stesso difetto corretto in T-152). Un `ok:false`
  // (401 se la sessione muore fra getUser e la lettura, 500 dal DB) non dice NULLA sullo
  // stato del brief: renderlo come "nessun badge" e basta lo farebbe passare per un draft.
  // Qui non si tira: la dashboard non e' l'onboarding, un sito non leggibile non deve far
  // fallire l'elenco degli altri; la riga DICHIARA che lo stato non e' disponibile e il CTA
  // resta (il link non e' un gate — l'autorizzazione e' a valle: T-150 + RLS).
  const rows = await Promise.all(
    sites.map(async (site) => ({ site, brief: await getBrief(site.id) })),
  );

  // Etichette (localizzate) dei controlli rinomina/elimina della riga (T-105).
  const rowLabels = {
    rename: t('actions.rename'),
    save: t('actions.save'),
    delete: t('actions.delete'),
    confirmDelete: t('actions.confirmDelete'),
    cancel: t('actions.cancel'),
  };

  return (
    <AppShell
      navItems={[{ href: `/${locale}/dashboard`, label: tNav('dashboard') }]}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-lg">
        <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>

        <CreateSiteForm
          action={createSiteForm.bind(null, locale)}
          createLabel={t('createSite')}
          nameLabel={t('siteName')}
        />

        {sitesUnavailable ? (
          <p className="text-sm text-muted-foreground">{t('sitesUnavailable')}</p>
        ) : sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {rows.map(({ site, brief }) => (
              <SiteRow
                key={site.id}
                site={site}
                labels={rowLabels}
                onboarding={{
                  // Destinazione costruita da NOI: locale dall'allowlist + siteId
                  // codificato, cosi' un id con caratteri strani (slash, punti) non
                  // produce segmenti aggiuntivi nel percorso. Nessun testo del brief
                  // finisce mai in un href.
                  href: `/${locale}/onboarding/${encodeURIComponent(site.id)}`,
                  ctaLabel: t('onboarding.cta'),
                  readyBadge:
                    brief.ok && brief.status === 'confirmed'
                      ? t('onboarding.readyToGenerate')
                      : undefined,
                  statusUnavailable: brief.ok ? undefined : t('onboarding.statusUnavailable'),
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
