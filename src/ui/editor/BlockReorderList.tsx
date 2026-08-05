'use client';

// T-315 (macrotask editor-blocks, P3) — IL CONTROLLO LISTA DI RIORDINO: sposta un blocco su/giu'
// entro una pagina, MODELLO A LISTA (nessun drag pixel-libero, DoD T-315). Client minimale: elenca i
// blocchi della pagina nell'ordine CORRENTE del draft e, per ognuno, offre "su" e "giu'" che
// dispacciano il riordino al draft (reducer T-315). Non ri-renderizza i blocchi: la struttura resta
// il renderer UNICO (P2-D8) — qui c'e' solo l'affordance di riordino, e l'anteprima si aggiorna dal
// draft. Gli indici passati sono le POSIZIONI correnti nella lista, che il dominio valida e ri-gate.
//
// SICUREZZA (lo scan anti-XSS di T-306 sorveglia src/ui/editor): nessun colore letterale (solo
// classi), nessun HTML grezzo (l'etichetta e' children React, ESCAPED), nessun href/src da testo
// libero. L'id del blocco viene dal nostro schema (forma vincolata, T-202), non da testo del modello
// destinato a un attributo.

/** Una voce della lista di riordino: l'id del blocco e la sua etichetta gia' risolta. */
type ReorderItem = {
  readonly id: string;
  readonly label: string;
};

type BlockReorderListProps = {
  /** Lo slug della pagina i cui blocchi si riordinano (uguaglianza esatta lato dominio). */
  readonly pageSlug: string;
  /** I blocchi della pagina nell'ORDINE corrente del draft. */
  readonly items: readonly ReorderItem[];
  /** Il nome accessibile del controllo, i18n (namespace 'editor'), risolto dal server. */
  readonly title: string;
  /** L'etichetta del comando "sposta su" (namespace 'editor'), risolta dal server. */
  readonly moveUpLabel: string;
  /** L'etichetta del comando "sposta giu'" (namespace 'editor'), risolta dal server. */
  readonly moveDownLabel: string;
  /** Dispaccia il riordino al draft (reducer T-315): pagina target, indice sorgente, indice destinazione. */
  readonly onReorder: (pageSlug: string, fromIndex: number, toIndex: number) => void;
};

export function BlockReorderList({
  pageSlug,
  items,
  title,
  moveUpLabel,
  moveDownLabel,
  onReorder,
}: BlockReorderListProps) {
  // Meno di due blocchi: non c'e' nulla da riordinare, niente controllo.
  if (items.length < 2) return null;

  return (
    <section className="editor-reorder" aria-label={title} data-reorder-list>
      <h2 className="editor-reorder-title">{title}</h2>
      <ol className="editor-reorder-items">
        {items.map((item, index) => (
          <li key={item.id} className="editor-reorder-item" data-reorder-block-id={item.id}>
            <span className="editor-reorder-label">{item.label}</span>
            {/* "Su": scambia con la posizione precedente. Disabilitato in cima. */}
            <button
              type="button"
              className="editor-reorder-up"
              data-reorder-up={item.id}
              disabled={index === 0}
              onClick={() => onReorder(pageSlug, index, index - 1)}
            >
              {moveUpLabel}
            </button>
            {/* "Giu'": scambia con la posizione successiva. Disabilitato in fondo. */}
            <button
              type="button"
              className="editor-reorder-down"
              data-reorder-down={item.id}
              disabled={index === items.length - 1}
              onClick={() => onReorder(pageSlug, index, index + 1)}
            >
              {moveDownLabel}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
