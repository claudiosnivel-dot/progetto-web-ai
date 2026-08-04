// T-237 (macrotask generation-ui, P2) — I COSTRUTTORI SICURI dei link del blocco contatti.
//
// `phone`, `email` e i `social_links` sono campi di TESTO LIBERO del brief (T-121) e possono
// venire da un sito terzo via `fromUrl` (T-141): comporre `href={valore}` senza validarne lo
// SCHEMA immetterebbe un URL 'javascript:' nel sito pubblico di un cliente pagante (OWASP
// A03:2025). La difesa e' qui, al punto in cui l'href si costruisce (AC-237-1): ogni valore
// passa da uno SCHEMA zod PRIMA dell'uso, e lo schema dell'href e' scelto dal CODICE — mai
// preso dal valore. Gli unici schemi ammessi sono `tel:`, `mailto:` e `https:`; un valore che
// non passa la validazione NON produce alcun link (il chiamante rende il solo testo).
//
// Il quarto link — WhatsApp — vive gia' in `./whatsapp` (`safeWhatsappHref`, T-231, sola
// forma `https://wa.me/<cifre>`): il blocco contatti lo riusa invece di riscriverlo, cosi' la
// regola del numero WhatsApp resta in un posto solo.

import { z } from 'zod';

// FORMA DEL TELEFONO: un '+' opzionale e da 6 a 15 cifre (E.164). I separatori comuni (spazi,
// punti, trattini, parentesi) sono tolti PRIMA del controllo; dopo di esso non resta che
// '+' e cifre, quindi lo schema dell'href e' `tel:` per costruzione e non puo' contenere ':'
// interni ne uno schema 'javascript:'.
const TelShape = z.string().regex(/^\+?[0-9]{6,15}$/);

// FORMA DELL'EMAIL: lo schema email di zod. Rifiuta per costruzione ogni valore con uno schema
// davanti ('javascript:...@x', 'mailto:info@x') perche' il ':' non e' ammesso nella parte
// locale — verificato. L'href e' `mailto:` prependuto dal codice, mai letto dal valore.
const EmailShape = z.string().email();

// Tetto di lunghezza dei valori: la stessa taglia dei link social del brief (T-121). Non e' la
// difesa — la difesa e' lo schema — ma tiene la validazione lontana da un input di taglia
// arbitraria prima ancora di guardarne la forma.
const MAX_LINK_CHARS = 500;
const BoundedString = z.string().min(1).max(MAX_LINK_CHARS);

/**
 * L'href `tel:<+cifre>` per un telefono valido, o `null`. `null` significa "nessun link", mai
 * un href malformato.
 */
export function safeTelHref(value: string | undefined): string | null {
  if (value === undefined) return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (!TelShape.safeParse(compact).success) return null;
  return `tel:${compact}`;
}

/**
 * L'href `mailto:<email>` per un indirizzo valido, o `null`. Lo schema e' prependuto dal
 * codice: il valore validato e' la sola parte-indirizzo, e non puo' portare uno schema proprio.
 */
export function safeMailtoHref(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!EmailShape.safeParse(trimmed).success) return null;
  return `mailto:${trimmed}`;
}

/**
 * L'href di un link social, ammesso SOLO se il suo schema e' `https:`, altrimenti `null`.
 *
 * Lo schema e' controllato con `URL` DOPO la validazione di forma di zod, e non e' ridondante:
 * `z.string().url()` accetta anche 'javascript:alert(1)' (verificato — costruisce un URL con
 * protocollo 'javascript:'), quindi e' il confronto ESPLICITO `protocol === 'https:'` a chiudere
 * l'allowlist. Un 'http:' e' rifiutato di proposito: il sito pubblico di un cliente non deve
 * portare un link in chiaro nato da un campo non fidato.
 */
export function safeHttpsHref(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!BoundedString.safeParse(trimmed).success) return null;
  if (!z.string().url().safeParse(trimmed).success) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
