'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// T-230 (macrotask generation-ui, P2) — IL PULSANTE che OFFRE la generazione: e' cio' che
// rende /api/generate RAGGIUNGIBILE dall'applicazione (non solo esistente nel sorgente) e
// il CONSUMATORE DI PRODUZIONE della rotta di fase 1 (P2-D26). Vive in src/ui/generation/
// (la UI del BUILDER), non in src/ui/site/ (il sito generato): non e' soggetto al confine
// ESLint di T-211 e non tocca alcun token del tema.
//
// COSA FA, e cosa DELIBERATAMENTE non fa (out_of_scope di T-230): POSTa a /api/generate
// SAME-ORIGIN — il browser aggiunge da se' `Sec-Fetch-Site: same-origin` e `Origin`, cioe'
// esattamente cio' che la catena di guardie pretende — e DRENA lo stream a due flush fino
// alla fine, riportando lo stato dell'operazione. NON rende ancora i cinque mockup ne'
// permette la scelta: il SELETTORE che consuma le cornici e il pool e' T-232, che poggia su
// questo seam. Qui c'e' l'avvio e l'esito, non le card.
//
// LE ETICHETTE ARRIVANO GIA' RISOLTE dai props (la pagina server le legge dal catalogo con
// getTranslations): cosi' questo componente client non ha bisogno di NextIntlClientProvider,
// come SiteRow riceve le proprie label dalla dashboard (T-105). Nessuna stringa inline.

type LauncherLabels = {
  /** L'etichetta del pulsante di avvio. */
  readonly generate: string;
  /** Lo stato mentre la generazione e' in corso. */
  readonly generating: string;
  /** Lo stato a generazione conclusa. */
  readonly done: string;
  /** Lo stato quando la generazione non e' andata a buon fine. */
  readonly error: string;
};

type LauncherState = 'idle' | 'generating' | 'done' | 'error';

export function GenerateLauncher({
  siteId,
  labels,
}: {
  readonly siteId: string;
  readonly labels: LauncherLabels;
}) {
  const router = useRouter();
  const [state, setState] = useState<LauncherState>('idle');

  async function start(): Promise<void> {
    setState('generating');
    try {
      // Il siteId va nel BODY (la rotta non ha segmento [siteId]). Same-origin: gli header
      // Sec-Fetch-Site/Origin li mette il browser, ed e' cio' che la guardia pretende.
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ siteId }),
      });
      if (!response.ok || !response.body) {
        setState('error');
        return;
      }
      // Si DRENA lo stream fino alla fine: T-232 sostituira' il drenaggio col consumo delle
      // cornici (primo flush) e del pool (secondo flush) per rendere le cinque card.
      const reader = response.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
      setState('done');
      // WIRE — a stream concluso la riga e' 'ready': si chiede a Next di RILEGGERE i dati server,
      // cosi' la pagina (che ora legge getGeneration) rende il SELETTORE al posto del launcher.
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-sm">
      <button
        type="button"
        onClick={start}
        disabled={state === 'generating'}
        className="self-start rounded-md bg-primary px-md py-sm text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {labels.generate}
      </button>
      {state === 'generating' ? (
        <p className="text-sm text-muted-foreground">{labels.generating}</p>
      ) : null}
      {state === 'done' ? <p className="text-sm text-muted-foreground">{labels.done}</p> : null}
      {state === 'error' ? <p className="text-sm text-muted-foreground">{labels.error}</p> : null}
    </div>
  );
}
