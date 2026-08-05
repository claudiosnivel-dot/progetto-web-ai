import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';
import { parseDocument } from '@/domain/generation/document';

// T-318 (macrotask editor-core, P3) — RIPRISTINO DA STORIA (append-only) + ELENCO REVISIONI, RUNTIME
// contro il Supabase locale. Le asserzioni derivano dagli acceptance_criteria AC-318-1..4
// (01-editor-core.md) e dai security_note (RLS/ownership, parseDocument, append-only).
//
// DB-BACKED per necessita': restoreRevision legge la revisione target e ne scrive una nuova SOTTO
// RLS con la sessione reale (policy SELECT/INSERT di T-301 ancorate a is_account_member). Come T-302
// (save-revision) e T-303 (revision-pruning) mockiamo SOLO la costruzione del client SSR con un
// client ad AUTH REALE (signInAs -> JWT, RLS ATTIVA); il gate, la derivazione di account_id, la
// lettura e la scrittura girano per intero contro il DB. La service_role compare SOLO come ORACOLO
// INDIPENDENTE (adminClient) e nel setup, MAI dentro l'azione: un esito soddisfatto da un
// implementazione che scrivesse/leggesse con service_role sarebbe un falso verde; le righe RILETTE
// con service_role no.
//
// DISCIPLINA FIXTURE (lezione P1/P2): >1 elemento, valori DISCORDANTI, un id PREFISSO di un altro.
// I site_generation_id sono UUID (lunghezza fissa, nessuno e prefisso proprio di un altro), quindi
// la trappola-prefisso e portata dai campi CONTROLLABILI:
//   - seq 1 PREFISSO-di-stringa di 10 (e la nuova 11) nella stessa generazione;
//   - firma 'rev-uno' PREFISSO di 'rev-uno-bis'? no: uso firme discordanti ('rev-uno','rev-due',
//     'rev-dieci') col marker seq che porta la trappola-prefisso su seq.
// Documenti DISCORDANTI fra le revisioni (firma diversa -> titoli/contenuti diversi), seq DISTINTI.

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

import { restoreRevision, listRevisions } from '@/data/site-document-revisions';

// ── fixture del documento (forma di parseDocument, T-202; identica a save/prune-revision.test) ──
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
            // Lo slot immagine e un'unione discriminata senza campo-indirizzo (P2-D12): deve
            // sopravvivere al giro di ripristino senza introdurre un src/href (security_note T-241).
            images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
          },
        ],
      },
    ],
  };
}

/** NESSUNA pagina 'home': parseDocument lo rifiuta (invariante home). Documento CORROTTO piantato
 *  via service_role per provare che il ripristino RI-VALIDA (AC-318-4). */
function documentoSenzaHome() {
  const home = documentoValido('corrotto').pages[0];
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [{ ...home, slug: 'offerte', role: 'offerings' }],
  };
}

type RevisionRow = {
  id: string;
  account_id: string;
  source: string;
  seq: number | string;
  document: unknown;
};

describe.skipIf(!SB)(
  'T-318 restoreRevision + listRevisions — ripristino append-only sotto RLS, gate parseDocument (runtime, Supabase locale)',
  () => {
    const password = 'Password123!';
    const suffisso = randomUUID().slice(0, 8);
    const emailA = `t318a_${randomUUID()}@example.test`;
    const emailB = `t318b_${randomUUID()}@example.test`;
    let userAId = '';
    let userBId = '';
    let accountAId = '';
    let accountBId = '';
    let clientA: SupabaseClient;
    let anon: SupabaseClient;

    // genRestore (A): revisioni seq 1/2/10 con document DISCORDANTI -> AC-318-1/2 + listRevisions.
    let siteRestore = '';
    let genRestore = '';
    // genInvalid (A): una revisione seq 1 con document CORROTTO (senza home) -> AC-318-4 (gate reale).
    let siteInvalid = '';
    let genInvalid = '';
    // genScope (A): revisioni seq 1/2, NESSUN seq 5 -> il target di un'altra generazione non e reach.
    let siteScope = '';
    let genScope = '';
    // genOther (A, altro sito): possiede il seq 5 -> non deve MAI essere raggiunto via siteScope.
    let genOther = '';
    // genB (B, ALTRO tenant): revisione seq 1 -> A non deve poter ripristinare sulla storia di B.
    let siteB = '';
    let genB = '';

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
          // document non null: e cio che rende questa la generazione CORRENTE su cui l'editor lavora.
          document: documentoValido(firmaBaseline),
        })
        .select('id')
        .single();
      if (genErr) throw genErr;
      return { siteId, genId: gen.id as string };
    }

    /** Semina una revisione (seq, source, document) via service_role (setup, RLS off). */
    async function seminaRevisione(
      accountId: string,
      genId: string,
      seq: number,
      source: string,
      document: unknown,
    ): Promise<void> {
      const { error } = await adminClient()
        .from('site_document_revisions')
        .insert({ account_id: accountId, site_generation_id: genId, source, seq, document });
      if (error) throw error;
    }

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
      accountAId = (accs.find((r) => r.owner_id === userAId)?.id ?? '') as string;
      accountBId = (accs.find((r) => r.owner_id === userBId)?.id ?? '') as string;
      if (!accountAId || !accountBId) throw new Error('account non risolti');

      // genRestore (A): tre revisioni DISCORDANTI, seq 1/2/10 (trappola-prefisso: '1' prefisso di '10').
      ({ siteId: siteRestore, genId: genRestore } = await creaGenerazione(accountAId, 't318-restore', 'baseline'));
      await seminaRevisione(accountAId, genRestore, 1, 'edited', documentoValido('rev-uno'));
      await seminaRevisione(accountAId, genRestore, 2, 'edited', documentoValido('rev-due'));
      await seminaRevisione(accountAId, genRestore, 10, 'rechosen', documentoValido('rev-dieci'));

      // genInvalid (A): revisione seq 1 CORROTTA (senza home), piantata fuori dal gate.
      ({ siteId: siteInvalid, genId: genInvalid } = await creaGenerazione(accountAId, 't318-invalid', 'baseline'));
      await seminaRevisione(accountAId, genInvalid, 1, 'edited', documentoSenzaHome());

      // genScope (A): seq 1/2, NIENTE seq 5. genOther (A, altro sito): POSSIEDE il seq 5.
      ({ siteId: siteScope, genId: genScope } = await creaGenerazione(accountAId, 't318-scope', 'baseline'));
      await seminaRevisione(accountAId, genScope, 1, 'edited', documentoValido('scope-uno'));
      await seminaRevisione(accountAId, genScope, 2, 'edited', documentoValido('scope-due'));
      ({ genId: genOther } = await creaGenerazione(accountAId, 't318-other', 'baseline'));
      await seminaRevisione(accountAId, genOther, 5, 'edited', documentoValido('altra-generazione'));

      // genB (B, ALTRO tenant): revisione seq 1.
      ({ siteId: siteB, genId: genB } = await creaGenerazione(accountBId, 't318-b', 'baseline'));
      await seminaRevisione(accountBId, genB, 1, 'edited', documentoValido('tenant-b'));

      clientA = await signInAs(emailA, password);
      anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
    }, 60_000);

    afterAll(async () => {
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-318-1
    // covers: AC-318-2
    // covers: AC-318-4
    it("ripristina la revisione seq 1: scrive una NUOVA revisione seq massimo+1 col document di seq 1 (non di seq 10), e NESSUNA revisione preesistente e toccata", async () => {
      clientHolder.current = clientA;
      const primaDelRipristino = await revisionsOf(genRestore);
      expect(primaDelRipristino.map((r) => Number(r.seq))).toEqual([1, 2, 10]); // premessa: >1 revisione, seq distinti

      const res = await restoreRevision(siteRestore, 1);
      expect(res.ok).toBe(true); // covers: AC-318-1
      if (!res.ok) throw new Error('restoreRevision doveva riuscire');
      // Il documento CORRENTE diventa quello di seq 1 (ben formato -> round-trip identico del gate).
      expect(res.document).toEqual(documentoValido('rev-uno')); // covers: AC-318-1
      // Trappola-prefisso: '1' e prefisso di '10', ma il confronto e ESATTO -> non e il doc di seq 10.
      expect(res.document).not.toEqual(documentoValido('rev-dieci')); // covers: AC-318-1

      // ORACOLO INDIPENDENTE: e comparsa UNA nuova revisione seq 11 (max 10 + 1), col document di seq 1.
      const dopo = await revisionsOf(genRestore);
      expect(dopo.map((r) => Number(r.seq))).toEqual([1, 2, 10, 11]); // covers: AC-318-1
      const nuova = dopo.find((r) => Number(r.seq) === 11);
      expect(nuova).toBeDefined();
      expect(nuova?.document).toEqual(documentoValido('rev-uno')); // covers: AC-318-1
      expect(nuova?.account_id).toBe(accountAId); // covers: AC-318-1
      // D4: la provenienza della revisione di ripristino e 'restored', NON 'edited' — distinta da un
      // edit manuale gia' alla riga scritta (oracolo service_role), non solo nel picker.
      expect(nuova?.source).toBe('restored'); // covers: AC-318-1

      // AC-318-4: la nuova revisione scritta e' un documento VALIDO (passa parseDocument).
      expect(parseDocument(nuova?.document).ok).toBe(true); // covers: AC-318-4

      // Lo slot immagine sopravvive senza introdurre un indirizzo (security_note AC-204-11).
      expect(JSON.stringify(nuova?.document)).not.toMatch(/"(url|src|href)"\s*:/); // covers: AC-318-1

      // AC-318-2 (APPEND-ONLY): le revisioni preesistenti 1/2/10 restano, coi loro document ORIGINALI.
      const seq1 = dopo.find((r) => Number(r.seq) === 1);
      const seq2 = dopo.find((r) => Number(r.seq) === 2);
      const seq10 = dopo.find((r) => Number(r.seq) === 10);
      expect(seq1?.document).toEqual(documentoValido('rev-uno')); // covers: AC-318-2
      expect(seq2?.document).toEqual(documentoValido('rev-due')); // covers: AC-318-2
      expect(seq10?.document).toEqual(documentoValido('rev-dieci')); // covers: AC-318-2
      // Nessuna riga preesistente e stata rimpiazzata: gli id di 1/2/10 sono immutati.
      const idPrimaMap = new Map(primaDelRipristino.map((r) => [Number(r.seq), r.id]));
      expect(seq1?.id).toBe(idPrimaMap.get(1)); // covers: AC-318-2
      expect(seq2?.id).toBe(idPrimaMap.get(2)); // covers: AC-318-2
      expect(seq10?.id).toBe(idPrimaMap.get(10)); // covers: AC-318-2
    });

    // covers: AC-318-2
    it("listRevisions elenca la storia (seq, source, created_at) senza eliminare nulla dopo il ripristino", async () => {
      clientHolder.current = clientA;
      const res = await listRevisions(siteRestore);
      expect(res.ok).toBe(true); // covers: AC-318-2
      if (!res.ok) throw new Error('listRevisions doveva riuscire');
      // Tutte e quattro le revisioni (le tre originali + il ripristino) sono leggibili, seq crescente.
      expect(res.revisions.map((r) => r.seq)).toEqual([1, 2, 10, 11]); // covers: AC-318-2
      // source riportato dal DB (vincolato dal CHECK di T-301), discordante lungo la storia: il
      // ripristino (seq 11) porta la provenienza 'restored' (D4), distinta dall'edit e dal rechosen.
      expect(res.revisions.map((r) => r.source)).toEqual(['edited', 'edited', 'rechosen', 'restored']); // covers: AC-318-2
      // created_at e' presente e non vuoto per ogni voce (il campo per la scelta).
      expect(res.revisions.every((r) => typeof r.created_at === 'string' && r.created_at.length > 0)).toBe(true); // covers: AC-318-2
    });

    // covers: AC-318-4
    it('un documento ripristinato NON valido (revisione corrotta piantata fuori dal gate) e rifiutato (400) e nulla e scritto', async () => {
      clientHolder.current = clientA;
      const prima = await revisionsOf(genInvalid);
      expect(prima.map((r) => Number(r.seq))).toEqual([1]); // premessa: solo la revisione corrotta

      const res = await restoreRevision(siteInvalid, 1);
      expect(res.ok).toBe(false); // covers: AC-318-4
      if (!res.ok) expect(res.status).toBe(400); // covers: AC-318-4

      // ORACOLO: il gate ha respinto PRIMA della scrittura -> nessuna nuova revisione.
      expect(await revisionsOf(genInvalid)).toHaveLength(1); // covers: AC-318-4
    });

    // covers: AC-318-3
    it("un revisionSeq che vive in un'ALTRA generazione non e raggiungibile via il sito corrente (404, nulla scritto)", async () => {
      clientHolder.current = clientA;
      const scopePrima = await revisionsOf(genScope);
      const otherPrima = await revisionsOf(genOther);
      expect(scopePrima.map((r) => Number(r.seq))).toEqual([1, 2]); // il seq 5 NON e qui
      expect(otherPrima.map((r) => Number(r.seq))).toEqual([5]); // il seq 5 vive in un'altra generazione

      // Ripristinare seq 5 sul sito la cui generazione corrente NON ha seq 5 -> 404.
      const res = await restoreRevision(siteScope, 5);
      expect(res.ok).toBe(false); // covers: AC-318-3
      if (!res.ok) expect(res.status).toBe(404); // covers: AC-318-3

      // ORACOLO: nessuna generazione e stata toccata (ne quella corrente ne quella che possiede il 5).
      expect((await revisionsOf(genScope)).map((r) => Number(r.seq))).toEqual([1, 2]); // covers: AC-318-3
      expect((await revisionsOf(genOther)).map((r) => Number(r.seq))).toEqual([5]); // covers: AC-318-3
    });

    // covers: AC-318-3
    it("un tenant non puo ripristinare sulla storia di un ALTRO tenant (404 anti-enumerazione, nulla scritto)", async () => {
      // A tenta di ripristinare seq 1 sul sito di B: sotto la SUA RLS la generazione di B filtra a
      // null (anti-enumerazione P1-D21) -> 404, mai un errore che ne riveli l'esistenza.
      clientHolder.current = clientA;
      const bPrima = await revisionsOf(genB);
      expect(bPrima.map((r) => Number(r.seq))).toEqual([1]);

      const res = await restoreRevision(siteB, 1);
      expect(res.ok).toBe(false); // covers: AC-318-3
      if (!res.ok) expect(res.status).toBe(404); // covers: AC-318-3

      // ORACOLO INDIPENDENTE: la storia di B e INTATTA, nessuna revisione del tenant di A comparsa.
      const bDopo = await revisionsOf(genB);
      expect(bDopo.map((r) => Number(r.seq))).toEqual([1]); // covers: AC-318-3
      expect(bDopo.every((r) => r.account_id === accountBId)).toBe(true); // covers: AC-318-3

      // CONTROLLO: senza sessione il ripristino fallisce con 401 (la porta non e aperta all'anonimo).
      clientHolder.current = anon;
      const anonRes = await restoreRevision(siteRestore, 1);
      expect(anonRes.ok).toBe(false); // covers: AC-318-3
      if (!anonRes.ok) expect(anonRes.status).toBe(401); // covers: AC-318-3
    });
  },
);
