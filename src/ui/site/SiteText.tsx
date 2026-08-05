// T-305 / T-307 (macrotask editor-core, P3) — IL SEAM che instrada uno slot di testo del sito. E'
// il SOLO punto che decide la modalita', cosi' ogni blocco dichiara i propri slot senza ripetere
// il condizionale e senza che il renderer si sdoppi (renderer UNICO, P2-D8 / P3-D5).
//
// In sola lettura restituisce i figli TALI E QUALI (un Fragment non emette alcun nodo): il DOM
// resta identico al render di P2 — e' la parita che AC-305-2 e la batteria di identita'
// (tests/site-renderer-identity.test.ts) pretendono. In modalita editable avvolge il testo
// nell'isola client <EditableText> portando block id + coordinata + l'eventuale callback di edit.
// Il testo non fidato resta children React in ENTRAMBI i rami: l'escaping non dipende dalla
// modalita', e nessun href/src nasce da qui (la disciplina di T-241 vale identica, P3-D6).
//
// LA COORDINATA E' STRUTTURATA (fix T-307). I blocchi passano `slot` come stringa puntata
// ('content.hero_title', 'data.hours.<giorno>'); qui diventa un array di segmenti per l'isola. Uno
// split su '.' e' corretto per ogni slot TRANNE quelli con una chiave che contiene un punto (una
// chiave di orari, es. 'lun.ven'): per quelli il blocco puo' passare `path` gia' segmentato
// (['data','hours', giorno]), che vince sullo split. Cosi' il punto dentro la chiave non e' mai
// ambiguo e la edit non e' un no-op silenzioso.

import type { ReactNode } from 'react';
import { EditableText } from '@/ui/editor/EditableText';

type SiteTextProps = {
  /** Se true, il testo diventa un'isola editabile; se falsy, resta children puri (parita P2). */
  readonly editable?: boolean;
  /** L'id del blocco del documento a cui appartiene lo slot. */
  readonly block: string;
  /** La coordinata dello slot come stringa PUNTATA (forma esistente dei blocchi, P2). */
  readonly slot: string;
  /**
   * La coordinata STRUTTURATA (array di segmenti), quando il blocco la conosce gia' segmentata:
   * necessaria dove una chiave puo' contenere '.' (orari). Se assente, si deriva da `slot` con uno
   * split su '.'. Opzionale, cosi' i blocchi esistenti non cambiano.
   */
  readonly path?: readonly string[];
  /** Il testo non fidato, reso come children React. */
  readonly children: ReactNode;
  /**
   * La callback di edit inline, inoltrata all'isola: quando presente l'isola e' ATTIVA e ogni
   * modifica chiama `onEdit(block, path, testo)`. Assente => isola passiva (parita read-only).
   */
  readonly onEdit?: (blockId: string, path: readonly string[], nextText: string) => void;
};

export function SiteText({ editable, block, slot, path, children, onEdit }: SiteTextProps) {
  if (!editable) return <>{children}</>;
  const resolvedPath = path ?? slot.split('.');
  return (
    <EditableText blockId={block} path={resolvedPath} onEdit={onEdit}>
      {children}
    </EditableText>
  );
}
