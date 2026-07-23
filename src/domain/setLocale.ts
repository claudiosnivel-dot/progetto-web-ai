'use server';

import { cookies } from 'next/headers';
import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { updateProfileLocale } from '@/data/updateProfileLocale';

// Risultato del percorso di rifiuto (validazione fallita). Sul percorso valido
// la funzione non ritorna un valore: redirect() interrompe il flusso lanciando.
type SetLocaleRejected = { ok: false; status: number };

// Server action del selettore lingua. VALIDAZIONE SERVER-SIDE (entrambi gli
// argomenti sono controllabili dal client): (1) il nextLocale e confrontato con
// l'allowlist routing.locales (['it','es']) tramite il type guard hasLocale;
// (2) il currentPathname e ammesso solo se e un path interno — esattamente '/'
// oppure un singolo '/' seguito da un carattere diverso da '/' e '\' — e privo
// di caratteri di controllo Unicode. Cosi si rifiutano href assoluti
// ('https://...'), protocol-relative ('//evil.com'), backslash-trick ('/\evil'),
// schemi ('javascript:...') e lo smuggling via caratteri di controllo (che i
// parser di URL rimuovono, potendo far uscire la destinazione dal same-origin)
// che next-intl inoltrerebbe. Nessuna delle due validazioni interpola mai il
// valore grezzo in un path o header Location. Fuori allowlist o path non interno
// -> { ok: false, status: 400 }, senza cookie ne redirect. Se entrambi validi:
// imposta il cookie NEXT_LOCALE (Path=/, SameSite=Lax) e reindirizza allo stesso
// path col nuovo prefisso di locale tramite l'helper tipato di next-intl.
export async function setLocale(
  nextLocale: string,
  currentPathname: string,
): Promise<SetLocaleRejected> {
  if (!hasLocale(routing.locales, nextLocale)) {
    return { ok: false, status: 400 };
  }

  // Path interno: '/' esatto oppure '/' + carattere non '/'/'\', e privo di
  // caratteri di controllo Unicode (\p{Cc}: C0/C1/DEL). I control-char sono un
  // vettore di smuggling che i parser di URL normalizzano potendo far uscire la
  // destinazione dal same-origin: li rifiutiamo esplicitamente.
  const hasControlChars = /\p{Cc}/u.test(currentPathname);
  const isInternalPath =
    !hasControlChars &&
    (currentPathname === '/' || /^\/(?![/\\])/.test(currentPathname));
  if (!isInternalPath) {
    return { ok: false, status: 400 };
  }

  // Persistenza OLTRE il cookie (T-083): se l'utente è autenticato, salva la
  // preferenza su profiles.locale (updateProfileLocale valida il locale e vincola
  // la scrittura alla propria riga via RLS). Best-effort — un fallimento (utente
  // anonimo, errore DB) NON deve impedire il cambio lingua via cookie/redirect.
  try {
    await updateProfileLocale(nextLocale);
  } catch {
    // ignorato di proposito: la persistenza su DB è additiva rispetto al cookie.
  }

  const store = await cookies();
  store.set('NEXT_LOCALE', nextLocale, { path: '/', sameSite: 'lax' });

  // redirect() di next-intl non ritorna (lancia per interrompere il flusso, come
  // next/navigation): il return propaga quel `never` senza cadere in fondo.
  return redirect({ href: currentPathname, locale: nextLocale });
}
