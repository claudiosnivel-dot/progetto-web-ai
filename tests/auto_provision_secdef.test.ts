import { describe, it, expect } from 'vitest';
import { pgQuery } from './helpers/pg';

// T-062 — AC-062-4: la funzione public.handle_new_user() deve essere dichiarata
// SECURITY DEFINER (prosecdef = true) e avere un search_path esplicito impostato
// sulla funzione (presente in proconfig), a prova di hijack del search_path /
// privilege escalation (R8). Asserzioni sul catalogo di sistema pg_proc via
// connessione Postgres diretta (PostgREST non lo espone). Gira solo con DATABASE_URL.

const DB = !!process.env.DATABASE_URL;

type ProcRow = {
  prosecdef: boolean;
  proconfig: string[] | null;
};

describe.skipIf(!DB)('T-062 handle_new_user SECURITY DEFINER + search_path (catalogo)', () => {
  // covers: AC-062-4
  it('e SECURITY DEFINER (prosecdef=true) con un search_path esplicito in proconfig', async () => {
    const rows = await pgQuery<ProcRow>(
      `select p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_new_user'`,
    );

    // Esattamente una funzione public.handle_new_user.
    expect(rows).toHaveLength(1); // covers: AC-062-4

    // SECURITY DEFINER.
    expect(rows[0].prosecdef).toBe(true); // covers: AC-062-4

    // proconfig contiene un'impostazione search_path esplicita sulla funzione.
    const config = rows[0].proconfig ?? [];
    const searchPath = config.find((c) => c.toLowerCase().startsWith('search_path='));
    expect(searchPath).toBeDefined(); // covers: AC-062-4

    // Il search_path fisso include public (pin esplicito, previene hijack — R8).
    expect(searchPath).toContain('public'); // covers: AC-062-4
  });
});
