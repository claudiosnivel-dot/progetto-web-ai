import type { Page } from '@playwright/test';

// LA SENTINELLA GLOBALE DELL'EFFETTO. Un'iniezione riuscita nel browser incrementa
// `window.__belora_pwned`; l'harness la inizializza a 0 con page.addInitScript su ogni documento e
// l'oracolo la rilegge. Dichiarata ambient qui — il modulo e' importato dagli spec, quindi
// l'augmentation e' in scope ovunque senza un file .d.ts orfano — cosi' i callback di
// page.evaluate/addInitScript la vedono tipata invece di ricorrere a `any`.
declare global {
  interface Window {
    __belora_pwned?: number;
  }
}

// T-240 (macrotask generation-e2e, P2) — L'HELPER CONDIVISO DELLE ASSERZIONI SULL'EFFETTO (DoD).
// E' cio' che separa "nessuno script ha girato" (effetto, browser reale) da "nessun elemento nasce
// dal testo del brief" (forma, jsdom, P1). Lo usano SIA il canary (AC-240-2, che lo fa fallire) SIA
// lo scenario reale (T-241, che lo fa passare): un solo oracolo, due usi, cosi' il verde del reale
// significa qualcosa solo perche' lo stesso oracolo sa diventare rosso sul canary.
//
// `attachObservables` va chiamato PRIMA della navigazione: registra via page.addInitScript la
// sentinella `window.__belora_pwned = 0` su ogni documento, e raccoglie le osservabili dell'effetto
// — messaggi ed errori di console, eccezioni non catturate, richieste di rete con il loro HOST
// (da new URL(req.url()).host), risposte con status, e le navigazioni del frame principale.
// `assertNoInjectionEffect` FALLISCE (throw) se una qualunque di queste condizioni e' vera:
//  - il contatore globale e' > 0 (uno script iniettato ha eseguito);
//  - c'e' un errore di console o un'eccezione non catturata (codice iniettato che ha girato);
//  - una richiesta e' diretta a un host fuori dall'allowlist DICHIARATA dal chiamante;
//  - il documento e' NAVIGATO (l'href javascript: o l'iframe hanno spostato la pagina).

// I tre record delle osservabili sono usati SOLO dentro Observables (qui sotto): non esportati, cosi'
// non restano export senza consumatore esterno (dead-code per knip). Observables, che li compone, e'
// il tipo pubblico che gli spec ricevono.
type RequestRecord = {
  readonly url: string;
  readonly host: string;
  readonly method: string;
  readonly resourceType: string;
};

type ResponseRecord = {
  readonly url: string;
  readonly host: string;
  readonly status: number;
};

type ConsoleRecord = {
  readonly type: string;
  readonly text: string;
};

export type Observables = {
  readonly consoleMessages: ConsoleRecord[];
  readonly consoleErrors: ConsoleRecord[];
  readonly pageErrors: string[];
  readonly requests: RequestRecord[];
  readonly responses: ResponseRecord[];
  readonly navigations: string[];
  readonly initialUrl: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Registra sulla pagina la sentinella e i collettori delle osservabili. Da chiamare PRIMA di
 * page.goto / page.setContent, altrimenti gli eventi anteriori all'aggancio andrebbero persi.
 */
export async function attachObservables(page: Page): Promise<Observables> {
  const observables: Observables = {
    consoleMessages: [],
    consoleErrors: [],
    pageErrors: [],
    requests: [],
    responses: [],
    navigations: [],
    initialUrl: page.url(),
  };

  await page.addInitScript(() => {
    window.__belora_pwned = 0;
  });

  page.on('console', (message) => {
    const record: ConsoleRecord = { type: message.type(), text: message.text() };
    observables.consoleMessages.push(record);
    if (message.type() === 'error') observables.consoleErrors.push(record);
  });

  page.on('pageerror', (error) => {
    observables.pageErrors.push(error.message);
  });

  page.on('request', (request) => {
    observables.requests.push({
      url: request.url(),
      host: hostOf(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });

  page.on('response', (response) => {
    observables.responses.push({
      url: response.url(),
      host: hostOf(response.url()),
      status: response.status(),
    });
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) observables.navigations.push(frame.url());
  });

  return observables;
}

/** Il contatore globale live, letto al momento dell'asserzione (non uno snapshot). */
export async function readInjectionCounter(page: Page): Promise<number> {
  return page.evaluate(() => window.__belora_pwned ?? 0);
}

export type InjectionAssertionOptions = {
  /** Gli host verso cui una richiesta di rete e' AMMESSA, DICHIARATI dal chiamante (non impliciti). */
  readonly allowedHosts: readonly string[];
  /**
   * L'URL a cui il documento deve essere ANCORA quando si asserisce. Se fornito, un URL corrente
   * diverso (o una navigazione del frame principale verso altro) e' un fallimento. Se omesso, il
   * controllo di navigazione richiede che ci sia al piu' una destinazione di frame principale
   * non-blank.
   */
  readonly expectedUrl?: string;
};

/**
 * FALLISCE se una qualunque osservabile tradisce un effetto d'iniezione (vedi l'intestazione).
 * Raccoglie TUTTI i problemi e li riporta insieme, cosi' il messaggio dice cosa e' scattato.
 */
export async function assertNoInjectionEffect(
  page: Page,
  observables: Observables,
  options: InjectionAssertionOptions,
): Promise<void> {
  const problems: string[] = [];

  const counter = await readInjectionCounter(page);
  if (counter > 0) {
    problems.push(`window.__belora_pwned = ${counter} (uno script iniettato ha eseguito)`);
  }

  if (observables.pageErrors.length > 0) {
    problems.push(`eccezioni non catturate: ${observables.pageErrors.join(' | ')}`);
  }
  // ERRORI DI CONSOLE ATTRIBUIBILI A CODICE INIETTATO, non al rumore del browser. Un fallimento di
  // caricamento risorsa ("Failed to load resource", es. una favicon assente) e' un errore di console
  // di tipo 'error' generato dal BROWSER per una risposta di rete, non da uno script eseguito: non e'
  // "codice iniettato" e non deve far fallire l'oracolo (altrimenti ogni pagina reale con una 404
  // innocua sarebbe rossa, e T-241 non potrebbe mai passare). Una console.error CHIAMATA da un
  // payload (come fa il canary) resta invece un fallimento.
  const injectedConsoleErrors = observables.consoleErrors.filter(
    (error) => !/failed to load resource/i.test(error.text),
  );
  if (injectedConsoleErrors.length > 0) {
    problems.push(
      `errori di console da codice iniettato: ${injectedConsoleErrors.map((error) => error.text).join(' | ')}`,
    );
  }

  const allowed = new Set(options.allowedHosts);
  const offHost = observables.requests
    .map((request) => request.host)
    .filter((host) => host.length > 0 && !allowed.has(host));
  if (offHost.length > 0) {
    problems.push(`richieste verso host fuori allowlist: ${[...new Set(offHost)].join(', ')}`);
  }

  const nonBlankNavigations = [
    ...new Set(observables.navigations.filter((url) => url.length > 0 && url !== 'about:blank')),
  ];
  if (options.expectedUrl !== undefined) {
    const current = page.url();
    if (current !== options.expectedUrl) {
      problems.push(`URL cambiato: atteso ${options.expectedUrl}, corrente ${current}`);
    }
    const stray = nonBlankNavigations.filter((url) => url !== options.expectedUrl);
    if (stray.length > 0) {
      problems.push(`navigazioni impreviste del frame principale: ${stray.join(', ')}`);
    }
  } else if (nonBlankNavigations.length > 1) {
    problems.push(`piu di una navigazione del frame principale: ${nonBlankNavigations.join(', ')}`);
  }

  if (problems.length > 0) {
    throw new Error(`assertNoInjectionEffect: effetto d'iniezione rilevato -> ${problems.join(' ; ')}`);
  }
}
