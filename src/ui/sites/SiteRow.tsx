'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@/ui/primitives';
import { renameSite, deleteSite } from '@/data/sites';

// T-105 — Riga di sito nella dashboard con i controlli di rinomina ed eliminazione.
// Livello UI puro: delega la logica dati alle Server Action di T-103 (renameSite/
// deleteSite), che ri-validano il name server-side e impongono l'isolamento
// cross-tenant via RLS. L'eliminazione richiede una CONFERMA ESPLICITA prima di
// invocare deleteSite (nessuna azione distruttiva a un solo click). Dopo una
// mutazione riuscita si invoca router.refresh() così l'elenco (Server Component)
// viene rifetchato e mostra lo stato aggiornato.
type SiteRowLabels = {
  rename: string;
  save: string;
  delete: string;
  confirmDelete: string;
  cancel: string;
};

// T-153 — Aggancio all'onboarding, calcolato dalla pagina (Server Component) e passato
// qui GIA' pronto: href costruito e stringhe localizzate, come `labels`. Questo componente
// resta un livello UI senza logica dati: non legge brief, non conosce i locale, non
// costruisce percorsi.
//  - OPZIONALE per costruzione: SiteRow e' usata anche in contesti che non hanno l'aggancio
//    (i suoi test di unita' T-105 la rendono con site+labels), e senza la prop la riga e'
//    esattamente quella di prima — nessuna etichetta `undefined` renderizzata.
//  - `readyBadge` e' un SEGNAPOSTO di stato: non e' un controllo, non e' un link, non porta
//    a nessuna generazione (la generazione e' P2 e non esiste ancora).
//  - `statusUnavailable` esiste perche' un GUASTO DI LETTURA non e' "nessun brief": senza
//    di esso un sito confermato il cui getBrief e' fallito sarebbe indistinguibile da un
//    draft, cioe' un errore reso come stato vuoto.
type SiteOnboardingLink = {
  href: string;
  ctaLabel: string;
  readyBadge?: string;
  statusUnavailable?: string;
};

type SiteRowProps = {
  site: { id: string; name: string; status: string };
  labels: SiteRowLabels;
  onboarding?: SiteOnboardingLink;
};

export function SiteRow({ site, labels, onboarding }: SiteRowProps) {
  const router = useRouter();
  const [name, setName] = useState(site.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleRename() {
    await renameSite(site.id, name);
    router.refresh();
  }

  async function handleDelete() {
    await deleteSite(site.id);
    router.refresh();
  }

  return (
    <li className="flex flex-col gap-sm rounded-md border border-border px-md py-sm">
      <div className="flex items-center gap-md">
        <span className="text-sm font-medium text-foreground">{site.name}</span>
        <span className="text-xs text-muted-foreground">{site.status}</span>
      </div>

      {/* T-153 — CTA e stato del brief. L'href arriva gia' costruito dalla pagina (locale
          dall'allowlist + siteId codificato): qui nessun valore di testo entra in un href.
          Il nome del sito e lo stato del brief restano nodi di testo JSX (escaping di React),
          mai innerHTML — §7 p.4: sono input NON FIDATO in rendering. */}
      {onboarding ? (
        <div className="flex flex-wrap items-center gap-sm">
          <Link href={onboarding.href} className="text-sm font-medium text-foreground underline">
            {onboarding.ctaLabel}
          </Link>
          {onboarding.readyBadge ? (
            <span className="rounded-md bg-secondary px-sm py-xs text-xs font-medium text-secondary-foreground">
              {onboarding.readyBadge}
            </span>
          ) : null}
          {onboarding.statusUnavailable ? (
            <span className="text-xs text-muted-foreground">{onboarding.statusUnavailable}</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-sm">
        <Input
          aria-label={labels.rename}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="max-w-xs"
        />
        <Button type="button" variant="secondary" onClick={handleRename}>
          {labels.save}
        </Button>

        {confirmingDelete ? (
          <>
            <Button type="button" onClick={handleDelete}>
              {labels.confirmDelete}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmingDelete(false)}
            >
              {labels.cancel}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setConfirmingDelete(true)}
          >
            {labels.delete}
          </Button>
        )}
      </div>
    </li>
  );
}
