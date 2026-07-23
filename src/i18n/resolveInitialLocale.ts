import { cookies } from 'next/headers';
import { hasLocale } from 'next-intl';
import { routing } from '@/i18n/routing';
import { getProfileLocale } from '@/data/updateProfileLocale';

// T-083 — Risoluzione del locale iniziale al bootstrap del layout.
//
// Precedenza dichiarata: cookie NEXT_LOCALE (T-082) > preferenza persistita
// profiles.locale (T-083) > locale dell'URL / default. Ogni sorgente è validata
// contro l'allowlist routing.locales prima di essere usata: un valore fuori
// allowlist viene ignorato e si passa alla sorgente successiva (nessun locale
// arbitrario raggiunge next-intl). La lettura del profilo è consultata SOLO quando
// il cookie è assente/non valido, così il costo (una query per PK indicizzata) non
// grava sul percorso comune in cui il cookie è già impostato.
export async function resolveInitialLocale(urlLocale: string): Promise<string> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  if (cookieLocale && hasLocale(routing.locales, cookieLocale)) {
    return cookieLocale;
  }

  const profileLocale = await getProfileLocale();
  if (profileLocale && hasLocale(routing.locales, profileLocale)) {
    return profileLocale;
  }

  return hasLocale(routing.locales, urlLocale) ? urlLocale : routing.defaultLocale;
}
