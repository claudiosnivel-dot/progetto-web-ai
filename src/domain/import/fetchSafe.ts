import { lookup } from 'node:dns/promises';
import { Agent } from 'undici';

// T-140 (macrotask url-import, P1) — fetch server-side SSRF-safe: e' l'UNICA porta
// da cui l'import raggiunge un URL fornito dall'utente (OWASP A01:2025 / CWE-918).
//
// L'ordine dei controlli e' la sostanza della guardia: schema, poi risoluzione DNS,
// poi giudizio su TUTTI gli indirizzi risolti, e solo allora la connessione — che
// avviene sugli indirizzi APPENA validati (pinning), non su una nuova risoluzione.
// Cosi' fra il controllo e il socket non resta finestra per un DNS rebinding.
// I redirect non sono seguiti dal client: si ricomincia da capo a ogni hop, quindi
// una catena di redirect non e' una via per scavalcare il blocco.
//
// Il risultato e' una union discriminata: i casi previsti non lanciano. In caso di
// blocco NON esce nulla del target (niente body, niente header, niente status), e il
// motivo e' lo stesso sia che l'host interno esista sia che non risponda: la guardia
// non deve diventare un port scanner.

// Limiti: budget totale dell'operazione (tutti gli hop), catena di redirect e byte
// del body. Non sono configurabili: sono la superficie d'abuso, non una preferenza.
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 1_000_000;

// Best-effort di trasparenza verso i siti visitati (out_of_scope: robots/ToS).
const USER_AGENT = 'BeloraImportBot/1.0 (+https://belora.app/bot)';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
const ALLOWED_MEDIA_TYPE = 'text/html';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type ResolvedAddress = { readonly address: string; readonly family: number };

/** Risoluzione DNS di un hostname nudo (senza le parentesi quadre dell'IPv6). */
type AddressResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

/** Esecutore della singola richiesta, gia' vincolato agli indirizzi validati. */
type SafeTransport = (
  url: string,
  options: { readonly pinnedAddresses: readonly ResolvedAddress[]; readonly signal: AbortSignal },
) => Promise<Response>;

type FetchSafeDeps = {
  readonly resolve?: AddressResolver;
  readonly transport?: SafeTransport;
};

type FetchSafeReason =
  | 'scheme-not-allowed'
  | 'address-blocked'
  | 'content-type-not-allowed'
  | 'too-large'
  | 'too-many-redirects'
  | 'timeout'
  | 'network-error';

type FetchSafeResult =
  | { readonly ok: true; readonly html: string }
  | { readonly ok: false; readonly reason: FetchSafeReason };

/**
 * Scarica l'HTML di un URL fornito dall'utente, o spiega perche' non lo ha fatto.
 * @param rawUrl URL non fidato, cosi' come arriva dall'utente.
 * @param deps seam di test: risoluzione DNS e trasporto. Default: quelli reali.
 */
export async function fetchSafe(
  rawUrl: string,
  deps: FetchSafeDeps = {},
): Promise<FetchSafeResult> {
  const resolveAddresses = deps.resolve ?? systemResolve;
  const transport = deps.transport ?? pinnedFetch;
  // Budget unico per l'intera catena: un redirect non ricompra tempo.
  const signal = AbortSignal.timeout(TIMEOUT_MS);

  let target = rawUrl;
  // Una richiesta iniziale piu' MAX_REDIRECTS hop.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // 1. Schema — prima di qualunque I/O: uno schema non ammesso non produce
    //    nessuna richiesta, nemmeno una risoluzione DNS.
    const url = parseHttpUrl(target);
    if (url === null) return { ok: false, reason: 'scheme-not-allowed' };

    // 2. Risoluzione e giudizio su TUTTI gli indirizzi dell'host.
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await resolveAddresses(bareHostname(url));
    } catch {
      // Una risoluzione che FALLISCE e un host che risolve a un indirizzo interno
      // danno lo STESSO motivo. Distinguerli renderebbe la guardia un oracolo di
      // enumerazione del DNS interno: chi importa potrebbe sondare quali nomi
      // esistono nella rete del server leggendo il motivo del rifiuto.
      return { ok: false, reason: 'address-blocked' };
    }
    // Default DENY: zero indirizzi non e' "nulla da bloccare", e' assenza di
    // certezza; e basta un solo record privato per fermare tutto (un host puo'
    // pubblicarne piu' d'uno, e ne basta uno interno per fare danno).
    if (addresses.length === 0 || addresses.some((found) => isBlockedAddress(found.address))) {
      return { ok: false, reason: 'address-blocked' };
    }

    // 3. Connessione agli indirizzi appena validati.
    let response: Response;
    try {
      response = await transport(url.href, { pinnedAddresses: addresses, signal });
    } catch (error) {
      return { ok: false, reason: reasonFromError(error) };
    }

    // 4. Redirect a mano: il prossimo giro rifa' i controlli 1-3 sul nuovo target.
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await discardBody(response);
      const next = location === null ? null : absoluteUrl(location, url);
      if (next === null) return { ok: false, reason: 'network-error' };
      target = next;
      continue;
    }

    if (!response.ok) {
      await discardBody(response);
      return { ok: false, reason: 'network-error' };
    }

    // 5. Allowlist di content-type: si importa HTML, non file arbitrari.
    if (mediaTypeOf(response) !== ALLOWED_MEDIA_TYPE) {
      await discardBody(response);
      return { ok: false, reason: 'content-type-not-allowed' };
    }

    try {
      const html = await readLimitedBody(response);
      return html === null ? { ok: false, reason: 'too-large' } : { ok: true, html };
    } catch (error) {
      return { ok: false, reason: reasonFromError(error) };
    }
  }

  return { ok: false, reason: 'too-many-redirects' };
}

/**
 * Trasporto reale: esegue la richiesta connettendosi SOLO agli indirizzi pinnati.
 * Esportato perche' e' il default del seam e va provato contro un server vero.
 */
export async function pinnedFetch(
  url: string,
  options: { readonly pinnedAddresses: readonly ResolvedAddress[]; readonly signal: AbortSignal },
): Promise<Response> {
  // Il hook `lookup` sostituisce la risoluzione DNS del client: il socket va
  // esattamente dove ha guardato la guardia. L'URL NON viene riscritto con l'IP,
  // quindi Host header, SNI e verifica del certificato restano sull'hostname vero.
  const agent = new Agent({
    connect: {
      lookup: (_hostname, _lookupOptions, callback) => {
        callback(
          null,
          options.pinnedAddresses.map((found) => ({
            address: found.address,
            family: found.family,
          })),
        );
      },
    },
  });

  // `dispatcher` e' l'estensione undici della RequestInit standard (i tipi DOM non
  // la conoscono): e' l'unico punto in cui si esce dal tipo del fetch globale.
  const init: RequestInit & { dispatcher: Agent } = {
    // I redirect li segue la guardia, un hop alla volta: mai il client.
    redirect: 'manual',
    signal: options.signal,
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    dispatcher: agent,
  };

  try {
    return await globalThis.fetch(url, init);
  } finally {
    // close() attende le richieste in volo: non tronca il body ancora in streaming.
    void agent.close().catch(() => undefined);
  }
}

/** Risoluzione DNS di sistema: entrambe le famiglie, tutti i record. */
async function systemResolve(hostname: string): Promise<readonly ResolvedAddress[]> {
  return lookup(hostname, { all: true });
}

function parseHttpUrl(text: string): URL | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    // Non e' nemmeno un URL: stessa risposta di uno schema non ammesso.
    return null;
  }
  return ALLOWED_SCHEMES.has(url.protocol) ? url : null;
}

/** `http://[::1]/` ha hostname `[::1]`: le parentesi sono sintassi dell'URL. */
function bareHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function absoluteUrl(location: string, base: URL): string | null {
  try {
    return new URL(location, base).href;
  } catch {
    return null;
  }
}

function mediaTypeOf(response: Response): string | null {
  const header = response.headers.get('content-type');
  // `text/html; charset=utf-8` e' ammesso; `text/htmlx` no: si confronta il media
  // type intero, non un prefisso.
  return header === null ? null : header.split(';')[0].trim().toLowerCase();
}

function reasonFromError(error: unknown): 'timeout' | 'network-error' {
  // AbortSignal.timeout rigetta con un DOMException di nome TimeoutError.
  return error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network-error';
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Il corpo scartato non deve mai far fallire il risultato tipizzato.
  }
}

/** Legge il body fino a MAX_BYTES; oltre la soglia interrompe e ritorna null. */
async function readLimitedBody(response: Response): Promise<string | null> {
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      // Si smette di leggere: il resto della risposta non viene mai bufferizzato.
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

// --- Classificazione degli indirizzi -----------------------------------------
// Default DENY: se un indirizzo non e' classificabile con certezza, e' bloccato.

function isBlockedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== null) return isBlockedIpv4(ipv4);

  const ipv6 = parseIpv6(address);
  if (ipv6 === null) return true;

  // Un IPv4-mapped (`::ffff:a.b.c.d`) e' un indirizzo IPv4 travestito: va de-mappato
  // e giudicato con le regole IPv4, altrimenti `::ffff:7f00:1` (la forma compressa
  // in cui Node presenta 127.0.0.1) passerebbe indisturbato.
  const mapped = ipv4FromMapped(ipv6);
  return mapped === null ? isBlockedIpv6(ipv6) : isBlockedIpv4(mapped);
}

function isBlockedIpv4(octets: readonly number[]): boolean {
  const [a, b, c] = octets;
  if (a === 0) return true; // 0.0.0.0/8 "questa rete"
  if (a === 10) return true; // 10/8 privata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 privata
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168/16 privata
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a >= 224 && a <= 239) return true; // 224/4 multicast
  if (a >= 240) return true; // 240/4 riservato, include 255.255.255.255 broadcast
  return false;
}

function isBlockedIpv6(groups: readonly number[]): boolean {
  // ::/96 — copre :: (non specificato), ::1 (loopback) e gli IPv4-compatible.
  if (groups.slice(0, 6).every((group) => group === 0)) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // Prefissi di TRANSIZIONE: incapsulano un IPv4 dentro un IPv6, quindi in una rete
  // che li instrada `64:ff9b::a9fe:a9fe` raggiunge 169.254.169.254 (metadata cloud)
  // pur non somigliando a nessun indirizzo privato. Il sito di un micro-business non
  // e' raggiungibile solo per questa via: si bloccano i prefissi interi (deny).
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64
  if (groups[0] === 0x2002) return true; // 2002::/16 6to4
  return false;
}

function ipv4FromMapped(groups: readonly number[]): readonly number[] | null {
  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (!isMapped) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
}

function parseIpv4(text: string): readonly number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/** Espande un IPv6 testuale negli 8 gruppi da 16 bit; null se non e' un IPv6. */
function parseIpv6(text: string): readonly number[] | null {
  // Qui non serve una guardia d'ingresso: qualunque testo che non arrivi a 8 gruppi
  // esadecimali validi esce come null — una stringa senza ':', uno zone id
  // (`fe80::1%eth0`, il '%' non passa il formato dei gruppi), un gruppo troppo
  // lungo — e per il chiamante null significa DENY.
  //
  // Coda in forma dotted (`::ffff:1.2.3.4`): diventa due gruppi esadecimali.
  let normalized = text;
  const lastColon = text.lastIndexOf(':');
  const tailPart = text.slice(lastColon + 1);
  if (tailPart.includes('.')) {
    const octets = parseIpv4(tailPart);
    if (octets === null) return null;
    const high = (octets[0] * 256 + octets[1]).toString(16);
    const low = (octets[2] * 256 + octets[3]).toString(16);
    normalized = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];

  // Senza `::` servono esattamente 8 gruppi; con `::` ne deve comprimere almeno uno.
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length >= 8) return null;

  const zeros = new Array<string>(8 - head.length - tail.length).fill('0');
  const groups: number[] = [];
  for (const part of [...head, ...zeros, ...tail]) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}
