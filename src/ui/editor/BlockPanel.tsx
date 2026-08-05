'use client';

// T-314 (macrotask editor-blocks, P3) — IL PANNELLO BLOCCHI: la libreria da cui aggiungere una
// sezione a una pagina, MODELLO A LISTA (nessun drag pixel-libero). Client MINIMALE: elenca i blocchi
// offerti per la loro LABEL i18n (dal catalogo, mai prosa non tradotta ne id grezzo) e dispaccia
// l'aggiunta al draft. Non ri-renderizza i blocchi: la struttura resta il renderer UNICO (P2-D8).
//
// L'OFFERTA E' COMPOSTA A MONTE (server, src/app): brief + baseline + `addableBlocks` + `siteBlockLabel`
// vivono nell'app (che puo' importare data/ui/domain); qui arriva gia' pronta come dati serializzabili
// { id, label, block }, dove `block` e' l'ISTANZA RISOLTA sorgentata dal baseline (model-free, P2-D7):
// il pannello non fabbrica prosa e non chiama il modello. Solo i blocchi con precondizione dati
// soddisfatta e non gia' presenti compaiono qui, perche' l'offerta li ha gia' filtrati (AC-314-2).
//
// SICUREZZA (lo scan anti-XSS di T-306 sorveglia src/ui/editor): nessun colore letterale (solo classi),
// nessun HTML grezzo (la label e' children React, ESCAPED), nessun href/src da testo libero. La label
// e l'id vengono dal nostro catalogo/offerta, non da testo del modello destinato a un attributo.

import type { SiteBlock } from '@/domain/generation/document';

/** Una voce dell'offerta: id del blocco, la sua label i18n gia' risolta, e l'istanza risolta da aggiungere. */
export type AddableOffer = {
  readonly id: string;
  readonly label: string;
  readonly block: SiteBlock;
};

type BlockPanelProps = {
  /** Lo slug della pagina a cui l'aggiunta si applica (uguaglianza esatta lato dominio). */
  readonly pageSlug: string;
  /** L'elenco dei blocchi offerti, gia' filtrato e etichettato dal server. */
  readonly offer: readonly AddableOffer[];
  /** Il nome accessibile del pannello, i18n (namespace 'editor'), risolto dal server. */
  readonly title: string;
  /** Dispaccia l'aggiunta al draft (reducer T-314). Riceve la pagina target e il blocco risolto. */
  readonly onAdd: (pageSlug: string, block: SiteBlock) => void;
};

export function BlockPanel({ pageSlug, offer, title, onAdd }: BlockPanelProps) {
  // Nessun blocco offerto (tutti gia' presenti, o nessuna precondizione soddisfatta): niente pannello.
  if (offer.length === 0) return null;

  return (
    <section className="editor-block-panel" aria-label={title} data-block-panel>
      <h2 className="editor-block-panel-title">{title}</h2>
      <ul className="editor-block-panel-list">
        {offer.map((item) => (
          <li key={item.id} className="editor-block-panel-item">
            <button
              type="button"
              className="editor-block-add"
              data-add-block-id={item.id}
              onClick={() => onAdd(pageSlug, item.block)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
