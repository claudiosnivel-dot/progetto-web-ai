import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  attachObservables,
  assertNoInjectionEffect,
  readInjectionCounter,
} from './support/effect-assertions';
import { seedSite, seedGenerationWithDocument, cleanupSite } from './support/seed';
import { USER_FILE, type TestUser } from './support/paths';
import { buildHostileDocument, HOSTILE_PAYLOADS, ATTACKER_HOST } from './fixtures/hostile-brief';

// T-241 (macrotask generation-e2e, P2) — DOCUMENTO OSTILE asserito sull'EFFETTO. Le asserzioni
// derivano da AC-241-1, AC-241-2, AC-241-3, AC-241-4, AC-241-6 (05-generation-e2e.md), taggate
// `// covers`. E' la differenza fra "nessun elemento nasce dal testo del brief" (forma, jsdom, P1)
// e "nessuno script ha girato" (effetto, browser reale): il documento e' costruito dai SEI payload
// attraverso il percorso REALE (resolve) e reso dall'anteprima, e si legge cio' che il browser HA
// FATTO — la sentinella globale, le richieste con il loro host, le navigazioni, gli errori di
// console — con lo STESSO helper condiviso che il canary di T-240 fa fallire (AC-240-2).

// L'ALLOWLIST DEGLI HOST, DICHIARATA nel test e non implicita (AC-241-2): l'app gira su
// 127.0.0.1:3000 (il site_url dell'auth locale) e NESSUNA richiesta deve partire verso un altro
// host — in particolare verso l'host dell'attaccante presente nel photo_ref e nella url() di CSS.
const ALLOWED_HOSTS = ['127.0.0.1:3000'] as const;

/** L'utente di test provisionato dal globalSetup. Letto NEL test (mai a import-time, per --list). */
function testUser(): TestUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
}

test.describe('T-241 documento ostile — asserito sull EFFETTO (AC-241-1..4, AC-241-6)', () => {
  // Isolamento fra i casi: il teardown globale cancella comunque l'utente (CASCADE), questo tiene
  // pulita la tabella fra un run e l'altro invece di accumulare siti seminati.
  const seededSites: string[] = [];
  test.afterAll(async () => {
    for (const siteId of seededSites) await cleanupSite(siteId);
  });

  test('l anteprima del brief ostile non esegue nulla, non chiama host esterni, non naviga', async ({
    page,
  }) => {
    // given: una generazione GIA' congelata col documento OSTILE (i sei payload nei campi esatti),
    // su un sito dell'utente di test. Il documento e' costruito dal percorso reale (resolve): il
    // photo_ref verso l'host attaccante e' gia' STRIPPATO da T-202/T-214, e cio' e' cio' che rende
    // significativa AC-241-2 — l'intera catena tiene, dal brief alla pagina, non solo un anello.
    const { accountId } = testUser();
    const suffix = randomUUID().slice(0, 8);
    const siteId = await seedSite({
      accountId,
      name: `E2E ostile ${suffix}`,
      slug: `e2e-ostile-${suffix}`,
    });
    seededSites.push(siteId);
    await seedGenerationWithDocument({
      accountId,
      siteId,
      document: buildHostileDocument(),
      status: 'complete',
      chosenVariant: 0,
    });

    // Osservabili agganciate PRIMA della navigazione (sentinella a 0, richieste, console, navigazioni).
    const observables = await attachObservables(page);

    const previewPath = `/it/preview/${siteId}`;
    const response = await page.goto(previewPath);
    // La rotta e' protetta: 200 = la sessione dell'utente di test e' passata e la pagina si e' resa.
    expect(response?.status()).toBe(200);
    const previewUrl = page.url();

    // Il testo del DOM letto come i test jsdom di P1 (container.textContent), per la presenza esatta
    // dei payload — che portano '<', '>', '(', ')' e vanno confrontati byte per byte, non normalizzati.
    const bodyText = await page.evaluate(() => document.body?.textContent ?? '');

    // AC-241-6 (RETE ANTI-PLACEBO) — TUTTI E SEI i payload presenti come CONTENUTO TESTUALE: prova
    // che lo scenario esercita davvero i payload e non passa perche' il testo ostile e' stato
    // scartato prima di arrivare alla pagina. Sei, distinti; la mappa campo->payload vive nel fixture.
    const payloads = Object.values(HOSTILE_PAYLOADS);
    expect(payloads).toHaveLength(6); // i sei dell'objective, non meno // covers: AC-241-6
    for (const payload of payloads) {
      expect(bodyText).toContain(payload); // covers: AC-241-6
    }

    // AC-241-1 — il contatore globale che un'iniezione riuscita incrementerebbe e' ZERO: nessuno
    // script proveniente dal testo del brief ha eseguito (ogni payload TENTA di incrementarlo).
    expect(await readInjectionCounter(page)).toBe(0); // covers: AC-241-1

    // AC-241-2 — nessuna richiesta verso un host fuori dall'allowlist DICHIARATA; in particolare
    // NESSUNA verso l'host dell'attaccante. La raccolta NON e' vuota (la pagina ha chiesto almeno il
    // proprio documento), quindi "nessun host esterno" non e' vero solo perche' non si e' raccolto nulla.
    const requestedHosts = observables.requests.map((request) => request.host).filter((host) => host.length > 0);
    expect(requestedHosts.length).toBeGreaterThan(0); // non vacuo // covers: AC-241-2
    const allowed = new Set<string>(ALLOWED_HOSTS);
    const offHost = [...new Set(requestedHosts.filter((host) => !allowed.has(host)))];
    expect(offHost).toEqual([]); // covers: AC-241-2
    expect(requestedHosts.includes(ATTACKER_HOST)).toBe(false); // covers: AC-241-2

    // AC-241-3 — nessuna navigazione: l'URL corrente e' invariato e nessuna navigazione del frame
    // principale ha spostato il documento (l'href javascript: e l'iframe non l'hanno mosso).
    expect(page.url()).toBe(previewUrl); // covers: AC-241-3
    const strayNavigations = [
      ...new Set(
        observables.navigations.filter(
          (url) => url.length > 0 && url !== 'about:blank' && url !== previewUrl,
        ),
      ),
    ];
    expect(strayNavigations).toEqual([]); // covers: AC-241-3

    // AC-241-4 — nessun errore di console attribuibile a codice iniettato. Il rumore del browser (una
    // risorsa 404, "Failed to load resource") e' un errore del BROWSER, non di uno script eseguito: si
    // scarta, altrimenti ogni pagina reale con una favicon assente sarebbe rossa.
    const injectedConsoleErrors = observables.consoleErrors.filter(
      (error) => !/failed to load resource/i.test(error.text),
    );
    expect(injectedConsoleErrors).toEqual([]); // covers: AC-241-4
    expect(observables.pageErrors).toEqual([]); // covers: AC-241-4

    // L'ORACOLO CONDIVISO di T-240 — lo STESSO assertNoInjectionEffect che il canary fa FALLIRE
    // (AC-240-2) qui NON fallisce. E' cio' che da' significato al verde del reale: vale solo perche'
    // lo stesso oracolo sa diventare rosso sul canary. Copre 1..4 insieme, con l'allowlist dichiarata.
    await expect(
      assertNoInjectionEffect(page, observables, {
        allowedHosts: [...ALLOWED_HOSTS],
        expectedUrl: previewUrl,
      }),
    ).resolves.toBeUndefined(); // covers: AC-241-1, AC-241-2, AC-241-3, AC-241-4
  });
});
