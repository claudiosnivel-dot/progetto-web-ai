'use server';

import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { getAuthedClient } from '@/data/authed-client';
import { SITE_ASSETS_BUCKET } from '@/config/storage';
import { MEDIA_LIMITS } from '@/domain/media/limits';
import { sniffRasterMime, type RasterMime } from '@/domain/media/sniff';

// T-413 (macrotask media-storage, P4) — UPLOAD NON FIDATO: la prima volta che byte dell'utente
// entrano nel sistema. La regola e' che non ci si fida MAI del byte caricato, e la difesa e'
// provata sull'EFFETTO (i byte effettivamente memorizzati), non sull'intenzione:
//
//  - A05:2025 (unrestricted upload). Il content-type e' deciso per MAGIC-BYTES lato server
//    (sniffRasterMime, dominio puro), MAI dal mime/estensione dichiarati dal client. SVG e ogni
//    non-raster sniffano a null e sono RIFIUTATI a monte di sharp — che invece decodificherebbe
//    l'SVG (via librsvg) rasterizzando un vettore di XSS stored.
//
//  - A03:2025 (injection) — IL RE-ENCODE E' LA DIFESA. Ogni raster accettato e' RICODIFICATO con
//    sharp: `.rotate()` baka l'orientamento EXIF, il resize fit-inside lo porta entro il cap, e
//    l'assenza di withMetadata STRIPPA tutti i metadata (EXIF/GPS/commenti). Un polyglot con
//    payload appeso in coda perde la coda: l'output contiene SOLO dati immagine, byte diversi
//    dall'input. Non si salvano MAI i byte grezzi.
//
//  - DoS (decompression bomb). Un cap in BYTE ferma il payload grezzo prima del decode; un cap in
//    PIXEL sui metadati dell'header ferma l'immagine molto compressa che si espande, e
//    limitInputPixels lo ribadisce nel decoder (MEDIA_LIMITS, dominio).
//
//  - A01:2025 — CLIENT DI SESSIONE, MAI service_role. L'ownership del sito e' verificata sotto RLS
//    PRIMA di ogni altra cosa: un site_id di un altro tenant (o inesistente) filtra a insieme
//    vuoto -> 404 (anti-enumerazione P1-D21), senza toccare i byte e senza alcuna scrittura. Il
//    controllo precede la validazione del file cosi' che "sito altrui" e "file altrui invalido"
//    siano indistinguibili dall'esterno. account_id NON arriva dal client: e' DERIVATO dalla riga
//    di sites letta sotto RLS, cosi' la WITH CHECK di assets (is_account_member) e la FK composita
//    (account_id, site_id)->sites non possono che vedere l'account proprio.
//
//  - P4-D6a — CHIAVE PIATTA. L'oggetto Storage vive alla chiave = asset_id (uuid v4 opaco,
//    generato server-side, non enumerabile): A non puo' predire/scegliere la chiave di B, e la RLS
//    storage a confine-owner (T-412) valorizza owner = auth.uid(). assets.storage_path = asset_id,
//    da cui assetPublicUrl (M3) costruisce l'URL pubblico dal SOLO id (P2-D12).

/** L'esito di un upload: l'asset_id della riga/oggetto creati, oppure un esito d'errore. */
export type UploadAssetResult =
  | { ok: true; asset_id: string }
  | { ok: false; status: 400 | 401 | 404 | 500 };

/** Il tipo del pipeline sharp (il modulo e' `export = sharp`: si deriva dal valore, non da un namespace). */
type SharpPipeline = ReturnType<typeof sharp>;

/**
 * Applica al pipeline l'encoder del formato raster sniffato: si RESTA nella famiglia del formato
 * reale (jpeg->jpeg, png->png, webp->webp). Nessun withMetadata → i metadata sono strippati.
 */
function encodeAs(pipeline: SharpPipeline, mime: RasterMime): SharpPipeline {
  switch (mime) {
    case 'image/jpeg':
      return pipeline.jpeg();
    case 'image/png':
      return pipeline.png();
    case 'image/webp':
      return pipeline.webp();
  }
}

/**
 * Carica un asset per un sito POSSEDUTO: sniffa il formato per magic-bytes, ricodifica con sharp
 * (strip EXIF, orientamento bakato, resize entro il cap), scrive i byte PULITI su Storage alla
 * chiave piatta = asset_id e inserisce la riga assets. Rifiuta SVG / sniff fallito / oltre i cap
 * senza salvare nulla.
 *
 * @param siteId il sito destinatario (RLS-backed: un id di un altro tenant filtra a 404).
 * @param file il file caricato: i suoi byte sono l'unica verita', mai file.type / file.name.
 * @returns `{ ok: true, asset_id }` a upload avvenuto; `{ ok: false, status }` altrimenti — 400
 *   file non ammesso/oltre i cap, 401 senza sessione, 404 sito altrui/inesistente, 500 guasto di
 *   lettura/scrittura o di Storage.
 */
export async function uploadAsset(siteId: string, file: File): Promise<UploadAssetResult> {
  // Client di SESSIONE (RLS attiva, mai service_role — A01:2025). L'assenza di sessione -> 401.
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const { supabase } = gate;

  // OWNERSHIP PRIMA di tutto (anti-enumerazione P1-D21). Un sito non posseduto (o inesistente)
  // filtra a null sotto RLS -> 404, prima di toccare i byte: nessuna scrittura, nessuna differenza
  // osservabile fra "sito altrui" e "file altrui invalido". account_id DERIVATO da qui, mai dal client.
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('account_id')
    .eq('id', siteId)
    .maybeSingle();
  if (siteErr) return { ok: false, status: 500 };
  if (!site) return { ok: false, status: 404 };
  const accountId = (site as { account_id: string }).account_id;

  // I byte del file: l'unica verita'. Mai file.type / file.name.
  const input = new Uint8Array(await file.arrayBuffer());

  // CAP BYTE (prima di ogni decode): guardia DoS. Vuoto o oltre il tetto -> rifiuto.
  if (input.byteLength === 0 || input.byteLength > MEDIA_LIMITS.maxInputBytes) {
    return { ok: false, status: 400 };
  }

  // SNIFF magic-bytes: il formato REALE, non quello dichiarato. SVG/non-raster -> null -> rifiuto,
  // a monte di sharp (che rasterizzerebbe l'SVG).
  const mime = sniffRasterMime(input);
  if (!mime) return { ok: false, status: 400 };

  // METADATA + CAP PIXEL (guardia decompression-bomb) sull'header, prima del re-encode completo.
  let inWidth: number | undefined;
  let inHeight: number | undefined;
  try {
    const meta = await sharp(input, { limitInputPixels: MEDIA_LIMITS.maxInputPixels }).metadata();
    inWidth = meta.width;
    inHeight = meta.height;
  } catch {
    // Header non decodificabile come immagine (magic-bytes plausibili ma contenuto rotto) -> rifiuto.
    return { ok: false, status: 400 };
  }
  if (!inWidth || !inHeight || inWidth * inHeight > MEDIA_LIMITS.maxInputPixels) {
    return { ok: false, status: 400 };
  }

  // RE-ENCODE — la difesa provata sull'EFFETTO. .rotate() baka l'orientamento EXIF; resize
  // fit-inside entro il cap senza ingrandire; NIENTE withMetadata → EXIF/GPS/commenti strippati;
  // output nel formato raster sniffato; limitInputPixels ribadito (cintura+bretelle). I byte
  // prodotti contengono SOLO dati immagine: qualunque payload appeso all'input sparisce.
  let clean: Buffer;
  let outWidth: number;
  let outHeight: number;
  try {
    const { data, info } = await encodeAs(
      sharp(input, { limitInputPixels: MEDIA_LIMITS.maxInputPixels })
        .rotate()
        .resize({
          width: MEDIA_LIMITS.maxDimension,
          height: MEDIA_LIMITS.maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        }),
      mime,
    ).toBuffer({ resolveWithObject: true });
    clean = data;
    outWidth = info.width;
    outHeight = info.height;
  } catch {
    return { ok: false, status: 400 };
  }

  // asset_id opaco (uuid v4) = CHIAVE PIATTA dello Storage (P4-D6a): A non puo' predire/scegliere
  // la chiave; l'owner dell'oggetto sara' auth.uid() (RLS storage a confine-owner, T-412).
  const assetId = randomUUID();

  // Byte PULITI su Storage (mai i grezzi). Client di SESSIONE → owner = auth.uid(); upsert=false
  // cosi' un asset_id gia' esistente (collisione astronomica) non sovrascrive nulla.
  const up = await supabase.storage
    .from(SITE_ASSETS_BUCKET)
    .upload(assetId, new Blob([new Uint8Array(clean)], { type: mime }), {
      contentType: mime,
      upsert: false,
    });
  if (up.error) return { ok: false, status: 500 };

  // Riga assets: account_id dal SITO (sotto RLS, mai dal client), storage_path = asset_id, mime/
  // width/height dai byte di OUTPUT. La WITH CHECK (is_account_member) e la FK composita sono il
  // gate DB. Fallito l'insert, l'oggetto orfano va rimosso (best-effort): niente byte senza riga.
  const ins = await supabase.from('assets').insert({
    account_id: accountId,
    site_id: siteId,
    storage_path: assetId,
    mime,
    width: outWidth,
    height: outHeight,
  });
  if (ins.error) {
    try {
      await supabase.storage.from(SITE_ASSETS_BUCKET).remove([assetId]);
    } catch {
      /* best effort: l'oggetto resta orfano solo se anche il remove fallisce */
    }
    return { ok: false, status: 500 };
  }

  return { ok: true, asset_id: assetId };
}
