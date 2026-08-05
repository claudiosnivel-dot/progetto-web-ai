import { runGenerationTurn } from '@/data/anthropic';
import type { Brief } from '@/domain/onboarding/brief';
import type { Pool } from '@/domain/generation/pool';
import { blocksFor, slotsForBlocks } from '@/domain/generation/blocks';
import { pagesFor } from '@/domain/generation/pages';
import { briefProjection } from '@/domain/generation/projection';
import { buildGenerationPayload } from '@/domain/generation/prompt';
import { buildPoolTool } from '@/domain/generation/tool';
import { DOCUMENT_LIMITS } from '@/domain/generation/document';

// T-230 / architecture-hardening (T-AH5) — L'ORCHESTRAZIONE DELLA FASE 1: assembla il turno e
// chiama il confine unico (T-224), restituendo il pool CONDIVISO della home. La funzione I/O vive
// nel layer `data`, accanto ai suoi chiamanti (la rotta src/app/api/generate e
// src/data/generation-regenerate): la rotta (src/app/**) NON puo' importare il confine LLM (regola
// ESLint + contratto di altitudine: il confine e' server-only e detiene il segreto Anthropic),
// quindi chiama questa funzione, che nel layer data puo' importarlo. I mattoni di assemblaggio
// (pagesFor/blocksFor/briefProjection/buildPoolTool/buildGenerationPayload) restano PURI in
// src/domain/generation e sono importati da qui (data->domain, lecito).
//
// UNA SOLA CHIAMATA, UN SOLO POOL (P2-D2): la fase 1 produce il pool della HOME, che e' il
// pool CONDIVISO da cui nascono normalmente le cinque varianti (P2-D3). Le cinque cornici
// {recipe_id, theme_id} sono PURE e non passano di qui: le dichiara la rotta da RECIPES.
//
// L'ALLOWLIST DEL POOL E' ['home'] (fase 1 = sola pagina iniziale, T-213): il tool enumera
// gli slot dei blocchi della home e la sola pagina 'home', e `parsePool` imporra' quella
// stessa allowlist sul ritorno del modello. La home e' `pagesFor(...)[0]` — sempre presente
// e sempre in testa. La PROIEZIONE (T-220) e' la difesa in ingresso: al confine arriva la
// sola porzione ammessa del brief, mai il brief.
//
// RICEVE IL BRIEF, non il payload: e' il punto in cui l'assemblaggio vive tutto insieme,
// cosi' la rotta non tocca proiezione, tool ne pagine e non puo' riaprire per distrazione la
// superficie che la proiezione chiude.

/** I motivi di fallimento NOMINATI del confine (T-224), derivati e non riscritti. */
type Phase1Failure = Extract<Awaited<ReturnType<typeof runGenerationTurn>>, { ok: false }>['reason'];

/**
 * L'esito della fase 1. Il fallimento e' TERMINALE e NOMINATO (stesso contratto di T-224):
 * nessun pool parziale. In caso di successo porta anche l'allowlist degli slug, che la rotta
 * passa a `writePool` — cosi' la scrittura usa la STESSA allowlist con cui il pool e' stato
 * validato, senza ricalcolarla altrove.
 */
type Phase1Result =
  | { readonly ok: true; readonly pool: Pool; readonly allowedSlugs: readonly string[] }
  | { readonly ok: false; readonly reason: Phase1Failure };

/**
 * Assembla e ESEGUE il turno di fase 1 sul confine, restituendo il pool condiviso della home.
 * @param brief il brief CONFERMATO del sito (gia' passato dal gate `generatable`, T-215).
 * @returns il pool validato con la sua allowlist, oppure il motivo nominato del fallimento.
 */
export async function runGenerationPhase1(brief: Brief): Promise<Phase1Result> {
  const homeSpec = pagesFor(brief, { maxPages: DOCUMENT_LIMITS.max_pages })[0];
  const allowedSlugs = [homeSpec.slug];
  const tool = buildPoolTool(slotsForBlocks(blocksFor(brief, homeSpec.role)), allowedSlugs);
  const payload = buildGenerationPayload(briefProjection(brief, 'home'), tool, 'home');

  const turn = await runGenerationTurn({ payload, phase: 'phase1', allowedSlugs });
  if (!turn.ok) return { ok: false, reason: turn.reason };
  return { ok: true, pool: turn.pool, allowedSlugs };
}
