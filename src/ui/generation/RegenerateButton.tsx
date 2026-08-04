'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { regenerateVariant } from '@/data/generation-regenerate';

// T-232 (macrotask generation-ui, P2) — il pulsante "rigenera questa variante": e' cio' che
// rende `regenerateVariant` (P2-D3) RAGGIUNGIBILE dall'applicazione e non solo esistente nel
// sorgente (consumatore di produzione, P2-D26). Client component perche' l'azione parte da un
// gesto dell'utente; l'etichetta arriva GIA' risolta per prop (la pagina server la legge dal
// catalogo), come GenerateLauncher (T-230) e SiteRow (T-105): nessuna stringa inline, nessun
// NextIntlClientProvider.
//
// A esito riuscito si chiede a Next di RILEGGERE i dati server (`router.refresh`): il selettore
// e' un Server Component che rilegge i pool (readHomePools) e ricompone la card della variante
// dal nuovo pool, mentre le altre quattro restano invariate. Un esito di fallimento —
// 'conflitto' compreso, cioe' la seconda rigenerazione respinta dall'UNIQUE (AC-232-5) — non
// aggiorna nulla e viene solo segnalato.

type RegenerateButtonProps = {
  readonly siteId: string;
  readonly generationId: string;
  readonly variantIndex: number;
  readonly label: string;
};

export function RegenerateButton({
  siteId,
  generationId,
  variantIndex,
  label,
}: RegenerateButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      data-regenerate-variant={variantIndex}
      className="self-start rounded-md border border-border px-md py-sm text-sm font-medium disabled:opacity-60"
      onClick={() =>
        startTransition(async () => {
          setFailed(false);
          const result = await regenerateVariant({ siteId, generationId, variantIndex });
          if (result.ok) router.refresh();
          else setFailed(true);
        })
      }
    >
      {label}
      {failed ? <span data-regenerate-failed="true" aria-hidden="true" /> : null}
    </button>
  );
}
