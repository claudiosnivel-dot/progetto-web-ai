// T-104 — utility di dominio PURA per gli slug dei siti (nessun accesso al DB).
// slugify sanitizza un name di attività in un identificatore URL-safe; la
// unicità è delegata a generateUniqueSlug tramite un predicato exists iniettato
// dal chiamante (T-101 lo lega a una query tipata su sites). Isolare qui la
// logica rende T-101 atomico e testabile a unità senza toccare Postgres, e
// garantisce che lo slug sia un identificatore ristretto a [a-z0-9-] PRIMA di
// finire in una query o in un URL (A05:2025 — output encoding / no filter/path
// injection alla fonte).

// Lunghezza massima dello slug: troncamento deterministico e ispezionabile.
export const SLUG_MAX_LENGTH = 60;

// Fallback per un name che, sanitizzato, non lascia alcun carattere valido
// (vuoto, soli spazi, soli simboli): mai la stringa vuota.
const SLUG_FALLBACK = 'site';

// Segni diacritici combinanti (Unicode U+0300–U+036F) prodotti dalla
// decomposizione NFKD: rimuoverli fa decadere á→a, é→e, ñ→n, ç→c.
const COMBINING_MARKS = /[̀-ͯ]/g;

// name → slug URL-safe. Passi: (1) NFKD + rimozione dei segni combinanti così i
// diacritici IT/ES decadono al carattere base (á→a, é→e, ñ→n, ç→c); (2)
// minuscolo; (3) ogni carattere fuori da [a-z0-9] diventa un trattino (spazi,
// underscore, simboli inclusi); (4) collasso dei trattini multipli; (5) rimozione
// dei trattini di bordo; (6) troncamento a SLUG_MAX_LENGTH ripulendo un eventuale
// trattino finale prodotto dal taglio; (7) fallback se il risultato è vuoto.
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');

  return slug.length > 0 ? slug : SLUG_FALLBACK;
}

// Dato un name e un predicato exists(slug), restituisce il primo slug libero:
// lo slug base se libero, altrimenti base-2, base-3, … Il predicato può essere
// sincrono o asincrono (T-101 lo lega a una SELECT tipata su sites per-account).
export async function generateUniqueSlug(
  name: string,
  exists: (slug: string) => Promise<boolean> | boolean,
): Promise<string> {
  const base = slugify(name);
  if (!(await exists(base))) {
    return base;
  }
  let suffix = 2;
  while (await exists(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
