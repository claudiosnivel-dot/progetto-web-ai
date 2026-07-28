import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';

// T-204 (P2) — Server action di SCRITTURA writePool/chooseVariant/appendPages RUNTIME
// contro il Supabase locale. Le asserzioni derivano dagli acceptance_criteria
// AC-204-1..AC-204-12 (docs/blueprint/P2-generation/01-generation-model.md), dove
// AC-204-8..AC-204-12 vengono dall'EMENDAMENTO P2-D23 e sono cio che questo file
// copriva solo in parte: il tetto max_pages DELLA RIGA, gli stati terminali di
// writePool, il pool preteso da chooseVariant, il gate parseDocument della FASE 2 e la
// prova di vita che non deve ringiovanire i rifiuti.
//
// Come T-203: mockiamo SOLO la costruzione del client SSR (createServerSupabaseClient,
// che dipende dai cookie di next/headers non disponibili in node) con un client ad AUTH
// REALE (signInAs → JWT, ruolo authenticated, RLS ATTIVA). Tutto il resto — gate di
// validazione, macchina a stati, FK composite, RLS delle due tabelle — gira per intero
// contro il DB locale. La service_role compare SOLO come ORACOLO INDIPENDENTE
// (adminClient) e nel setup delle fixture, mai dentro le azioni.
//
// QUESTE AZIONI CONGELANO: il documento che chooseVariant scrive e l'artefatto che P3
// modifichera e P4 pubblichera. Per questo ogni rifiuto qui sotto e verificato DUE volte:
// il valore restituito dall'azione NON e l'oracolo — lo e la riga riletta con la
// service_role (status, chosen_variant, document, updated_at) e il conteggio delle righe
// di generation_pools. Nessun test di questo file puo passare se l'azione non toccasse
// affatto il DB.

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

import { writePool, chooseVariant, appendPages } from '@/data/generations';
import { POOL_LIMITS } from '@/domain/generation/pool';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';
import { SLOTS, type PageRole } from '@/domain/generation/slots';
import { BRIEF_LIMITS } from '@/domain/onboarding/brief';

// ── fixture: il vocabolario condiviso ────────────────────────────────────────

const ORA_MS = 60 * 60 * 1000;
/** Eta di TUTTE le fixture: un'ora. Serve a rendere MISURABILE l'avanzamento di
 *  `updated_at` — l'invariante che T-203 ha dichiarato per ogni scrittura di questo
 *  modulo (senza, una generazione viva sembrerebbe ferma e la riconciliazione la
 *  ucciderebbe mentre lavora). */
const ETA_FIXTURE = ORA_MS;

const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';
const RUOLO_HOME: PageRole = 'home';

/** L'allowlist degli slug che il gate del pool riceve (in produzione viene da T-213).
 *  'offerte' e PREFISSO di 'offerte-speciali': un confronto scritto con startsWith
 *  invece che con uguaglianza deve poter essere osservato mentre sbaglia. */
const SLUG_AMMESSI = ['home', 'offerte', 'offerte-speciali'];

type StatoGenerazione = 'generating' | 'ready' | 'chosen' | 'complete' | 'failed';

// Le fixture sono volutamente LASCHE nel tipo: devono poter portare valori fuori tetto,
// pagine in piu e chiavi sconosciute — cioe cio che i gate devono rifiutare, e che un
// tipo stretto renderebbe impossibile scrivere.
type BloccoFixture = {
  id: string;
  content: Record<string, unknown>;
  data: Record<string, unknown>;
  brief_fields_rendered: string[];
  images: Record<string, unknown>[];
};
type PaginaFixture = {
  slug: string;
  role: string;
  title: string;
  meta_description: string;
  blocks: BloccoFixture[];
};
type DocumentoFixture = { recipe_id: string; theme_id: string; pages: PaginaFixture[] };

/** La home della fase 1: DUE blocchi con contenuti DISCORDANTI e id in cui uno e
 *  PREFISSO dell'altro ('hero' / 'hero-2'). */
function paginaHome(firma: string): PaginaFixture {
  return {
    slug: 'home',
    role: 'home',
    title: `Panificio Aurora — ${firma}`,
    meta_description: `Pane a lievitazione naturale, ${firma}, sfornato tre volte al giorno.`,
    blocks: [
      {
        id: 'hero',
        content: {
          hero_title_kicker: `Panificio dal 1953 — ${firma}`,
          hero_title: `Il pane a lievitazione naturale di via Roma (${firma})`,
          hero_subtitle: `Sfornato tre volte al giorno, mai il giorno prima. ${firma}`,
        },
        data: { business_name: `Panificio Aurora ${firma}` },
        brief_fields_rendered: ['business_name'],
        images: [{ source: 'theme-placeholder', token: 'hero-wide' }],
      },
      {
        id: 'hero-2',
        content: {
          about_title: `Chi siamo (${firma})`,
          about_body: `Tre generazioni dietro lo stesso banco, dal 1953. ${firma}`,
          about_points: [`Lievito madre — ${firma}`, `Farine a pietra — ${firma}`],
        },
        data: { highlights: [`Forno a legna ${firma}`] },
        brief_fields_rendered: ['highlights'],
        images: [{ source: 'uploaded', asset_id: '00000001-0000-4000-8000-000000000001' }],
      },
    ],
  };
}

/** Una pagina interna: ogni valore porta lo slug, quindi due pagine non condividono ne
 *  titolo ne contenuto. Se una scrittura scambiasse due pagine, le asserzioni di
 *  identita lo vedrebbero. */
function paginaInterna(slug: string, role: PageRole): PaginaFixture {
  return {
    slug,
    role,
    title: `Titolo della pagina ${slug}`,
    meta_description: `Meta description della pagina ${slug}, diversa da ogni altra.`,
    blocks: [
      {
        id: `${slug}-blocco`,
        content: { offerings_title: `Sezione principale di ${slug}` },
        data: { address: `Indirizzo reso in ${slug}` },
        brief_fields_rendered: ['address'],
        images: [{ source: 'theme-placeholder', token: `banner-${slug}` }],
      },
    ],
  };
}

/** Il documento della fase 1: la SOLA home (P2-D13). */
function documentoSoloHome(firma: string): DocumentoFixture {
  return { recipe_id: RICETTA, theme_id: TEMA, pages: [paginaHome(firma)] };
}

/** Le pagine interne della fase 2: PIU DI UNA, con due slug in cui uno e PREFISSO
 *  dell'altro. */
function pagineInterne(): PaginaFixture[] {
  return [
    paginaInterna('offerte', 'offerings'),
    paginaInterna('offerte-speciali', 'offerings'),
    paginaInterna('contatti', 'contact'),
  ];
}

/** Un documento multi-pagina: valido per parseDocument, ma NON e cio che la fase 1
 *  congela (chooseVariant scrive la sola home). */
function documentoMultiPagina(firma: string): DocumentoFixture {
  return { recipe_id: RICETTA, theme_id: TEMA, pages: [paginaHome(firma), ...pagineInterne()] };
}

// ── fixture: i pool ──────────────────────────────────────────────────────────

function poolValido(firma: string): Record<string, unknown> {
  return {
    pages: {
      home: {
        hero_title_kicker: `Occhiello ${firma}`,
        hero_title: `Titolo hero ${firma}`,
        about_points: [`Primo punto ${firma}`, `Secondo punto ${firma}`],
      },
      offerte: {
        offerings_title: `Offerte ${firma}`,
        offerings_intro: `Introduzione alle offerte ${firma}`,
      },
      // Lo slug PREFISSO dell'altro compare anche nel contenuto, non solo
      // nell'allowlist.
      'offerte-speciali': { offerings_title: `Speciali ${firma}` },
    },
  };
}

/** Lo STESSO pool con UNA sola variabile cambiata: uno slot fuori tetto (AC-204-1). */
function poolOltreIlTetto(firma: string): Record<string, unknown> {
  const pool = poolValido(firma) as { pages: Record<string, Record<string, unknown>> };
  pool.pages.home.hero_title = 'x'.repeat(POOL_LIMITS.text + 1);
  return pool;
}

/** Lo STESSO pool con UNA sola variabile cambiata: uno slug fuori allowlist. */
function poolFuoriAllowlist(firma: string): Record<string, unknown> {
  const pool = poolValido(firma) as { pages: Record<string, Record<string, unknown>> };
  pool.pages['chi-siamo'] = { about_title: `Chi siamo ${firma}` };
  return pool;
}

// ── registro delle RICHIESTE HTTP verso PostgREST (AC-204-5 e AC-204-7) ──────
// Due grandezze di questo file si misurano sul TRASPORTO e non sull'esito, perche
// l'esito non le distingue:
//  - AC-204-5, "rifiutata PRIMA di raggiungere il DB": un rifiuto che arriva DOPO che il
//    CHECK di T-200 ha detto no e comunque un rifiuto, e un test che guardasse solo
//    `ok:false` non vedrebbe la differenza. Si conta quindi che NESSUNA richiesta parta.
//  - AC-204-7, "lo scrivo DAVVERO attraverso il client con sessione": che la riga
//    riletta sia identica lo dimostra a posteriori, ma non dice quanti byte hanno
//    attraversato il gateway davanti a PostgREST. Si misura quindi il CORPO della
//    richiesta, che e la cosa che un gateway rifiuterebbe.
// Il client e REALE (auth reale, RLS attiva) e gli si sostituisce `global.fetch`: ogni
// richiesta a /rest/v1/ finisce nel registro, comunque sia stata costruita — il
// trasporto e l'unica strozzatura che nessuna API del client puo aggirare. Le chiamate
// ad /auth/v1/ (getUser) non sono query di tabella e non entrano nel registro.
type Richiesta = { url: string; byteCorpo: number };

function byteDelCorpo(body: BodyInit | null | undefined): number {
  return typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : 0;
}

async function clientMisurato(
  sessioneDi: SupabaseClient,
  registro: Richiesta[],
): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const url =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          if (url.includes('/rest/v1/')) {
            registro.push({ url, byteCorpo: byteDelCorpo(init?.body) });
          }
          return fetch(input, init);
        },
      },
    },
  );
  // Sessione RIUSATA da un utente gia autenticato: `setSession` non e una nuova
  // signInWithPassword (l'auth locale ha un rate limit sul sign-in).
  const { data } = await sessioneDi.auth.getSession();
  const sessione = data.session;
  if (!sessione) throw new Error('sessione assente: il client misurato non sarebbe autenticato');
  const { error } = await client.auth.setSession({
    access_token: sessione.access_token,
    refresh_token: sessione.refresh_token,
  });
  if (error) throw error;
  return client;
}

// ── il caso peggiore al TETTO di byte (AC-204-7) ─────────────────────────────
// AC-204-7 non chiede "un documento grande": chiede un documento VALIDO di taglia PARI a
// DOCUMENT_LIMITS.max_bytes, scritto DAVVERO attraverso il client con sessione. Il tetto
// e in BYTE UTF-8 mentre i tetti per campo contano CODE UNIT UTF-16 (P2-D21), quindi la
// taglia si governa cambiando l'ALFABETO a parita di tetti: una lettera accentata pesa 2
// byte, un ideogramma 3. Il riempitore qui sotto spende un BUDGET di caratteri a 3 byte e
// poi passa a quelli a 2, cosi ogni unita di budget vale ESATTAMENTE un byte in piu: si
// misura il documento tutto-accentato e si spende la differenza dal tetto. Il risultato
// non e "quasi al tetto": e AL tetto, ed e asserito.
const ACCENTATE = 'àèéìíòóùúñü';
const IDEOGRAMMI = '漢字日本語中文';

type Riempimento = (limite: number, tag: string) => string;

/** Stringa ASCII lunga ESATTAMENTE `limite` code unit: gli IDENTIFICATORI (slug, id di
 *  blocco, token, id versionati) hanno una forma che non ammette multibyte. */
function stringaAscii(limite: number, tag: string): string {
  if (tag.length > limite) throw new Error(`tag '${tag}' piu lungo del tetto ${limite}`);
  let out = tag;
  for (let i = 0; i < limite - tag.length; i += 1) out += 'x';
  return out;
}

function riempitore(budgetTreByte: number): Riempimento {
  let budget = budgetTreByte;
  return (limite: number, tag: string): string => {
    if (tag.length > limite) throw new Error(`tag '${tag}' piu lungo del tetto ${limite}`);
    let out = tag;
    for (let i = 0; i < limite - tag.length; i += 1) {
      if (budget > 0) {
        out += IDEOGRAMMI[i % IDEOGRAMMI.length];
        budget -= 1;
      } else {
        out += ACCENTATE[i % ACCENTATE.length];
      }
    }
    return out;
  };
}

function items<T>(quanti: number, make: (indice: number) => T): T[] {
  return Array.from({ length: quanti }, (_unused, indice) => make(indice));
}

function pesoInByte(valore: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valore)).length;
}

/** I campi del brief resi direttamente, TUTTI al tetto di P1-D17. */
function datiBriefAiTetti(firma: string, str: Riempimento): Record<string, unknown> {
  return {
    business_name: str(BRIEF_LIMITS.business_name, `${firma}-nome-`),
    vertical: 'ristorazione',
    description: str(BRIEF_LIMITS.description, `${firma}-descrizione-`),
    address: str(BRIEF_LIMITS.address, `${firma}-indirizzo-`),
    geo: { lat: 45.4642035, lng: 9.1899795 },
    hours: Object.fromEntries(
      items(BRIEF_LIMITS.hours_keys, (i) => [
        str(BRIEF_LIMITS.hours_key, `g${i}-`),
        str(BRIEF_LIMITS.hours_value, `${firma}-orario${i}-`),
      ]),
    ),
    phone: str(BRIEF_LIMITS.phone, '+390000'),
    whatsapp: str(BRIEF_LIMITS.whatsapp, '+391111'),
    email: str(BRIEF_LIMITS.email, `${firma}-email-`),
    primary_goal: 'prenota',
    locale: 'it',
    offerings: items(BRIEF_LIMITS.offerings_items, (i) => ({
      name: str(BRIEF_LIMITS.offering_name, `${firma}-offerta${i}-`),
      description: str(BRIEF_LIMITS.offering_description, `${firma}-desc${i}-`),
      price: str(BRIEF_LIMITS.offering_price, `p${i}-`),
      section: str(BRIEF_LIMITS.offering_section, `sezione${i}-`),
    })),
    social_links: items(BRIEF_LIMITS.social_links_items, (i) =>
      str(BRIEF_LIMITS.social_link, `${firma}-social${i}-`),
    ),
    highlights: items(BRIEF_LIMITS.highlights_items, (i) =>
      str(BRIEF_LIMITS.highlight, `${firma}-punto${i}-`),
    ),
    brand_hints: str(BRIEF_LIMITS.brand_hints, `${firma}-brand-`),
  };
}

/** Ogni slot del catalogo (T-201) col proprio valore al tetto di POOL_LIMITS. */
function contenutoAiTetti(firma: string, str: Riempimento): Record<string, unknown> {
  const contenuto: Record<string, unknown> = {};
  for (const slot of SLOTS) {
    if (slot.kind === 'text') {
      contenuto[slot.id] = str(POOL_LIMITS.text, `${firma}-${slot.id}-`);
    } else if (slot.kind === 'list') {
      contenuto[slot.id] = items(POOL_LIMITS.list_items, (i) =>
        str(POOL_LIMITS.list_item, `${firma}-${slot.id}-${i}-`),
      );
    } else {
      contenuto[slot.id] = items(POOL_LIMITS.qa_pairs, (i) => ({
        question: str(POOL_LIMITS.qa_question, `${firma}-d${i}-`),
        answer: str(POOL_LIMITS.qa_answer, `${firma}-r${i}-`),
      }));
    }
  }
  return contenuto;
}

const RUOLI = [...new Set(SLOTS.map((slot) => slot.page_role))];
/** I ruoli che NON sono la home: le pagine interne ruotano su questi. */
const RUOLI_INTERNI = RUOLI.filter((ruolo) => ruolo !== RUOLO_HOME);

function paginaAiTetti(indice: number, str: Riempimento): PaginaFixture {
  const firma = `p${indice}`;
  const dati = datiBriefAiTetti(firma, str);
  const nomiCampi = Object.keys(dati);
  const contenuto = contenutoAiTetti(firma, str);
  const idSlot = Object.keys(contenuto);
  const quantiBlocchi = DOCUMENT_LIMITS.blocks_per_page;

  return {
    slug: stringaAscii(DOCUMENT_LIMITS.page_slug, `${firma}-slug-`),
    // UNA SOLA HOME, e la correzione non e cosmetica: `indice % RUOLI.length` riportava
    // 'home' anche alla pagina 6 (RUOLI[0]), cioe il documento al tetto ne aveva DUE.
    // Finche appendPages non contava le home quel documento passava; dall'EMENDAMENTO
    // P2-D23 (AC-204-11) la fase 2 non puo piu disfare la home unica, e una fixture con
    // due home misurerebbe QUELL'invariante invece del tetto di byte che AC-204-7 vuole
    // misurare. I ruoli delle pagine interne ruotano percio sui soli NON home.
    role: indice === 0 ? RUOLO_HOME : RUOLI_INTERNI[(indice - 1) % RUOLI_INTERNI.length],
    title: str(DOCUMENT_LIMITS.page_title, `${firma}-titolo-`),
    meta_description: str(DOCUMENT_LIMITS.meta_description, `${firma}-meta-`),
    blocks: items(quantiBlocchi, (b) => {
      const campiDelBlocco = nomiCampi.filter((_nome, i) => i % quantiBlocchi === b);
      const slotDelBlocco = idSlot.filter((_id, i) => i % quantiBlocchi === b);
      return {
        id: stringaAscii(DOCUMENT_LIMITS.block_id, `${firma}-b${b}-`),
        content: Object.fromEntries(slotDelBlocco.map((id) => [id, contenuto[id]])),
        data: Object.fromEntries(campiDelBlocco.map((nome) => [nome, dati[nome]])),
        brief_fields_rendered: campiDelBlocco,
        images: items(DOCUMENT_LIMITS.images_per_block, (k) => ({
          source: 'theme-placeholder',
          token: stringaAscii(DOCUMENT_LIMITS.image_token, `t${b}-${k}-`),
        })),
      };
    }),
  };
}

function documentoAiTetti(str: Riempimento): DocumentoFixture {
  return {
    recipe_id: `${stringaAscii(DOCUMENT_LIMITS.versioned_id - 2, 'ricetta-')}@9`,
    theme_id: `${stringaAscii(DOCUMENT_LIMITS.versioned_id - 2, 'tema-')}@9`,
    pages: items(DOCUMENT_LIMITS.max_pages, (indice) => paginaAiTetti(indice, str)),
  };
}

/** Il documento VALIDO di taglia ESATTAMENTE pari a DOCUMENT_LIMITS.max_bytes. */
function documentoAlTetto(): DocumentoFixture {
  const tuttoAccentato = documentoAiTetti(riempitore(0));
  const base = pesoInByte(tuttoAccentato);
  const mancanti = DOCUMENT_LIMITS.max_bytes - base;
  if (mancanti < 0) {
    throw new Error(
      `il caso peggiore accentato (${base} byte) sfonda gia il tetto ${DOCUMENT_LIMITS.max_bytes}`,
    );
  }
  return documentoAiTetti(riempitore(mancanti));
}

// ── fixture: le pagine OSTILI della FASE 2 (AC-204-11) ───────────────────────
// Ognuna cambia UNA SOLA cosa rispetto alla propria versione legittima, cosi il rifiuto
// non puo essere attribuito a due difetti insieme — e il controllo negativo in fondo
// riappende esattamente quelle versioni legittime.

/** La stessa pagina interna, col solo slot immagine sostituito da una SORGENTE che
 *  l'unione discriminata di document.ts non prevede: quella con l'URL di terzi che quel
 *  modulo dichiara IRRAPPRESENTABILE per tipo (P2-D12). */
function paginaConImmagineDiTerzi(slug: string): PaginaFixture {
  const pagina = paginaInterna(slug, 'reviews');
  pagina.blocks[0].images = [{ source: 'external', url: 'https://evil.example/x.png' }];
  return pagina;
}

/** Nove pagine ciascuna VALIDA e a ogni proprio tetto, riempite di ideogrammi (3 byte
 *  per code unit): nessun campo sfora e il totale resta ENTRO il tetto di pagine, ma il
 *  PRODOTTO supera DOCUMENT_LIMITS.max_bytes — che e l'unico tetto che nessun tetto per
 *  campo limita (document.ts). E' il solo modo di misurare QUEL tetto: una stringa
 *  gigante in un campo solo la rifiuterebbe gia il tetto del campo. */
function pagineOltreIlTettoDiByte(): PaginaFixture[] {
  const str = riempitore(Number.MAX_SAFE_INTEGER);
  return items(DOCUMENT_LIMITS.max_pages - 1, (indice) => paginaAiTetti(indice + 1, str));
}

// ── esiti ────────────────────────────────────────────────────────────────────

type Esito = { ok: true } | { ok: false; status: number };

/** Lo status di un RIFIUTO, o un fallimento leggibile del test. Il valore restituito non
 *  e mai l'oracolo: dopo ogni rifiuto la riga si rilegge con la service_role. */
function rifiuto(res: Esito, cosa: string): number {
  if (res.ok) throw new Error(`${cosa} NON doveva riuscire`);
  return res.status;
}

function accettato(res: Esito, cosa: string): void {
  if (!res.ok) throw new Error(`${cosa} doveva riuscire, invece status=${res.status}`);
}

describe.skipIf(!SB)('T-204 writePool/chooseVariant/appendPages (runtime, Supabase locale)', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t204a_${randomUUID()}@example.test`;
  const emailB = `t204b_${randomUUID()}@example.test`;
  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;

  // Le generazioni di A, in stati DIVERSI e con valori DISCORDANTI (max_pages,
  // chosen_variant, documento): la macchina a stati va provata contro TUTTE le partenze,
  // non contro una. Gli slug dei siti hanno relazione di PREFISSO fra loro ('wr-a' e
  // prefisso di 'wr-a-2', 'wr-a-ready', …) e 'wr-a' esiste OMONIMO anche nell'account B.
  let gPoolBase = ''; // 'generating' — writePool (AC-204-1) e indici (AC-204-5)
  let gPoolCross = ''; // 'generating' — bersaglio del writePool di B (AC-204-4)
  let gFlusso = ''; // 'ready'      — il flusso completo (AC-204-2)
  let gIndici = ''; // 'ready'      — indici fuori scala e bordo basso (AC-204-5)
  let gBordo = ''; // 'ready'       — bordo alto ammesso, indice 4 (AC-204-5)
  let gCrossReady = ''; // 'ready'  — bersaglio del chooseVariant di B (AC-204-4)
  let gCrossChosen = ''; // 'chosen'— bersaglio dell'appendPages di B (AC-204-4)
  let gChosen = ''; // 'chosen'     — appendPages dallo stato GIUSTO (controllo negativo AC-204-6)
  let gStato = ''; // 'chosen'      — chooseVariant da 'chosen' e rifiutato
  let gComplete = ''; // 'complete' — entrambe le transizioni rifiutate
  let gFailed = ''; // 'failed'     — entrambe le transizioni rifiutate
  let gAnon = ''; // 'ready'        — bersaglio delle chiamate senza sessione (AC-204-3)
  let gDoc = ''; // 'ready'         — documenti rifiutati dal gate (AC-204-2)
  let gTetto = ''; // 'ready'       — il documento al tetto di byte (AC-204-7)
  let gB = ''; // 'generating' di B — controllo negativo di AC-204-4 (writePool)
  let gBReady = ''; // 'ready' di B — controllo negativo di AC-204-4 (chooseVariant)
  // Le generazioni dell'EMENDAMENTO P2-D23. Sono DEDICATE una per AC: uno stato
  // condiviso fra due AC renderebbe il rifiuto attribuibile a due cause insieme.
  let gTettoRiga = ''; // 'chosen' con max_pages BASSO — AC-204-8
  let gPoolVivo = ''; // 'ready'   — controllo negativo di AC-204-9 (stato VIVO)
  let gSenzaPool = ''; // 'ready' senza alcun pool — AC-204-10
  let gOstile = ''; // 'chosen'    — le pagine ostili della fase 2 (AC-204-11)
  let gVita = ''; // 'generating'  — la prova di vita e i tre rifiuti (AC-204-12)

  async function creaSito(accountId: string, slug: string): Promise<string> {
    const { data, error } = await adminClient()
      .from('sites')
      .insert({ account_id: accountId, name: slug, slug: `${slug}-${suffisso}` })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function creaGenerazione(opts: {
    accountId: string;
    slugSito: string;
    status: StatoGenerazione;
    maxPages: number;
    document?: unknown;
    chosenVariant?: number | null;
  }): Promise<string> {
    const siteId = await creaSito(opts.accountId, opts.slugSito);
    const quando = new Date(Date.now() - ETA_FIXTURE).toISOString();
    const { data, error } = await adminClient()
      .from('site_generations')
      .insert({
        account_id: opts.accountId,
        site_id: siteId,
        status: opts.status,
        max_pages: opts.maxPages,
        document: opts.document ?? null,
        chosen_variant: opts.chosenVariant ?? null,
        created_at: quando,
        updated_at: quando,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  type Istantanea = {
    status: string;
    chosen_variant: number | null;
    document: unknown;
    max_pages: number;
    updated_at: string;
  };

  /** L'ORACOLO INDIPENDENTE: la riga letta con la service_role, che bypassa la RLS e non
   *  passa da nessuna delle azioni sotto test. */
  async function istantanea(generationId: string): Promise<Istantanea> {
    const { data, error } = await adminClient()
      .from('site_generations')
      .select('status, chosen_variant, document, max_pages, updated_at')
      .eq('id', generationId)
      .single();
    if (error) throw error;
    return data as Istantanea;
  }

  /** Le righe di pool di una generazione, sempre con la service_role. */
  async function poolDi(generationId: string) {
    const { data, error } = await adminClient()
      .from('generation_pools')
      .select('id, account_id, generation_id, scope, variant_index, content')
      .eq('generation_id', generationId)
      .order('scope', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accA } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userAId)
      .single();
    const { data: accB } = await admin
      .from('accounts')
      .select('id')
      .eq('owner_id', userBId)
      .single();
    accountAId = accA!.id as string;
    accountBId = accB!.id as string;

    const A = accountAId;
    gPoolBase = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a',
      status: 'generating',
      maxPages: 8,
    });
    gPoolCross = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-2',
      status: 'generating',
      maxPages: 3,
    });
    gFlusso = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-ready',
      status: 'ready',
      maxPages: 7,
    });
    gIndici = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-indici',
      status: 'ready',
      maxPages: 5,
    });
    gBordo = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-indici-2',
      status: 'ready',
      maxPages: 6,
    });
    gCrossReady = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-cross',
      status: 'ready',
      maxPages: 4,
    });
    gCrossChosen = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-cross-2',
      status: 'chosen',
      maxPages: 9,
      chosenVariant: 3,
      document: documentoSoloHome('cross-chosen'),
    });
    gChosen = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-chosen',
      status: 'chosen',
      maxPages: 10,
      chosenVariant: 1,
      document: documentoSoloHome('chosen'),
    });
    gStato = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-stato',
      status: 'chosen',
      maxPages: 8,
      chosenVariant: 0,
      document: documentoSoloHome('stato'),
    });
    gComplete = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-complete',
      status: 'complete',
      maxPages: 2,
      chosenVariant: 4,
      document: documentoMultiPagina('complete'),
    });
    gFailed = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-failed',
      status: 'failed',
      maxPages: 1,
    });
    gAnon = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-anon',
      status: 'ready',
      maxPages: 3,
    });
    gDoc = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-doc',
      status: 'ready',
      maxPages: 6,
    });
    gTetto = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-tetto',
      status: 'ready',
      maxPages: 10,
    });
    // max_pages = 2, cioe SOTTO il tetto globale DOCUMENT_LIMITS.max_pages: e cio che
    // rende osservabile QUALE dei due tetti sta rifiutando (AC-204-8).
    gTettoRiga = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-tetto-riga',
      status: 'chosen',
      maxPages: 2,
      chosenVariant: 0,
      document: documentoSoloHome('tetto-riga'),
    });
    gPoolVivo = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-vivo',
      status: 'ready',
      maxPages: 4,
    });
    gSenzaPool = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-senza-pool',
      status: 'ready',
      maxPages: 5,
    });
    // max_pages = 10 (il tetto globale): cosi il rifiuto delle pagine ostili non puo
    // venire dal tetto della riga (AC-204-8), che qui non e cio che si misura.
    gOstile = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-ostile',
      status: 'chosen',
      maxPages: DOCUMENT_LIMITS.max_pages,
      chosenVariant: 2,
      document: documentoSoloHome('ostile'),
    });
    gVita = await creaGenerazione({
      accountId: A,
      slugSito: 'wr-a-vita',
      status: 'generating',
      maxPages: 3,
    });

    // B ha generazioni PROPRIE: senza, un rifiuto per B sembrerebbe isolamento anche se
    // fosse dovuto a tutt'altro. Gli slug sono OMONIMI di quelli di A (l'unicita di
    // sites e per-account).
    gB = await creaGenerazione({
      accountId: accountBId,
      slugSito: 'wr-a',
      status: 'generating',
      maxPages: 5,
    });
    gBReady = await creaGenerazione({
      accountId: accountBId,
      slugSito: 'wr-a-2',
      status: 'ready',
      maxPages: 4,
    });

    clientA = await signInAs(emailA, password);
    clientB = await signInAs(emailB, password);
    anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }, 60000);

  afterAll(async () => {
    // cascade: auth.users → accounts → sites → site_generations → generation_pools
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // ── DoD 1/6: proprieta del MODULO, verificate sulla sorgente ────────────────
  it("le tre azioni sono esportate da un modulo server-side, senza service_role, senza select('*') e senza .or()/.filter()", () => {
    expect(typeof writePool).toBe('function');
    expect(typeof chooseVariant).toBe('function');
    expect(typeof appendPages).toBe('function');

    const sorgente = readFileSync(resolve(process.cwd(), 'src/data/generations.ts'), 'utf8');
    // I divieti si asseriscono sul CODICE, non sulla prosa: il modulo NOMINA le pratiche
    // vietate nei propri commenti di sicurezza, e un controllo sul testo grezzo
    // punirebbe proprio il fatto che siano dichiarate.
    const codice = sorgente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(sorgente.startsWith("'use server'")).toBe(true);
    // R7: nessun client service_role qui dentro (bypasserebbe la RLS su cui poggia
    // l'intero isolamento di AC-204-4).
    expect(codice).not.toContain('supabase-admin');
    expect(codice).not.toContain('SERVICE_ROLE');
    // A05:2025 — PostgREST filter injection: nessun filtro a stringa libera.
    expect(codice).not.toMatch(/\.or\(/);
    expect(codice).not.toMatch(/\.filter\(\s*['"`]/);
    expect(codice).not.toMatch(/select\(\s*['"`]\*/);
  });

  // ── AC-204-1 ────────────────────────────────────────────────────────────────
  // covers: AC-204-1
  it('writePool con uno slot fuori tetto e rifiutato e NON scrive nulla; lo stesso pool VALIDO, stessa generazione/scope/variante, e accettato', async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gPoolBase);

    const invalido = await writePool(
      gPoolBase,
      'home',
      null,
      poolOltreIlTetto('base'),
      SLUG_AMMESSI,
    );
    expect(rifiuto(invalido, 'writePool con slot fuori tetto')).toBe(400); // covers: AC-204-1
    // ORACOLO INDIPENDENTE: nessuna riga di pool, e la generazione non e stata toccata.
    expect(await poolDi(gPoolBase)).toHaveLength(0); // covers: AC-204-1
    const dopoRifiuto = await istantanea(gPoolBase);
    expect(dopoRifiuto.updated_at).toBe(prima.updated_at); // covers: AC-204-1 — nemmeno updated_at
    expect(dopoRifiuto.status).toBe('generating'); // covers: AC-204-1

    // CONTROLLO NEGATIVO: cambia UNA sola variabile (il contenuto), stessa generazione,
    // stesso scope, stessa variante. Senza, il test non distinguerebbe "validazione" da
    // "writePool non scrive mai".
    const valido = await writePool(gPoolBase, 'home', null, poolValido('base'), SLUG_AMMESSI);
    accettato(valido, 'writePool con pool valido');

    const righe = await poolDi(gPoolBase);
    expect(righe).toHaveLength(1); // covers: AC-204-1
    expect(righe[0].generation_id).toBe(gPoolBase); // covers: AC-204-1
    expect(righe[0].account_id).toBe(accountAId); // covers: AC-204-1 — account derivato, mai dal client
    expect(righe[0].scope).toBe('home'); // covers: AC-204-1
    expect(righe[0].variant_index).toBeNull(); // covers: AC-204-1 — pool CONDIVISO
    expect(righe[0].content).toEqual(poolValido('base')); // covers: AC-204-1
    // La generazione e VIVA: ogni scrittura di questo modulo impone updated_at (T-203).
    const dopo = await istantanea(gPoolBase);
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-1
  });

  // covers: AC-204-1
  it('writePool con uno slug fuori allowlist e rifiutato e non scrive nulla', async () => {
    clientHolder.current = clientA;
    const prima = await poolDi(gPoolBase);

    const res = await writePool(
      gPoolBase,
      'inner',
      0,
      poolFuoriAllowlist('base'),
      SLUG_AMMESSI,
    );
    expect(rifiuto(res, 'writePool con slug fuori allowlist')).toBe(400); // covers: AC-204-1
    expect(await poolDi(gPoolBase)).toHaveLength(prima.length); // covers: AC-204-1 — nessuna riga aggiunta
  });

  // covers: AC-204-12
  // ETICHETTA CORRETTA (rilievo V-204-07): questo test portava `covers: AC-204-1`, ma
  // AC-204-1 riguarda SOLO il content che viola PoolSchema. Il caso "uuid ben formato ma
  // inesistente" e il secondo dei tre di AC-204-12. Una copertura dichiarata piu alta di
  // quella reale e peggio di una lacuna dichiarata.
  it('writePool su una generazione inesistente e rifiutato con 404 e non scrive nulla', async () => {
    clientHolder.current = clientA;
    const fantasma = randomUUID();
    const res = await writePool(fantasma, 'home', null, poolValido('fantasma'), SLUG_AMMESSI);
    expect(rifiuto(res, 'writePool su generazione inesistente')).toBe(404); // covers: AC-204-12
    expect(await poolDi(fantasma)).toHaveLength(0); // covers: AC-204-12
  });

  // ── AC-204-5 (writePool) ────────────────────────────────────────────────────
  // covers: AC-204-5
  it('writePool con variante fuori 0..4 e rifiutato PRIMA del DB (nessuna richiesta parte); null, 0 e 4 sono accettati', async () => {
    const registro: Richiesta[] = [];
    clientHolder.current = await clientMisurato(clientA, registro);

    for (const fuoriScala of [5, -1, 1.5, Number.NaN]) {
      registro.length = 0;
      const res = await writePool(
        gPoolBase,
        'home',
        fuoriScala,
        poolValido('scala'),
        SLUG_AMMESSI,
      );
      expect(rifiuto(res, `writePool con variante ${fuoriScala}`)).toBe(400); // covers: AC-204-5
      // La PROVA che il rifiuto precede il DB non e l'esito ma il TRASPORTO: nessuna
      // richiesta a PostgREST e partita.
      expect(registro, `variante ${fuoriScala}`).toHaveLength(0); // covers: AC-204-5
    }
    // Anche uno scope inventato non raggiunge il DB.
    registro.length = 0;
    const scopeIgnoto = await writePool(
      gPoolBase,
      'ovunque',
      null,
      poolValido('scope'),
      SLUG_AMMESSI,
    );
    expect(rifiuto(scopeIgnoto, 'writePool con scope inventato')).toBe(400); // covers: AC-204-5
    expect(registro).toHaveLength(0); // covers: AC-204-5

    // BORDI AMMESSI: 0 e 4 (e il pool CONDIVISO, null, gia scritto sopra) passano.
    const zero = await writePool(gPoolBase, 'home', 0, poolValido('v0'), SLUG_AMMESSI);
    accettato(zero, 'writePool variante 0');
    const quattro = await writePool(gPoolBase, 'home', 4, poolValido('v4'), SLUG_AMMESSI);
    accettato(quattro, 'writePool variante 4');

    const righe = await poolDi(gPoolBase);
    const varianti = righe.map((r) => r.variant_index).sort();
    expect(righe).toHaveLength(3); // covers: AC-204-5 — condiviso + due varianti
    expect(varianti).toEqual([0, 4, null]); // covers: AC-204-5 — i bordi sono ammessi
    clientHolder.current = clientA;
  });

  // covers: AC-204-12
  // ETICHETTA CORRETTA (rilievo V-204-07): portava `covers: AC-204-1`, ma qui non c'e
  // alcuna violazione di PoolSchema — il pool e VALIDO e cio che rifiuta e il vincolo
  // UNIQUE (generation_id, scope, variant_index) NULLS NOT DISTINCT di T-200. E' il
  // terzo dei tre casi di AC-204-12.
  it('writePool sullo STESSO (generazione, scope, variante) una seconda volta e rifiutato: il pool non si sovrascrive in silenzio, e la riga non ringiovanisce', async () => {
    clientHolder.current = clientA;
    const prima = await poolDi(gPoolBase);
    const rigaPrima = await istantanea(gPoolBase);
    const res = await writePool(gPoolBase, 'home', 0, poolValido('secondo'), SLUG_AMMESSI);
    expect(rifiuto(res, 'writePool duplicato')).toBe(409); // covers: AC-204-12
    const dopo = await poolDi(gPoolBase);
    expect(dopo).toHaveLength(prima.length); // covers: AC-204-12
    const variante0 = dopo.find((r) => r.variant_index === 0);
    expect(variante0?.content).toEqual(poolValido('v0')); // covers: AC-204-12 — contenuto invariato
    // CIO CHE QUESTO TEST NON GUARDAVA (rilievo V-204-03, misurato): la prova di vita
    // veniva scritta PRIMA dell'insert, quindi il duplicato tornava 409 E RINGIOVANIVA
    // comunque la riga. Un chiamante che ritenta impediva per sempre la riconciliazione
    // di P2-D15, cioe quel sito non era piu generabile. `updated_at` appartiene al SOLO
    // ramo riuscito (AC-204-12).
    expect((await istantanea(gPoolBase)).updated_at).toBe(rigaPrima.updated_at); // covers: AC-204-12
  });

  // ── AC-204-2 ────────────────────────────────────────────────────────────────
  // covers: AC-204-2
  it("chooseVariant(G,2) porta a 'chosen' con ESATTAMENTE una pagina home; appendPages porta a 'complete' ESTENDENDO le pagine", async () => {
    clientHolder.current = clientA;

    // GIVEN: la generazione 'ready' ha un pool home (condiviso e della variante scelta).
    accettato(
      await writePool(gFlusso, 'home', null, poolValido('flusso'), SLUG_AMMESSI),
      'writePool condiviso',
    );
    accettato(
      await writePool(gFlusso, 'home', 2, poolValido('flusso-v2'), SLUG_AMMESSI),
      'writePool variante 2',
    );

    const prima = await istantanea(gFlusso);
    expect(prima.status).toBe('ready'); // covers: AC-204-2 — la partenza dichiarata
    expect(prima.chosen_variant).toBeNull(); // covers: AC-204-2

    accettato(await chooseVariant(gFlusso, 2, documentoSoloHome('flusso')), 'chooseVariant(G,2)');

    const dopoScelta = await istantanea(gFlusso);
    expect(dopoScelta.status).toBe('chosen'); // covers: AC-204-2
    expect(dopoScelta.chosen_variant).toBe(2); // covers: AC-204-2
    const docScelto = dopoScelta.document as { pages: { role: string; slug: string }[] };
    expect(docScelto.pages).toHaveLength(1); // covers: AC-204-2 — ESATTAMENTE una pagina
    expect(docScelto.pages.filter((p) => p.role === RUOLO_HOME)).toHaveLength(1); // covers: AC-204-2
    expect(docScelto.pages[0].slug).toBe('home'); // covers: AC-204-2
    expect(Date.parse(dopoScelta.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-2
    // Il documento e quello VALIDATO, non un abbozzo: la ricetta e il tema versionati ci
    // sono (P2-D21), quindi cio che e stato scritto e passato da parseDocument.
    expect((dopoScelta.document as { recipe_id: string }).recipe_id).toBe(RICETTA); // covers: AC-204-2
    expect((dopoScelta.document as { theme_id: string }).theme_id).toBe(TEMA); // covers: AC-204-2

    accettato(await appendPages(gFlusso, pagineInterne()), 'appendPages');

    const dopoAppend = await istantanea(gFlusso);
    expect(dopoAppend.status).toBe('complete'); // covers: AC-204-2
    const docFinale = dopoAppend.document as { pages: { role: string; slug: string }[] };
    expect(docFinale.pages.length).toBeGreaterThan(1); // covers: AC-204-2
    expect(docFinale.pages).toHaveLength(4); // covers: AC-204-2 — home + tre interne
    // ESTESO, non SOSTITUITO: la home congelata dalla fase 1 e ancora li, ed e la prima.
    expect(docFinale.pages[0].slug).toBe('home'); // covers: AC-204-2
    expect(docFinale.pages.filter((p) => p.role === RUOLO_HOME)).toHaveLength(1); // covers: AC-204-2
    expect(docFinale.pages.map((p) => p.slug)).toEqual([
      'home',
      'offerte',
      'offerte-speciali',
      'contatti',
    ]); // covers: AC-204-2
    // La scelta della variante sopravvive alla fase 2.
    expect(dopoAppend.chosen_variant).toBe(2); // covers: AC-204-2
    expect(Date.parse(dopoAppend.updated_at)).toBeGreaterThan(Date.parse(dopoScelta.updated_at)); // covers: AC-204-2
  });

  // covers: AC-204-2
  it('chooseVariant rifiuta un documento invalido e un documento MULTI-pagina, senza toccare la riga', async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gDoc);

    // Documento che non passa il gate (T-202): nessuna pagina di ruolo 'home'.
    const senzaHome = documentoSoloHome('doc');
    senzaHome.pages[0].role = 'faq';
    expect(rifiuto(await chooseVariant(gDoc, 1, senzaHome), 'chooseVariant senza home')).toBe(400); // covers: AC-204-2

    // Chiave sconosciuta: lo schema e strict, l'uscita del modello non si scrive grezza.
    const conChiaveIgnota = documentoSoloHome('doc') as unknown as Record<string, unknown>;
    conChiaveIgnota.script = '<script>alert(1)</script>';
    expect(
      rifiuto(await chooseVariant(gDoc, 1, conChiaveIgnota), 'chooseVariant con chiave ignota'),
    ).toBe(400); // covers: AC-204-2

    // La fase 1 congela la SOLA home: un documento gia multi-pagina non e cio che
    // chooseVariant scrive.
    expect(
      rifiuto(await chooseVariant(gDoc, 1, documentoMultiPagina('doc')), 'chooseVariant multi'),
    ).toBe(400); // covers: AC-204-2

    const dopo = await istantanea(gDoc);
    expect(dopo.status).toBe('ready'); // covers: AC-204-2
    expect(dopo.chosen_variant).toBeNull(); // covers: AC-204-2
    expect(dopo.document).toBeNull(); // covers: AC-204-2
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-204-2
  });

  // ── AC-204-5 (chooseVariant) ────────────────────────────────────────────────
  // covers: AC-204-5
  it('chooseVariant(G,5) e chooseVariant(G,-1) sono rifiutati PRIMA del DB e chosen_variant resta invariato; 0 e 4 sono accettati', async () => {
    // GIVEN mancante fino all'EMENDAMENTO P2-D23: la scelta PRETENDE il pool
    // (AC-204-10), quindi i due rami di ACCETTAZIONE in fondo hanno bisogno del pool
    // CONDIVISO. Sta qui, col client NON misurato, perche le sue richieste non entrino
    // nel registro su cui poggia la misura di AC-204-5.
    clientHolder.current = clientA;
    accettato(
      await writePool(gIndici, 'home', null, poolValido('indici'), SLUG_AMMESSI),
      'pool condiviso di gIndici',
    );
    accettato(
      await writePool(gBordo, 'home', null, poolValido('bordo'), SLUG_AMMESSI),
      'pool condiviso di gBordo',
    );

    const registro: Richiesta[] = [];
    clientHolder.current = await clientMisurato(clientA, registro);
    const prima = await istantanea(gIndici);

    for (const fuoriScala of [5, -1, 1.5, Number.NaN]) {
      registro.length = 0;
      const res = await chooseVariant(gIndici, fuoriScala, documentoSoloHome('indici'));
      expect(rifiuto(res, `chooseVariant(G,${fuoriScala})`)).toBe(400); // covers: AC-204-5
      // Nessuna richiesta a PostgREST: il rifiuto precede il DB, e il CHECK di T-200 non
      // e cio che sta difendendo (difesa in profondita, A01:2025).
      expect(registro, `variante ${fuoriScala}`).toHaveLength(0); // covers: AC-204-5
    }

    const dopoRifiuti = await istantanea(gIndici);
    expect(dopoRifiuti.chosen_variant).toBeNull(); // covers: AC-204-5 — invariato
    expect(dopoRifiuti.status).toBe('ready'); // covers: AC-204-5
    expect(dopoRifiuti.document).toBeNull(); // covers: AC-204-5
    expect(dopoRifiuti.updated_at).toBe(prima.updated_at); // covers: AC-204-5

    // BORDI AMMESSI, l'unica variabile e l'indice: 0 e 4 devono passare, altrimenti il
    // test non distinguerebbe "vincola 0..4" da "rifiuta tutto".
    clientHolder.current = clientA;
    accettato(await chooseVariant(gIndici, 0, documentoSoloHome('indici')), 'chooseVariant(G,0)');
    expect((await istantanea(gIndici)).chosen_variant).toBe(0); // covers: AC-204-5
    accettato(await chooseVariant(gBordo, 4, documentoSoloHome('bordo')), 'chooseVariant(G,4)');
    expect((await istantanea(gBordo)).chosen_variant).toBe(4); // covers: AC-204-5
  });

  // ── AC-204-6 e la macchina a stati intera ───────────────────────────────────
  // covers: AC-204-6
  it("appendPages su una generazione 'generating' e rifiutato con un errore di TRANSIZIONE e la riga resta intatta", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gPoolBase);
    expect(prima.status).toBe('generating'); // covers: AC-204-6 — la partenza dichiarata

    const res = await appendPages(gPoolBase, pagineInterne());
    // 409, non 400 e non 404: la transizione non ammessa e un errore RICONOSCIBILE e
    // distinto dalla validazione e dall'assenza della riga.
    expect(rifiuto(res, "appendPages da 'generating'")).toBe(409); // covers: AC-204-6

    const dopo = await istantanea(gPoolBase);
    expect(dopo.status).toBe('generating'); // covers: AC-204-6
    expect(dopo.document).toBeNull(); // covers: AC-204-6 — document invariato
    expect(dopo.chosen_variant).toBeNull(); // covers: AC-204-6
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-204-6 — la riga non e stata toccata
  });

  // covers: AC-204-6
  it('ogni transizione e vincolata allo stato di partenza: da ready/chosen/complete/failed solo le mosse ammesse passano', async () => {
    clientHolder.current = clientA;

    // GIVEN dell'EMENDAMENTO P2-D23, altrimenti questo test cambierebbe significato
    // senza diventare rosso: dopo AC-204-10 una chooseVariant SENZA pool e rifiutata dal
    // pool e non dalla macchina a stati — stesso 409, causa diversa. gPoolBase ha gia i
    // suoi pool e a gStato ('chosen', stato VIVO) lo si scrive qui, cosi quelle due
    // partenze misurano davvero il vincolo di STATO. Per 'complete' e 'failed' il pool
    // non e scrivibile (AC-204-9 lo vieta proprio li), quindi quelle due iterazioni
    // asseriscono il rifiuto e l'invarianza della riga senza poter distinguere quale
    // delle due guardie l'abbia prodotto: dichiarato, non nascosto.
    accettato(
      await writePool(gStato, 'home', null, poolValido('stato'), SLUG_AMMESSI),
      'pool condiviso di gStato',
    );

    // chooseVariant: ammesso SOLO da 'ready'. Le altre QUATTRO partenze del vocabolario
    // di P2-D13 sono provate una per una — la macchina a stati va esercitata contro
    // TUTTE le partenze, non contro una.
    for (const [g, stato] of [
      [gPoolBase, 'generating'],
      [gStato, 'chosen'],
      [gComplete, 'complete'],
      [gFailed, 'failed'],
    ] as const) {
      const prima = await istantanea(g);
      expect(prima.status).toBe(stato); // covers: AC-204-6
      const res = await chooseVariant(g, 3, documentoSoloHome(`stato-${stato}`));
      expect(rifiuto(res, `chooseVariant da '${stato}'`)).toBe(409); // covers: AC-204-6
      const dopo = await istantanea(g);
      expect(dopo.status).toBe(stato); // covers: AC-204-6
      expect(dopo.chosen_variant).toBe(prima.chosen_variant); // covers: AC-204-6
      expect(dopo.document).toEqual(prima.document); // covers: AC-204-6
      expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-204-6
    }

    // appendPages: ammesso SOLO da 'chosen'. 'ready' e 'complete' e 'failed' no.
    for (const [g, stato] of [
      [gAnon, 'ready'],
      [gComplete, 'complete'],
      [gFailed, 'failed'],
    ] as const) {
      const prima = await istantanea(g);
      expect(prima.status).toBe(stato); // covers: AC-204-6
      const res = await appendPages(g, pagineInterne());
      expect(rifiuto(res, `appendPages da '${stato}'`)).toBe(409); // covers: AC-204-6
      const dopo = await istantanea(g);
      expect(dopo.status).toBe(stato); // covers: AC-204-6
      expect(dopo.document).toEqual(prima.document); // covers: AC-204-6
      expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-204-6
    }
  });

  // covers: AC-204-6
  it("CONTROLLO NEGATIVO: la STESSA appendPages dallo stato GIUSTO ('chosen') e accettata e porta a 'complete'", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gChosen);
    expect(prima.status).toBe('chosen'); // covers: AC-204-6 — cambia UNA sola variabile: lo stato

    accettato(await appendPages(gChosen, pagineInterne()), "appendPages da 'chosen'");

    const dopo = await istantanea(gChosen);
    expect(dopo.status).toBe('complete'); // covers: AC-204-6
    const doc = dopo.document as { pages: { slug: string }[] };
    expect(doc.pages).toHaveLength(4); // covers: AC-204-6 — la home congelata piu tre interne
    expect(doc.pages[0].slug).toBe('home'); // covers: AC-204-6
    expect(dopo.chosen_variant).toBe(1); // covers: AC-204-6 — la variante scelta non si muove
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-6
  });

  // NESSUN `covers:` (rilievo V-204-07): questo test portava `covers: AC-204-2`, che
  // pretende "document.pages ha PIU DI UNA pagina" — cioe l'OPPOSTO di cio che qui si
  // asserisce. Non e un test cattivo, era l'etichetta a essere falsa.
  // Cio che PINNA e la politica della LISTA VUOTA dichiarata dall'EMENDAMENTO P2-D23
  // ("una lista di pagine VUOTA e un esito legittimo e la scelta e dichiarata, non
  // implicita") e dalla decisione (j) del modulo: la one-pager e un esito legittimo di
  // v1 (P2-D13) e quella generazione deve poter arrivare a 'complete' invece di restare
  // in 'chosen' per sempre. Sta qui perche cambiarla sia una scelta e non una svista.
  it("appendPages con NESSUNA pagina interna e ammesso: la one-pager arriva a 'complete' col documento invariato", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gStato);
    expect(prima.status).toBe('chosen'); // pinna: P2-D23 (lista vuota)

    accettato(await appendPages(gStato, []), 'appendPages senza pagine');

    const dopo = await istantanea(gStato);
    expect(dopo.status).toBe('complete'); // pinna: P2-D23 (lista vuota)
    const doc = dopo.document as { pages: { slug: string }[] };
    expect(doc.pages).toHaveLength(1); // pinna: P2-D23 — nulla e stato aggiunto…
    expect(doc.pages[0].slug).toBe('home'); // pinna: P2-D23 — …e nulla e stato tolto
    expect(dopo.chosen_variant).toBe(prima.chosen_variant); // pinna: P2-D23 (lista vuota)
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // pinna: P2-D23 (lista vuota)
  });

  // ── AC-204-3 ────────────────────────────────────────────────────────────────
  // covers: AC-204-3
  it('senza sessione autenticata le tre azioni falliscono con 401 e nessuna riga e scritta o modificata', async () => {
    clientHolder.current = anon;
    const prima = await istantanea(gAnon);

    expect(
      rifiuto(
        await writePool(gAnon, 'home', null, poolValido('anon'), SLUG_AMMESSI),
        'writePool anonimo',
      ),
    ).toBe(401); // covers: AC-204-3
    expect(
      rifiuto(await chooseVariant(gAnon, 0, documentoSoloHome('anon')), 'chooseVariant anonimo'),
    ).toBe(401); // covers: AC-204-3
    expect(rifiuto(await appendPages(gAnon, pagineInterne()), 'appendPages anonimo')).toBe(401); // covers: AC-204-3

    expect(await poolDi(gAnon)).toHaveLength(0); // covers: AC-204-3
    const dopo = await istantanea(gAnon);
    expect(dopo.status).toBe(prima.status); // covers: AC-204-3
    expect(dopo.chosen_variant).toBeNull(); // covers: AC-204-3
    expect(dopo.document).toBeNull(); // covers: AC-204-3
    expect(dopo.updated_at).toBe(prima.updated_at); // covers: AC-204-3

    clientHolder.current = clientA;
  });

  // ── AC-204-4 ────────────────────────────────────────────────────────────────
  // covers: AC-204-4
  it('B, che non e membro dell account di A, non puo scrivere pool ne transizionare le generazioni di A', async () => {
    const primaPool = await istantanea(gPoolCross);
    const primaReady = await istantanea(gCrossReady);
    const primaChosen = await istantanea(gCrossChosen);

    clientHolder.current = clientB;
    expect(
      rifiuto(
        await writePool(gPoolCross, 'home', null, poolValido('cross'), SLUG_AMMESSI),
        'writePool cross-tenant',
      ),
    ).toBe(404); // covers: AC-204-4 — la generazione di A non e nemmeno visibile
    expect(
      rifiuto(
        await chooseVariant(gCrossReady, 0, documentoSoloHome('cross')),
        'chooseVariant cross-tenant',
      ),
    ).toBe(404); // covers: AC-204-4
    expect(
      rifiuto(await appendPages(gCrossChosen, pagineInterne()), 'appendPages cross-tenant'),
    ).toBe(404); // covers: AC-204-4

    // ORACOLO INDIPENDENTE: nessuna riga della generazione di S e stata modificata, e
    // nessun pool di B si e ancorato alla generazione di A (FK composita + RLS).
    expect(await poolDi(gPoolCross)).toHaveLength(0); // covers: AC-204-4
    expect(await istantanea(gPoolCross)).toEqual(primaPool); // covers: AC-204-4
    expect(await istantanea(gCrossReady)).toEqual(primaReady); // covers: AC-204-4
    expect(await istantanea(gCrossChosen)).toEqual(primaChosen); // covers: AC-204-4

    // CONTROLLO NEGATIVO: cambia UNA sola variabile, il tenant. B sulle PROPRIE
    // generazioni fa esattamente le stesse cose, e riescono.
    accettato(
      await writePool(gB, 'home', null, poolValido('di-b'), SLUG_AMMESSI),
      'writePool di B sul proprio',
    );
    const poolB = await poolDi(gB);
    expect(poolB).toHaveLength(1); // covers: AC-204-4
    expect(poolB[0].account_id).toBe(accountBId); // covers: AC-204-4
    // Stesso GIVEN di AC-204-10 anche qui: senza il pool condiviso il controllo negativo
    // del tenant non potrebbe riuscire, e il test misurerebbe il pool invece del tenant.
    accettato(
      await writePool(gBReady, 'home', null, poolValido('di-b-ready'), SLUG_AMMESSI),
      'pool condiviso di B',
    );
    accettato(
      await chooseVariant(gBReady, 3, documentoSoloHome('di-b')),
      'chooseVariant di B sul proprio',
    );
    expect((await istantanea(gBReady)).chosen_variant).toBe(3); // covers: AC-204-4
    expect((await istantanea(gBReady)).status).toBe('chosen'); // covers: AC-204-4

    clientHolder.current = clientA;
  });

  // ── AC-204-7 ────────────────────────────────────────────────────────────────
  // covers: AC-204-7
  it(
    'un documento VALIDO di taglia pari a DOCUMENT_LIMITS.max_bytes attraversa davvero il client con sessione, e il documento riletto e identico',
    async () => {
      // GIVEN di AC-204-10, col client NON misurato perche le sue richieste non entrino
      // nella misura del corpo HTTP: la scelta pretende il pool condiviso.
      clientHolder.current = clientA;
      accettato(
        await writePool(gTetto, 'home', null, poolValido('tetto'), SLUG_AMMESSI),
        'pool condiviso di gTetto',
      );

      // Client con sessione REALE e trasporto MISURATO: il corpo della richiesta e cio
      // che un gateway davanti a PostgREST rifiuterebbe per taglia, quindi e cio che va
      // osservato — non lo si presume dal fatto che l'azione abbia risposto ok.
      const registro: Richiesta[] = [];
      clientHolder.current = await clientMisurato(clientA, registro);

      const documento = documentoAlTetto();
      const byte = pesoInByte(documento);
      const home = {
        recipe_id: documento.recipe_id,
        theme_id: documento.theme_id,
        pages: [documento.pages[0]],
      };
      const interne = documento.pages.slice(1);
      const bytePrimaFase = pesoInByte(home);

      // Il documento e AL tetto, non "quasi": se lo fosse solo quasi, questo AC non
      // misurerebbe cio che dice di misurare.
      expect(byte).toBe(DOCUMENT_LIMITS.max_bytes); // covers: AC-204-7

      registro.length = 0;
      accettato(await chooseVariant(gTetto, 4, home), 'chooseVariant al tetto (fase 1)');
      accettato(await appendPages(gTetto, interne), 'appendPages al tetto (fase 2)');

      const corpoMassimo = Math.max(...registro.map((r) => r.byteCorpo));
      const rapporto =
        `[AC-204-7] MISURA, non presunzione. Documento valido di ${byte} byte ` +
        `(${(byte / 1024 / 1024).toFixed(2)} MiB) = ` +
        `${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(3)}% del tetto dichiarato ` +
        `DOCUMENT_LIMITS.max_bytes=${DOCUMENT_LIMITS.max_bytes}. Fase 1 (chooseVariant, ` +
        `sola home): ${bytePrimaFase} byte. Fase 2 (appendPages, ${interne.length} pagine ` +
        `interne): il corpo della richiesta porta il documento INTERO. Corpo HTTP piu ` +
        `grande realmente inviato a /rest/v1/ e ACCETTATO dal gateway: ${corpoMassimo} byte ` +
        `(${(corpoMassimo / 1024 / 1024).toFixed(2)} MiB), su ${registro.length} richieste. ` +
        `ESITO: la scrittura al tetto RIESCE — il gateway davanti a PostgREST non la ` +
        `rifiuta per taglia, quindi il tetto NON va abbassato.`;
      console.log(rapporto);

      // Il corpo davvero inviato porta il documento intero: se il client (o un futuro
      // ripiego) spezzasse la scrittura, questo numero cadrebbe e l'AC non sarebbe piu
      // quello che dice di essere.
      expect(corpoMassimo, rapporto).toBeGreaterThanOrEqual(DOCUMENT_LIMITS.max_bytes); // covers: AC-204-7

      const dopo = await istantanea(gTetto);
      expect(dopo.status).toBe('complete'); // covers: AC-204-7
      expect(dopo.chosen_variant).toBe(4); // covers: AC-204-7
      // RILETTO IDENTICO: l'oracolo e la service_role, e il confronto e sul documento
      // INTERO, non sul suo peso.
      expect(dopo.document).toEqual(documento); // covers: AC-204-7
      expect(pesoInByte(dopo.document)).toBe(DOCUMENT_LIMITS.max_bytes); // covers: AC-204-7

      clientHolder.current = clientA;
    },
    600000,
  );

  // ── AC-204-8 (EMENDAMENTO P2-D23) ───────────────────────────────────────────
  // covers: AC-204-8
  // MISURATO prima dell'emendamento: una generazione creata con max_pages=2 accettava un
  // appendPages di 5 pagine e ne conservava 6. `max_pages` non era nemmeno fra le colonne
  // lette. E' il giunto verso P5 (piano free -> una pagina): sorvegliare l'INGRESSO del
  // tetto e non il suo USO lo rende decorativo, cioe aggirabile da chi chiama la scrittura.
  it('appendPages che supera il max_pages DELLA RIGA e rifiutato e la riga resta invariata; lo stesso pacchetto ENTRO il tetto e accettato', async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gTettoRiga);
    expect(prima.status).toBe('chosen'); // covers: AC-204-8 — la partenza dichiarata
    expect(prima.max_pages).toBe(2); // covers: AC-204-8 — il tetto DELLA RIGA

    const troppe = pagineInterne();
    // Il pacchetto sfora il tetto della RIGA e sta SOTTO quello globale: cio che rifiuta
    // non puo quindi essere DOCUMENT_LIMITS.max_pages. Senza questa distinzione il test
    // non misurerebbe il tetto che AC-204-8 nomina.
    expect(1 + troppe.length).toBeGreaterThan(prima.max_pages); // covers: AC-204-8
    expect(1 + troppe.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.max_pages); // covers: AC-204-8

    expect(rifiuto(await appendPages(gTettoRiga, troppe), 'appendPages oltre max_pages')).toBe(400); // covers: AC-204-8
    // ORACOLO INDIPENDENTE: la riga non e stata toccata, updated_at compreso.
    expect(await istantanea(gTettoRiga)).toEqual(prima); // covers: AC-204-8

    // CONTROLLO NEGATIVO: cambia UNA sola variabile, il NUMERO di pagine. Lo stesso
    // appendPages che resta ENTRO il tetto (1 + 1 = 2 = max_pages) e accettato.
    accettato(await appendPages(gTettoRiga, [troppe[0]]), 'appendPages entro max_pages');
    const dopo = await istantanea(gTettoRiga);
    expect(dopo.status).toBe('complete'); // covers: AC-204-8
    const doc = dopo.document as { pages: { slug: string }[] };
    expect(doc.pages.map((p) => p.slug)).toEqual(['home', 'offerte']); // covers: AC-204-8
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-8
  });

  // ── AC-204-9 (EMENDAMENTO P2-D23) ───────────────────────────────────────────
  // covers: AC-204-9
  // MISURATO prima dell'emendamento: un writePool su 'complete' e su 'failed' tornava ok
  // e scriveva la riga di pool. Su una generazione conclusa un pool nuovo non e
  // contenuto, e inquinamento attaccato a un artefatto gia congelato.
  it("writePool sugli stati TERMINALI ('complete' e 'failed') e rifiutato e non scrive alcun pool; sullo stato VIVO lo stesso writePool e accettato", async () => {
    clientHolder.current = clientA;

    for (const [g, stato] of [
      [gComplete, 'complete'],
      [gFailed, 'failed'],
    ] as const) {
      const prima = await istantanea(g);
      expect(prima.status).toBe(stato); // covers: AC-204-9 — la partenza dichiarata
      const res = await writePool(g, 'home', null, poolValido(`terminale-${stato}`), SLUG_AMMESSI);
      expect(rifiuto(res, `writePool su '${stato}'`), stato).toBe(409); // covers: AC-204-9
      // ORACOLO INDIPENDENTE: nessun pool si e attaccato a un artefatto gia concluso, e
      // la riga non e stata toccata.
      expect(await poolDi(g), stato).toHaveLength(0); // covers: AC-204-9
      expect(await istantanea(g), stato).toEqual(prima); // covers: AC-204-9
    }

    // CONTROLLO NEGATIVO: cambia UNA sola variabile, lo STATO. Lo stato scelto e 'ready'
    // e non 'generating': gli stati VIVI restano TUTTI ammessi (la mappa fine
    // scope->stato appartiene a T-230/T-232), e un controllo che avesse ammesso il solo
    // 'generating' sarebbe rosso qui.
    const primaVivo = await istantanea(gPoolVivo);
    expect(primaVivo.status).toBe('ready'); // covers: AC-204-9
    accettato(
      await writePool(gPoolVivo, 'home', null, poolValido('vivo'), SLUG_AMMESSI),
      'writePool su stato vivo',
    );
    const righe = await poolDi(gPoolVivo);
    expect(righe).toHaveLength(1); // covers: AC-204-9
    expect(righe[0].content).toEqual(poolValido('vivo')); // covers: AC-204-9
    expect(Date.parse((await istantanea(gPoolVivo)).updated_at)).toBeGreaterThan(
      Date.parse(primaVivo.updated_at),
    ); // covers: AC-204-9
  });

  // ── AC-204-10 (EMENDAMENTO P2-D23) ──────────────────────────────────────────
  // covers: AC-204-10
  // MISURATO prima dell'emendamento: una generazione 'ready' con ZERO righe di pool
  // accettava chooseVariant(G,4) e scriveva chosen_variant=4 — un campo che puo cosi
  // MENTIRE su quale mockup l'utente abbia davvero visto, e su cui T-233 si appoggera.
  it("chooseVariant su una generazione 'ready' SENZA alcun pool e rifiutato e la riga resta invariata; col SOLO pool CONDIVISO e accettato anche per un indice che pool proprio non ha", async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gSenzaPool);
    expect(prima.status).toBe('ready'); // covers: AC-204-10
    expect(await poolDi(gSenzaPool)).toHaveLength(0); // covers: AC-204-10 — il GIVEN: nessun pool

    const res = await chooseVariant(gSenzaPool, 3, documentoSoloHome('senza-pool'));
    expect(rifiuto(res, 'chooseVariant senza alcun pool')).toBe(409); // covers: AC-204-10
    expect(await istantanea(gSenzaPool)).toEqual(prima); // covers: AC-204-10 — riga invariata

    // CONTROLLO NEGATIVO: cambia UNA sola variabile — compare il pool CONDIVISO
    // (variant_index NULL). Di pool della variante 3 non ne esiste alcuno, ed e il caso
    // NORMALE di P2-D3: le cinque varianti nascono dal pool condiviso e solo quella
    // rigenerata ne ha uno proprio. Un controllo che pretendesse il pool della singola
    // variante romperebbe il caso normale, e sarebbe rosso qui.
    accettato(
      await writePool(gSenzaPool, 'home', null, poolValido('senza-pool'), SLUG_AMMESSI),
      'pool CONDIVISO',
    );
    const pool = await poolDi(gSenzaPool);
    expect(pool).toHaveLength(1); // covers: AC-204-10
    expect(pool[0].variant_index).toBeNull(); // covers: AC-204-10 — l'unico pool e quello condiviso
    accettato(
      await chooseVariant(gSenzaPool, 3, documentoSoloHome('senza-pool')),
      'chooseVariant col solo pool condiviso',
    );
    const dopo = await istantanea(gSenzaPool);
    expect(dopo.status).toBe('chosen'); // covers: AC-204-10
    expect(dopo.chosen_variant).toBe(3); // covers: AC-204-10
  });

  // ── AC-204-11 (EMENDAMENTO P2-D23) ──────────────────────────────────────────
  // covers: AC-204-11
  // IL BUCO CHE QUESTO TEST CHIUDE (rilievo V-204-01, MISURATO): rimuovendo INTERAMENTE
  // il gate parseDocument da appendPages la suite restava VERDE, e la mutazione scriveva
  // davvero nel documento congelato slug=["home","home"], la chiave 'script' e uno slot
  // immagine {source:'external', url:'https://evil.example/x.png'} — cioe proprio l'URL
  // di terzi che document.ts dichiara IRRAPPRESENTABILE PER TIPO. chooseVariant aveva il
  // suo controllo negativo, appendPages non ne aveva nessuno: il gate della FASE 2 ha ora
  // lo stesso oracolo di quello della fase 1.
  it('appendPages rifiuta ogni pacchetto di pagine OSTILI e la riga congelata non si muove; le stesse pagine LEGITTIME sono accettate', async () => {
    clientHolder.current = clientA;
    const prima = await istantanea(gOstile);
    // Lo stato e quello GIUSTO: cosi un rifiuto non puo essere confuso con il 409 di una
    // transizione non ammessa (AC-204-6).
    expect(prima.status).toBe('chosen'); // covers: AC-204-11

    const ostili: { nome: string; pagine: unknown[] }[] = [
      {
        nome: 'chiave sconosciuta (lo schema del documento e strict)',
        pagine: [{ ...paginaInterna('chiave-ignota', 'faq'), script: '<script>alert(1)</script>' }],
      },
      {
        // Ruolo NON home di proposito: l'unica variabile e lo SLUG, altrimenti il rifiuto
        // sarebbe attribuibile anche alla seconda home.
        nome: 'slug DUPLICATO di quello gia congelato',
        pagine: [paginaInterna('home', 'offerings')],
      },
      {
        nome: "slot immagine con URL di terzi (source 'external')",
        pagine: [paginaConImmagineDiTerzi('immagine-di-terzi')],
      },
      {
        nome: 'una SECONDA pagina di ruolo home',
        pagine: [paginaInterna('seconda-home', RUOLO_HOME)],
      },
    ];

    for (const [indice, caso] of ostili.entries()) {
      // Il pacchetto porta anche una pagina LEGITTIMA: cade INTERO, non in parte.
      const pacchetto = [paginaInterna(`compagna-${indice}`, 'contact'), ...caso.pagine];
      expect(rifiuto(await appendPages(gOstile, pacchetto), `appendPages: ${caso.nome}`)).toBe(400); // covers: AC-204-11
      // ORACOLO INDIPENDENTE dopo OGNI caso: status, document e updated_at intatti.
      expect(await istantanea(gOstile), caso.nome).toEqual(prima); // covers: AC-204-11
    }

    // IL TETTO DI BYTE, che e l'unico tetto che nessun tetto per campo limita: nove
    // pagine ciascuna VALIDA e a ogni proprio tetto, entro il tetto di PAGINE (sia della
    // riga sia globale), il cui PRODOTTO sfonda DOCUMENT_LIMITS.max_bytes.
    const oltre = pagineOltreIlTettoDiByte();
    const esteso = { recipe_id: RICETTA, theme_id: TEMA, pages: [paginaHome('ostile'), ...oltre] };
    expect(esteso.pages).toHaveLength(DOCUMENT_LIMITS.max_pages); // covers: AC-204-11 — non e il tetto globale di pagine a rifiutare
    expect(esteso.pages.length).toBeLessThanOrEqual(prima.max_pages); // covers: AC-204-11 — ne quello della riga
    expect(pesoInByte(esteso)).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-204-11 — il GIVEN, MISURATO
    expect(rifiuto(await appendPages(gOstile, oltre), 'appendPages oltre il tetto di byte')).toBe(
      400,
    ); // covers: AC-204-11
    expect(await istantanea(gOstile)).toEqual(prima); // covers: AC-204-11

    // CONTROLLO NEGATIVO: le STESSE pagine con la sola variabile ostile rimossa. Senza,
    // il test non distinguerebbe "il gate rifiuta l'ostile" da "appendPages non accetta
    // piu nulla". Per il tetto di byte il controllo negativo e AC-204-7, dove un
    // documento ESATTAMENTE al tetto viene scritto e riletto identico.
    const legittime = [
      paginaInterna('chiave-ignota', 'faq'), // la stessa, senza la chiave in piu
      paginaInterna('offerte', 'offerings'), // la stessa, con uno slug NON duplicato
      paginaInterna('immagine-di-terzi', 'reviews'), // la stessa, con l'immagine del TEMA
      paginaInterna('seconda-home', 'contact'), // la stessa, con un ruolo NON home
    ];
    accettato(await appendPages(gOstile, legittime), 'appendPages con le pagine legittime');

    const dopo = await istantanea(gOstile);
    expect(dopo.status).toBe('complete'); // covers: AC-204-11
    const doc = dopo.document as {
      pages: { slug: string; role: string; blocks: { images: { source: string }[] }[] }[];
    };
    expect(doc.pages.map((p) => p.slug)).toEqual([
      'home',
      'chiave-ignota',
      'offerte',
      'immagine-di-terzi',
      'seconda-home',
    ]); // covers: AC-204-11
    // Cio che la mutazione di V-204-01 aveva davvero scritto nel documento congelato, e
    // che ora non ci puo essere: slug duplicati, chiavi fuori schema, home multiple e
    // sorgenti immagine fuori dall'unione discriminata.
    expect(new Set(doc.pages.map((p) => p.slug)).size).toBe(doc.pages.length); // covers: AC-204-11
    expect(doc.pages.filter((p) => p.role === RUOLO_HOME)).toHaveLength(1); // covers: AC-204-11
    expect(doc.pages.some((p) => 'script' in p)).toBe(false); // covers: AC-204-11
    const sorgenti = [
      ...new Set(
        doc.pages
          .flatMap((p) => p.blocks)
          .flatMap((b) => b.images)
          .map((immagine) => immagine.source),
      ),
    ].sort();
    expect(sorgenti).toEqual(['theme-placeholder', 'uploaded']); // covers: AC-204-11
    expect(Date.parse(dopo.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-11
  });

  // ── AC-204-12 (EMENDAMENTO P2-D23) ──────────────────────────────────────────
  // covers: AC-204-12
  it('un generationId malformato e rifiutato con ZERO richieste, un uuid inesistente con una richiesta e 404, e la prova di vita e del SOLO ramo riuscito', async () => {
    const registro: Richiesta[] = [];
    clientHolder.current = await clientMisurato(clientA, registro);
    const prima = await istantanea(gVita);
    expect(prima.status).toBe('generating'); // covers: AC-204-12 — lo stato in cui la prova di vita conta

    // Malformato E OSTILE: il payload e un tentativo di PostgREST filter injection
    // (A05:2025). La DoD chiede che generationId sia validato PRIMA di qualunque
    // round-trip, e vale per tutte e tre le azioni.
    const ID_OSTILE = "0000' or generation_id=eq.*--";
    const chiamate: [string, () => Promise<Esito>][] = [
      ['writePool', () => writePool(ID_OSTILE, 'home', null, poolValido('ostile'), SLUG_AMMESSI)],
      ['chooseVariant', () => chooseVariant(ID_OSTILE, 0, documentoSoloHome('ostile'))],
      ['appendPages', () => appendPages(ID_OSTILE, pagineInterne())],
    ];
    for (const [nome, chiamata] of chiamate) {
      registro.length = 0;
      expect(rifiuto(await chiamata(), `${nome} con generationId malformato`), nome).toBe(400); // covers: AC-204-12
      // La PROVA che il rifiuto precede il DB e il TRASPORTO, non l'esito: prima l'id
      // malformato costava un round-trip e tornava 500 — cioe un guasto — dove un uuid
      // inesistente torna 404, due risposte diverse per lo stesso "non c'e".
      expect(registro, nome).toHaveLength(0); // covers: AC-204-12
    }

    // L'uuid ben formato ma INESISTENTE: risorsa assente, e una richiesta parte davvero.
    // E' cio che rende i due casi DISTINGUIBILI invece di confonderli.
    const fantasma = randomUUID();
    registro.length = 0;
    expect(
      rifiuto(
        await writePool(fantasma, 'home', null, poolValido('fantasma-2'), SLUG_AMMESSI),
        'writePool su uuid inesistente',
      ),
    ).toBe(404); // covers: AC-204-12
    expect(registro.length).toBeGreaterThan(0); // covers: AC-204-12
    expect(await poolDi(fantasma)).toHaveLength(0); // covers: AC-204-12
    // Nessuno dei due rifiuti ha toccato la generazione che il chiamante sta usando.
    expect(await istantanea(gVita)).toEqual(prima); // covers: AC-204-12

    // IL RAMO RIUSCITO E' IL SOLO CHE SCRIVE LA PROVA DI VITA, e il terzo rifiuto — il
    // duplicato sulla stessa terna — la misura SULLA STESSA RIGA.
    clientHolder.current = clientA;
    accettato(
      await writePool(gVita, 'home', null, poolValido('vita'), SLUG_AMMESSI),
      'writePool su gVita',
    );
    const dopoSuccesso = await istantanea(gVita);
    expect(Date.parse(dopoSuccesso.updated_at)).toBeGreaterThan(Date.parse(prima.updated_at)); // covers: AC-204-12

    expect(
      rifiuto(
        await writePool(gVita, 'home', null, poolValido('vita-2'), SLUG_AMMESSI),
        'writePool duplicato su gVita',
      ),
    ).toBe(409); // covers: AC-204-12
    // LA MISURA DI V-204-03: la riga RINGIOVANIVA a ogni rifiuto, quindi motivoStantio
    // non sarebbe scattato MAI e l'indice UNIQUE parziale sarebbe rimasto occupato per
    // sempre — il sito non piu generabile di P2-D15.
    expect((await istantanea(gVita)).updated_at).toBe(dopoSuccesso.updated_at); // covers: AC-204-12
    const righe = await poolDi(gVita);
    expect(righe).toHaveLength(1); // covers: AC-204-12
    expect(righe[0].content).toEqual(poolValido('vita')); // covers: AC-204-12
  });
});
