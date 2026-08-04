import { redirect } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { AppShell } from '@/ui/shell/AppShell';
import { CreateSiteForm } from '@/ui/sites/CreateSiteForm';
import { SiteRow } from '@/ui/sites/SiteRow';
import { getUser } from '@/data/supabase-ssr';
import { listSites, createSiteForm } from '@/data/sites';
import { getBrief } from '@/data/briefs';
import { listGenerationStatuses, type GenerationStatus } from '@/data/generations';
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
// /{locale}/onboarding/{siteId} (rotta di T-150).
//
// T-236 — AGGANCIO ALLA GENERAZIONE. Il badge SEGNAPOSTO "pronto per generare" di T-153 e'
// SOSTITUITO dallo STATO REALE della generazione per sito, letto con listGenerationStatuses()
// in UNA sola query (nessun N+1: non si ripete il difetto di P1 §7 p.15, ne' lo si legge sito
// per sito). La CTA di generazione per riga dipende dallo stato: nessuna generazione → genera;
// ready/chosen (o generating) → riprendi; complete → vedi l'anteprima; failed → riprova. La
// destinazione e' /{locale}/generate (T-230) o /{locale}/preview (T-235), costruita da NOI con
// il locale dell'allowlist e il siteId codificato — mai il locale grezzo del path (difetto
// T-102/T-153) e mai testo del brief in un href. Un guasto di lettura (di listSites O di
// listGenerationStatuses) NON rende lo stato vuoto "non hai ancora creato nessun sito": e' la
// lezione di T-153, che un 500 non deve travestirsi da assenza (un utente con siti reali
// potrebbe ricrearne uno che esiste gia').
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

// LA CTA DI GENERAZIONE per uno stato, DERIVATA (pura): quale etichetta i18n e quale rotta.
// `null` = il sito non e' mai stato generato → genera. 'generating' e' raggruppato con
// ready/chosen (una generazione in corso o gia' pronta → riprendi da /generate); lo status e'
// esaustivo sul vocabolario di GenerationStatus + null, quindi il default non e' un buco ma la
// sola voce residua (nessuna generazione). Le chiavi sono letterali cosi' `t(...)` le accetta
// come chiavi valide del catalogo 'dashboard' (stessa forma di T-230).
type GenerationCtaLabelKey =
  | 'generation.generate'
  | 'generation.resume'
  | 'generation.preview'
  | 'generation.retry';

type GenerationCtaSpec = { labelKey: GenerationCtaLabelKey; route: 'generate' | 'preview' };

function generationCtaSpec(status: GenerationStatus | null): GenerationCtaSpec {
  switch (status) {
    case 'complete':
      return { labelKey: 'generation.preview', route: 'preview' };
    case 'failed':
      return { labelKey: 'generation.retry', route: 'generate' };
    case 'ready':
    case 'chosen':
    case 'generating':
      return { labelKey: 'generation.resume', route: 'generate' };
    default:
      return { labelKey: 'generation.generate', route: 'generate' };
  }
}

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

  // Le due letture in PARALLELO: l'elenco dei siti e lo stato di generazione di TUTTI i siti
  // in UNA sola query (listGenerationStatuses, T-203). Non c'e' dipendenza fra le due, quindi
  // non si aspetta la prima per lanciare la seconda.
  const [result, statusesResult] = await Promise.all([listSites(), listGenerationStatuses()]);

  // GUASTO DI LETTURA ≠ NESSUN SITO. Un `ok:false` (401 se la sessione muore fra getUser e la
  // lettura, 500 dal DB) non dice che l'utente non ha siti: renderlo come `emptyState` ("non
  // hai ancora creato nessun sito") puo' spingerlo a ricrearne uno che esiste gia' (lezione di
  // T-152/T-153). Vale per ENTRAMBE le letture: anche un guasto della lettura di STATO rende
  // uno stato d'errore esplicito, non un elenco vuoto (AC-236-2). La contro-prova e' il caso
  // `sites.length === 0` piu' sotto, che resta lo stato vuoto solo quando l'elenco e' DAVVERO
  // vuoto e leggibile.
  const sitesUnavailable = !result.ok || !statusesResult.ok;
  const sites = result.ok ? result.sites : [];

  // Lo stato di generazione per sito, indicizzato per site_id ESATTO (mai per prefisso o per
  // indice): due siti i cui id sono in relazione di prefisso non possono scambiarsi lo stato.
  // Un site_id assente dalla mappa, o presente con status null, vale "mai generato" → genera.
  const statusBySite = new Map<string, GenerationStatus | null>();
  if (statusesResult.ok) {
    for (const entry of statusesResult.statuses) {
      statusBySite.set(entry.site_id, entry.status);
    }
  }

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
            {rows.map(({ site, brief }) => {
              // Lo stato di generazione di QUESTO sito, per lookup ESATTO. Assente o null →
              // mai generato. Da esso la CTA (etichetta + rotta) e poi l'href, costruito da
              // NOI: locale dall'allowlist + siteId codificato, cosi' un id con caratteri
              // strani (slash, punti) non aggiunge segmenti al percorso, e mai il locale
              // grezzo (difetto T-102/T-153). Nessun testo del brief finisce in un href.
              const genStatus = statusBySite.get(site.id) ?? null;
              const genCta = generationCtaSpec(genStatus);
              const generationHref = `/${locale}/${genCta.route}/${encodeURIComponent(site.id)}`;
              return (
                <SiteRow
                  key={site.id}
                  site={site}
                  labels={rowLabels}
                  onboarding={{
                    href: `/${locale}/onboarding/${encodeURIComponent(site.id)}`,
                    ctaLabel: t('onboarding.cta'),
                    statusUnavailable: brief.ok ? undefined : t('onboarding.statusUnavailable'),
                  }}
                  generation={{
                    href: generationHref,
                    ctaLabel: t(genCta.labelKey),
                  }}
                />
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
