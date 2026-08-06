// T-410 (macrotask seo-base, P4) — IL JSON-LD LocalBusiness della pagina pubblica, e la sua
// SERIALIZZAZIONE SICURA. Dominio PURO: nessun accesso all'ambiente, nessun I/O, nessuna
// costruzione di URL da env. Chi ha un'immagine da pubblicare (l'hero uploaded) passa gia'
// costruito l'URL dello Storage in `opts.image` — l'indirizzo nasce dall'asset_id nell'app layer
// (assetPublicUrl), MAI da testo libero del brief (P2-D12), e qui non c'e' alcun campo che possa
// portarne uno che non sia gia' un URL nostro.
//
// PERCHE' IL JSON-LD E' UN PUNTO DI SICUREZZA, NON DECORAZIONE (A03:2025 injection). I campi del
// brief (nome, indirizzo, telefono, orari) sono INPUT NON FIDATO: arrivano dal modello e da siti
// terzi. Iniettati grezzi dentro `<script type="application/ld+json">…</script>` potrebbero CHIUDERE
// il tag (con `</` + `script>`) e riaprirne uno eseguibile, o spezzare il contesto JS coi separatori
// di riga U+2028/U+2029. `serializeJsonLdSafe` neutralizza entrambe le strade PRIMA che la stringa
// raggiunga la pagina: `<`, `>`, `&` e i due separatori diventano escape unicode che un parser JSON
// ricostruisce (round-trip trasparente, AC-410-4) ma che un parser HTML non puo' piu' leggere come
// markup — dopo l'escape la sequenza di chiusura del tag e' IRRAPPRESENTABILE nella stringa.
//
// COME SI MONTA (e perche' NON con innerHTML grezzo). La rotta passa la stringa GIA' ESCAPED come
// FIGLIO TESTUALE del <script>. Poiche' dopo l'escape la stringa non contiene piu' alcun `<`, `>` o
// `&` grezzo, React non ha nulla da ri-escapare in entita' HTML (che dentro un raw-text element come
// <script> il browser non decodificherebbe comunque, corrompendo il JSON): cio' che esce e' byte per
// byte la stringa sicura. Un innerHTML grezzo del JSON, invece, lascerebbe passare la sequenza di
// chiusura del tag e romperebbe fuori dal <script> — per questo NON si usa.

import type { BusinessInfo } from '@/domain/generation/site-seo';

/**
 * L'oggetto LocalBusiness di schema.org, coi SOLI campi presenti nello snapshot. Ogni campo e'
 * opzionale: un brief incompleto produce un oggetto piu' piccolo, mai una chiave con valore
 * `undefined`. Nessun campo privato del tenant (account_id / source_generation_id) ha un posto qui —
 * l'oggetto e' costruito dai soli `BusinessInfo` estratti dai blocchi (A01:2025).
 */
export type LocalBusinessJsonLd = {
  readonly '@context': 'https://schema.org';
  readonly '@type': 'LocalBusiness';
  name?: string;
  address?: string;
  geo?: { readonly '@type': 'GeoCoordinates'; readonly latitude: number; readonly longitude: number };
  telephone?: string;
  openingHours?: string[];
  image?: string;
};

/**
 * Opzioni del builder. `image` e' l'URL dello Storage GIA' COSTRUITO dall'app layer (assetPublicUrl
 * a partire dall'asset_id dell'hero uploaded): il dominio non legge env e non compone indirizzi.
 * Assente quando lo snapshot non porta un hero uploaded — l'oggetto omette del tutto `image`.
 */
export type BuildJsonLdOpts = { readonly image?: string };

/**
 * Costruisce l'oggetto LocalBusiness mappando i dati d'attivita' estratti (`BusinessInfo`) sui campi
 * di schema.org. Emette SOLO i campi presenti (nessun `undefined`):
 *  - `name`         <- business_name;
 *  - `address`      <- address;
 *  - `geo`          <- geo (lat/lng) come GeoCoordinates (latitude/longitude);
 *  - `telephone`    <- phone;
 *  - `openingHours` <- hours, una stringa `"<etichetta> <orario>"` per voce, nell'ordine della mappa;
 *  - `image`        <- opts.image (URL dello Storage dall'asset_id dell'hero uploaded), se presente.
 *
 * I valori restano testo del brief (NON FIDATO): la difesa non e' qui, e' in `serializeJsonLdSafe`,
 * che li escapa quando l'oggetto diventa la stringa iniettata nel <script>.
 */
export function buildLocalBusinessJsonLd(
  info: BusinessInfo,
  opts: BuildJsonLdOpts = {},
): LocalBusinessJsonLd {
  const jsonld: LocalBusinessJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
  };
  if (info.name !== undefined) jsonld.name = info.name;
  if (info.address !== undefined) jsonld.address = info.address;
  if (info.geo !== undefined) {
    jsonld.geo = { '@type': 'GeoCoordinates', latitude: info.geo.lat, longitude: info.geo.lng };
  }
  if (info.phone !== undefined) jsonld.telephone = info.phone;
  if (info.hours !== undefined) {
    jsonld.openingHours = Object.entries(info.hours).map(([label, hours]) => `${label} ${hours}`);
  }
  if (opts.image !== undefined) jsonld.image = opts.image;
  return jsonld;
}

/**
 * I code point pericolosi dentro un `<script>`: `<` `>` `&` (breakout dal tag / entita' HTML) e i
 * separatori di riga U+2028 U+2029 (che spezzano il contesto JS). Scritti come escape unicode ASCII
 * nel pattern: nessun code point grezzo vive nel sorgente.
 */
const UNSAFE_IN_SCRIPT = /[<>&\u2028\u2029]/g;

/**
 * Serializza un oggetto in JSON e lo rende SICURO da iniettare come figlio testuale di
 * `<script type="application/ld+json">`: dopo `JSON.stringify`, ogni carattere di `UNSAFE_IN_SCRIPT`
 * diventa il suo escape unicode `\uXXXX` (`<` diventa <, `>` diventa >, `&` diventa &,
 * U+2028 diventa \u2028, U+2029 diventa \u2029).
 *
 * Gli escape sono TRASPARENTI a un parser JSON (la stringa round-trippa: `JSON.parse` ricostruisce
 * l'oggetto identico, AC-410-4) e OPACHI a un parser HTML: senza piu' `<`/`>`/`&` grezzi, la sequenza
 * di chiusura di `<script>` non e' rappresentabile e i separatori di riga non spezzano il contesto
 * JS. Un solo passaggio su tutti i caratteri: nessun rischio di doppio escape.
 */
export function serializeJsonLdSafe(obj: unknown): string {
  return JSON.stringify(obj).replace(
    UNSAFE_IN_SCRIPT,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}
