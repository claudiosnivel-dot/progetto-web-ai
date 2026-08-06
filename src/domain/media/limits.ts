// T-413 (macrotask media-storage, P4) — CAP PURI della pipeline media (P4-D7). Vivono nel
// DOMINIO (nessun I/O, nessun sharp): sono decisioni di FORMA — quanti byte e quanti pixel
// accettiamo PRIMA di fidarci del decoder — oracolabili in memoria e condivise fra uploadAsset
// (src/data) e la sua batteria d'effetto.
//
// Perche' DUE tetti distinti (byte e pixel): un file piccolo in byte puo' espandersi a centinaia
// di megapixel in decodifica (decompression bomb → DoS, un PNG a tinta piatta compatta a pochi KB
// ma alloca width*height*canali in memoria). Il tetto in BYTE ferma il payload grezzo prima di
// toccare il decoder; il tetto in PIXEL va applicato sui metadati (header) PRIMA del decode
// completo, e ribadito come limitInputPixels sul pipeline (cintura + bretelle).

export const MEDIA_LIMITS = {
  /** Byte massimi del file caricato (raw), verificati PRIMA di ogni decode. Difesa in profondita'
   *  col file_size_limit del bucket site-assets (T-412, 10 MiB): stesso ordine di grandezza. */
  maxInputBytes: 10 * 1024 * 1024, // 10 MiB

  /** Pixel massimi (width * height) del raster in ingresso: la guardia anti decompression-bomb.
   *  Applicata sui metadati dell'header e come limitInputPixels del decoder sharp. */
  maxInputPixels: 40_000_000, // 40 MP

  /** Lato massimo del raster RICODIFICATO: il resize e' fit-inside entro questo bound, senza
   *  ingrandire (withoutEnlargement). Tiene gli oggetti serviti a una taglia web sensata. */
  maxDimension: 2048,
} as const;
