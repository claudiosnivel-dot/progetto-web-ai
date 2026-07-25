// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-151 (macrotask onboarding-ui, P1) — ORACOLO dei componenti di onboarding:
// ChatPanel, BriefPanel (con orari editabili) e UrlImportBar. Le asserzioni derivano
// da AC-151-1..4 di 04-onboarding-ui.md; ognuna e' taggata `// covers: AC-151-<n>`.
//
// Cosa si mocka e perche' NON e' hollow:
//  - `@/data/briefs` upsertBrief: il seam dati della scrittura (T-123). E' l'unico
//    modo di osservare CON QUALE PATCH il pannello scrive, che e' il cuore di AC-151-2.
//  - `@/domain/import/fromUrl` (NON la Server Action): AC-151-3 pretende una `fromUrl`
//    mockata, quindi la Server Action di import gira PER DAVVERO — il suo gate di
//    sessione, la validazione dell'input e il fatto che non persista nulla sono provati
//    sul codice di produzione, non su un doppio.
//  - `@/data/supabase-ssr` getUser: l'identita' che quel gate pretende.
//  - `fetch` globale: il trasporto NDJSON dell'endpoint di T-150 (P1-D18). Il turno di
//    chat e' consumato dal codice di produzione; i due chunk sono quelli che T-150 emette.
// NON si mocka next-intl: le stringhe si risolvono dai cataloghi REALI it/es dentro
// NextIntlClientProvider, lo stesso provider del layout. Cosi' AC-151-4 misura la
// SCELTA DELLE CHIAVI fatta dai componenti, non stringhe passate dal test.
//
// Trappole tautologiche evitate deliberatamente (su T-150 tre mutazioni sono
// sopravvissute proprio a fixture da un solo elemento):
//  - il brief di fixture ha SEI campi di testo distinti, DUE voci di offerta, DUE
//    chiavi di orario e valori tutti diversi: mappare un campo sull'input di un altro
//    e' osservabile;
//  - la patch che arriva a upsertBrief e' asserita per UGUAGLIANZA ESATTA, non per
//    "contiene": una patch che rispedisce tutto il brief muore;
//  - la proposta di import ha TRE campi, e il brief di partenza ne ha valori diversi:
//    un pre-riempimento parziale o incrociato e' osservabile.

const { upsertBriefSpy, getBriefSpy, briefsHolder } = vi.hoisted(() => {
  const holder = {
    upsertResult: { ok: true, complete: false } as unknown,
    // Risposta di getBrief: serve al test di MONTAGGIO, che esegue la pagina di T-150 per
    // davvero (la pagina carica il brief e lo passa al workspace come prop).
    getResult: { ok: true, brief: null, status: null, complete: false } as unknown,
    calls: [] as unknown[][],
  };
  return {
    briefsHolder: holder,
    getBriefSpy: vi.fn(async () => holder.getResult),
    upsertBriefSpy: vi.fn(async (...args: unknown[]) => {
      holder.calls.push(args);
      return holder.upsertResult;
    }),
  };
});
vi.mock('@/data/briefs', () => ({ upsertBrief: upsertBriefSpy, getBrief: getBriefSpy }));

// Seam di PROPRIETA' del sito (P1-D21): la pagina di T-150 accerta con listSites che il
// sito sia dell'utente PRIMA di leggere il brief. Qui non si ri-verifica quella guardia
// (e' l'oracolo di T-150): si fornisce il valore che la fa passare, perche' senza di
// esso la pagina non arriverebbe mai a montare i pannelli.
const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

// redirect/notFound lanciano davvero, come in Next: cosi' un montaggio che passasse per
// una guardia negata non renderebbe nulla invece di rendere a meta'. usePathname serve
// ad AppShell (T-022), che avvolge la pagina.
const { redirectSpy, notFoundSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn(() => {
    throw new Error('redirect');
  }),
  notFoundSpy: vi.fn(() => {
    throw new Error('not-found');
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
  notFound: notFoundSpy,
  usePathname: () => '/it/onboarding/site-of-a',
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  type LinkProps = { href: string; children?: ReactNode; 'aria-current'?: 'page' };
  return {
    default: ({ href, children, ...rest }: LinkProps) =>
      createElement('a', { href, ...rest }, children),
  };
});

// Le stringhe della CHROME di pagina (titolo, stato del brief) sono server-side: si
// risolvono dal catalogo REALE it, come fa l'oracolo di T-150. Quelle dei PANNELLI, che
// sono cio' che qui interessa, restano client-side e passano dal provider vero.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ namespace }: { locale: string; namespace: string }) => {
    const ns = ((itMessages as Record<string, unknown>)[namespace] ?? {}) as Record<
      string,
      unknown
    >;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

const { fromUrlSpy, importHolder } = vi.hoisted(() => {
  const holder = { proposal: null as unknown, calls: [] as unknown[][] };
  return {
    importHolder: holder,
    fromUrlSpy: vi.fn(async (...args: unknown[]) => {
      holder.calls.push(args);
      return holder.proposal;
    }),
  };
});
vi.mock('@/domain/import/fromUrl', () => ({ fromUrl: fromUrlSpy }));

const { authHolder } = vi.hoisted(() => ({
  authHolder: { user: null as { id: string } | null },
}));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

// Import DOPO i mock (vi.mock e' hoisted).
import { OnboardingWorkspace, mergeProposal } from '@/ui/onboarding/OnboardingWorkspace';
import { VERTICAL_OPTIONS, GOAL_OPTIONS } from '@/ui/onboarding/brief-fields';
import { importBriefFromUrl } from '@/data/import';
import OnboardingPage from '@/app/[locale]/onboarding/[siteId]/page';
import {
  applyBriefUpdate,
  emptyBrief,
  BriefUpdateSchema,
  BRIEF_LIMITS,
} from '@/domain/onboarding/brief';

const SITE_ID = 'site-of-a';
// Secondo id: il siteId con cui si scrive e a cui si manda il turno di chat deve essere
// QUELLO DELLA PROP, non un valore qualunque in scope.
const OTHER_SITE_ID = 'site-of-b';

const PHONE = '+39 06 1234567';
const WHATSAPP = '+39 333 1112222';
const NEW_WHATSAPP = '+39 333 9998887';

// Brief di fixture costruito col codice di dominio REALE (T-121/T-122): la forma non
// puo' divergere da quella che getBrief restituisce.
const DRAFT_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Bar Sole',
  vertical: 'ristorazione',
  description: 'Caffe e cornetti in centro',
  address: 'Via Roma 1, Roma',
  phone: PHONE,
  whatsapp: WHATSAPP,
  email: 'ciao@barsole.example',
  primary_goal: 'ordina',
  hours: { mo: '07:00-19:00', tu: '10:00-23:00' },
  geo: { lat: 41.9, lng: 12.5 },
  offerings: [
    { name: 'Cornetto', price: '1,20', section: 'Colazione' },
    { name: 'Caffe', price: '1,10', section: 'Colazione' },
  ],
  highlights: ['Wi-Fi gratis', 'Tavoli fuori'],
  social_links: ['https://social.example/barsole'],
  brand_hints: 'Toni caldi',
}).brief;

// Brief quasi vuoto: e' su questo che il pre-riempimento dell'import e' OSSERVABILE.
const BLANK_BRIEF = emptyBrief('it');

// Etichette risolte dal catalogo: gli orari usano un'etichetta ICU posizionale, e
// ricopiarla a mano nel test la scollegherebbe dalla sorgente di verita'.
const label = (template: string, n: number) => template.replace('{n}', String(n));

function renderWorkspace(locale: 'it' | 'es', brief: unknown = DRAFT_BRIEF, siteId = SITE_ID) {
  return render(
    <Wrapper locale={locale}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <OnboardingWorkspace siteId={siteId} initialBrief={brief as any} />
    </Wrapper>,
  );
}

function Wrapper({ locale, children }: { locale: 'it' | 'es'; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? esMessages : itMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

// Corpo NDJSON come lo emette T-150: una riga JSON per chunk, '\n' come separatore.
function ndjson(lines: unknown[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });
}

// `respond` e' pilotato dal test: e' la risposta che l'endpoint di T-150 darebbe.
const fetchHolder = {
  calls: [] as unknown[][],
  respond: (() => ndjson([])) as () => Response,
};
const fetchSpy = vi.fn(async (...args: unknown[]) => {
  fetchHolder.calls.push(args);
  return fetchHolder.respond();
});

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  briefsHolder.upsertResult = { ok: true, complete: false };
  briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: false };
  briefsHolder.calls.length = 0;
  sitesHolder.list = { ok: true, sites: [{ id: SITE_ID, name: 'Officina di A' }] };
  getBriefSpy.mockClear();
  listSitesSpy.mockClear();
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  importHolder.proposal = null;
  importHolder.calls.length = 0;
  upsertBriefSpy.mockClear();
  fromUrlSpy.mockClear();
  fetchSpy.mockClear();
  fetchHolder.calls.length = 0;
  fetchHolder.respond = () => ndjson([]);
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// T151-V05 — il deliverable di T-151 non era RAGGIUNGIBILE dall'applicazione: nessun
// modulo sotto src/app importava OnboardingWorkspace, quindi `npm run build` passava ma i
// componenti erano assenti da .next/static e l'unica cosa che li eseguiva era questo file.
// "Il componente esiste e si comporta bene" e' una proprieta' piu' debole di "la rotta lo
// rende": questa suite asserisce la seconda, eseguendo la PAGINA di T-150 per davvero
// (guardie comprese) e rendendo il suo albero dentro lo STESSO provider next-intl che il
// layout /[locale] mette sopra ogni rotta — cioe' il modello completo della rotta, non
// solo del componente.
describe('T-151 la rotta monta davvero i pannelli (T151-V05)', () => {
  const renderRoute = async (siteId = SITE_ID, locale: 'it' | 'es' = 'it') => {
    const ui = await OnboardingPage({ params: Promise.resolve({ locale, siteId }) });
    return render(<Wrapper locale={locale}>{ui}</Wrapper>);
  };

  it('la pagina rende BriefPanel, ChatPanel e UrlImportBar col brief caricato via getBrief', async () => {
    briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: false };
    await renderRoute();
    const onboarding = itMessages.onboarding;

    // Le guardie hanno concesso l'accesso (non-vacuita': il montaggio non e' osservato
    // su una pagina che avrebbe dovuto negare).
    expect(listSitesSpy).toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(getBriefSpy).toHaveBeenCalledWith(SITE_ID);

    // I TRE pannelli sono nel DOM della rotta, dentro il landmark <main> di AppShell.
    const main = within(screen.getByRole('main'));
    expect(main.getByText(onboarding.panel.title)).toBeTruthy();
    expect(main.getByText(onboarding.chat.title)).toBeTruthy();
    expect(main.getByLabelText(onboarding.import.url)).toBeTruthy();
    expect(main.getByRole('button', { name: onboarding.panel.save })).toBeTruthy();
    expect(main.getByLabelText(onboarding.chat.message)).toBeTruthy();

    // E il brief che la PAGINA ha caricato e' quello che il pannello mostra: senza
    // questa asserzione un workspace montato con un brief vuoto (o con una fixture
    // propria) passerebbe le precedenti.
    expect((main.getByLabelText(onboarding.fields.businessName) as HTMLInputElement).value).toBe(
      'Bar Sole',
    );
    expect((main.getByLabelText(onboarding.fields.whatsapp) as HTMLInputElement).value).toBe(
      WHATSAPP,
    );
    // Anche i campi che solo il pannello di T-151 rende (P1-D13: gli orari).
    expect(
      (main.getByLabelText(label(onboarding.panel.hoursDay, 1)) as HTMLInputElement).value,
    ).toBe('mo');
  });

  // Il montaggio non e' solo presenza nel DOM: il pannello reso dalla rotta deve essere
  // CABLATO al siteId della rotta. E' la meta' che una pagina con un pannello decorativo
  // (props sbagliate, o un siteId preso da altrove) non soddisfa.
  it('il pannello reso dalla rotta scrive sul siteId della ROTTA', async () => {
    briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: false };
    sitesHolder.list = { ok: true, sites: [{ id: OTHER_SITE_ID, name: 'Panetteria di B' }] };
    const user = userEvent.setup();
    await renderRoute(OTHER_SITE_ID);

    const whatsapp = screen.getByLabelText(itMessages.onboarding.fields.whatsapp);
    await user.clear(whatsapp);
    await user.type(whatsapp, NEW_WHATSAPP);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(upsertBriefSpy).toHaveBeenCalledWith(OTHER_SITE_ID, { whatsapp: NEW_WHATSAPP });
  });

  // T152-V08 — la schermata Rivedi&conferma (T-152) non era RAGGIUNGIBILE dall'applicazione:
  // nessun href e nessun push la nominavano, cioe' lo stesso difetto che T151-V05 aveva
  // trovato sui pannelli, un passo piu' avanti. Il collegamento vive nel workspace che
  // questa rotta monta, e NON e' condizionato a `readyForReview`: quel flag lo decide il
  // modello ed e' prompt-injectable (SESSION-STATE §7 p.10), quindi legarci l'accesso
  // vorrebbe dire che un'iniezione — o un modello che non lo dichiara mai — chiude l'ultimo
  // passo dell'onboarding. Qui NESSUN turno di chat e' avvenuto e la strada c'e' comunque.
  it('la rotta offre il collegamento a Rivedi&conferma, gia al primo render e senza readyForReview', async () => {
    briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: false };
    await renderRoute();
    const main = within(screen.getByRole('main'));

    const link = main.getByRole('link', { name: itMessages.onboarding.review.title });
    expect(link.getAttribute('href')).toBe(`/it/onboarding/${SITE_ID}/review`);
    // Non-vacuita': nessun chunk `brief` e' arrivato, quindi nessun invito del modello e'
    // a schermo — il link non sta dietro a quel flag.
    expect(screen.queryByText(itMessages.onboarding.readiness.readyForReview)).toBeNull();
  });

  // Il collegamento e' CABLATO alla rotta: il siteId e' quello della rotta (non il primo
  // sito posseduto) e il locale resta quello della rotta, dall'allowlist.
  it('il collegamento a Rivedi&conferma porta al siteId e al locale della ROTTA', async () => {
    briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: false };
    sitesHolder.list = { ok: true, sites: [{ id: OTHER_SITE_ID, name: 'Panetteria di B' }] };
    await renderRoute(OTHER_SITE_ID, 'es');
    const main = within(screen.getByRole('main'));

    const link = main.getByRole('link', { name: esMessages.onboarding.review.title });
    expect(link.getAttribute('href')).toBe(`/es/onboarding/${OTHER_SITE_ID}/review`);
    expect(main.queryByRole('link', { name: `/it/onboarding/${SITE_ID}/review` })).toBeNull();
  });

  // Il locale del collegamento e' vincolato all'ALLOWLIST prima di essere interpolato (come
  // T-044) e quel ramo NON era osservabile: con il provider sempre su un locale valido, un
  // `/${rawLocale}/onboarding/...` passerebbe ogni asserzione di questo file. Qui il provider
  // porta un locale che non e' nell'allowlist — cio' che si vedrebbe se il layout smettesse di
  // validarlo, che e' la ragione per cui la guardia esiste — e la destinazione resta sul
  // locale di default. Si usa un tag BCP47 VALIDO ma non elencato: basta a osservare
  // l'allowlist, e non fa esplodere la formattazione ICU delle etichette per un motivo che non
  // e' quello in prova.
  it('locale fuori allowlist: il collegamento a Rivedi&conferma non interpola il valore grezzo', () => {
    render(
      <NextIntlClientProvider locale="en" messages={itMessages}>
        <OnboardingWorkspace siteId={SITE_ID} initialBrief={DRAFT_BRIEF} />
      </NextIntlClientProvider>,
    );

    const link = screen.getByRole('link', { name: itMessages.onboarding.review.title });
    expect(link.getAttribute('href')).toBe(`/it/onboarding/${SITE_ID}/review`);
    expect(link.getAttribute('href')).not.toContain('/en/');
  });

  // Sito PROPRIO senza brief ancora creato (getBrief → brief:null, caso legittimo): la
  // pagina non ha un brief da passare e usa emptyBrief(locale). Pinna quel ramo: un
  // `initialBrief` nullable farebbe crollare il pannello sul primo `brief.content`.
  it('sito proprio senza brief: i pannelli sono resi comunque, vuoti ed editabili', async () => {
    briefsHolder.getResult = { ok: true, brief: null, status: null, complete: false };
    await renderRoute();

    expect(notFoundSpy).not.toHaveBeenCalled();
    const main = within(screen.getByRole('main'));
    expect(main.getByText(itMessages.onboarding.panel.title)).toBeTruthy();
    const name = main.getByLabelText(itMessages.onboarding.fields.businessName);
    expect((name as HTMLInputElement).value).toBe('');
    // vertical parte dal default dello schema di T-121, non da un valore inventato qui.
    expect((main.getByLabelText(itMessages.onboarding.fields.vertical) as HTMLSelectElement).value)
      .toBe('altro');
  });
});

describe('T-151 BriefPanel: rende i campi del brief', () => {
  // covers: AC-151-1
  it('brief con business_name="Bar Sole": il campo corrispondente mostra "Bar Sole"', () => {
    renderWorkspace('it');
    const fields = itMessages.onboarding.fields;

    const businessName = screen.getByLabelText(fields.businessName) as HTMLInputElement;
    expect(businessName.value).toBe('Bar Sole'); // covers: AC-151-1

    // Ogni campo nel PROPRIO input: sei valori distinti rendono osservabile una
    // mappatura incrociata (whatsapp reso nel campo phone e viceversa).
    expect((screen.getByLabelText(fields.phone) as HTMLInputElement).value).toBe(PHONE); // covers: AC-151-1
    expect((screen.getByLabelText(fields.whatsapp) as HTMLInputElement).value).toBe(WHATSAPP); // covers: AC-151-1
    expect((screen.getByLabelText(fields.description) as HTMLInputElement).value).toBe(
      'Caffe e cornetti in centro',
    ); // covers: AC-151-1
    expect((screen.getByLabelText(fields.address) as HTMLInputElement).value).toBe(
      'Via Roma 1, Roma',
    ); // covers: AC-151-1
    expect((screen.getByLabelText(fields.email) as HTMLInputElement).value).toBe(
      'ciao@barsole.example',
    ); // covers: AC-151-1

    // Gli enum sono resi con l'etichetta LOCALIZZATA, non col valore grezzo.
    expect((screen.getByLabelText(fields.vertical) as HTMLSelectElement).value).toBe(
      'ristorazione',
    ); // covers: AC-151-1
    expect((screen.getByLabelText(fields.primaryGoal) as HTMLSelectElement).value).toBe('ordina'); // covers: AC-151-1
    expect(screen.queryByText('salone_studio')).toBeNull(); // covers: AC-151-1

    // Le due voci di offerta sono rese entrambe: con una sola, "rende le offerte"
    // sarebbe vero anche rendendo solo la prima.
    expect(screen.getByText(/Cornetto/)).toBeTruthy(); // covers: AC-151-1
    expect(screen.getByText(/Caffe/)).toBeTruthy(); // covers: AC-151-1
    expect(screen.getByText(/Wi-Fi gratis/)).toBeTruthy(); // covers: AC-151-1
  });

  // T151-V11 — nessun test rendeva un valore AL TETTO di P1-D17, e `description` (tetto
  // 2000 code unit) e' proprio il campo che ha motivato l'emendamento: una pagina da
  // ~900 KB produceva un `description` da 900.000 caratteri. Il tetto lo taglia a 2000,
  // ma 2000 code unit in un `Input` a RIGA SINGOLA restano scomodi.
  // SCELTA DICHIARATA: la textarea NON si aggiunge qui. Le primitive di T-021 sono
  // Button/Input/Label/Card e la sede del recap con i campi lunghi e' T-152 (che P1-D17
  // nomina esplicitamente); introdurre una primitiva nuova in T-151 sarebbe fuori scope.
  // Cio' che si aggiunge e' l'ASSERZIONE, che costa zero: il valore al tetto e' reso PER
  // INTERO (mai troncato dalla UI — la troncatura e' corruzione silenziosa, P1-D17) e il
  // controllo che lo rende e' un input a riga singola. Quando T-152 mettera' la textarea,
  // l'ultima riga diventera' rossa: e' il promemoria eseguibile della scelta.
  it('un valore al TETTO di P1-D17 e reso per intero, in un Input a riga singola (scelta dichiarata)', () => {
    const atCeiling = 'x'.repeat(BRIEF_LIMITS.description);
    const applied = applyBriefUpdate(emptyBrief('it'), { description: atCeiling });
    // Non-vacuita': il tetto AMMETTE questo valore (a 2001 sarebbe scartato), quindi il
    // caso reso e' davvero il caso limite e non un valore che il dominio rifiuta.
    expect(applied.rejected).toEqual([]);
    expect(applied.brief.description).toHaveLength(BRIEF_LIMITS.description);
    expect(
      applyBriefUpdate(emptyBrief('it'), { description: `${atCeiling}x` }).rejected,
    ).toContain('description');

    renderWorkspace('it', applied.brief);
    const field = screen.getByLabelText(
      itMessages.onboarding.fields.description,
    ) as HTMLInputElement;
    expect(field.value).toHaveLength(BRIEF_LIMITS.description); // reso per intero
    expect(field.tagName).toBe('INPUT'); // riga singola: la textarea e' T-152
    // E la UI non e' il gate nemmeno sulla lunghezza: nessun maxlength che nasconda il
    // rifiuto server-side di P1-D17.
    expect(field.getAttribute('maxlength')).toBeNull();
  });

  // covers: AC-151-1
  // P1-D13 — `hours` non e' raccoglibile dalla chat: se il pannello non lo rende
  // editabile il dato non entra MAI nel brief. Due chiavi con valori DIVERSI: con una
  // sola, leggere sempre la prima coppia sarebbe indistinguibile.
  it('gli orari sono resi come coppie giorno/orario editabili, una riga per chiave', () => {
    renderWorkspace('it');
    const panel = itMessages.onboarding.panel;

    expect(screen.getByText(itMessages.onboarding.fields.hours)).toBeTruthy(); // covers: AC-151-1
    expect((screen.getByLabelText(label(panel.hoursDay, 1)) as HTMLInputElement).value).toBe('mo'); // covers: AC-151-1
    expect((screen.getByLabelText(label(panel.hoursValue, 1)) as HTMLInputElement).value).toBe(
      '07:00-19:00',
    ); // covers: AC-151-1
    expect((screen.getByLabelText(label(panel.hoursDay, 2)) as HTMLInputElement).value).toBe('tu'); // covers: AC-151-1
    expect((screen.getByLabelText(label(panel.hoursValue, 2)) as HTMLInputElement).value).toBe(
      '10:00-23:00',
    ); // covers: AC-151-1
  });
});

describe('T-151 BriefPanel: edit manuale di un campo → upsertBrief', () => {
  // covers: AC-151-2
  it('modifica di whatsapp e conferma: upsertBrief riceve QUEL campo con il valore modificato', async () => {
    const user = userEvent.setup();
    renderWorkspace('it');

    const whatsapp = screen.getByLabelText(itMessages.onboarding.fields.whatsapp);
    await user.clear(whatsapp);
    await user.type(whatsapp, NEW_WHATSAPP);

    // LA SCRITTURA NON E' ANCORA AVVENUTA: digitare non salva. E' l'altra meta' di
    // AC-151-2 ("e conferma") e la stessa proprieta' che il vincolo 4 pretende.
    expect(upsertBriefSpy).not.toHaveBeenCalled(); // covers: AC-151-2

    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-2
    // UGUAGLIANZA ESATTA: la patch porta il valore MODIFICATO di whatsapp e NIENT'ALTRO.
    // Una patch che rispedisce tutto il brief (o il valore vecchio) muore qui.
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { whatsapp: NEW_WHATSAPP }); // covers: AC-151-2
  });

  // covers: AC-151-2
  it('il siteId della scrittura e quello della prop, non un altro sito', async () => {
    const user = userEvent.setup();
    renderWorkspace('it', DRAFT_BRIEF, OTHER_SITE_ID);

    const phone = screen.getByLabelText(itMessages.onboarding.fields.phone);
    await user.clear(phone);
    await user.type(phone, '+39 06 0000001');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-2
    expect(upsertBriefSpy).toHaveBeenCalledWith(OTHER_SITE_ID, { phone: '+39 06 0000001' }); // covers: AC-151-2
  });

  // covers: AC-151-2
  // P1-D13: la prova che il campo orari SERVE a qualcosa e' che il valore modificato
  // arriva a upsertBrief. La patch porta la mappa INTERA (record: una patch parziale
  // cancellerebbe le chiavi assenti), con la chiave toccata modificata e l'altra intatta.
  it('modifica di un orario e conferma: upsertBrief riceve hours con la chiave modificata', async () => {
    const user = userEvent.setup();
    renderWorkspace('it');

    const tuesday = screen.getByLabelText(label(itMessages.onboarding.panel.hoursValue, 2));
    await user.clear(tuesday);
    await user.type(tuesday, '11:00-15:00');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-2
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, {
      hours: { mo: '07:00-19:00', tu: '11:00-15:00' },
    }); // covers: AC-151-2
  });

  // upsertBrief e' mockata in tutta questa suite, quindi nulla proverebbe che la patch
  // del pannello sia una patch che il GATE accetta: un nome di campo sbagliato, o `hours`
  // con una chiave fuori tetto, passerebbe ogni asserzione qui e prenderebbe un 400 in
  // produzione. Si valida la patch REALMENTE catturata con lo schema REALE di T-121.
  it('la patch prodotta dal pannello e accettata da BriefUpdateSchema (strict)', async () => {
    const user = userEvent.setup();
    renderWorkspace('it');
    const fields = itMessages.onboarding.fields;

    // Una patch con piu' campi di natura diversa: testo, enum e la mappa degli orari.
    const whatsapp = screen.getByLabelText(fields.whatsapp);
    await user.clear(whatsapp);
    await user.type(whatsapp, NEW_WHATSAPP);
    await user.selectOptions(screen.getByLabelText(fields.vertical), 'fitness');
    await user.selectOptions(screen.getByLabelText(fields.primaryGoal), 'prenota');
    const monday = screen.getByLabelText(label(itMessages.onboarding.panel.hoursValue, 1));
    await user.clear(monday);
    await user.type(monday, '06:30-20:00');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    const [, patch] = briefsHolder.calls[0] as [string, unknown];
    const parsed = BriefUpdateSchema.safeParse(patch);
    expect(parsed.success).toBe(true);
    // E porta davvero i quattro campi toccati, non un sottoinsieme fortunato.
    expect(patch).toEqual({
      whatsapp: NEW_WHATSAPP,
      vertical: 'fitness',
      primary_goal: 'prenota',
      hours: { mo: '06:30-20:00', tu: '10:00-23:00' },
    });
  });

  // covers: AC-151-2
  it('aggiunta di una coppia giorno/orario su un brief senza orari: hours arriva a upsertBrief', async () => {
    const user = userEvent.setup();
    renderWorkspace('it', BLANK_BRIEF);
    const panel = itMessages.onboarding.panel;

    // Nessuna riga prima di aggiungerla: il campo orari non e' un widget speculativo.
    expect(screen.queryByLabelText(label(panel.hoursDay, 1))).toBeNull();

    await user.click(screen.getByRole('button', { name: panel.hoursAdd }));
    await user.type(screen.getByLabelText(label(panel.hoursDay, 1)), 'sa');
    await user.type(screen.getByLabelText(label(panel.hoursValue, 1)), '08:00-13:00');
    await user.click(screen.getByRole('button', { name: panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-2
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { hours: { sa: '08:00-13:00' } }); // covers: AC-151-2
  });

  // V13 — il filtro che scarta le righe orario col GIORNO VUOTO non aveva oracolo:
  // rimuoverlo (o togliergli il `.trim()`) lasciava la suite verde. Non e' innocuo: una
  // chiave '' passa BriefUpdateSchema (`z.string().max(20)` accetta la stringa vuota),
  // quindi finirebbe DAVVERO in tabella come se fosse un giorno, e da lo' il sito
  // generato (P2) renderebbe una riga d'orario senza giorno.
  // Tre righe in una sola prova, perche' sono tre modi diversi di sbagliare: una lasciata
  // in bianco, una col giorno di soli SPAZI (uccide la rimozione del `.trim()`) e una
  // valida (non-vacuita': la patch esiste).
  it('righe orario col giorno vuoto o di soli spazi: scartate, nessuna chiave vuota nella patch', async () => {
    const user = userEvent.setup();
    renderWorkspace('it', BLANK_BRIEF);
    const panel = itMessages.onboarding.panel;

    for (let i = 0; i < 3; i += 1) {
      await user.click(screen.getByRole('button', { name: panel.hoursAdd }));
    }
    // Riga 1: giorno mai toccato, ma orario compilato — il caso realistico di chi
    // aggiunge una riga e compila la colonna sbagliata.
    await user.type(screen.getByLabelText(label(panel.hoursValue, 1)), '09:00-10:00');
    // Riga 2: giorno di soli spazi.
    await user.type(screen.getByLabelText(label(panel.hoursDay, 2)), '   ');
    await user.type(screen.getByLabelText(label(panel.hoursValue, 2)), '10:00-11:00');
    // Riga 3: l'unica valida.
    await user.type(screen.getByLabelText(label(panel.hoursDay, 3)), 'sa');
    await user.type(screen.getByLabelText(label(panel.hoursValue, 3)), '08:00-13:00');
    await user.click(screen.getByRole('button', { name: panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    // UGUAGLIANZA ESATTA: solo la riga col giorno valorizzato arriva al DB.
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { hours: { sa: '08:00-13:00' } });
    // E l'asserzione che il gate NON potrebbe dare: nessuna chiave vuota fra le chiavi
    // spedite (BriefUpdateSchema accetterebbe '' senza dire nulla).
    const [, patch] = briefsHolder.calls[0] as [string, { hours: Record<string, string> }];
    expect(Object.keys(patch.hours)).toEqual(['sa']);
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(true);
  });

  // covers: AC-151-2
  it('senza modifiche la conferma non scrive: nessuna patch vuota verso il DB', async () => {
    const user = userEvent.setup();
    renderWorkspace('it');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));
    // Attesa reale (non un tick sincrono) prima di dichiarare che non e' stata chiamata.
    await waitFor(() => expect(upsertBriefSpy).not.toHaveBeenCalled()); // covers: AC-151-2
  });

  // covers: AC-151-2
  it('la validazione autoritativa resta server-side: un upsertBrief 400 diventa un errore visibile', async () => {
    const user = userEvent.setup();
    briefsHolder.upsertResult = { ok: false, status: 400 };
    renderWorkspace('it');

    const name = screen.getByLabelText(itMessages.onboarding.fields.businessName);
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));

    // La UI non ha rifiutato il valore da se': lo ha mandato al gate (upsertBrief) e
    // ha reso il rifiuto. La UI non e' il gate.
    await waitFor(() =>
      expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { business_name: '' }),
    ); // covers: AC-151-2
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(itMessages.onboarding.panel.saveError); // covers: AC-151-2
  });

  // I valori enum offerti dal pannello sono ridichiarati (brief.ts non li esporta e
  // T-151 non lo tocca): questo test lega le due copie, cosi' una rinomina in T-121
  // non resta silenziosa.
  it('ogni valore enum offerto dal pannello e accettato da BriefUpdateSchema', () => {
    // Non-vacuita': con una lista vuota il ciclo sotto sarebbe vero per costruzione.
    expect(VERTICAL_OPTIONS.length).toBeGreaterThan(1);
    expect(GOAL_OPTIONS.length).toBeGreaterThan(1);
    for (const vertical of VERTICAL_OPTIONS) {
      expect(BriefUpdateSchema.safeParse({ vertical }).success).toBe(true);
    }
    for (const primary_goal of GOAL_OPTIONS) {
      expect(BriefUpdateSchema.safeParse({ primary_goal }).success).toBe(true);
    }
    expect(BriefUpdateSchema.safeParse({ vertical: 'non-esiste' }).success).toBe(false);
  });
});

describe('T-151 UrlImportBar: fromUrl → pre-riempimento del pannello', () => {
  const PROPOSED = applyBriefUpdate(emptyBrief('it'), {
    business_name: 'Bar Sole',
    phone: '+39 06 9998887',
    address: 'Piazza Grande 2, Modena',
  }).brief;
  const TARGET_URL = 'https://barsole.example/contatti';

  // covers: AC-151-3
  it('invio dell URL: fromUrl e invocata con QUELL url e il pannello e pre-riempito con la proposta', async () => {
    const user = userEvent.setup();
    importHolder.proposal = { status: 'proposed', brief: PROPOSED };
    renderWorkspace('it', BLANK_BRIEF);
    const fields = itMessages.onboarding.fields;

    // Prima dell'import i campi sono vuoti: il pre-riempimento e' osservabile.
    expect((screen.getByLabelText(fields.businessName) as HTMLInputElement).value).toBe('');

    await user.type(screen.getByLabelText(itMessages.onboarding.import.url), TARGET_URL);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));

    await waitFor(() => expect(fromUrlSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-3
    expect(importHolder.calls[0][0]).toBe(TARGET_URL); // covers: AC-151-3

    // TRE campi della proposta, tutti pre-riempiti: un pre-riempimento parziale muore.
    await waitFor(() =>
      expect((screen.getByLabelText(fields.businessName) as HTMLInputElement).value).toBe(
        'Bar Sole',
      ),
    ); // covers: AC-151-3
    expect((screen.getByLabelText(fields.phone) as HTMLInputElement).value).toBe('+39 06 9998887'); // covers: AC-151-3
    expect((screen.getByLabelText(fields.address) as HTMLInputElement).value).toBe(
      'Piazza Grande 2, Modena',
    ); // covers: AC-151-3
  });

  // covers: AC-151-3
  // Vincolo 4: la proposta PRE-RIEMPIE, non salva. La scrittura avviene SOLO alla
  // conferma esplicita, e questo test fissa i due momenti in ordine.
  it('la proposta non e persistita: upsertBrief non e chiamata prima della conferma, e poi porta i campi proposti', async () => {
    const user = userEvent.setup();
    importHolder.proposal = { status: 'proposed', brief: PROPOSED };
    renderWorkspace('it', BLANK_BRIEF);

    await user.type(screen.getByLabelText(itMessages.onboarding.import.url), TARGET_URL);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement)
          .value,
      ).toBe('Bar Sole'),
    );

    // NESSUNA scrittura: il pannello e' pre-riempito, il DB non e' stato toccato.
    expect(upsertBriefSpy).not.toHaveBeenCalled(); // covers: AC-151-3

    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-151-3
    const [, patch] = briefsHolder.calls[0] as [string, Record<string, unknown>];
    expect(patch.business_name).toBe('Bar Sole'); // covers: AC-151-3
    expect(patch.phone).toBe('+39 06 9998887'); // covers: AC-151-3
    expect(patch.address).toBe('Piazza Grande 2, Modena'); // covers: AC-151-3
  });

  // La proposta di fromUrl (T-141) e' costruita su `emptyBrief()`: cio' che la pagina NON
  // ha prodotto non arriva come "assente" ma come DEFAULT dello schema o come collezione
  // vuota. Su un brief GIA' compilato ognuna di quelle tre forme e' una perdita di dati
  // diversa, e nessuna era asserita:
  //  - `vertical` ha `default('altro')` in T-121: ogni import lo proponeva, sovrascriveva
  //    la scelta dell'utente nella vista e la conferma la mandava a upsertBrief;
  //  - un `undefined` che sovrascrive CANCELLA un valore che c'era (telefono, whatsapp);
  //  - una proposta senza collezioni SVUOTA offerte, punti di forza e social raccolti
  //    dalla chat.
  // La patch e' asserita per uguaglianza ESATTA: non basta che i due campi proposti
  // arrivino al DB, deve non arrivarci nient'altro.
  it('import su un brief gia compilato: pre-riempie solo cio che la pagina ha prodotto, e non cancella il resto', async () => {
    const user = userEvent.setup();
    // Costruita come la costruisce fromUrl: brief vuoto + i soli campi trovati.
    const PARTIAL = applyBriefUpdate(emptyBrief('it'), {
      business_name: 'Bar Sole Web',
      address: 'Piazza Grande 2, Modena',
    }).brief;
    // Non-vacuita' della fixture: il default e i buchi ci sono DAVVERO, altrimenti il
    // test proverebbe una proprieta' su un caso che non si presenta.
    expect(PARTIAL.vertical).toBe('altro');
    expect(PARTIAL.phone).toBeUndefined();
    expect(PARTIAL.content.offerings).toHaveLength(0);

    importHolder.proposal = { status: 'proposed', brief: PARTIAL };
    renderWorkspace('it', DRAFT_BRIEF);
    const fields = itMessages.onboarding.fields;
    const panel = itMessages.onboarding.panel;

    await user.type(screen.getByLabelText(itMessages.onboarding.import.url), TARGET_URL);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));

    // Cio' che la pagina HA prodotto pre-riempie: l'import e' avvenuto (non-vacuita').
    await waitFor(() =>
      expect((screen.getByLabelText(fields.businessName) as HTMLInputElement).value).toBe(
        'Bar Sole Web',
      ),
    );
    expect((screen.getByLabelText(fields.address) as HTMLInputElement).value).toBe(
      'Piazza Grande 2, Modena',
    );
    // Il vertical scelto dall'utente resta: 'altro' e' il default dello schema, non un
    // dato che la pagina abbia dichiarato.
    expect((screen.getByLabelText(fields.vertical) as HTMLSelectElement).value).toBe(
      'ristorazione',
    );
    // Un import che non trova il telefono non cancella il telefono che c'era.
    expect((screen.getByLabelText(fields.phone) as HTMLInputElement).value).toBe(PHONE);
    expect((screen.getByLabelText(fields.whatsapp) as HTMLInputElement).value).toBe(WHATSAPP);
    expect((screen.getByLabelText(fields.description) as HTMLInputElement).value).toBe(
      'Caffe e cornetti in centro',
    );
    // Le collezioni correnti non si svuotano.
    expect(screen.getByText(/Cornetto/)).toBeTruthy();
    expect(screen.getByText(/Caffe/)).toBeTruthy();
    expect(screen.getByText(/Wi-Fi gratis/)).toBeTruthy();
    expect(screen.getByText(/Tavoli fuori/)).toBeTruthy();
    expect(screen.getByText('https://social.example/barsole')).toBeTruthy();
    expect(screen.getByText('Toni caldi')).toBeTruthy();
    // E gli orari, che solo l'import puo' portare (P1-D13), restano quelli del brief.
    expect((screen.getByLabelText(label(panel.hoursValue, 1)) as HTMLInputElement).value).toBe(
      '07:00-19:00',
    );

    // La conferma manda al DB esattamente i due campi proposti: nessun 'altro' che
    // sovrascrive il vertical, nessun campo svuotato.
    await user.click(screen.getByRole('button', { name: panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, {
      business_name: 'Bar Sole Web',
      address: 'Piazza Grande 2, Modena',
    });
  });

  // Un sito = UNA lingua (T-121) e la lingua e' proprieta' del SITO: la pagina di
  // qualcun altro non puo' cambiarla. Il tipo dei campi pre-riempibili non ammette
  // `locale`, quindi aggiungerlo alla proposta e' un errore di COMPILAZIONE; questo test
  // copre l'altra strada, che il tipo non chiude (il locale della proposta che vince
  // nella fusione). Non e' osservabile dal DOM — il pannello non rende il locale — quindi
  // si asserisce sulla fusione, che e' il punto esatto in cui il dato entrerebbe.
  it('la proposta non puo cambiare la lingua del sito', () => {
    const spanishPage = applyBriefUpdate(emptyBrief('es'), {
      business_name: 'Bar Sol',
      phone: '+34 91 1234567',
    }).brief;
    expect(spanishPage.locale).toBe('es'); // non-vacuita': la proposta e' davvero in es

    const merged = mergeProposal(DRAFT_BRIEF, spanishPage);
    expect(merged.locale).toBe('it');
    // La fusione ha comunque fatto il suo lavoro: il test non passa perche' non fonde.
    expect(merged.business_name).toBe('Bar Sol');
    expect(merged.phone).toBe('+34 91 1234567');
  });

  // La Server Action PRETENDE una sessione: senza, il server sarebbe un proxy di sonde
  // SSRF per chiunque. Rifiuto TIPIZZATO, e fromUrl non viene nemmeno raggiunta.
  it('senza sessione la Server Action rifiuta e fromUrl non e invocata', async () => {
    const user = userEvent.setup();
    authHolder.user = null;
    importHolder.proposal = { status: 'proposed', brief: PROPOSED };
    renderWorkspace('it', BLANK_BRIEF);

    await user.type(screen.getByLabelText(itMessages.onboarding.import.url), TARGET_URL);
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(itMessages.onboarding.import.error);
    expect(fromUrlSpy).not.toHaveBeenCalled();
    // E il pannello resta vuoto: nessun dato inventato.
    expect(
      (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement).value,
    ).toBe('');
  });

  it('la Server Action pretende una STRINGA: oggetto, array e null sono rifiutati senza toccare fromUrl', async () => {
    for (const notAString of [{ url: 'https://a.example' }, ['https://a.example'], null, 42]) {
      const result = await importBriefFromUrl(notAString);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('invalid-url');
    }
    expect(fromUrlSpy).not.toHaveBeenCalled();
  });

  it('la Server Action non persiste nulla: su proposta valida upsertBrief non e chiamata', async () => {
    importHolder.proposal = { status: 'proposed', brief: PROPOSED };
    const result = await importBriefFromUrl('https://barsole.example/');
    expect(result.ok).toBe(true);
    expect(upsertBriefSpy).not.toHaveBeenCalled();
  });

  // P1-D16 — `address-blocked` copre sia "non risolvibile" sia "IP interno" per negare
  // l'enumerazione DNS: la UI deve dare UN SOLO messaggio e non far capire quale sia.
  // Con un solo motivo di fixture, "messaggio unico" sarebbe vero per costruzione.
  it('P1-D16: motivi di fallimento diversi danno lo STESSO messaggio, e il motivo non entra nel DOM', async () => {
    const messages: string[] = [];
    for (const reason of ['address-blocked', 'network-error', 'scheme-not-allowed', 'timeout']) {
      const user = userEvent.setup();
      importHolder.proposal = { status: 'failed', reason };
      const { container } = renderWorkspace('it', BLANK_BRIEF);

      await user.type(screen.getByLabelText(itMessages.onboarding.import.url), TARGET_URL);
      await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));

      const alert = await screen.findByRole('alert');
      messages.push(alert.textContent ?? '');
      expect(container.textContent).not.toContain(reason);
      cleanup();
    }
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe(itMessages.onboarding.import.error);
  });

  // P1-D16, l'altra meta': il collasso dei motivi avviene nella Server Action, non solo
  // nella scelta della stringa da rendere. Senza questa asserzione il motivo di fromUrl
  // poteva ATTRAVERSARE il confine (e restare invisibile solo perche' la UI lo ignora):
  // una mutazione che lo faceva trapelare nel valore di ritorno sopravviveva.
  it('P1-D16: la Server Action collassa TUTTI i motivi di fromUrl in un unico reason', async () => {
    const returned = new Set<string>();
    for (const reason of [
      'address-blocked',
      'network-error',
      'scheme-not-allowed',
      'timeout',
      'too-large',
      'content-type-not-allowed',
      'too-many-redirects',
    ]) {
      importHolder.proposal = { status: 'failed', reason };
      const result = await importBriefFromUrl('https://a.example/');
      expect(result.ok).toBe(false);
      if (!result.ok) returned.add(result.reason);
    }
    expect([...returned]).toEqual(['import-failed']);
  });
});

describe('T-151 testo del brief: input NON FIDATO in rendering (§7 p.4)', () => {
  // Un brief che arriva da una pagina ostile via fromUrl: markup nel testo, `javascript:`
  // nei campi destinati a un href/src. Nessun valore del brief deve diventare markup,
  // ne' finire in un href/src.
  // Il markup ostile sta in OGNI campo reso come nodo di testo (highlights, nome
  // dell'offerta, brand_hints) e non solo nei campi che finiscono in un `value` di input:
  // un valore in un `value` non crea elementi nemmeno passando da innerHTML, quindi con
  // il markup solo la' l'asserzione era vera per costruzione — e una mutazione che
  // rendeva gli highlights con dangerouslySetInnerHTML sopravviveva.
  // `geo` e `hours` DEVONO essere valorizzati, altrimenti i loro rami di rendering non
  // vengono resi affatto e le asserzioni su di essi sono vere per costruzione: e' il buco
  // che teneva in vita tre mutazioni (geo reso come <a href>, business_name in
  // dangerouslySetInnerHTML dentro il blocco geo, chiave orario in
  // dangerouslySetInnerHTML). `geo` e' due NUMERI per schema (GeoSchema, T-121), quindi
  // non puo' trasportare markup: la sua ostilita' e' di essere PRESENTE, cosi' il blocco
  // esiste e cio' che vi finisce dentro e' osservabile.
  // Le CHIAVI degli orari sono ostili quanto i valori, e non e' un'esagerazione: sono
  // chiavi libere (P1-D13) e fromUrl le prende dall'openingHours di un JSON-LD ALTRUI.
  // Stanno entro BRIEF_LIMITS.hours_key (20 code unit), altrimenti applyBriefUpdate
  // scarterebbe l'intera mappa e la fixture tornerebbe muta.
  const HOSTILE_HOURS_KEY = '<img src=x>lun';
  const HOSTILE_HOURS_KEY_2 = 'javascript:alert(4)';
  const HOSTILE_HOURS_VALUE = '<script>document.title="pwned"</script>07-19';
  const HOSTILE_HOURS_VALUE_2 = '<b>sempre</b> aperto';
  const HOSTILE_BRIEF = applyBriefUpdate(emptyBrief('it'), {
    business_name: '<img src=x onerror="document.title=1">Bar Ostile',
    description: '<script>document.title="pwned"</script>',
    geo: { lat: 41.9, lng: 12.5 },
    hours: {
      [HOSTILE_HOURS_KEY]: HOSTILE_HOURS_VALUE,
      [HOSTILE_HOURS_KEY_2]: HOSTILE_HOURS_VALUE_2,
    },
    highlights: ['<img src=x onerror="document.title=1">Punto ostile', 'javascript:alert(1)'],
    social_links: ['javascript:alert(2)', 'https://social.example/ok'],
    offerings: [{ name: '<b>Voce</b> ostile', photo_ref: 'javascript:alert(3)' }],
    brand_hints: '<script>document.title="pwned"</script>Stile',
  }).brief;

  it('nessun markup dal brief: niente img/script iniettati e nessun href/src dal brief', () => {
    const { container } = renderWorkspace('it', HOSTILE_BRIEF);
    const panel = itMessages.onboarding.panel;

    // NON-VACUITA' PRIMA DI TUTTO: i rami che le asserzioni sotto sorvegliano sono
    // DAVVERO resi. Senza queste tre righe, "nessun elemento nasce dal brief" e' vero
    // anche per una UI che di geo e orari non rende niente.
    expect(HOSTILE_BRIEF.geo).toEqual({ lat: 41.9, lng: 12.5 });
    expect(Object.keys(HOSTILE_BRIEF.hours ?? {})).toEqual([
      HOSTILE_HOURS_KEY,
      HOSTILE_HOURS_KEY_2,
    ]);
    expect(container.textContent).toContain('41.9, 12.5');
    // Le chiavi e i valori ostili degli orari sono resi, e sono resi come TESTO in un
    // `value` di input: e' la sede in cui V22 (chiave in dangerouslySetInnerHTML) sarebbe
    // osservabile, e senza `hours` nella fixture non esisteva.
    expect((screen.getByLabelText(label(panel.hoursDay, 1)) as HTMLInputElement).value).toBe(
      HOSTILE_HOURS_KEY,
    );
    expect((screen.getByLabelText(label(panel.hoursValue, 1)) as HTMLInputElement).value).toBe(
      HOSTILE_HOURS_VALUE,
    );
    expect((screen.getByLabelText(label(panel.hoursDay, 2)) as HTMLInputElement).value).toBe(
      HOSTILE_HOURS_KEY_2,
    );
    expect((screen.getByLabelText(label(panel.hoursValue, 2)) as HTMLInputElement).value).toBe(
      HOSTILE_HOURS_VALUE_2,
    );

    // NESSUN ELEMENTO NASCE DAL TESTO DEL BRIEF: ogni tag presente nelle fixture ostili
    // (img, script, b) non deve esistere come elemento — cioe' nessun valore del brief e'
    // mai passato per dangerouslySetInnerHTML, in nessuno dei rami (campi di testo,
    // highlights, offerte, brand_hints, blocco geo, righe orario).
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('script')).toHaveLength(0);
    expect(container.querySelectorAll('b')).toHaveLength(0);
    // Nessun href/src DAL BRIEF: i campi destinati a un link (social_links, photo_ref) sono
    // resi come TESTO, scelta dichiarata. Vale anche per `geo`, che una mappa renderebbe
    // naturalmente come link.
    // T-152 ha aggiunto al workspace UN href, e uno solo: la destinazione INTERNA FISSA
    // della schermata Rivedi&conferma (T152-V08 — senza di essa quella schermata era
    // irraggiungibile). Non trasporta dati del brief, quindi l'asserzione non era piu'
    // "zero href": si ENUMERA l'insieme atteso, che e' altrettanto forte — un valore del
    // brief che finisse in un href cambierebbe la lista, e il conteggio degli <a> a UNO
    // esclude ancora un anchor in piu' costruito attorno a un valore del brief (anche senza
    // href, che l'asserzione sugli href non vedrebbe).
    expect([...container.querySelectorAll('[href]')].map((el) => el.getAttribute('href'))).toEqual([
      `/it/onboarding/${SITE_ID}/review`,
    ]);
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(document.title).not.toBe('pwned');
    // E il valore resta VISIBILE come testo: non si sanitizza cancellando il dato.
    expect(
      (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement).value,
    ).toContain('Bar Ostile');
    expect(container.textContent).toContain('javascript:alert(2)');
    // Il markup dei campi in sola lettura resta TESTO LETTERALE: non eseguito, non
    // rimosso (rimuoverlo sarebbe corruzione silenziosa del dato dell'utente).
    expect(container.textContent).toContain('<img src=x onerror="document.title=1">Punto ostile');
    expect(container.textContent).toContain('<b>Voce</b> ostile');
    expect(container.textContent).toContain('<script>document.title="pwned"</script>Stile');
  });
});

describe('T-151 ChatPanel: turni assistente/utente', () => {
  const ASSISTANT_TEXT = 'Perfetto. Che tipo di attivita e?';

  // Il turno passa dall'endpoint di T-150 e i due chunk arrivano nell'ordine di P1-D18.
  it('invio di un turno: il messaggio utente e il testo assistente sono resi entrambi', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: ASSISTANT_TEXT },
        {
          type: 'brief',
          brief: applyBriefUpdate(DRAFT_BRIEF, { business_name: 'Bar Sole Bis' }).brief,
          complete: true,
          readyForReview: false,
        },
      ]);
    renderWorkspace('it');
    const chat = itMessages.onboarding.chat;

    await user.type(screen.getByLabelText(chat.message), 'Ho un bar a Roma');
    await user.click(screen.getByRole('button', { name: chat.send }));

    expect(await screen.findByText('Ho un bar a Roma')).toBeTruthy();
    expect(await screen.findByText(ASSISTANT_TEXT)).toBeTruthy();
    expect(screen.getByText(chat.you)).toBeTruthy();
    expect(screen.getByText(chat.assistant)).toBeTruthy();

    // Il turno e' andato all'endpoint del sito della prop, con il messaggio dell'utente.
    const [url, init] = fetchHolder.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/onboarding/${SITE_ID}/turn`);
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [],
      userMessage: 'Ho un bar a Roma',
    });

    // Il chunk `brief` aggiorna il pannello: e' la stessa sorgente di verita' del DB.
    await waitFor(() =>
      expect(
        (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement)
          .value,
      ).toBe('Bar Sole Bis'),
    );
  });

  // Vincolo 5 — complete/readyForReview vengono dal chunk `brief`, NON ricalcolati nel
  // client. La fixture e' un brief COMPLETO (business_name+vertical+primary_goal+locale)
  // con readyForReview FALSE: se la UI li ricalcolasse, direbbe "pronto" e morirebbe qui.
  it('complete/readyForReview arrivano dal chunk e non sono ricalcolati nel client', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: ASSISTANT_TEXT },
        { type: 'brief', brief: DRAFT_BRIEF, complete: true, readyForReview: false },
      ]);
    renderWorkspace('it');
    const readiness = itMessages.onboarding.readiness;

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    expect(await screen.findByText(readiness.complete)).toBeTruthy();
    expect(screen.queryByText(readiness.readyForReview)).toBeNull();
  });

  // Il caso SPECULARE, ed e' quello che rende non-tautologica la coppia: chunk con
  // readyForReview TRUE e complete FALSE su un brief che isBriefComplete considererebbe
  // COMPLETO. Con solo `complete: true` nelle fixture, un `complete` hardcoded nel client
  // sarebbe indistinguibile dal valore che arriva dal chunk (mutazione sopravvissuta).
  it('chunk con readyForReview true e complete false: la UI segue il chunk, non i dati', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: ASSISTANT_TEXT },
        { type: 'brief', brief: DRAFT_BRIEF, complete: false, readyForReview: true },
      ]);
    renderWorkspace('it');
    const readiness = itMessages.onboarding.readiness;

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    expect(await screen.findByText(readiness.readyForReview)).toBeTruthy();
    expect(screen.queryByText(readiness.complete)).toBeNull();
  });

  // §7 p.2 — con Haiku un turno di sole tool-call produce assistantText VUOTA: senza
  // questo caso la UI mostrerebbe una bolla assistente vuota.
  it('testo assistente vuoto: al posto della bolla vuota si rende una nota localizzata', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: '' },
        { type: 'brief', brief: DRAFT_BRIEF, complete: false, readyForReview: false },
      ]);
    renderWorkspace('it');

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    expect(await screen.findByText(itMessages.onboarding.chat.assistantSilent)).toBeTruthy();
  });

  // La guardia di forma sul chunk `brief` era `typeof chunk.brief.content === 'object'`,
  // che e' VERA per `content: null` (typeof null === 'object') e per un array: il
  // BriefPanel dereferenzia `brief.content.offerings.length`, quindi la guardia cadeva
  // proprio nei casi per cui esisteva. Ogni forma della famiglia e' un buco diverso, per
  // questo si asserisce la PROPRIETA' su piu' forme: un chunk che non e' un Brief valido
  // e' scartato INTERO (ne' brief ne' readiness) e il pannello resta in piedi. Con una
  // sola forma di fixture, un predicato rattoppato solo per quella sarebbe passato.
  it('chunk brief di forma inattesa: scartato intero, il pannello resta in piedi e lo stato non cambia', async () => {
    const malformed: unknown[] = [
      { ...DRAFT_BRIEF, business_name: 'Non deve entrare', content: null },
      { ...DRAFT_BRIEF, business_name: 'Non deve entrare', content: [] },
      { ...DRAFT_BRIEF, business_name: 'Non deve entrare', content: 'niente' },
      { ...DRAFT_BRIEF, business_name: 'Non deve entrare', content: { offerings: 'niente' } },
      null,
      'non un oggetto',
      [DRAFT_BRIEF],
    ];

    for (const brief of malformed) {
      const user = userEvent.setup();
      fetchHolder.respond = () =>
        ndjson([
          { type: 'text', text: ASSISTANT_TEXT },
          { type: 'brief', brief, complete: true, readyForReview: true },
        ]);
      renderWorkspace('it');

      await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
      await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

      // Lo stream E' stato consumato: il chunk di testo e' arrivato (non-vacuita').
      expect(await screen.findByText(ASSISTANT_TEXT)).toBeTruthy();
      // Il pannello mostra ancora lo stato PRECEDENTE, e le collezioni sono ancora rese
      // (cioe' non e' crollato dereferenziando un content che non e' un oggetto).
      expect(
        (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement)
          .value,
      ).toBe('Bar Sole');
      expect(screen.getByText(/Cornetto/)).toBeTruthy();
      // Nemmeno la readiness passa: il chunk si scarta intero, non a meta'.
      expect(screen.queryByText(itMessages.onboarding.readiness.complete)).toBeNull();
      expect(screen.queryByText(itMessages.onboarding.readiness.readyForReview)).toBeNull();
      cleanup();
    }
  });

  // V18 / T151-V06 — il chunk `{type:'error'}` non aveva NESSUN oracolo: nessun test lo
  // emetteva, benche' T-150 lo produca ogni volta che `upsertBrief` non va a buon fine
  // (RLS, 400 del gate, guasto del DB) DOPO il primo flush, quando lo status HTTP e' gia'
  // 200 e non c'e' altro canale. Il ramo `if (chunk.type === 'error')` era quindi
  // rimovibile con la suite verde: l'utente avrebbe visto la risposta dell'assistente e
  // creduto che il brief fosse salvato, mentre non lo era.
  it('chunk error: errore localizzato, brief NON aggiornato e motivo interno fuori dal DOM', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: ASSISTANT_TEXT },
        { type: 'error', reason: 'brief-not-saved' },
      ]);
    const { container } = renderWorkspace('it');

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(itMessages.onboarding.chat.error);
    // Lo stream E' stato consumato fino in fondo: il chunk di testo e' arrivato
    // (non-vacuita': l'errore non viene da un fetch fallito).
    expect(screen.getByText(ASSISTANT_TEXT)).toBeTruthy();
    // Il motivo interno resta interno: nel DOM va la stringa del catalogo, non 'brief-not-saved'.
    expect(container.textContent).not.toContain('brief-not-saved');
    // Il pannello resta sullo stato PRECEDENTE: il chunk error non porta un brief, quindi
    // non c'e' niente da aggiornare, e nessuna readiness va mostrata.
    expect(
      (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement).value,
    ).toBe('Bar Sole');
    expect(screen.queryByText(itMessages.onboarding.readiness.complete)).toBeNull();
    expect(screen.queryByText(itMessages.onboarding.readiness.readyForReview)).toBeNull();
  });

  it('turno rifiutato dall endpoint: messaggio d errore localizzato, nessuna bolla assistente', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () => new Response('{"error":"forbidden"}', { status: 403 });
    renderWorkspace('it');

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(itMessages.onboarding.chat.error);
    expect(screen.queryByText(itMessages.onboarding.chat.assistant)).toBeNull();
  });
});

// SCELTA DICHIARATA E PINNATA: l'ultima parola e' dell'UTENTE. Un valore che arriva DOPO
// (il brief salvato di un turno di chat, o la proposta di un import) non sovrascrive ne' il
// campo in cui l'utente ha digitato ne' l'editor degli orari se l'ha toccato. Cancellare
// sotto le dita quello che si sta scrivendo e' un danno immediato e non annullabile;
// il valore che arriva, invece, resta nel brief e ricompare appena il campo torna non
// toccato (un salvataggio riuscito azzera draft e righe).
// Il difetto rilevato non era la direzione, era che il comportamento non era asserito in
// NESSUNA direzione: qui si pinna, e si pinna anche la meta' opposta — i campi NON toccati
// si aggiornano — altrimenti la proprieta' sarebbe vera anche per una UI che ignora del
// tutto gli aggiornamenti che le arrivano.
describe('T-151 l ultima parola e dell utente (scelta dichiarata)', () => {
  it('un chunk brief non sovrascrive le righe orari che l utente sta modificando', async () => {
    const user = userEvent.setup();
    fetchHolder.respond = () =>
      ndjson([
        { type: 'text', text: 'Aggiornato' },
        {
          type: 'brief',
          brief: applyBriefUpdate(DRAFT_BRIEF, {
            business_name: 'Bar Sole Bis',
            hours: { mo: '00:00-01:00', tu: '02:00-03:00' },
          }).brief,
          complete: false,
          readyForReview: false,
        },
      ]);
    renderWorkspace('it');
    const panel = itMessages.onboarding.panel;

    const tuesday = screen.getByLabelText(label(panel.hoursValue, 2));
    await user.clear(tuesday);
    await user.type(tuesday, '11:00-15:00');

    await user.type(screen.getByLabelText(itMessages.onboarding.chat.message), 'Ciao');
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.chat.send }));

    // Il chunk E' arrivato: un campo che l'utente non ha toccato si aggiorna.
    await waitFor(() =>
      expect(
        (screen.getByLabelText(itMessages.onboarding.fields.businessName) as HTMLInputElement)
          .value,
      ).toBe('Bar Sole Bis'),
    );
    // Le righe restano quelle dell'utente, comprese quelle che non ha cambiato: l'editor
    // degli orari e' un blocco unico, e dal primo tocco e' suo.
    expect((screen.getByLabelText(label(panel.hoursValue, 2)) as HTMLInputElement).value).toBe(
      '11:00-15:00',
    );
    expect((screen.getByLabelText(label(panel.hoursValue, 1)) as HTMLInputElement).value).toBe(
      '07:00-19:00',
    );
  });

  it('la proposta d import non sovrascrive il campo in cui l utente ha digitato, ma pre-riempie gli altri', async () => {
    const user = userEvent.setup();
    const MANUAL_NAME = 'Nome scelto a mano';
    importHolder.proposal = {
      status: 'proposed',
      brief: applyBriefUpdate(emptyBrief('it'), {
        business_name: 'Bar Sole Web',
        phone: '+39 06 9998887',
        address: 'Piazza Grande 2, Modena',
      }).brief,
    };
    renderWorkspace('it', BLANK_BRIEF);
    const fields = itMessages.onboarding.fields;

    await user.type(screen.getByLabelText(fields.businessName), MANUAL_NAME);
    await user.type(
      screen.getByLabelText(itMessages.onboarding.import.url),
      'https://barsole.example/',
    );
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.import.submit }));

    // I campi non toccati si pre-riempiono: l'import e' avvenuto (non-vacuita').
    await waitFor(() =>
      expect((screen.getByLabelText(fields.phone) as HTMLInputElement).value).toBe(
        '+39 06 9998887',
      ),
    );
    expect((screen.getByLabelText(fields.address) as HTMLInputElement).value).toBe(
      'Piazza Grande 2, Modena',
    );
    // Quello in cui l'utente ha digitato resta suo.
    expect((screen.getByLabelText(fields.businessName) as HTMLInputElement).value).toBe(
      MANUAL_NAME,
    );

    // E la conferma scrive il valore dell'UTENTE, non quello della pagina.
    await user.click(screen.getByRole('button', { name: itMessages.onboarding.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, {
      business_name: MANUAL_NAME,
      phone: '+39 06 9998887',
      address: 'Piazza Grande 2, Modena',
    });
  });
});

describe('T-151 localizzazione (locale es)', () => {
  // covers: AC-151-4
  it('resi in es: etichette e testi di ChatPanel/BriefPanel/UrlImportBar sono in spagnolo', () => {
    renderWorkspace('es');
    const it = itMessages.onboarding;
    const es = esMessages.onboarding;

    // BriefPanel
    expect(screen.getByText(es.panel.title)).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByLabelText(es.fields.businessName)).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByRole('button', { name: es.panel.save })).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByText(es.fields.hours)).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByLabelText(label(es.panel.hoursDay, 1))).toBeTruthy(); // covers: AC-151-4
    // ChatPanel
    expect(screen.getByText(es.chat.title)).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByRole('button', { name: es.chat.send })).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByLabelText(es.chat.message)).toBeTruthy(); // covers: AC-151-4
    // UrlImportBar
    expect(screen.getByLabelText(es.import.url)).toBeTruthy(); // covers: AC-151-4
    expect(screen.getByRole('button', { name: es.import.submit })).toBeTruthy(); // covers: AC-151-4
    // Enum: l'etichetta localizzata, non il valore grezzo dell'allowlist.
    expect(screen.getByText(es.verticals.ristorazione)).toBeTruthy(); // covers: AC-151-4

    // Le chiavi rese sono DAVVERO diverse dall'italiano (spagnolo vero, non copiato).
    expect(es.panel.title).not.toBe(it.panel.title); // covers: AC-151-4
    expect(es.panel.save).not.toBe(it.panel.save); // covers: AC-151-4
    expect(es.chat.title).not.toBe(it.chat.title); // covers: AC-151-4
    expect(es.chat.send).not.toBe(it.chat.send); // covers: AC-151-4
    expect(es.import.submit).not.toBe(it.import.submit); // covers: AC-151-4
    expect(es.import.error).not.toBe(it.import.error); // covers: AC-151-4
    expect(es.fields.hours).not.toBe(it.fields.hours); // covers: AC-151-4
    expect(es.verticals.ristorazione).not.toBe(it.verticals.ristorazione); // covers: AC-151-4
    expect(es.readiness.readyForReview).not.toBe(it.readiness.readyForReview); // covers: AC-151-4

    // E nessuna stringa italiana e' rimasta nel DOM reso in es.
    expect(screen.queryByText(it.panel.title)).toBeNull(); // covers: AC-151-4
    expect(screen.queryByText(it.chat.title)).toBeNull(); // covers: AC-151-4
  });

  // covers: AC-151-4
  it('resi in es: anche i messaggi d errore vengono dal catalogo spagnolo', async () => {
    const user = userEvent.setup();
    importHolder.proposal = { status: 'failed', reason: 'address-blocked' };
    renderWorkspace('es', BLANK_BRIEF);

    await user.type(screen.getByLabelText(esMessages.onboarding.import.url), 'https://a.example/');
    await user.click(screen.getByRole('button', { name: esMessages.onboarding.import.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(esMessages.onboarding.import.error); // covers: AC-151-4
  });
});
