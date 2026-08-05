import { runGenerationTurn } from '@/data/anthropic';
import type { Brief } from '@/domain/onboarding/brief';
import type { PageSpec } from '@/domain/generation/pages';
import type { Pool } from '@/domain/generation/pool';
import { buildPhase2ChunkPayload } from '@/domain/generation/phase2';

// T-234 / architecture-hardening (T-AH5) — L'ESECUZIONE del turno di fase 2 A CHUNK. La funzione
// I/O vive nel layer `data`, accanto al suo unico chiamante (src/data/generation-phase2.ts): qui
// l'import del confine unico @/data/anthropic (server-only, chiave Anthropic) e' lecito. Il PAYLOAD
// lo costruisce `buildPhase2ChunkPayload`, che resta PURO in src/domain/generation/phase2.ts — il
// suo prefisso cacheabile byte-identico fra i chunk e' provato da
// tests/generation-phase2-cache-prefix.test.ts, che lo importa dal dominio.

/** I motivi di fallimento NOMINATI del confine (T-224), derivati e non riscritti. */
type Phase2ChunkFailure = Extract<
  Awaited<ReturnType<typeof runGenerationTurn>>,
  { ok: false }
>['reason'];

/**
 * L'esito di UN chunk della fase 2. Il fallimento e' TERMINALE e NOMINATO (stesso contratto di
 * T-224): nessun pool parziale. In caso di successo porta anche l'allowlist degli slug con cui
 * il pool e' stato validato — la STESSA che l'azione passa a `writePool`, senza ricalcolarla.
 */
export type Phase2ChunkResult =
  | { readonly ok: true; readonly pool: Pool; readonly allowedSlugs: readonly string[] }
  | { readonly ok: false; readonly reason: Phase2ChunkFailure };

/**
 * Assembla (via `buildPhase2ChunkPayload`, puro nel dominio) e ESEGUE il turno di UN chunk della
 * fase 2 sul confine, restituendo il pool delle pagine di quel chunk. L'allowlist passata a
 * `parsePool` (via `runGenerationTurn`) e' quella dell'INTERO set interno — la stessa su cui e'
 * costruito il tool stabile — cosi' un pool che portasse una pagina non prevista dalla fase 2 cade
 * per intero (T-201), e le pagine del chunk ne sono comunque un sottoinsieme.
 *
 * @returns il pool validato con la sua allowlist, oppure il motivo nominato del fallimento.
 */
export async function runGenerationPhase2Chunk(
  brief: Brief,
  innerPages: readonly PageSpec[],
  chunk: readonly PageSpec[],
): Promise<Phase2ChunkResult> {
  const allowedSlugs = innerPages.map((pagina) => pagina.slug);
  const payload = buildPhase2ChunkPayload(brief, innerPages, chunk);

  const turn = await runGenerationTurn({ payload, phase: 'phase2_chunk', allowedSlugs });
  if (!turn.ok) return { ok: false, reason: turn.reason };
  return { ok: true, pool: turn.pool, allowedSlugs };
}
