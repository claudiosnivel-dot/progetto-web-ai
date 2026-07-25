'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, CardHeader, Input, Label, Textarea } from '@/ui/primitives';
import { GOAL_OPTIONS, VERTICAL_OPTIONS } from '@/ui/onboarding/BriefPanel';
import { upsertBrief, confirmBrief } from '@/data/briefs';
import type { Brief } from '@/domain/onboarding/brief';
import { routing } from '@/i18n/routing';

// T-152 (macrotask onboarding-ui, P1) — schermata Rivedi&conferma: recap EDITABILE di
// tutto il brief (campi core + offerte + il resto del content) e conferma ESPLICITA che
// invoca confirmBrief (T-123) e riporta l'utente alla dashboard.
//
// LA CONFERMA NON E' IMPLICITA (DoD). Sono DUE azioni distinte, e un solo click non le fa
// entrambe:
//  - "salva le modifiche" -> upsertBrief con il solo diff (nessuna conferma);
//  - "conferma il brief" -> ARMA il controllo, non conferma; solo il secondo click, su un
//    controllo che dice cosa sta per accadere, invoca confirmBrief.
// E' lo stesso pattern dell'eliminazione in SiteRow (T-105), che e' l'azione irreversibile
// gia' in casa: qui l'irreversibilita' e' che il brief diventa l'artefatto che P2
// consumera'.
//
// Sicurezza:
//  - LA UI NON E' IL GATE. L'autorizzazione della conferma e' della RLS dentro
//    confirmBrief (T-123): un sito di un altro tenant, o un brief che non esiste, tornano
//    404 e la schermata rende un errore GENERICO. Non si pre-valida per sostituire il
//    gate, e non si distingue 401/404/500 nel messaggio: distinguerli sarebbe un oracolo
//    di enumerazione dei brief altrui (la stessa ragione di P1-D21 e P1-D16).
//  - Validazione sempre server-side: ogni edit del recap passa da upsertBrief, che
//    ri-valida con BriefUpdateSchema (allowlist degli enum, tetti di P1-D17).
//  - "TORNA ALLA DASHBOARD" e' una destinazione INTERNA FISSA `/{locale}/dashboard`, mai
//    costruita da input dell'utente (anti open-redirect, come T-044). Il `locale` arriva
//    gia' vincolato all'allowlist di routing.locales — il tipo della prop non ammette
//    altro, e la pagina lo verifica con hasLocale prima di passarlo.
//  - IL TESTO DEL BRIEF E' INPUT NON FIDATO IN RENDERING (04 §7 p.4): le offerte e i
//    social possono arrivare da una pagina ostile via fromUrl (T-141). Qui ogni valore
//    finisce SOLO in un `value` di input/textarea: nessun dangerouslySetInnerHTML e
//    NESSUN valore del brief in un `href`/`src`. SCELTA DICHIARATA, la stessa di T-151:
//    `social_links` e `photo_ref` (destinati naturalmente a un href/src) sono resi come
//    TESTO EDITABILE, quindi non serve validarne lo schema http/https — non esiste un
//    href da avvelenare, la superficie e' assente, non filtrata. L'UNICO href della
//    schermata e' la destinazione interna fissa di cui sopra.
//
// LIMITI DICHIARATI, nessuno risolto qui (peggiorarli o fingere di averli chiusi sarebbe
// il vero difetto):
//  1. IL SALVATAGGIO E' TUTTO-O-NIENTE, non per campo. `upsertBrief` valida la patch
//     INTERA con `BriefUpdateSchema` e ritorna **400** se un solo campo non passa: in quel
//     caso NULLA viene scritto. (Lo scarto per-campo di P1-D17 e' di `applyBriefUpdate`,
//     che qui NON e' il gate: e' a valle, e vede solo patch che lo schema ha gia'
//     accettato.) Percio' il 400 ha un messaggio suo, che dice che nulla e' stato salvato:
//     un messaggio ambiguo lascerebbe credere a un salvataggio parziale.
//     Su `ok:true` resta comunque UN caso in cui un campo non arriva in tabella:
//     `applyBriefUpdate` valida `offerings` sul RISULTATO del merge, quindi una patch
//     conforme che, fusa per nome, sfonda `offerings_items` viene scartata mentre il resto
//     e' salvato — e `UpsertBriefResult` non ha un canale per dirlo (`rejected[]` non
//     attraversa quel confine). Quindi `ok:true` NON significa "tutti i campi sono
//     salvati", e questa schermata non lo afferma: rende una nota che dichiara quel caso e
//     invita a ricaricare per vedere cio' che e' in tabella. Per lo stesso motivo il diff
//     NON riparte da zero dopo un salvataggio riuscito. Sede della fix:
//     `UpsertBriefResult` in src/data/briefs.ts (T-123).
//  2. Le offerte si FONDONO PER NOME in applyBriefUpdate (T-122): stesso `name` aggiorna,
//     `name` nuovo APPENDE. Non esiste un modo di rinominare ne' di cancellare una voce
//     attraverso quel confine, quindi cambiare il nome di una voce AGGIUNGE una voce e
//     lascia la vecchia. Non si nasconde: si dichiara all'utente con una nota localizzata
//     (`review.offeringsNote`) e il comportamento e' pinnato da un test che ri-applica la
//     patch col merge reale. Sede della fix: T-122.
//  3. Non si AGGIUNGONO voci (ne' offerte, ne' punti di forza, ne' social, ne' orari) e
//     non si riordina: gli AC chiedono di rendere editabili i campi esistenti, e inventare
//     qui una UI di composizione sarebbe scope che nessun task ha chiesto. Una voce
//     SVUOTATA viene scartata dalla patch — la stessa regola di casa che T-151 applica
//     alle righe orario col giorno vuoto: una stringa vuota passa BriefUpdateSchema, quindi
//     finirebbe davvero in tabella e il sito generato (P2) renderebbe una voce vuota.
//  4. `geo` non si puo' SVUOTARE dal recap: la patch di T-121 non ha un modo di dire
//     "rimuovi il campo" (un `undefined` non e' un valore inviabile), quindi con una delle
//     due coordinate vuote `geo` non viene spedito affatto.
//  5. Il recap non si ri-sincronizza col DB dopo il montaggio: e' una schermata di
//     revisione, non un pannello live (la chat e l'import stanno in T-151, altrove).

type Locale = (typeof routing.locales)[number];

// I campi core di testo, con la chiave i18n dell'etichetta. La coppia sta in UN posto
// solo, cosi' etichetta e campo non possono disallinearsi. `description` e' fuori da
// questa lista perche' e' l'unico reso in un textarea (P1-D17: tetto 2000 code unit).
const SHORT_TEXT_FIELDS = [
  ['business_name', 'fields.businessName'],
  ['address', 'fields.address'],
  ['phone', 'fields.phone'],
  ['whatsapp', 'fields.whatsapp'],
  ['email', 'fields.email'],
] as const;

const CORE_TEXT_FIELDS = [
  'business_name',
  'description',
  'address',
  'phone',
  'whatsapp',
  'email',
] as const;

type CoreTextField = (typeof CORE_TEXT_FIELDS)[number];

// I cinque campi di una voce d'offerta, con etichetta POSIZIONALE e localizzata: il nome
// della voce e' testo non fidato, quindi non si usa come etichetta del proprio campo
// (stessa ragione delle chiavi orario in T-151).
const OFFERING_FIELDS = [
  ['name', 'review.offeringName', 'input'],
  ['section', 'review.offeringSection', 'input'],
  ['price', 'review.offeringPrice', 'input'],
  ['photo_ref', 'review.offeringPhoto', 'input'],
  ['description', 'review.offeringDescription', 'textarea'],
] as const;

type OfferingField = (typeof OFFERING_FIELDS)[number][0];
type OfferingRow = Record<OfferingField, string>;
type HourRow = { key: string; value: string };
type Offering = Brief['content']['offerings'][number];

// La patch e' un sottoinsieme di BriefUpdateSchema: i campi che questa schermata rende
// editabili (cioe' tutti, tranne `locale` — un sito = una lingua, T-121, e la lingua e'
// proprieta' del sito). Non e' una ri-dichiarazione dello schema: la validazione resta
// server-side, questo e' il tipo di cio' che si spedisce.
type ReviewPatch = Partial<{
  business_name: string;
  description: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  vertical: Brief['vertical'];
  primary_goal: NonNullable<Brief['primary_goal']>;
  geo: { lat: number; lng: number };
  hours: Record<string, string>;
  offerings: Offering[];
  highlights: string[];
  social_links: string[];
  brand_hints: string;
}>;

type Draft = {
  core: Record<CoreTextField, string>;
  vertical: string;
  primary_goal: string;
  lat: string;
  lng: string;
  hours: HourRow[];
  offerings: OfferingRow[];
  highlights: string[];
  social_links: string[];
  brand_hints: string;
};

// Il brief -> le stringhe che i controlli mostrano. E' anche la BASE del confronto: il
// diff si calcola fra il draft e `toDraft(brief)`, cioe' fra due valori della stessa
// forma. Confrontare stringhe con campi tipati era il modo di produrre diff fantasma
// (undefined vs '').
function toDraft(brief: Brief): Draft {
  return {
    core: Object.fromEntries(CORE_TEXT_FIELDS.map((name) => [name, brief[name] ?? ''])) as Record<
      CoreTextField,
      string
    >,
    vertical: brief.vertical,
    primary_goal: brief.primary_goal ?? '',
    lat: brief.geo ? String(brief.geo.lat) : '',
    lng: brief.geo ? String(brief.geo.lng) : '',
    hours: Object.entries(brief.hours ?? {}).map(([key, value]) => ({ key, value })),
    offerings: brief.content.offerings.map((offering) => ({
      name: offering.name,
      section: offering.section ?? '',
      price: offering.price ?? '',
      photo_ref: offering.photo_ref ?? '',
      description: offering.description ?? '',
    })),
    highlights: [...brief.content.highlights],
    social_links: [...brief.content.social_links],
    brand_hints: brief.content.brand_hints ?? '',
  };
}

function asVertical(value: string): Brief['vertical'] | undefined {
  return VERTICAL_OPTIONS.find((option) => option === value);
}

function asGoal(value: string): NonNullable<Brief['primary_goal']> | undefined {
  return GOAL_OPTIONS.find((option) => option === value);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameOfferings(a: readonly OfferingRow[], b: readonly OfferingRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, index) => OFFERING_FIELDS.every(([field]) => row[field] === b[index][field]))
  );
}

function sameHours(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  return (
    keysA.length === Object.keys(b).length &&
    keysA.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

// Le righe con la chiave vuota si scartano (regola di casa, cfr. T-151): una chiave ''
// non e' un giorno, e passerebbe BriefUpdateSchema senza che nessuno se ne accorga.
function hoursOf(rows: readonly HourRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.key.trim().length > 0).map((row) => [row.key.trim(), row.value]),
  );
}

// Una riga -> la voce d'offerta da spedire. Un campo opzionale si include se ha un valore
// OPPURE se ne aveva uno prima (cioe' l'utente lo ha svuotato: la stringa vuota e' il solo
// modo di cancellarlo). Se non ne ha e non ne aveva, si omette: mandare '' trasformerebbe
// "assente" in "vuoto".
function toOffering(row: OfferingRow, base: OfferingRow | undefined): Offering {
  const offering: Offering = { name: row.name };
  for (const [field] of OFFERING_FIELDS) {
    if (field === 'name') continue;
    const value = row[field];
    if (value.length > 0 || value !== (base?.[field] ?? '')) offering[field] = value;
  }
  return offering;
}

function buildReviewPatch(draft: Draft, brief: Brief): ReviewPatch {
  const base = toDraft(brief);
  const patch: ReviewPatch = {};

  for (const name of CORE_TEXT_FIELDS) {
    // Si spedisce anche la stringa vuota (l'utente ha svuotato il campo): decidere qui
    // che "vuoto = non inviare" renderebbe impossibile cancellare un valore, e per i campi
    // che il vuoto non ammette (business_name ha .min(1) in T-121) il rifiuto arriva dal
    // gate server-side, che e' la sede giusta.
    if (draft.core[name] !== base.core[name]) patch[name] = draft.core[name];
  }

  // Gli enum non si possono SVUOTARE: l'allowlist di T-121 non ammette la stringa vuota,
  // quindi spedirla sarebbe un 400 garantito e un dato perso.
  const vertical = asVertical(draft.vertical);
  if (vertical !== undefined && vertical !== brief.vertical) patch.vertical = vertical;
  const goal = asGoal(draft.primary_goal);
  if (goal !== undefined && goal !== brief.primary_goal) patch.primary_goal = goal;

  // Limite 4: con una coordinata vuota `geo` non si spedisce (non c'e' modo di rimuoverlo).
  // Un valore non numerico viene MANDATO comunque: la UI non e' il gate, e GeoSchema
  // (T-121) e' l'unico autorizzato a rifiutarlo.
  if (
    (draft.lat !== base.lat || draft.lng !== base.lng) &&
    draft.lat.trim().length > 0 &&
    draft.lng.trim().length > 0
  ) {
    patch.geo = { lat: Number(draft.lat), lng: Number(draft.lng) };
  }

  const hours = hoursOf(draft.hours);
  if (!sameHours(hours, hoursOf(base.hours))) patch.hours = hours;

  // Le collezioni si spediscono INTERE: social_links e highlights SOSTITUISCONO in T-122,
  // quindi una patch parziale cancellerebbe le voci che non nomina.
  if (!sameOfferings(draft.offerings, base.offerings)) {
    // Una voce senza nome non e' una voce: `name` ha .min(1) in T-121, quindi spedirla
    // farebbe scartare l'INTERO array (fail-closed di T-122) e si perderebbe anche il dato
    // valido dello stesso salvataggio.
    const offerings = draft.offerings
      .map((row, index) => ({ row, base: base.offerings[index] }))
      .filter(({ row }) => row.name.trim().length > 0)
      .map(({ row, base: baseRow }) => toOffering(row, baseRow));
    if (offerings.length > 0) patch.offerings = offerings;
  }

  const highlights = draft.highlights.filter((value) => value.trim().length > 0);
  if (!sameList(draft.highlights, base.highlights)) patch.highlights = highlights;
  const socialLinks = draft.social_links.filter((value) => value.trim().length > 0);
  if (!sameList(draft.social_links, base.social_links)) patch.social_links = socialLinks;

  if (draft.brand_hints !== base.brand_hints) patch.brand_hints = draft.brand_hints;

  return patch;
}

type ReviewConfirmProps = {
  siteId: string;
  brief: Brief;
  // Vincolato all'allowlist dal TIPO, non da una convenzione: e' cio' che entra nella
  // destinazione interna fissa della dashboard.
  locale: Locale;
};

export function ReviewConfirm({ siteId, brief, locale }: ReviewConfirmProps) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>(() => toDraft(brief));
  const [saving, setSaving] = useState(false);
  // `rejected` e' il 400 (patch rifiutata INTERA: nulla salvato), `failed` ogni altro
  // rifiuto, `nothing` il click senza modifiche.
  const [saveState, setSaveState] = useState<'idle' | 'sent' | 'failed' | 'rejected' | 'nothing'>(
    'idle',
  );
  // La conferma esplicita e' ARMATA da un primo click, come l'eliminazione in SiteRow.
  const [confirming, setConfirming] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);

  // Destinazione INTERNA FISSA: nessun pezzo arriva da input dell'utente.
  const dashboardHref = `/${locale}/dashboard`;

  const patch = buildReviewPatch(draft, brief);
  const dirty = Object.keys(patch).length > 0;

  // Ogni modifica riapre il ciclo: cio' che si vede non e' piu' cio' che si e' inviato.
  function edit(update: (current: Draft) => Draft): void {
    setDraft(update);
    setSaveState('idle');
  }

  const setCore = (name: CoreTextField, value: string) =>
    edit((current) => ({ ...current, core: { ...current.core, [name]: value } }));
  const setOffering = (index: number, field: OfferingField, value: string) =>
    edit((current) => ({
      ...current,
      offerings: current.offerings.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      ),
    }));
  const setHour = (index: number, part: Partial<HourRow>) =>
    edit((current) => ({
      ...current,
      hours: current.hours.map((row, i) => (i === index ? { ...row, ...part } : row)),
    }));
  const setItem = (key: 'highlights' | 'social_links', index: number, value: string) =>
    edit((current) => ({
      ...current,
      [key]: current[key].map((item, i) => (i === index ? value : item)),
    }));

  // QUI, e solo qui, i campi vengono scritti. Il render e la digitazione non scrivono, e
  // la CONFERMA non scrive campi: sono azioni separate.
  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Nessuna modifica: nessuna richiesta. Una patch vuota riscriverebbe lo stesso stato
    // e toccherebbe updated_at per nulla.
    // MA NON IN SILENZIO: un click che non produce ne' una scrittura ne' un riscontro e'
    // indistinguibile da un guasto (l'utente non sa se il pulsante ha funzionato, e ci
    // riprova). Si dice che non c'e' niente da salvare — e non si disabilita il pulsante,
    // perche' il diff dipende da come la patch viene costruita (una voce svuotata, `geo`
    // con una coordinata sola) e un controllo spento non spiegherebbe il perche'.
    if (!dirty) {
      setSaveState('nothing');
      return;
    }

    setSaving(true);
    setSaveState('idle');
    const result = await upsertBrief(siteId, patch);
    setSaving(false);
    if (result.ok) {
      setSaveState('sent');
      return;
    }
    // 400 = la patch non ha passato BriefUpdateSchema, quindi NULLA e' stato scritto: e'
    // un verdetto sull'input che l'utente stesso ha appena inviato, e dirlo non rivela
    // niente sui dati di altri. 401/404/500 restano UN SOLO messaggio generico: 404 non si
    // distingue dal resto, altrimenti sarebbe un oracolo di enumerazione dei brief altrui
    // (P1-D21). In nessun caso lo status finisce a schermo.
    setSaveState(result.status === 400 ? 'rejected' : 'failed');
  }

  // La conferma esplicita: e' il SECONDO click, e questa e' l'unica funzione che invoca
  // confirmBrief.
  async function handleConfirm() {
    setConfirmPending(true);
    setConfirmFailed(false);
    const result = await confirmBrief(siteId);
    setConfirmPending(false);
    if (!result.ok) {
      setConfirmFailed(true);
      return;
    }
    // Confermato: l'utente torna alla dashboard (destinazione interna fissa).
    router.push(dashboardHref);
  }

  return (
    <div className="flex flex-col gap-lg">
      <form onSubmit={handleSave} className="flex flex-col gap-lg">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">{t('panel.title')}</h2>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-md">
              {SHORT_TEXT_FIELDS.map(([name, labelKey]) => (
                <div key={name} className="flex flex-col gap-xs">
                  <Label htmlFor={`review-${name}`}>{t(labelKey)}</Label>
                  <Input
                    id={`review-${name}`}
                    value={draft.core[name]}
                    onChange={(event) => setCore(name, event.target.value)}
                  />
                </div>
              ))}

              {/* P1-D17 — `description` ha tetto 2000 code unit: qui vive nel textarea che
                  T-151 ha rinviato a T-152. NESSUN maxlength: la UI non e' il gate della
                  lunghezza, e nasconderebbe il rifiuto server-side. */}
              <div className="flex flex-col gap-xs">
                <Label htmlFor="review-description">{t('fields.description')}</Label>
                <Textarea
                  id="review-description"
                  rows={5}
                  value={draft.core.description}
                  onChange={(event) => setCore('description', event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-xs">
                <Label htmlFor="review-vertical">{t('fields.vertical')}</Label>
                <select
                  id="review-vertical"
                  value={draft.vertical}
                  onChange={(event) => edit((c) => ({ ...c, vertical: event.target.value }))}
                  className="rounded-md border border-border bg-background px-md py-sm text-sm text-foreground"
                >
                  {VERTICAL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`verticals.${option}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-xs">
                <Label htmlFor="review-primary-goal">{t('fields.primaryGoal')}</Label>
                <select
                  id="review-primary-goal"
                  value={draft.primary_goal}
                  onChange={(event) => edit((c) => ({ ...c, primary_goal: event.target.value }))}
                  className="rounded-md border border-border bg-background px-md py-sm text-sm text-foreground"
                >
                  {/* Un brief in bozza puo' non avere ancora un obiettivo: l'opzione vuota
                      rappresenta quello stato e non viene mai spedita. */}
                  <option value="">{t('panel.notChosen')}</option>
                  {GOAL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {t(`goals.${option}`)}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="flex flex-col gap-sm border-0 p-0">
                <legend className="text-sm font-medium text-foreground">{t('fields.geo')}</legend>
                <div className="flex flex-wrap items-end gap-sm">
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="review-geo-lat">{t('review.geoLat')}</Label>
                    <Input
                      id="review-geo-lat"
                      inputMode="decimal"
                      value={draft.lat}
                      onChange={(event) => edit((c) => ({ ...c, lat: event.target.value }))}
                      className="max-w-xs"
                    />
                  </div>
                  <div className="flex flex-col gap-xs">
                    <Label htmlFor="review-geo-lng">{t('review.geoLng')}</Label>
                    <Input
                      id="review-geo-lng"
                      inputMode="decimal"
                      value={draft.lng}
                      onChange={(event) => edit((c) => ({ ...c, lng: event.target.value }))}
                      className="max-w-xs"
                    />
                  </div>
                </div>
              </fieldset>

              {draft.hours.length > 0 && (
                <fieldset className="flex flex-col gap-sm border-0 p-0">
                  <legend className="text-sm font-medium text-foreground">
                    {t('fields.hours')}
                  </legend>
                  {draft.hours.map((row, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-sm">
                      {/* Etichette POSIZIONALI: le chiavi degli orari sono libere e non
                          fidate (possono venire dal JSON-LD di un altro sito), quindi non
                          si usa il giorno come etichetta del proprio campo. */}
                      <Input
                        aria-label={t('panel.hoursDay', { n: String(index + 1) })}
                        value={row.key}
                        onChange={(event) => setHour(index, { key: event.target.value })}
                        className="max-w-xs"
                      />
                      <Input
                        aria-label={t('panel.hoursValue', { n: String(index + 1) })}
                        value={row.value}
                        onChange={(event) => setHour(index, { value: event.target.value })}
                        className="max-w-xs"
                      />
                    </div>
                  ))}
                </fieldset>
              )}
            </div>
          </CardContent>
        </Card>

        {draft.offerings.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">{t('panel.offerings')}</h2>
            </CardHeader>
            <CardContent>
              {/* Limite 2 dichiarato all'UTENTE, non solo nel codice: il nome e' la chiave
                  con cui T-122 fonde le voci. */}
              <p className="text-sm text-muted-foreground">{t('review.offeringsNote')}</p>
              <div className="mt-md flex flex-col gap-md">
                {draft.offerings.map((row, index) => (
                  <div
                    key={index}
                    className="flex flex-col gap-xs rounded-md border border-border px-md py-sm"
                  >
                    {OFFERING_FIELDS.map(([field, labelKey, kind]) => {
                      const id = `review-offering-${index}-${field}`;
                      const value = row[field];
                      const onChange = (event: { target: { value: string } }) =>
                        setOffering(index, field, event.target.value);
                      return (
                        <div key={field} className="flex flex-col gap-xs">
                          <Label htmlFor={id}>{t(labelKey, { n: String(index + 1) })}</Label>
                          {kind === 'textarea' ? (
                            <Textarea id={id} rows={3} value={value} onChange={onChange} />
                          ) : (
                            // `photo_ref` compreso: reso come TESTO, mai come src.
                            <Input id={id} value={value} onChange={onChange} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {draft.highlights.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">{t('panel.highlights')}</h2>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-sm">
                {draft.highlights.map((value, index) => (
                  <div key={index} className="flex flex-col gap-xs">
                    <Label htmlFor={`review-highlight-${index}`}>
                      {t('review.highlight', { n: String(index + 1) })}
                    </Label>
                    <Input
                      id={`review-highlight-${index}`}
                      value={value}
                      onChange={(event) => setItem('highlights', index, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {draft.social_links.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-foreground">{t('panel.socialLinks')}</h2>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-sm">
                {draft.social_links.map((value, index) => (
                  <div key={index} className="flex flex-col gap-xs">
                    <Label htmlFor={`review-social-${index}`}>
                      {t('review.socialLink', { n: String(index + 1) })}
                    </Label>
                    {/* Reso come TESTO EDITABILE, non come link: nessun href da avvelenare
                        (scelta dichiarata, cfr. T-151). */}
                    <Input
                      id={`review-social-${index}`}
                      value={value}
                      onChange={(event) => setItem('social_links', index, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-foreground">{t('panel.brandHints')}</h2>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="review-brand-hints">{t('panel.brandHints')}</Label>
              <Textarea
                id="review-brand-hints"
                rows={3}
                value={draft.brand_hints}
                onChange={(event) => edit((c) => ({ ...c, brand_hints: event.target.value }))}
              />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>
          {t('panel.save')}
        </Button>

        {saveState === 'failed' && (
          <p role="alert" className="text-sm font-medium text-foreground">
            {t('panel.saveError')}
          </p>
        )}
        {/* 400: si dichiara che NULLA e' stato salvato, che e' cio' che accade davvero. */}
        {saveState === 'rejected' && (
          <p role="alert" className="text-sm font-medium text-foreground">
            {t('review.saveRejected')}
          </p>
        )}
        {/* Il no-op non e' un errore: role="status", non "alert". */}
        {saveState === 'nothing' && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('review.nothingToSave')}
          </p>
        )}
        {/* Limite 1: non si afferma "salvato". Si dice cosa e' stato fatto (inviato) e cosa
            il server puo' aver scartato anche rispondendo ok. */}
        {saveState === 'sent' && (
          // role="status": l'esito arriva DOPO l'azione, quindi va annunciato anche a chi
          // non vede il paragrafo comparire (l'errore usa role="alert", piu' assertivo).
          <p role="status" className="text-sm text-muted-foreground">
            {t('review.saveSent')}
          </p>
        )}
      </form>

      {/* La conferma sta FUORI dal form del salvataggio: due azioni distinte, e un Invio
          nei campi non puo' finire sulla conferma. */}
      <div className="flex flex-col gap-sm">
        {confirming ? (
          <>
            {/* Le modifiche non salvate non entrano nel brief: confirmBrief tocca solo
                `status` (T-123). Si avvisa invece di salvare di nascosto — un salvataggio
                implicito qui renderebbe la conferma un'azione doppia. */}
            {dirty && saveState !== 'sent' && (
              <p className="text-sm font-medium text-foreground">{t('review.unsaved')}</p>
            )}
            <div className="flex flex-wrap items-center gap-sm">
              <Button type="button" disabled={confirmPending} onClick={handleConfirm}>
                {t('review.confirmYes')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                {tCommon('cancel')}
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" onClick={() => setConfirming(true)}>
            {t('review.confirm')}
          </Button>
        )}

        {confirmFailed && (
          <p role="alert" className="text-sm font-medium text-foreground">
            {t('review.confirmError')}
          </p>
        )}

        <Link href={dashboardHref} className="text-sm font-medium text-muted-foreground">
          {t('review.backToDashboard')}
        </Link>
      </div>
    </div>
  );
}
