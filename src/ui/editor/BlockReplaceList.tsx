'use client';

// T-316 (macrotask editor-blocks, P3) — L'AFFORDANCE DI SOSTITUZIONE: per ogni blocco della pagina,
// la lista dei candidati con cui rimpiazzarlo, MODELLO A LISTA (nessun drag pixel-libero). Client
// minimale: elenca i blocchi della pagina nell'ordine CORRENTE del draft e, sotto ognuno, i candidati
// sostitutivi (i blocchi aggiungibili: precondizione+ruolo soddisfatti e non gia' presenti, filtrati
// ed etichettati i18n dal server — la STESSA offerta del pannello di aggiunta, T-314). Un click
// dispaccia la sostituzione al draft (reducer T-316: il dominio riconcilia + ri-gate). Non
// ri-renderizza i blocchi: la struttura resta il renderer UNICO (P2-D8); l'anteprima si aggiorna dal
// draft.
//
// MODEL-FREE (P2-D7): ogni candidato porta l'ISTANZA RISOLTA dal baseline (`AddableOffer.block`), mai
// prosa fabbricata — cosi' la sostituzione mette al posto del vecchio un blocco con dati veri.
//
// SICUREZZA (lo scan anti-XSS di T-306 sorveglia src/ui/editor): nessun colore letterale (solo
// classi), nessun HTML grezzo (le etichette sono children React, ESCAPED), nessun href/src da testo
// libero. Gli id vengono dallo schema (forma vincolata, T-202) e le label dal catalogo i18n, non da
// testo del modello destinato a un attributo.

import type { SiteBlock } from '@/domain/generation/document';
import type { AddableOffer } from '@/ui/editor/BlockPanel';

/** Una voce della lista: il blocco della pagina da poter sostituire, con la sua etichetta risolta. */
type ReplaceItem = {
  readonly id: string;
  readonly label: string;
};

type BlockReplaceListProps = {
  /** Lo slug della pagina i cui blocchi si sostituiscono (uguaglianza esatta lato dominio). */
  readonly pageSlug: string;
  /** I blocchi della pagina nell'ORDINE corrente del draft: l'indice e' la posizione da rimpiazzare. */
  readonly items: readonly ReplaceItem[];
  /** I candidati sostitutivi (offerta della libreria), gia' filtrati e etichettati i18n dal server. */
  readonly offer: readonly AddableOffer[];
  /** Il nome accessibile del controllo, i18n (namespace 'editor'), risolto dal server. */
  readonly title: string;
  /** Dispaccia la sostituzione al draft (reducer T-316): pagina target, indice del blocco, blocco nuovo. */
  readonly onReplace: (pageSlug: string, blockIndex: number, block: SiteBlock) => void;
};

export function BlockReplaceList({ pageSlug, items, offer, title, onReplace }: BlockReplaceListProps) {
  // Nessun blocco in pagina o nessun candidato sostitutivo: niente da sostituire, niente controllo.
  if (items.length === 0 || offer.length === 0) return null;

  return (
    <section className="editor-replace" aria-label={title} data-replace-list>
      <h2 className="editor-replace-title">{title}</h2>
      <ol className="editor-replace-items">
        {items.map((item, index) => (
          <li key={item.id} className="editor-replace-item" data-replace-block-id={item.id}>
            <span className="editor-replace-label">{item.label}</span>
            <ul className="editor-replace-candidates">
              {offer.map((candidate) => (
                <li key={candidate.id} className="editor-replace-candidate">
                  <button
                    type="button"
                    className="editor-replace-with"
                    data-replace-at={index}
                    data-replace-with={candidate.id}
                    onClick={() => onReplace(pageSlug, index, candidate.block)}
                  >
                    {candidate.label}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}
