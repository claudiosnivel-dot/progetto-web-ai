// T-232 (macrotask generation-ui, P2) — LA COMPOSIZIONE PURA di una card del selettore: da
// pool + ricetta + brief al DOCUMENTO della sola home, pronto per lo STESSO renderer che
// l'anteprima (T-235) usera' (SiteView, T-231). Nessun accesso al DB, nessun I/O, nessun
// side effect: gli stessi argomenti danno lo stesso documento, ed e' su questa purezza che
// poggiano AC-232-1 (card e anteprima identiche) e AC-232-4 (cambiare tema/ricetta e' puro,
// zero chiamate al confine).
//
// P2-D3 (copia-su-scrittura) VIVE IN `poolForVariant`: la variante `i` rende dal proprio pool
// se esiste, ALTRIMENTI dal pool CONDIVISO. E' cio' che rende AC-232-3 verificabile senza
// chiave — dopo una rigenerazione della sola variante 2, le altre quattro selezionano ancora
// lo STESSO oggetto pool condiviso, quindi rendono lo stesso albero per costruzione.
//
// `themeFor` E' UN LOOKUP PER UGUAGLIANZA ESATTA (mai per prefisso): gli id dei temi sono
// versionati ('nome-kebab@N', T-211) e un confronto lasco registrerebbe un tema che nessuna
// versione ha mai prodotto. E' la ricerca sull'ARRAY THEMES e non su un oggetto indicizzato,
// per la stessa ragione di `recipeFor` (T-212): un id come 'constructor' non deve risolvere un
// membro di Object.prototype al posto di "nessun tema". L'accoppiamento ricetta->tema e'
// pinnato da AC-212-1 (ogni `recipe.theme_id` esiste in THEMES), quindi per le cinque RECIPES
// il lookup non e' mai `undefined`; il ramo `null` resta la difesa dichiarata contro una futura
// divergenza fra i due cataloghi, non un caso vivo.
//
// IL DOCUMENTO PASSA SEMPRE DA `parseDocument` PRIMA DI ESSERE RESO (T-202): `resolve` e' puro
// e non e' un gate (lo dichiara il suo file), quindi la card non rende il suo risultato grezzo
// — lo fa passare dal gate, esattamente come la scrittura (T-204). Un pool cosi' incompleto da
// produrre una pagina senza blocchi non e' un documento valido: la card allora non rende nulla
// (`null`) invece di montare un albero che il gate rifiuterebbe.

import {
  DOCUMENT_LIMITS,
  parseDocument,
  type SiteDocument,
} from '@/domain/generation/document';
import { isPlainObject } from '@/domain/generation/gate';
import { pagesFor } from '@/domain/generation/pages';
import type { Pool } from '@/domain/generation/pool';
import { resolve } from '@/domain/generation/resolve';
import type { SiteRecipe } from '@/domain/generation/recipes';
import { THEMES, type SiteTheme } from '@/domain/generation/themes';
import type { Brief } from '@/domain/onboarding/brief';

/**
 * I pool 'home' di una generazione, letti da `readHomePools` (T-232 data): il pool CONDIVISO
 * (`shared`, `variant_index` null) e quelli PER VARIANTE (`byVariant`, indicizzati 0..4). E'
 * la forma su cui `poolForVariant` applica la copia-su-scrittura di P2-D3.
 */
export type HomePools = {
  readonly shared: unknown;
  readonly byVariant: Readonly<Record<number, unknown>>;
};

/** Il risultato di una card: la ricetta e il tema mostrati, e il documento GATED della home. */
export type VariantResolution = {
  readonly recipe: SiteRecipe;
  readonly theme: SiteTheme;
  readonly document: SiteDocument;
};

/**
 * Il tema di questo id, o `undefined` se nessuno lo porta. UGUAGLIANZA ESATTA e ricerca
 * sull'array (vedi l'intestazione). NON esportato: l'unico consumatore e' `resolveVariantHome`
 * qui sotto. L'anteprima (T-235), quando esistera', lo rialzera' a interfaccia condivisa invece
 * di scriverne una copia — finche' non ha un consumatore, un export sarebbe dead-code (P2-D26).
 */
function themeFor(themeId: string): SiteTheme | undefined {
  return THEMES.find((theme) => theme.id === themeId);
}

/**
 * IL POOL DELLA VARIANTE `index` (P2-D3, copia-su-scrittura): il pool proprio della variante se
 * esiste, ALTRIMENTI il pool condiviso. La lettura di `byVariant` e' su proprieta' PROPRIE
 * (`Object.hasOwn`): un indice non presente cade sul condiviso, e nessun membro di
 * Object.prototype puo' fingersi un pool di variante.
 */
export function poolForVariant(pools: HomePools, index: number): unknown {
  return Object.hasOwn(pools.byVariant, index) ? pools.byVariant[index] : pools.shared;
}

/**
 * COMPONE il documento della sola HOME per una variante: applica la ricetta e il suo tema al
 * pool sul set della sola home (P2-D13, `pagesFor(...)[0]`), poi fa passare il documento da
 * `parseDocument`. Restituisce `null` se il tema non esiste (difesa dichiarata, vedi
 * l'intestazione) o se il documento non supera il gate — mai un albero non validato.
 *
 * Il `maxPages` e' `DOCUMENT_LIMITS.max_pages`, lo STESSO che la fase 1 usa per derivare la home
 * (phase1.ts): cosi' la home della card e' quella che verra' congelata (T-233), non un'altra.
 */
export function resolveVariantHome(
  pool: unknown,
  recipe: SiteRecipe,
  brief: Brief,
): VariantResolution | null {
  const theme = themeFor(recipe.theme_id);
  if (theme === undefined) return null;

  const homeSpec = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages })[0];
  // Il pool viene da jsonb OPACO (gia' validato in scrittura, T-201): la guardia serve solo a
  // non far cadere `resolve` se il contenuto non fosse un oggetto proprio (un pool condiviso
  // assente vale "pagina vuota", che il gate sotto respinge come card senza blocchi).
  const safePool = (isPlainObject(pool) ? pool : { pages: {} }) as Pool;

  const { document } = resolve(safePool, recipe, theme, brief, [homeSpec]);
  const parsed = parseDocument(document);
  if (!parsed.ok) return null;

  return { recipe, theme, document: parsed.document };
}
