'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, CardHeader, Input, Label } from '@/ui/primitives';
import { upsertBrief } from '@/data/briefs';
import type { Brief } from '@/domain/onboarding/brief';

// T-151 (macrotask onboarding-ui, P1) — pannello del brief: rende lo stato corrente e
// consente l'EDIT MANUALE dei campi, che alla conferma esplicita finisce in upsertBrief
// (T-123). Livello UI: nessuna logica dati, nessuna validazione autoritativa.
//
// Sicurezza:
//  - LA UI NON E' IL GATE. L'autorizzazione cross-tenant e' della RLS dentro
//    upsertBrief; la validazione autoritativa (allowlist degli enum, tetti di P1-D17)
//    e' di BriefUpdateSchema, che ri-valida ogni patch. Qui non si nasconde nulla come
//    misura di sicurezza e non si "pre-valida" per sostituire il gate: un valore fuori
//    scala viene MANDATO e il rifiuto del server viene reso (una pre-validazione
//    client-side che nascondesse il rifiuto renderebbe il gate non osservabile).
//  - IL TESTO DEL BRIEF E' INPUT NON FIDATO IN RENDERING (04 §7 p.4): `business_name`,
//    `description`, `highlights` e le voci dell'offerta possono contenere HTML o
//    `javascript:` presi da una pagina ostile via fromUrl (T-141). Qui ogni valore
//    finisce SOLO in un `value` di input o in un nodo di testo JSX: nessun
//    dangerouslySetInnerHTML, e NESSUN valore del brief in un `href`/`src`.
//    SCELTA DICHIARATA: `social_links` e `photo_ref` sono destinati a un href/src, e
//    qui sono resi come TESTO, non come link/immagine. Cosi' non serve validare lo
//    schema dell'URL, perche' non esiste un href da avvelenare: la superficie non e'
//    filtrata, e' assente. Il costo e' che l'utente non puo' cliccare per verificare i
//    profili importati; la validazione http/https servira' a chi quei campi li rende
//    davvero come link (il sito generato, P2).
//
// Perche' un `Input` anche per `description` (2000 caratteri, P1-D17): le primitive di
// T-021 sono Button/Input/Label/Card e non c'e' una textarea. Il recap completo con i
// campi lunghi e' T-152, che e' la sede dichiarata del textarea (vedi il commento sui
// tetti in brief.ts): qui non si aggiunge una primitiva per anticiparlo.

// P1-D13 — gli orari NON sono raccoglibili dalla chat (il tool update_brief non ha
// `hours`, perche' e' un record a chiavi libere e lo strict tool use non lo esprime), e
// fromUrl li riempie solo se il sito pubblica un JSON-LD openingHours. Se questo
// pannello non li rendesse editabili, il dato non entrerebbe MAI nel brief. Editor
// volutamente elementare: coppie giorno/orario, nessun widget speculativo (nessun
// calendario, nessuna normalizzazione degli intervalli: la forma dei valori la decide
// l'utente e la ri-valida T-121).
type HoursRow = { key: string; value: string };

// Gli enum del brief sono ridichiarati qui perche' brief.ts non li esporta e T-151 non
// puo' toccarlo. RISCHIO DICHIARATO: se l'allowlist di T-121 cambiasse, questa copia
// divergerebbe in silenzio. Mitigazione eseguibile: un test lega ogni valore offerto
// qui a BriefUpdateSchema, cosi' una rinomina non resta muta.
export const VERTICAL_OPTIONS = [
  'ristorazione',
  'fitness',
  'salone_studio',
  'negozio_artigiano',
  'altro',
] as const;
export const GOAL_OPTIONS = ['prenota', 'ordina', 'contatta'] as const;

// Campi di testo libero: nome del campo nel brief + chiave i18n dell'etichetta. La
// coppia sta in UN posto solo, cosi' etichetta e campo non possono disallinearsi.
const TEXT_FIELDS = [
  ['business_name', 'fields.businessName'],
  ['description', 'fields.description'],
  ['address', 'fields.address'],
  ['phone', 'fields.phone'],
  ['whatsapp', 'fields.whatsapp'],
  ['email', 'fields.email'],
] as const;

type TextFieldName = (typeof TEXT_FIELDS)[number][0];
type DraftKey = TextFieldName | 'vertical' | 'primary_goal';

// La patch e' un sottoinsieme di BriefUpdateSchema: solo i campi che questo pannello
// rende editabili. Non e' una ri-dichiarazione dello schema — la validazione resta
// server-side — ma il tipo di cio' che si spedisce.
export type BriefPanelPatch = Partial<{
  business_name: string;
  description: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  vertical: Brief['vertical'];
  primary_goal: NonNullable<Brief['primary_goal']>;
  hours: Record<string, string>;
}>;

type BriefPanelProps = {
  siteId: string;
  // Cio' che il pannello MOSTRA e che l'utente sta modificando: include il
  // pre-riempimento di un import, che e' una proposta non ancora salvata.
  brief: Brief;
  // Cio' che il DB CONTIENE, secondo l'ultima lettura/scrittura. E' la base del diff, e
  // deve essere distinto da `brief`: se il diff si calcolasse contro cio' che si vede,
  // una proposta di import — che pre-riempie la vista — non risulterebbe mai una
  // modifica e la conferma non scriverebbe NULLA. E' il modo esatto in cui questo
  // pannello e' stato sbagliato la prima volta, e il test dell'import lo pinna.
  persisted: Brief;
  // Il pannello non e' la sorgente di verita' del brief: chi lo contiene la tiene e la
  // aggiorna quando una scrittura e' andata a buon fine.
  onSaved: (patch: BriefPanelPatch) => void;
};

function asVertical(value: string): Brief['vertical'] | undefined {
  return VERTICAL_OPTIONS.find((option) => option === value);
}

function asGoal(value: string): NonNullable<Brief['primary_goal']> | undefined {
  return GOAL_OPTIONS.find((option) => option === value);
}

// Confronto per valore di due mappe di orari: serve a non spedire `hours` quando
// l'utente ha aperto l'editor e non ha cambiato nulla.
function sameHours(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.hasOwn(b, key) && a[key] === b[key]);
}

export function BriefPanel({ siteId, brief, persisted, onSaved }: BriefPanelProps) {
  const t = useTranslations('onboarding');
  // Solo i campi TOCCATI vivono nel draft: un campo assente dal draft mostra il valore
  // di `brief`. La patch e' il DIFF fra il valore EFFETTIVO (draft, altrimenti brief) e
  // `persisted` — quindi una modifica al solo whatsapp spedisce whatsapp e nient'altro, e
  // non si riscrivono campi che l'utente non ha toccato.
  //
  // SCELTA DICHIARATA — l'ultima parola e' dell'UTENTE. Cio' che l'utente ha toccato non
  // viene sovrascritto da un valore che arriva DOPO (il brief salvato di un turno di chat,
  // o il pre-riempimento di un import): vale per i campi nel `draft` e per l'editor degli
  // orari, che dal primo tocco e' suo per intero. Non e' una dimenticanza: cancellare
  // sotto le dita quello che si sta scrivendo e' un danno immediato e non annullabile,
  // mentre il valore che arriva resta in `brief` e ricompare appena il campo torna non
  // toccato (un salvataggio riuscito azzera draft e righe). Comportamento PINNATO in
  // ENTRAMBE le direzioni dai test — anche la meta' opposta, cioe' che i campi NON toccati
  // si aggiornano: il difetto rilevato non era la direzione, era che nessuna delle due
  // era asserita, e una ri-sincronizzazione aggiunta per svista sarebbe passata muta.
  //
  // COSTO DICHIARATO: chi tocca l'editor degli orari PRIMA di importare non vede gli orari
  // importati (P1-D13: l'import e' l'unica sorgente automatica di `hours`) finche' non
  // salva — al salvataggio le righe tornano dal brief, che l'import ha aggiornato.
  const [draft, setDraft] = useState<Partial<Record<DraftKey, string>>>({});
  // null = editor orari non toccato (si mostrano le coppie del brief).
  const [hoursRows, setHoursRows] = useState<HoursRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const rows: HoursRow[] =
    hoursRows ?? Object.entries(brief.hours ?? {}).map(([key, value]) => ({ key, value }));

  const textValue = (name: TextFieldName): string => draft[name] ?? brief[name] ?? '';
  const setField = (name: DraftKey, value: string) =>
    setDraft((current) => ({ ...current, [name]: value }));

  const updateRow = (index: number, patch: Partial<HoursRow>) =>
    setHoursRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function buildPatch(): BriefPanelPatch {
    const text: Partial<Record<TextFieldName, string>> = {};
    for (const [name] of TEXT_FIELDS) {
      // Si spedisce anche la stringa vuota (l'utente ha svuotato il campo): decidere qui
      // che "vuoto = non inviare" renderebbe impossibile cancellare un valore, e per i
      // campi che il vuoto non ammette (business_name ha .min(1) in T-121) il rifiuto
      // arriva dal gate server-side, che e' la sede giusta.
      const value = textValue(name);
      if (value === (persisted[name] ?? '')) continue;
      text[name] = value;
    }
    const patch: BriefPanelPatch = { ...text };

    // Gli enum non si possono SVUOTARE dal pannello: l'allowlist di T-121 non ammette
    // la stringa vuota, quindi spedirla sarebbe un 400 garantito e un dato perso.
    const vertical = asVertical(draft.vertical ?? brief.vertical);
    if (vertical !== undefined && vertical !== persisted.vertical) patch.vertical = vertical;
    const goal = asGoal(draft.primary_goal ?? brief.primary_goal ?? '');
    if (goal !== undefined && goal !== persisted.primary_goal) patch.primary_goal = goal;

    // Le righe con giorno vuoto si scartano: una riga appena aggiunta e lasciata in
    // bianco non e' un orario, e una chiave '' non ha significato.
    const nextHours = Object.fromEntries(
      rows.filter((row) => row.key.trim().length > 0).map((row) => [row.key.trim(), row.value]),
    );
    if (!sameHours(nextHours, persisted.hours ?? {})) patch.hours = nextHours;

    return patch;
  }

  // QUI, e solo qui, avviene la scrittura sul DB: alla conferma esplicita. Ne' il
  // render, ne' la digitazione, ne' il pre-riempimento dell'import passano da questa
  // funzione — la proposta di fromUrl resta in memoria finche' l'utente non conferma.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = buildPatch();
    // Nessuna modifica: nessuna richiesta. Una patch vuota sarebbe una scrittura che
    // riscrive lo stesso stato e tocca updated_at per nulla.
    if (Object.keys(patch).length === 0) return;

    setPending(true);
    setFailed(false);
    const result = await upsertBrief(siteId, patch);
    setPending(false);
    if (!result.ok) {
      // MESSAGGIO GENERICO: lo status di upsertBrief (400/401/404/500) non si mostra,
      // e in particolare 404 non si distingue dal resto — sarebbe un oracolo di
      // enumerazione dei siti altrui (P1-D21).
      setFailed(true);
      return;
    }
    setDraft({});
    setHoursRows(null);
    onSaved(patch);
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">{t('panel.title')}</h2>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          {TEXT_FIELDS.map(([name, labelKey]) => (
            <div key={name} className="flex flex-col gap-xs">
              <Label htmlFor={`brief-${name}`}>{t(labelKey)}</Label>
              <Input
                id={`brief-${name}`}
                value={textValue(name)}
                onChange={(event) => setField(name, event.target.value)}
              />
            </div>
          ))}

          <div className="flex flex-col gap-xs">
            <Label htmlFor="brief-vertical">{t('fields.vertical')}</Label>
            <select
              id="brief-vertical"
              value={draft.vertical ?? brief.vertical}
              onChange={(event) => setField('vertical', event.target.value)}
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
            <Label htmlFor="brief-primary-goal">{t('fields.primaryGoal')}</Label>
            <select
              id="brief-primary-goal"
              value={draft.primary_goal ?? brief.primary_goal ?? ''}
              onChange={(event) => setField('primary_goal', event.target.value)}
              className="rounded-md border border-border bg-background px-md py-sm text-sm text-foreground"
            >
              {/* Un brief in bozza puo' non avere ancora un obiettivo: l'opzione vuota
                  rappresenta quello stato, e non viene mai spedita (vedi buildPatch). */}
              <option value="">{t('panel.notChosen')}</option>
              {GOAL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(`goals.${option}`)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="flex flex-col gap-sm border-0 p-0">
            <legend className="text-sm font-medium text-foreground">{t('fields.hours')}</legend>
            {rows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-sm">
                {/* Etichette POSIZIONALI e localizzate: le chiavi degli orari sono
                    libere (e non fidate, possono venire da un JSON-LD altrui), quindi
                    non si usa il giorno come etichetta del proprio campo. */}
                <Input
                  aria-label={t('panel.hoursDay', { n: String(index + 1) })}
                  value={row.key}
                  onChange={(event) => updateRow(index, { key: event.target.value })}
                  className="max-w-xs"
                />
                <Input
                  aria-label={t('panel.hoursValue', { n: String(index + 1) })}
                  value={row.value}
                  onChange={(event) => updateRow(index, { value: event.target.value })}
                  className="max-w-xs"
                />
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setHoursRows([...rows, { key: '', value: '' }])}
            >
              {t('panel.hoursAdd')}
            </Button>
          </fieldset>

          <Button type="submit" disabled={pending}>
            {t('panel.save')}
          </Button>

          {failed && (
            <p role="alert" className="text-sm font-medium text-foreground">
              {t('panel.saveError')}
            </p>
          )}
        </form>

        {/* Campi resi in SOLA LETTURA: raccolti dalla chat (T-132) o dall'import
            (T-141), il loro editing completo e' la schermata Rivedi&conferma (T-152).
            Tutti in nodi di TESTO: nessun href/src, nemmeno per social_links e
            photo_ref, che di quei campi sono la destinazione naturale. */}
        <dl className="mt-lg flex flex-col gap-sm">
          {brief.geo && (
            <div className="flex flex-col">
              <dt className="text-sm font-medium text-foreground">{t('fields.geo')}</dt>
              <dd className="text-sm text-muted-foreground">{`${brief.geo.lat}, ${brief.geo.lng}`}</dd>
            </div>
          )}
          {brief.content.offerings.length > 0 && (
            <div className="flex flex-col">
              <dt className="text-sm font-medium text-foreground">{t('panel.offerings')}</dt>
              <dd>
                <ul className="flex flex-col gap-xs">
                  {brief.content.offerings.map((offering, index) => (
                    <li key={`${offering.name}-${index}`} className="text-sm text-muted-foreground">
                      {[
                        offering.name,
                        offering.section,
                        offering.price,
                        offering.description,
                        offering.photo_ref,
                      ]
                        .filter(
                          (part): part is string => typeof part === 'string' && part.length > 0,
                        )
                        .join(' · ')}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {brief.content.highlights.length > 0 && (
            <div className="flex flex-col">
              <dt className="text-sm font-medium text-foreground">{t('panel.highlights')}</dt>
              <dd>
                <ul className="flex flex-col gap-xs">
                  {brief.content.highlights.map((highlight, index) => (
                    <li key={`${highlight}-${index}`} className="text-sm text-muted-foreground">
                      {highlight}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {brief.content.social_links.length > 0 && (
            <div className="flex flex-col">
              <dt className="text-sm font-medium text-foreground">{t('panel.socialLinks')}</dt>
              <dd>
                <ul className="flex flex-col gap-xs">
                  {brief.content.social_links.map((link, index) => (
                    <li key={`${link}-${index}`} className="text-sm text-muted-foreground">
                      {link}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {brief.content.brand_hints && (
            <div className="flex flex-col">
              <dt className="text-sm font-medium text-foreground">{t('panel.brandHints')}</dt>
              <dd className="text-sm text-muted-foreground">{brief.content.brand_hints}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
