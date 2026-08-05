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
import { insecureCanaryHtml } from './canary/insecure-canary';

// T-317 (macrotask editor-blocks, P3) — I PAYLOAD OSTILI ESERCITATI SULLA SUPERFICIE EDITOR, asseriti
// sull'EFFETTO. E' il MIRROR di hostile-document.spec.ts (T-241) spostato dalla rotta ANTEPRIMA alla
// rotta EDITOR /{locale}/editor/{siteId}: lo STESSO documento ostile (i sei payload nei campi esatti,
// costruito dal percorso reale), reso stavolta in modalita EDITABLE dal renderer UNICO (SiteView
// editable -> isole EditableText, T-305). Le asserzioni derivano da AC-317-1, AC-317-2, AC-317-3,
// taggate `// covers`. La differenza con la forma (jsdom, P1) resta la stessa: qui si legge cio' che
// il browser HA FATTO — sentinella globale, richieste con il loro host, navigazioni, errori di
// console — con lo STESSO oracolo condiviso (assertNoInjectionEffect) che il canary di T-240 fa
// diventare rosso. L'editing non deve aprire una nuova via di iniezione: il testo non fidato resta
// children React (escaping) e l'attivazione client legge textContent, mai innerHTML (P3-D6).

// L'ALLOWLIST DEGLI HOST, DICHIARATA nel test e non implicita: l'app gira su 127.0.0.1:3000 (il
// site_url dell'auth locale) e NESSUNA richiesta deve partire verso un altro host — in particolare
// verso l'host dell'attaccante presente nel photo_ref e nella url() di CSS del brief ostile.
const ALLOWED_HOSTS = ['127.0.0.1:3000'] as const;

/** L'utente di test provisionato dal globalSetup. Letto NEL test (mai a import-time, per --list). */
function testUser(): TestUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
}

test.describe('T-317 editor ostile — asserito sull EFFETTO (AC-317-1, AC-317-2)', () => {
  // Isolamento fra i casi: il teardown globale cancella comunque l'utente (CASCADE), questo tiene
  // pulita la tabella fra un run e l'altro invece di accumulare siti seminati.
  const seededSites: string[] = [];
  test.afterAll(async () => {
    for (const siteId of seededSites) await cleanupSite(siteId);
  });

  test('l editor col documento ostile non esegue nulla, non chiama host esterni, non naviga', async ({
    page,
  }) => {
    // given: una generazione GIA' congelata col documento OSTILE (i sei payload nei campi esatti), su
    // un sito dell'utente di test. Il documento e' lo STESSO che l'anteprima esercita in T-241 —
    // costruito dal percorso reale (resolve), col photo_ref verso l'host attaccante gia' STRIPPATO —
    // cosi' cio' che cambia e' solo la SUPERFICIE: la rotta editor in modalita editable, non l'anteprima.
    const { accountId } = testUser();
    const suffix = randomUUID().slice(0, 8);
    const siteId = await seedSite({
      accountId,
      name: `E2E editor ostile ${suffix}`,
      slug: `e2e-editor-ostile-${suffix}`,
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

    const editorPath = `/it/editor/${siteId}`;
    const response = await page.goto(editorPath);
    // La rotta editor e' protetta dalla STESSA catena dell'anteprima (enterSiteRoute): 200 = la
    // sessione dell'utente di test e' passata e la pagina si e' resa.
    expect(response?.status()).toBe(200);
    const editorUrl = page.url();

    // AC-317-2 (ANTI-PLACEBO, l'oracolo non e' vacuo per "editor non caricato") — l'editor e' montato
    // in EDIT-MODE, non uno stato vuoto. Si attende che la shell client abbia IDRATATO e attivato le
    // isole: `contenteditable="true"` compare solo dopo l'effetto di attivazione di EditorClient (che
    // imposta contentEditable su ogni [data-editable-path]). Questa attesa e' anche la barriera di
    // idratazione: le asserzioni sull'effetto piu' sotto girano dopo che il JS client ha eseguito.
    await expect(
      page.locator('[data-editable-path][contenteditable="true"]').first(),
    ).toBeAttached(); // covers: AC-317-2
    // La radice della shell editor c'e' (una sola), le isole di testo ci sono (il documento e' reso in
    // edit-mode), e lo stato ESPLICITO di indisponibilita' ([data-editor-empty]) NON c'e': l'editor ha
    // reso un documento reale, non il fallback "sito non ancora generato".
    expect(await page.locator('[data-editor-root]').count()).toBe(1); // covers: AC-317-2
    expect(await page.locator('[data-editable-path]').count()).toBeGreaterThan(0); // covers: AC-317-2
    expect(await page.locator('[data-editor-empty]').count()).toBe(0); // covers: AC-317-2

    // Il testo del DOM letto come i test jsdom di P1 (container.textContent), per la presenza esatta
    // dei payload — che portano '<', '>', '(', ')' e vanno confrontati byte per byte, non normalizzati.
    const bodyText = await page.evaluate(() => document.body?.textContent ?? '');

    // AC-317-2 (RETE ANTI-PLACEBO) — TUTTI E SEI i payload presenti come CONTENUTO TESTUALE dell'editor:
    // prova che lo scenario esercita davvero i payload sulla superficie editor e non passa perche' il
    // testo ostile e' stato scartato prima di arrivare alla pagina. Le isole EditableText rendono il
    // testo non fidato come children React (escaping preservato): un tag <script> o un onerror COMPAIONO
    // come TESTO, mai come markup — che e' esattamente la disciplina di T-241 estesa all'editor.
    const payloads = Object.values(HOSTILE_PAYLOADS);
    expect(payloads).toHaveLength(6); // i sei dell'objective, non meno // covers: AC-317-2
    for (const payload of payloads) {
      expect(bodyText).toContain(payload); // covers: AC-317-2
    }

    // AC-317-1 — il contatore globale che un'iniezione riuscita incrementerebbe e' ZERO: nessuno
    // script proveniente dal testo del brief ha eseguito nell'editor (ogni payload TENTA di incrementarlo).
    expect(await readInjectionCounter(page)).toBe(0); // covers: AC-317-1

    // AC-317-1 — nessuna richiesta verso un host fuori dall'allowlist DICHIARATA; in particolare
    // NESSUNA verso l'host dell'attaccante. La raccolta NON e' vuota (l'editor ha chiesto almeno il
    // proprio documento e le server action della shell), quindi "nessun host esterno" non e' vero solo
    // perche' non si e' raccolto nulla.
    const requestedHosts = observables.requests
      .map((request) => request.host)
      .filter((host) => host.length > 0);
    expect(requestedHosts.length).toBeGreaterThan(0); // non vacuo // covers: AC-317-1
    const allowed = new Set<string>(ALLOWED_HOSTS);
    const offHost = [...new Set(requestedHosts.filter((host) => !allowed.has(host)))];
    expect(offHost).toEqual([]); // covers: AC-317-1
    expect(requestedHosts.includes(ATTACKER_HOST)).toBe(false); // covers: AC-317-1

    // AC-317-1 — nessuna navigazione: l'URL corrente e' invariato e nessuna navigazione del frame
    // principale ha spostato il documento (l'href javascript: e l'iframe non l'hanno mosso). L'editor
    // resta sulla propria rotta: nessun router.refresh, nessuna riscelta, l'editing non naviga.
    expect(page.url()).toBe(editorUrl); // covers: AC-317-1
    const strayNavigations = [
      ...new Set(
        observables.navigations.filter(
          (url) => url.length > 0 && url !== 'about:blank' && url !== editorUrl,
        ),
      ),
    ];
    expect(strayNavigations).toEqual([]); // covers: AC-317-1

    // AC-317-1 — nessun errore di console attribuibile a codice iniettato. Il rumore del browser (una
    // risorsa 404, "Failed to load resource") e' un errore del BROWSER, non di uno script eseguito: si
    // scarta, altrimenti ogni pagina reale con una risorsa assente sarebbe rossa.
    const injectedConsoleErrors = observables.consoleErrors.filter(
      (error) => !/failed to load resource/i.test(error.text),
    );
    expect(injectedConsoleErrors).toEqual([]); // covers: AC-317-1
    expect(observables.pageErrors).toEqual([]); // covers: AC-317-1

    // L'ORACOLO CONDIVISO di T-240 — lo STESSO assertNoInjectionEffect che il canary fa FALLIRE
    // (AC-317-3, qui sotto) sulla superficie editor NON fallisce. E' cio' che da' significato al verde
    // del reale: vale solo perche' lo stesso oracolo sa diventare rosso sul canary. Copre le dimensioni
    // di AC-317-1 insieme, con l'allowlist dichiarata e l'URL editor atteso.
    await expect(
      assertNoInjectionEffect(page, observables, {
        allowedHosts: [...ALLOWED_HOSTS],
        expectedUrl: editorUrl,
      }),
    ).resolves.toBeUndefined(); // covers: AC-317-1
  });
});

test.describe('T-317 canary — lo STESSO oracolo dell editor diventa ROSSO (AC-317-3)', () => {
  test('il canary insicuro montato via setContent fa FALLIRE lo stesso assertNoInjectionEffect', async ({
    page,
  }) => {
    // given: le osservabili agganciate, poi il canary montato (page.setContent, MAI una rotta app —
    // il marker di confinamento del canary resta strettamente in e2e/canary). Si monta lo STESSO payload che
    // l'editor ha reso INERTE qui sopra (HOSTILE_PAYLOADS.eventAttribute), stavolta attraverso il SINK
    // insicuro innerHTML del canary: cosi' cio' che distingue il verde dell'editor dal rosso del canary
    // e' il SINK (children React con escaping vs innerHTML grezzo), non il payload — la falsificabilita'
    // dell'oracolo e' provata sullo stesso testo ostile che l'editor tratta in sicurezza.
    const observables = await attachObservables(page);
    await page.setContent(insecureCanaryHtml(HOSTILE_PAYLOADS.eventAttribute));
    const contentUrl = page.url();

    // Sanity: l'iniezione e' AVVENUTA davvero (il payload onerror ha eseguito). Se questo fosse zero,
    // il canary non starebbe iniettando e AC-317-3 sarebbe vacuo.
    expect(await readInjectionCounter(page)).toBeGreaterThan(0); // covers: AC-317-3

    // then: lo STESSO helper (e la STESSA allowlist) usato dallo scenario reale dell'editor FALLISCE
    // sul canary: l'oracolo e' rosso. E' la contro-prova che il verde di AC-317-1 non e' un placebo.
    await expect(
      assertNoInjectionEffect(page, observables, {
        allowedHosts: [...ALLOWED_HOSTS],
        expectedUrl: contentUrl,
      }),
    ).rejects.toThrow(/effetto d'iniezione rilevato/); // covers: AC-317-3
  });
});
