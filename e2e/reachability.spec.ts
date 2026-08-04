import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { seedSite, seedConfirmedBrief, seedReadyGeneration, cleanupSite } from './support/seed';
import { USER_FILE, type TestUser } from './support/paths';
import {
  innocuousBrief,
  innocuousHomePool,
  BUSINESS_NAME,
  KNOWN_OFFERING,
} from './fixtures/innocuous-document';

// T-241 (macrotask generation-e2e, P2) — RAGGIUNGIBILITA' del deliverable. L'asserzione deriva da
// AC-241-5 (05-generation-e2e.md), taggata `// covers`. E' la lezione di T-151 portata in un browser
// reale: 'npm run build' passava mentre i componenti erano ASSENTI dagli asset. Qui si percorre UNA
// volta genera -> scegli -> anteprima in Chromium, col confine LLM sostituito da un DOPPIO
// DETERMINISTICO (un pool 'home' condiviso seminato, nessuna chiamata al modello), e si dimostra che
// la pagina finale contiene il contenuto del documento scelto — che il percorso e' raggiungibile
// dall'applicazione, non solo presente nel sorgente.

/** L'utente di test provisionato dal globalSetup. Letto NEL test (mai a import-time, per --list). */
function testUser(): TestUser {
  return JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
}

test.describe('T-241 raggiungibilita del deliverable (AC-241-5)', () => {
  const seededSites: string[] = [];
  test.afterAll(async () => {
    for (const siteId of seededSites) await cleanupSite(siteId);
  });

  test('genera -> scegli -> anteprima in Chromium, col confine LLM come doppio deterministico', async ({
    page,
  }) => {
    // given: un utente autenticato con un brief CONFERMATO (nome attivita' noto + offerte discordanti)
    // e IL DOPPIO DETERMINISTICO del confine LLM — una generazione 'ready' piu' un pool 'home'
    // condiviso (variant_index null, P2-D3). Nessuna chiamata al modello: il pool e' quello di T-240.
    const { accountId } = testUser();
    const suffix = randomUUID().slice(0, 8);
    const siteId = await seedSite({
      accountId,
      name: `E2E reach ${suffix}`,
      slug: `e2e-reach-${suffix}`,
    });
    seededSites.push(siteId);
    await seedConfirmedBrief({
      accountId,
      siteId,
      businessName: BUSINESS_NAME,
      vertical: 'ristorazione',
      content: { ...innocuousBrief().content },
    });
    await seedReadyGeneration({ accountId, siteId, homePoolContent: innocuousHomePool() });

    // when: apro /generate. Con lo stato 'ready' la pagina MONTA il selettore (GenerationChooser):
    // il pulsante di scelta della prima variante c'e', cioe' il percorso e' davvero percorribile.
    await page.goto(`/it/generate/${siteId}`);
    const chooseFirst = page.locator('[data-choose-variant="0"]');
    await expect(chooseFirst).toBeVisible(); // covers: AC-241-5

    // Scegliere la variante invoca selectVariant (T-233): CONGELA la home e REINDIRIZZA all'anteprima
    // server-side — il client non torna dalla chiamata, si osserva la navigazione a /preview.
    await Promise.all([
      page.waitForURL(`**/it/preview/${siteId}`),
      chooseFirst.click(),
    ]);

    // then: la pagina finale E' l'anteprima del sito scelto e contiene il contenuto del documento
    // congelato — ALMENO il nome dell'attivita' (Hero, block.data.business_name) E una voce di offerta
    // (Offerte, block.data.offerings). Il deliverable e' raggiungibile dall'applicazione.
    expect(new URL(page.url()).pathname).toBe(`/it/preview/${siteId}`); // covers: AC-241-5
    await expect(page.locator('body')).toContainText(BUSINESS_NAME); // covers: AC-241-5
    await expect(page.locator('body')).toContainText(KNOWN_OFFERING); // covers: AC-241-5
  });
});
