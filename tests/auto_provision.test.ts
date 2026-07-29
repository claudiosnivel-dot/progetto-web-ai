import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestUser, deleteTestUser } from './helpers/supabase-test';
import { pgQuery } from './helpers/pg';

// T-062 — Auto-provision su signup. createTestUser inserisce l'utente in
// auth.users, il che FA SCATTARE il trigger AFTER INSERT public.handle_new_user()
// (attivo perche tutte le migrazioni sono applicate prima dei test). Si asserisce
// l'esito del provisioning sui cataloghi/dati via connessione Postgres diretta
// (pgQuery, DATABASE_URL) con query PARAMETRIZZATE ($1/$2), mai interpolate (A05:2025).
//
// Richiede sia Supabase locale (creazione utente reale) sia la connessione DB diretta
// (conteggi + simulazione di re-provision idempotente): describe gated su SB && DB.
// Un solo utente creato in beforeAll (rate limit auth), rimosso in afterAll.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const DB = !!process.env.DATABASE_URL;

// pg_get_functiondef restituisce prosrc VERBATIM, COMMENTI INCLUSI. Una ricerca
// testuale sul sorgente e quindi soddisfacibile da un COMMENTO: rilievo S2-05
// dell'audit degli oracoli — si puo togliere la clausola vera di idempotenza e
// lasciarne una commentata, e il grep resta verde. Si spoglia percio il sorgente dei
// commenti SQL (`-- ...` fino a fine riga e `/* ... */`) PRIMA di cercare qualunque
// cosa: una clausola commentata non soddisfa piu nessuna asserzione di questo file.
//
// LIMITE DICHIARATO: e un'euristica testuale, non un parser. Non distingue un `--`
// che comparisse dentro un letterale stringa; il corpo di handle_new_user non ne
// contiene, e nessuna asserzione qui sotto dipende da quel caso.
const stripSqlComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

// Forma normalizzata su cui lavorano TUTTE le asserzioni testuali sul corpo della
// funzione deployata: senza commenti, minuscola, spazi compressi.
const normalizedFunctionSource = (src: string): string =>
  stripSqlComments(src).toLowerCase().replace(/\s+/g, ' ');

describe.skipIf(!(SB && DB))('T-062 auto-provision su signup (trigger handle_new_user)', () => {
  const password = 'Password123!';
  const email = `t062_${randomUUID()}@example.test`;
  let userId = '';
  let accountId = '';

  beforeAll(async () => {
    // Creazione dell'utente -> insert in auth.users -> trigger AFTER INSERT ->
    // auto-provision di account + membership owner + profilo.
    const u = await createTestUser(email, password);
    userId = u.id;

    const acc = await pgQuery<{ id: string }>(
      'select id from public.accounts where owner_id = $1',
      [userId],
    );
    accountId = acc[0]?.id ?? '';
  });

  afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  // covers: AC-062-1
  it('crea esattamente 1 account con owner_id = nuovo utente', async () => {
    const rows = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.accounts where owner_id = $1',
      [userId],
    );
    expect(rows[0].n).toBe(1); // covers: AC-062-1
    expect(accountId).not.toBe(''); // covers: AC-062-1 — l'account e stato effettivamente creato
  });

  // covers: AC-062-2
  it("crea esattamente 1 membership owner (account dell'utente, user_id=utente, role='owner')", async () => {
    // Esattamente 1 riga (account creato per U, U, 'owner').
    const owned = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.account_members where account_id = $1 and user_id = $2 and role = 'owner'",
      [accountId, userId],
    );
    expect(owned[0].n).toBe(1); // covers: AC-062-2

    // Nessun'altra membership per l'utente: il provisioning crea SOLO l'owner.
    const total = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.account_members where user_id = $1',
      [userId],
    );
    expect(total[0].n).toBe(1); // covers: AC-062-2
  });

  // covers: AC-062-3
  it("crea esattamente 1 profilo con id = utente e locale = 'it'", async () => {
    const localed = await pgQuery<{ n: number }>(
      "select count(*)::int as n from public.profiles where id = $1 and locale = 'it'",
      [userId],
    );
    expect(localed[0].n).toBe(1); // covers: AC-062-3

    // Esattamente un profilo per l'utente (nessun duplicato).
    const total = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.profiles where id = $1',
      [userId],
    );
    expect(total[0].n).toBe(1); // covers: AC-062-3
  });

  // covers: AC-062-5
  it('handle_new_user() garantisce l idempotenza per costruzione (guardie nel corpo della funzione + PK reali)', async () => {
    // Un trigger AFTER INSERT non e ri-eseguibile dai test (ri-inserire la stessa riga
    // auth.users viola il PK; una nuova insert crea un id diverso = altro utente; una
    // trigger function non e invocabile fuori dal contesto di trigger). Perche il verde
    // provi l'idempotenza della FUNZIONE DEPLOYATA — e non di copie inline degli statement
    // (self-fulfilling) — si vincola l'asserzione al corpo reale della funzione e alla
    // realta dei vincoli PK bersaglio degli ON CONFLICT.

    // (a) Il corpo della funzione deployata contiene le guardie di idempotenza: una
    //     regressione che rimuovesse ON CONFLICT o la guardia su owner_id verrebbe colta qui.
    const def = await pgQuery<{ src: string }>(
      "select pg_get_functiondef('public.handle_new_user()'::regprocedure) as src",
    );
    //     RAFFORZATO — audit degli oracoli, rilievo S2-05: il sorgente viene spogliato
    //     dei COMMENTI prima della ricerca. Mutazione misurata verde prima: togliere la
    //     clausola vera e lasciarne una commentata (`-- on conflict (id) do nothing;`)
    //     soddisfaceva questi toContain, perche pg_get_functiondef restituisce prosrc
    //     verbatim. Ora una clausola commentata non soddisfa piu nulla.
    //     LIMITE RESIDUO, DICHIARATO E NON CHIUSO (lato (a) del rilievo S2-05): questi
    //     tre toContain restano RIGIDI. Una riscrittura equivalente e legittima —
    //     `on conflict on constraint profiles_pkey do nothing`, o un blocco
    //     `exception when unique_violation then null` — li farebbe diventare ROSSI pur
    //     essendo idempotente. Non e stato trovato un modo onesto di renderli tolleranti
    //     senza indebolire cio che oggi pinnano (il bersaglio ESATTO dell'ON CONFLICT),
    //     quindi il compromesso resta scritto invece che nascosto. Il test strutturale
    //     nel describe successivo esprime la stessa proprieta in forma TOLLERANTE alla
    //     riscrittura, ed e li che va guardata la robustezza al refactoring.
    const src = normalizedFunctionSource(def[0].src);
    expect(src).toContain('on conflict (account_id, user_id) do nothing'); // covers: AC-062-5 — membership idempotente
    expect(src).toContain('on conflict (id) do nothing'); // covers: AC-062-5 — profilo idempotente
    expect(src).toContain('owner_id = new.id'); // covers: AC-062-5 — guardia accounts (PK random, nessun UNIQUE su owner_id)

    // (b) I bersagli degli ON CONFLICT sono PK REALI: un insert NON guardato che duplica
    //     la membership owner e il profilo dell'utente gia provisionato DEVE sollevare una
    //     unique_violation (23505). Prova che gli ON CONFLICT sopra non sono no-op silenziosi.
    //     (pgQuery e autocommit: nel caso di regressione del PK, la cascade su deleteTestUser
    //     in afterAll ripulisce comunque le righe.)
    await expect(
      pgQuery(
        "insert into public.account_members (account_id, user_id, role) values ($1::uuid, $2::uuid, 'owner')",
        [accountId, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — PK composita (account_id,user_id) reale
    await expect(
      pgQuery(
        "insert into public.profiles (id, locale) values ($1::uuid, 'it')",
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — PK (id) reale

    // (c) Conteggi invariati: esattamente 1 riga each, nessun duplicato introdotto.
    const accounts = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.accounts where owner_id = $1',
      [userId],
    );
    const members = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.account_members where user_id = $1',
      [userId],
    );
    const profiles = await pgQuery<{ n: number }>(
      'select count(*)::int as n from public.profiles where id = $1',
      [userId],
    );
    expect(accounts[0].n).toBe(1); // covers: AC-062-5 — nessun account duplicato
    expect(members[0].n).toBe(1); // covers: AC-062-5 — nessuna membership duplicata
    expect(profiles[0].n).toBe(1); // covers: AC-062-5 — nessun profilo duplicato
  });

  // covers: AC-062-5
  it('idempotenza garantita dallo schema: un 2o account per lo stesso owner e rifiutato (UNIQUE, 23505)', async () => {
    // Emendamento ledger 2026-07-23: UNIQUE(owner_id) su accounts. Rende l'idempotenza
    // dell'auto-provision provabile PER COSTRUZIONE (non solo per la guardia applicativa
    // nella funzione): un secondo account per l'owner gia provisionato in beforeAll e
    // rifiutato dal DB con unique_violation, quindi un re-provision non puo duplicare.
    await expect(
      pgQuery('insert into public.accounts (owner_id) values ($1::uuid)', [userId]),
    ).rejects.toMatchObject({ code: '23505' }); // covers: AC-062-5 — vincolo UNIQUE(owner_id) enforced
  });
});

// ── Idempotenza come PROPRIETA STRUTTURALE del corpo deployato ────────────────
//
// Gated sul solo DB: queste asserzioni non creano utenti, quindi non consumano il
// rate limit auth e girano anche senza le chiavi Supabase.
describe.skipIf(!DB)('T-062 idempotenza — struttura del corpo di handle_new_user (catalogo)', () => {
  const loadSource = async (): Promise<string> => {
    const def = await pgQuery<{ src: string }>(
      "select pg_get_functiondef('public.handle_new_user()'::regprocedure) as src",
    );
    return normalizedFunctionSource(def[0].src);
  };

  // Clausola di idempotenza, in forma TOLLERANTE alla riscrittura: accetta sia
  // `on conflict (cols) do nothing` sia `on conflict on constraint <nome> do nothing`
  // sia `on conflict do nothing`. E la riscrittura equivalente che il rilievo S2-05
  // nomina come contro-esempio alla rigidita del grep.
  const ON_CONFLICT_DO_NOTHING = /on conflict\b[^;]*\bdo nothing\b/;

  // covers: AC-062-5 (in forma UNIVERSALE, oltre l'AC)
  //
  // Il test esistente ("garantisce l idempotenza per costruzione") fa una claim
  // ESISTENZIALE: la clausola compare DA QUALCHE PARTE nel corpo. Questa e la claim
  // UNIVERSALE: NESSUN insert di provisioning e incondizionato.
  //
  // MUTAZIONE CONCRETA che rende ROSSO questo test ed e oggi INVISIBILE a tutta la
  // suite: togliere la guardia condizionale attorno all'insert su accounts, cioe
  // cancellare le righe `if v_account_id is null then` / `end if` e lasciare
  //     insert into public.accounts (owner_id) values (new.id) returning id into v_account_id;
  // Al primo signup v_account_id e comunque null, quindi TUTTI i test a runtime
  // restano verdi; e l'asserzione testuale esistente `expect(src).toContain('owner_id
  // = new.id')` resta verde anche lei, perche quella stringa sta nella SELECT di
  // lookup, che la mutazione non tocca. Eppure e proprio quel `if` l'idempotenza del
  // ramo accounts: senza, un ri-provisioning dello stesso utente solleva 23505
  // (c'e UNIQUE(owner_id)) invece di riusare l'account.
  //
  // Altre due mutazioni che diventano ROSSE qui: togliere `on conflict ... do nothing`
  // da uno dei due insert PK-deterministici (anche lasciandone una copia COMMENTATA,
  // grazie allo spoglia-commenti), e sostituirlo con `do update set ...` (che
  // idempotente non e: riscrive la riga esistente).
  //
  // A differenza dei tre toContain del test esistente, questo NON e rigido: accetta
  // la riscrittura `on conflict on constraint <pkey> do nothing` e accetta che la
  // guardia sia espressa come `if ... then` oppure come `where not exists`.
  it('nessun insert di provisioning e INCONDIZIONATO: ogni insert su accounts/account_members/profiles porta una clausola ON CONFLICT DO NOTHING o e racchiuso in una guardia', async () => {
    const src = await loadSource();

    // Statement del corpo, separate dal ';'. Euristica sufficiente per questo corpo
    // (nessun ';' dentro i letterali), dichiarata come tale.
    const stmts = src.split(';');

    for (const table of ['accounts', 'account_members', 'profiles'] as const) {
      const insertRe = new RegExp(`insert\\s+into\\s+(?:public\\.)?${table}\\b`);
      const inserts = stmts.filter((s) => insertRe.test(s));

      // Anti-vacuita: il provisioning DEVE scrivere su tutte e tre le tabelle. Senza
      // questa riga il ciclo sarebbe verde su un corpo che non inserisce piu nulla.
      expect(inserts.length).toBeGreaterThanOrEqual(1); // covers: AC-062-1, AC-062-2, AC-062-3

      for (const stmt of inserts) {
        // Guardia condizionale: qualcosa che apre un ramo `if ... then` PRIMA
        // dell'insert nella stessa statement, oppure un `where not exists`.
        const head = stmt.slice(0, stmt.search(insertRe));
        const conditional =
          /\bif\b[\s\S]*\bthen\b/.test(head) || /\bwhere\s+not\s+exists\b/.test(stmt);
        const onConflict = ON_CONFLICT_DO_NOTHING.test(stmt);
        expect(onConflict || conditional).toBe(true); // covers: AC-062-5
      }
    }

    // Il ramo accounts e proprio quello guardato dall'`if`: lo si nomina, cosi il
    // fallimento dice QUALE ramo ha perso la guardia invece di un booleano anonimo.
    const accountsInsert = stmts.find((s) => /insert\s+into\s+(?:public\.)?accounts\b/.test(s));
    expect(accountsInsert).toBeDefined();
    expect(
      /\bif\b[\s\S]*\bthen\b/.test(
        accountsInsert!.slice(0, accountsInsert!.search(/insert\s+into\s+(?:public\.)?accounts\b/)),
      ) || ON_CONFLICT_DO_NOTHING.test(accountsInsert!),
    ).toBe(true); // covers: AC-062-5
    // ...e il ramo condizionale si CHIUDE: un `if` senza `end if` non compilerebbe,
    // ma l'asserzione rende esplicito che l'insert vive dentro un blocco.
    expect(src).toContain('end if');
  });
});

// ── Lo STRUMENTO su cui poggiano le asserzioni testuali qui sopra ─────────────
//
// Non richiede ne DB ne Supabase: gira sempre, anche in CI senza database. E il
// contrappeso al rilievo S2-05: la difesa aggiunta e lo spoglia-commenti, e una
// difesa senza oracolo e esattamente il problema che l'audit ha misurato.
describe('T-062 — spoglia-commenti del sorgente SQL (rimedio al rilievo S2-05)', () => {
  // MUTAZIONE che rende ROSSO questo test: neutralizzare stripSqlComments — renderlo
  // l'identita, o togliere una delle due regex. Senza questo test lo stripper potrebbe
  // tornare un no-op e le ricerche testuali sul corpo tornerebbero soddisfacibili da un
  // commento, con tutte le asserzioni ancora verdi.
  it('una clausola di idempotenza COMMENTATA non sopravvive allo stripping, quella nel codice si', () => {
    // La forma esatta della mutazione descritta nel rilievo S2-05: clausola vera
    // rimossa, copia lasciata in un commento di riga.
    const commentata = [
      "insert into public.profiles (id, locale) values (new.id, 'it');",
      '-- on conflict (id) do nothing;',
    ].join('\n');
    expect(stripSqlComments(commentata)).not.toContain('on conflict');

    // Stessa mutazione in commento di blocco.
    const blocco = "insert into public.profiles values (1) /* on conflict (id) do nothing */;";
    expect(stripSqlComments(blocco)).not.toContain('on conflict');

    // Il codice VERO non viene toccato: lo stripper non deve indebolire le asserzioni
    // rendendo irriconoscibile una clausola legittima.
    const vera =
      "insert into public.profiles (id, locale) values (new.id, 'it') on conflict (id) do nothing;";
    expect(stripSqlComments(vera)).toContain('on conflict (id) do nothing');

    // Il commento non deve inghiottire la riga successiva: `--` si ferma a fine riga.
    const dueRighe = ['-- commento', "insert into public.accounts (owner_id) values (new.id);"].join(
      '\n',
    );
    expect(stripSqlComments(dueRighe)).toContain('insert into public.accounts');
  });
});
