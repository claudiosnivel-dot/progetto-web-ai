import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-302 (macrotask editor-core, P3) — `saveRevision` DIETRO il gate `parseDocument`, RUNTIME
// contro il Supabase locale. Le asserzioni derivano dagli acceptance_criteria AC-302-1..4
// (01-editor-core.md).
//
// DB-BACKED per necessita': saveRevision scrive sotto RLS con la sessione reale. Come T-234
// (generation-phase2-db) mockiamo SOLO la costruzione del client SSR con un client ad AUTH REALE
// (signInAs -> JWT, RLS ATTIVA); il gate, la derivazione di account_id, la scrittura e la RLS
// girano per intero contro il DB. La service_role compare SOLO come ORACOLO INDIPENDENTE
// (adminClient) e nel setup, MAI dentro l'azione — un valore restituito soddisfatto da un
// implementazione che scrive con service_role sarebbe un falso verde; la riga RILETTA con la
// service_role no.
//
// NOTA SUL VOCABOLARIO DEL GATE (letto dal contratto reale, non dal parenthetical dell'AC):
// `parseDocument` impone ALMENO UNA home (non "esattamente una", vedi document.ts), gli slug
// UNIVOCI e il tetto di byte. Due pagine home sono percio' ACCETTATE dal gate: i casi di rifiuto
// di AC-302-2 usano quindi invarianti che il gate impone DAVVERO — slug duplicato e nessuna home.

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

// ── fixture del documento (forma di parseDocument, T-202) ─────────────────────────────────────
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

/** Una home BEN FORMATA: brief_fields_rendered gia' coincidente con le chiavi di `data`. */
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
            // Lo slot immagine e' un'unione discriminata senza alcun campo-indirizzo (P2-D12):
            // deve sopravvivere al giro senza introdurre un src/href (security_note AC-204-11).
            images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
          },
        ],
      },
    ],
  };
}

/** Slug DUPLICATO ('home' due volte): parseDocument lo rifiuta (superRefine, unicita' slug). */
function documentoSlugDuplicato() {
  const home = documentoValido('dup').pages[0];
  return { recipe_id: RICETTA, theme_id: TEMA, pages: [home, { ...home, title: 'Copia' }] };
}

/** NESSUNA pagina 'home' (solo 'offerings'): parseDocument lo rifiuta (invariante home). */
function documentoSenzaHome() {
  const home = documentoValido('nohome').pages[0];
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [{ ...home, slug: 'offerte', role: 'offerings' }],
  };
}

/**
 * Un draft VALIDO per il gate ma con brief_fields_rendered DISALLINEATO in PIU' direzioni, su DUE
 * blocchi con PIU' chiavi `data`. Il gate lo accetta (brief_fields_rendered non pretende ne la
 * presenza ne la completezza); il riallineamento (AC-302-4) deve, blocco per blocco:
 *  - DROP  — togliere un campo ELENCATO ma ASSENTE da `data` ('email' nell'hero, 'phone' in contatti);
 *  - SOPRAVVIVENZA — conservare i campi presenti in ENTRAMBI ('business_name'; 'address');
 *  - ADD   — aggiungere un campo PRESENTE in `data` ma NON elencato ('phone' nell'hero, 'whatsapp'
 *    in contatti).
 * L'ordine atteso e' quello dello schema (RENDERED_BRIEF_FIELDS): business_name<phone, address<whatsapp.
 */
function documentoDisallineato() {
  const base = documentoValido('mis');
  const hero = base.pages[0].blocks[0];
  return {
    recipe_id: RICETTA,
    theme_id: TEMA,
    pages: [
      {
        ...base.pages[0],
        blocks: [
          {
            ...hero,
            // data porta business_name (elencato -> sopravvive) e phone (NON elencato -> ADD).
            data: { business_name: 'Bottega Aurora mis', phone: '+39 011 0000000' },
            // 'business_name' sopravvive; 'email' elencato ma ASSENTE -> DROP; 'phone' verra' ADD.
            brief_fields_rendered: ['business_name', 'email'],
          },
          {
            id: 'contatti',
            content: {},
            // data porta address (elencato -> sopravvive) e whatsapp (NON elencato -> ADD).
            data: { address: 'Via Roma 1', whatsapp: '+39 333 0000000' },
            // 'address' sopravvive; 'phone' elencato ma ASSENTE -> DROP; 'whatsapp' verra' ADD.
            brief_fields_rendered: ['address', 'phone'],
            images: [],
          },
        ],
      },
    ],
  };
}

type RevisionRow = { id: string; account_id: string; source: string; seq: number | string; document: unknown };

describe.skipIf(!SB)('T-302 saveRevision — gate parseDocument, RLS, seq, brief_fields_rendered (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t302a_${randomUUID()}@example.test`;
  const emailB = `t302b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;

  let siteWrite = '';
  let genWrite = ''; // AC-302-1: scrittura riuscita + incremento seq
  let siteReject = '';
  let genReject = ''; // AC-302-2: draft invalido, nessuna scrittura
  let siteForeign = '';
  let genForeign = ''; // AC-302-3: B (non proprietario) attacca il sito di A
  let siteRealign = '';
  let genRealign = ''; // AC-302-4: riallineamento di brief_fields_rendered

  async function creaGenerazione(slug: string): Promise<{ siteId: string; genId: string }> {
    const admin = adminClient();
    const { data: site, error: siteErr } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (siteErr) throw siteErr;
    const siteId = site.id as string;
    const { data: gen, error: genErr } = await admin
      .from('site_generations')
      .insert({
        account_id: accountAId,
        site_id: siteId,
        status: 'chosen',
        max_pages: 8,
        chosen_variant: 0,
        // document non null: e' cio' che rende questa la generazione CORRENTE su cui l'editor lavora.
        document: documentoValido('baseline'),
      })
      .select('id')
      .single();
    if (genErr) throw genErr;
    return { siteId, genId: gen.id as string };
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
    const { data: accA, error } = await adminClient()
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    if (error || !accA) throw error ?? new Error('account di A assente');
    accountAId = accA.id as string;

    ({ siteId: siteWrite, genId: genWrite } = await creaGenerazione('t302-write'));
    ({ siteId: siteReject, genId: genReject } = await creaGenerazione('t302-reject'));
    ({ siteId: siteForeign, genId: genForeign } = await creaGenerazione('t302-foreign'));
    ({ siteId: siteRealign, genId: genRealign } = await creaGenerazione('t302-realign'));

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
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

  // covers: AC-302-1
  it("scrive una revisione 'edited' con seq incrementato e document uguale al draft; una seconda scrittura porta seq a 2", async () => {
    clientHolder.current = clientA;
    const draft = documentoValido('rev-uno');

    const res = await saveRevision(siteWrite, draft);
    expect(res.ok).toBe(true); // covers: AC-302-1
    if (!res.ok) throw new Error('saveRevision doveva riuscire');
    // Ritorna il documento corrente (la revisione appena scritta), uguale al draft (ben formato).
    expect(res.document).toEqual(draft); // covers: AC-302-1

    // ORACOLO INDIPENDENTE: la riga scritta e' 'edited', seq 1, document == draft.
    const dopoUno = await revisionsOf(genWrite);
    expect(dopoUno).toHaveLength(1); // covers: AC-302-1
    expect(dopoUno[0].source).toBe('edited'); // covers: AC-302-1
    expect(Number(dopoUno[0].seq)).toBe(1); // covers: AC-302-1
    expect(dopoUno[0].document).toEqual(draft); // covers: AC-302-1
    expect(dopoUno[0].account_id).toBe(accountAId); // covers: AC-302-1

    // Lo slot immagine sopravvive senza introdurre un indirizzo (security_note AC-204-11): nessuna
    // chiave url/src/href e' comparsa nel documento persistito.
    const serializzato = JSON.stringify(dopoUno[0].document);
    expect(serializzato).not.toMatch(/"(url|src|href)"\s*:/); // covers: AC-302-1

    // SECONDA scrittura: seq = max+1 = 2 (incremento reale, non un seq costante).
    const res2 = await saveRevision(siteWrite, documentoValido('rev-due'));
    expect(res2.ok).toBe(true); // covers: AC-302-1
    const dopoDue = await revisionsOf(genWrite);
    expect(dopoDue.map((r) => Number(r.seq))).toEqual([1, 2]); // covers: AC-302-1
    expect(dopoDue.map((r) => r.source)).toEqual(['edited', 'edited']); // covers: AC-302-1
  });

  // covers: AC-302-2
  it('un draft che rompe un invariante del gate (slug duplicato / nessuna home) e RIFIUTATO (400) e NESSUNA riga e scritta', async () => {
    clientHolder.current = clientA;
    expect(await revisionsOf(genReject)).toHaveLength(0);

    const dup = await saveRevision(siteReject, documentoSlugDuplicato());
    expect(dup.ok).toBe(false); // covers: AC-302-2
    if (!dup.ok) expect(dup.status).toBe(400); // covers: AC-302-2

    const noHome = await saveRevision(siteReject, documentoSenzaHome());
    expect(noHome.ok).toBe(false); // covers: AC-302-2
    if (!noHome.ok) expect(noHome.status).toBe(400); // covers: AC-302-2

    // ORACOLO: il gate ha respinto PRIMA della scrittura — nessuna revisione esiste.
    expect(await revisionsOf(genReject)).toHaveLength(0); // covers: AC-302-2
  });

  // covers: AC-302-3
  it('un utente NON proprietario non riesce a scrivere una revisione sul sito altrui e nessuna riga e creata', async () => {
    // B e' un tenant diverso: la generazione di A filtra a null sotto la SUA RLS -> 404
    // (anti-enumerazione), mai un errore che ne riveli l'esistenza.
    clientHolder.current = clientB;
    expect(await revisionsOf(genForeign)).toHaveLength(0);

    const res = await saveRevision(siteForeign, documentoValido('intruso'));
    expect(res.ok).toBe(false); // covers: AC-302-3
    if (!res.ok) expect(res.status).toBe(404); // covers: AC-302-3

    // ORACOLO INDIPENDENTE: nessuna revisione sulla generazione di A, ne alcuna del tenant di B.
    const revs = await revisionsOf(genForeign);
    expect(revs).toHaveLength(0); // covers: AC-302-3
    expect(revs.some((r) => r.account_id !== accountAId)).toBe(false); // covers: AC-302-3

    // CONTROLLO: senza sessione la scrittura fallisce con 401 (la porta non e' aperta all'anonimo).
    clientHolder.current = anon;
    const anonRes = await saveRevision(siteForeign, documentoValido('anonimo'));
    expect(anonRes.ok).toBe(false); // covers: AC-302-3
    if (!anonRes.ok) expect(anonRes.status).toBe(401); // covers: AC-302-3
    expect(await revisionsOf(genForeign)).toHaveLength(0); // covers: AC-302-3
  });

  // covers: AC-302-4
  it('brief_fields_rendered di OGNI blocco e riallineato ai campi di data realmente presenti: DROP di un campo elencato ma assente, SOPRAVVIVENZA dei presenti, ADD di un campo presente ma non elencato', async () => {
    clientHolder.current = clientA;
    const draft = documentoDisallineato();
    const heroDraft = draft.pages[0].blocks[0];
    const contattiDraft = draft.pages[0].blocks[1];
    // Premesse del disallineamento, e il gate le accetta comunque (brief_fields_rendered non pretende
    // presenza ne completezza):
    //  hero: elenca business_name+email, ma data porta business_name+phone (email -> DROP, phone -> ADD).
    expect(heroDraft.brief_fields_rendered).toEqual(['business_name', 'email']);
    expect(Object.keys(heroDraft.data)).toEqual(['business_name', 'phone']);
    //  contatti: elenca address+phone, ma data porta address+whatsapp (phone -> DROP, whatsapp -> ADD).
    expect(contattiDraft.brief_fields_rendered).toEqual(['address', 'phone']);
    expect(Object.keys(contattiDraft.data)).toEqual(['address', 'whatsapp']);

    const res = await saveRevision(siteRealign, draft);
    expect(res.ok).toBe(true); // covers: AC-302-4
    if (!res.ok) throw new Error('saveRevision doveva riuscire');

    const heroOut = res.document.pages[0].blocks[0];
    const contattiOut = res.document.pages[0].blocks[1];
    // hero: 'email' caduto (DROP), 'business_name' sopravvissuto (SURVIVAL), 'phone' aggiunto (ADD).
    expect(heroOut.brief_fields_rendered).toEqual(['business_name', 'phone']); // covers: AC-302-4
    // contatti: 'phone' caduto (DROP), 'address' sopravvissuto (SURVIVAL), 'whatsapp' aggiunto (ADD).
    expect(contattiOut.brief_fields_rendered).toEqual(['address', 'whatsapp']); // covers: AC-302-4
    // I dati NON sono toccati: il riallineamento sincronizza il CONTRATTO, non muta ne svuota i valori.
    expect(heroOut.data).toEqual({ business_name: 'Bottega Aurora mis', phone: '+39 011 0000000' }); // covers: AC-302-4
    expect(contattiOut.data).toEqual({ address: 'Via Roma 1', whatsapp: '+39 333 0000000' }); // covers: AC-302-4

    // ORACOLO INDIPENDENTE: cio' che e' persistito porta il contratto sincronizzato in ENTRAMBI i blocchi.
    const revs = await revisionsOf(genRealign);
    expect(revs).toHaveLength(1); // covers: AC-302-4
    const persisted = revs[0].document as { pages: { blocks: { brief_fields_rendered: string[] }[] }[] };
    expect(persisted.pages[0].blocks[0].brief_fields_rendered).toEqual(['business_name', 'phone']); // covers: AC-302-4
    expect(persisted.pages[0].blocks[1].brief_fields_rendered).toEqual(['address', 'whatsapp']); // covers: AC-302-4
  });
});
