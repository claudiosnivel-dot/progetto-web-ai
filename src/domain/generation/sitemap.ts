// T-411 (macrotask seo-base, P4) — COSTRUZIONE e SERIALIZZAZIONE della sitemap urlset. Dominio
// PURO: nessun accesso all'ambiente, nessun I/O, nessuna costruzione di URL da env. Chi ha una base
// URL (getSiteBaseUrl, app layer) compone gia' la <loc> assoluta e la passa come stringa — l'indirizzo
// nasce dal public_slug della riga e dalla base di config (P2-D12), MAI da testo libero del brief, e
// qui non c'e' alcun campo che possa portarne uno diverso da una <loc> gia' costruita a monte.
//
// PERCHE' L'ESCAPING E' UN PUNTO DI SICUREZZA, NON DECORAZIONE (A03:2025 injection). I valori
// inseriti (la <loc>, il <lastmod>) finiscono come testo di elementi XML: un carattere strutturale
// grezzo (`<` `>` `&`, o `'` `"` negli attributi) potrebbe rompere il documento o iniettare markup.
// `xmlEscape` neutralizza le cinque entita' PRIMA che il valore entri nell'XML: dopo l'escape un
// parser XML ricostruisce il valore identico (round-trip trasparente) ma non puo' piu' leggerlo come
// struttura. Gli slug del documento sono gia' vincolati in forma (nessun carattere strutturale), ma
// l'escape e' difesa in profondita' e vale per QUALUNQUE valore inserito, non solo per quelli fidati.

/**
 * Una voce della sitemap: la <loc> ASSOLUTA (gia' composta a monte da base + percorso) e, se nota,
 * il <lastmod>. Entrambe sono stringhe opache per questo modulo, escapate al momento di comporre l'XML.
 */
export type SitemapUrlEntry = {
  readonly loc: string;
  readonly lastmod?: string;
};

/** I cinque caratteri strutturali di XML e le loro entita'. Scritti una volta sola. */
const XML_ENTITIES: Readonly<Record<string, string>> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;',
};

const XML_UNSAFE = /[<>&'"]/g;

/**
 * Rende una stringa sicura da inserire come testo/attributo XML: ogni carattere strutturale
 * (`<` `>` `&` `'` `"`) diventa la sua entita'. Un solo passaggio: nessun doppio escape (`&` e'
 * processato una volta e diventa `&amp;`, non ri-scandito).
 */
export function xmlEscape(value: string): string {
  return value.replace(XML_UNSAFE, (ch) => XML_ENTITIES[ch]);
}

/**
 * Serializza le voci in un documento sitemap `urlset` valido (schema sitemaps.org 0.9). Ogni voce
 * diventa un `<url>` con `<loc>` e, se presente, `<lastmod>`; TUTTI i valori inseriti sono XML-escaped.
 * Il risultato e' una stringa XML autoconclusa, pronta per una Response `application/xml`.
 */
export function buildSitemapXml(entries: readonly SitemapUrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const loc = `<loc>${xmlEscape(entry.loc)}</loc>`;
      const lastmod = entry.lastmod !== undefined ? `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : '';
      return `<url>${loc}${lastmod}</url>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}
