import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-304 (macrotask editor-core, P3) — READ-PATH "ultima revisione ELSE baseline" di
// `readGenerationDocument`, RUNTIME contro il Supabase locale. Le asserzioni derivano dagli
// acceptance_criteria AC-304-1..4 (01-editor-core.md).
//
// DB-BACKED per necessita': la selezione del documento corrente vive nella RLS e nell'ordinamento
// per seq della tabella site_document_revisions (T-301). Come save-revision.test.ts (T-302) e
// generation-document-provenance.test.ts (T-235) si mocka SOLO la costruzione del client SSR
// (createServerSupabaseClient) con un client ad AUTH REALE (signInAs -> JWT, ruolo authenticated,
// RLS ATTIVA); la scelta della generazione corrente, la lettura della revisione con seq massimo e
// la RLS girano per intero contro il DB. La service_role compare SOLO nel setup delle fixture e
// come ORACOLO INDIPENDENTE (adminClient), MAI dentro la funzione letta — un valore restituito che
// fosse l'oracolo di se stesso sarebbe un falso verde.
//
// DISCIPLINA FIXTURE (lezione P1/P2): piu' di un elemento, valori DISCORDANTI, e un id che e'
// PREFISSO di un altro. Qui il prefisso che MORDE la logica e' il `seq`: seq 1 e' prefisso di
// seq 10 come STRINGA, ma 10 > 1 come NUMERO — e la revisione con seq 10 porta il created_at PIU'
// VECCHIO. Cosi' "seq massimo" si distingue da "seq lessicografico", da "created_at massimo" e da
// "ultima inserita": un ordinamento sbagliato torna il documento sbagliato e il test diventa rosso.
// (Gli slug hanno anch'essi relazione di prefisso — 'read' e' prefisso di 'read-multi' ecc. — ma il
// filtro e' su site_id, non sullo slug; il prefisso load-bearing e' quello sui seq.)

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { readGenerationDocument } from '@/data/generation-document';

// ── documenti fixture DISCORDANTI ─────────────────────────────────────────────────────────────
// La colonna `document` e' jsonb OPACO per il read-path (torna `unknown`, il gate parseDocument
// gira nel consumatore): basta che i documenti siano JSON validi e DISTINTI. Ogni documento porta
// un `tag` diverso, cosi' "ha letto la riga giusta" si distingue da "ha letto una riga".
function doc(tag: string) {
  return {
    recipe_id: 'aurora-lineare@3',
    theme_id: 'terracotta-chiara@7',
    tag,
    pages: [{ slug: 'home', role: 'home', title: `Home — ${tag}`, blocks: [] }],
  };
}

const ORA_MS = 60 * 60 * 1000;
const TEMPO = (etaMs: number) => new Date(Date.now() - etaMs).toISOString();

type RevSource = 'generated' | 'edited' | 'rechosen';

describe.skipIf(!SB)('T-304 readGenerationDocument — ultima revisione else baseline (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t304a_${randomUUID()}@example.test`;
  const emailB = `t304b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;

  // Siti di A. Gli slug hanno DELIBERATAMENTE relazione di prefisso ('read' prefisso di
  // 'read-multi', 'read-tie', 'read-iso').
  let siteBaseline = ''; // read           — generazione congelata, ZERO revisioni  (AC-304-1)
  let genBaseline = '';
  let siteMulti = ''; // read-multi        — piu' revisioni, seq 1/2/10 discordanti (AC-304-2)
  let genMulti = '';
  let siteTie = ''; // read-tie            — due revisioni, created_at IDENTICO       (AC-304-3)
  let genTie = '';
  let siteIso = ''; // read-iso            — di A, con revisione; letto da B          (AC-304-4)
  let genIso = '';
  let siteVirgin = ''; // read-vergine     — nessuna generazione: contratto T-235 (null) preservato
  let siteB = ''; // di B, con revisione propria — prova che il client di B funziona (AC-304-4)
  let genB = '';

  async function creaGenerazione(
    accountId: string,
    slug: string,
    document: unknown,
  ): Promise<{ siteId: string; genId: string }> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteId = site.id as string;
    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountId,
        site_id: siteId,
        status: 'chosen',
        max_pages: 8,
        chosen_variant: 0,
        // document not null: e' cio' che rende questa la generazione CONGELATA corrente.
        document,
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    return { siteId, genId: gen.id as string };
  }

  async function insRev(opts: {
    accountId: string;
    genId: string;
    seq: number;
    source: RevSource;
    document: unknown;
    etaMs?: number;
    createdAt?: string;
  }): Promise<void> {
    const row: Record<string, unknown> = {
      account_id: opts.accountId,
      site_generation_id: opts.genId,
      source: opts.source,
      seq: opts.seq,
      document: opts.document,
    };
    // created_at esplicito SOLO dove serve pilotare la relazione seq<->tempo (AC-304-2/3). Per la
    // parita' ESATTA di created_at (AC-304-3) si passa una stringa gia' calcolata (createdAt), cosi'
    // le due righe condividono lo STESSO timestamp al byte (TEMPO() ricalcolato divergerebbe di ms).
    if (opts.createdAt !== undefined) row.created_at = opts.createdAt;
    else if (opts.etaMs !== undefined) row.created_at = TEMPO(opts.etaMs);
    const { error } = await adminClient().from('site_document_revisions').insert(row);
    if (error) throw error;
  }

  /** Le revisioni di una generazione, RILETTE con la service_role (RLS bypassata): l'oracolo. */
  async function revisionsOf(genId: string): Promise<{ seq: number; document: unknown }[]> {
    const { data, error } = await adminClient()
      .from('site_document_revisions')
      .select('seq, document')
      .eq('site_generation_id', genId)
      .order('seq', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      seq: Number((r as { seq: number | string }).seq),
      document: (r as { document: unknown }).document,
    }));
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA } = await admin.from('accounts').select('id').eq('owner_id', userAId).single();
    const { data: accB } = await admin.from('accounts').select('id').eq('owner_id', userBId).single();
    accountAId = accA!.id as string;
    accountBId = accB!.id as string;

    // AC-304-1: generazione congelata, ZERO revisioni -> torna la baseline.
    ({ siteId: siteBaseline, genId: genBaseline } = await creaGenerazione(
      accountAId,
      'read',
      doc('baseline-only'),
    ));

    // AC-304-2: piu' revisioni con seq DISCORDANTI (1, 2, 10) e documenti distinti. Il seq MASSIMO
    // (10) e' inserito col created_at PIU' VECCHIO, i seq minori (1, 2) coi piu' recenti: cosi' se
    // il read ordinasse per created_at (o per string, "10" < "2") tornerebbe il documento SBAGLIATO.
    ({ siteId: siteMulti, genId: genMulti } = await creaGenerazione(
      accountAId,
      'read-multi',
      doc('multi-baseline'),
    ));
    await insRev({ accountId: accountAId, genId: genMulti, seq: 10, source: 'generated', document: doc('multi-seq-10'), etaMs: 3 * ORA_MS });
    await insRev({ accountId: accountAId, genId: genMulti, seq: 1, source: 'edited', document: doc('multi-seq-1'), etaMs: 2 * ORA_MS });
    await insRev({ accountId: accountAId, genId: genMulti, seq: 2, source: 'rechosen', document: doc('multi-seq-2'), etaMs: 1 * ORA_MS });

    // AC-304-3: due revisioni con created_at IDENTICO e seq diverso (3, 7) -> vince seq 7.
    ({ siteId: siteTie, genId: genTie } = await creaGenerazione(
      accountAId,
      'read-tie',
      doc('tie-baseline'),
    ));
    // UN SOLO timestamp, riusato al byte da entrambe le righe: e' la premessa esatta di AC-304-3.
    const TIE_TS = TEMPO(5 * ORA_MS);
    await insRev({ accountId: accountAId, genId: genTie, seq: 3, source: 'edited', document: doc('tie-seq-3'), createdAt: TIE_TS });
    await insRev({ accountId: accountAId, genId: genTie, seq: 7, source: 'edited', document: doc('tie-seq-7'), createdAt: TIE_TS });

    // AC-304-4: sito di A con una revisione; sara' letto da B (deve tornare null, non la revisione).
    ({ siteId: siteIso, genId: genIso } = await creaGenerazione(
      accountAId,
      'read-iso',
      doc('iso-baseline'),
    ));
    await insRev({ accountId: accountAId, genId: genIso, seq: 5, source: 'edited', document: doc('iso-seq-5') });

    // Contratto T-235 preservato: un sito mai generato torna document null.
    const { data: siteV, error: siteVErr } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'read-vergine', slug: `read-vergine-${suffisso}` })
      .select('id')
      .single();
    if (siteVErr) throw siteVErr;
    siteVirgin = siteV.id as string;

    // Sito di B con revisione PROPRIA: il null di B su siteIso e' ISOLAMENTO, non un client rotto.
    ({ siteId: siteB, genId: genB } = await creaGenerazione(
      accountBId,
      'read-di-b',
      doc('b-baseline'),
    ));
    await insRev({ accountId: accountBId, genId: genB, seq: 4, source: 'edited', document: doc('b-seq-4') });

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }, 60_000);

  afterAll(async () => {
    // cascade: auth.users -> accounts -> sites -> site_generations -> site_document_revisions
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-304-1
  it('un sito con generazione congelata ma ZERO revisioni: torna la baseline site_generations.document', async () => {
    clientHolder.current = clientA;

    // Premessa onesta (oracolo): davvero nessuna revisione su questa generazione.
    expect(await revisionsOf(genBaseline)).toHaveLength(0); // covers: AC-304-1

    const res = await readGenerationDocument(siteBaseline);
    expect(res.ok).toBe(true); // covers: AC-304-1
    if (!res.ok) throw new Error('readGenerationDocument (baseline) fallita');
    // Torna ESATTAMENTE la baseline congelata, non null: comportamento pre-editing invariato.
    expect(res.document).toEqual(doc('baseline-only')); // covers: AC-304-1
  });

  // covers: AC-304-2
  it('con piu revisioni (seq crescenti, documenti discordanti, created_at che NON segue il seq): torna il seq MASSIMO', async () => {
    clientHolder.current = clientA;

    // Premessa (oracolo): tre revisioni, seq 1/2/10, documenti distinti.
    const revs = await revisionsOf(genMulti);
    expect(revs.map((r) => r.seq)).toEqual([1, 2, 10]); // covers: AC-304-2

    const res = await readGenerationDocument(siteMulti);
    expect(res.ok).toBe(true); // covers: AC-304-2
    if (!res.ok) throw new Error('readGenerationDocument (multi) fallita');
    // Vince il seq MASSIMO (10), il cui created_at e' il PIU' VECCHIO e la cui stringa "10" e' la
    // piu' piccola lessicograficamente: se il read ordinasse per created_at o per stringa fallirebbe.
    expect(res.document).toEqual(doc('multi-seq-10')); // covers: AC-304-2
    // Discriminatori espliciti: NON la baseline, NON un seq minore, NON la piu' RECENTE per tempo.
    expect(res.document).not.toEqual(doc('multi-baseline')); // covers: AC-304-2 — non la baseline
    expect(res.document).not.toEqual(doc('multi-seq-2')); // covers: AC-304-2 — non il created_at massimo
    expect(res.document).not.toEqual(doc('multi-seq-1')); // covers: AC-304-2
  });

  // covers: AC-304-3
  it('due revisioni con created_at IDENTICO e seq diverso: vince il seq maggiore (deterministico per seq)', async () => {
    clientHolder.current = clientA;

    const res = await readGenerationDocument(siteTie);
    expect(res.ok).toBe(true); // covers: AC-304-3
    if (!res.ok) throw new Error('readGenerationDocument (tie) fallita');
    // A parita' esatta di created_at, l'ordinamento su seq rende la scelta deterministica: seq 7 > 3.
    expect(res.document).toEqual(doc('tie-seq-7')); // covers: AC-304-3
    expect(res.document).not.toEqual(doc('tie-seq-3')); // covers: AC-304-3
  });

  // covers: AC-304-4
  it('un sito di un altro tenant: mai una sua revisione ne la sua baseline (RLS filtra a null)', async () => {
    // B legge il sito di A: la generazione di A filtra a insieme vuoto sotto la RLS di B, quindi il
    // read si ferma al passo 1 e torna null — mai la revisione di A ('iso-seq-5') ne la sua baseline.
    clientHolder.current = clientB;
    const cross = await readGenerationDocument(siteIso);
    expect(cross.ok).toBe(true); // covers: AC-304-4 — insieme vuoto, mai un errore
    if (!cross.ok) throw new Error('readGenerationDocument (cross-tenant) fallita');
    expect(cross.document).toBeNull(); // covers: AC-304-4

    // Il null qui sopra e' ISOLAMENTO, non un client rotto: B legge la PROPRIA revisione sul PROPRIO
    // sito senza problemi.
    const propria = await readGenerationDocument(siteB);
    expect(propria.ok).toBe(true); // covers: AC-304-4
    if (!propria.ok) throw new Error('readGenerationDocument (B sul proprio sito) fallita');
    expect(propria.document).toEqual(doc('b-seq-4')); // covers: AC-304-4 — la sua ultima revisione

    // E A, sullo STESSO siteIso, vede invece la propria revisione: la fixture di A non e' vuota, il
    // null di B e' isolamento e non assenza di dato.
    clientHolder.current = clientA;
    const dellA = await readGenerationDocument(siteIso);
    expect(dellA.ok).toBe(true); // covers: AC-304-4
    if (!dellA.ok) throw new Error('readGenerationDocument (A sul proprio siteIso) fallita');
    expect(dellA.document).toEqual(doc('iso-seq-5')); // covers: AC-304-4
  });

  // Contratto T-235 preservato (DoD: comportamento pre-editing invariato): un sito mai generato
  // torna document null, non un errore — la baseline non esiste e il read-path lo dice senza rompere.
  it('un sito mai generato torna document null (contratto pre-editing preservato)', async () => {
    clientHolder.current = clientA;
    const res = await readGenerationDocument(siteVirgin);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('readGenerationDocument (vergine) fallita');
    expect(res.document).toBeNull();
  });

  // Robustezza (A01/anti-enumerazione): senza sessione la lettura fallisce con 401, mai un documento.
  it('senza sessione: 401 e nessun documento', async () => {
    clientHolder.current = anon;
    const res = await readGenerationDocument(siteMulti);
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('readGenerationDocument senza sessione non doveva riuscire');
    expect(res.status).toBe(401);
  });
});
