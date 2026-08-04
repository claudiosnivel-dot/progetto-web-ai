import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { RECIPES } from '@/domain/generation/recipes';
import { resolveVariantHome } from '@/ui/generation/variant-document';
import type { SiteDocument } from '@/domain/generation/document';
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
 * IL BRIEF OSTILE. Tre offerte, DISCORDANTI, con la trappola del prefisso ('Tagliere' e' PREFISSO
 * di 'Tagliere della casa'): una fixture con un'offerta sola, o senza il prefisso, non proverebbe
 * nulla sull'identita' di cio' che viene reso (lezione P1, correzione di metodo n.1). I payload sono
 * distribuiti sui campi esatti della mappa qui sopra; ogni offerta e' valida contro OfferingSchema
 * (altrimenti applyBriefUpdate scarterebbe l'INTERO array e i payload non arriverebbero al documento).
 */
function hostileBrief() {
  return applyBriefUpdate(emptyBrief('it'), {
    business_name: HOSTILE_BUSINESS_NAME,
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
