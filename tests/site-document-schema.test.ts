import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { BRIEF_LIMITS, BriefUpdateSchema } from '@/domain/onboarding/brief';
import { POOL_LIMITS } from '@/domain/generation/pool';
import { SLOTS, type PageRole } from '@/domain/generation/slots';
import {
  DOCUMENT_LIMITS,
  SiteDocumentSchema,
  parseDocument,
  type ImageSlot,
  type SiteBlock,
  type SiteDocument,
  type SitePage,
} from '@/domain/generation/document';

// T-202 (P2, macrotask generation-model) — SiteDocumentSchema + DOCUMENT_LIMITS +
// parseDocument. Le asserzioni derivano dagli acceptance_criteria AC-202-1..12
// (docs/blueprint/P2-generation/01-generation-model.md, emendato da P2-D21). Dominio
// PURO: nessun DB, nessun client Supabase, nessuna rete.
//
// UNA DIFESA DI QUESTO TASK NON E' UN CONTROLLO, E' UN'IMPOSSIBILITA' DI
// RAPPRESENTAZIONE (P2-D12): lo slot immagine e' un'unione discriminata su `source` con
// DUE varianti e nessun campo che possa contenere un URL. Non esiste il posto dove
// mettere un `photo_ref` di terzi, quindi nessun bug di rendering futuro puo' farlo
// diventare un attributo di rete. Le asserzioni qui sotto sorvegliano proprio questo: la
// cardinalita' delle varianti, l'insieme ESATTO delle chiavi di ciascuna, e
// l'inesistenza del campo NEL TIPO (`@ts-expect-error`, cioe' un oracolo a
// compilazione che diventa rosso il giorno in cui qualcuno aggiunge `src`).
//
// E FIN DOVE ARRIVA, CHE E' L'ALTRA META' DELLA VERITA' (P2-D21 / AC-202-10): quel
// ragionamento copre lo slot immagine e photo_ref, NON il documento intero. I dati del
// brief resi direttamente portano campi di testo libero che un URL lo accettano, e
// `social_links` e' fatto apposta per portarne uno: resta nel documento, ed e' PINNATO
// dal test invece di essere affidato a un commento, perche' la difesa su quel link e'
// una precondizione dichiarata su T-237 (validatore del campo) e T-241 (asserzione
// sull'effetto), non una conseguenza di questo schema.
//
// Disciplina delle fixture (spec di design §9, e tre difetti ripetuti in P1): mai un
// solo elemento — piu' pagine, piu' blocchi per pagina, piu' slot immagine per blocco —
// e valori tutti DISCORDANTI, cosi' che due pagine o due blocchi scambiati non passino
// inosservati. Gli identificatori includono coppie in cui uno e' PREFISSO dell'altro
// (slug `offerte` / `offerte-speciali`, blocchi `hero` / `hero-2`): un controllo di
// unicita' scritto con startsWith invece che con uguaglianza deve morire qui.

/** URL di terzi: il valore che NON deve poter esistere nello slot immagine ne in photo_ref. */
const OSTILE = 'https://evil.example/x.png';
/** Marcatore dei valori che non devono sopravvivere perche' sotto una chiave sconosciuta. */
const SCONOSCIUTO = 'VALORE-SOTTO-CHIAVE-SCONOSCIUTA';

/**
 * Gli alfabeti del riempimento. La differenza fra loro e' TUTTO il punto di AC-202-7: i
 * tetti per campo contano code unit UTF-16, il tetto totale conta byte UTF-8.
 * - ASCII: 1 code unit, 1 byte.
 * - accentate di italiano e spagnolo (i due locale del prodotto): 1 code unit, 2 byte.
 * - ideogrammi CJK: 1 code unit, 3 byte — e NON sono un locale del prodotto.
 */
const ACCENTATE = 'àèéìíòóùúñü';
const IDEOGRAMMI = '漢字日本語中文';

/** Il vocabolario dei locale, letto dal brief e non ricopiato: e' cio' che il prodotto serve. */
const LOCALI = BriefUpdateSchema.shape.locale.unwrap().options;

/** Stringa lunga ESATTAMENTE `limite` code unit, col `tag` in testa e `alfabeto` a seguire. */
function stringaCon(alfabeto: string, limite: number, tag: string): string {
  if (tag.length > limite) throw new Error(`tag '${tag}' piu lungo del tetto ${limite}`);
  let out = tag;
  for (let i = 0; i < limite - tag.length; i += 1) out += alfabeto[i % alfabeto.length];
  return out;
}

/** Il riempimento di una stringa al tetto: e' il parametro del caso peggiore (AC-202-7). */
type Riempimento = (limite: number, tag: string) => string;

/** Stringa lunga ESATTAMENTE `limite` code unit, riconoscibile dal suo `tag`. */
function stringaAlTetto(limite: number, tag: string): string {
  return stringaCon('x', limite, tag);
}

function stringaAccentata(limite: number, tag: string): string {
  return stringaCon(ACCENTATE, limite, tag);
}

function stringaIdeogrammi(limite: number, tag: string): string {
  return stringaCon(IDEOGRAMMI, limite, tag);
}

function items<T>(quanti: number, make: (indice: number) => T): T[] {
  return Array.from({ length: quanti }, (_unused, indice) => make(indice));
}

/** Byte della serializzazione JSON (UTF-8): la misura di AC-202-6 e AC-202-7. */
function pesoInByte(valore: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valore)).length;
}

// Le fixture sono volutamente LASCHE nel tipo: devono poter portare sorgenti immagine
// non ammesse, chiavi sconosciute e slug duplicati — cioe' esattamente cio' che il
// gate deve rifiutare, e che un tipo stretto renderebbe impossibile scrivere.
type SlotFixture = Record<string, unknown>;
type BloccoFixture = {
  id: string;
  content: Record<string, unknown>;
  data: Record<string, unknown>;
  brief_fields_rendered: string[];
  images: SlotFixture[];
};
type PaginaFixture = {
  slug: string;
  role: string;
  title: string;
  meta_description: string;
  blocks: BloccoFixture[];
};
type DocumentoFixture = { recipe_id: string; theme_id: string; pages: PaginaFixture[] };

/** Un uuid valido e riconoscibile: l'asset_id della variante 'uploaded'. */
function assetId(indice: number): string {
  return `0000000${indice}-0000-4000-8000-00000000000${indice}`;
}

// Gli id VERSIONATI della ricetta e del tema (AC-202-8). I due valori sono DISCORDANTI
// fra loro: se lo schema li scambiasse, o se ne leggesse uno al posto dell'altro, le
// asserzioni di identita' lo vedrebbero.
const RICETTA = 'aurora-lineare@3';
const TEMA = 'terracotta-chiara@7';

/** Il ruolo che il documento deve sempre avere (AC-202-9), tipizzato sul catalogo. */
const RUOLO_HOME: PageRole = 'home';

/** Il documento intorno a un insieme di pagine: la cornice che ogni fixture condivide. */
function documentoDi(pages: PaginaFixture[]): DocumentoFixture {
  return { recipe_id: RICETTA, theme_id: TEMA, pages };
}

/** Un id versionato ben formato lungo ESATTAMENTE `lunghezza` code unit. */
function idVersionato(lunghezza: number, tag: string): string {
  return `${stringaAlTetto(lunghezza - 2, tag)}@9`;
}

/**
 * La home: DUE blocchi con contenuti discordanti, e id in cui uno e' PREFISSO
 * dell'altro (`hero` / `hero-2`). Il primo blocco porta DUE slot immagine
 * theme-placeholder con token diversi, il secondo uno slot 'uploaded': entrambe le
 * varianti dell'unione sono esercitate dal documento valido, non solo dai casi ostili.
 */
function paginaHome(): PaginaFixture {
  return {
    slug: 'home',
    role: 'home',
    title: 'Panificio Aurora — pane a lievitazione naturale in via Roma',
    meta_description: 'Il pane a lievitazione naturale di via Roma, sfornato tre volte al giorno.',
    blocks: [
      {
        id: 'hero',
        content: {
          hero_title_kicker: 'Panificio dal 1953',
          hero_title: 'Il pane a lievitazione naturale di via Roma',
          hero_subtitle: 'Sfornato tre volte al giorno, mai il giorno prima.',
        },
        data: { business_name: 'Panificio Aurora' },
        brief_fields_rendered: ['business_name'],
        images: [
          { source: 'theme-placeholder', token: 'hero-wide' },
          { source: 'theme-placeholder', token: 'hero-portrait' },
        ],
      },
      {
        // 'hero' e' PREFISSO di 'hero-2': un confronto scritto con startsWith o
        // includes invece che con uguaglianza confonderebbe i due blocchi.
        id: 'hero-2',
        content: {
          about_title: 'Chi siamo',
          about_body: 'Tre generazioni dietro lo stesso banco, dal 1953.',
          about_points: ['Lievito madre rinfrescato ogni notte', 'Farine macinate a pietra'],
        },
        data: { highlights: ['Forno a legna', 'Consegna in centro entro le undici'] },
        brief_fields_rendered: ['highlights'],
        images: [{ source: 'uploaded', asset_id: assetId(1) }],
      },
    ],
  };
}

/**
 * Una pagina interna: ogni valore porta lo slug, quindi due pagine non condividono mai
 * ne il titolo, ne la meta description, ne il contenuto dei blocchi. Se il parse
 * scambiasse due pagine o due blocchi, le asserzioni di identita' lo vedrebbero.
 */
function paginaInterna(slug: string, role: string): PaginaFixture {
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
      {
        // Anche qui una coppia di id in cui uno e' prefisso dell'altro.
        id: `${slug}-blocco-2`,
        content: { offerings_intro: `Introduzione secondaria di ${slug}` },
        data: { phone: `+39 000 ${slug}` },
        brief_fields_rendered: ['phone'],
        images: [
          { source: 'theme-placeholder', token: `texture-${slug}` },
          { source: 'uploaded', asset_id: assetId(2) },
        ],
      },
    ],
  };
}

/** One-pager: la sola home. E' la forma della fase 1 (P2-D13). */
function documentoOnePager(): DocumentoFixture {
  return documentoDi([paginaHome()]);
}

/**
 * Multi-pagina: OTTO pagine (AC-202-1), con due slug in cui uno e' PREFISSO dell'altro
 * (`offerte` / `offerte-speciali`) e due pagine che condividono il RUOLO ma non lo
 * slug: e' lo slug a dover essere univoco, non il ruolo.
 */
function documentoMultiPagina(): DocumentoFixture {
  return documentoDi([
    paginaHome(),
    paginaInterna('offerte', 'offerings'),
    paginaInterna('offerte-speciali', 'offerings'),
    paginaInterna('orari', 'hours'),
    paginaInterna('contatti', 'contact'),
    paginaInterna('recensioni', 'reviews'),
    paginaInterna('domande-frequenti', 'faq'),
    paginaInterna('chi-siamo', 'home'),
  ]);
}

/** Il documento tipizzato, o un fallimento leggibile del test (mai un `any`). */
function accettato(res: ReturnType<typeof parseDocument>): SiteDocument {
  if (!res.ok) throw new Error(`il documento doveva validare: ${JSON.stringify(res.error.issues)}`);
  return res.document;
}

/** Gli issue del rifiuto, o un fallimento leggibile del test. */
function rifiutato(res: ReturnType<typeof parseDocument>) {
  if (res.ok) throw new Error(`il documento NON doveva validare: ${JSON.stringify(res.document)}`);
  return res.error.issues;
}

/**
 * Cio' che parseDocument restituisce davvero, serializzato: il documento se accettato,
 * gli issue se rifiutato. Serve alle asserzioni "l'URL ostile non compare nel
 * risultato", che sono piu' forti di "c'e' stato un errore".
 */
function serializza(res: ReturnType<typeof parseDocument>): string {
  return JSON.stringify(res.ok ? res.document : res.error.issues);
}

function paginaDi(documento: SiteDocument, slug: string): SitePage {
  const pagina = documento.pages.find((p) => p.slug === slug);
  if (!pagina) throw new Error(`pagina '${slug}' assente dal documento`);
  return pagina;
}

function bloccoDi(pagina: SitePage, id: string): SiteBlock {
  const blocco = pagina.blocks.find((b) => b.id === id);
  if (!blocco) throw new Error(`blocco '${id}' assente dalla pagina '${pagina.slug}'`);
  return blocco;
}

/**
 * L'unione dello slot immagine COME LA RAGGIUNGE IL DOCUMENTO, camminando dallo schema
 * esportato: documento -> pagine -> blocchi -> immagini. Ispezionare un'unione
 * esportata a parte proverebbe qualcosa su uno schema qualunque; questa cammina la sola
 * strada che i dati percorrono davvero, quindi sostituire l'unione dentro il blocco con
 * qualcos'altro non puo' restare invisibile.
 */
function unioneSlotImmagine() {
  return SiteDocumentSchema.innerType().shape.pages.element.shape.blocks.element.shape.images
    .element;
}

const documentSource = readFileSync(
  new URL('../src/domain/generation/document.ts', import.meta.url),
  'utf8',
);

describe('T-202 DOCUMENT_LIMITS — i tetti vivono in una sola definizione', () => {
  // definition_of_done p.4 e p.6 — i tetti richiesti esistono, con nomi e VALORI
  // pinnati a mano. E' l'unico punto del file che non deriva dal modulo, ed e'
  // deliberato: alzare un tetto (max_bytes su tutti) e' una decisione, non un
  // dettaglio di implementazione, e deve costare un test rosso.
  it('dichiara i tetti su pagine, titoli, meta description e peso, con i valori pinnati', () => {
    expect(DOCUMENT_LIMITS).toEqual({
      max_pages: 10,
      page_slug: 80,
      page_title: 120,
      meta_description: 320,
      blocks_per_page: 12,
      block_id: 64,
      images_per_block: 8,
      image_token: 48,
      versioned_id: 64,
      error_issues: 24,
      error_chars: 120,
      max_bytes: 8388608,
    });

    for (const [nome, valore] of Object.entries(DOCUMENT_LIMITS)) {
      expect(Number.isInteger(valore), `${nome} deve essere un intero`).toBe(true);
      expect(valore, `${nome} deve essere positivo`).toBeGreaterThan(0);
    }

    // AC-202-1 chiede un documento di OTTO pagine: il tetto deve ammetterlo.
    expect(DOCUMENT_LIMITS.max_pages).toBeGreaterThanOrEqual(8);

    // AC-202-11 — "gli stessi tetti dichiarati per parsePool". I due moduli hanno
    // costanti PROPRIE (il test di T-201 pinna l'insieme esatto delle chiavi di
    // POOL_LIMITS, quindi spostarle non e' un'opzione) ma condividono la funzione che
    // limita: qui si asserisce che i NUMERI non sono divergiti, perche' T-204 traduce i
    // due errori nella stessa colonna failure_reason.
    expect(DOCUMENT_LIMITS.error_issues).toBe(POOL_LIMITS.error_issues); // covers: AC-202-11
    expect(DOCUMENT_LIMITS.error_chars).toBe(POOL_LIMITS.error_chars); // covers: AC-202-11
  });

  // Nessun tetto scritto a mano dentro uno .max(): i numeri stanno in DOCUMENT_LIMITS
  // (o nei tetti ereditati da POOL_LIMITS e BRIEF_LIMITS), mai duplicati nello schema.
  it('nessun numero letterale compare in uno .max() del sorgente', () => {
    expect(documentSource).not.toMatch(/\.max\(\s*\d/);
  });
});

describe('T-202 il vocabolario dei ruoli di pagina e quello del catalogo (T-201)', () => {
  // Arbitrato: il `role` DEVE usare il vocabolario di slots.ts, non una copia. Il
  // Record qui sotto e' un oracolo A COMPILAZIONE: se PageRole guadagnasse o perdesse
  // un ruolo, `satisfies Record<PageRole, PageRole>` non sarebbe piu' soddisfatto e il
  // typecheck sarebbe rosso — cioe' due vocabolari divergenti non possono passare.
  const RUOLI_ATTESI = {
    home: 'home',
    offerings: 'offerings',
    hours: 'hours',
    contact: 'contact',
    reviews: 'reviews',
    faq: 'faq',
  } satisfies Record<PageRole, PageRole>;

  // Il ruolo sotto esame e' quello della SECONDA pagina, non della prima: la home deve
  // restare (AC-202-9), quindi una one-pager di ruolo 'faq' sarebbe rifiutata per la
  // home mancante e non per il vocabolario, e questo test proverebbe l'AC sbagliato.
  it('accetta esattamente i ruoli del catalogo degli slot e nessun altro', () => {
    const ruoliDelCatalogo = [...new Set(SLOTS.map((slot) => slot.page_role))].sort();
    expect(ruoliDelCatalogo).toEqual(Object.keys(RUOLI_ATTESI).sort());

    for (const ruolo of Object.values(RUOLI_ATTESI)) {
      const doc = documentoMultiPagina();
      doc.pages[1].role = ruolo;
      expect(parseDocument(doc).ok, `ruolo ${ruolo}`).toBe(true);
    }

    // Un ruolo fuori vocabolario e' rifiutato: 'blog' e 'homepage' (che CONTIENE
    // 'home' come prefisso) non sono ruoli, e un confronto per prefisso li ammetterebbe.
    for (const ruolo of ['blog', 'homepage', 'Home', 'admin']) {
      const doc = documentoMultiPagina();
      doc.pages[1].role = ruolo;
      const res = parseDocument(doc);
      expect(res.ok, `ruolo ${ruolo}`).toBe(false);
      const invalido = rifiutato(res).find((issue) => issue.path.includes('role'));
      expect(invalido?.code, `ruolo ${ruolo}`).toBe('invalid_enum_value');
    }
  });

  it('il ruolo del documento tipizzato E un PageRole (identita di tipo, non copia)', () => {
    const documento = accettato(parseDocument(documentoMultiPagina()));
    // Assegnamento senza cast: se lo schema restituisse `string` (vocabolario aperto)
    // o un'unione piu' larga di PageRole, questa riga non compilerebbe.
    const ruolo: PageRole = paginaDi(documento, 'offerte').role;
    expect(ruolo).toBe('offerings');
  });
});

describe('T-202 parseDocument — one-pager e multi-pagina sono la stessa forma', () => {
  // covers: AC-202-1
  it('accetta il documento con la sola home e lo restituisce tipizzato e identico', () => {
    const input = documentoOnePager();
    const res = parseDocument(input);

    expect(res.ok).toBe(true); // covers: AC-202-1
    const documento: SiteDocument = accettato(res); // covers: AC-202-1 — il risultato e' TIPIZZATO
    expect(documento).toEqual(input); // covers: AC-202-1 — nessun valore perso o alterato

    // ...E NON E' L'OGGETTO D'INGRESSO (AC-202-12: "il risultato e' una COPIA validata,
    // non l'oggetto d'ingresso"). `toEqual` da solo e' verde anche se il gate
    // restituisse `input` tale e quale, cioe' se saltasse la copia che zod costruisce
    // campo per campo: sarebbe un `ok: true` su un valore che non e' passato dalla
    // validazione, e nessun test lo vedrebbe. La non-identita' e' asserita fin dentro il
    // primo slot immagine, che e' l'oggetto piu' annidato del documento.
    expect(documento).not.toBe(input); // covers: AC-202-12
    expect(documento.pages).not.toBe(input.pages); // covers: AC-202-12
    expect(documento.pages[0]).not.toBe(input.pages[0]); // covers: AC-202-12
    expect(documento.pages[0].blocks[0].images[0]).not.toBe(input.pages[0].blocks[0].images[0]); // covers: AC-202-12

    expect(documento.pages).toHaveLength(1); // covers: AC-202-1
    expect(documento.pages[0].slug).toBe('home'); // covers: AC-202-1
    expect(documento.pages[0].role).toBe('home'); // covers: AC-202-1

    // I DUE blocchi restano distinti: id l'uno prefisso dell'altro, contenuti diversi.
    const pagina = paginaDi(documento, 'home');
    expect(pagina.blocks).toHaveLength(2); // covers: AC-202-1
    expect(bloccoDi(pagina, 'hero').content.hero_title).toBe(
      'Il pane a lievitazione naturale di via Roma',
    ); // covers: AC-202-1
    expect(bloccoDi(pagina, 'hero-2').content.about_title).toBe('Chi siamo'); // covers: AC-202-1
    expect(bloccoDi(pagina, 'hero').content).not.toEqual(bloccoDi(pagina, 'hero-2').content); // covers: AC-202-1

    // Le due varianti dell'unione immagine convivono nello stesso documento valido.
    const immaginiHero = bloccoDi(pagina, 'hero').images;
    expect(immaginiHero).toHaveLength(2); // covers: AC-202-1
    expect(immaginiHero.map((img) => img.source)).toEqual([
      'theme-placeholder',
      'theme-placeholder',
    ]); // covers: AC-202-1
    expect(bloccoDi(pagina, 'hero-2').images[0].source).toBe('uploaded'); // covers: AC-202-1
  });

  // covers: AC-202-1
  it('accetta il documento di OTTO pagine con la stessa forma, e non scambia pagine ne blocchi', () => {
    const input = documentoMultiPagina();
    const res = parseDocument(input);

    expect(res.ok).toBe(true); // covers: AC-202-1
    const documento: SiteDocument = accettato(res); // covers: AC-202-1
    expect(documento).toEqual(input); // covers: AC-202-1
    expect(documento.pages).toHaveLength(8); // covers: AC-202-1

    // L'ordine e l'identita' delle pagine sopravvivono, compresa la coppia di slug in
    // cui uno e' PREFISSO dell'altro.
    expect(documento.pages.map((pagina) => pagina.slug)).toEqual([
      'home',
      'offerte',
      'offerte-speciali',
      'orari',
      'contatti',
      'recensioni',
      'domande-frequenti',
      'chi-siamo',
    ]); // covers: AC-202-1
    expect(paginaDi(documento, 'offerte').title).toBe('Titolo della pagina offerte'); // covers: AC-202-1
    expect(paginaDi(documento, 'offerte-speciali').title).toBe(
      'Titolo della pagina offerte-speciali',
    ); // covers: AC-202-1
    expect(paginaDi(documento, 'offerte').title).not.toBe(
      paginaDi(documento, 'offerte-speciali').title,
    ); // covers: AC-202-1

    // Due pagine possono condividere il RUOLO: e' lo slug a essere univoco.
    expect(paginaDi(documento, 'offerte').role).toBe('offerings'); // covers: AC-202-1
    expect(paginaDi(documento, 'offerte-speciali').role).toBe('offerings'); // covers: AC-202-1

    // La stessa FORMA vale per i due documenti: lo schema esportato accetta entrambi.
    expect(SiteDocumentSchema.safeParse(documentoOnePager()).success).toBe(true); // covers: AC-202-1
    expect(SiteDocumentSchema.safeParse(input).success).toBe(true); // covers: AC-202-1
  });

  // covers: AC-202-3
  it('rifiuta pages=[]: la home esiste sempre — e accetta lo stesso documento con la sola home', () => {
    const vuoto: DocumentoFixture = documentoDi([]);
    const res = parseDocument(vuoto);

    expect(res.ok).toBe(false); // covers: AC-202-3
    const troppoPoche = rifiutato(res).find((issue) => issue.path.includes('pages'));
    if (troppoPoche?.code !== 'too_small') throw new Error('atteso un too_small su pages');
    expect(troppoPoche.path).toEqual(['pages']); // covers: AC-202-3
    expect(troppoPoche.minimum).toBe(1); // covers: AC-202-3 — almeno una pagina

    // Gemello ACCETTATO: cambia UNA sola variabile, la presenza della home.
    const conHome = accettato(parseDocument(documentoOnePager())); // covers: AC-202-3
    expect(conHome.pages).toHaveLength(1); // covers: AC-202-3
  });

  // definition_of_done p.4 — il tetto sul NUMERO di pagine: al tetto accettato, a
  // tetto+1 rifiutato. Senza questo, max_pages sarebbe una costante decorativa.
  it('accetta esattamente DOCUMENT_LIMITS.max_pages pagine e rifiuta la successiva', () => {
    const alTetto: DocumentoFixture = documentoDi(
      items(DOCUMENT_LIMITS.max_pages, (i) =>
        i === 0 ? paginaHome() : paginaInterna(`pagina-${i}`, 'offerings'),
      ),
    );
    expect(parseDocument(alTetto).ok).toBe(true);

    const oltre: DocumentoFixture = documentoDi([
      ...alTetto.pages,
      paginaInterna('pagina-di-troppo', 'faq'),
    ]);
    const res = parseDocument(oltre);
    expect(res.ok).toBe(false);
    const troppePagine = rifiutato(res).find((issue) => issue.path.includes('pages'));
    if (troppePagine?.code !== 'too_big') throw new Error('atteso un too_big su pages');
    expect(troppePagine.maximum).toBe(DOCUMENT_LIMITS.max_pages);
  });
});

describe('T-202 unicita dello slug nel documento', () => {
  // covers: AC-202-2
  it('rifiuta due pagine con lo STESSO slug, indicando la seconda occorrenza', () => {
    const duplicato = documentoMultiPagina();
    // Una sola variabile cambia rispetto al documento accettato: lo slug della terza
    // pagina diventa uguale a quello della seconda. Titolo e contenuti restano
    // DISCORDANTI, quindi il rifiuto non puo' venire da altro.
    duplicato.pages[2].slug = 'offerte';
    const res = parseDocument(duplicato);

    expect(res.ok).toBe(false); // covers: AC-202-2
    const issues = rifiutato(res);
    const doppio = issues.find((issue) => issue.path.includes('slug'));
    if (doppio?.code !== 'custom') throw new Error('atteso un issue custom sullo slug duplicato');
    expect(doppio.path).toEqual(['pages', 2, 'slug']); // covers: AC-202-2 — la SECONDA occorrenza
    expect(doppio.message).toContain('duplicat'); // covers: AC-202-2 — dice che e' un duplicato
    // Il percorso INDICA lo slug duplicato: quella posizione porta proprio 'offerte'.
    expect(duplicato.pages[Number(doppio.path[1])].slug).toBe('offerte'); // covers: AC-202-2

    // La PRIMA occorrenza (l'originale) non e' incolpata: l'errore dice quale pagina e'
    // di troppo, non che tutte e due lo siano.
    expect(issues.filter((issue) => issue.path.includes('slug'))).toHaveLength(1); // covers: AC-202-2
    expect(issues.every((issue) => issue.path[1] !== 1)).toBe(true); // covers: AC-202-2
  });

  // covers: AC-202-2
  it('due slug in cui uno e PREFISSO dell altro sono DUE pagine, e il documento e accettato', () => {
    // Il gemello ACCETTATO che differisce per UNA sola variabile: 'offerte' contro
    // 'offerte-speciali'. Un'unicita' scritta con startsWith/includes invece che con
    // uguaglianza rifiuterebbe questo documento, che e' legittimo.
    const documento = accettato(parseDocument(documentoMultiPagina())); // covers: AC-202-2
    const slugs = documento.pages.map((pagina) => pagina.slug);
    expect(slugs).toContain('offerte'); // covers: AC-202-2
    expect(slugs).toContain('offerte-speciali'); // covers: AC-202-2
    expect(new Set(slugs).size).toBe(slugs.length); // covers: AC-202-2

    // E il verso opposto dell'ordine, perche' un controllo che guarda solo indietro (o
    // solo avanti) sia esercitato in entrambi i sensi.
    const invertito: DocumentoFixture = documentoDi([
      paginaHome(),
      paginaInterna('offerte-speciali', 'offerings'),
      paginaInterna('offerte', 'offerings'),
    ]);
    expect(parseDocument(invertito).ok).toBe(true); // covers: AC-202-2
  });

  // covers: AC-202-2
  it('rifiuta il duplicato anche quando le due pagine sono lontane e di ruolo diverso', () => {
    const duplicato = documentoMultiPagina();
    duplicato.pages[7].slug = 'home'; // l'ultima pagina ruba lo slug della prima
    const res = parseDocument(duplicato);

    expect(res.ok).toBe(false); // covers: AC-202-2
    const doppio = rifiutato(res).find((issue) => issue.path.includes('slug'));
    expect(doppio?.path).toEqual(['pages', 7, 'slug']); // covers: AC-202-2
    expect(duplicato.pages[7].slug).toBe('home'); // covers: AC-202-2
  });
});

describe('T-202 la HOME e IMPOSTA, non solo dichiarata (AC-202-9)', () => {
  // covers: AC-202-9
  it("rifiuta il documento la cui unica pagina ha ruolo 'faq' e accetta lo stesso con ruolo 'home'", () => {
    // I due documenti differiscono per UNA sola variabile: il ruolo di quella pagina.
    // Slug, titolo, meta description e blocchi sono identici, quindi il rifiuto non puo'
    // venire da altro. Prima di P2-D21 "la home esiste sempre" era scritta in tre punti
    // in prosa e non la controllava nessuno: questo documento passava.
    const senzaHome = documentoOnePager();
    senzaHome.pages[0].role = 'faq';
    const res = parseDocument(senzaHome);

    expect(res.ok).toBe(false); // covers: AC-202-9
    const mancaHome = rifiutato(res).find((issue) => issue.code === 'custom');
    if (mancaHome?.code !== 'custom') throw new Error('atteso un custom sulla home mancante');
    expect(mancaHome.path).toEqual(['pages']); // covers: AC-202-9
    expect(mancaHome.message).toContain(RUOLO_HOME); // covers: AC-202-9 — nomina il ruolo mancante

    // Gemello ACCETTATO: cambia solo il ruolo.
    const conHome = documentoOnePager();
    conHome.pages[0].role = RUOLO_HOME;
    const documento = accettato(parseDocument(conHome)); // covers: AC-202-9
    expect(documento.pages[0].role).toBe(RUOLO_HOME); // covers: AC-202-9
    expect(documento.pages[0].slug).toBe(senzaHome.pages[0].slug); // covers: AC-202-9 — cambia SOLO il ruolo
  });

  // covers: AC-202-9
  it('rifiuta anche un multi-pagina in cui NESSUNA delle pagine e la home', () => {
    // Otto pagine, tutte legittime, nessuna di ruolo 'home': il vincolo non e' "la prima
    // pagina", e' "esiste una home". La fixture ne ha DUE (indici 0 e 7), quindi vanno
    // cambiate entrambe — se il controllo si fermasse alla prima corrispondenza in senso
    // sbagliato, questo caso lo direbbe.
    const senzaHome = documentoMultiPagina();
    for (const pagina of senzaHome.pages) {
      if (pagina.role === RUOLO_HOME) pagina.role = 'offerings';
    }
    expect(senzaHome.pages.every((pagina) => pagina.role !== RUOLO_HOME)).toBe(true);
    expect(parseDocument(senzaHome).ok).toBe(false); // covers: AC-202-9

    // Basta che UNA torni home perche' il documento sia accettato.
    const conUnaHome = documentoMultiPagina();
    for (const pagina of conUnaHome.pages) {
      if (pagina.role === RUOLO_HOME) pagina.role = 'offerings';
    }
    conUnaHome.pages[4].role = RUOLO_HOME;
    expect(parseDocument(conUnaHome).ok).toBe(true); // covers: AC-202-9
  });

  // covers: AC-202-9
  it('NON pretende che la home sia una sola: due pagine di ruolo home sono accettate', () => {
    // "Esattamente una" non e' richiesto da alcuna decisione (P2-D13 dice che la home
    // esiste sempre, non che sia sola) e non va imposto: sarebbe un vincolo inventato
    // qui, che T-213 scoprirebbe come un rifiuto inspiegabile. La fixture multi-pagina
    // ha gia' due pagine di ruolo 'home' con slug diversi ('home' e 'chi-siamo').
    const documento = accettato(parseDocument(documentoMultiPagina())); // covers: AC-202-9
    const home = documento.pages.filter((pagina) => pagina.role === RUOLO_HOME);
    expect(home).toHaveLength(2); // covers: AC-202-9
    expect(home.map((pagina) => pagina.slug)).toEqual(['home', 'chi-siamo']); // covers: AC-202-9
  });
});

describe('T-202 gli id VERSIONATI di ricetta e tema (AC-202-8)', () => {
  // covers: AC-202-8
  it('rifiuta il documento a cui manca recipe_id o theme_id, nominando il campo', () => {
    for (const campo of ['recipe_id', 'theme_id']) {
      const senza: Record<string, unknown> = { ...documentoOnePager() };
      delete senza[campo];
      const res = parseDocument(senza);

      expect(res.ok, campo).toBe(false); // covers: AC-202-8
      const mancante = rifiutato(res).find((issue) => issue.path.includes(campo));
      if (mancante?.code !== 'invalid_type') throw new Error(`atteso un invalid_type su ${campo}`);
      expect(mancante.path, campo).toEqual([campo]); // covers: AC-202-8 — nomina il campo
      expect(mancante.received, campo).toBe('undefined'); // covers: AC-202-8
    }
  });

  // covers: AC-202-8
  it('accetta il documento che li porta e li CONSERVA distinti', () => {
    const input = documentoMultiPagina();
    const documento = accettato(parseDocument(input)); // covers: AC-202-8

    expect(documento.recipe_id).toBe(RICETTA); // covers: AC-202-8
    expect(documento.theme_id).toBe(TEMA); // covers: AC-202-8
    // Valori DISCORDANTI: se lo schema leggesse un campo al posto dell'altro, o li
    // scambiasse, questa riga lo vedrebbe.
    expect(documento.recipe_id).not.toBe(documento.theme_id); // covers: AC-202-8
  });

  // covers: AC-202-8
  it('vincola la FORMA (versionata) e la LUNGHEZZA, senza confrontarli con alcun catalogo', () => {
    // ACCETTATI: slug minuscolo + '@' + numero di versione. Nessuno di questi id esiste
    // in un catalogo — T-211 e T-212 non sono costruiti — ed e' deliberato: qui si
    // vincola la forma, non l'appartenenza.
    const conformi = ['aurora-lineare@3', 'tema@1', 'a1@0', 'ricetta-2-b@12'];
    for (const id of conformi) {
      const doc = documentoOnePager();
      doc.recipe_id = id;
      expect(parseDocument(doc).ok, `recipe_id '${id}'`).toBe(true); // covers: AC-202-8
    }

    // RIFIUTATI. La versione e' DENTRO la forma: un id senza '@n' cade, quindi
    // "versionato" e' imposto e non sperato. E la forma esclude per costruzione ':' '/'
    // '.' e le chiavi speciali di JavaScript.
    const fuoriForma = [
      'aurora-lineare', // nessuna versione
      'aurora-lineare@', // '@' senza numero
      'aurora-lineare@v3', // versione non numerica
      'aurora-lineare@3.1', // il punto non e' ammesso
      'Aurora-lineare@3', // maiuscola
      'aurora_lineare@3', // underscore
      'aurora--lineare@3', // trattino doppio
      '-aurora@3', // trattino al bordo
      '__proto__@1',
      '../../etc/passwd@1',
      'https://evil.example/x@1',
      '',
    ];
    for (const id of fuoriForma) {
      const doc = documentoOnePager();
      doc.theme_id = id;
      const res = parseDocument(doc);
      expect(res.ok, `theme_id '${id}'`).toBe(false); // covers: AC-202-8
      expect(serializza(res), `theme_id '${id}'`).not.toContain('evil.example'); // covers: AC-202-8
    }

    // Al tetto accettato, a tetto+1 rifiutato: la lunghezza e' dichiarata e applicata.
    const alTetto = documentoOnePager();
    alTetto.recipe_id = idVersionato(DOCUMENT_LIMITS.versioned_id, 'ricetta-');
    expect(alTetto.recipe_id).toHaveLength(DOCUMENT_LIMITS.versioned_id);
    expect(parseDocument(alTetto).ok).toBe(true); // covers: AC-202-8

    const oltre = documentoOnePager();
    oltre.recipe_id = idVersionato(DOCUMENT_LIMITS.versioned_id + 1, 'ricetta-');
    const res = parseDocument(oltre);
    expect(res.ok).toBe(false); // covers: AC-202-8
    const troppoLungo = rifiutato(res).find((issue) => issue.path.includes('recipe_id'));
    if (troppoLungo?.code !== 'too_big') throw new Error('atteso un too_big su recipe_id');
    expect(troppoLungo.maximum).toBe(DOCUMENT_LIMITS.versioned_id); // covers: AC-202-8
  });

  // covers: AC-202-8
  it('una chiave sconosciuta accanto a essi cade per strict', () => {
    const conExtra = { ...documentoOnePager(), recipe_version: SCONOSCIUTO };
    const res = parseDocument(conExtra);

    expect(res.ok).toBe(false); // covers: AC-202-8
    const ignota = rifiutato(res).find((issue) => issue.code === 'unrecognized_keys');
    if (ignota?.code !== 'unrecognized_keys') throw new Error('atteso un unrecognized_keys');
    expect(ignota.keys).toEqual(['recipe_version']); // covers: AC-202-8
    expect(ignota.path).toEqual([]); // covers: AC-202-8 — al top level del documento
    expect(serializza(res)).not.toContain(SCONOSCIUTO); // covers: AC-202-8
  });
});

describe('T-202 slot immagine — irrappresentabilita per TIPO (P2-D12)', () => {
  // definition_of_done p.3 — l'unione ha ESATTAMENTE due varianti e nessuna di esse
  // dichiara un campo che possa contenere un URL. E' l'oracolo strutturale: sparisce
  // rumorosamente se qualcuno aggiunge una terza variante o un campo libero.
  it("l'unione ha esattamente due varianti, con chiavi pinnate e nessun campo di rete", () => {
    const unione = unioneSlotImmagine();
    expect(unione.options).toHaveLength(2);

    const chiaviPerSorgente = Object.fromEntries(
      unione.options.map((variante) => {
        const chiavi: string[] = Object.keys(variante.shape);
        const sorgente = variante.shape.source.value;
        return [sorgente, chiavi.sort()];
      }),
    );

    expect(chiaviPerSorgente).toEqual({
      'theme-placeholder': ['source', 'token'],
      uploaded: ['asset_id', 'source'],
    });

    // Nessuna variante, presente o futura, puo' portare un campo di rete.
    for (const variante of unione.options) {
      for (const chiave of Object.keys(variante.shape)) {
        expect(chiave, `chiave '${chiave}' in una variante dello slot immagine`).not.toMatch(
          /url|src|href|uri|link/i,
        );
      }
    }
  });

  it("il TOKEN del tema non puo' contenere un URL: la forma lo esclude", () => {
    // Anche il campo che esiste e' chiuso: senza ':' '/' e '.' un token non puo'
    // diventare un indirizzo, quindi la variante ammessa non e' una scorciatoia.
    for (const token of [OSTILE, '//evil.example/x.png', 'javascript:alert(1)', 'a.b', 'A-B']) {
      const doc = documentoOnePager();
      doc.pages[0].blocks[0].images[0] = { source: 'theme-placeholder', token };
      const res = parseDocument(doc);
      expect(res.ok, `token '${token}'`).toBe(false);
      expect(serializza(res), `token '${token}'`).not.toContain('evil.example');
    }

    // Gemello ACCETTATO: cambia solo la forma del token.
    const buono = documentoOnePager();
    buono.pages[0].blocks[0].images[0] = { source: 'theme-placeholder', token: 'hero-wide-2' };
    expect(parseDocument(buono).ok).toBe(true);
  });

  // covers: AC-202-4
  it("nemmeno l ASSET_ID puo' contenere un indirizzo: la forma uuid lo esclude", () => {
    // IL GEMELLO DEL TEST QUI SOPRA, SULL'ALTRA VARIANTE (definition_of_done p.3, P2-D12).
    // Esisteva l'oracolo sulla forma del `token` e NON quello sulla forma dell'`asset_id`:
    // `z.string().uuid()` poteva percio' diventare `z.string()` con la suite verde, e
    // { source: 'uploaded', asset_id: 'https://evil.example/x.png' } sarebbe stato un
    // documento VALIDO — cioe' un URL di terzi nel campo che il rendering di P4
    // risolvera' in un `src`. Il modulo afferma che la forma uuid E' la difesa; questa e'
    // l'asserzione che la rende vera invece che sperata.
    const indirizzi = [OSTILE, '//evil.example/x.png', 'javascript:alert(1)', '../../etc/passwd'];
    for (const asset of indirizzi) {
      const doc = documentoOnePager();
      doc.pages[0].blocks[1].images[0] = { source: 'uploaded', asset_id: asset };
      const res = parseDocument(doc);

      expect(res.ok, `asset_id '${asset}'`).toBe(false); // covers: AC-202-4
      const invalido = rifiutato(res).find((issue) => issue.path.includes('asset_id'));
      if (invalido?.code !== 'invalid_string') {
        throw new Error(`atteso un invalid_string su asset_id per '${asset}'`);
      }
      expect(invalido.validation, `asset_id '${asset}'`).toBe('uuid'); // covers: AC-202-4 — e' la FORMA a parlare
      expect(invalido.path, `asset_id '${asset}'`).toEqual([
        'pages',
        0,
        'blocks',
        1,
        'images',
        0,
        'asset_id',
      ]); // covers: AC-202-4 — l'errore dice QUALE slot
      expect(serializza(res), `asset_id '${asset}'`).not.toContain('evil.example'); // covers: AC-202-4
    }

    // Gemello ACCETTATO: cambia UNA sola variabile, la forma dell'id, che qui e' un uuid.
    const buono = documentoOnePager();
    buono.pages[0].blocks[1].images[0] = { source: 'uploaded', asset_id: assetId(5) };
    const documento = accettato(parseDocument(buono)); // covers: AC-202-4
    const slot = paginaDi(documento, 'home').blocks[1].images[0];
    if (slot.source !== 'uploaded') throw new Error("atteso uno slot 'uploaded'");
    expect(slot.asset_id).toBe(assetId(5)); // covers: AC-202-4
  });

  it("il campo 'src'/'url'/'href' non esiste NEL TIPO dello slot immagine", () => {
    const documento = accettato(parseDocument(documentoOnePager()));
    const immagine: ImageSlot = paginaDi(documento, 'home').blocks[0].images[0];
    expect(immagine.source).toBe('theme-placeholder');

    // Oracolo A COMPILAZIONE: se un giorno una variante guadagnasse uno di questi
    // campi, l'errore atteso sparirebbe e `@ts-expect-error` renderebbe rosso il
    // typecheck. E' la difesa di P2-D12 sorvegliata dal compilatore, non da una prova
    // a runtime che qualcuno potrebbe cancellare senza accorgersene.
    // @ts-expect-error — nessuna variante dello slot immagine dichiara 'src'
    void immagine.src;
    // @ts-expect-error — nessuna variante dello slot immagine dichiara 'url'
    void immagine.url;
    // @ts-expect-error — nessuna variante dello slot immagine dichiara 'href'
    void immagine.href;
  });

  // covers: AC-202-4
  it("rifiuta { source: 'uploaded' } senza asset_id, e accetta lo stesso slot con asset_id", () => {
    const senzaAsset = documentoOnePager();
    senzaAsset.pages[0].blocks[1].images[0] = { source: 'uploaded' };
    const res = parseDocument(senzaAsset);

    expect(res.ok).toBe(false); // covers: AC-202-4
    const mancante = rifiutato(res).find((issue) => issue.path.includes('asset_id'));
    if (mancante?.code !== 'invalid_type') throw new Error('atteso un invalid_type su asset_id');
    expect(mancante.path).toEqual(['pages', 0, 'blocks', 1, 'images', 0, 'asset_id']); // covers: AC-202-4
    expect(mancante.received).toBe('undefined'); // covers: AC-202-4 — manca proprio asset_id

    // Gemello ACCETTATO: UNA sola variabile cambia, la presenza di asset_id.
    const conAsset = documentoOnePager();
    conAsset.pages[0].blocks[1].images[0] = { source: 'uploaded', asset_id: assetId(3) };
    const documento = accettato(parseDocument(conAsset)); // covers: AC-202-4
    const slot = paginaDi(documento, 'home').blocks[1].images[0];
    if (slot.source !== 'uploaded') throw new Error("atteso uno slot 'uploaded'");
    expect(slot.asset_id).toBe(assetId(3)); // covers: AC-202-4
  });

  // covers: AC-202-4
  it("rifiuta { source: 'external', url } per DUE ragioni: sorgente non ammessa e chiave url inesistente", () => {
    const esterno = documentoOnePager();
    esterno.pages[0].blocks[0].images[0] = { source: 'external', url: OSTILE };
    const res = parseDocument(esterno);

    expect(res.ok).toBe(false); // covers: AC-202-4

    // RAGIONE 1 — 'external' non e' una sorgente ammessa, e le sorgenti ammesse sono
    // ESATTAMENTE due: se qualcuno aggiungesse una terza variante, questa lista lo direbbe.
    const sorgente = rifiutato(res).find((issue) => issue.path.includes('source'));
    if (sorgente?.code !== 'invalid_union_discriminator') {
      throw new Error('atteso un invalid_union_discriminator sulla sorgente');
    }
    expect(sorgente.options).toEqual(['theme-placeholder', 'uploaded']); // covers: AC-202-4
    expect(sorgente.path).toEqual(['pages', 0, 'blocks', 0, 'images', 0, 'source']); // covers: AC-202-4

    // RAGIONE 2 — la chiave `url` non esiste nello schema. Provata su uno slot per il
    // resto VALIDO di CIASCUNA variante ammessa: e' l'unico modo di attribuire il
    // rifiuto alla chiave e non alla sorgente, che nel caso qui sopra ferma il parse prima.
    const varianti: SlotFixture[] = [
      { source: 'theme-placeholder', token: 'hero-wide' },
      { source: 'uploaded', asset_id: assetId(4) },
    ];
    for (const variante of varianti) {
      const conUrl = documentoOnePager();
      conUrl.pages[0].blocks[0].images[0] = { ...variante, url: OSTILE };
      const resUrl = parseDocument(conUrl);

      expect(resUrl.ok, `${String(variante.source)} + url`).toBe(false); // covers: AC-202-4
      const ignota = rifiutato(resUrl).find((issue) => issue.code === 'unrecognized_keys');
      if (ignota?.code !== 'unrecognized_keys') throw new Error('atteso un unrecognized_keys');
      expect(ignota.keys).toEqual(['url']); // covers: AC-202-4 — la chiave url non esiste
      expect(ignota.path).toEqual(['pages', 0, 'blocks', 0, 'images', 0]); // covers: AC-202-4

      // Gemello ACCETTATO: la stessa variante SENZA la chiave url.
      const senzaUrl = documentoOnePager();
      senzaUrl.pages[0].blocks[0].images[0] = { ...variante };
      expect(parseDocument(senzaUrl).ok, `${String(variante.source)} senza url`).toBe(true); // covers: AC-202-4
    }

    // L'URL di terzi non sopravvive da nessuna parte nel risultato.
    expect(serializza(res)).not.toContain('evil.example'); // covers: AC-202-4
  });

  // covers: AC-202-5
  it("una chiave 'src' aggiunta a uno slot VALIDO fa fallire il parse, e non compare nel documento tipizzato", () => {
    const conSrc = documentoOnePager();
    // L'unica variabile e' la chiave in piu': lo slot resta { source, token } valido.
    conSrc.pages[0].blocks[0].images[0] = {
      source: 'theme-placeholder',
      token: 'hero-wide',
      src: OSTILE,
    };
    const res = parseDocument(conSrc);

    expect(res.ok).toBe(false); // covers: AC-202-5
    const ignota = rifiutato(res).find((issue) => issue.code === 'unrecognized_keys');
    if (ignota?.code !== 'unrecognized_keys') throw new Error('atteso un unrecognized_keys');
    expect(ignota.keys).toEqual(['src']); // covers: AC-202-5 — strict: chiave sconosciuta
    expect(ignota.path).toEqual(['pages', 0, 'blocks', 0, 'images', 0]); // covers: AC-202-5
    expect(serializza(res)).not.toContain('evil.example'); // covers: AC-202-5

    // La chiave NON compare nel documento tipizzato: il gemello che differisce per la
    // sola chiave `src` valida, e lo slot risultante ha esattamente due chiavi.
    const senzaSrc = documentoOnePager();
    senzaSrc.pages[0].blocks[0].images[0] = { source: 'theme-placeholder', token: 'hero-wide' };
    const documento = accettato(parseDocument(senzaSrc)); // covers: AC-202-5
    const slot = paginaDi(documento, 'home').blocks[0].images[0];
    expect(Object.keys(slot).sort()).toEqual(['source', 'token']); // covers: AC-202-5
    expect(JSON.stringify(documento)).not.toContain('"src"'); // covers: AC-202-5
    expect(JSON.stringify(documento)).not.toContain('evil.example'); // covers: AC-202-5
  });

  // covers: AC-202-10
  it("nemmeno le OFFERTE possono portare un photo_ref: l'altra strada dell URL di terzi e chiusa", () => {
    // L'unione immagine e' una delle due strade per cui un URL di terzi potrebbe
    // entrare nel documento; l'altra e' `photo_ref`, che nel BRIEF esiste (P1-D17) ed
    // e' proprio un indirizzo raccolto da un sito terzo (fromUrl, T-141). Se i dati
    // del brief resi da un blocco fossero la patch del brief TALE E QUALE, quella
    // strada resterebbe aperta e P2-D12 sarebbe vero su una via sola.
    const conOfferte = (): DocumentoFixture => {
      const doc = documentoOnePager();
      doc.pages[0].blocks[0].data = {
        offerings: [
          { name: 'Focaccia alle olive', price: '3,50' },
          { name: 'Pane integrale', description: 'A lievitazione naturale, ogni mattina.' },
        ],
      };
      doc.pages[0].blocks[0].brief_fields_rendered = ['offerings'];
      return doc;
    };

    // Gemello ACCETTATO: le stesse due offerte, discordanti, senza photo_ref.
    const documento = accettato(parseDocument(conOfferte())); // covers: AC-202-10
    expect(documento.pages[0].blocks[0].data.offerings).toHaveLength(2); // covers: AC-202-10

    // UNA sola variabile cambia: la SECONDA offerta guadagna un photo_ref.
    const conPhotoRef = conOfferte();
    const offerte = conPhotoRef.pages[0].blocks[0].data.offerings as Record<string, unknown>[];
    offerte[1].photo_ref = OSTILE;
    const res = parseDocument(conPhotoRef);

    expect(res.ok).toBe(false); // covers: AC-202-10
    const ignota = rifiutato(res).find((issue) => issue.code === 'unrecognized_keys');
    if (ignota?.code !== 'unrecognized_keys') throw new Error('atteso un unrecognized_keys');
    expect(ignota.keys).toEqual(['photo_ref']); // covers: AC-202-10
    expect(ignota.path).toEqual(['pages', 0, 'blocks', 0, 'data', 'offerings', 1]); // covers: AC-202-10
    expect(serializza(res)).not.toContain('evil.example'); // covers: AC-202-10
  });

  // covers: AC-202-10
  it('social_links RESTA e un URL ci passa: la difesa e di T-237/T-241, non di questo schema', () => {
    // ASSERZIONE SCOMODA E DELIBERATA (P2-D21, rilievo V-202-01). photo_ref e
    // social_links hanno la STESSA destinazione — un href nel sito generato — e sorte
    // OPPOSTA qui: il primo non e' rappresentabile, il secondo si'. La ragione non e'
    // tecnica ma di prodotto: i link ai profili social sono una funzione legittima e
    // l'utente li mette apposta, mentre photo_ref e' un sottoprodotto dello scraping che
    // nessuno ha chiesto. Pinnare la scelta serve a impedire due errori opposti: che
    // qualcuno tolga social_links credendo di chiudere un buco, e — molto peggio — che
    // qualcuno legga "irrappresentabile per tipo" e ne deduca che nessun URL di terzi
    // possa raggiungere un href. NON PUO' DEDURLO: la difesa e' il validatore del campo
    // al momento di costruire il link (T-237) e l'asserzione sull'effetto (T-241).
    const conSocial = documentoOnePager();
    conSocial.pages[0].blocks[0].data = {
      social_links: [
        'https://www.instagram.com/panificioaurora',
        'https://www.facebook.com/panificioaurora',
        OSTILE,
      ],
    };
    conSocial.pages[0].blocks[0].brief_fields_rendered = ['social_links'];

    const documento = accettato(parseDocument(conSocial)); // covers: AC-202-10
    const social = documento.pages[0].blocks[0].data.social_links;
    expect(social).toHaveLength(3); // covers: AC-202-10 — nessuna voce scartata
    // L'URL ostile SOPRAVVIVE, ed e' il punto: cio' che lo schema non promette va
    // scritto, non lasciato dedurre da un commento ottimista.
    expect(social).toContain(OSTILE); // covers: AC-202-10
    expect(JSON.stringify(documento)).toContain('evil.example'); // covers: AC-202-10

    // Lo stesso valore, spostato in photo_ref, e' invece rifiutato: la differenza sta
    // nel campo e non nel valore, che e' identico nei due casi.
    const conPhotoRef = documentoOnePager();
    conPhotoRef.pages[0].blocks[0].data = {
      offerings: [
        { name: 'Focaccia alle olive', price: '3,50' },
        { name: 'Pane integrale', photo_ref: OSTILE },
      ],
    };
    conPhotoRef.pages[0].blocks[0].brief_fields_rendered = ['offerings'];
    const res = parseDocument(conPhotoRef);

    expect(res.ok).toBe(false); // covers: AC-202-10
    expect(serializza(res)).not.toContain('evil.example'); // covers: AC-202-10
  });

  it('lo stesso vale per una chiave sconosciuta a OGNI altro livello (strict)', () => {
    // Strict non e' solo dello slot immagine: pagina, blocco e documento sono chiusi
    // allo stesso modo, altrimenti il testo del modello entrerebbe da un altro punto.
    const casi: { dove: string; sfregia: (doc: DocumentoFixture) => void }[] = [
      { dove: 'documento', sfregia: (doc) => Object.assign(doc, { notes: SCONOSCIUTO }) },
      { dove: 'pagina', sfregia: (doc) => Object.assign(doc.pages[0], { script: SCONOSCIUTO }) },
      {
        dove: 'blocco',
        sfregia: (doc) => Object.assign(doc.pages[0].blocks[0], { html: SCONOSCIUTO }),
      },
      {
        dove: 'contenuto',
        sfregia: (doc) => Object.assign(doc.pages[0].blocks[0].content, { hero_x: SCONOSCIUTO }),
      },
      {
        dove: 'dati del brief',
        sfregia: (doc) => Object.assign(doc.pages[0].blocks[0].data, { photo_ref: OSTILE }),
      },
    ];

    for (const caso of casi) {
      const doc = documentoOnePager();
      caso.sfregia(doc);
      const res = parseDocument(doc);
      expect(res.ok, caso.dove).toBe(false);
      expect(serializza(res), caso.dove).not.toContain(SCONOSCIUTO);
      expect(serializza(res), caso.dove).not.toContain('evil.example');
    }
  });
});

describe('T-202 i tetti e i vocabolari sono DERIVATI, non ricopiati', () => {
  // I contenuti risolti di un blocco portano i tetti di POOL_LIMITS (T-201) perche'
  // sono gli stessi valori che il pool ha fatto passare. Se questa forma fosse
  // riscritta a mano, i due tetti divergerebbero in silenzio: qui il tetto applicato
  // e' CONFRONTATO con la costante di pool.ts, non con un numero scritto nel test.
  it('i contenuti del blocco applicano i tetti di POOL_LIMITS (T-201)', () => {
    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].content.hero_title = stringaAlTetto(POOL_LIMITS.text, 'ALTETTO-');
    const documento = accettato(parseDocument(alTetto));
    expect(documento.pages[0].blocks[0].content.hero_title).toHaveLength(POOL_LIMITS.text);

    const oltre = documentoOnePager();
    oltre.pages[0].blocks[0].content.hero_title = stringaAlTetto(POOL_LIMITS.text + 1, 'OLTRE-');
    const res = parseDocument(oltre);
    expect(res.ok).toBe(false);
    const troppoLungo = rifiutato(res).find((issue) => issue.path.includes('hero_title'));
    if (troppoLungo?.code !== 'too_big') throw new Error('atteso un too_big su hero_title');
    expect(troppoLungo.maximum).toBe(POOL_LIMITS.text);
  });

  // Gli stessi tetti, dall'altra sorgente: i campi del brief resi direttamente
  // portano quelli di BRIEF_LIMITS (P1-D17). E' anche cio' che rende reale il caso
  // peggiore di AC-202-6, che da quei tetti e' costruito.
  it('i dati del brief resi dal blocco applicano i tetti di BRIEF_LIMITS (P1-D17)', () => {
    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].data = {
      business_name: stringaAlTetto(BRIEF_LIMITS.business_name, 'ALTETTO-'),
      highlights: items(BRIEF_LIMITS.highlights_items, (i) => `punto discordante numero ${i}`),
    };
    alTetto.pages[0].blocks[0].brief_fields_rendered = ['business_name', 'highlights'];
    const documento = accettato(parseDocument(alTetto));
    expect(documento.pages[0].blocks[0].data.business_name).toHaveLength(
      BRIEF_LIMITS.business_name,
    );
    expect(documento.pages[0].blocks[0].data.highlights).toHaveLength(
      BRIEF_LIMITS.highlights_items,
    );

    const oltreTesto = documentoOnePager();
    oltreTesto.pages[0].blocks[0].data = {
      business_name: stringaAlTetto(BRIEF_LIMITS.business_name + 1, 'OLTRE-'),
    };
    const resTesto = parseDocument(oltreTesto);
    expect(resTesto.ok).toBe(false);
    const troppoLungo = rifiutato(resTesto).find((issue) => issue.path.includes('business_name'));
    if (troppoLungo?.code !== 'too_big') throw new Error('atteso un too_big su business_name');
    expect(troppoLungo.maximum).toBe(BRIEF_LIMITS.business_name);

    const oltreVoci = documentoOnePager();
    oltreVoci.pages[0].blocks[0].data = {
      highlights: items(BRIEF_LIMITS.highlights_items + 1, (i) => `punto numero ${i}`),
    };
    const resVoci = parseDocument(oltreVoci);
    expect(resVoci.ok).toBe(false);
    const troppeVoci = rifiutato(resVoci).find((issue) => issue.path.includes('highlights'));
    if (troppeVoci?.code !== 'too_big') throw new Error('atteso un too_big su highlights');
    expect(troppeVoci.maximum).toBe(BRIEF_LIMITS.highlights_items);
  });

  it('brief_fields_rendered nomina solo campi che il brief ha davvero', () => {
    // I nomi vengono dalla stessa derivazione dei valori: un campo inesistente — o
    // uno rimosso di proposito come photo_ref — non e' nominabile. Senza questa
    // asserzione il vocabolario potrebbe diventare `string` senza che nulla protesti.
    const buono = documentoOnePager();
    buono.pages[0].blocks[0].data = { business_name: 'Panificio Aurora', address: 'Via Roma 1' };
    buono.pages[0].blocks[0].brief_fields_rendered = ['business_name', 'address'];
    expect(parseDocument(buono).ok).toBe(true);

    for (const nome of ['photo_ref', 'business_names', 'inventato']) {
      const cattivo = documentoOnePager();
      cattivo.pages[0].blocks[0].brief_fields_rendered = ['business_name', nome];
      const res = parseDocument(cattivo);
      expect(res.ok, `campo '${nome}'`).toBe(false);
      const invalido = rifiutato(res).find((issue) =>
        issue.path.includes('brief_fields_rendered'),
      );
      expect(invalido?.code, `campo '${nome}'`).toBe('invalid_enum_value');
      expect(invalido?.path, `campo '${nome}'`).toEqual([
        'pages',
        0,
        'blocks',
        0,
        'brief_fields_rendered',
        1,
      ]);
    }
  });

  it('brief_fields_rendered ha un tetto sul NUMERO di voci: al tetto accettato, oltre rifiutato', () => {
    // definition_of_done p.4 — era l'altra costante applicata SENZA oracolo: togliere il
    // .max() lasciava la suite verde. Il tetto non e' un numero scritto qui, e' il numero
    // dei campi che il brief ha davvero, derivato dalla stessa shape da cui il modulo
    // deriva il vocabolario: se un campo nascesse o sparisse in P1, tetto e vocabolario
    // si muoverebbero insieme.
    const nomiCampi = Object.keys(BriefUpdateSchema.shape);
    expect(nomiCampi.length).toBeGreaterThan(1);

    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].brief_fields_rendered = [...nomiCampi];
    const documento = accettato(parseDocument(alTetto)); // covers: AC-202-6
    expect(documento.pages[0].blocks[0].brief_fields_rendered).toHaveLength(nomiCampi.length);

    const oltre = documentoOnePager();
    // Una voce in piu' del tetto, e i nomi sono TUTTI legittimi: l'unica ragione
    // ammissibile del rifiuto e' il numero di voci.
    oltre.pages[0].blocks[0].brief_fields_rendered = [...nomiCampi, nomiCampi[0]];
    const res = parseDocument(oltre);
    expect(res.ok).toBe(false); // covers: AC-202-6
    const troppeVoci = rifiutato(res).find((issue) =>
      issue.path.includes('brief_fields_rendered'),
    );
    if (troppeVoci?.code !== 'too_big') {
      throw new Error('atteso un too_big su brief_fields_rendered');
    }
    expect(troppeVoci.maximum).toBe(nomiCampi.length); // covers: AC-202-6
    expect(troppeVoci.path).toEqual(['pages', 0, 'blocks', 0, 'brief_fields_rendered']);

    // CIO' CHE IL TETTO NON E', e va scritto perche' il nome lo suggerisce: e' una
    // LISTA, non un insieme. Lo stesso nome ripetuto fino al tetto e' accettato, quindi
    // il tetto limita il numero di VOCI e non l'insieme dei campi resi, e un blocco puo'
    // dichiarare due volte di rendere lo stesso campo. Che debba invece essere un insieme
    // (nomi univoci) non e' deciso da alcun AC: e' RIPORTATO all'arbitrato, non deciso
    // qui, e intanto il comportamento reale e' pinnato invece di essere ignoto.
    const ripetuti = documentoOnePager();
    ripetuti.pages[0].blocks[0].brief_fields_rendered = items(nomiCampi.length, () => nomiCampi[0]);
    const conRipetizioni = accettato(parseDocument(ripetuti));
    expect(conRipetizioni.pages[0].blocks[0].brief_fields_rendered).toHaveLength(nomiCampi.length);
    expect(new Set(conRipetizioni.pages[0].blocks[0].brief_fields_rendered).size).toBe(1);
  });

  it("l'id di un blocco e vincolato nella forma e nella lunghezza (il catalogo T-210 non esiste)", () => {
    for (const id of ['hero', 'hero-2', 'whatsapp_cta', 'offerte-del-giorno-2']) {
      const doc = documentoOnePager();
      doc.pages[0].blocks[0].id = id;
      expect(parseDocument(doc).ok, `id '${id}'`).toBe(true);
    }

    const fuoriForma = ['__proto__', 'Hero', 'hero.2', 'hero/2', '<script>', 'hero--2', '-hero'];
    for (const id of fuoriForma) {
      const doc = documentoOnePager();
      doc.pages[0].blocks[0].id = id;
      expect(parseDocument(doc).ok, `id '${id}'`).toBe(false);
    }

    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].id = stringaAlTetto(DOCUMENT_LIMITS.block_id, 'hero-');
    expect(parseDocument(alTetto).ok).toBe(true);

    const oltre = documentoOnePager();
    oltre.pages[0].blocks[0].id = stringaAlTetto(DOCUMENT_LIMITS.block_id + 1, 'hero-');
    expect(parseDocument(oltre).ok).toBe(false);
  });

  it('slug, titolo e meta description hanno forma e tetti propri', () => {
    const casi: { dove: string; valore: (doc: DocumentoFixture, v: string) => void; ok: string[]; ko: string[] }[] = [
      {
        dove: 'slug',
        valore: (doc, v) => {
          doc.pages[0].slug = v;
        },
        ok: ['home', 'chi-siamo', 'menu-2', stringaAlTetto(DOCUMENT_LIMITS.page_slug, 'home-')],
        ko: [
          'Home',
          'chi_siamo',
          'offerte--speciali',
          '-home',
          'home-',
          'menú',
          '',
          stringaAlTetto(DOCUMENT_LIMITS.page_slug + 1, 'home-'),
        ],
      },
      {
        dove: 'title',
        valore: (doc, v) => {
          doc.pages[0].title = v;
        },
        ok: ['Panificio Aurora', stringaAlTetto(DOCUMENT_LIMITS.page_title, 'ALTETTO-')],
        ko: ['', stringaAlTetto(DOCUMENT_LIMITS.page_title + 1, 'OLTRE-')],
      },
      {
        dove: 'meta_description',
        valore: (doc, v) => {
          doc.pages[0].meta_description = v;
        },
        ok: ['Il pane di via Roma.', stringaAlTetto(DOCUMENT_LIMITS.meta_description, 'ALTETTO-')],
        ko: ['', stringaAlTetto(DOCUMENT_LIMITS.meta_description + 1, 'OLTRE-')],
      },
    ];

    for (const caso of casi) {
      for (const valore of caso.ok) {
        const doc = documentoOnePager();
        caso.valore(doc, valore);
        expect(parseDocument(doc).ok, `${caso.dove} accettato (${valore.length} code unit)`).toBe(
          true,
        );
      }
      for (const valore of caso.ko) {
        const doc = documentoOnePager();
        caso.valore(doc, valore);
        expect(parseDocument(doc).ok, `${caso.dove} rifiutato (${valore.length} code unit)`).toBe(
          false,
        );
      }
    }
  });

  it('una pagina senza blocchi non esiste (P2-D7), e i blocchi hanno un tetto', () => {
    const senzaBlocchi = documentoOnePager();
    senzaBlocchi.pages[0].blocks = [];
    expect(parseDocument(senzaBlocchi).ok).toBe(false);

    const alTetto = documentoOnePager();
    const blocchi = alTetto.pages[0].blocks;
    alTetto.pages[0].blocks = items(DOCUMENT_LIMITS.blocks_per_page, (i) => ({
      ...blocchi[i % blocchi.length],
      id: `blocco-${i}`,
    }));
    expect(parseDocument(alTetto).ok).toBe(true);

    const oltre = documentoOnePager();
    oltre.pages[0].blocks = items(DOCUMENT_LIMITS.blocks_per_page + 1, (i) => ({
      ...blocchi[i % blocchi.length],
      id: `blocco-${i}`,
    }));
    expect(parseDocument(oltre).ok).toBe(false);
  });

  it('il TOKEN del tema ha un tetto di lunghezza: al tetto accettato, oltre rifiutato', () => {
    // definition_of_done p.4 — `image_token` era una delle due costanti applicate SENZA
    // oracolo: togliere il .max() dal token lasciava la suite verde, cioe' il tetto era
    // decorativo. Non e' una questione estetica: il token e' saturato dal caso peggiore
    // di AC-202-6 (otto slot per blocco, ognuno col token al tetto), quindi un tetto non
    // applicato renderebbe quella misura un numero e non un bound.
    const token = stringaAlTetto(DOCUMENT_LIMITS.image_token, 'hero-');
    expect(token).toHaveLength(DOCUMENT_LIMITS.image_token);

    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].images[0] = { source: 'theme-placeholder', token };
    const documento = accettato(parseDocument(alTetto)); // covers: AC-202-6
    const slot = paginaDi(documento, 'home').blocks[0].images[0];
    if (slot.source !== 'theme-placeholder') throw new Error("atteso uno slot 'theme-placeholder'");
    expect(slot.token).toHaveLength(DOCUMENT_LIMITS.image_token); // covers: AC-202-6 — nessun troncamento

    const oltre = documentoOnePager();
    oltre.pages[0].blocks[0].images[0] = {
      source: 'theme-placeholder',
      // Una code unit sola in piu', e la FORMA resta valida: l'unica ragione ammissibile
      // del rifiuto e' la lunghezza.
      token: stringaAlTetto(DOCUMENT_LIMITS.image_token + 1, 'hero-'),
    };
    const res = parseDocument(oltre);
    expect(res.ok).toBe(false); // covers: AC-202-6
    const troppoLungo = rifiutato(res).find((issue) => issue.path.includes('token'));
    if (troppoLungo?.code !== 'too_big') throw new Error('atteso un too_big sul token');
    expect(troppoLungo.maximum).toBe(DOCUMENT_LIMITS.image_token); // covers: AC-202-6
    expect(troppoLungo.path).toEqual(['pages', 0, 'blocks', 0, 'images', 0, 'token']);
  });

  it('gli slot immagine di un blocco hanno un tetto di numero', () => {
    const alTetto = documentoOnePager();
    alTetto.pages[0].blocks[0].images = items(DOCUMENT_LIMITS.images_per_block, (i) => ({
      source: 'theme-placeholder',
      token: `hero-${i}`,
    }));
    expect(parseDocument(alTetto).ok).toBe(true);

    const oltre = documentoOnePager();
    oltre.pages[0].blocks[0].images = items(DOCUMENT_LIMITS.images_per_block + 1, (i) => ({
      source: 'theme-placeholder',
      token: `hero-${i}`,
    }));
    expect(parseDocument(oltre).ok).toBe(false);
  });
});

describe('T-202 nessuna chiave scartata in SILENZIO (AC-202-12)', () => {
  /**
   * Gli orari come li produce JSON.parse, cioe' come arrivano davvero: '__proto__' e'
   * una proprieta' PROPRIA della mappa (l'assegnazione, invece, scriverebbe il
   * prototipo). E' la forma in cui l'uscita del modello e l'HTML importato raggiungono
   * il gate, e la sola in cui il difetto e' riproducibile.
   */
  function orariConProto(): Record<string, unknown> {
    return JSON.parse('{"lunedi":"8-13 e 16-19","__proto__":"aperto sempre"}') as Record<
      string,
      unknown
    >;
  }

  function documentoConOrari(orari: Record<string, unknown>): DocumentoFixture {
    const doc = documentoOnePager();
    doc.pages[0].blocks[0].data = { hours: orari };
    doc.pages[0].blocks[0].brief_fields_rendered = ['hours'];
    return doc;
  }

  // covers: AC-202-12
  it("una chiave '__proto__' negli orari e un RIFIUTO NOMINATO, non una sparizione con ok:true", () => {
    // Prima di P2-D21 questo documento tornava `ok: true` con la chiave semplicemente
    // SCOMPARSA dal risultato: nessun inquinamento di prototipo, ma il documento
    // restituito differiva dall'ingresso senza che nulla lo dicesse. E' la corruzione
    // silenziosa che P1-D17 e T-201 vietano — la stessa ragione per cui un valore fuori
    // scala e' scartato e mai troncato.
    const conProto = documentoConOrari(orariConProto());
    const res = parseDocument(conProto);

    expect(res.ok).toBe(false); // covers: AC-202-12
    const nominata = rifiutato(res).find((issue) => issue.path.includes('__proto__'));
    if (nominata?.code !== 'invalid_string') {
      throw new Error("atteso un invalid_string sulla chiave '__proto__' degli orari");
    }
    expect(nominata.validation).toBe('regex'); // covers: AC-202-12 — e' la FORMA a parlare
    expect(nominata.path).toEqual([
      'pages',
      0,
      'blocks',
      0,
      'data',
      'hours',
      '__proto__',
    ]); // covers: AC-202-12 — l'errore dice QUALE chiave

    // Gemello ACCETTATO: cambia UNA sola variabile, la chiave speciale sparisce
    // dall'INGRESSO. La chiave legittima che le stava accanto e' la stessa.
    const legittimi: Record<string, unknown> = JSON.parse(
      '{"lunedi":"8-13 e 16-19","martedi":"8-13"}',
    ) as Record<string, unknown>;
    const documento = accettato(parseDocument(documentoConOrari(legittimi))); // covers: AC-202-12
    const orari = documento.pages[0].blocks[0].data.hours;
    // NIENTE e' scomparso: le chiavi del risultato sono ESATTAMENTE quelle dell'ingresso.
    expect(Object.keys(orari ?? {})).toEqual(Object.keys(legittimi)); // covers: AC-202-12
    expect(orari).toEqual(legittimi); // covers: AC-202-12
  });

  // covers: AC-202-12
  it('la forma della chiave ammette le lingue del prodotto e rifiuta i bordi strutturali', () => {
    // La chiave degli orari NON e' uno slug: e' un'etichetta RESA, nella lingua
    // dell'utente. Vincolarla all'ASCII minuscolo come pool.ts fa con gli slug
    // rifiuterebbe un documento legittimo in italiano o spagnolo — cioe' proprio i due
    // locale che il prodotto serve — e con la politica di non-troncamento sarebbe una
    // generazione fallita. Ammette quindi le lettere di qualunque alfabeto, e pretende
    // un alfanumerico ai due bordi: e' quello a escludere '__proto__'.
    expect(LOCALI).toEqual(['it', 'es']);
    const conformi = ['lunedi', 'lunedì', 'lunes', 'miércoles', 'lun-ven', 'lun ven', 'lun/ven'];
    for (const chiave of conformi) {
      const doc = documentoConOrari({ [chiave]: '8-13 e 16-19', domenica: 'chiuso' });
      expect(parseDocument(doc).ok, `chiave '${chiave}'`).toBe(true); // covers: AC-202-12
    }

    const fuoriForma = ['__proto__', '_lunedi', 'lunedi_', 'constructor.prototype', ' lunedi', ''];
    for (const chiave of fuoriForma) {
      const doc = documentoConOrari({ [chiave]: '8-13', domenica: 'chiuso' });
      const res = parseDocument(doc);
      expect(res.ok, `chiave '${chiave}'`).toBe(false); // covers: AC-202-12
      // La chiave legittima che le sta accanto non e' incolpata.
      expect(
        rifiutato(res).every((issue) => !issue.path.includes('domenica')),
        `chiave '${chiave}'`,
      ).toBe(true); // covers: AC-202-12
    }
  });

  it('il tetto sul NUMERO di chiavi degli orari sopravvive alla forma (P1-D13)', () => {
    // Ricostruire il record per vincolarne la chiave perde il refine dell'originale: se
    // nessuno lo riscrivesse, il documento accetterebbe una mappa piu' grande di quella
    // da cui viene, cioe' un tetto del brief aggirato passando dal documento.
    const alTetto = documentoConOrari(
      Object.fromEntries(items(BRIEF_LIMITS.hours_keys, (i) => [`giorno-${i}`, `orario ${i}`])),
    );
    expect(parseDocument(alTetto).ok).toBe(true);

    const oltre = documentoConOrari(
      Object.fromEntries(items(BRIEF_LIMITS.hours_keys + 1, (i) => [`giorno-${i}`, `orario ${i}`])),
    );
    expect(parseDocument(oltre).ok).toBe(false);
  });

  // covers: AC-202-12
  it('il risultato e una COPIA validata, mai l oggetto d ingresso', () => {
    const input = documentoMultiPagina();
    const documento = accettato(parseDocument(input));

    expect(documento).toEqual(input); // covers: AC-202-12 — stessi valori...
    expect(documento).not.toBe(input); // covers: AC-202-12 — ...ma non lo stesso oggetto
    expect(documento.pages).not.toBe(input.pages); // covers: AC-202-12
    expect(documento.pages[0]).not.toBe(input.pages[0]); // covers: AC-202-12
    expect(documento.pages[0].blocks).not.toBe(input.pages[0].blocks); // covers: AC-202-12
    expect(documento.pages[0].blocks[0]).not.toBe(input.pages[0].blocks[0]); // covers: AC-202-12
    expect(documento.pages[0].blocks[0].data).not.toBe(input.pages[0].blocks[0].data); // covers: AC-202-12
    expect(documento.pages[0].blocks[0].images).not.toBe(input.pages[0].blocks[0].images); // covers: AC-202-12
    // Fino all'oggetto piu' annidato: la lista copiata potrebbe portare gli STESSI slot.
    expect(documento.pages[0].blocks[0].images[0]).not.toBe(input.pages[0].blocks[0].images[0]); // covers: AC-202-12

    // E la copia e' INDIPENDENTE: chi tiene l'ingresso non puo' piu' cambiare cio' che
    // e' passato dal gate. E' quello che rende sensato scrivere il risultato (T-204).
    input.pages[0].title = 'titolo cambiato DOPO il parse';
    expect(documento.pages[0].title).not.toBe(input.pages[0].title); // covers: AC-202-12
  });
});

// Testa e CODA del payload che un input ostile puo' scrivere in una chiave: prompt
// injection, sequenza ANSI, markup e un NUL. La coda vive OLTRE il tetto di
// DOCUMENT_LIMITS.error_chars, quindi deve morire nel troncamento — senza una coda, "il
// testo ostile non compare per intero" sarebbe vero per caso.
const OSTILE_TESTA = 'IGNORE PREVIOUS INSTRUCTIONS \u001b[31m<script>alert(1)</script>\u0000 ';
const OSTILE_CODA = 'CODA-DEL-PAYLOAD-OSTILE';

/**
 * Una chiave sconosciuta come la scriverebbe un input ostile. Fra le chiavi cambia solo
 * l'indice, cosi' due documenti con `riempimento` diverso producono chiavi TRONCATE
 * identiche: e' cio' che rende osservabile che l'errore non dipende dalla taglia
 * dell'input.
 */
function chiaveOstile(indice: number, riempimento: number): string {
  return `${OSTILE_TESTA}#${indice}#${'A'.repeat(riempimento)}${OSTILE_CODA}`;
}

/**
 * OGNI stringa contenuta nell'errore, con la propria posizione: le stringhe dell'input
 * si annidano dentro `path` e dentro le `keys` di un unrecognized_keys, quindi guardare
 * solo il primo livello direbbe che va tutto bene.
 */
function stringheDi(valore: unknown, dove = 'error'): [string, string][] {
  if (typeof valore === 'string') return [[dove, valore]];
  if (Array.isArray(valore)) return valore.flatMap((v, i) => stringheDi(v, `${dove}[${i}]`));
  if (typeof valore === 'object' && valore !== null) {
    return Object.entries(valore).flatMap(([k, v]) => stringheDi(v, `${dove}.${k}`));
  }
  return [];
}

/**
 * Un documento la cui FORMA e' valida ovunque tranne che per le chiavi sconosciute
 * enormi appese a ogni blocco. Ogni blocco e' un oggetto strict a se', quindi ne nasce
 * un issue PROPRIO: e' il modo in cui il NUMERO di issue supera il tetto. E ogni blocco
 * ne porta piu' di `error_issues`, quindi il tetto morde anche DENTRO un issue.
 * Il documento resta sotto `max_bytes` di proposito: il tetto di peso e' controllato
 * PRIMA della forma, e un input che lo sfonda produrrebbe il solo issue del peso —
 * il limitatore delle chiavi non verrebbe mai esercitato.
 */
function documentoOstile(
  pagine: number,
  chiaviPerBlocco: number,
  riempimento: number,
): DocumentoFixture {
  return documentoDi(
    items(pagine, (p) => ({
      slug: p === 0 ? 'home' : `pagina-${p}`,
      role: p === 0 ? RUOLO_HOME : 'offerings',
      title: `Titolo della pagina numero ${p}`,
      meta_description: `Meta description della pagina ${p}, diversa da ogni altra.`,
      blocks: items(DOCUMENT_LIMITS.blocks_per_page, (b) => {
        const blocco: BloccoFixture = {
          id: `blocco-${p}-${b}`,
          content: { hero_title: `Titolo del blocco ${p}/${b}` },
          data: { business_name: `Nome reso in ${p}/${b}` },
          brief_fields_rendered: ['business_name'],
          images: [{ source: 'theme-placeholder', token: `token-${p}-${b}` }],
        };
        for (let i = 0; i < chiaviPerBlocco; i += 1) {
          Object.assign(blocco, { [chiaveOstile(i, riempimento)]: 'valore innocuo' });
        }
        return blocco;
      }),
    })),
  );
}

describe('T-202 il ramo di ERRORE e limitato ALLA FONTE (AC-202-11)', () => {
  const PAGINE = 4;
  const CHIAVI_PER_BLOCCO = 30;
  const RIEMPIMENTO = 2_000;

  // covers: AC-202-11
  it('nessuna stringa dell errore supera il tetto e il payload ostile non sopravvive per intero', () => {
    const input = documentoOstile(PAGINE, CHIAVI_PER_BLOCCO, RIEMPIMENTO);
    // La premessa del test: l'input sfonda la FORMA, non il peso.
    expect(pesoInByte(input)).toBeLessThan(DOCUMENT_LIMITS.max_bytes);

    const res = parseDocument(input);
    expect(res.ok).toBe(false); // covers: AC-202-11

    const issues = rifiutato(res);
    // Gli issue GREZZI sarebbero uno per blocco: piu' del tetto, che quindi morde.
    expect(PAGINE * DOCUMENT_LIMITS.blocks_per_page).toBeGreaterThan(DOCUMENT_LIMITS.error_issues);
    expect(issues.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.error_issues); // covers: AC-202-11

    // NESSUNA stringa riportata supera il tetto: path, messaggi e chiavi comprese.
    const stringhe = stringheDi(issues);
    expect(stringhe.length).toBeGreaterThan(0);
    for (const [dove, stringa] of stringhe) {
      expect(stringa.length, `${dove}: ${stringa.length} code unit`).toBeLessThanOrEqual(
        DOCUMENT_LIMITS.error_chars,
      ); // covers: AC-202-11
    }

    // Cio' che IDENTIFICA il problema sopravvive al troncamento: l'errore dice ancora
    // che sono chiavi non riconosciute e su quale blocco.
    const ignota = issues.find((issue) => issue.code === 'unrecognized_keys');
    if (ignota?.code !== 'unrecognized_keys') throw new Error('atteso un unrecognized_keys');
    expect(ignota.path[0]).toBe('pages'); // covers: AC-202-11
    // Il tetto morde anche DENTRO l'issue: un solo unrecognized_keys porterebbe tutte le
    // chiavi appese a quel blocco, e sono piu' del tetto.
    expect(CHIAVI_PER_BLOCCO).toBeGreaterThan(DOCUMENT_LIMITS.error_issues);
    expect(ignota.keys).toHaveLength(DOCUMENT_LIMITS.error_issues); // covers: AC-202-11

    // Il testo ostile non compare PER INTERO: ne la chiave, ne la sua coda, che vive
    // oltre il tetto.
    const serializzato = serializza(res);
    expect(serializzato).not.toContain(chiaveOstile(0, RIEMPIMENTO)); // covers: AC-202-11
    expect(serializzato).not.toContain(OSTILE_CODA); // covers: AC-202-11

    // ALLA FONTE, non nel chiamante: lo stesso documento con chiavi dieci volte piu'
    // corte produce un errore IDENTICO byte per byte. La taglia dell'errore non dipende
    // da quella dell'input, che e' cio' che rende sicuro tradurlo in failure_reason
    // (T-204, che traduce ALLO STESSO MODO l'errore di parsePool).
    const piccolo = parseDocument(documentoOstile(PAGINE, CHIAVI_PER_BLOCCO, RIEMPIMENTO / 10));
    expect(serializza(piccolo)).toBe(serializzato); // covers: AC-202-11
  });

  // covers: AC-202-11
  it('anche i rifiuti che NON vengono da zod passano dall UNICO costruttore limitato', () => {
    // I tre rami costruiti a mano (provenienza, serializzabilita', peso) non nascono da
    // una ZodError e — deliberatamente — non portano testo dell'input: a runtime un
    // ritorno diretto sarebbe percio' indistinguibile da uno limitato, e un'asserzione
    // sui soli valori sarebbe verde comunque, cioe' decorativa.
    // Cio' che si puo' sorvegliare e' che il canale sia UNO SOLO. E' un oracolo SUL
    // SORGENTE, nello stesso spirito del controllo su `.max()`: un solo punto in cui si
    // scrive `ok: false`, e ogni ramo di rifiuto passa di li'. Aggiungere domani un
    // quarto controllo con un return scritto a mano diventa rosso qui.
    expect(documentSource.match(/ok: false,/g) ?? []).toHaveLength(1); // covers: AC-202-11
    expect((documentSource.match(/return limitedFailure\(/g) ?? []).length).toBeGreaterThanOrEqual(
      3,
    ); // covers: AC-202-11 — provenienza, serializzabilita', peso
    expect(documentSource).toMatch(/limitedFailure\(parsed\.error\.issues\)/); // covers: AC-202-11 — e la forma

    // E i tre rami esistono davvero e rifiutano: l'oracolo sul sorgente non varrebbe
    // niente se quel codice non fosse raggiunto.
    const circolare: Record<string, unknown> = { ...documentoOnePager() };
    circolare.self = circolare;
    const pesante = documentoAiTetti();
    pesante.pages = [...pesante.pages, ...pesante.pages, ...pesante.pages];
    expect(pesoInByte(pesante)).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes);

    for (const ostile of ['una stringa', circolare, pesante]) {
      const issues = rifiutato(parseDocument(ostile));
      expect(issues.length).toBeLessThanOrEqual(DOCUMENT_LIMITS.error_issues); // covers: AC-202-11
      for (const [dove, stringa] of stringheDi(issues)) {
        expect(stringa.length, dove).toBeLessThanOrEqual(DOCUMENT_LIMITS.error_chars); // covers: AC-202-11
      }
    }
  });
});

describe('T-202 parseDocument non lancia mai', () => {
  // definition_of_done p.5 — ritorna un risultato tipizzato o un errore, senza lanciare.
  it('su input non fidato di qualunque forma restituisce un rifiuto invece di lanciare', () => {
    const circolare: Record<string, unknown> = { pages: [] };
    circolare.self = circolare;

    const ostili: unknown[] = [
      undefined,
      null,
      'una stringa',
      42,
      [],
      { pages: null },
      { pages: {} },
      { pages: [null] },
      { pages: [{ slug: 'home' }] },
      { pages: [{ ...paginaHome(), blocks: 'testo invece di una lista' }] },
      circolare,
      // Provenienza: `pages` qui e' una proprieta' EREDITATA, non propria. z.object
      // legge `data.pages` e la troverebbe sul prototipo, mentre strict guarda le
      // chiavi PROPRIE: senza la guardia in testa a parseDocument il gate accetterebbe
      // un documento che nessuno ha messo nell'oggetto (stessa classe di T-201).
      Object.create({ pages: documentoOnePager().pages }),
    ];

    for (const ostile of ostili) {
      const etichetta = (() => {
        try {
          return JSON.stringify(ostile) ?? 'undefined';
        } catch {
          return 'circolare';
        }
      })();
      expect(() => parseDocument(ostile), etichetta).not.toThrow();
      expect(parseDocument(ostile).ok, etichetta).toBe(false);
    }
  });

  // definition_of_done p.5 — "non lancia MAI" comprende il bordo in cui a lanciare non
  // e' il parse ma la GUARDIA DI PROVENIENZA: `Object.getPrototypeOf` invoca la trappola
  // omonima del Proxy, che puo' lanciare. L'eccezione usciva da parseDocument
  // contraddicendone il contratto, e lo stesso bordo esisteva in parsePool: le due
  // guardie sono ora la stessa funzione (gate.ts), quindi non possono divergere.
  it('non lancia nemmeno quando e la GUARDIA DI PROVENIENZA a essere aggredita', () => {
    const trappole: unknown[] = [
      new Proxy(documentoOnePager(), {
        getPrototypeOf() {
          throw new Error('trappola su getPrototypeOf');
        },
      }),
      // La stessa trappola su un valore che NON sarebbe accettato comunque: cosi' il
      // verde non puo' venire dal fatto che il documento sotto sia valido.
      new Proxy(
        { pages: 'testo invece di una lista' },
        {
          getPrototypeOf() {
            throw new Error('trappola su getPrototypeOf');
          },
        },
      ),
    ];

    for (const trappola of trappole) {
      expect(() => parseDocument(trappola)).not.toThrow();
      expect(parseDocument(trappola).ok).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-202-6 e AC-202-7 — il peso del caso peggiore e' MISURATO, non supposto, e lo e' in
// DUE unita' che divergono.
//
// Il caso peggiore si costruisce dai TETTI DICHIARATI, non da pagesFor (T-213) ne da
// resolve (T-214), che non esistono: DOCUMENT_LIMITS.max_pages pagine, titoli e meta
// description al tetto di DOCUMENT_LIMITS, contenuti ai tetti di POOL_LIMITS (T-201) e
// campi del brief resi direttamente ai tetti di BRIEF_LIMITS (P1-D17).
//
// IL RIEMPIMENTO E' UN PARAMETRO (P2-D21): gli stessi tetti, che contano CODE UNIT
// UTF-16, producono documenti di peso molto diverso in BYTE UTF-8 a seconda
// dell'alfabeto. Un caso peggiore misurato solo in ASCII non e' il caso peggiore del
// prodotto, che parla italiano e spagnolo.
// Restano ASCII gli IDENTIFICATORI (slug, id di blocco, token del tema, id versionati):
// hanno una FORMA che ammette solo minuscole, cifre e trattini, quindi non possono
// essere multibyte — e non e' un'omissione della misura, e' un vincolo dello schema.
//
// CHE COSA E' IL NUMERO MISURATO, E CHE COSA NON E' (P2-D21, rilievo V-202-06). E' il
// peso di UNA configurazione: quella in cui i blocchi PARTIZIONANO la resa, cioe' un
// campo del brief e uno slot di contenuto sono resi da UN solo blocco per pagina. E'
// l'assunzione dichiarata sulla distribuzione — l'ipotesi di lavoro di T-213 e T-214 —
// ed e' cio' che rende il numero leggibile: dieci pagine che portano ciascuna la
// proiezione INTERA del brief e l'intero catalogo di slot.
// NON E' IL MASSIMO DELL'INSIEME ACCETTATO, e chiamarlo cosi' sarebbe la stessa
// affermazione ottimista che P2-D21 ha corretto altrove. La FORMA non impone alcuna
// partizione: lo stesso campo reso da piu' blocchi della stessa pagina produce documenti
// VALIDI e piu' pesanti, e il primo test qui sotto ne costruisce uno, lo misura e lo
// verifica ACCETTATO. Il bound sull'insieme accettato non e' questa misura: e'
// DOCUMENT_LIMITS.max_bytes, che il gate APPLICA (secondo test). AC-202-6 resta percio'
// cio' che dice di essere — una MISURA con un tetto dichiarato sopra — e non pretende di
// essere un massimo che non e'.
// ─────────────────────────────────────────────────────────────────────────────

/** I campi del brief, TUTTI al tetto di P1-D17 (photo_ref non esiste nel documento). */
function datiBriefAiTetti(firma: string, str: Riempimento): Record<string, unknown> {
  return {
    business_name: str(BRIEF_LIMITS.business_name, `${firma}-nome-`),
    vertical: 'ristorazione',
    description: str(BRIEF_LIMITS.description, `${firma}-descrizione-`),
    address: str(BRIEF_LIMITS.address, `${firma}-indirizzo-`),
    geo: { lat: 45.4642035, lng: 9.1899795 },
    hours: Object.fromEntries(
      items(BRIEF_LIMITS.hours_keys, (i) => [
        // La CHIAVE segue il riempimento come il valore: nel documento e' vincolata
        // nella forma (AC-202-12) ma la forma ammette le lettere accentate, quindi in
        // italiano e spagnolo pesa il doppio anche lei.
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

/** Una pagina al massimo: ogni tetto saturo, la resa PARTIZIONATA sui blocchi. */
function paginaAiTetti(indice: number, str: Riempimento): PaginaFixture {
  const firma = `p${indice}`;
  const dati = datiBriefAiTetti(firma, str);
  const nomiCampi = Object.keys(dati);
  const contenuto = contenutoAiTetti(firma, str);
  const idSlot = Object.keys(contenuto);
  const quantiBlocchi = DOCUMENT_LIMITS.blocks_per_page;

  return {
    slug: stringaAlTetto(DOCUMENT_LIMITS.page_slug, `${firma}-slug-`),
    // La prima pagina e' la home ESPLICITAMENTE: il documento deve averne una
    // (AC-202-9), e farla dipendere dall'ordine del catalogo degli slot renderebbe il
    // caso peggiore invalido per una ragione che non c'entra col peso.
    role: indice === 0 ? RUOLO_HOME : RUOLI[indice % RUOLI.length],
    title: str(DOCUMENT_LIMITS.page_title, `${firma}-titolo-`),
    meta_description: str(DOCUMENT_LIMITS.meta_description, `${firma}-meta-`),
    blocks: items(quantiBlocchi, (b) => {
      const campiDelBlocco = nomiCampi.filter((_nome, i) => i % quantiBlocchi === b);
      const slotDelBlocco = idSlot.filter((_id, i) => i % quantiBlocchi === b);
      return {
        id: stringaAlTetto(DOCUMENT_LIMITS.block_id, `${firma}-b${b}-`),
        content: Object.fromEntries(slotDelBlocco.map((id) => [id, contenuto[id]])),
        data: Object.fromEntries(campiDelBlocco.map((nome) => [nome, dati[nome]])),
        brief_fields_rendered: campiDelBlocco,
        images: items(DOCUMENT_LIMITS.images_per_block, (k) => ({
          source: 'theme-placeholder',
          token: stringaAlTetto(DOCUMENT_LIMITS.image_token, `t${b}-${k}-`),
        })),
      };
    }),
  };
}

function documentoAiTetti(str: Riempimento = stringaAlTetto): DocumentoFixture {
  return {
    recipe_id: idVersionato(DOCUMENT_LIMITS.versioned_id, 'ricetta-'),
    theme_id: idVersionato(DOCUMENT_LIMITS.versioned_id, 'tema-'),
    pages: items(DOCUMENT_LIMITS.max_pages, (indice) => paginaAiTetti(indice, str)),
  };
}

describe('T-202 peso del caso peggiore (AC-202-6)', () => {
  // covers: AC-202-6
  it('il documento al massimo dei tetti pesa meno di DOCUMENT_LIMITS.max_bytes, e il valore e RIPORTATO', () => {
    const documento = documentoAiTetti();
    const byte = pesoInByte(documento);

    // La COMPOSIZIONE del numero, perche' il bound sia leggibile e non un numero magico.
    const pagina = documento.pages[0];
    const bytePagina = pesoInByte(pagina);
    const byteDati = pagina.blocks.reduce((somma, b) => somma + pesoInByte(b.data), 0);
    const byteContenuti = pagina.blocks.reduce((somma, b) => somma + pesoInByte(b.content), 0);
    const byteImmagini = pagina.blocks.reduce((somma, b) => somma + pesoInByte(b.images), 0);

    const rapporto =
      `[AC-202-6] peso MISURATO di UNA configurazione — la resa PARTIZIONATA sui blocchi, ` +
      `non il massimo dell'insieme accettato: ${byte} byte ` +
      `(${(byte / 1024 / 1024).toFixed(2)} MiB) su un tetto di ${DOCUMENT_LIMITS.max_bytes} ` +
      `(${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del budget).\n` +
      `  composizione: ${documento.pages.length} pagine x ${bytePagina} byte/pagina; ` +
      `per pagina ${pagina.blocks.length} blocchi = ${byteDati} byte di dati del brief ` +
      `(P1-D17) + ${byteContenuti} byte di contenuti (POOL_LIMITS) + ${byteImmagini} byte ` +
      `di slot immagine.`;
    console.log(rapporto);

    expect(byte, rapporto).toBeLessThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-6

    // Il caso peggiore e' un documento VALIDO, non solo leggero: se il gate lo
    // rifiutasse, il bound misurato non direbbe nulla su cio' che viene scritto davvero.
    const accettatoDocumento: SiteDocument = accettato(parseDocument(documento)); // covers: AC-202-6
    expect(accettatoDocumento.pages).toHaveLength(DOCUMENT_LIMITS.max_pages); // covers: AC-202-6
    expect(pesoInByte(accettatoDocumento)).toBe(byte); // covers: AC-202-6 — nessun troncamento

    // La fixture e' davvero AI TETTI: se un tetto qui sotto smettesse di essere
    // saturo, il numero misurato non sarebbe piu' il caso peggiore.
    expect(pagina.title).toHaveLength(DOCUMENT_LIMITS.page_title); // covers: AC-202-6
    expect(pagina.meta_description).toHaveLength(DOCUMENT_LIMITS.meta_description); // covers: AC-202-6
    expect(pagina.slug).toHaveLength(DOCUMENT_LIMITS.page_slug); // covers: AC-202-6
    expect(pagina.blocks).toHaveLength(DOCUMENT_LIMITS.blocks_per_page); // covers: AC-202-6
    const offerte = pagina.blocks.flatMap((b) =>
      Array.isArray(b.data.offerings) ? b.data.offerings : [],
    );
    expect(offerte).toHaveLength(BRIEF_LIMITS.offerings_items); // covers: AC-202-6
    const slotResi = pagina.blocks.flatMap((b) => Object.keys(b.content));
    expect(slotResi.sort()).toEqual(SLOTS.map((slot) => slot.id).sort()); // covers: AC-202-6

    // E IL NUMERO RIPORTATO NON E' UN MASSIMO (rilievo V-202-06) — detto con una misura e
    // non con una prosa cauta. La partizione e' un'assunzione sulla distribuzione, non un
    // vincolo della forma: lo stesso documento in cui un SECONDO blocco per pagina rende
    // anche le offerte al tetto di P1-D17 e' altrettanto valido, e' ACCETTATO ed e' piu'
    // pesante. Il bound sull'insieme accettato e' DOCUMENT_LIMITS.max_bytes, che il test
    // successivo esercita.
    const piuPesante = documentoAiTetti();
    const offerteAlTetto = datiBriefAiTetti('extra', stringaAlTetto).offerings;
    for (const altraPagina of piuPesante.pages) {
      const blocco = altraPagina.blocks.find((b) => !b.brief_fields_rendered.includes('offerings'));
      if (!blocco) throw new Error('attesa una pagina con un blocco che non rende le offerte');
      blocco.data.offerings = offerteAlTetto;
      blocco.brief_fields_rendered.push('offerings');
    }
    const bytePiuPesante = pesoInByte(piuPesante);
    const rapportoNonMassimo =
      `[AC-202-6] il peso qui sopra e' quello di UNA configurazione, NON il massimo ` +
      `dell'insieme accettato: la stessa fixture in cui un secondo blocco per pagina rende ` +
      `le offerte al tetto pesa ${bytePiuPesante} byte ` +
      `(${(bytePiuPesante / 1024 / 1024).toFixed(3)} MiB, ` +
      `+${(((bytePiuPesante - byte) / byte) * 100).toFixed(1)}% sulla misura riportata), ` +
      `ed e' un documento VALIDO e ACCETTATO. Il bound sull'insieme accettato e' ` +
      `DOCUMENT_LIMITS.max_bytes, non questa misura.`;
    console.log(rapportoNonMassimo);

    expect(bytePiuPesante, rapportoNonMassimo).toBeGreaterThan(byte); // covers: AC-202-6
    expect(bytePiuPesante, rapportoNonMassimo).toBeLessThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-6
    expect(accettato(parseDocument(piuPesante)).pages, rapportoNonMassimo).toHaveLength(
      DOCUMENT_LIMITS.max_pages,
    ); // covers: AC-202-6
  });

  // covers: AC-202-6
  it('max_bytes e un tetto OPERATIVO: lo stesso documento, solo piu pesante, e rifiutato', () => {
    // I tetti per campo non limitano il PRODOTTO pagine x blocchi x campi: qui lo
    // stesso documento del caso peggiore replica la collezione piu' pesante (le
    // offerte al tetto di P1-D17) su altri blocchi. La forma resta valida — cambia
    // solo il peso — quindi l'unica ragione ammissibile del rifiuto e' il tetto di byte.
    // QUANTE repliche servano e' DERIVATO dal tetto e non scritto a mano: alzare
    // max_bytes non deve poter rendere questo test verde per assenza di materia.
    const pesante = documentoAiTetti();
    const offerteAlTetto = datiBriefAiTetti('extra', stringaAlTetto).offerings;
    const blocchi = pesante.pages.flatMap((pagina) => pagina.blocks);
    let replicate = 0;
    while (replicate < blocchi.length && pesoInByte(pesante) <= DOCUMENT_LIMITS.max_bytes) {
      const blocco = blocchi[replicate];
      blocco.data.offerings = offerteAlTetto;
      if (!blocco.brief_fields_rendered.includes('offerings')) {
        blocco.brief_fields_rendered.push('offerings');
      }
      replicate += 1;
    }
    expect(replicate).toBeLessThan(blocchi.length); // il tetto e' stato sfondato davvero

    const byte = pesoInByte(pesante);
    expect(byte).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-6
    const res = parseDocument(pesante);
    expect(res.ok).toBe(false); // covers: AC-202-6
    const troppoPesante = rifiutato(res).find((issue) => issue.code === 'too_big');
    if (troppoPesante?.code !== 'too_big') throw new Error('atteso un too_big sul peso');
    expect(troppoPesante.maximum).toBe(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-6
    expect(troppoPesante.path).toEqual([]); // covers: AC-202-6 — e' il documento intero

    // Gemello ACCETTATO: lo stesso documento senza la replica, sotto il tetto.
    expect(parseDocument(documentoAiTetti()).ok).toBe(true); // covers: AC-202-6
  });
});

describe('T-202 il caso peggiore MULTIBYTE (AC-202-7)', () => {
  // covers: AC-202-7
  it('lo stesso documento agli stessi tetti, in italiano e spagnolo accentati, pesa quasi il doppio ed e ACCETTATO', () => {
    const ascii = documentoAiTetti(stringaAlTetto);
    const accentato = documentoAiTetti(stringaAccentata);
    const byteAscii = pesoInByte(ascii);
    const byteAccentato = pesoInByte(accentato);
    const rapporto = byteAccentato / byteAscii;
    const margine = DOCUMENT_LIMITS.max_bytes / byteAccentato - 1;

    const rapportoTestuale =
      `[AC-202-7] caso peggiore MISURATO nelle due unita', a PARITA' di tetti per campo ` +
      `(che contano code unit UTF-16):\n` +
      `  ASCII      ${byteAscii} byte (${(byteAscii / 1024 / 1024).toFixed(3)} MiB) — ` +
      `${((byteAscii / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del budget\n` +
      `  ACCENTATO  ${byteAccentato} byte (${(byteAccentato / 1024 / 1024).toFixed(3)} MiB) — ` +
      `${((byteAccentato / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del budget\n` +
      `  rapporto multibyte/ASCII = x${rapporto.toFixed(3)}; ` +
      `tetto ${DOCUMENT_LIMITS.max_bytes} byte ` +
      `(${(DOCUMENT_LIMITS.max_bytes / 1024 / 1024).toFixed(1)} MiB), ` +
      `margine sul caso peggiore multibyte = ${(margine * 100).toFixed(1)}%.`;
    console.log(rapportoTestuale);

    // ENTRAMBE le misure sono riportate e il rapporto e' dichiarato: e' il cuore
    // dell'AC. Il rapporto e' anche ASSERITO, altrimenti un riempimento che smettesse
    // di essere multibyte renderebbe il test verde per assenza di materia.
    expect(rapporto, rapportoTestuale).toBeGreaterThan(1.8); // covers: AC-202-7
    expect(byteAccentato, rapportoTestuale).toBeGreaterThan(byteAscii); // covers: AC-202-7

    // Il tetto sta sopra la misura MULTIBYTE, non sopra quella ASCII.
    expect(byteAccentato, rapportoTestuale).toBeLessThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-7
    expect(margine, rapportoTestuale).toBeGreaterThan(0.2); // covers: AC-202-7 — margine dichiarato

    // E il documento accentato e' ACCETTATO, non solo leggero: con la politica di
    // non-troncamento un rifiuto qui sarebbe una generazione fallita in italiano e in
    // spagnolo, cioe' nelle sole due lingue che il prodotto serve.
    const documento: SiteDocument = accettato(parseDocument(accentato)); // covers: AC-202-7
    expect(documento.pages).toHaveLength(DOCUMENT_LIMITS.max_pages); // covers: AC-202-7
    expect(pesoInByte(documento)).toBe(byteAccentato); // covers: AC-202-7 — nessun troncamento

    // La fixture accentata e' agli STESSI tetti di quella ASCII: la differenza sta nei
    // byte, non nel numero di code unit. Se non fosse cosi', il rapporto misurerebbe
    // due documenti diversi invece delle due unita'.
    const pagina = documento.pages[0];
    expect(pagina.title).toHaveLength(DOCUMENT_LIMITS.page_title); // covers: AC-202-7
    expect(pagina.meta_description).toHaveLength(DOCUMENT_LIMITS.meta_description); // covers: AC-202-7
    expect(pagina.title.length).toBe(ascii.pages[0].title.length); // covers: AC-202-7
    // ...ma NON degli stessi byte: e' la divergenza fra le due unita', su un valore solo.
    expect(new TextEncoder().encode(pagina.title).length).toBeGreaterThan(pagina.title.length); // covers: AC-202-7
    expect(pagina.title).not.toBe(ascii.pages[0].title); // covers: AC-202-7
  });

  // covers: AC-202-7
  it('il CJK NON e coperto dal tetto, ed e DICHIARATO invece che implicito', () => {
    // I locale del prodotto sono DUE e si leggono dal brief, non da un commento: se un
    // giorno se ne aggiungesse uno ideografico, questa riga sarebbe la prima a cadere.
    expect(LOCALI).toEqual(['it', 'es']);

    const cjk = documentoAiTetti(stringaIdeogrammi);
    const byte = pesoInByte(cjk);
    const rapportoTestuale =
      `[AC-202-7] limite DICHIARATO: lo stesso caso peggiore in CJK pesa ${byte} byte ` +
      `(${(byte / 1024 / 1024).toFixed(3)} MiB), cioe' ` +
      `${((byte / DOCUMENT_LIMITS.max_bytes) * 100).toFixed(1)}% del tetto: NON entra. ` +
      `Il CJK non e' un locale del prodotto (${LOCALI.join(', ')}), quindi il tetto non e' ` +
      `dimensionato su di esso. Aggiungere un locale ideografico richiede di rivedere ` +
      `max_bytes (sopra ~9,0 MiB) o i tetti per campo: questa asserzione lo rende rosso ` +
      `invece di lasciarlo scoprire in produzione.`;
    console.log(rapportoTestuale);

    expect(byte, rapportoTestuale).toBeGreaterThan(DOCUMENT_LIMITS.max_bytes); // covers: AC-202-7
    expect(parseDocument(cjk).ok, rapportoTestuale).toBe(false); // covers: AC-202-7
  });
});
