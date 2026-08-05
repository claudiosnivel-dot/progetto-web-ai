'use client';

// T-309 (macrotask editor-core, P3) — L'HOOK DEI SAVE-POINT. Sopra il draft di lavoro (T-307) e
// l'action di scrittura saveRevision (T-302), coordina i due momenti in cui una revisione viene
// persistita: l'AUTOSAVE con DEBOUNCE dopo l'inattivita', e il SALVATAGGIO ESPLICITO immediato.
// Espone lo stato dell'indicatore (idle / saving / saved / error) e `saveNow` per il pulsante.
//
// UNA SOLA REVISIONE PER BURST (P3, AC-309-1). Il draft cambia RIFERIMENTO a ogni edit reale (il
// reducer di T-307 restituisce una nuova reference; la stessa su un no-op). A ogni cambio di
// riferimento il debounce si RIARMA: finche' l'utente digita niente parte, e alla prima pausa
// scatta UNA scrittura con l'ULTIMO stato del burst. Un salvataggio esplicito ANNULLA il debounce
// pendente, cosi' pulsante + coda non producono mai due scritture dello stesso stato.
//
// SICUREZZA (security_note T-309): l'UNICA via di persistenza e' chiamare `save`. Autosave ed
// esplicito passano dalla STESSA funzione — in produzione saveRevision (T-302), che porta il gate
// parseDocument e la RLS del client di sessione. Il hook non ha alcun altro canale di scrittura:
// non c'e' bypass del gate. Un draft rifiutato dal gate torna `{ ok:false }` e diventa lo stato
// 'error' — nessuna revisione, nessun retry automatico che aggiri la validazione.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteDocument } from '@/domain/generation/document';
import type { SaveRevisionResult } from '@/data/site-document-revisions';

/** Lo stato dell'indicatore di salvataggio (i tre stati richiesti + il riposo iniziale). */
export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * La funzione di scrittura iniettata: in produzione `saveRevision` legata al sito
 * (`(draft) => saveRevision(siteId, draft)`). Il hook la tratta come l'unica porta di persistenza
 * — dietro di essa vivono il gate `parseDocument` e la RLS (T-302), mai duplicati qui.
 */
export type SaveDraft = (draft: SiteDocument) => Promise<SaveRevisionResult>;

/** Ritardo di default del debounce di autosave (ms), superabile per test/tuning. */
const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * Cabla i save-point dell'editor su un draft che cambia in stato client.
 *
 * @param document il draft corrente (T-307); un nuovo RIFERIMENTO ne segnala una modifica.
 * @param save la porta di scrittura (produzione: `saveRevision` legata al sito); l'UNICO canale.
 * @param debounceMs l'inattivita' oltre cui l'autosave scatta (default {@link DEFAULT_DEBOUNCE_MS}).
 * @returns `status` per l'indicatore e `saveNow` per il salvataggio esplicito immediato.
 */
export function useAutosave(
  document: SiteDocument,
  save: SaveDraft,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): { status: AutosaveStatus; saveNow: () => void } {
  const [status, setStatus] = useState<AutosaveStatus>('idle');

  // L'ultimo documento CONSEGNATO a `save` (o l'iniziale): serve a NON autosalvare al mount e a non
  // riscrivere uno stato gia' salvato. E' la reference del DRAFT sottomesso, non quella del
  // documento restituito da save (che puo' differire per la copia validata/riallineata di T-302),
  // cosi' un draft invariato dopo il salvataggio non fa ripartire un autosave.
  const submittedRef = useRef<SiteDocument>(document);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `save` puo' cambiare identita' tra i render (closure sul siteId): la teniamo in un ref cosi' il
  // debounce non si riarma solo perche' il chiamante ha passato una nuova funzione.
  const saveRef = useRef(save);
  saveRef.current = save;

  const clearPending = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // La scrittura effettiva: annulla ogni debounce pendente (niente doppia scrittura), marca lo
  // stato come salvato-in-corso, e passa il draft per l'UNICA porta. L'esito guida l'indicatore.
  const runSave = useCallback((draft: SiteDocument) => {
    clearPending();
    submittedRef.current = draft;
    setStatus('saving');
    void (async () => {
      try {
        const result = await saveRef.current(draft);
        setStatus(result.ok ? 'saved' : 'error');
      } catch {
        // Un guasto di rete/azione e' indistinguibile dall'utente da un rifiuto del gate: stato di
        // errore, nessuna revisione data per scritta, nessun retry silenzioso.
        setStatus('error');
      }
    })();
  }, [clearPending]);

  // AUTOSAVE CON DEBOUNCE. Solo quando il draft e' DIVERSO dall'ultimo sottomesso: al mount, e dopo
  // una scrittura andata a buon fine su un draft invariato, non parte nulla. Ogni cambio di
  // riferimento reimposta il timer (il cleanup annulla il precedente), cosi' un burst di edit
  // collassa in UNA scrittura alla prima pausa.
  useEffect(() => {
    if (document === submittedRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSave(document);
    }, debounceMs);
    return clearPending;
  }, [document, debounceMs, runSave, clearPending]);

  // SALVATAGGIO ESPLICITO: persiste SUBITO il draft corrente e (via runSave) annulla il debounce
  // pendente, cosi' il pulsante non lascia dietro di se' una seconda scrittura in coda.
  const saveNow = useCallback(() => {
    runSave(document);
  }, [document, runSave]);

  return { status, saveNow };
}
