'use client';

// T-307 (macrotask editor-core, P3) — L'HOOK SOTTILE sopra il reducer puro (draft-state.ts).
// Non contiene logica di editing: e' solo il cablaggio React (useReducer + callback stabili) che
// espone all'editor il documento di lavoro e le azioni (editSlot, setTheme, undo, redo) piu' i
// flag derivati canUndo/canRedo. La logica — e i test — vivono nel reducer, hermetic.
//
// Il `document` esposto e' cio' che il renderer UNICO (SiteView in modalita editable) rilegge:
// una edit inline si riflette in anteprima senza round-trip server, perche' cambia lo stato
// client e le isole <EditableText> rendono il nuovo testo (P3-D5). La persistenza a revisioni
// (save-point) e' altrove (T-309): questo hook non scrive nulla.

import { useReducer, useCallback } from 'react';
import type { SiteBlock, SiteDocument } from '@/domain/generation/document';
import { draftReducer, initialDraftState, canUndo, canRedo } from '@/ui/editor/draft-state';

export function useEditorDraft(initialDocument: SiteDocument) {
  const [state, dispatch] = useReducer(draftReducer, initialDocument, initialDraftState);

  // `path` e' la coordinata STRUTTURATA dell'isola (array di segmenti, non una stringa puntata):
  // e' cio' che rende editabile una chiave di orari che contiene un punto (vedi draft-state.ts).
  const editSlot = useCallback((blockId: string, path: readonly string[], value: string) => {
    dispatch({ type: 'editSlot', edit: { blockId, path, value } });
  }, []);
  // Lo switch tema (T-308): il chrome (ThemeSwitcher) lega `onThemeChange` a questa callback per
  // aggiornare `document.theme_id` nel draft. La persistenza a revisione e' altrove (T-309).
  const setTheme = useCallback((themeId: string) => dispatch({ type: 'setTheme', themeId }), []);
  // L'aggiunta di un blocco dalla libreria (T-314): il pannello passa lo slug della pagina target e il
  // blocco RISOLTO (sorgentato dal baseline lato server, model-free). Il dominio riallinea e ri-gate;
  // un rifiuto e' un no-op nel reducer. La persistenza a revisione resta altrove (save-point, T-309).
  const addBlock = useCallback(
    (pageSlug: string, block: SiteBlock) => dispatch({ type: 'addBlock', pageSlug, block }),
    [],
  );
  // Il riordino di un blocco entro una pagina (T-315): il controllo lista passa lo slug della pagina e
  // gli indici sorgente/destinazione. Il dominio riordina e ri-gate; un rifiuto e' un no-op nel reducer.
  const reorderBlock = useCallback(
    (pageSlug: string, fromIndex: number, toIndex: number) =>
      dispatch({ type: 'reorderBlock', pageSlug, fromIndex, toIndex }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    document: state.document,
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    editSlot,
    setTheme,
    addBlock,
    reorderBlock,
    undo,
    redo,
  };
}
