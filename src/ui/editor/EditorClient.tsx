'use client';

// FX-EDITOR-2 (T-319 wiring, macrotask editor-core, P3) — LA SHELL CLIENT che compone l'editor
// END-TO-END attorno al RENDERER UNICO. La pagina server (page.tsx, dietro enterSiteRoute) legge il
// DOCUMENTO CORRENTE (T-304), rende `SiteView` in modalita editable UNA volta (Server Component
// async: gli slot di testo diventano isole passive <EditableText> col data-editable-block-id/slot-id
// di T-305) e ce lo passa come `children`. Qui NON si ri-renderizzano i blocchi: SiteView resta il
// solo renderer (P2-D8 / P3-D5), e questa shell aggiunge solo il chrome attorno all'anteprima gia'
// resa.
//
// PERCHE' L'EDITING SI ATTIVA VIA DOM E NON PASSANDO onEdit COME PROP AL RENDERER: SiteView e' un
// Server Component async e le sue isole sono rese SUL SERVER, dove la callback di edit del draft
// client non esiste — una funzione non attraversa il confine RSC, e `renderBlock` non la inoltra
// comunque. Quindi la shell (client) ATTIVA le isole gia' rese: su ognuna imposta `contentEditable`
// e ascolta `input`, leggendo il `textContent` (TESTO PIANO, MAI innerHTML) e portandolo al draft via
// `editSlot` (T-307). E' la stessa disciplina di sicurezza dell'isola attiva di FX-EDITOR-1 — testo
// non fidato solo come children React, nessun sink di HTML grezzo — spostata sull'attivazione client.
// L'anteprima si aggiorna in loco: l'utente digita DENTRO il nodo contentEditable (aggiornamento
// nativo del DOM), e il draft cattura il testo per il salvataggio. Nessuna copia client dei blocchi.
//
// IL CHROME: switch tema (T-308) che restila DAVVERO i blocchi (le var vanno sugli elementi che
// SiteView stila, non su un antenato schermato — vedi ThemeSwitcher), Salva + autosave con debounce
// (T-309, unica porta saveRevision T-302), storia delle revisioni ripristinabile (T-318) e — quando
// il sito e' scelto — la RISCELTA SOFT non distruttiva dall'editor (T-310) con la conferma
// rassicurante che nomina la conservazione delle modifiche in storia.
//
// SICUREZZA: nessun colore letterale, nessun HTML grezzo (lo scan di T-306 sorveglia src/ui/editor).
// Le server action (saveRevision/restoreRevision/listRevisions/selectVariant) girano sul client di
// SESSIONE (RLS), mai service_role; `siteId`/`generationId` non sono confini di sicurezza — l'azione
// riverifica ownership e stato lato server (P1-D21, CAS TOCTOU-safe di T-310).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { SiteDocument } from '@/domain/generation/document';
import { useEditorDraft } from '@/ui/editor/useEditorDraft';
import { ThemeSwitcher } from '@/ui/editor/ThemeSwitcher';
import { SaveControls } from '@/ui/editor/SaveControls';
import { BlockPanel, type AddableOffer } from '@/ui/editor/BlockPanel';
import {
  saveRevision,
  restoreRevision,
  listRevisions,
  type RevisionSummary,
} from '@/data/site-document-revisions';
import { selectVariant } from '@/data/generation-choose';

/**
 * La RISCELTA dall'editor (T-310): quando il sito e' gia' scelto, l'utente puo' riprendere l'aspetto
 * fresco della proposta. `generationId`/`variantIndex` NON sono confini di sicurezza — selectVariant
 * riverifica ownership e stato sotto RLS; al piu' decidono SE appendere la revisione 'rechosen'.
 */
type RechooseConfig = {
  readonly generationId: string;
  readonly variantIndex: number;
};

/** Le etichette i18n, gia' risolte dal server (namespace 'editor'): la shell non conosce next-intl. */
type EditorLabels = {
  readonly revisionsTitle: string;
  readonly restore: string;
  readonly rechoose: string;
  /** La conferma RASSICURANTE che NOMINA la conservazione delle modifiche in storia (DoD 3, T-310). */
  readonly rechooseConfirm: string;
  readonly rechooseConfirmYes: string;
  readonly rechooseCancel: string;
};

type EditorClientProps = {
  /** Il documento corrente (T-304), stato iniziale del draft di lavoro (T-307). */
  readonly document: SiteDocument;
  /** Il sito: serve alle server action per RITROVARE la generazione corrente sotto RLS (mai come confine). */
  readonly siteId: string;
  /** Il locale gia' vincolato all'allowlist (dalla guardia): destinazione della riscelta. */
  readonly locale: string;
  readonly labels: EditorLabels;
  /** Presente solo quando il sito e' scelto e ha una variante: abilita la riscelta soft (T-310). */
  readonly rechoose?: RechooseConfig;
  /**
   * L'offerta della libreria blocchi (T-314): i blocchi aggiungibili alla pagina `offerPageSlug`,
   * gia' filtrati per precondizione+ruolo e etichettati i18n dal server (composeAddableBlocks). Il
   * pannello compare solo quando offerta, slug e titolo sono presenti e l'offerta non e' vuota; le
   * rotte/test che non li passano non mostrano il pannello. Model-free: ogni voce porta l'istanza
   * risolta dal baseline, non prosa fabbricata.
   */
  readonly offer?: readonly AddableOffer[];
  /** Lo slug della pagina a cui l'offerta si applica (uguaglianza esatta lato dominio). */
  readonly offerPageSlug?: string;
  /** Il nome i18n del pannello blocchi (namespace 'editor'), risolto dal server. */
  readonly addBlockTitle?: string;
  /** L'anteprima gia' resa dal RENDERER UNICO (SiteView editable). Renderer unico, nessuna copia client. */
  readonly children: ReactNode;
  /** Debounce dell'autosave (ms); opzionale, per test/tuning — il default vive in useAutosave. */
  readonly debounceMs?: number;
};

export function EditorClient({
  document: initialDocument,
  siteId,
  locale,
  labels,
  rechoose,
  offer,
  offerPageSlug,
  addBlockTitle,
  children,
  debounceMs,
}: EditorClientProps) {
  const draft = useEditorDraft(initialDocument);
  const previewRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // La sola porta di persistenza (T-302): l'autosave e il pulsante Salva passano ENTRAMBI da qui.
  const save = useCallback(
    (document: SiteDocument) => saveRevision(siteId, document),
    [siteId],
  );

  // ── ATTIVAZIONE DELLE ISOLE (T-305/T-307) ────────────────────────────────────────────────────
  // Le isole rese dal server sono PASSIVE (nessun onEdit oltre il confine RSC). Qui, client-side, le
  // rendiamo editabili e ne portiamo ogni modifica al draft via editSlot — leggendo `textContent`
  // (testo piano), mai innerHTML. `editSlot` e' stabile (useReducer + useCallback), quindi l'effetto
  // si aggancia una volta sola sull'anteprima (statica: e' l'albero server, mai ri-reso qui).
  const editSlot = draft.editSlot;
  useEffect(() => {
    const root = previewRef.current;
    if (root === null) return;
    const isles = Array.from(root.querySelectorAll<HTMLElement>('[data-editable-path]'));
    const disposers = isles.map((isle) => {
      const blockId = isle.getAttribute('data-editable-block-id') ?? '';
      // La coordinata STRUTTURATA dell'isola, JSON-encoded da EditableText (`data-editable-path`): un
      // array di segmenti che sopravvive a una chiave di orari contenente un punto ('lun.ven'), dove
      // uno split sull'attributo joinato la spezzerebbe e la edit sarebbe un no-op silenzioso (fix
      // T-307/D4). EditableText emette sempre l'attributo, quindi il JSON e' presente e ben formato.
      const pathAttr = isle.getAttribute('data-editable-path');
      const path = (pathAttr ? JSON.parse(pathAttr) : []) as string[];
      isle.setAttribute('contenteditable', 'true');
      const handler = () => editSlot(blockId, path, isle.textContent ?? '');
      isle.addEventListener('input', handler);
      return () => {
        isle.removeEventListener('input', handler);
        isle.removeAttribute('contenteditable');
      };
    });
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [editSlot]);

  // ── STORIA DELLE REVISIONI (T-318) ──────────────────────────────────────────────────────────
  const [revisions, setRevisions] = useState<RevisionSummary[]>([]);
  const [, startRevisions] = useTransition();
  const reloadRevisions = useCallback(() => {
    startRevisions(async () => {
      const result = await listRevisions(siteId);
      if (result.ok) setRevisions(result.revisions);
    });
  }, [siteId]);
  useEffect(() => {
    reloadRevisions();
  }, [reloadRevisions]);

  const [restoring, startRestore] = useTransition();
  const restore = useCallback(
    (seq: number) => {
      startRestore(async () => {
        const result = await restoreRevision(siteId, seq);
        // Il ripristino scrive una NUOVA revisione (append-only, T-318): il documento corrente cambia
        // lato server. `router.refresh()` rilegge il read-path (ultima revisione else baseline) e
        // ricompone l'anteprima col RENDERER UNICO — nessun secondo renderer client.
        if (result.ok) router.refresh();
      });
    },
    [siteId, router],
  );

  // ── RISCELTA SOFT NON DISTRUTTIVA (T-310) ───────────────────────────────────────────────────
  // A due passi: il primo click ARMA la conferma rassicurante (nomina la storia), il secondo invoca
  // selectVariant col percorso fromEditor. `confirm:true` copre anche la conferma-di-costo AC-233-4
  // per la riscelta da 'complete' — la conferma dell'utente e' esplicita, e senza di essa l'azione
  // non parte. Al successo selectVariant REINDIRIZZA server-side; qui non si torna dalla chiamata.
  const [armed, setArmed] = useState(false);
  const [rechoosing, startRechoose] = useTransition();
  const confirmRechoose = useCallback(() => {
    if (rechoose === undefined) return;
    startRechoose(async () => {
      await selectVariant({
        siteId,
        generationId: rechoose.generationId,
        locale,
        variantIndex: rechoose.variantIndex,
        confirm: true,
        fromEditor: true,
      });
    });
  }, [rechoose, siteId, locale]);

  return (
    <div className="editor-shell" data-editor-root>
      <div className="editor-chrome">
        <ThemeSwitcher
          themeId={draft.document.theme_id}
          onThemeChange={draft.setTheme}
          rootRef={previewRef}
        />
        <div className="editor-history-controls">
          <button
            type="button"
            className="editor-undo"
            onClick={draft.undo}
            disabled={!draft.canUndo}
          >
            {'↶'}
          </button>
          <button
            type="button"
            className="editor-redo"
            onClick={draft.redo}
            disabled={!draft.canRedo}
          >
            {'↷'}
          </button>
        </div>
        <SaveControls document={draft.document} save={save} debounceMs={debounceMs} />

        {/* LA LIBRERIA BLOCCHI (T-314): compare solo con un'offerta non vuota, uno slug e un titolo.
            L'aggiunta entra nel draft (dominio: riallinea + ri-gate); il save-point la persiste. */}
        {offer && offerPageSlug && addBlockTitle ? (
          <BlockPanel
            pageSlug={offerPageSlug}
            offer={offer}
            title={addBlockTitle}
            onAdd={draft.addBlock}
          />
        ) : null}

        {rechoose ? (
          <div className="editor-rechoose">
            {armed ? (
              <div className="editor-rechoose-confirm" data-rechoose-confirm role="group">
                {/* La conferma RASSICURANTE (DoD 3, T-310): nomina la conservazione in storia. */}
                <p className="editor-rechoose-prompt" data-rechoose-prompt>
                  {labels.rechooseConfirm}
                </p>
                <button
                  type="button"
                  className="editor-rechoose-yes"
                  data-rechoose-yes
                  disabled={rechoosing}
                  onClick={confirmRechoose}
                >
                  {labels.rechooseConfirmYes}
                </button>
                <button
                  type="button"
                  className="editor-rechoose-cancel"
                  data-rechoose-cancel
                  disabled={rechoosing}
                  onClick={() => setArmed(false)}
                >
                  {labels.rechooseCancel}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="editor-rechoose-open"
                data-rechoose-open
                onClick={() => setArmed(true)}
              >
                {labels.rechoose}
              </button>
            )}
          </div>
        ) : null}

        <section className="editor-revisions" aria-label={labels.revisionsTitle}>
          <h2 className="editor-revisions-title">{labels.revisionsTitle}</h2>
          <ul className="editor-revisions-list">
            {revisions.map((revision) => (
              <li key={revision.seq} className="editor-revision" data-revision-seq={revision.seq}>
                <span className="editor-revision-source" data-revision-source={revision.source}>
                  {revision.source}
                </span>
                <button
                  type="button"
                  className="editor-revision-restore"
                  data-restore-seq={revision.seq}
                  disabled={restoring}
                  onClick={() => restore(revision.seq)}
                >
                  {labels.restore}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* L'ANTEPRIMA: l'albero gia' reso dal RENDERER UNICO (SiteView editable). Le var del tema si
          scambiano su questa radice e sui suoi discendenti stilati (ThemeSwitcher). */}
      <div className="editor-preview" ref={previewRef} data-editor-preview>
        {children}
      </div>
    </div>
  );
}
