import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  attachObservables,
  assertNoInjectionEffect,
  readInjectionCounter,
} from './support/effect-assertions';
import { seedSite, seedGenerationWithDocument } from './support/seed';
import { USER_FILE, type TestUser } from './support/paths';
import {
  buildInnocuousDocument,
  BUSINESS_NAME,
  KNOWN_OFFERING,
} from './fixtures/innocuous-document';
import {
  insecureCanaryHtml,
  navigatingCanaryHtml,
  CANARY_INJECTED_MARKER,
} from './canary/insecure-canary';

// T-240 (macrotask generation-e2e, P2) — L'HARNESS su Chromium e il CANARY. Le asserzioni derivano
// da AC-240-1 e AC-240-2 (05-generation-e2e.md), taggate `// covers: AC-240-<n>` sull'expect.
//
// AC-240-1: seed di un documento INNOCUO -> carico /it/preview/{siteId} da AUTENTICATO -> il nome
//   dell'attivita' e' nel DOM, il contatore globale e' zero, e fra le richieste RACCOLTE compare il
//   documento HTML della rotta anteprima con esito 200 (cosi' "nessun host esterno" non e' vero solo
//   perche' la raccolta e' vuota).
// AC-240-2: monto il canary via page.setContent -> applico lo STESSO assertNoInjectionEffect -> DEVE
//   fallire (contatore incrementato e/o errore di console da codice iniettato): l'oracolo sa
//   diventare rosso.

/** L'utente di test provisionato dal globalSetup. Letto NEL test (mai a import-time, per --list). */
function testUser(): TestUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
}

test.describe('T-240 harness Chromium — anteprima da documento innocuo (AC-240-1)', () => {
  test('carica /preview da autenticato: nome nel DOM, contatore zero, doc HTML 200 fra le richieste', async ({
    page,
  }) => {
    // given: una generazione GIA' congelata con il documento innocuo, su un sito dell'utente di test.
    const { accountId } = testUser();
    const suffix = randomUUID().slice(0, 8);
    const siteId = await seedSite({
      accountId,
      name: `E2E preview ${suffix}`,
      slug: `e2e-preview-${suffix}`,
    });
    await seedGenerationWithDocument({
      accountId,
      siteId,
      document: buildInnocuousDocument(),
      status: 'complete',
      chosenVariant: 0,
    });

    // Osservabili agganciate PRIMA della navigazione.
    const observables = await attachObservables(page);

    const previewPath = `/it/preview/${siteId}`;
    const response = await page.goto(previewPath);
    // La navigazione stessa e' andata a buon fine (l'anteprima e' una rotta protetta: 200 = auth ok).
    expect(response?.status()).toBe(200); // covers: AC-240-1

    // then: il nome dell'attivita' del fixture e le sue offerte sono nel DOM (la pagina si e' resa).
    // toContainText sul body, non getByText: il nome compare in piu' punti (marchio hero + titolo),
    // e una locator che risolve piu' elementi violerebbe la strict mode invece di provare la presenza.
    await expect(page.locator('body')).toContainText(BUSINESS_NAME); // covers: AC-240-1
    await expect(page.locator('body')).toContainText(KNOWN_OFFERING); // covers: AC-240-1

    // then: il contatore globale e' zero — nessuno script e' eseguito su un documento innocuo.
    expect(await readInjectionCounter(page)).toBe(0); // covers: AC-240-1

    // then: la RACCOLTA non e' vuota, e contiene il documento HTML della rotta anteprima con 200.
    const appHost = new URL(page.url()).host;
    expect(observables.requests.length).toBeGreaterThan(0); // covers: AC-240-1
    const documentRequest = observables.requests.find(
      (request) => request.resourceType === 'document' && request.url.includes(previewPath),
    );
    expect(documentRequest).toBeDefined(); // covers: AC-240-1
    const documentResponse = observables.responses.find(
      (candidate) => candidate.url === documentRequest?.url,
    );
    expect(documentResponse?.status).toBe(200); // covers: AC-240-1

    // then: nessuna richiesta e' diretta a un host diverso da quello dell'app — e non e' vero per
    // vuoto, perche' la richiesta del documento qui sopra prova che la raccolta e' popolata.
    const offHost = observables.requests
      .map((request) => request.host)
      .filter((host) => host.length > 0 && host !== appHost);
    expect(offHost).toEqual([]); // covers: AC-240-1

    // E lo STESSO oracolo che il canary fa fallire, sulla pagina innocua, NON fallisce: la
    // simmetria di AC-240-2 vale solo se qui l'asserzione passa (lo strumento legge zero sul pulito).
    await expect(
      assertNoInjectionEffect(page, observables, {
        allowedHosts: [appHost],
        expectedUrl: page.url(),
      }),
    ).resolves.toBeUndefined(); // covers: AC-240-1
  });
});

test.describe('T-240 canary — l oracolo sa diventare rosso (AC-240-2)', () => {
  test('il canary montato via setContent fa FALLIRE lo stesso assertNoInjectionEffect', async ({
    page,
  }) => {
    // given: le osservabili agganciate, poi il canary montato (page.setContent, mai una rotta app).
    const observables = await attachObservables(page);
    await page.setContent(insecureCanaryHtml());
    const contentUrl = page.url();

    // Sanity: l'iniezione e' AVVENUTA davvero (il payload onerror ha eseguito). Se questo fosse
    // zero, il canary non starebbe iniettando e AC-240-2 sarebbe vacuo.
    expect(await readInjectionCounter(page)).toBeGreaterThan(0); // covers: AC-240-2
    // Ed e' registrato un errore di console attribuibile al codice iniettato. Il marchio arriva dalla
    // costante del canary (CANARY_INJECTED_MARKER), non da un letterale duplicato: un solo posto lo definisce.
    expect(observables.consoleErrors.some((error) => error.text.includes(CANARY_INJECTED_MARKER))).toBe(
      true,
    ); // covers: AC-240-2

    // then: lo STESSO helper usato dallo scenario reale FALLISCE sul canary: l'oracolo e' rosso.
    await expect(
      assertNoInjectionEffect(page, observables, {
        allowedHosts: [],
        expectedUrl: contentUrl,
      }),
    ).rejects.toThrow(/effetto d'iniezione rilevato/); // covers: AC-240-2
  });
});

// Canary di NAVIGAZIONE — chiude il buco di onesta' segnalato in verifica su AC-241-3: AC-240-2 prova
// la red-ability dell'oracolo su contatore e console, ma NESSUN payload ne' il canary sopra esercita
// una navigazione, quindi l'assenza-di-navigazione asserita in hostile-document.spec (AC-241-3)
// reggeva in gran parte per costruzione. Qui un canary sposta DAVVERO il documento e lo STESSO helper
// deve diventare rosso sulla dimensione navigazione — come per le altre due.
test.describe('T-240/T-241 canary di NAVIGAZIONE — la dimensione navigazione sa diventare rossa (AC-241-3)', () => {
  // L'host dell'app (= baseURL di playwright.config). Puntare qui isola la navigazione: la richiesta
  // e' verso un host AMMESSO, quindi a scattare e' solo la dimensione navigazione, non l'off-host.
  const APP_HOST = '127.0.0.1:3000';
  const NAV_TARGET = `http://${APP_HOST}/it`;

  test('un canary che naviga fa FALLIRE lo stesso assertNoInjectionEffect sulla NAVIGAZIONE', async ({
    page,
  }) => {
    // given: osservabili agganciate su una pagina ancora a about:blank, poi il canary di navigazione
    // montato (page.setContent). Il suo script sposta il documento verso l'host dell'app (http reale:
    // il browser bloccherebbe una data:/blob: al frame principale).
    const observables = await attachObservables(page);
    // setContent puo' essere interrotto dalla navigazione che il canary stesso avvia: la ignoro.
    await page.setContent(navigatingCanaryHtml(NAV_TARGET)).catch(() => {});
    // attendo che lo spostamento sia avvenuto (l'URL non e' piu' about:blank).
    await expect.poll(() => page.url(), { timeout: 10000 }).not.toBe('about:blank'); // covers: AC-241-3

    // Sanity di ISOLAMENTO: la navigazione NON ha toccato la sentinella, cosi' il rosso e'
    // attribuibile alla SOLA dimensione navigazione, non a un contatore incrementato.
    expect(await readInjectionCounter(page)).toBe(0); // covers: AC-241-3

    // then: lo STESSO helper diventa rosso, e per la NAVIGAZIONE — cosi' l'assenza-di-navigazione
    // asserita in AC-241-3 non e' vera per costruzione: il rilevatore SA scattare. L'host di
    // destinazione e' AMMESSO, quindi l'unica dimensione che scatta e' la navigazione.
    await expect(
      assertNoInjectionEffect(page, observables, { allowedHosts: [APP_HOST], expectedUrl: 'about:blank' }),
    ).rejects.toThrow(/URL cambiato|navigazion/i); // covers: AC-241-3
  });
});
