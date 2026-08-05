'use client';

// T-309 (macrotask editor-core, P3) — I CONTROLLI DEL SAVE-POINT nel chrome dell'editor: il
// pulsante SALVA esplicito e l'INDICATORE di stato (salvato / in salvataggio / errore). Sottile
// per costruzione: tutta la logica dei save-point (debounce, annullamento, esito) vive in
// useAutosave; qui c'e' solo il cablaggio verso l'utente.
//
// SICUREZZA: nessun colore letterale, nessun HTML grezzo (lo scanner statico di T-306 sorveglia
// src/ui/editor). Le etichette sono TESTO reso come children React (escaping preservato); nessun
// input non fidato entra qui. La persistenza passa per l'unica porta `save` (== saveRevision,
// gate parseDocument + RLS, T-302), mai un canale alternativo dal componente.

import type { SiteDocument } from '@/domain/generation/document';
import { useAutosave, type AutosaveStatus, type SaveDraft } from '@/ui/editor/useAutosave';

/** Le etichette dell'indicatore, una per stato. `idle` non annuncia nulla (nessun save ancora). */
const STATUS_LABEL: Record<AutosaveStatus, string> = {
  idle: '',
  saving: 'Salvataggio in corso…',
  saved: 'Salvato',
  error: 'Errore di salvataggio',
};

type SaveControlsProps = {
  /** Il draft corrente (T-307): un nuovo riferimento segnala una modifica da autosalvare. */
  readonly document: SiteDocument;
  /** La porta di scrittura, in produzione `saveRevision` legata al sito (gate T-302). */
  readonly save: SaveDraft;
  /** Ritardo del debounce di autosave (ms); opzionale, usa il default del hook se assente. */
  readonly debounceMs?: number;
};

export function SaveControls({ document, save, debounceMs }: SaveControlsProps) {
  const { status, saveNow } = useAutosave(document, save, debounceMs);

  return (
    <div className="editor-save-controls">
      <button
        type="button"
        className="editor-save-button"
        onClick={saveNow}
        disabled={status === 'saving'}
      >
        Salva
      </button>
      {/* aria-live: l'esito del salvataggio e' annunciato agli screen reader senza rubare il focus. */}
      <span className="editor-save-status" data-status={status} role="status" aria-live="polite">
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}
