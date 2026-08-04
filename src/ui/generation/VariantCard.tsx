// T-232 (macrotask generation-ui, P2) — UNA CARD del selettore: il mockup di UNA variante,
// reso dallo STESSO renderer dell'anteprima (SiteView, T-231) — mai un renderer parallelo. E'
// la ragione per cui "cio' che l'utente scegle e' cio' che ottiene" e' vera PER COSTRUZIONE e
// non per sorveglianza (security_note di AC-232-1): card e anteprima passano dallo stesso
// modulo, quindi la sequenza di id-blocco che producono e' identica e la classe di difetto "la
// card non somiglia al sito scelto" e' irrappresentabile.
//
// Il documento della home si compone e si GATE-a in `resolveVariantHome` (variant-document.ts),
// puro: questa e' solo la cornice che lo monta. Se la composizione non produce un documento
// valido (pool troppo incompleto per la home, tema assente) la card rende `null` invece di un
// albero non validato — la stessa politica con cui il registry (T-231) salta un blocco che non
// sa comporre.
//
// Vive in src/ui/generation/ (la UI del BUILDER), non in src/ui/site/: non e' soggetto al
// confine ESLint di T-211 e non tocca alcun token del tema — il tema entra come oggetto per
// prop dentro SiteView, che lo proietta in `var(--site-...)` alla radice del render.

import type { ReactElement } from 'react';
import { SiteView } from '@/ui/site/SiteView';
import type { SiteRecipe } from '@/domain/generation/recipes';
import type { Brief } from '@/domain/onboarding/brief';
import { resolveVariantHome } from '@/ui/generation/variant-document';

type VariantCardProps = {
  /** Il pool GIA' SELEZIONATO per questa variante (P2-D3, `poolForVariant`): condiviso o proprio. */
  readonly pool: unknown;
  /** La ricetta (direzione + tema) mostrata da questa card. */
  readonly recipe: SiteRecipe;
  /** Il brief del sito: i dati resi direttamente dai blocchi (offerte, orari, contatti). */
  readonly brief: Brief;
  /** Il locale del sito, per le etichette i18n dei blocchi (P2-D10). */
  readonly locale: string;
  /** L'indice 0..4 della variante, esposto per il selettore e la rigenerazione. */
  readonly variantIndex: number;
};

export async function VariantCard({
  pool,
  recipe,
  brief,
  locale,
  variantIndex,
}: VariantCardProps): Promise<ReactElement | null> {
  const resolved = resolveVariantHome(pool, recipe, brief);
  if (resolved === null) return null;

  // SiteView e' un Server Component ASINCRONO: lo si esegue e si incorpora l'albero gia' pronto,
  // cosi' la card non annida un componente asincrono. E' lo STESSO renderer dell'anteprima.
  const view = await SiteView({ document: resolved.document, theme: resolved.theme, locale });

  return (
    <article
      className="site-card overflow-hidden rounded-lg border border-border"
      data-variant-index={variantIndex}
      data-variant-recipe={resolved.recipe.id}
      data-variant-theme={resolved.theme.id}
    >
      {view}
    </article>
  );
}
