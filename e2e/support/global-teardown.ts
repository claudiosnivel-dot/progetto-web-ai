import { existsSync, readFileSync } from 'node:fs';
import './env';
import { deleteTestUser } from './auth';
import { USER_FILE, type TestUser } from './paths';

// T-240 (macrotask generation-e2e, P2) — GLOBAL TEARDOWN di Playwright. Cancella l'utente di test
// provisionato dal globalSetup: la cancellazione CASCADE fino ad account -> sites ->
// site_generations -> generation_pools, quindi rimuove anche tutto cio' che gli spec hanno seminato.

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(USER_FILE)) return;
  const user = JSON.parse(readFileSync(USER_FILE, 'utf8')) as TestUser;
  if (user.userId) await deleteTestUser(user.userId);
}
