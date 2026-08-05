'use client';

// T-305 / T-307 (macrotask editor-core, P3) — L'ISOLA CLIENT di uno slot di testo editabile. In
// modalita editable il renderer UNICO (SiteView, P2-D8) avvolge QUI ogni slot di testo, cosi'
// l'anteprima resta il sito vero e non nasce un secondo renderer client (P3-D5): i blocchi non
// vengono ri-implementati, si aggiunge solo un involucro attorno al testo che gia' rendevano.
//
// IL TESTO NON FIDATO RESTA CHILDREN REACT: arriva come `children` e passa dal solo percorso di
// escape di React — mai iniezione di HTML grezzo, mai HTML serializzato, mai un href/src
// derivato da testo libero (la disciplina di T-241 estesa alla superficie editor, P3-D6). Un
// tag <script> o un attributo onerror nel testo compaiono percio' come TESTO, non come markup.
// La edit inline legge `textContent` (il TESTO piano del nodo), MAI `innerHTML`: cio' che risale
// al draft e' sempre una stringa piana, e il draft resta struttura dati/testo (security_note T-307).
//
// ISOLA ATTIVA (P3-D2): quando arriva `onEdit`, lo span diventa `contentEditable` e ogni modifica
// inline chiama `onEdit(blockId, path, testo)` — e' cosi' che l'anteprima si aggiorna in loco,
// istantanea, senza round-trip server (design §4). Senza `onEdit` l'isola e' PASSIVA: espone le
// coordinate e rende il testo, identica al render read-only salvo l'involucro. La callback scorre
// per PROP dal renderer (SiteView editable -> SiteText -> qui): i blocchi sono Server Component
// async, quindi niente Context — la coordinata e la callback viaggiano come props.
//
// LE COORDINATE sono `data-editable-block-id` + `data-editable-slot-id` (NON `data-block-id`/
// `data-slot-id`): il primo COLLIDEREBBE col `data-block-id` che <SiteSection> mette su ogni
// <section>, e un selettore dell'editor non distinguerebbe piu' l'isola dalla sezione (fix T-305,
// D4). La coordinata di editing e' pero' il `path` STRUTTURATO (array di segmenti), non l'attributo
// puntato: e' `path` che sopravvive a una chiave di orari contenente un punto (fix T-307, D4).

import type { ReactNode } from 'react';

type EditableTextProps = {
  /** L'id del blocco del documento a cui appartiene lo slot (coordina l'isola alla sua sezione). */
  readonly blockId: string;
  /**
   * La coordinata STRUTTURATA del campo dentro il blocco: un array di segmenti col primo che sceglie
   * il ramo ('content' | 'data') e i restanti che indirizzano il campo. Un array, non una stringa
   * puntata, perche' un segmento (una chiave di orari) puo' contenere '.' (fix T-307).
   */
  readonly path: readonly string[];
  /** Il testo non fidato, reso come children React (escaping preservato). */
  readonly children: ReactNode;
  /**
   * Attiva l'isola: se presente, lo slot diventa `contentEditable` e ogni edit inline la invoca con
   * `(blockId, path, testo)`. Assente (read-only del draft, o isola non ancora cablata) => isola
   * passiva. Opzionale cosi' la parita read-only e il render di SiteView senza cablaggio restano
   * identici a P2.
   */
  readonly onEdit?: (blockId: string, path: readonly string[], nextText: string) => void;
};

export function EditableText({ blockId, path, children, onEdit }: EditableTextProps) {
  // Due attributi di coordinata: `data-editable-slot-id` porta la forma JOINATA (ispezione/debug e
  // selettore delle isole), `data-editable-path` porta il PATH STRUTTURATO come JSON — la sola forma
  // NON ambigua quando un segmento (una chiave di orari) contiene un '.' (fix T-307/D4). I consumatori
  // che RICOSTRUISCONO la coordinata dal DOM (l'attivazione isole di EditorClient) leggono il JSON,
  // mai uno split sull'attributo joinato che spezzerebbe 'lun.ven' in due segmenti (no-op silenzioso).
  const slotAttr = path.join('.');
  const pathAttr = JSON.stringify(path);

  // ISOLA PASSIVA: nessuna callback => nessun contentEditable, nessun handler. Identica al render
  // read-only salvo l'involucro <span> e le coordinate.
  if (onEdit === undefined) {
    return (
      <span
        className="site-editable"
        data-editable-block-id={blockId}
        data-editable-slot-id={slotAttr}
        data-editable-path={pathAttr}
      >
        {children}
      </span>
    );
  }

  // ISOLA ATTIVA: `contentEditable` + `onInput`. Il testo resta children React (escaping); la edit
  // legge `textContent` (testo piano) e lo passa al draft — MAI `innerHTML`, mai HTML serializzato.
  // `suppressContentEditableWarning` e' necessario perche' React gestisce i children di un nodo
  // editabile: non introduce alcuna via di iniezione (nessun innerHTML), disattiva solo l'avviso.
  return (
    <span
      className="site-editable"
      data-editable-block-id={blockId}
      data-editable-slot-id={slotAttr}
      data-editable-path={pathAttr}
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => onEdit(blockId, path, event.currentTarget.textContent ?? '')}
    >
      {children}
    </span>
  );
}
