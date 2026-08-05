import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-303 (macrotask editor-core, P3) — CAP e POTATURA FIFO delle revisioni (max 20 per
// generazione), RUNTIME contro il Supabase locale. Le asserzioni derivano dagli
// acceptance_criteria AC-303-1..3 (01-editor-core.md) e dal security_note (potatura sotto RLS:
// nessuna riga di un altro tenant e mai eliminata).
//
// DB-BACKED per necessita': la potatura elimina SOTTO RLS con la sessione reale (policy DELETE di
// T-301 ancorata a is_account_member). Come T-302 (save-revision) mockiamo SOLO la costruzione del
// client SSR con un client ad AUTH REALE (signInAs -> JWT, RLS ATTIVA); il gate, la derivazione di
// account_id, la scrittura e la POTATURA girano per intero contro il DB. La service_role compare
// SOLO come ORACOLO INDIPENDENTE (adminClient) e nel setup, MAI dentro l'azione: un conteggio
// soddisfatto da una potatura che girasse con service_role sarebbe un falso verde (bypasserebbe la
// RLS che qui e proprio l'oggetto della prova); le righe RILETTE con service_role no.
//
// DISCIPLINA FIXTURE (lezione P1/P2): >1 elemento, valori DISCORDANTI, un id PREFISSO di un altro.
// I site_generation_id sono UUID emessi da gen_random_uuid() — lunghezza fissa 36, un UUID non puo
// essere PREFISSO proprio di un altro — quindi la trappola-prefisso e portata dai campi
// CONTROLLABILI (stessa sostituzione onesta di T-301 con gli slug):
//   - slug 'shop' PREFISSO di 'shop-two' (due generazioni dello STESSO tenant A);
//   - seq 1 PREFISSO-di-stringa di 10 (revisioni della stessa generazione);
//   - marker 'big-1' PREFISSO di 'big-10' nel document.
// Conteggi DISCORDANTI fra le generazioni: 20 (genBig, che sfora e viene potato), 3 (genSmall,
// sotto il cap), 4 (genB, di un ALTRO tenant).

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.DATABASE_URL
);

const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

import { saveRevision } from '@/data/site-document-revisions';

// ── fixture del documento (forma di parseDocument, T-202; identica a save-revision.test.ts) ────
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

/** Una home BEN FORMATA: brief_fields_rendered gia coincidente con le chiavi di `data`. */
function documentoValido(firma: string) {
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: `Bottega Aurora — ${firma}`,
        meta_description: `Pane a lievitazione naturale, ${firma}.`,
        blocks: [
          {
            id: 'hero',
            content: {
              hero_title: `Il pane di via Roma (${firma})`,
              hero_subtitle: `Sfornato tre volte al giorno. ${firma}`,
            },
            data: { business_name: `Bottega Aurora ${firma}` },
            brief_fields_rendered: ['business_name'],
            images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
          },
        ],
      },
    ],
  };
}

const CAP = 20; // P3-D2: tetto di revisioni conservate per generazione (potatura FIFO oltre 20).

type RevisionRow = {
  id: string;
  account_id: string;
  source: string;
  seq: number | string;
  document: unknown;
};

/** Le revisioni di una generazione, RILETTE con la service_role (RLS bypassata): l'oracolo. */
async function revisionsOf(genId: string): Promise<RevisionRow[]> {
  const { data, error } = await adminClient()
    .from('site_document_revisions')
    .select('id, account_id, source, seq, document')
    .eq('site_generation_id', genId)
    .order('seq', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RevisionRow[];
}

describe.skipIf(!SB)(
  'T-303 potatura FIFO delle revisioni — cap 20 per generazione, sotto RLS, baseline intatta (runtime, Supabase locale)',
  () => {
    const password = 'Password123!';
    const suffisso = randomUUID().slice(0, 8);
    const emailA = `t303a_${randomUUID()}@example.test`;
    const emailB = `t303b_${randomUUID()}@example.test`;
    let userAId = '';
    let userBId = '';
    let accountAId = '';
    let accountBId = '';
    let clientA: SupabaseClient;

    // genBig (A, slug 'shop'): 20 revisioni pre-seminate → riceve la 21ª via saveRevision e viene potato.
    // genSmall (A, slug 'shop-two', PREFISSO-trap): 3 revisioni, sotto il cap → deve restare intatto.
    // genB (B, slug 'shop', ALTRO tenant): 4 revisioni → la potatura di A non deve MAI toccarle (RLS).
    let siteBig = '';
    let genBig = '';
    let genSmall = '';
    let genB = '';

    // Snapshot PRIMA della scrittura che innesca la potatura: l'invarianza si prova per confronto.
    let smallBefore: RevisionRow[] = [];
    let bBefore: RevisionRow[] = [];
    let baselineBigBefore: unknown = null;
    let saveRes: Awaited<ReturnType<typeof saveRevision>> = { ok: false, status: 500 };

    async function creaGenerazione(
      accountId: string,
      slug: string,
      firmaBaseline: string,
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
          // document non null: e cio che rende questa la generazione CORRENTE su cui l'editor lavora
          // e la BASELINE congelata che la potatura non deve MAI toccare (AC-303-3).
          document: documentoValido(firmaBaseline),
        })
        .select('id')
        .single();
      if (genErr) throw genErr;
      return { siteId, genId: gen.id as string };
    }

    /** Semina `count` revisioni (seq 1..count) su una generazione, via service_role (setup, RLS off). */
    async function seminaRevisioni(
      accountId: string,
      genId: string,
      count: number,
      markerPrefix: string,
    ): Promise<void> {
      const fonti = ['generated', 'edited', 'rechosen'];
      const righe = Array.from({ length: count }, (_, i) => {
        const seq = i + 1;
        return {
          account_id: accountId,
          site_generation_id: genId,
          // source DISCORDANTE lungo tutto il vocabolario (T-301 CHECK): non un valore costante.
          source: fonti[i % fonti.length],
          seq,
          // marker con la trappola-prefisso: 'big-1' e prefisso di 'big-10'.
          document: { marker: `${markerPrefix}-${seq}` },
        };
      });
      const { error } = await adminClient().from('site_document_revisions').insert(righe);
      if (error) throw error;
    }

    beforeAll(async () => {
      const a = await createTestUser(emailA, password);
      const b = await createTestUser(emailB, password);
      userAId = a.id;
      userBId = b.id;
      const { data: accs, error } = await adminClient()
        .from('accounts')
        .select('id, owner_id')
        .in('owner_id', [userAId, userBId]);
      if (error || !accs) throw error ?? new Error('account assenti');
      accountAId = accs.find((r) => r.owner_id === userAId)!.id as string;
      accountBId = accs.find((r) => r.owner_id === userBId)!.id as string;

      // slug 'shop' PREFISSO di 'shop-two' (trappola-identita sui campi controllabili).
      const big = await creaGenerazione(accountAId, 'shop', 'baseline-big');
      const small = await creaGenerazione(accountAId, 'shop-two', 'baseline-small');
      const other = await creaGenerazione(accountBId, 'shop', 'baseline-b');
      siteBig = big.siteId;
      genBig = big.genId;
      genSmall = small.genId;
      genB = other.genId;
      // Due id DISTINTI dietro slug omonimi in tenant diversi.
      expect(genBig).not.toBe(genB);

      // Conteggi DISCORDANTI: 20 (al cap), 3 (sotto), 4 (altro tenant).
      await seminaRevisioni(accountAId, genBig, CAP, 'big'); // seq 1..20
      await seminaRevisioni(accountAId, genSmall, 3, 'small'); // seq 1..3
      await seminaRevisioni(accountBId, genB, 4, 'b'); // seq 1..4

      // Snapshot PRIMA della potatura.
      smallBefore = await revisionsOf(genSmall);
      bBefore = await revisionsOf(genB);
      const { data: genRow } = await adminClient()
        .from('site_generations')
        .select('document')
        .eq('id', genBig)
        .single();
      baselineBigBefore = genRow?.document ?? null;

      clientA = await signInAs(emailA, password);

      // ── L'ATTO: A scrive la 21ª revisione su genBig (che ne ha gia 20). saveRevision inserisce
      // seq 21 e POTA la piu vecchia (seq 1) fino a tornare a 20. ────────────────────────────────
      clientHolder.current = clientA;
      saveRes = await saveRevision(siteBig, documentoValido('big-21'));
    }, 60_000);

    afterAll(async () => {
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-303-1
    it('scritta la 21ª revisione, resta ESATTAMENTE 20 e la piu vecchia (seq minimo) e stata eliminata', async () => {
      expect(saveRes.ok).toBe(true); // covers: AC-303-1
      if (!saveRes.ok) throw new Error('saveRevision doveva riuscire');
      // Il documento corrente e la revisione appena scritta (seq 21).
      expect(saveRes.document).toEqual(documentoValido('big-21')); // covers: AC-303-1

      // ORACOLO INDIPENDENTE (service_role): la potatura ha riportato genBig a esattamente 20.
      const dopo = await revisionsOf(genBig);
      expect(dopo).toHaveLength(CAP); // covers: AC-303-1
      const seqs = dopo.map((r) => Number(r.seq));
      // La FIFO ha eliminato la piu vecchia (seq 1); restano le 20 piu recenti, seq 2..21.
      expect(seqs).toEqual(Array.from({ length: CAP }, (_, i) => i + 2)); // covers: AC-303-1
      expect(seqs).not.toContain(1); // covers: AC-303-1
      expect(Math.min(...seqs)).toBe(2); // covers: AC-303-1
      expect(Math.max(...seqs)).toBe(CAP + 1); // covers: AC-303-1
      // Tutte le righe superstiti appartengono al tenant A (nessun travaso cross-tenant).
      expect(dopo.every((r) => r.account_id === accountAId)).toBe(true); // covers: AC-303-1
    });

    // covers: AC-303-2
    it('la potatura tocca SOLO la generazione che sfora: genSmall (sotto il cap) resta INTATTO', async () => {
      // Conteggi DISCORDANTI: genBig e potato a 20; genSmall aveva 3 e li conserva TUTTI.
      const dopoSmall = await revisionsOf(genSmall);
      expect(smallBefore).toHaveLength(3); // premessa: era sotto il cap
      expect(dopoSmall).toHaveLength(3); // covers: AC-303-2
      // Stessi id, stesse seq, stessi document: nessuna riga eliminata ne mutata.
      expect(dopoSmall.map((r) => r.id).sort()).toEqual(smallBefore.map((r) => r.id).sort()); // covers: AC-303-2
      expect(dopoSmall.map((r) => Number(r.seq)).sort((x, y) => x - y)).toEqual([1, 2, 3]); // covers: AC-303-2
      // La seq minima di genSmall e ancora 1: la potatura di genBig non ha toccato la sua storia.
      expect(Math.min(...dopoSmall.map((r) => Number(r.seq)))).toBe(1); // covers: AC-303-2
    });

    // covers: AC-303-2 (security_note: potatura sotto RLS — mai una riga di un ALTRO tenant)
    it('la potatura di A non elimina MAI una revisione del tenant B (RLS DELETE ancorata a is_account_member)', async () => {
      const dopoB = await revisionsOf(genB);
      expect(bBefore).toHaveLength(4); // premessa: B aveva 4 revisioni
      expect(dopoB).toHaveLength(4); // covers: AC-303-2
      // Id invariati: nessuna riga di B e caduta nella potatura innescata da A.
      expect(dopoB.map((r) => r.id).sort()).toEqual(bBefore.map((r) => r.id).sort()); // covers: AC-303-2
      // Nessuna riga di B porta l'account di A, e viceversa: gli insiemi restano disgiunti.
      expect(dopoB.every((r) => r.account_id === accountBId)).toBe(true); // covers: AC-303-2
    });

    // covers: AC-303-3
    it('site_generations.document (baseline congelata) resta INVARIATO ed e ancora leggibile come fallback', async () => {
      const { data: genRow, error } = await adminClient()
        .from('site_generations')
        .select('document')
        .eq('id', genBig)
        .single();
      expect(error).toBeNull(); // covers: AC-303-3
      // La baseline e leggibile (fallback del read-path T-304) e IDENTICA a prima della potatura.
      expect(genRow?.document).toEqual(baselineBigBefore); // covers: AC-303-3
      expect(genRow?.document).toEqual(documentoValido('baseline-big')); // covers: AC-303-3
    });
  },
);
