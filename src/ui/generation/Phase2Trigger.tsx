'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { runPhase2 } from '@/data/generation-phase2';

// WIRE (macrotask generation-ui, P2) — IL TRIGGER DELLA FASE 2: e' cio' che rende `runPhase2`
// (T-234) RAGGIUNGIBILE dall'applicazione e non solo esistente nel sorgente (consumatore di
// PRODUZIONE, P2-D26). Montato dalla rotta /generate quando la generazione e' 'chosen' (variante
// scelta, home congelata) ma le pagine interne non sono ancora costruite: un gesto esplicito
// dell'utente avvia la fase 2, che genera le interne a CHUNK (P2-D13) e, a buon fine, porta la
// generazione a 'complete'. Client component perche' l'avvio parte da un gesto; l'etichetta
// arriva GIA' risolta per prop, come GenerateLauncher e RegenerateButton.
//
// A ESITO RIUSCITO si chiede a Next di RILEGGERE i dati server (router.refresh): la rotta rilegge
// lo stato (getGeneration) e non offre piu' il trigger (status 'complete'). Un esito di
// fallimento — 'conflitto' (la RI-fase2 respinta dall'UNIQUE), 'stato_non_valido',
// 'confine_fallito' — non naviga e viene solo segnalato. Gli id sono derivati server-side (dalla
// rotta) e `runPhase2` li RIVALIDA col client di sessione (RLS, solo su 'chosen' e sulla variante
// scelta): il trigger e' un avvio, non un'autorizzazione.

export function Phase2Trigger({
  siteId,
  generationId,
  label,
}: {
  readonly siteId: string;
  readonly generationId: string;
  readonly label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      data-phase2-trigger="true"
      className="self-start rounded-md bg-primary px-md py-sm text-sm font-medium text-primary-foreground disabled:opacity-60"
      onClick={() =>
        startTransition(async () => {
          setFailed(false);
          const result = await runPhase2({ siteId, generationId });
          if (result.ok) router.refresh();
          else setFailed(true);
        })
      }
    >
      {label}
      {failed ? <span data-phase2-failed="true" aria-hidden="true" /> : null}
    </button>
  );
}
