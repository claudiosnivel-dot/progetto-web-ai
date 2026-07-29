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

// Valore CANONICO che Postgres memorizza in proconfig per
// `set search_path = public, pg_temp`: la lista GUC viene appiattita in `name=v1, v2`
// (verificato sul catalogo dell'istanza), quindi l'uguaglianza esatta e sensibile ai
// VALORI e al loro ORDINE, non alla formattazione scritta nella migrazione.
// L'ordine E la difesa: se pg_temp non e in coda (o non e elencato affatto, nel qual
// caso Postgres lo cerca PER PRIMO) lo schema temporaneo — scrivibile da chiunque —
// precede public nella risoluzione dei nomi dentro una funzione SECURITY DEFINER.
const SEARCH_PATH_PINNED = 'search_path=public, pg_temp';

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

    // RAFFORZATO — audit degli oracoli, rilievo S2-03 (HIGH): il VALORE ESATTO, non
    // la presenza della sottostringa 'public'. Mutazione MISURATA verde con il vecchio
    // toContain('public'): `set search_path = pg_temp, public` — lo schema temporaneo
    // DAVANTI, cioe esattamente la forma che il security_note della migrazione
    // (righe 9-11) dichiara di impedire — lasciava 21 test su 21 verdi. E il valore la
    // difesa, non la sua esistenza: `pg_temp, public` contiene 'public' quanto la forma
    // sicura. L'ordine e cio che conta, perche pg_temp e scrivibile da chiunque e la
    // funzione gira con i privilegi del proprietario.
    expect(searchPath).toBe(SEARCH_PATH_PINNED); // covers: AC-062-4
  });

  // OLTRE l'AC-062-4, che parla della sola impostazione search_path.
  //
  // Il test qui sopra usa `.find(...)`: e una claim ESISTENZIALE — cerca UNA voce e
  // ignora tutto il resto dell'array. Questa e la claim UNIVERSALE: proconfig e
  // ESATTAMENTE quella voce e nient'altro.
  //
  // MUTAZIONE CONCRETA che rende ROSSO questo test e lascia VERDE tutto il resto della
  // suite: pinnare una SECONDA GUC sulla funzione, p.es.
  //     alter function public.handle_new_user() set role = postgres;
  // oppure
  //     alter function public.handle_new_user() set row_security = off;
  // Il `find` continua a trovare la riga search_path buona e nessuna asserzione
  // esistente protesta, ma la funzione SECURITY DEFINER ha acquisito un'impostazione
  // di esecuzione che il contratto della migrazione non prevede.
  it('proconfig contiene SOLO il pin del search_path: nessun altra GUC e attaccata alla funzione', async () => {
    const rows = await pgQuery<ProcRow>(
      `select p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'handle_new_user'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].proconfig).toEqual([SEARCH_PATH_PINNED]);
  });
});
