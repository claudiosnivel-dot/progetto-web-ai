// T-413 (macrotask media-storage, P4) — SNIFF PURO dei magic-bytes (P4-D7 / OWASP A05:2025).
//
// Il content-type NON si legge MAI dal mime/estensione DICHIARATI dal client (file.type /
// file.name sono testo dell'attaccante): si DERIVA dai primi byte reali del file. Solo i tre
// raster ammessi — JPEG, PNG, WebP — hanno qui una firma riconosciuta; ogni altra cosa sniffa a
// `null` e a valle e' RIFIUTATA:
//  - SVG (testo `<?xml`/`<svg`, vettore di XSS stored via `<script>`/`<foreignObject>`) non ha
//    una firma binaria e cade su `null` — rifiutato categoricamente;
//  - GIF/AVIF/TIFF/BMP e i polyglot con un mime FALSIFICATO (header non-immagine, es. HTML/JS che
//    inizia con `<`) cadono anch'essi su `null`.
//
// Perche' il gate del formato vive QUI e non e' delegato a sharp: sharp DECODIFICA anche l'SVG
// (via librsvg) e altri formati, quindi affidargli il "rifiuto SVG" lo rasterizzerebbe invece di
// respingerlo. Lo sniff a monte e' la linea che tiene fuori il non-raster prima che il decoder lo
// veda. Funzione PURA, oracolabile in memoria: nessun I/O, nessuna dipendenza.

export const ALLOWED_RASTER_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type RasterMime = (typeof ALLOWED_RASTER_MIME)[number];

/** Vero se `bytes` comincia ESATTAMENTE con la firma `sig` (confronto byte-per-byte). */
function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

// Firme binarie canoniche.
const SIG_JPEG = [0xff, 0xd8, 0xff]; // SOI + marker
const SIG_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // \x89PNG\r\n\x1a\n
const SIG_RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF" (container WebP)
const SIG_WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" a offset 8

/**
 * Il mime raster REALE dedotto dai magic-bytes, o `null` se i byte non sono uno dei tre raster
 * ammessi (SVG, GIF, formati non supportati, spazzatura polyglot → tutti `null`).
 * @param bytes i primi byte del file (o l'intero file): la decisione guarda solo l'header.
 */
export function sniffRasterMime(bytes: Uint8Array): RasterMime | null {
  if (startsWith(bytes, SIG_JPEG)) return 'image/jpeg';
  if (startsWith(bytes, SIG_PNG)) return 'image/png';
  // WebP: container RIFF con l'etichetta "WEBP" a offset 8 (i 4 byte di size stanno in mezzo).
  if (
    bytes.length >= 12 &&
    startsWith(bytes, SIG_RIFF) &&
    bytes[8] === SIG_WEBP[0] &&
    bytes[9] === SIG_WEBP[1] &&
    bytes[10] === SIG_WEBP[2] &&
    bytes[11] === SIG_WEBP[3]
  ) {
    return 'image/webp';
  }
  return null;
}
