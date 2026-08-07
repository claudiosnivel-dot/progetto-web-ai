'use client';

// T-416 (macrotask media-editor-render, P4) — L'AFFORDANCE "carica foto": per OGNI slot immagine di
// un blocco, un input file che manda il file al server e, su esito ok, deposita nel draft lo slot
// `uploaded` col nuovo asset_id. Client MINIMALE, gemello di BlockPanel (T-314): elenca gli slot e
// dispaccia; non ri-renderizza i blocchi (la struttura resta il renderer UNICO, P2-D8/T-415).
//
// DUE PORTE, MAI TRE. Il file va al server SOLO via `uploadAsset` (server action 'use server', M4:
// sniff magic-bytes + re-encode sharp + RLS owner-boundary), MAI un upload diretto browser->bucket.
// La PERSISTENZA non passa da qui: su ok si dispaccia l'azione del draft e il SAVE-POINT (autosave/
// esplicito, T-309) persiste il draft cambiato via saveRevision — l'unica porta di scrittura. Questo
// componente non scrive nulla e non costruisce alcun <img>: un esito NON-OK e' un no-op silenzioso
// (nessun dispatch, niente nel draft, niente persistito).
//
// SICUREZZA (lo scan anti-XSS di T-306 sorveglia src/ui/editor): nessun colore letterale (solo
// classi), nessun HTML grezzo, nessun href/src da testo libero. L'unico dato che rientra e' l'asset_id
// (un uuid) restituito da uploadAsset, e lo slot che ne nasce e' irrappresentabile come indirizzo
// (P2-D12); l'<img> lo costruisce il renderer unico da assetPublicUrl(asset_id), non questo pannello.
// `siteId` NON e' un confine di sicurezza: uploadAsset riverifica ownership sotto RLS.

import { useCallback } from 'react';
import { uploadAsset } from '@/data/media/uploadAsset';

/** La coordinata di uno slot immagine nel draft: il blocco (id esatto) e la posizione dello slot. */
type ImageSlotRef = {
  readonly blockId: string;
  readonly imageIndex: number;
};

type ImageUploadPanelProps = {
  /** Il sito destinatario dell'upload (RLS-backed lato server, mai un confine qui). */
  readonly siteId: string;
  /** Gli slot immagine del draft, derivati da draft.document dalla shell (blockId + indice). */
  readonly slots: readonly ImageSlotRef[];
  /** Il nome accessibile del pannello, i18n (namespace 'editor'), risolto dal server. */
  readonly title: string;
  /** L'etichetta del controllo ("Carica foto"), i18n (namespace 'editor'), risolta dal server. */
  readonly uploadLabel: string;
  /** Dispaccia al draft lo slot uploaded (reducer T-416): blocco (id esatto), indice, asset_id. */
  readonly onUploaded: (blockId: string, imageIndex: number, assetId: string) => void;
};

export function ImageUploadPanel({ siteId, slots, title, uploadLabel, onUploaded }: ImageUploadPanelProps) {
  // Il file passa dal SERVER (uploadAsset); solo su ok si dispaccia. Un esito non-ok e' un no-op.
  const handleUpload = useCallback(
    async (blockId: string, imageIndex: number, file: File) => {
      const result = await uploadAsset(siteId, file);
      if (!result.ok) return; // sniff fail / SVG / oversize / 401 / 404 / 500: nulla nel draft.
      onUploaded(blockId, imageIndex, result.asset_id);
    },
    [siteId, onUploaded],
  );

  // Nessuno slot immagine nel draft: niente pannello (come BlockPanel su offerta vuota).
  if (slots.length === 0) return null;

  return (
    <section className="editor-image-upload-panel" aria-label={title} data-image-upload-panel>
      <h2 className="editor-image-upload-title">{title}</h2>
      <ul className="editor-image-upload-list">
        {slots.map((slot) => (
          <li key={`${slot.blockId}:${slot.imageIndex}`} className="editor-image-upload-item">
            <label className="editor-image-upload-control">
              <span className="editor-image-upload-text">{uploadLabel}</span>
              <input
                type="file"
                className="editor-image-upload-input"
                accept="image/jpeg,image/png,image/webp"
                data-upload-block-id={slot.blockId}
                data-upload-image-index={slot.imageIndex}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset del valore: consente di ri-selezionare lo stesso file (nuovo onChange).
                  event.target.value = '';
                  if (file) void handleUpload(slot.blockId, slot.imageIndex, file);
                }}
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
