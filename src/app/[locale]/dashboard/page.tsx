import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { CreateSiteForm } from '@/ui/sites/CreateSiteForm';
import { SiteRow } from '@/ui/sites/SiteRow';
import { getUser } from '@/data/supabase-ssr';
import { listSites, createSiteForm } from '@/data/sites';

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

type DashboardPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { locale } = await params;

  const user = await getUser();
  if (!user) {
    // Destinazione interna FISSA (anti open-redirect); locale corrente preservato.
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const result = await listSites();
  const sites = result.ok ? result.sites : [];

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

        {sites.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('emptyState')}</p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {sites.map((site) => (
              <SiteRow key={site.id} site={site} labels={rowLabels} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
