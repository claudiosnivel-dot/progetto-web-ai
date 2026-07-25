import type { Brief } from '@/domain/onboarding/brief';

// T-151 / T-152 — Cio' che il pannello brief e la schermata Rivedi&conferma condividono
// sui CAMPI del brief, in una sola sede.
//
// PERCHE' esiste: le allowlist erano dichiarate in BriefPanel ed erano importate da
// ReviewConfirm — cioe' un componente importava costanti di dominio da un altro
// componente — mentre i due convertitori (`asVertical`/`asGoal`) e il tipo della patch
// erano scritti due volte identici. Il controllo dead-code del checkpoint li ha misurati
// come duplicazioni fra i due file. Non e' un'astrazione speculativa: e' togliere copie
// di una proprieta' che deve essere una sola, come fatto in T-121 per i tetti di P1-D17.
//
// RISCHIO DICHIARATO (invariato, ereditato da T-151): gli enum sono RIDICHIARATI qui
// perche' `brief.ts` (T-121) non li esporta e questo macrotask non puo' toccarlo. Se
// l'allowlist di T-121 cambiasse, questa copia divergerebbe in silenzio. Mitigazione
// eseguibile, non una promessa: un test lega ogni valore offerto qui a
// `BriefUpdateSchema`, cosi' una rinomina o una rimozione non resta muta. Il test NON
// cattura le AGGIUNTE: un `vertical` nuovo in T-121 mancherebbe dalle select senza che
// nulla diventi rosso.
export const VERTICAL_OPTIONS = [
  'ristorazione',
  'fitness',
  'salone_studio',
  'negozio_artigiano',
  'altro',
] as const;
export const GOAL_OPTIONS = ['prenota', 'ordina', 'contatta'] as const;

// La patch e' un sottoinsieme di BriefUpdateSchema: solo i campi core che queste
// schermate rendono editabili. Non e' una ri-dichiarazione dello schema — la validazione
// resta server-side (T-121 + P1-D17) — ma il tipo di cio' che si spedisce.
export type BriefCorePatch = Partial<{
  business_name: string;
  description: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  vertical: Brief['vertical'];
  primary_goal: NonNullable<Brief['primary_goal']>;
  hours: Record<string, string>;
}>;

// Il valore di un <select> e' una stringa qualunque: si accetta solo se e' nell'allowlist.
// `undefined` significa "non lo spedisco", non "lo cancello".
export function asVertical(value: string): Brief['vertical'] | undefined {
  return VERTICAL_OPTIONS.find((option) => option === value);
}

export function asGoal(value: string): NonNullable<Brief['primary_goal']> | undefined {
  return GOAL_OPTIONS.find((option) => option === value);
}
