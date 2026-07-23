'use server';

import { cookies } from 'next/headers';
import { hasLocale } from 'next-intl';
import { redirect } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

// Risultato del percorso di rifiuto (validazione fallita). Sul percorso valido
// la funzione non ritorna un valore: redirect() interrompe il flusso lanciando.
type SetLocaleRejected = { ok: false; status: number };

// Server action del selettore lingua. VALIDAZIONE SERVER-SIDE (entrambi gli
// argomenti sono controllabili dal client): (1) il nextLocale è confrontato con
// l'allowlist routing.locales (['it','es']) tramite il type guard hasLocale;
// (2) il currentPathname è ammesso solo se è un path interno — esattamente '/'
// oppure un singolo '/' seguito da un carattere diverso da '/' e '\' — così da
// rifiutare href assoluti ('https://…'), protocol-relative ('//evil.com'),
// backslash-tricks ('/\\evil') e schemi ('javascript:…') che next-intl
// inoltrerebbe grezzi a next/navigation (anti open-redirect / path injection).
// Nessuna delle due validazioni interpola mai il valore grezzo in un path o
// header Location. Fuori allowlist o path non interno → { ok: false,
// status: 400 }, senza cookie né redirect. Se entrambi validi: imposta il
// cookie NEXT_LOCALE (Path=/, SameSite=Lax) e reindirizza allo stesso path con
// il nuovo prefisso di locale tramite l'helper tipato di next-intl.
export async function setLocale(
  nextLocale: string,
  currentPathname: string,
): Promise<SetLocaleRejected> {
  if (!hasLocale(routing.locales, nextLocale)) {
    return { ok: false, status: 400 };
  }

  // Accetta solo path interni: '/' esatto oppure '/' + carattere non '/'/'\'.
  const isInternalPath =
    currentPathname === '/' || /^\/(?![/\\])/.test(currentPathname);
  if (!isInternalPath) {
    return { ok: false, status: 400 };
  }

  const store = await cookies();
  store.set('NEXT_LOCALE', nextLocale, { path: '/', sameSite: 'lax' });

  // redirect() di next-intl non ritorna (lancia per interrompere il flusso, come
  // next/navigation): il return propaga quel `never` senza cadere in fondo.
  return redirect({ href: currentPathname, locale: nextLocale });
}
