import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  attachObservables,
  assertNoInjectionEffect,
  readInjectionCounter,
} from './support/effect-assertions';
import {
  seedSite,
  seedGenerationWithDocument,
  seedAsset,
  seedPublication,
  cleanupSite,
} from './support/seed';
import { USER_FILE, type TestUser } from './support/paths';
import {
  buildPublishedHostileDocument,
  nearCollisionUuids,
  HOSTILE_PAYLOADS,
  ATTACKER_HOST,
  JSONLD_BREAKOUT_PAYLOAD,
} from './fixtures/hostile-brief';
import { insecureCanaryHtml } from './canary/insecure-canary';
import { assetPublicUrl } from '@/config/storage';

// T-417 (macrotask e2e-public, P4, ULTIMO di P4) — DOCUMENTO PUBBLICATO OSTILE asserito sull'EFFETTO
// sulla rotta PUBBLICA e ANON /s/<slug>. E' l'estensione di T-241 (anteprima) e T-317 (editor) al
// primo punto in cui un artefatto di Belora ESCE NEL MONDO (P4-D3, P4-D9): lo STESSO oracolo
// condiviso di T-240, la STESSA disciplina "leggi cio' che il browser HA FATTO" (contatore, richieste
// col loro host, navigazioni, errori di console), stavolta su due superfici NUOVE — un ASSET caricato
// reso da SiteImage source:'uploaded' (asset_id -> URL nostro, P2-D12/P4-D7) e il JSON-LD
// LocalBusiness iniettato (escaping anti-breakout dallo <script>, P4-D8) — provate sull'effetto. Le
// asserzioni derivano da AC-417-1..5 (06-e2e-public.md), taggate `// covers`. Il verde vale SOLO
// perche' lo STESSO oracolo, montato sul canary insicuro, sa diventare ROSSO (AC-417-5).

// CONTESTO ANON (RLS anon-published, A01:2025): la pagina NON ha sessione — lo storageState di file
// (utente autenticato del globalSetup) e' SOSTITUITO da uno vuoto. Cosi' la rotta /s/<slug> e' servita
// come al ruolo Postgres `anon`, e il documento arriva SOLO perche' is_published=true (mai una
// sessione a mascherare la RLS). Vale per tutti i test del file (reale e canary).
test.use({ storageState: { cookies: [], origins: [] } });

// L'app host dell'auth locale (site_url). L'host dello Storage NON e' hardcoded: e' DERIVATO da
// assetPublicUrl (lo STESSO builder che l'app usa per l'src dell'immagine), cosi' l'allowlist e la
// pagina parlano dello stesso host anche se la porta cambiasse (env NEXT_PUBLIC_SUPABASE_URL).
const APP_HOST = '127.0.0.1:3000';

/** L'host pubblico dello Storage, DERIVATO dall'URL che l'app costruisce per l'asset (mai una porta
 *  scritta a mano): dipende solo da NEXT_PUBLIC_SUPABASE_URL, non dall'id. */
function storageHostOf(assetId: string): string {
  return new URL(assetPublicUrl(assetId)).host;
}

/** L'utente di test provisionato dal globalSetup. Letto NEL test (mai a import-time, per --list). */
function testUser(): TestUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
}

test.describe('T-417 pagina pubblica ostile /s/<slug> — asserita sull EFFETTO da ANON (AC-417-1..4)', () => {
  // Isolamento fra i casi: il teardown globale cancella comunque l'utente (CASCADE), questo tiene
  // pulite le tabelle (sites -> assets/publications/generations via FK cascade) fra un run e l'altro.
  const seededSites: string[] = [];
  test.afterAll(async () => {
    for (const siteId of seededSites) await cleanupSite(siteId);
  });

  test('un documento pubblicato ostile con asset uploaded e JSON-LD non esegue nulla, non chiama host esterni, non naviga', async ({
    page,
  }) => {
    // given: un sito dell'utente di test, DUE asset reali con id NEAR-COLLISION (>1 elemento,
    // DISCORDANTI, uno prefisso dell'altro: la trappola di prefisso di AC-417-3), un documento
    // PUBBLICATO ostile che promuove `used` a hero uploaded e alimenta il JSON-LD col breakout, e una
    // riga site_publications is_published=true. Tutto passa dal percorso reale (buildPublishedHostileDocument
    // -> parseDocument); il public_slug e' NAMESPACED (unico globale, DB condiviso).
    const { accountId } = testUser();
    const suffix = randomUUID().slice(0, 8);
    const siteId = await seedSite({
      accountId,
      name: `E2E public ostile ${suffix}`,
      slug: `e2e-public-ostile-${suffix}`,
    });
    seededSites.push(siteId);

    const { used, sibling } = nearCollisionUuids();
    await seedAsset({ accountId, siteId, assetId: used });
    await seedAsset({ accountId, siteId, assetId: sibling });

    const doc = buildPublishedHostileDocument(used);
    const genId = await seedGenerationWithDocument({
      accountId,
      siteId,
      document: doc,
      status: 'complete',
      chosenVariant: 0,
    });
    const publicSlug = `e2e-public-hostile-${suffix}`;
    await seedPublication({
      accountId,
      siteId,
      sourceGenerationId: genId,
      document: doc,
      publicSlug,
      locale: 'it',
    });

    // ALLOWLIST DICHIARATA nel test: l'app host e l'host Storage DERIVATO dallo stesso builder
    // (mai una porta hardcoded); ESCLUDE l'host attaccante.
    const storageHost = storageHostOf(used);
    const allowedHosts = [APP_HOST, storageHost];

    // Osservabili agganciate PRIMA della navigazione (sentinella a 0, richieste, console, navigazioni).
    const observables = await attachObservables(page);

    const response = await page.goto(`/s/${publicSlug}`);
    // 200 servito ad ANON: la RLS anon-published ha restituito la riga (is_published=true), il gate
    // parseDocument e' passato, la pagina si e' resa.
    expect(response?.status()).toBe(200); // covers: AC-417-2
    const publicUrl = page.url();

    // Il testo del DOM letto come i test jsdom di P1 (textContent), per la presenza esatta dei payload —
    // che portano '<', '>', '(', ')' e vanno confrontati byte per byte, non normalizzati.
    const bodyText = await page.evaluate(() => document.body?.textContent ?? '');

    // AC-417-2 (RETE ANTI-PLACEBO) — TUTTI E SEI i payload presenti come CONTENUTO TESTUALE della
    // pagina pubblica: prova che la superficie esercita davvero i payload e non passa perche' il testo
    // ostile e' stato scartato a monte. Sei, distinti; la mappa campo->payload vive nel fixture.
    const payloads = Object.values(HOSTILE_PAYLOADS);
    expect(payloads).toHaveLength(6); // i sei dell'objective, non meno // covers: AC-417-2
    for (const payload of payloads) {
      expect(bodyText).toContain(payload); // covers: AC-417-2
    }

    // AC-417-1 — il contatore globale che un'iniezione riuscita incrementerebbe e' ZERO: nessuno
    // script proveniente dal testo del brief ne dal JSON-LD ha eseguito (ognuno TENTA di incrementarlo).
    expect(await readInjectionCounter(page)).toBe(0); // covers: AC-417-1

    // AC-417-1 / AC-417-3 — nessuna richiesta verso un host fuori dall'allowlist DICHIARATA; in
    // particolare NESSUNA verso l'host attaccante. La raccolta NON e' vuota (la pagina ha chiesto
    // almeno il proprio documento e l'immagine dell'asset), quindi "nessun host esterno" non e' vero
    // solo perche' non si e' raccolto nulla.
    const requestedHosts = observables.requests
      .map((request) => request.host)
      .filter((host) => host.length > 0);
    expect(requestedHosts.length).toBeGreaterThan(0); // non vacuo // covers: AC-417-1
    const allowed = new Set<string>(allowedHosts);
    const offHost = [...new Set(requestedHosts.filter((host) => !allowed.has(host)))];
    expect(offHost).toEqual([]); // covers: AC-417-1
    expect(requestedHosts.includes(ATTACKER_HOST)).toBe(false); // covers: AC-417-1
    // L'host Storage E' stato interrogato (l'<img> uploaded ha caricato): l'allowlist e' ESERCITATA,
    // non un ramo morto. Se l'immagine non partisse, "storage nell'allowlist" non proverebbe nulla.
    expect(requestedHosts.includes(storageHost)).toBe(true); // covers: AC-417-3

    // AC-417-1 — nessuna navigazione: l'URL corrente e' invariato e nessuna navigazione del frame
    // principale ha spostato il documento (l'href javascript: e l'iframe non l'hanno mosso).
    expect(page.url()).toBe(publicUrl); // covers: AC-417-1
    const strayNavigations = [
      ...new Set(
        observables.navigations.filter(
          (url) => url.length > 0 && url !== 'about:blank' && url !== publicUrl,
        ),
      ),
    ];
    expect(strayNavigations).toEqual([]); // covers: AC-417-1

    // AC-417-1 — nessun errore di console attribuibile a codice iniettato. Il rumore del browser (una
    // risorsa 404, "Failed to load resource") e' un errore del BROWSER, non di uno script eseguito: si
    // scarta, altrimenti ogni pagina reale con una risorsa assente sarebbe rossa.
    const injectedConsoleErrors = observables.consoleErrors.filter(
      (error) => !/failed to load resource/i.test(error.text),
    );
    expect(injectedConsoleErrors).toEqual([]); // covers: AC-417-1
    expect(observables.pageErrors).toEqual([]); // covers: AC-417-1

    // AC-417-3 — l'<img> dello slot uploaded ha src verso il NOSTRO host Storage, costruito dall'asset_id
    // ESATTO (uguaglianza, non prefisso): byte-uguale ad assetPublicUrl(used), termina con /<used>, e NON
    // termina con `sibling` (la near-collision non lo confonde). Nessuna richiesta all'host attaccante.
    const imgLocator = page.locator(`img[data-image-asset="${used}"]`);
    expect(await imgLocator.count()).toBe(1); // covers: AC-417-3
    const imgSrc = await imgLocator.getAttribute('src');
    expect(imgSrc).toBe(assetPublicUrl(used)); // covers: AC-417-3
    expect(imgSrc?.endsWith(`/${used}`)).toBe(true); // covers: AC-417-3
    expect(imgSrc?.endsWith(sibling)).toBe(false); // identita' esatta, mai prefisso // covers: AC-417-3
    const storageRequests = observables.requests.filter((request) => request.host === storageHost);
    expect(storageRequests.length).toBeGreaterThan(0); // una richiesta E' andata allo Storage // covers: AC-417-3
    expect(observables.requests.some((request) => request.host === ATTACKER_HOST)).toBe(false); // covers: AC-417-3

    // AC-417-4 — il <script type="application/ld+json"> del LocalBusiness e' reso coi campi ostili
    // ESCAPED: ESATTAMENTE uno; il testo NON contiene la sequenza grezza di chiusura del tag (deve
    // essere escaped come <...>) ne i separatori di riga grezzi; JSON.parse riesce come un
    // SINGOLO oggetto con @type LocalBusiness e name che contiene il breakout; la sentinella resta 0
    // (nessuno script iniettato dal breakout ha eseguito).
    const CLOSE_SCRIPT = '</' + 'script>'; // spezzato: mai grezzo nemmeno nel sorgente del test
    const RAW_LS = String.fromCharCode(0x2028);
    const RAW_PS = String.fromCharCode(0x2029);
    const jsonLdLocator = page.locator('script[type="application/ld+json"]');
    expect(await jsonLdLocator.count()).toBe(1); // covers: AC-417-4
    const raw = (await jsonLdLocator.first().textContent()) ?? '';
    expect(raw.length).toBeGreaterThan(0); // covers: AC-417-4
    expect(raw.includes(CLOSE_SCRIPT)).toBe(false); // chiusura del tag irrappresentabile // covers: AC-417-4
    expect(raw).toContain('\\u003c'); // < e' escaped (forma < presente) // covers: AC-417-4
    expect(raw.includes(RAW_LS)).toBe(false); // U+2028 escaped, mai grezzo // covers: AC-417-4
    expect(raw.includes(RAW_PS)).toBe(false); // U+2029 escaped, mai grezzo // covers: AC-417-4
    const parsedJsonLd = JSON.parse(raw) as { '@type'?: unknown; name?: unknown };
    expect(Array.isArray(parsedJsonLd)).toBe(false); // un SINGOLO oggetto, non un array // covers: AC-417-4
    expect(parsedJsonLd['@type']).toBe('LocalBusiness'); // covers: AC-417-4
    expect(typeof parsedJsonLd.name).toBe('string'); // covers: AC-417-4
    expect(parsedJsonLd.name as string).toContain(JSONLD_BREAKOUT_PAYLOAD); // il breakout resta DATO // covers: AC-417-4
    expect(await readInjectionCounter(page)).toBe(0); // nessuno script del breakout ha eseguito // covers: AC-417-4

    // L'ORACOLO CONDIVISO di T-240 — lo STESSO assertNoInjectionEffect che il canary fa FALLIRE
    // (AC-417-5) sulla superficie pubblica NON fallisce. E' cio' che da' significato al verde del
    // reale: vale solo perche' lo stesso oracolo sa diventare rosso sul canary. Copre 1..4 insieme, con
    // l'allowlist dichiarata (app host + storage host) e l'URL /s/<slug> atteso.
    await expect(
      assertNoInjectionEffect(page, observables, { allowedHosts, expectedUrl: publicUrl }),
    ).resolves.toBeUndefined(); // covers: AC-417-1, AC-417-2, AC-417-3, AC-417-4
  });
});

test.describe('T-417 canary — lo STESSO oracolo della pagina pubblica diventa ROSSO (AC-417-5)', () => {
  test('il canary insicuro montato via setContent fa FALLIRE lo stesso assertNoInjectionEffect con la STESSA allowlist', async ({
    page,
  }) => {
    // given: le osservabili agganciate, poi il canary montato (page.setContent, MAI una rotta app — il
    // marker di confinamento del canary resta strettamente in e2e/canary). Si monta lo STESSO payload
    // che la pagina pubblica ha reso INERTE (HOSTILE_PAYLOADS.eventAttribute), stavolta attraverso il
    // SINK insicuro innerHTML del canary: cio' che distingue il verde del reale dal rosso del canary e'
    // il SINK (children React con escaping vs innerHTML grezzo), non il payload.
    const observables = await attachObservables(page);
    await page.setContent(insecureCanaryHtml(HOSTILE_PAYLOADS.eventAttribute));
    const contentUrl = page.url();

    // La STESSA allowlist dichiarata del test reale: l'host Storage DERIVATO da assetPublicUrl (dipende
    // solo dall'env, non dall'id), cosi' l'oracolo diventa rosso con la STESSA allowlist, non una piu'
    // stretta scritta ad hoc per il canary.
    const allowedHosts = [APP_HOST, storageHostOf(randomUUID())];

    // Sanity: l'iniezione e' AVVENUTA davvero (il payload onerror ha eseguito). Se questo fosse zero,
    // il canary non starebbe iniettando e AC-417-5 sarebbe vacuo.
    expect(await readInjectionCounter(page)).toBeGreaterThan(0); // covers: AC-417-5

    // then: lo STESSO helper (e la STESSA allowlist) usato dallo scenario reale FALLISCE sul canary:
    // l'oracolo e' rosso. E' la contro-prova che il verde di AC-417-1 non e' un placebo.
    await expect(
      assertNoInjectionEffect(page, observables, { allowedHosts, expectedUrl: contentUrl }),
    ).rejects.toThrow(/effetto d'iniezione rilevato/); // covers: AC-417-5
  });
});
