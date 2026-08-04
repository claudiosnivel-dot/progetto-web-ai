import { defineConfig } from '@playwright/test';
import { STORAGE_STATE } from './e2e/support/paths';

// T-240 (macrotask generation-e2e, P2) — IL RUNNER end-to-end. Un SOLO progetto Chromium
// (AC-240-5), avvio dell'applicazione via webServer, autenticazione dell'utente di test nel
// globalSetup e sessione del browser via storageState. L'end-to-end gira al CHECKPOINT di
// macrotask (non nel giro per-task): la suite unitaria (vitest) raccoglie SOLO tests/**/*.test.ts,
// quindi gli spec e2e (e2e/**/*.spec.ts) restano disgiunti (AC-240-4). Costo dichiarato: una dep
// di sviluppo, un binario di browser e una classe di flakiness che il progetto non aveva.

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    // 127.0.0.1 (NON localhost): e' il site_url dell'auth locale. Su http, i cookie di sessione
    // catturati dal globalSetup non sono `secure`, altrimenti non verrebbero mai inviati.
    baseURL: 'http://127.0.0.1:3000',
    storageState: STORAGE_STATE,
    trace: 'off',
  },
  // UN SOLO browser: Chromium (AC-240-5). Nessun altro motore e' previsto.
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // Assume un build precedente: l'orchestratore lancia `npm run build` prima del checkpoint.
    command: 'npm run start',
    url: 'http://127.0.0.1:3000/it',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
