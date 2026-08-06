// T-409 (macrotask seo-base, P4) — CONFIG dello Storage pubblico degli asset del sito. Un solo
// posto in cui vive il NOME del bucket e la FORMA dell'URL pubblico di un asset, cosi' che chi
// pubblica un'immagine (og:image, T-410) e chi il bucket lo CREA (M4/T-412) e lo RENDE (T-414)
// parlino tutti dello stesso bucket e compongano lo stesso indirizzo — un secondo template scritto
// altrove divergerebbe in silenzio.
//
// L'URL e' COSTRUITO DA NOI a partire da un asset_id (un uuid) e dall'origine dello Storage, MAI da
// testo libero del brief (P2-D12): l'unico ingresso e' l'id di una riga, che per forma non puo'
// essere un indirizzo. NEXT_PUBLIC_SUPABASE_URL e' config pubblica (l'origine che il browser gia'
// usa per l'anon client), non un segreto.

/**
 * Il bucket pubblico degli asset caricati per i siti. M4/T-412 DEVE creare il bucket con QUESTO
 * nome e T-414 DEVE riusare `assetPublicUrl` (non ridurre l'URL a mano): il nome sta qui una volta
 * sola.
 */
export const SITE_ASSETS_BUCKET = 'site-assets';

/**
 * L'URL pubblico di un asset dello Storage, nella forma del public object di Supabase Storage:
 * `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/<bucket>/<assetId>`. L'origine e' ripulita da
 * spazi e da slash in coda per non produrre `//`.
 * @param assetId l'uuid dell'asset (mai testo libero: l'indirizzo nasce dall'id, P2-D12).
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 */
export function assetPublicUrl(
  assetId: string,
  source: Record<string, string | undefined> = process.env,
): string {
  const origin = (source.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  return `${origin}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${assetId}`;
}
