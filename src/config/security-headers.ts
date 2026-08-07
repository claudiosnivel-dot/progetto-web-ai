// (deploy pass) T-3 — SECURITY HEADER + CSP della SUPERFICIE PUBBLICA `/s/<slug>`.
// Difesa in PROFONDITA' (defense-in-depth): la difesa PRIMARIA contro l'iniezione resta
// la SANIFICAZIONE — renderer UNICO SiteView (escaping React, nessun dangerouslySetInnerHTML),
// serializer JSON-LD anti-breakout, re-encode degli upload — provata sull'effetto (T-241/T-317/T-417).
// La CSP e' la cintura oltre le bretelle, non il tappo di un buco.
//
// Layer-neutro (come src/config/storage.ts): nessun accesso a `data`/`ui`; legge solo config
// pubblica (NEXT_PUBLIC_SUPABASE_URL, gia' l'origine che il browser usa). Builder PURI, testabili,
// e importati da next.config.ts (che applica gli header a `/s/:path*`).
//
// LIMITE DICHIARATO su `script-src`: la rotta pubblica sta FUORI dal middleware (T-406), quindi
// non c'e' un nonce per-richiesta; Next inietta script inline (bootstrap/RSC). Percio' `script-src`
// ammette `'unsafe-inline'` — che indebolisce la protezione XSS della CSP, MA la protezione XSS
// vera vive nell'escaping del renderer unico, non qui. Il valore reale di questa CSP e' altrove:
// `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'` e
// soprattutto `img-src` ristretto a self + il NOSTRO host Storage — che rinforza P2-D12 (le
// immagini nascono SOLO dal nostro asset_id, mai da un host arbitrario): anche un <img> ostile
// verso un host terzo verrebbe bloccato dal browser.

/**
 * L'origine (scheme + host + porta) dello Storage pubblico, derivata da NEXT_PUBLIC_SUPABASE_URL
 * (la stessa da cui `assetPublicUrl` costruisce gli URL degli asset). `null` se assente/malformata:
 * in quel caso la CSP semplicemente non allowlista un host Storage (fail-closed sulla forma, non
 * un crash della config).
 */
export function supabaseStorageOrigin(source: Record<string, string | undefined> = process.env): string | null {
  const raw = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (raw === undefined || raw === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * La Content-Security-Policy della pagina pubblica. `storageOrigin` (se presente) e' ammesso in
 * `img-src`/`connect-src` cosi' che l'`<img>` dell'asset uploaded e le richieste RSC carichino;
 * ogni altra origine e' negata.
 */
export function buildPublicSiteCsp(storageOrigin: string | null): string {
  const img = ["'self'", 'data:', storageOrigin].filter((v): v is string => Boolean(v)).join(' ');
  const connect = ["'self'", storageOrigin].filter((v): v is string => Boolean(v)).join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Gli header di sicurezza da applicare a `/s/:path*` (next.config). CSP + i classici:
 * nosniff (no MIME sniffing), Referrer-Policy stretta, X-Frame-Options/frame-ancestors
 * (anti-clickjacking), HSTS (onorato solo su https: innocuo in dev su http), Permissions-Policy
 * che spegne feature che un sito pubblicato non usa.
 */
export function publicSecurityHeaders(
  source: Record<string, string | undefined> = process.env,
): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: buildPublicSiteCsp(supabaseStorageOrigin(source)) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  ];
}
