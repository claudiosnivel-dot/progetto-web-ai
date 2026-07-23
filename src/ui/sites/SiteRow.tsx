'use client';

import { useState } from 'react';
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

type SiteRowProps = {
  site: { id: string; name: string; status: string };
  labels: SiteRowLabels;
};

export function SiteRow({ site, labels }: SiteRowProps) {
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
