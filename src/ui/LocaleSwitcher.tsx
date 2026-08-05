'use client';

import { useLocale } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { setLocale } from '@/app/[locale]/_shared/set-locale';
import { routing } from '@/i18n/routing';
import { cn } from '@/ui/lib/cn';

// Selettore lingua (componente client). La lingua attiva è determinata da
// useLocale() e marcata con aria-current="true"; il path corrente viene da
// usePathname() (helper di navigazione next-intl). Al cambio invoca la server
// action setLocale(nuovoLocale, pathname), che valida il locale server-side,
// persiste il cookie e reindirizza. Stile con sole classi da token del design
// system (nessun hex né valore arbitrario Tailwind).
export function LocaleSwitcher() {
  const active = useLocale();
  const pathname = usePathname();

  return (
    <div role="group" aria-label="Lingua" className="inline-flex gap-xs">
      {routing.locales.map((locale) => {
        const isActive = locale === active;
        return (
          <button
            key={locale}
            type="button"
            aria-current={isActive ? 'true' : undefined}
            onClick={() => {
              void setLocale(locale, pathname);
            }}
            className={cn(
              'rounded-md px-md py-sm text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground',
            )}
          >
            {locale}
          </button>
        );
      })}
    </div>
  );
}
