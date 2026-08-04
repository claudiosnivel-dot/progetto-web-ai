import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import './env';
import { createTestUser, accountFor, captureSessionCookies } from './auth';
import { AUTH_DIR, STORAGE_STATE, USER_FILE, type TestUser } from './paths';

// T-240 (macrotask generation-e2e, P2) — GLOBAL SETUP di Playwright. Provisiona UN utente di test,
// cattura i suoi cookie di sessione nello storageState del browser e registra userId/accountId per
// il seeding degli spec e per il teardown. Gira UNA volta prima di tutti gli spec (al checkpoint),
// non nel giro per-task.

export default async function globalSetup(): Promise<void> {
  const email = `e2e_${randomUUID()}@example.test`;
  const password = 'Password123!';

  const user = await createTestUser(email, password);
  const accountId = await accountFor(user.id);
  const cookies = await captureSessionCookies(email, password);

  mkdirSync(AUTH_DIR, { recursive: true });
  // storageState nel formato di Playwright: i cookie di sessione, nessun origin localStorage.
  writeFileSync(STORAGE_STATE, JSON.stringify({ cookies, origins: [] }, null, 2));

  const record: TestUser = { userId: user.id, accountId, email, password };
  writeFileSync(USER_FILE, JSON.stringify(record, null, 2));
}
