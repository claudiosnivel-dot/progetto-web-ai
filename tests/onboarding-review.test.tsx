// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-152 (macrotask onboarding-ui, P1) — ORACOLO della schermata Rivedi&conferma. Le
// asserzioni derivano da AC-152-1..4 di 04-onboarding-ui.md; ognuna e' taggata
// `// covers: AC-152-<n>`.
//
// COSA SI RENDE: la ROTTA `/{locale}/onboarding/{siteId}/review`, non il solo
// componente. E' la lezione di T151-V05: "il componente si comporta bene" e' una
// proprieta' piu' debole di "la rotta lo rende, dietro le sue guardie, cablato al siteId
// della rotta". Quindi ogni test qui esegue la pagina per davvero (guardie comprese) e ne
// rende l'albero dentro lo STESSO provider next-intl che il layout /[locale] mette sopra
// ogni rotta.
//
// Cosa si mocka e perche' NON e' hollow:
//  - `@/data/briefs` getBrief/upsertBrief/confirmBrief: i seam dati (T-123). Sono l'unico
//    modo di osservare CON QUALE siteId e CON QUALE patch la schermata scrive e conferma,
//    che e' il cuore di AC-152-2.
//  - `@/data/sites` listSites e `@/data/supabase-ssr` getUser: i seam delle guardie
//    (P1-D21). Qui non si ri-verifica la RLS: si osserva che la catena di guardie della
//    rotta review e' la STESSA di T-150 e che nega prima di leggere qualunque cosa.
//  - `next/navigation`: redirect/notFound lanciano davvero (come in Next), e useRouter
//    espone una `push` spiabile — "l'utente torna alla dashboard" e' una navigazione, e
//    senza questo seam non sarebbe osservabile.
// NON si mocka next-intl: le stringhe si risolvono dai cataloghi REALI it/es, cosi'
// AC-152-4 misura la SCELTA DELLE CHIAVI fatta dal codice, non stringhe passate dal test.
//
// AC-152-3 — RINVIO ESPLICITO (T152-V07). L'AC ha DUE meta' e questa suite ne prova UNA.
//  - COSA SI PROVA QUI: il CONTRATTO della conferma — che `confirmBrief` sia invocata, una
//    volta sola, col siteId della ROTTA e con nient'altro come argomento; che un suo rifiuto
//    sia reso senza navigare; e che dopo l'esito buono l'utente torni a /{locale}/dashboard.
//  - COSA QUESTA SUITE NON PROVA, E NON PUO' PROVARE: che dopo la conferma
//    `getBrief(S).status` valga `'confirmed'`. E' una proprieta' del DATABASE e qui
//    `confirmBrief` e' MOCKATA: nessuna asserzione di questo file tocca Postgres, e
//    duplicare l'AC in jsdom con un doppio che ritorna `status:'confirmed'` sarebbe un test
//    tautologico — proverebbe il mock, non la scrittura.
//  - DOVE VIVE L'ALTRA META': `tests/briefs-actions.test.ts`, test
//    "A conferma il brief: una successiva getBrief mostra status='confirmed'"
//    (covers AC-123-3), che chiama la `confirmBrief` REALE e poi la `getBrief` REALE contro
//    il Supabase locale con auth reale e RLS attiva. Verificato leggendo quel file, non
//    supposto. Caveat da tenere in conto: quel describe e' `skipIf(!SB)`, quindi la prova
//    esiste ma si ESEGUE solo con NEXT_PUBLIC_SUPABASE_URL/ANON_KEY e SERVICE_ROLE_KEY
//    configurate — senza DB locale nessuna suite prova la meta' di database di AC-152-3.
//
// Trappole tautologiche evitate deliberatamente (su T-150 e T-151 mutazioni sono
// sopravvissute proprio a fixture da un solo elemento o a rami non valorizzati):
//  - il brief di fixture ha DUE offerte con campi DIVERSI (la prima sezione+prezzo, la
//    seconda descrizione+foto), DUE punti di forza, DUE profili social, DUE chiavi di
//    orario e `geo` valorizzato: mappare la voce 1 sulla 2, o rendere solo la prima, e'
//    osservabile;
//  - la patch che arriva a `upsertBrief` e' asserita per UGUAGLIANZA ESATTA e poi
//    RI-APPLICATA con `applyBriefUpdate` REALE: non basta che la patch esista, deve
//    significare cio' che la schermata mostra;
//  - il siteId della rotta non e' il primo sito posseduto (fixture con DUE siti, quello
//    della rotta NON in posizione 0);
//  - i campi testuali sono provati anche con valori OSTILI (markup, `javascript:`).

const { briefsHolder, getBriefSpy, upsertBriefSpy, confirmBriefSpy } = vi.hoisted(() => {
  const holder = {
    getResult: { ok: true, brief: null, status: null, complete: false } as unknown,
    upsertResult: { ok: true, complete: false } as unknown,
    confirmResult: { ok: true } as unknown,
    upsertCalls: [] as unknown[][],
    confirmCalls: [] as unknown[][],
    // CANCELLI (`null` = nessuna attesa). Una richiesta che ritorna subito non e' mai IN
    // VOLO per il tempo di un secondo click, quindi senza questo seam la guardia anti
    // doppio invio non e' osservabile: il test la misurerebbe su un mondo in cui il doppio
    // invio non puo' accadere. Con il cancello chiuso la scrittura resta pendente finche'
    // il test non la rilascia.
    upsertGate: null as Promise<void> | null,
    confirmGate: null as Promise<void> | null,
  };
  return {
    briefsHolder: holder,
    getBriefSpy: vi.fn(async () => holder.getResult),
    upsertBriefSpy: vi.fn(async (...args: unknown[]) => {
      // Gli argomenti si registrano PRIMA di attendere: cio' che si conta e' l'INVOCAZIONE,
      // non il suo completamento — un secondo invio va visto anche se non arriva mai in fondo.
      holder.upsertCalls.push(args);
      if (holder.upsertGate) await holder.upsertGate;
      return holder.upsertResult;
    }),
    confirmBriefSpy: vi.fn(async (...args: unknown[]) => {
      holder.confirmCalls.push(args);
      if (holder.confirmGate) await holder.confirmGate;
      return holder.confirmResult;
    }),
  };
});
vi.mock('@/data/briefs', () => ({
  getBrief: getBriefSpy,
  upsertBrief: upsertBriefSpy,
  confirmBrief: confirmBriefSpy,
}));

const { sitesHolder, listSitesSpy } = vi.hoisted(() => {
  const holder = { list: { ok: true, sites: [] } as unknown };
  return { sitesHolder: holder, listSitesSpy: vi.fn(async () => holder.list) };
});
vi.mock('@/data/sites', () => ({ listSites: listSitesSpy }));

const { authHolder } = vi.hoisted(() => ({
  authHolder: { user: null as { id: string } | null },
}));
vi.mock('@/data/supabase-ssr', () => ({ getUser: async () => authHolder.user }));

// redirect/notFound lanciano davvero, come in Next: una pagina che passasse per una
// guardia negata non renderebbe nulla invece di rendere a meta'. `push` e' il seam del
// "torna alla dashboard"; usePathname serve ad AppShell (T-022), che avvolge la pagina.
const { REDIRECT, NOT_FOUND, redirectSpy, notFoundSpy, pushSpy } = vi.hoisted(() => {
  const redirectSentinel = Symbol('redirect');
  const notFoundSentinel = Symbol('not-found');
  return {
    REDIRECT: redirectSentinel,
    NOT_FOUND: notFoundSentinel,
    pushSpy: vi.fn(),
    redirectSpy: vi.fn(() => {
      throw redirectSentinel;
    }),
    notFoundSpy: vi.fn(() => {
      throw notFoundSentinel;
    }),
  };
});
vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
  notFound: notFoundSpy,
  usePathname: () => '/it/onboarding/site-of-a/review',
  useRouter: () => ({ push: pushSpy, refresh: vi.fn() }),
}));

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  type LinkProps = { href: string; children?: ReactNode; 'aria-current'?: 'page' };
  return {
    default: ({ href, children, ...rest }: LinkProps) =>
      createElement('a', { href, ...rest }, children),
  };
});

// Le stringhe della CHROME di pagina (titolo, nav) sono server-side. Il mock risolve dal
// catalogo REALE del locale RICHIESTO — non sempre da it — altrimenti AC-152-4 non
// potrebbe distinguere una pagina resa in es da una resa in it.
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const catalog = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = (catalog[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

// Import DOPO i mock (vi.mock e' hoisted).
import ReviewPage from '@/app/[locale]/onboarding/[siteId]/review/page';
import {
  applyBriefUpdate,
  emptyBrief,
  BriefUpdateSchema,
  BRIEF_LIMITS,
  type Brief,
} from '@/domain/onboarding/brief';

const SITE_ID = 'site-of-a';
// Secondo sito posseduto: la rotta che si rende NON e' il primo elemento di listSites,
// cosi' `sites[0].id` al posto di `siteId` e' osservabile.
const OTHER_SITE_ID = 'site-of-b';
const OWNED_SITES = [
  { id: OTHER_SITE_ID, name: 'Panetteria di B' },
  { id: SITE_ID, name: 'Officina di A' },
];
const UNKNOWN_SITE = 'site-che-non-esiste';
// PREFISSO PROPRIO di entrambi gli id posseduti, e il suo specchio (un id posseduto piu' un
// suffisso): nessuno dei due e' l'id di un sito, ma un confronto RILASSATO li accetterebbe
// (`candidate.id.startsWith(siteId)` il primo, `siteId.startsWith(candidate.id)` il secondo;
// un `includes` entrambi). Con soli id DISGIUNTI (SITE_ID vs OTHER_SITE_ID vs UNKNOWN_SITE)
// quel confronto passerebbe l'intera suite. E' il buco gia' chiuso sulla rotta di T-150 e
// riaperto QUI, perche' questa rotta ha una COPIA della catena di guardie: la copia va
// pinnata dove vive, non dove vive l'originale.
const PREFIX_OF_OWNED = 'site-of';
const OWNED_PLUS_SUFFIX = `${SITE_ID}-copia`;

const PHONE = '+39 06 1234567';
const WHATSAPP = '+39 333 1112222';
const OFFERING_2_NAME = 'Caffe in tazza grande';
const OFFERING_2_DESCRIPTION = 'Miscela della casa, tostatura chiara';
const OFFERING_2_PHOTO = 'https://cdn.example/caffe.jpg';
const SOCIAL_1 = 'https://social.example/barsole';
const SOCIAL_2 = 'https://altro.example/barsole';

// Brief di fixture costruito col codice di dominio REALE (T-121/T-122): la forma non puo'
// divergere da quella che getBrief restituisce. Le DUE offerte hanno campi DIVERSI, e i
// valori sono tutti distinti fra loro.
const DRAFT_BRIEF: Brief = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Bar Sole',
  vertical: 'ristorazione',
  description: 'Caffe e cornetti in centro, dal 1962',
  address: 'Via Roma 1, Roma',
  phone: PHONE,
  whatsapp: WHATSAPP,
  email: 'ciao@barsole.example',
  primary_goal: 'ordina',
  hours: { mo: '07:00-19:00', tu: '10:00-23:00' },
  geo: { lat: 41.9, lng: 12.5 },
  offerings: [
    { name: 'Cornetto', section: 'Colazione', price: '1,20' },
    {
      name: OFFERING_2_NAME,
      description: OFFERING_2_DESCRIPTION,
      photo_ref: OFFERING_2_PHOTO,
    },
  ],
  highlights: ['Wi-Fi gratis', 'Tavoli fuori'],
  social_links: [SOCIAL_1, SOCIAL_2],
  brand_hints: 'Toni caldi, legno chiaro',
}).brief;

// Etichette posizionali ICU risolte dal catalogo: ricopiarle a mano nel test le
// scollegherebbe dalla sorgente di verita'.
const label = (template: string, n: number) => template.replace('{n}', String(n));

// Un cancello che il test apre quando vuole: tiene una scrittura IN VOLO per il tempo di un
// secondo click. E' cio' che rende la guardia anti doppio invio una proprieta' MISURABILE.
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

const IT = itMessages.onboarding;
const ES = esMessages.onboarding;

function Wrapper({ locale, children }: { locale: 'it' | 'es'; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'es' ? esMessages : itMessages}>
      {children}
    </NextIntlClientProvider>
  );
}

// Rende la ROTTA review: la pagina gira per davvero (guardie + getBrief) e il suo albero
// finisce nel provider next-intl del layout.
async function renderReview(
  locale: 'it' | 'es' = 'it',
  siteId = SITE_ID,
  rawLocale: string = locale,
) {
  const ui = await ReviewPage({ params: Promise.resolve({ locale: rawLocale, siteId }) });
  return render(<Wrapper locale={locale}>{ui}</Wrapper>);
}

beforeEach(() => {
  authHolder.user = { id: 'user-a' };
  sitesHolder.list = { ok: true, sites: OWNED_SITES };
  briefsHolder.getResult = { ok: true, brief: DRAFT_BRIEF, status: 'draft', complete: true };
  briefsHolder.upsertResult = { ok: true, complete: true };
  briefsHolder.confirmResult = { ok: true };
  briefsHolder.upsertCalls.length = 0;
  briefsHolder.confirmCalls.length = 0;
  briefsHolder.upsertGate = null;
  briefsHolder.confirmGate = null;
  getBriefSpy.mockClear();
  upsertBriefSpy.mockClear();
  confirmBriefSpy.mockClear();
  listSitesSpy.mockClear();
  redirectSpy.mockClear();
  notFoundSpy.mockClear();
  pushSpy.mockClear();
});

afterEach(cleanup);

describe('T-152 la rotta review: catena di guardie identica a T-150', () => {
  // La rotta vive sotto /{locale}/onboarding/{siteId}/review, quindi eredita la guardia
  // di route del middleware (T-150 l'ha estesa a `onboarding` e a OGNI sotto-rotta:
  // `^/(it|es)/(?:dashboard|onboarding)(?:/.*)?$`). Questo non basta come oracolo della
  // PAGINA: il matcher del middleware esclude i pathname che contengono un punto, quindi
  // il getUser server-side qui sotto e' l'unica difesa per /it/onboarding/a.b/review.
  it('senza sessione: redirect al login del locale, e nulla del brief viene letto', async () => {
    authHolder.user = null;
    await expect(renderReview()).rejects.toBe(REDIRECT);

    expect(redirectSpy).toHaveBeenCalledWith('/it/login');
    // La negazione avviene PRIMA di qualunque lettura: ne' i siti ne' il brief.
    expect(listSitesSpy).not.toHaveBeenCalled();
    expect(getBriefSpy).not.toHaveBeenCalled();
    expect(confirmBriefSpy).not.toHaveBeenCalled();
  });

  it('senza sessione in es: il redirect resta nel locale corrente', async () => {
    authHolder.user = null;
    await expect(renderReview('es')).rejects.toBe(REDIRECT);
    expect(redirectSpy).toHaveBeenCalledWith('/es/login');
  });

  // Il segmento [locale] e' input controllabile dal client: va vincolato all'allowlist
  // routing.locales PRIMA di essere interpolato in una destinazione (come T-044).
  it('locale fuori allowlist: la destinazione usa il locale di default, non il valore grezzo', async () => {
    authHolder.user = null;
    await expect(renderReview('it', SITE_ID, '../evil')).rejects.toBe(REDIRECT);
    expect(redirectSpy).toHaveBeenCalledWith('/it/login');
    expect(redirectSpy).not.toHaveBeenCalledWith('/../evil/login');
  });

  // P1-D21 — "sito non tuo" e "sito inesistente" danno la STESSA risposta, e il brief non
  // viene letto affatto: la rotta non e' un oracolo di enumerazione dei site_id altrui.
  it('sito non fra i propri: notFound e getBrief mai invocata', async () => {
    await expect(renderReview('it', UNKNOWN_SITE)).rejects.toBe(NOT_FOUND);
    expect(notFoundSpy).toHaveBeenCalled();
    expect(getBriefSpy).not.toHaveBeenCalled();
  });

  // P1-D21 — la proprieta' del sito e' un'UGUAGLIANZA ESATTA di id, non una somiglianza.
  // Con un confronto lasco (`startsWith` in una delle due direzioni, o `includes`) un id che
  // NON e' di nessun sito otterrebbe la schermata di revisione di un sito posseduto: e con
  // id generati da uno schema noto quel varco vale un intero sottoinsieme di risorse.
  // La risposta e' IDENTICA a quella di un sito inesistente, e nessuna delle due legge il
  // brief: la rotta non e' un oracolo di enumerazione dei site_id altrui.
  it('un siteId che e solo PREFISSO (o prefissato da) un id posseduto: risposta identica a un sito inesistente', async () => {
    for (const siteId of [PREFIX_OF_OWNED, OWNED_PLUS_SUFFIX, UNKNOWN_SITE]) {
      notFoundSpy.mockClear();
      redirectSpy.mockClear();
      getBriefSpy.mockClear();
      // given: A autenticato e proprietario di OTHER_SITE_ID e SITE_ID (vedi beforeEach)
      // when: chiede un id che non e' quello di nessun sito
      await expect(renderReview('it', siteId)).rejects.toBe(NOT_FOUND);
      // then: valore ATTESO ESPLICITO per OGNUNO dei tre casi, non "uguale all'altro": due
      // risposte che escono dallo stesso ramo restano uguali qualunque cosa quel ramo
      // diventi, quindi confrontarle fra loro non proverebbe nulla. Cosi'
      // l'indistinguibilita' e' una CONSEGUENZA di valori fissati.
      expect(notFoundSpy).toHaveBeenCalledTimes(1);
      expect(redirectSpy).not.toHaveBeenCalled();
      // Del sito che non e' proprio non si legge NULLA, e non si puo' confermare nulla.
      expect(getBriefSpy).not.toHaveBeenCalled();
      expect(confirmBriefSpy).not.toHaveBeenCalled();
    }
  });

  // GUASTO NOSTRO != NON TROVATO: un ok:false di listSites non dice nulla sull'esistenza
  // del sito, quindi non puo' diventare un 404 (che sarebbe un'affermazione falsa su un
  // dato che non si e' potuto leggere).
  it('listSites in errore: errore server generico, non un 404, e nessun siteId nel messaggio', async () => {
    sitesHolder.list = { ok: false, status: 500 };
    await expect(renderReview()).rejects.toThrowError(/non disponibile/);
    await expect(renderReview()).rejects.not.toThrowError(new RegExp(SITE_ID));
    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(getBriefSpy).not.toHaveBeenCalled();
  });

  // GUASTO NOSTRO != BRIEF ASSENTE. `getBrief` ok:false e' 401 o 500 (T-123) e non dice
  // NULLA sul contenuto del brief: renderlo come brief VUOTO dava una schermata di revisione
  // su cui l'utente poteva confermare — con la conferma esplicita — un brief che non ha mai
  // visto, e `confirmBrief` avrebbe portato a status='confirmed' un contenuto ignoto.
  // Questa e' la meta' che il caso `brief:null` (legittimo, qui sotto) NON copre.
  it('getBrief in errore: errore server generico, nessuna schermata di revisione, nessun siteId nel messaggio', async () => {
    for (const status of [401, 500] as const) {
      briefsHolder.getResult = { ok: false, status };
      await expect(renderReview()).rejects.toThrowError(/brief non disponibile/);
      // NON-VACUITA': la pagina e' arrivata DAVVERO a leggere il brief (le guardie sono
      // passate), quindi il guasto e' quello di getBrief e non un rifiuto a monte.
      expect(getBriefSpy).toHaveBeenCalledWith(SITE_ID);
      // Non e' un 404: "non ho potuto leggere" non e' "non esiste".
      expect(notFoundSpy).not.toHaveBeenCalled();
      // Ne' lo status ne' il siteId finiscono nel messaggio (log e pagina d'errore in dev).
      await expect(renderReview()).rejects.not.toThrowError(new RegExp(SITE_ID));
      await expect(renderReview()).rejects.not.toThrowError(new RegExp(String(status)));
      // E soprattutto: nessuna conferma e' possibile, perche' non si rende nulla.
      expect(confirmBriefSpy).not.toHaveBeenCalled();
      getBriefSpy.mockClear();
      notFoundSpy.mockClear();
    }
  });

  it('sito proprio: il brief letto e quello del siteId della ROTTA, non del primo sito posseduto', async () => {
    await renderReview();
    expect(getBriefSpy).toHaveBeenCalledWith(SITE_ID);
    expect(getBriefSpy).not.toHaveBeenCalledWith(OTHER_SITE_ID);
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(notFoundSpy).not.toHaveBeenCalled();
  });
});

describe('T-152 recap editabile: campi core + offerte', () => {
  // covers: AC-152-1
  it('brief con business_name e due offerte: i campi core e le offerte sono editabili e valorizzati', async () => {
    await renderReview();
    const main = within(screen.getByRole('main'));

    // --- campi core -------------------------------------------------------------
    const businessName = main.getByLabelText(IT.fields.businessName) as HTMLInputElement;
    expect(businessName.value).toBe('Bar Sole'); // covers: AC-152-1
    expect(businessName.readOnly).toBe(false); // covers: AC-152-1
    expect(businessName.disabled).toBe(false); // covers: AC-152-1
    // Sei campi con valori distinti: una mappatura incrociata e' osservabile.
    expect((main.getByLabelText(IT.fields.address) as HTMLInputElement).value).toBe(
      'Via Roma 1, Roma',
    ); // covers: AC-152-1
    expect((main.getByLabelText(IT.fields.phone) as HTMLInputElement).value).toBe(PHONE); // covers: AC-152-1
    expect((main.getByLabelText(IT.fields.whatsapp) as HTMLInputElement).value).toBe(WHATSAPP); // covers: AC-152-1
    expect((main.getByLabelText(IT.fields.email) as HTMLInputElement).value).toBe(
      'ciao@barsole.example',
    ); // covers: AC-152-1
    expect((main.getByLabelText(IT.fields.vertical) as HTMLSelectElement).value).toBe(
      'ristorazione',
    ); // covers: AC-152-1
    expect((main.getByLabelText(IT.fields.primaryGoal) as HTMLSelectElement).value).toBe('ordina'); // covers: AC-152-1
    // `geo` e' un campo core: due input numerici, non un blocco in sola lettura.
    expect((main.getByLabelText(IT.review.geoLat) as HTMLInputElement).value).toBe('41.9'); // covers: AC-152-1
    expect((main.getByLabelText(IT.review.geoLng) as HTMLInputElement).value).toBe('12.5'); // covers: AC-152-1
    // Gli orari (P1-D13) restano editabili anche qui, coppia per coppia.
    expect((main.getByLabelText(label(IT.panel.hoursDay, 1)) as HTMLInputElement).value).toBe('mo'); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.panel.hoursValue, 2)) as HTMLInputElement).value).toBe(
      '10:00-23:00',
    ); // covers: AC-152-1

    // --- description: il textarea che P1-D17 nomina ------------------------------
    const description = main.getByLabelText(IT.fields.description) as HTMLTextAreaElement;
    expect(description.tagName).toBe('TEXTAREA'); // covers: AC-152-1
    expect(description.value).toBe('Caffe e cornetti in centro, dal 1962'); // covers: AC-152-1

    // --- offerte: DUE voci, ognuna coi propri campi ------------------------------
    expect((main.getByLabelText(label(IT.review.offeringName, 1)) as HTMLInputElement).value).toBe(
      'Cornetto',
    ); // covers: AC-152-1
    expect(
      (main.getByLabelText(label(IT.review.offeringSection, 1)) as HTMLInputElement).value,
    ).toBe('Colazione'); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.review.offeringPrice, 1)) as HTMLInputElement).value).toBe(
      '1,20',
    ); // covers: AC-152-1
    // La SECONDA voce: campi diversi dalla prima, quindi "rende le offerte" non puo'
    // essere vero rendendo solo la prima o ricopiandola.
    expect((main.getByLabelText(label(IT.review.offeringName, 2)) as HTMLInputElement).value).toBe(
      OFFERING_2_NAME,
    ); // covers: AC-152-1
    expect(
      (main.getByLabelText(label(IT.review.offeringDescription, 2)) as HTMLTextAreaElement).value,
    ).toBe(OFFERING_2_DESCRIPTION); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.review.offeringPhoto, 2)) as HTMLInputElement).value).toBe(
      OFFERING_2_PHOTO,
    ); // covers: AC-152-1
    // I campi vuoti della voce 2 esistono e sono editabili (il recap e' COMPLETO).
    expect((main.getByLabelText(label(IT.review.offeringPrice, 2)) as HTMLInputElement).value).toBe(
      '',
    ); // covers: AC-152-1

    // --- il resto del content: punti di forza, social, indicazioni di stile ------
    // T-151 li rende in SOLA LETTURA e dichiara T-152 come sede del loro editing.
    expect((main.getByLabelText(label(IT.review.highlight, 1)) as HTMLInputElement).value).toBe(
      'Wi-Fi gratis',
    ); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.review.highlight, 2)) as HTMLInputElement).value).toBe(
      'Tavoli fuori',
    ); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.review.socialLink, 1)) as HTMLInputElement).value).toBe(
      SOCIAL_1,
    ); // covers: AC-152-1
    expect((main.getByLabelText(label(IT.review.socialLink, 2)) as HTMLInputElement).value).toBe(
      SOCIAL_2,
    ); // covers: AC-152-1
    expect((main.getByLabelText(IT.panel.brandHints) as HTMLTextAreaElement).value).toBe(
      'Toni caldi, legno chiaro',
    ); // covers: AC-152-1
  });

  // P1-D17: il tetto di `description` e' 2000 code unit e T-152 e' la sede DICHIARATA del
  // textarea. Il valore al tetto e' reso PER INTERO (troncare sarebbe corruzione
  // silenziosa) e la UI non e' il gate della lunghezza: nessun maxlength che nasconda il
  // rifiuto server-side.
  it('description al TETTO di P1-D17: resa per intero in un textarea, senza maxlength', async () => {
    const atCeiling = 'x'.repeat(BRIEF_LIMITS.description);
    const applied = applyBriefUpdate(DRAFT_BRIEF, { description: atCeiling });
    // Non-vacuita': il dominio AMMETTE questo valore e rifiuta il successivo.
    expect(applied.rejected).toEqual([]);
    expect(applyBriefUpdate(DRAFT_BRIEF, { description: `${atCeiling}x` }).rejected).toContain(
      'description',
    );

    briefsHolder.getResult = { ok: true, brief: applied.brief, status: 'draft', complete: true };
    await renderReview();

    const field = screen.getByLabelText(IT.fields.description) as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toHaveLength(BRIEF_LIMITS.description);
    expect(field.getAttribute('maxlength')).toBeNull();
  });

  // Sito PROPRIO senza brief ancora creato (getBrief -> brief:null, caso legittimo, come
  // in T-150): il recap parte da emptyBrief(locale), quindi e' compilabile da subito
  // invece di essere una pagina vuota.
  it('sito proprio senza brief: il recap e reso vuoto ed editabile, non un 404', async () => {
    briefsHolder.getResult = { ok: true, brief: null, status: null, complete: false };
    await renderReview();

    expect(notFoundSpy).not.toHaveBeenCalled();
    const main = within(screen.getByRole('main'));
    expect((main.getByLabelText(IT.fields.businessName) as HTMLInputElement).value).toBe('');
    // vertical parte dal default dello schema di T-121, non da un valore inventato qui.
    expect((main.getByLabelText(IT.fields.vertical) as HTMLSelectElement).value).toBe('altro');
    // Nessuna offerta: non si inventano righe vuote.
    expect(main.queryByLabelText(label(IT.review.offeringName, 1))).toBeNull();
  });
});

describe('T-152 conferma ESPLICITA (AC-152-2)', () => {
  // covers: AC-152-2
  // LA META' NEGATIVA, quella che si dimentica: `confirmBrief` non e' invocata al render,
  // non lo e' digitando, non lo e' salvando, e non lo e' nemmeno al PRIMO click del
  // controllo di conferma — che apre la conferma esplicita e non conferma niente. Un solo
  // click che salva e conferma muore qui (vincolo 2).
  it('prima dell attivazione della conferma esplicita confirmBrief NON e invocata', async () => {
    const user = userEvent.setup();
    await renderReview();

    expect(confirmBriefSpy).not.toHaveBeenCalled(); // covers: AC-152-2

    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sole Bis');
    expect(confirmBriefSpy).not.toHaveBeenCalled(); // covers: AC-152-2

    // Salvare NON conferma: sono due azioni distinte.
    await user.click(screen.getByRole('button', { name: IT.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(confirmBriefSpy).not.toHaveBeenCalled(); // covers: AC-152-2

    // Primo click sul controllo di conferma: apre la conferma esplicita (pattern di
    // SiteRow/T-105) e NON invoca confirmBrief.
    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    const explicit = await screen.findByRole('button', { name: IT.review.confirmYes });
    expect(explicit).toBeTruthy(); // covers: AC-152-2
    // Attesa REALE prima di dichiarare che non e' stata chiamata (non un tick sincrono).
    await waitFor(() => expect(confirmBriefSpy).not.toHaveBeenCalled()); // covers: AC-152-2
    expect(pushSpy).not.toHaveBeenCalled(); // covers: AC-152-2

    // E si puo' tornare indietro senza confermare.
    await user.click(screen.getByRole('button', { name: itMessages.common.cancel }));
    expect(screen.queryByRole('button', { name: IT.review.confirmYes })).toBeNull();
    expect(confirmBriefSpy).not.toHaveBeenCalled(); // covers: AC-152-2
  });

  // covers: AC-152-2
  // covers: AC-152-3
  // La meta' POSITIVA, e l'identita' del sito: la conferma va al siteId della ROTTA (che
  // NON e' il primo sito posseduto), una volta sola e con NIENT'ALTRO come argomento.
  it('attivata la conferma esplicita: confirmBrief e invocata per QUEL sito, una volta sola', async () => {
    const user = userEvent.setup();
    await renderReview('it', OTHER_SITE_ID);

    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));

    await waitFor(() => expect(confirmBriefSpy).toHaveBeenCalledTimes(1)); // covers: AC-152-2
    expect(confirmBriefSpy).toHaveBeenCalledWith(OTHER_SITE_ID); // covers: AC-152-2
    // UN SOLO argomento: nessuno stato del client (ne' un brief, ne' un account) passa il
    // confine — lo status lo decide la server action, sotto RLS.
    //
    // ATTENZIONE, QUI FINISCE CIO' CHE QUESTA SUITE PUO' PROVARE DI AC-152-3: il CONTRATTO
    // della chiamata, non il suo effetto. Che questo contratto porti `status='confirmed'` in
    // tabella lo prova `tests/briefs-actions.test.ts` (vedi il rinvio in testa al file).
    expect(briefsHolder.confirmCalls[0]).toEqual([OTHER_SITE_ID]); // covers: AC-152-3 (solo il contratto)
    // La conferma non e' una scrittura di campi: non passa da upsertBrief.
    expect(upsertBriefSpy).not.toHaveBeenCalled(); // covers: AC-152-2
  });

  // T152-V06 — DOPPIO INVIO della conferma. La conferma e' l'azione irreversibile della
  // schermata (il brief diventa l'artefatto che P2 consumera'): con la richiesta ANCORA IN
  // VOLO un secondo click non deve produrre una seconda `confirmBrief`.
  // Si CONTANO LE INVOCAZIONI, non si guarda l'attributo `disabled`: `disabled` e' una
  // conseguenza osservabile della guardia, non la guardia — un test sull'attributo passerebbe
  // anche con un handler che spara due volte, ed e' proprio il modo in cui questo buco era
  // rimasto aperto.
  it('doppio click sulla conferma: confirmBrief e invocata UNA volta sola', async () => {
    const user = userEvent.setup();
    const g = gate();
    briefsHolder.confirmGate = g.promise;
    await renderReview();

    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    const yes = screen.getByRole('button', { name: IT.review.confirmYes });
    await user.click(yes);
    await waitFor(() => expect(confirmBriefSpy).toHaveBeenCalledTimes(1));

    // Il cancello NON e' rilasciato: la prima conferma e' pendente, ed e' esattamente lo
    // stato in cui un utente riclicca perche' "non e' successo niente".
    await user.click(yes);
    await user.click(yes);
    expect(confirmBriefSpy).toHaveBeenCalledTimes(1);
    expect(briefsHolder.confirmCalls).toEqual([[SITE_ID]]);

    // NON-VACUITA': rilasciato il cancello il flusso arriva in fondo (una sola navigazione),
    // quindi il conteggio a uno non e' l'effetto di una conferma che non parte mai.
    g.release();
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/it/dashboard'));
    expect(confirmBriefSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  // covers: AC-152-3
  // "dopo la conferma l'utente torna alla dashboard": destinazione INTERNA FISSA
  // /{locale}/dashboard, mai da input utente (anti open-redirect, come T-044).
  it('dopo la conferma riuscita: si torna a /{locale}/dashboard', async () => {
    const user = userEvent.setup();
    await renderReview();

    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));

    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/it/dashboard')); // covers: AC-152-3
    expect(pushSpy).toHaveBeenCalledTimes(1);
    // E l'etichetta "torna alla dashboard" punta alla stessa destinazione fissa.
    const back = within(screen.getByRole('main')).getByRole('link', {
      name: IT.review.backToDashboard,
    });
    expect(back.getAttribute('href')).toBe('/it/dashboard'); // covers: AC-152-3
  });

  // La destinazione NON viene dal segmento grezzo dell'URL: con un locale fuori allowlist
  // si usa il default. Senza questo caso, un `/${rawLocale}/dashboard` passerebbe tutto.
  it('locale fuori allowlist: la destinazione della dashboard resta interna e sull allowlist', async () => {
    const user = userEvent.setup();
    await renderReview('it', SITE_ID, 'evil.example');

    const back = within(screen.getByRole('main')).getByRole('link', {
      name: IT.review.backToDashboard,
    });
    expect(back.getAttribute('href')).toBe('/it/dashboard');

    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/it/dashboard'));
  });

  // LA UI NON E' IL GATE: l'autorizzazione della conferma e' della RLS in confirmBrief
  // (404 cross-tenant / brief assente, 401 senza sessione). Il rifiuto si RENDE, con un
  // messaggio unico che non distingue i casi (P1-D21: distinguerli sarebbe un oracolo di
  // enumerazione), e l'utente NON viene mandato in dashboard come se fosse andata bene.
  it('confirmBrief rifiutata: errore localizzato generico, nessuna navigazione, status non esposto', async () => {
    for (const status of [401, 404, 500] as const) {
      const user = userEvent.setup();
      briefsHolder.confirmResult = { ok: false, status };
      const { container } = await renderReview();

      await user.click(screen.getByRole('button', { name: IT.review.confirm }));
      await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(IT.review.confirmError);
      expect(container.textContent).not.toContain(String(status));
      expect(pushSpy).not.toHaveBeenCalled();
      cleanup();
    }
  });

  // Un brief mai salvato non ha riga in tabella: confirmBrief risponde 404 (T-123 la
  // pinna DB-backed). La UI non pre-valida per nascondere il gate: manda la conferma e
  // rende il rifiuto.
  it('sito senza brief: la conferma passa comunque dal gate e il rifiuto e reso', async () => {
    const user = userEvent.setup();
    briefsHolder.getResult = { ok: true, brief: null, status: null, complete: false };
    briefsHolder.confirmResult = { ok: false, status: 404 };
    await renderReview();

    await user.click(screen.getByRole('button', { name: IT.review.confirm }));
    await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));

    await waitFor(() => expect(confirmBriefSpy).toHaveBeenCalledWith(SITE_ID));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(IT.review.confirmError);
    expect(pushSpy).not.toHaveBeenCalled();
  });

  // Modifiche non salvate + conferma: la conferma NON salva (sono due azioni distinte),
  // quindi l'utente va avvisato invece di perdere silenziosamente cio' che ha scritto.
  it('modifiche non salvate: la conferma esplicita avvisa, e non salva di nascosto', async () => {
    const user = userEvent.setup();
    await renderReview();

    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sole Bis');
    await user.click(screen.getByRole('button', { name: IT.review.confirm }));

    expect(await screen.findByText(IT.review.unsaved)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: IT.review.confirmYes }));
    await waitFor(() => expect(confirmBriefSpy).toHaveBeenCalledTimes(1));
    // La conferma non ha scritto i campi: `confirmBrief` tocca solo `status` (T-123).
    expect(upsertBriefSpy).not.toHaveBeenCalled();

    // E senza modifiche pendenti l'avviso non c'e' (non-vacuita': non e' sempre a schermo).
    cleanup();
    const user2 = userEvent.setup();
    await renderReview();
    await user2.click(screen.getByRole('button', { name: IT.review.confirm }));
    expect(screen.queryByText(IT.review.unsaved)).toBeNull();
  });
});

describe('T-152 gli edit del recap passano da upsertBrief', () => {
  it('modifiche a core, offerte, punti di forza e social: la patch e ESATTA e il dominio la applica come mostrato', async () => {
    const user = userEvent.setup();
    await renderReview();

    // Un campo core di testo, il textarea, una voce d'offerta, un punto di forza, un
    // social e le indicazioni di stile: nature diverse in una sola patch.
    const phone = screen.getByLabelText(IT.fields.phone);
    await user.clear(phone);
    await user.type(phone, '+39 06 0000009');
    const description = screen.getByLabelText(IT.fields.description);
    await user.clear(description);
    await user.type(description, 'Caffe, cornetti e pranzo veloce');
    const price = screen.getByLabelText(label(IT.review.offeringPrice, 1));
    await user.clear(price);
    await user.type(price, '1,50');
    const highlight2 = screen.getByLabelText(label(IT.review.highlight, 2));
    await user.clear(highlight2);
    await user.type(highlight2, 'Tavoli in cortile');
    const social2 = screen.getByLabelText(label(IT.review.socialLink, 2));
    await user.clear(social2);
    await user.type(social2, 'https://terzo.example/barsole');
    const brand = screen.getByLabelText(IT.panel.brandHints);
    await user.clear(brand);
    await user.type(brand, 'Toni caldi, ottone');

    await user.click(screen.getByRole('button', { name: IT.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));

    const [siteId, patch] = briefsHolder.upsertCalls[0] as [string, Record<string, unknown>];
    expect(siteId).toBe(SITE_ID);
    // UGUAGLIANZA ESATTA: solo i campi toccati, e le collezioni per intero (social_links e
    // highlights SOSTITUISCONO in T-122, quindi una patch parziale perderebbe le voci).
    expect(patch).toEqual({
      phone: '+39 06 0000009',
      description: 'Caffe, cornetti e pranzo veloce',
      offerings: [
        { name: 'Cornetto', section: 'Colazione', price: '1,50' },
        {
          name: OFFERING_2_NAME,
          description: OFFERING_2_DESCRIPTION,
          photo_ref: OFFERING_2_PHOTO,
        },
      ],
      highlights: ['Wi-Fi gratis', 'Tavoli in cortile'],
      social_links: [SOCIAL_1, 'https://terzo.example/barsole'],
      brand_hints: 'Toni caldi, ottone',
    });

    // upsertBrief e' mockata: senza questo passaggio nulla proverebbe che la patch sia
    // una patch che il GATE accetta e che SIGNIFICA cio' che la schermata mostra. Si
    // valida con lo schema REALE e si ri-applica col merge REALE di T-122.
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(true);
    const applied = applyBriefUpdate(DRAFT_BRIEF, patch);
    expect(applied.rejected).toEqual([]);
    expect(applied.brief.phone).toBe('+39 06 0000009');
    expect(applied.brief.content.offerings).toHaveLength(2);
    expect(applied.brief.content.offerings[0]).toEqual({
      name: 'Cornetto',
      section: 'Colazione',
      price: '1,50',
    });
    expect(applied.brief.content.highlights).toEqual(['Wi-Fi gratis', 'Tavoli in cortile']);
  });

  it('modifica di orari, coordinate ed enum: la patch porta le mappe intere e i valori nuovi', async () => {
    const user = userEvent.setup();
    await renderReview();

    const tuesday = screen.getByLabelText(label(IT.panel.hoursValue, 2));
    await user.clear(tuesday);
    await user.type(tuesday, '11:00-15:00');
    const lat = screen.getByLabelText(IT.review.geoLat);
    await user.clear(lat);
    await user.type(lat, '45.07');
    await user.selectOptions(screen.getByLabelText(IT.fields.primaryGoal), 'prenota');
    await user.selectOptions(screen.getByLabelText(IT.fields.vertical), 'fitness');

    await user.click(screen.getByRole('button', { name: IT.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));

    const [, patch] = briefsHolder.upsertCalls[0] as [string, Record<string, unknown>];
    expect(patch).toEqual({
      hours: { mo: '07:00-19:00', tu: '11:00-15:00' },
      geo: { lat: 45.07, lng: 12.5 },
      primary_goal: 'prenota',
      vertical: 'fitness',
    });
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(true);
  });

  // T152-V06 — DOPPIO INVIO del salvataggio: la stessa guardia sull'ALTRA azione. Con la
  // scrittura in volo un secondo click manderebbe una seconda `upsertBrief` con la stessa
  // patch (il draft non e' cambiato, quindi il diff e' ancora sporco), cioe' due scritture
  // dove l'utente ne ha chiesta una. Anche qui si contano le INVOCAZIONI: un oracolo
  // sull'attributo `disabled` non distinguerebbe un pulsante spento da un handler zittito.
  it('doppio click sul salvataggio: upsertBrief e invocata UNA volta sola', async () => {
    const user = userEvent.setup();
    const g = gate();
    briefsHolder.upsertGate = g.promise;
    await renderReview();

    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sole Bis');
    const save = screen.getByRole('button', { name: IT.panel.save });
    await user.click(save);
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));

    await user.click(save);
    await user.click(save);
    expect(upsertBriefSpy).toHaveBeenCalledTimes(1);
    expect(briefsHolder.upsertCalls).toEqual([[SITE_ID, { business_name: 'Bar Sole Bis' }]]);

    // NON-VACUITA': rilasciato il cancello il riscontro arriva, quindi il conteggio a uno non
    // e' un salvataggio che non parte mai.
    g.release();
    expect(await screen.findByText(IT.review.saveSent)).toBeTruthy();
    expect(upsertBriefSpy).toHaveBeenCalledTimes(1);
  });

  // Un salvataggio che si riduce a patch vuota non scrive — ma NON e' muto: un click che
  // non produce ne' una scrittura ne' un riscontro e' indistinguibile da un guasto, e
  // l'utente ci riprova senza sapere se il pulsante funziona.
  it('senza modifiche il salvataggio non scrive, e lo DICE invece di tacere', async () => {
    const user = userEvent.setup();
    await renderReview();
    // Non-vacuita': il riscontro non e' sempre a schermo, compare per il click.
    expect(screen.queryByText(IT.review.nothingToSave)).toBeNull();

    await user.click(screen.getByRole('button', { name: IT.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).not.toHaveBeenCalled());
    const status = await screen.findByText(IT.review.nothingToSave);
    expect(status.getAttribute('role')).toBe('status'); // non 'alert': non e' un errore
    // E non si afferma un salvataggio che non c'e' stato.
    expect(screen.queryByText(IT.review.saveSent)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // La validazione autoritativa e' server-side: un valore che il gate rifiuta viene
  // MANDATO (nessuna pre-validazione che nasconda il gate) e il rifiuto e' reso.
  // IL 400 HA UN MESSAGGIO SUO, perche' quello che accade e' particolare: `upsertBrief`
  // valida la patch INTERA con BriefUpdateSchema, quindi un solo campo fuori scala fa
  // fallire TUTTO il salvataggio e NULLA viene scritto. Un messaggio ambiguo lascerebbe
  // credere a un salvataggio parziale.
  it('upsertBrief 400: si dice che NULLA e stato salvato, e lo status non e esposto', async () => {
    const user = userEvent.setup();
    briefsHolder.upsertResult = { ok: false, status: 400 };
    const { container } = await renderReview();

    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() =>
      expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { business_name: '' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(IT.review.saveRejected);
    // Non e' il messaggio generico degli altri rifiuti: dice una cosa diversa perche' una
    // cosa diversa e' accaduta.
    expect(IT.review.saveRejected).not.toBe(IT.panel.saveError);
    expect(container.textContent).not.toContain('400');
    // E non si dice anche "inviate": le due note si escludono.
    expect(screen.queryByText(IT.review.saveSent)).toBeNull();
  });

  // 401/404/500 restano UN SOLO messaggio: distinguere il 404 sarebbe un oracolo di
  // enumerazione dei brief altrui (P1-D21). Il 400, invece, e' un verdetto sull'input che
  // l'utente ha appena inviato e non rivela nulla sui dati di altri.
  it('upsertBrief 401/404/500: un unico messaggio generico, indistinguibili fra loro', async () => {
    for (const status of [401, 404, 500] as const) {
      const user = userEvent.setup();
      briefsHolder.upsertResult = { ok: false, status };
      const { container } = await renderReview();

      const name = screen.getByLabelText(IT.fields.businessName);
      await user.clear(name);
      await user.type(name, 'Bar Sole Bis');
      await user.click(screen.getByRole('button', { name: IT.panel.save }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(IT.panel.saveError);
      // Il messaggio del 400 NON compare qui: i tre casi non lo prendono in prestito.
      expect(screen.queryByText(IT.review.saveRejected)).toBeNull();
      expect(container.textContent).not.toContain(String(status));
      cleanup();
    }
  });

  // T152-V01 — la nota di salvataggio DICEVA IL FALSO ("i singoli campi fuori dai limiti
  // vengono scartati dal server"). Qui si misura sul DOMINIO REALE chi fa cosa, perche' e'
  // la ragione per cui la stringa e' stata corretta e per cui il 400 ha un messaggio suo:
  //  - il GATE di upsertBrief e' BriefUpdateSchema, che valida la patch INTERA -> un solo
  //    campo fuori scala la rifiuta TUTTA (400: nulla scritto);
  //  - lo scarto PER CAMPO e' di applyBriefUpdate, che sta a VALLE e vede solo patch che lo
  //    schema ha gia' accettato.
  it('un solo campo fuori scala rifiuta la patch INTERA nel gate (lo scarto per campo e altrove)', () => {
    const patch = {
      phone: '+39 06 0000009',
      description: 'x'.repeat(BRIEF_LIMITS.description + 1),
    };
    // Il gate: rifiuta tutto, quindi nulla viene scritto — nemmeno il phone valido.
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(false);
    // Il merge a valle: quello scarta per campo. Sono due confini diversi, e solo il primo
    // decide se il salvataggio avviene.
    const applied = applyBriefUpdate(DRAFT_BRIEF, patch);
    expect(applied.rejected).toEqual(['description']);
    expect(applied.brief.phone).toBe('+39 06 0000009');
  });

  // Vincolo 8 / limite dichiarato di T-151: `upsertBrief` scarta CAMPO PER CAMPO e
  // ritorna solo {ok, complete} — `rejected[]` non attraversa quel confine. Quindi un ok
  // NON significa "tutti i campi sono salvati", e la schermata non deve dirlo. Questa
  // asserzione pinna che la nota resa e' quella che dichiara il limite: se qualcuno la
  // sostituisse con "Modifiche salvate", il test cade.
  it('salvataggio riuscito: si dichiara che il server puo scartare campi, non che tutto e salvato', async () => {
    const user = userEvent.setup();
    await renderReview();

    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sole Bis');
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(IT.review.saveSent)).toBeTruthy();
    // Non-vacuita': la nota non e' sempre a schermo.
    cleanup();
    await renderReview();
    expect(screen.queryByText(IT.review.saveSent)).toBeNull();
  });

  // LA UI NON E' IL GATE, nemmeno sui numeri: una coordinata non numerica viene MANDATA e
  // la rifiuta GeoSchema (T-121). Pre-validarla qui renderebbe il gate non osservabile, e
  // il rifiuto e' provato sullo schema REALE, non supposto.
  it('coordinata non numerica: spedita al gate, che la rifiuta (la UI non pre-valida)', async () => {
    const user = userEvent.setup();
    await renderReview();

    const lat = screen.getByLabelText(IT.review.geoLat);
    await user.clear(lat);
    await user.type(lat, 'nord');
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    const [, patch] = briefsHolder.upsertCalls[0] as [
      string,
      { geo: { lat: number; lng: number } },
    ];
    expect(Object.keys(patch)).toEqual(['geo']);
    expect(Number.isNaN(patch.geo.lat)).toBe(true);
    expect(patch.geo.lng).toBe(12.5);
    // Il gate lo rifiuta davvero: e' cio' che rende accettabile spedirlo.
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(false);
  });

  // LIMITE DICHIARATO 4: la patch di T-121 non ha modo di dire "rimuovi il campo", quindi
  // con una coordinata vuota `geo` non si spedisce affatto — meglio non poter svuotare che
  // spedire meta' coordinata (che il gate rifiuterebbe) o un `undefined` (che non e' un
  // valore inviabile).
  it('coordinata svuotata: geo non viene spedito (limite dichiarato, non un silenzio)', async () => {
    const user = userEvent.setup();
    await renderReview();

    await user.clear(screen.getByLabelText(IT.review.geoLng));
    // Non-vacuita': una modifica c'e' comunque, altrimenti il salvataggio non partirebbe.
    const name = screen.getByLabelText(IT.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sole Bis');
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    expect(upsertBriefSpy).toHaveBeenCalledWith(SITE_ID, { business_name: 'Bar Sole Bis' });
  });

  // LIMITE DICHIARATO E PINNATO (vincolo 6, e non e' una svista): `applyBriefUpdate` fonde
  // le offerte PER NOME (stesso name -> aggiorna, name nuovo -> appende) e non ha modo di
  // rinominare ne' di cancellare una voce. Quindi cambiare il nome di una voce nel recap
  // AGGIUNGE una voce e lascia la vecchia. La schermata lo dichiara all'utente (nota
  // localizzata) invece di far finta che sia una rinomina; la sede della fix e' T-122.
  it('rinominare una voce d offerta: T-122 ne AGGIUNGE una (limite dichiarato e reso)', async () => {
    const user = userEvent.setup();
    await renderReview();

    expect(screen.getByText(IT.review.offeringsNote)).toBeTruthy();

    const name1 = screen.getByLabelText(label(IT.review.offeringName, 1));
    await user.clear(name1);
    await user.type(name1, 'Cornetto integrale');
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    const [, patch] = briefsHolder.upsertCalls[0] as [string, Record<string, unknown>];
    // La patch porta il nome nuovo...
    expect(patch).toEqual({
      offerings: [
        { name: 'Cornetto integrale', section: 'Colazione', price: '1,20' },
        {
          name: OFFERING_2_NAME,
          description: OFFERING_2_DESCRIPTION,
          photo_ref: OFFERING_2_PHOTO,
        },
      ],
    });
    // ...e il merge REALE di T-122 produce TRE voci, non due rinominate. E' il limite,
    // misurato sul codice di dominio, non supposto.
    const applied = applyBriefUpdate(DRAFT_BRIEF, patch);
    expect(applied.brief.content.offerings.map((o) => o.name)).toEqual([
      'Cornetto',
      OFFERING_2_NAME,
      'Cornetto integrale',
    ]);
  });

  // Regola di casa, la stessa di T-151 sulle righe orario col giorno vuoto: una voce
  // svuotata non e' un dato. Una stringa vuota passerebbe BriefUpdateSchema
  // (`z.string().max(200)` accetta ''), quindi finirebbe DAVVERO in tabella e il sito
  // generato (P2) renderebbe un punto elenco vuoto.
  it('voci svuotate: scartate dalla patch, mai una stringa vuota nelle collezioni', async () => {
    const user = userEvent.setup();
    await renderReview();

    await user.clear(screen.getByLabelText(label(IT.review.highlight, 1)));
    await user.clear(screen.getByLabelText(label(IT.review.socialLink, 2)));
    // Anche una voce d'offerta senza nome: `name` ha .min(1) in T-121, quindi spedirla
    // farebbe scartare l'INTERO array (fail-closed di T-122) e si perderebbe anche la voce
    // valida dello stesso salvataggio.
    await user.clear(screen.getByLabelText(label(IT.review.offeringName, 2)));

    await user.click(screen.getByRole('button', { name: IT.panel.save }));
    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));

    const [, patch] = briefsHolder.upsertCalls[0] as [string, Record<string, unknown>];
    expect(patch).toEqual({
      highlights: ['Tavoli fuori'],
      social_links: [SOCIAL_1],
      offerings: [{ name: 'Cornetto', section: 'Colazione', price: '1,20' }],
    });
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(true);
    // E il gate accetta la patch: nessuna stringa vuota, nessun array rifiutato.
    expect(applyBriefUpdate(DRAFT_BRIEF, patch).rejected).toEqual([]);
  });
});

describe('T-152 testo del brief: input NON FIDATO in rendering (§7 p.4)', () => {
  // Le offerte arrivano anche da `fromUrl` (T-141): nome, descrizione, prezzo, sezione e
  // `photo_ref` possono contenere markup o `javascript:` presi da una pagina ostile. Il
  // markup sta in OGNI campo, compresi quelli resi come nodo di testo: un valore in un
  // `value` di input non crea elementi nemmeno passando da innerHTML, quindi con il markup
  // solo la' l'asserzione sarebbe vera per costruzione.
  const HOSTILE_BRIEF: Brief = applyBriefUpdate(emptyBrief('it'), {
    business_name: '<img src=x onerror="document.title=1">Bar Ostile',
    description: '<script>document.title="pwned"</script>',
    address: '<b>Via</b> Ostile 1',
    geo: { lat: 41.9, lng: 12.5 },
    hours: { '<img src=x>lun': '<b>sempre</b> aperto' },
    offerings: [
      {
        name: '<b>Voce</b> ostile',
        description: '<script>document.title="pwned"</script>Descrizione',
        price: '<b>1</b>',
        section: '<img src=x>Sezione',
        photo_ref: 'javascript:alert(3)',
      },
      { name: 'Seconda voce', photo_ref: 'data:text/html,<script>1</script>' },
    ],
    highlights: ['<img src=x onerror="document.title=1">Punto ostile', 'javascript:alert(1)'],
    social_links: ['javascript:alert(2)', 'https://social.example/ok'],
    brand_hints: '<script>document.title="pwned"</script>Stile',
  }).brief;

  it('nessun markup dal brief, e l unico href della schermata e la dashboard interna', async () => {
    briefsHolder.getResult = { ok: true, brief: HOSTILE_BRIEF, status: 'draft', complete: false };
    await renderReview();
    // Ambito: il contenuto della schermata (dentro <main>), non la nav dell AppShell.
    const main = screen.getByRole('main');

    // NON-VACUITA': i rami sorvegliati sono DAVVERO resi, coi valori ostili dentro.
    expect((screen.getByLabelText(IT.fields.businessName) as HTMLInputElement).value).toContain(
      'Bar Ostile',
    );
    expect(
      (screen.getByLabelText(label(IT.review.offeringPhoto, 1)) as HTMLInputElement).value,
    ).toBe('javascript:alert(3)');
    expect((screen.getByLabelText(label(IT.review.socialLink, 1)) as HTMLInputElement).value).toBe(
      'javascript:alert(2)',
    );
    expect((screen.getByLabelText(label(IT.panel.hoursDay, 1)) as HTMLInputElement).value).toBe(
      '<img src=x>lun',
    );
    expect((screen.getByLabelText(IT.review.geoLat) as HTMLInputElement).value).toBe('41.9');

    // NESSUN ELEMENTO NASCE DAL TESTO DEL BRIEF: nessun valore e' mai passato per
    // dangerouslySetInnerHTML, in nessun ramo.
    expect(main.querySelectorAll('img')).toHaveLength(0);
    expect(main.querySelectorAll('script')).toHaveLength(0);
    expect(main.querySelectorAll('b')).toHaveLength(0);
    expect(document.title).not.toBe('pwned');
    // NESSUN valore del brief in un href/src: `social_links` e `photo_ref` sono resi come
    // TESTO editabile (scelta dichiarata, la stessa di T-151), quindi non c'e' nessun
    // href da avvelenare. L'UNICO href della schermata e' la destinazione interna fissa.
    expect(main.querySelectorAll('[src]')).toHaveLength(0);
    expect([...main.querySelectorAll('[href]')].map((el) => el.getAttribute('href'))).toEqual([
      '/it/dashboard',
    ]);
    // UN SOLO <a> in tutta la schermata: cosi' non passa nemmeno un anchor SENZA href
    // (che l'asserzione sugli href non vedrebbe) costruito attorno a un valore del brief.
    expect(main.querySelectorAll('a')).toHaveLength(1);
    // E il valore resta VISIBILE per intero: non si sanitizza cancellando il dato
    // dell'utente (che e' corruzione silenziosa).
    expect(
      (screen.getByLabelText(label(IT.review.offeringName, 1)) as HTMLInputElement).value,
    ).toBe('<b>Voce</b> ostile');
    expect((screen.getByLabelText(label(IT.review.highlight, 1)) as HTMLInputElement).value).toBe(
      '<img src=x onerror="document.title=1">Punto ostile',
    );
    expect((screen.getByLabelText(IT.panel.brandHints) as HTMLTextAreaElement).value).toBe(
      '<script>document.title="pwned"</script>Stile',
    );
  });

  it('un brief ostile passa comunque dal gate: la patch conserva il testo cosi come e', async () => {
    const user = userEvent.setup();
    briefsHolder.getResult = { ok: true, brief: HOSTILE_BRIEF, status: 'draft', complete: false };
    await renderReview();

    const price = screen.getByLabelText(label(IT.review.offeringPrice, 1));
    await user.clear(price);
    await user.type(price, '2,00');
    await user.click(screen.getByRole('button', { name: IT.panel.save }));

    await waitFor(() => expect(upsertBriefSpy).toHaveBeenCalledTimes(1));
    const [, patch] = briefsHolder.upsertCalls[0] as [string, Record<string, unknown>];
    // La UI non e' il gate e non "pulisce" il testo: manda cio' che c'e', e la validazione
    // autoritativa (T-121, strict + tetti) resta l'unica a decidere.
    expect(BriefUpdateSchema.safeParse(patch).success).toBe(true);
    expect(patch.offerings).toEqual([
      {
        name: '<b>Voce</b> ostile',
        description: '<script>document.title="pwned"</script>Descrizione',
        price: '2,00',
        section: '<img src=x>Sezione',
        photo_ref: 'javascript:alert(3)',
      },
      { name: 'Seconda voce', photo_ref: 'data:text/html,<script>1</script>' },
    ]);
  });
});

describe('T-152 localizzazione (AC-152-4)', () => {
  // covers: AC-152-4
  it('schermata resa in es: rivedi, conferma e torna alla dashboard sono in spagnolo', async () => {
    await renderReview('es');
    const main = within(screen.getByRole('main'));

    // Rivedi (titolo della schermata, server-side) e conferma (client-side).
    expect(main.getByRole('heading', { name: ES.review.title })).toBeTruthy(); // covers: AC-152-4
    expect(main.getByRole('button', { name: ES.review.confirm })).toBeTruthy(); // covers: AC-152-4
    expect(main.getByRole('link', { name: ES.review.backToDashboard })).toBeTruthy(); // covers: AC-152-4
    expect(main.getByRole('button', { name: ES.panel.save })).toBeTruthy(); // covers: AC-152-4
    // Etichette dei campi e delle voci d'offerta (ICU posizionale compreso).
    expect(main.getByLabelText(ES.fields.businessName)).toBeTruthy(); // covers: AC-152-4
    expect(main.getByLabelText(label(ES.review.offeringName, 1))).toBeTruthy(); // covers: AC-152-4
    expect(main.getByLabelText(label(ES.review.highlight, 1))).toBeTruthy(); // covers: AC-152-4
    expect(main.getByLabelText(ES.review.geoLat)).toBeTruthy(); // covers: AC-152-4
    expect(main.getByText(ES.review.offeringsNote)).toBeTruthy(); // covers: AC-152-4

    // Le chiavi rese sono DAVVERO diverse dall'italiano (spagnolo vero, non copiato).
    expect(ES.review.title).not.toBe(IT.review.title); // covers: AC-152-4
    expect(ES.review.confirm).not.toBe(IT.review.confirm); // covers: AC-152-4
    expect(ES.review.confirmYes).not.toBe(IT.review.confirmYes); // covers: AC-152-4
    expect(ES.review.backToDashboard).not.toBe(IT.review.backToDashboard); // covers: AC-152-4
    expect(ES.review.confirmError).not.toBe(IT.review.confirmError); // covers: AC-152-4
    expect(ES.review.unsaved).not.toBe(IT.review.unsaved); // covers: AC-152-4
    expect(ES.review.saveSent).not.toBe(IT.review.saveSent); // covers: AC-152-4
    expect(ES.review.saveRejected).not.toBe(IT.review.saveRejected); // covers: AC-152-4
    expect(ES.review.nothingToSave).not.toBe(IT.review.nothingToSave); // covers: AC-152-4
    expect(ES.review.offeringsNote).not.toBe(IT.review.offeringsNote); // covers: AC-152-4
    expect(ES.review.offeringName).not.toBe(IT.review.offeringName); // covers: AC-152-4
    expect(ES.review.highlight).not.toBe(IT.review.highlight); // covers: AC-152-4
    expect(ES.review.socialLink).not.toBe(IT.review.socialLink); // covers: AC-152-4
    expect(ES.review.geoLat).not.toBe(IT.review.geoLat); // covers: AC-152-4

    // E nessuna stringa italiana e' rimasta nel DOM reso in es.
    expect(main.queryByText(IT.review.title)).toBeNull(); // covers: AC-152-4
    expect(main.queryByRole('button', { name: IT.review.confirm })).toBeNull(); // covers: AC-152-4
    expect(main.queryByRole('link', { name: IT.review.backToDashboard })).toBeNull(); // covers: AC-152-4
  });

  // covers: AC-152-4
  it('in es anche la conferma esplicita, i suoi errori e la destinazione sono localizzati', async () => {
    const user = userEvent.setup();
    briefsHolder.confirmResult = { ok: false, status: 404 };
    await renderReview('es');

    await user.click(screen.getByRole('button', { name: ES.review.confirm }));
    // Il controllo di conferma ESPLICITA e la sua annullabilita', in spagnolo.
    expect(await screen.findByRole('button', { name: ES.review.confirmYes })).toBeTruthy(); // covers: AC-152-4
    expect(screen.getByRole('button', { name: esMessages.common.cancel })).toBeTruthy(); // covers: AC-152-4

    await user.click(screen.getByRole('button', { name: ES.review.confirmYes }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ES.review.confirmError); // covers: AC-152-4

    // E la destinazione della dashboard segue il locale della rotta.
    const back = within(screen.getByRole('main')).getByRole('link', {
      name: ES.review.backToDashboard,
    });
    expect(back.getAttribute('href')).toBe('/es/dashboard'); // covers: AC-152-4
  });

  // covers: AC-152-4
  // Anche i riscontri del salvataggio (il rifiuto totale del 400 e il "niente da salvare")
  // sono localizzati: sono stringhe nuove, quindi e' la' che una mancanza in un catalogo
  // passerebbe inosservata.
  it('in es i riscontri del salvataggio sono in spagnolo', async () => {
    const user = userEvent.setup();
    await renderReview('es');

    // Nessuna modifica: il riscontro minimo, in spagnolo.
    await user.click(screen.getByRole('button', { name: ES.panel.save }));
    expect(await screen.findByText(ES.review.nothingToSave)).toBeTruthy(); // covers: AC-152-4

    // Un 400: nulla e' stato salvato, e lo dice in spagnolo.
    briefsHolder.upsertResult = { ok: false, status: 400 };
    const name = screen.getByLabelText(ES.fields.businessName);
    await user.clear(name);
    await user.type(name, 'Bar Sol Bis');
    await user.click(screen.getByRole('button', { name: ES.panel.save }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ES.review.saveRejected); // covers: AC-152-4
  });

  // covers: AC-152-4
  it('in es la conferma riuscita torna a /es/dashboard', async () => {
    const user = userEvent.setup();
    await renderReview('es');
    await user.click(screen.getByRole('button', { name: ES.review.confirm }));
    await user.click(screen.getByRole('button', { name: ES.review.confirmYes }));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/es/dashboard')); // covers: AC-152-4
  });
});
