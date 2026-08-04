// T-231 (macrotask generation-ui, P2) — il costruttore SICURO del deep-link WhatsApp del
// blocco CTA. `whatsapp` e' un campo di TESTO LIBERO del brief (T-121, max 40 code unit) e
// puo' venire da un sito terzo via fromUrl (T-141): comporre `wa.me/<valore>` o
// `href={valore}` senza validarne la FORMA immetterebbe un URL 'javascript:' nel sito
// pubblico di un cliente pagante (OWASP A03:2025). Qui sopravvivono solo cifre, con un '+'
// iniziale opzionale; qualunque altra cosa NON produce alcun link, e il blocco rende la sola
// riga di invito.
//
// E' il solo link che il blocco NARRATIVO della CTA possiede: la validazione COMPLETA dei
// link dei blocchi di dati (telefono, email, social) e' T-237 (AC-237-1), che copre le altre
// superfici. Tenere questo qui, minimo e locale, e' cio' che permette alla CTA di esistere
// senza aprire un buco in attesa di quel task.

// FORMA AMMESSA: un '+' opzionale e da 6 a 15 cifre (E.164). Non e' un colore, non e' markup:
// per costruzione non puo' contenere ':' '/' '.' ne uno schema 'javascript:'.
const WHATSAPP_SHAPE = /^\+?[0-9]{6,15}$/;

/**
 * L'href `https://wa.me/<cifre>` per un numero valido, o `null` se il valore non ha la forma
 * di un numero: separatori comuni (spazi, punti, trattini, parentesi) sono tolti prima del
 * controllo, il '+' iniziale non entra nel path di wa.me. `null` significa "nessun link", mai
 * un href malformato.
 */
export function safeWhatsappHref(value: string | undefined): string | null {
  if (value === undefined) return null;
  const compact = value.trim().replace(/[\s().-]/g, '');
  if (!WHATSAPP_SHAPE.test(compact)) return null;
  const digits = compact.replace(/^\+/, '');
  return `https://wa.me/${digits}`;
}
