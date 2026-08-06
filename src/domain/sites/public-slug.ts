// T-402 — logica di dominio PURA (nessun accesso al DB) per il public_slug: il
// segmento con cui un sito pubblicato è servito su /s/<slug>. Riusa slugify e
// SLUG_MAX_LENGTH da ./slug (T-104), aggiungendo tre cose proprie della superficie
// PUBBLICA e globale: una lista di slug RISERVATI a match esatto, la deduplica su un
// predicato exists GLOBALE iniettato (T-403 lo lega a una query su site_publications),
// e la validazione della forma di uno slug EDITATO dall'utente.
//
// PERCHÉ QUI E PURO: lo slug è ristretto a [a-z0-9-] alla FONTE (A05:2025 — output
// encoding, no path/filter injection) riusando slugify; il dedup globale è delegato al
// predicato exists (nessun client DB in src/domain), e l'unicità AUTOREVOLE resta il
// vincolo UNIQUE del DB (T-401): questa è cortesia di generazione, non il gate. La lista
// riservati a MATCH ESATTO impedisce a un sito di rivendicare rotte di sistema
// (s, api, admin, sitemap, robots, _next) senza bloccare per substring un nome legittimo.

import { slugify, SLUG_MAX_LENGTH } from './slug';

// Slug riservati: rotte di sistema/piattaforma che un sito pubblicato non può rivendicare.
// Set → appartenenza a MATCH ESATTO: 'admin' è riservato, 'administrator' no.
export const RESERVED_PUBLIC_SLUGS: ReadonlySet<string> = new Set([
  's',
  'api',
  'admin',
  'auth',
  'login',
  'logout',
  'signup',
  'dashboard',
  'editor',
  'preview',
  'sitemap',
  'robots',
  'static',
  '_next',
  'www',
]);

// Forma canonica di un public_slug: minuscole/cifre/trattini interni, mai un trattino di
// bordo, almeno un carattere. Coincide con l'uscita garantita di slugify.
const PUBLIC_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// true se lo slug è riservato, per uguaglianza ESATTA (non substring).
export function isReservedSlug(slug: string): boolean {
  return RESERVED_PUBLIC_SLUGS.has(slug);
}

// Dato un name e un predicato exists(slug) GLOBALE, restituisce il primo slug libero e
// NON riservato: lo slug base se disponibile, altrimenti base-2, base-3, … Uno slug che
// coincide con un riservato è trattato come OCCUPATO (mai restituito nudo). Il predicato
// può essere sincrono o asincrono (T-403 lo lega a site_publications sotto RLS).
export async function generateUniquePublicSlug(
  name: string,
  exists: (slug: string) => Promise<boolean> | boolean,
): Promise<string> {
  const base = slugify(name);
  const isTaken = async (slug: string) => isReservedSlug(slug) || (await exists(slug));
  if (!(await isTaken(base))) {
    return base;
  }
  // Il candidato suffissato resta entro SLUG_MAX_LENGTH: se il base e' vicino al tetto si tronca il
  // base per far posto al suffisso, ripulendo un eventuale trattino di bordo (come slugify), cosi'
  // lo slug generato rispetta sempre la stessa forma che validatePublicSlug accetta.
  const withSuffix = (suffix: number): string => {
    const tag = `-${suffix}`;
    const stem = base.slice(0, SLUG_MAX_LENGTH - tag.length).replace(/-+$/g, '');
    return `${stem}${tag}`;
  };
  let suffix = 2;
  while (await isTaken(withSuffix(suffix))) {
    suffix += 1;
  }
  return withSuffix(suffix);
}

// Valida la forma di uno slug EDITATO dal client (nessuna fiducia nel client, P4-D4):
// forma canonica, entro SLUG_MAX_LENGTH, non riservato. true se accettabile.
export function validatePublicSlug(slug: string): boolean {
  return (
    slug.length <= SLUG_MAX_LENGTH &&
    PUBLIC_SLUG_PATTERN.test(slug) &&
    !isReservedSlug(slug)
  );
}
