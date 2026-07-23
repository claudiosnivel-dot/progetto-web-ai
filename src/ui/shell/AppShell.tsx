'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getBrandName } from '@/config/brand';
import { cn } from '@/ui/lib/cn';

type NavItem = { href: string; label: string };

type AppShellProps = {
  navItems: NavItem[];
  children: ReactNode;
};

// AppShell: layout dell'area autenticata, puramente presentazionale. Riceve le
// voci nav via props e legge il brand da getBrandName() (config pubblica). Nessuna
// auth/authz né query dati qui: il controllo d'accesso è a monte (middleware/auth).
// Landmark semantici (header/nav/main) + skip-link per l'accessibilità. Stilizzato
// solo con classi dai token del design system: nessun hex né valore arbitrario.
export function AppShell({ navItems, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      {/* Skip-link: primo elemento focusabile, saltato dal flusso visivo finché
          non riceve il focus (sr-only -> visibile su focus). */}
      <a
        href="#main-content"
        className="sr-only rounded-md bg-primary px-md py-sm text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-sm focus:top-sm focus:z-10"
      >
        Vai al contenuto
      </a>

      <header className="border-b border-border bg-background">
        <div className="flex items-center gap-lg px-lg py-md">
          <span className="text-lg font-semibold text-foreground">
            {getBrandName()}
          </span>
          <nav aria-label="Principale">
            <ul className="flex items-center gap-md">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'text-sm font-medium transition-colors',
                        active
                          ? 'text-foreground'
                          : 'text-muted-foreground',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-lg py-lg">
        {children}
      </main>
    </div>
  );
}
