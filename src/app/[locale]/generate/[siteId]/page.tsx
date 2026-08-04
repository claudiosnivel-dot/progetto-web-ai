import { AppShell } from '@/ui/shell/AppShell';
import { GenerateLauncher } from '@/ui/generation/GenerateLauncher';
import { GenerationChooser } from '@/ui/generation/GenerationChooser';
import { Phase2Trigger } from '@/ui/generation/Phase2Trigger';
import { getBrief } from '@/data/briefs';
import { getGeneration } from '@/data/generations';
import { generatable, type MissingEntry } from '@/domain/generation/generatable';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { emptyBrief } from '@/domain/onboarding/brief';
import { enterGenerate } from './guard';

// T-230 (macrotask generation-ui, P2) — rotta localizzata e protetta
// /{locale}/generate/{siteId}, resa dentro AppShell (T-022). La catena di guardie (locale
// dall'allowlist → identita' → proprieta' del sito via listSites, P1-D21) vive in ./guard,
// che NON e' `enterOnboarding` (namespace i18n fissi). Qui si LEGGE il brief e si decide
// cosa offrire; il selettore dei cinque mockup e il consumo dello stream sono T-232.
//
// TRE ESITI, e la distinzione fra loro e' il cuore del task:
//  - GUASTO DI LETTURA del brief (getBrief ok:false): stato d'errore ESPLICITO, DISTINTO
//    dal "brief povero" (AC-230-4, P2-D16). Un guasto transitorio non deve dire a un utente
//    che il suo brief e' incompleto — e' la lezione di T-152 spostata qui.
//  - BRIEF NON GENERABILE (generatable.ok false): si ELENCA cosa manca e quale blocco/pagina
//    sbloccherebbe, con un link all'onboarding, e NON si offre la generazione (AC-230-3). Il
//    gate `generatable` e' PURO (T-215); il testo e la sua i18n sono qui (namespace
//    'generate'), che e' cio' che quel modulo dichiara di lasciare a T-230.
//  - BRIEF GENERABILE: si offre la generazione con <GenerateLauncher>, che POSTa a
//    /api/generate. La riga 'generating', lo stream e il confine vivono nella rotta API.
//
// Sicurezza (A01:2025): la rotta e' protetta a DUE livelli — la guardia di route nel
// middleware (se /generate e' fra i suoi segmenti) e questo getUser server-side dentro
// ./guard. Il secondo non e' ridondanza: il matcher del middleware esclude ogni pathname con
// un punto, quindi per /it/generate/a.b la guardia di route non parte affatto. Nessun testo
// del brief finisce mai in un href: la destinazione dell'onboarding e' costruita da NOI, con
// locale dall'allowlist e siteId codificato.

// LA MAPPA campo-del-brief → CHIAVE i18n della sua etichetta, per l'elenco dei mancanti. E'
// la stessa forma di src/ui/site/labels.ts (T-231): valori `as const` cosi' `t(...)` li
// accetta come chiavi valide del catalogo, e un accesso su proprieta' PROPRIE (`Object.hasOwn`)
// cosi' un `field` come 'constructor' non risolve un membro di Object.prototype. Copre i campi
// che `MISSING_RULES` (T-215) puo' nominare; un campo fuori mappa ricade su una voce generica.
const MISSING_FIELD_LABEL_KEY = {
  business_name: 'missing.fields.businessName',
  offerings: 'missing.fields.offerings',
  vertical: 'missing.fields.vertical',
  description: 'missing.fields.description',
  highlights: 'missing.fields.highlights',
  hours: 'missing.fields.hours',
  address: 'missing.fields.address',
  phone: 'missing.fields.phone',
  whatsapp: 'missing.fields.whatsapp',
  email: 'missing.fields.email',
} as const satisfies Partial<Record<MissingEntry['field'], string>>;

const EFFECT_LABEL_KEY = {
  unlocks: 'missing.effect.unlocks',
  specializes: 'missing.effect.specializes',
} as const satisfies Record<MissingEntry['effect'], string>;

type MissingLabelKey =
  | (typeof MISSING_FIELD_LABEL_KEY)[keyof typeof MISSING_FIELD_LABEL_KEY]
  | 'missing.fields.other';

function missingFieldLabelKey(field: MissingEntry['field']): MissingLabelKey {
  return Object.hasOwn(MISSING_FIELD_LABEL_KEY, field)
    ? MISSING_FIELD_LABEL_KEY[field as keyof typeof MISSING_FIELD_LABEL_KEY]
    : 'missing.fields.other';
}

type GeneratePageProps = {
  params: Promise<{ locale: string; siteId: string }>;
};

export default async function GeneratePage({ params }: GeneratePageProps) {
  const { locale: rawLocale, siteId } = await params;
  const { locale, site, t, tNav } = await enterGenerate({ locale: rawLocale, siteId });
  const navItems = [{ href: `/${locale}/dashboard`, label: tNav('dashboard') }];

  const briefResult = await getBrief(siteId);

  // ESITO 1 — GUASTO DI LETTURA (AC-230-4): stato d'errore esplicito, DISTINTO dal brief
  // povero. Non un throw: la pagina si rende e dice che il guasto e' di LETTURA, non del
  // contenuto del brief.
  if (!briefResult.ok) {
    return (
      <AppShell navItems={navItems}>
        <div className="mx-auto flex max-w-2xl flex-col gap-lg">
          <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{site.name}</p>
          <p data-generate-error="read" className="text-sm text-muted-foreground">
            {t('readError')}
          </p>
        </div>
      </AppShell>
    );
  }

  const brief = briefResult.brief ?? emptyBrief(locale);

  // WIRE — SE UNA GENERAZIONE E' GIA' SCEGLIIBILE, si MONTA il selettore invece del launcher.
  // getGeneration e' la lettura di STATO autorevole (T-203, con la riconciliazione di P2-D15). Una
  // riga 'ready'/'chosen'/'complete' significa che le cinque proposte esistono: si rende
  // <GenerationChooser> (le cinque card + la scelta), non l'avvio di una NUOVA generazione. Ogni
  // altro stato ('generating'/'failed', o nessuna generazione, o un guasto di lettura) ricade sul
  // gate/launcher di sotto — un guasto transitorio non nasconde l'offerta di generare. Il chooser
  // e' un Server Component ASINCRONO: lo si esegue e si incorpora l'albero pronto, cosi' la pagina
  // non annida un componente asincrono (stessa tecnica dell'anteprima, T-235).
  const genResult = await getGeneration(siteId);
  const generation = genResult.ok ? genResult.generation : null;
  if (
    generation !== null &&
    (generation.status === 'ready' ||
      generation.status === 'chosen' ||
      generation.status === 'complete')
  ) {
    const chooser = await GenerationChooser({
      siteId,
      generationId: generation.id,
      brief,
      locale,
      labels: { regenerate: t('chooser.regenerate'), unavailable: t('chooser.unavailable') },
      choose: {
        status: generation.status,
        labels: {
          choose: t('chooser.choose'),
          confirmPrompt: t('chooser.confirmPrompt'),
          confirm: t('chooser.confirm'),
          cancel: t('chooser.cancel'),
        },
      },
    });
    return (
      <AppShell navItems={navItems}>
        <div className="mx-auto flex max-w-5xl flex-col gap-lg">
          <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{site.name}</p>
          {chooser}
          {/* Fase 2 RAGGIUNGIBILE: da 'chosen' (home congelata, interne non ancora costruite) un
              gesto esplicito la avvia; a 'complete' il trigger sparisce. */}
          {generation.status === 'chosen' ? (
            <Phase2Trigger siteId={siteId} generationId={generation.id} label={t('buildInner')} />
          ) : null}
        </div>
      </AppShell>
    );
  }

  const gate = generatable(brief, { maxPages: DOCUMENT_LIMITS.max_pages });

  return (
    <AppShell navItems={navItems}>
      <div className="mx-auto flex max-w-2xl flex-col gap-lg">
        <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{site.name}</p>

        {gate.ok ? (
          // ESITO 3 — si OFFRE la generazione.
          <GenerateLauncher
            siteId={siteId}
            labels={{
              generate: t('cta'),
              generating: t('launcher.generating'),
              done: t('launcher.done'),
              error: t('launcher.error'),
            }}
          />
        ) : (
          // ESITO 2 — si ELENCA cosa manca (AC-230-3), con link all'onboarding, e NON si
          // offre la generazione.
          <section data-generate-missing="true" aria-label={t('missing.title')} className="flex flex-col gap-md">
            <h2 className="text-sm font-medium text-foreground">{t('missing.title')}</h2>
            <ul className="flex flex-col gap-sm">
              {gate.missing.map((entry) => (
                <li
                  key={`${entry.field}:${entry.kind}:${entry.id}`}
                  data-missing-field={entry.field}
                  data-missing-kind={entry.kind}
                  data-missing-id={entry.id}
                  data-missing-effect={entry.effect}
                  className="text-sm text-muted-foreground"
                >
                  <span className="font-medium text-foreground">
                    {t(missingFieldLabelKey(entry.field))}
                  </span>
                  {' — '}
                  {t(EFFECT_LABEL_KEY[entry.effect])}
                </li>
              ))}
            </ul>
            <a
              href={`/${locale}/onboarding/${encodeURIComponent(siteId)}`}
              className="text-sm font-medium text-primary underline"
            >
              {t('missing.onboardingCta')}
            </a>
          </section>
        )}
      </div>
    </AppShell>
  );
}
