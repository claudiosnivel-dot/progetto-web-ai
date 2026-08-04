'use client';

import { useState, useTransition } from 'react';
import { selectVariant } from '@/data/generation-choose';
import type { GenerationStatus } from '@/data/generations';

// WIRE (macrotask generation-ui, P2) — IL PULSANTE DI SCELTA: e' cio' che rende `selectVariant`
// (T-233) RAGGIUNGIBILE dall'applicazione e non solo esistente nel sorgente (consumatore di
// PRODUZIONE, P2-D26 — chiude l'orfano rilevato su T-233). Una scelta per card del selettore
// (montato da GenerationChooser). Client component perche' la scelta parte da un GESTO
// dell'utente; le etichette arrivano GIA' risolte per prop (la pagina server le legge dal
// catalogo), come GenerateLauncher e RegenerateButton: nessuna stringa inline, nessun
// NextIntlClientProvider.
//
// A ESITO RIUSCITO `selectVariant` REINDIRIZZA all'anteprima (redirect server-side): il client
// NON torna dalla chiamata, quindi qui si gestisce solo l'esito ok:false (che si segnala senza
// navigare). L'indice di variante e la validazione dello stato restano al server (T-233): questo
// pulsante e' un AVVIO, non un'autorizzazione.
//
// LA RISCELTA DOPO LA FASE 2 (AC-233-4) E' UN GESTO REALE A DUE PASSI, non un bool nudo spedito
// dal client: quando lo stato e' 'complete', riscegliere rifa' la fase 2 — un costo in chiamate
// al modello a pagamento — quindi il primo click ARMA la conferma e solo il secondo (il pulsante
// di conferma del dialog) invoca l'azione con confirm=true. Senza quel secondo gesto l'azione
// NON parte: `confirm:true` non e' mai spedito senza un'azione esplicita dell'utente. Per 'ready'
// e 'chosen' la scelta e' diretta (nessun costo di fase 2): un solo click, confirm=false.

type ChooseVariantLabels = {
  /** L'etichetta del pulsante di scelta. */
  readonly choose: string;
  /** Il testo del dialog di conferma della riscelta dopo la fase 2 (AC-233-4). */
  readonly confirmPrompt: string;
  /** Il pulsante che CONFERMA la riscelta (il secondo gesto). */
  readonly confirm: string;
  /** Il pulsante che ANNULLA la conferma e torna alla scelta. */
  readonly cancel: string;
};

type ChooseVariantButtonProps = {
  readonly siteId: string;
  readonly generationId: string;
  readonly locale: string;
  readonly variantIndex: number;
  /** Lo stato corrente della generazione: 'complete' pretende il gesto a due passi (AC-233-4). */
  readonly status: GenerationStatus;
  readonly labels: ChooseVariantLabels;
};

export function ChooseVariantButton({
  siteId,
  generationId,
  locale,
  variantIndex,
  status,
  labels,
}: ChooseVariantButtonProps) {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [failed, setFailed] = useState(false);

  // SOLO la riscelta DOPO la fase 2 ha un costo: 'complete' pretende la conferma a due passi.
  const requiresConfirm = status === 'complete';

  function choose(confirm: boolean): void {
    startTransition(async () => {
      setFailed(false);
      // Al SUCCESSO selectVariant REINDIRIZZA server-side: il codice qui sotto o non viene
      // raggiunto o riceve un valore assente (la navigazione e' gia' in corso). Solo un esito
      // ok:false ritorna un oggetto, e lo si segnala senza navigare. La guardia legge `.ok` solo
      // se `result` c'e' davvero: mai un accesso su un valore assente dopo il redirect.
      const result = await selectVariant({ siteId, generationId, locale, variantIndex, confirm });
      if (result && !result.ok) setFailed(true);
    });
  }

  // Il DIALOG di conferma (secondo passo): compare solo dopo aver ARMATO la riscelta su 'complete'.
  if (requiresConfirm && armed) {
    return (
      <div data-choose-confirm-dialog={variantIndex} className="flex flex-col gap-sm">
        <p className="text-sm text-muted-foreground">{labels.confirmPrompt}</p>
        <div className="flex gap-sm">
          <button
            type="button"
            disabled={pending}
            data-choose-confirm={variantIndex}
            className="self-start rounded-md bg-primary px-md py-sm text-sm font-medium text-primary-foreground disabled:opacity-60"
            onClick={() => choose(true)}
          >
            {labels.confirm}
          </button>
          <button
            type="button"
            disabled={pending}
            data-choose-cancel={variantIndex}
            className="self-start rounded-md border border-border px-md py-sm text-sm font-medium disabled:opacity-60"
            onClick={() => setArmed(false)}
          >
            {labels.cancel}
          </button>
        </div>
        {failed ? <span data-choose-failed="true" aria-hidden="true" /> : null}
      </div>
    );
  }

  // Il PULSANTE di scelta. Su 'complete' il click ARMA soltanto (il gesto reale e' la conferma);
  // su 'ready'/'chosen' invoca direttamente l'azione (confirm=false).
  return (
    <button
      type="button"
      disabled={pending}
      data-choose-variant={variantIndex}
      className="self-start rounded-md bg-primary px-md py-sm text-sm font-medium text-primary-foreground disabled:opacity-60"
      onClick={() => (requiresConfirm ? setArmed(true) : choose(false))}
    >
      {labels.choose}
      {failed ? <span data-choose-failed="true" aria-hidden="true" /> : null}
    </button>
  );
}
