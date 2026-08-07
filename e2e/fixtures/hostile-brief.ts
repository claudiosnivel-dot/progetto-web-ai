import { randomUUID } from 'node:crypto';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { RECIPES } from '@/domain/generation/recipes';
import { resolveVariantHome } from '@/domain/generation/variant-document';
import { parseDocument, type ImageSlot, type SiteDocument } from '@/domain/generation/document';
import { extractBusinessInfo } from '@/domain/generation/site-seo';
import { innocuousHomePool } from './innocuous-document';

// T-241 (macrotask generation-e2e, P2) — IL BRIEF OSTILE e il documento che ne deriva. In jsdom
// (P1) i sei payload qui sotto sono inerti PER COSTRUZIONE — "nessun elemento nasce dal testo del
// brief" e' una proprieta' della FORMA. Questo fixture li porta a documento attraverso il PERCORSO
// REALE (resolveVariantHome -> resolve -> parseDocument), cosi' l'anteprima in un browser vero puo'
// asserire l'EFFETTO: nessuno script ha girato, nessuna richiesta verso l'host dell'attaccante,
// nessuna navigazione (T-241, hostile-document.spec.ts).
//
// I SEI PAYLOAD, ciascuno nel campo ESATTO in cui il renderer lo esercita (mappa dei FATTI di T-241):
//  1. tag <script>                 -> offerings[].name          (Offerte, span testo)
//  2. attributo d'evento (onerror) -> offerings[].description   (Offerte, span testo)
//  3. href javascript:             -> social_links[]            (Contatti, span testo: safeHttpsHref lo rifiuta)
//  4. <iframe srcdoc>              -> offerings[].description   (Offerte, span testo)
//  5. url() di CSS                 -> offerings[].description   (testo: nessun campo entra in CSS reale)
//  6. URL verso host attaccante    -> offerings[].photo_ref (STRIPPATO dal documento, T-202/T-214)
//                                     E ripetuto in offerings[].description come TESTO, cosi' AC-241-6
//                                     ("presente come testo") vale mentre AC-241-2 ("nessuna richiesta
//                                     verso l'host attaccante") prova che l'intera catena tiene.
//
// Ogni payload TENTA di incrementare la sentinella globale `window.__belora_pwned`: se uno qualunque
// eseguisse, AC-241-1 lo vedrebbe. E' cio' che rende le asserzioni sull'ASSENZA di effetto non vacue,
// esattamente come il canary di T-240 tenta l'iniezione per davvero.

/** L'host dell'attaccante: NESSUNA richiesta di rete deve raggiungerlo (AC-241-2). */
export const ATTACKER_HOST = 'attacker.example';

/**
 * I SEI PAYLOAD OSTILI, come stringhe. Sono esposti perche' AC-241-6 (rete anti-placebo) asserisce
 * che TUTTI E SEI compaiano nel DOM come CONTENUTO TESTUALE: se il testo ostile fosse scartato a
 * monte, le asserzioni sull'assenza di effetto passerebbero senza aver provato nulla.
 */
export const HOSTILE_PAYLOADS = {
  /** 1 — un tag script: via innerHTML girerebbe; via l'escape di React e' testo. */
  scriptTag: '<script>window.__belora_pwned=(window.__belora_pwned||0)+1</script>',
  /** 2 — un elemento con gestore d'evento: la classe di XSS che innerHTML consente davvero. */
  eventAttribute: '<img src=x onerror="window.__belora_pwned=(window.__belora_pwned||0)+1">',
  /** 3 — uno schema javascript: in un link: safeHttpsHref lo rifiuta, resta testo. */
  javascriptHref: 'javascript:window.__belora_pwned=(window.__belora_pwned||0)+1',
  /** 4 — un iframe con srcdoc: un documento annidato che tenterebbe la sentinella del padre. */
  iframeSrcdoc:
    '<iframe srcdoc="<script>parent.__belora_pwned=(parent.__belora_pwned||0)+1</script>"></iframe>',
  /** 5 — una url() di CSS verso l'host attaccante: nessun campo del brief entra in uno stile reale. */
  cssUrl: 'x{background:url(https://attacker.example/bg.png)}',
  /** 6 — l'URL verso l'host attaccante, lo STESSO messo in photo_ref (poi strippato). */
  photoRefUrl: 'https://attacker.example/evil.png',
} as const;

/** Il nome dell'attivita' del brief ostile, reso da Hero (block.data.business_name). */
const HOSTILE_BUSINESS_NAME = 'Osteria del Vicolo';

/**
 * T-417 (macrotask e2e-public, P4) — IL PAYLOAD DI BREAKOUT PER IL JSON-LD, separato da
 * HOSTILE_PAYLOADS (che resta ESATTAMENTE sei, pinnato da AC-241-2/AC-317-2/AC-417-2 e da
 * tests/site-document-schema): questa costante NON entra in quell'oggetto.
 *
 * Alimenta il `business_name` (che diventa `name` del LocalBusiness JSON-LD, T-410) e tenta le DUE
 * strade con cui un campo non fidato scapperebbe da `<script type="application/ld+json">`:
 *  - BREAKOUT DAL TAG — la sequenza di chiusura `</script>` seguita da uno `<script>` che incrementa
 *    la sentinella globale, poi di nuovo `</script>`: se il testo uscisse grezzo, quel secondo script
 *    ESEGUIREBBE. `serializeJsonLdSafe` (T-410) escapa `<` `>` `&` a `\uXXXX`, rendendo la chiusura
 *    del tag IRRAPPRESENTABILE nella stringa iniettata (AC-417-4);
 *  - SEPARATORI DI RIGA U+2028/U+2029 — che spezzerebbero il contesto JS: scritti come sequenze di
 *    escape `\u2028`/`\u2029` nel SORGENTE (nessun code point grezzo qui, come nel modulo jsonld.ts),
 *    sono nel MEZZO del payload (non in coda) perche' `business_name` passa da `z.string().trim()` e
 *    i due separatori SONO LineTerminator per ECMAScript: in coda verrebbero potati dal trim, nel
 *    mezzo restano. La stringa termina con un marcatore non-whitespace ('breakout') cosi' nulla del
 *    payload si perde nel trim.
 * Porta anche i caratteri grezzi `<` `>` `&`. Tenta di incrementare `window.__belora_pwned`: se
 * eseguisse, l'oracolo lo vedrebbe (asserzioni non vacue, come i sei payload).
 */
export const JSONLD_BREAKOUT_PAYLOAD =
  '</script><script>window.__belora_pwned=(window.__belora_pwned||0)+1</script>' +
  '<>&\u2028\u2029breakout';

/**
 * IL BRIEF OSTILE. Tre offerte, DISCORDANTI, con la trappola del prefisso ('Tagliere' e' PREFISSO
 * di 'Tagliere della casa'): una fixture con un'offerta sola, o senza il prefisso, non proverebbe
 * nulla sull'identita' di cio' che viene reso (lezione P1, correzione di metodo n.1). I payload sono
 * distribuiti sui campi esatti della mappa qui sopra; ogni offerta e' valida contro OfferingSchema
 * (altrimenti applyBriefUpdate scarterebbe l'INTERO array e i payload non arriverebbero al documento).
 *
 * `businessName` e' PARAMETRIZZATO col default = HOSTILE_BUSINESS_NAME (T-417): senza argomento il
 * brief e' IDENTICO a quello di T-241/T-317 (nessuna regressione di buildHostileDocument), mentre la
 * variante pubblicata (buildPublishedHostileDocument) inietta nel nome il payload di breakout del
 * JSON-LD senza toccare i sei payload delle offerte/social.
 */
function hostileBrief(businessName: string = HOSTILE_BUSINESS_NAME) {
  return applyBriefUpdate(emptyBrief('it'), {
    business_name: businessName,
    vertical: 'ristorazione',
    primary_goal: 'contatta',
    // Un indirizzo (un LUOGO, reso come testo, nessun href) fa esistere il blocco contatti — la sola
    // sede che rende `social_links` (blocks.ts): senza un canale o un indirizzo quel blocco non
    // comparirebbe e il payload javascript: non arriverebbe alla pagina (P2-D7).
    address: 'Vicolo Stretto 3, Napoli',
    offerings: [
      {
        // 1 (script) nel nome, 2 (attributo d'evento) nella descrizione.
        name: `Bruschette al ragu ${HOSTILE_PAYLOADS.scriptTag}`,
        description: `Servite calde ${HOSTILE_PAYLOADS.eventAttribute}`,
        section: 'Antipasti',
      },
      {
        // 4 (iframe srcdoc) nella descrizione. 'Tagliere' e' PREFISSO dell'offerta successiva.
        name: 'Tagliere',
        description: `Salumi e formaggi ${HOSTILE_PAYLOADS.iframeSrcdoc}`,
        section: 'Antipasti',
      },
      {
        // 5 (url CSS) e 6 (URL attaccante, ripetuto come testo) nella descrizione; 6 anche in photo_ref.
        name: 'Tagliere della casa',
        description: `Stagionatura lenta ${HOSTILE_PAYLOADS.cssUrl} foto ${HOSTILE_PAYLOADS.photoRefUrl}`,
        photo_ref: HOSTILE_PAYLOADS.photoRefUrl,
        section: 'Salumi',
      },
    ],
    // 3 (javascript:) fra i social. Due voci DISCORDANTI: nessuna diventa un href (Contatti le rende
    // come <span> testo), quindi restano prova di payload, non superficie di rete.
    social_links: [HOSTILE_PAYLOADS.javascriptHref, "javascript:alert('vicolo')"],
  }).brief;
}

/**
 * COSTRUISCE il documento OSTILE attraverso il percorso REALE: la prosa narrativa e' il pool INNOCUO
 * di T-240 (l'attacco vive nei campi del brief, non nella prosa del modello), la ricetta e' la prima
 * del catalogo. `resolveVariantHome` passa da `parseDocument`: se il documento non fosse valido
 * ritornerebbe `null`, e qui e' un errore da vedere, non da ingoiare — il fixture DEVE produrre un
 * documento reso, altrimenti AC-241-6 (payload presenti nel DOM) non proverebbe nulla.
 */
export function buildHostileDocument(): SiteDocument {
  const resolved = resolveVariantHome(innocuousHomePool(), RECIPES[0], hostileBrief());
  if (resolved === null) {
    throw new Error('fixture ostile: il documento home non ha superato parseDocument');
  }
  return resolved.document;
}

/**
 * T-417 (macrotask e2e-public, P4) — IL DOCUMENTO PUBBLICATO OSTILE per la rotta /s/<slug>. Estende
 * buildHostileDocument con le DUE superfici nuove del serving pubblico:
 *  a. un `business_name` che porta anche il breakout del JSON-LD (HOSTILE_BUSINESS_NAME + ' ' +
 *     JSONLD_BREAKOUT_PAYLOAD), cosi' `extractBusinessInfo(doc).name` — quindi il campo `name` del
 *     LocalBusiness (T-410) — trasporta la sequenza di breakout;
 *  b. un ImageSlot `uploaded` che nomina `assetId` promosso nel PRIMO slot immagine del PRIMO blocco
 *     della home che ne ha almeno uno (l'hero, che apre la pagina: `resolve` gli da' un solo
 *     theme-placeholder, T-214 decisione 4). Diventa l'HERO uploaded — l'unico `uploaded` del
 *     documento — quindi `extractBusinessInfo(doc).heroAssetId === assetId`.
 *
 * Il documento passa lo STESSO percorso reale di buildHostileDocument (resolveVariantHome ->
 * parseDocument) e poi RI-ATTRAVERSA parseDocument dopo la mutazione (A05:2025): i payload provati
 * sono quelli che il gate lascia passare, e `assetId` e' verificato come uuid dal gate. Lancia se un
 * invariante non tiene (resolve fallito, nessuno slot immagine, hero != assetId, un payload perso, o
 * il gate rifiuta): il fixture DEVE rendere un hero uploaded e i sei payload, o non prova nulla.
 *
 * @param assetId l'uuid dell'asset caricato (una riga assets + oggetto Storage reali: seedAsset).
 */
export function buildPublishedHostileDocument(assetId: string): SiteDocument {
  const brief = hostileBrief(`${HOSTILE_BUSINESS_NAME} ${JSONLD_BREAKOUT_PAYLOAD}`);
  const resolved = resolveVariantHome(innocuousHomePool(), RECIPES[0], brief);
  if (resolved === null) {
    throw new Error('fixture pubblicata ostile: il documento home non ha superato parseDocument');
  }
  const base = resolved.document;

  // Lo slot COSTRUITO da noi: due chiavi, nessuno spread di input non fidato (P2-D12: l'unione non
  // ha alcun campo url/src/href; l'src lo costruira' SiteImage da assetPublicUrl(asset_id)).
  const uploaded: ImageSlot = { source: 'uploaded', asset_id: assetId };

  // Promozione nel PRIMO slot immagine del PRIMO blocco (in ordine di documento) che ne ha almeno
  // uno: la home ha una sola pagina (resolveVariantHome) e l'hero e' il solo blocco con un'immagine.
  let promoted = false;
  const pages = base.pages.map((page) => {
    if (promoted) return page;
    let pageChanged = false;
    const blocks = page.blocks.map((block) => {
      if (promoted || block.images.length === 0) return block;
      promoted = true;
      pageChanged = true;
      const images = block.images.map((image, index) => (index === 0 ? uploaded : image));
      return { ...block, images };
    });
    return pageChanged ? { ...page, blocks } : page;
  });
  if (!promoted) {
    throw new Error('fixture pubblicata ostile: nessuno slot immagine da promuovere a uploaded (hero atteso)');
  }

  // RI-GATE dopo la mutazione: assetId deve essere un uuid e gli invarianti intatti.
  const parsed = parseDocument({ ...base, pages });
  if (!parsed.ok) {
    throw new Error('fixture pubblicata ostile: il documento mutato non ha superato parseDocument');
  }
  const document = parsed.document;

  // GUARDRAIL della fixture — l'hero uploaded e' ESATTAMENTE assetId (primo uploaded, home-first).
  const info = extractBusinessInfo(document);
  if (info.heroAssetId !== assetId) {
    throw new Error(`fixture pubblicata ostile: heroAssetId (${String(info.heroAssetId)}) != assetId (${assetId})`);
  }
  // GUARDRAIL della fixture — tutti e sei i payload restano TESTO nel documento (nessuno scartato).
  // Si confrontano i VALORI STRINGA GREZZI (foglie del documento), non JSON.stringify: due payload
  // portano il carattere `"` (l'onerror e il srcdoc), che la serializzazione JSON escaperebbe a `\"`
  // mancando il match — mentre nel DOM reso e nel testo del brief il carattere resta grezzo (e' cosi'
  // che lo spec li cerca in document.body.textContent, come T-241/T-317).
  const leaves: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') leaves.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(document);
  const joined = leaves.join('\n');
  for (const payload of Object.values(HOSTILE_PAYLOADS)) {
    if (!joined.includes(payload)) {
      throw new Error('fixture pubblicata ostile: un payload di HOSTILE_PAYLOADS non e nel documento come testo');
    }
  }
  return document;
}

/**
 * T-417 (macrotask e2e-public, P4) — DUE uuid v4 validi che condividono i primi 35 caratteri e
 * differiscono SOLO nell'ultima cifra esadecimale (randomUUID + flip dell'ultimo hex via XOR 1).
 *
 * PERCHE' UNA NEAR-COLLISION E NON UN VERO PREFISSO: `asset_id` e' uno uuid (schema
 * `z.string().uuid()`, document.ts) — lunghezza FISSA 36 — quindi un vero prefisso PROPRIO fra due
 * uuid validi e' IRRAPPRESENTABILE (entrambi devono passare parseDocument). La coppia 1-char-off e'
 * la realizzazione fedele della trappola di prefisso di AC-417-3, la STESSA gia' VERDE in T-415/M5
 * (site-image-uploaded, jsonld/seo): chi selezionasse per prefisso invece che per identita' esatta
 * le confonderebbe. `used` finisce nel documento (l'hero); `sibling` esiste come secondo asset
 * DISCORDANTE (seedAsset) perche' la fixture abbia >1 elemento con la coppia di prefisso.
 */
export function nearCollisionUuids(): { used: string; sibling: string } {
  const used = randomUUID();
  const lastHex = used.slice(-1);
  // XOR 1 su una cifra hex 0..f da' sempre una cifra hex DIVERSA e valida (differisce di un bit).
  const flipped = (parseInt(lastHex, 16) ^ 1).toString(16);
  const sibling = used.slice(0, -1) + flipped;
  return { used, sibling };
}
