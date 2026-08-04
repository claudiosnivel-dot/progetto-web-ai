import { resolve } from 'node:path';

// T-240 (macrotask generation-e2e, P2) — le SEDI degli artefatti di sessione dell'end-to-end,
// dichiarate UNA volta e condivise da globalSetup (che le scrive), globalTeardown (che ripulisce)
// e dagli spec (che leggono l'account per il seeding). Anchor su process.cwd() — Playwright e il
// webServer girano dalla radice del repo — invece di import.meta.url: il loader di Playwright tratta
// questi file come CommonJS e import.meta non e' disponibile li'. La cartella .auth NON e' versionata
// (.gitignore): porta i token dell'utente di test.

const AUTH_DIR = resolve(process.cwd(), 'e2e', '.auth');

export { AUTH_DIR };
export const STORAGE_STATE = resolve(AUTH_DIR, 'state.json');
export const USER_FILE = resolve(AUTH_DIR, 'user.json');

/** L'utente di test provisionato dal globalSetup, con l'account auto-creato dal trigger. */
export type TestUser = {
  readonly userId: string;
  readonly accountId: string;
  readonly email: string;
  readonly password: string;
};
