import { getBrief } from '@/data/briefs';
import { readGenerationDocument } from '@/data/generation-document';
import { parseDocument } from '@/domain/generation/document';
import { addableBlocks, findResolvedBlock } from '@/domain/editor/block-ops';
import { siteBlockLabel } from '@/ui/site/labels';
import type { AddableOffer } from '@/ui/editor/BlockPanel';

// T-314 (macrotask editor-blocks, P3) — COMPOSIZIONE dell'OFFERTA della libreria blocchi per una
// pagina: quali blocchi sono aggiungibili (precondizione dati + ruolo, meno i presenti), con la loro
// LABEL i18n e l'ISTANZA RISOLTA da inserire. E' quello che il pannello (BlockPanel, client) riceve
// gia' pronto e serializzabile.
//
// ALTITUDINE (gate architecture repo-wide, T-AH6/T-312). Questo modulo IMPORTA data (getBrief,
// readGenerationDocument), domain (parseDocument, addableBlocks, findResolvedBlock) e ui (siteBlockLabel):
// l'unico strato senza archi vietati in uscita e' APP — data->ui e domain->ui/data sarebbero rossi.
// Vive percio' in src/app/**, CO-LOCATO con la rotta editor e con render-draft-page (T-313), che
// compone gia' data+domain+ui alla stessa altitudine. E' la stessa argomentazione di T-313.
//
// SICUREZZA / OWNERSHIP: sia `getBrief` sia `readGenerationDocument` girano sul client di SESSIONE
// (RLS attiva), MAI service_role: un sito di un altro tenant filtra a insieme vuoto e l'offerta e'
// semplicemente vuota (anti-enumerazione P1-D21) — non si rivela nulla e non si aggiunge nulla. Il
// documento corrente e' input NON FIDATO e passa da `parseDocument` (T-202) prima di sorgentare le
// istanze, come ovunque nel progetto.
//
// MODEL-FREE (P2-D7): l'istanza di ogni blocco offerto e' SORGENTATA dal documento corrente/baseline
// via `findResolvedBlock` (dove `resolve` l'ha gia' prodotta). Un blocco offerto ma privo di istanza
// risolta nel documento e' SCARTATO: non si fabbrica prosa e non si chiama il modello per riempirlo.
//
// La LABEL e' quella di catalogo (`siteBlockLabel`, namespace 'site', it/es), mai l'id grezzo ne prosa
// non tradotta (AC-314-4). Nessun href/src nasce da testo libero: l'offerta porta id, label e struttura.

/**
 * L'offerta della libreria per una pagina: elenco (eventualmente vuoto) di { id, label, block }.
 *
 * @param siteId il sito di cui si compone l'offerta (RLS, client di sessione).
 * @param pageSlug la pagina a cui i blocchi si aggiungerebbero (uguaglianza esatta).
 * @param locale il locale gia' vincolato dal chiamante (sceglie il catalogo i18n della label).
 * @returns i blocchi aggiungibili con label e istanza risolta; vuoto se il sito non e' posseduto, non
 *   ha ancora un documento, il documento non passa il gate, o nessun blocco e' offribile model-free.
 */
export async function composeAddableBlocks(
  siteId: string,
  pageSlug: string,
  locale: string,
): Promise<AddableOffer[]> {
  // Il BRIEF sotto RLS: e' la fonte delle precondizioni sui dati. Assente o senza sessione -> nessuna offerta.
  const briefRead = await getBrief(siteId);
  if (!briefRead.ok || briefRead.brief === null) return [];

  // Il DOCUMENTO CORRENTE (ultima revisione else baseline, T-304), dietro il gate parseDocument.
  const documentRead = await readGenerationDocument(siteId);
  if (!documentRead.ok || documentRead.document === null) return [];
  const parsed = parseDocument(documentRead.document);
  if (!parsed.ok) return [];
  const source = parsed.document;

  // L'offerta pura: precondizione+ruolo (blocksFor) meno i presenti, per uguaglianza esatta.
  const offered = addableBlocks(briefRead.brief, source, pageSlug);

  const offer: AddableOffer[] = [];
  for (const definition of offered) {
    // SORGENTE MODEL-FREE: l'istanza risolta dal documento corrente. Assente -> si SCARTA (P2-D7).
    const block = findResolvedBlock(source, definition.id);
    if (block === null) continue;
    const label = await siteBlockLabel(block, locale);
    offer.push({ id: definition.id, label, block });
  }
  return offer;
}
