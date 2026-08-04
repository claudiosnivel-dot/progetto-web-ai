// T-232 (macrotask generation-ui, P2) — IL SELETTORE dei cinque mockup: cinque card, una per
// direzione (RECIPES, T-212), ciascuna resa dallo STESSO renderer dell'anteprima (SiteView via
// VariantCard) e accompagnata dal pulsante "rigenera questa variante". E' l'unico export che la
// rotta /generate (o T-233, che aggiunge la scelta) monta: raccoglie i pool 'home' della
// generazione (readHomePools) UNA volta e ne deriva le cinque card con la copia-su-scrittura di
// P2-D3 (poolForVariant), cosi' che la variante rigenerata usi il suo pool e le altre il
// condiviso.
//
// LE CARD SONO ATTESE PRIMA DI COMPORRE L'ALBERO (Promise.all), come SiteView (T-231) fa con le
// sue pagine: cosi' l'albero restituito non contiene componenti asincroni annidati e il
// selettore e' un Server Component che si rende in un colpo solo. Un pool non leggibile (guasto,
// sessione assente) e' uno stato esplicito, non cinque card vuote.
//
// LE ETICHETTE arrivano per prop dal chiamante server (che le legge dal catalogo, P2-D10), come
// GenerateLauncher: questo modulo non conosce l'i18n del builder e non ha stringhe inline.

import type { ReactElement } from 'react';
import { RECIPES } from '@/domain/generation/recipes';
import { readHomePools } from '@/data/generation-pools';
import type { GenerationStatus } from '@/data/generations';
import { VariantCard } from '@/ui/generation/VariantCard';
import { RegenerateButton } from '@/ui/generation/RegenerateButton';
import { ChooseVariantButton } from '@/ui/generation/ChooseVariantButton';
import { poolForVariant } from '@/ui/generation/variant-document';
import type { Brief } from '@/domain/onboarding/brief';

type GenerationChooserLabels = {
  /** Il pulsante "rigenera questa variante". */
  readonly regenerate: string;
  /** Lo stato quando i pool della generazione non sono leggibili. */
  readonly unavailable: string;
};

// LA SCELTA (WIRE): montare il pulsante che CONGELA la variante (ChooseVariantButton -> T-233) e'
// cio' che da' a `selectVariant` un consumatore di produzione. E' OPZIONALE perche' l'oracolo del
// selettore (T-232) monta il chooser per verificare il RENDER delle card, dove la scelta non
// c'entra: la rotta /generate la fornisce sempre. `status` decide il gesto a due passi di AC-233-4
// (solo su 'complete').
type GenerationChooserChoose = {
  readonly status: GenerationStatus;
  readonly labels: {
    readonly choose: string;
    readonly confirmPrompt: string;
    readonly confirm: string;
    readonly cancel: string;
  };
};

type GenerationChooserProps = {
  readonly siteId: string;
  readonly generationId: string;
  readonly brief: Brief;
  readonly locale: string;
  readonly labels: GenerationChooserLabels;
  readonly choose?: GenerationChooserChoose;
};

export async function GenerationChooser({
  siteId,
  generationId,
  brief,
  locale,
  labels,
  choose,
}: GenerationChooserProps): Promise<ReactElement> {
  const pools = await readHomePools(generationId);
  if (!pools.ok) {
    return (
      <p data-chooser-error="pools" className="text-sm text-muted-foreground">
        {labels.unavailable}
      </p>
    );
  }

  // Copia-su-scrittura (P2-D3): ogni card riceve il pool della sua variante o quello condiviso.
  const cards = await Promise.all(
    RECIPES.map((recipe, index) =>
      VariantCard({
        pool: poolForVariant({ shared: pools.shared, byVariant: pools.byVariant }, index),
        recipe,
        brief,
        locale,
        variantIndex: index,
      }),
    ),
  );

  return (
    <div
      data-generation-chooser={generationId}
      className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3"
    >
      {cards.map((card, index) => (
        <div key={RECIPES[index].id} className="flex flex-col gap-md">
          {card}
          <RegenerateButton
            siteId={siteId}
            generationId={generationId}
            variantIndex={index}
            label={labels.regenerate}
          />
          {choose ? (
            <ChooseVariantButton
              siteId={siteId}
              generationId={generationId}
              locale={locale}
              variantIndex={index}
              status={choose.status}
              labels={choose.labels}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
