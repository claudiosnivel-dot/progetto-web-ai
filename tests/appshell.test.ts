// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { createElement as h, type ReactNode } from 'react';
import { getBrandName } from '@/config/brand';
import { AppShell } from '@/ui/shell/AppShell';

// next/navigation: pathname mockato a "/sites" così la voce "Siti" risulta attiva.
vi.mock('next/navigation', () => ({
  usePathname: () => '/sites',
}));

// next/link: default export che rende un <a> inoltrando href/aria-current/children,
// così il test non dipende dal runtime Next (routing, prefetch, ecc.).
type MockLinkProps = {
  href: string;
  children?: ReactNode;
  'aria-current'?: 'page';
};
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: MockLinkProps) =>
      createElement('a', { href, ...rest }, children),
  };
});

// Ripristina lo stato originale di NEXT_PUBLIC_BRAND_NAME (AC-022-2 lo cancella).
const ORIGINAL_BRAND = process.env.NEXT_PUBLIC_BRAND_NAME;
afterEach(() => {
  cleanup();
  if (ORIGINAL_BRAND === undefined) {
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
  } else {
    process.env.NEXT_PUBLIC_BRAND_NAME = ORIGINAL_BRAND;
  }
});

// T-022 — AppShell: layout autenticato presentazionale (header/nav/main),
// skip-link, brand da getBrandName(), voce attiva via usePathname().
describe('T-022 AppShell / layout autenticato', () => {
  it('espone esattamente un landmark banner, navigation e main', () => {
    render(
      h(AppShell, {
        navItems: [{ href: '/dashboard', label: 'Dashboard' }],
        children: 'x',
      }),
    );
    expect(screen.getAllByRole('banner').length).toBe(1); // covers: AC-022-1
    expect(screen.getAllByRole('navigation').length).toBe(1); // covers: AC-022-1
    expect(screen.getAllByRole('main').length).toBe(1); // covers: AC-022-1
  });

  it('mostra nel banner il brand di default quando NEXT_PUBLIC_BRAND_NAME è assente', () => {
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    render(h(AppShell, { navItems: [], children: 'x' }));
    expect(
      within(screen.getByRole('banner')).getByText(getBrandName()),
    ).toBeTruthy(); // covers: AC-022-2
  });

  it('marca con aria-current="page" solo la voce del pathname corrente', () => {
    render(
      h(AppShell, {
        navItems: [
          { href: '/dashboard', label: 'Dashboard' },
          { href: '/sites', label: 'Siti' },
        ],
        children: 'x',
      }),
    );
    const siti = screen.getByRole('link', { name: 'Siti' });
    const dash = screen.getByRole('link', { name: 'Dashboard' });
    expect(siti.getAttribute('aria-current')).toBe('page'); // covers: AC-022-3
    expect(dash.getAttribute('aria-current')).toBe(null); // covers: AC-022-3
  });

  it('espone uno skip-link al main-content come ancora di accessibilità', () => {
    render(h(AppShell, { navItems: [], children: 'x' }));
    const skip = screen.getByRole('link', { name: 'Vai al contenuto' });
    expect(skip.getAttribute('href')).toBe('#main-content'); // covers: AC-022-4
    expect(screen.getByRole('main').id).toBe('main-content'); // covers: AC-022-4
  });

  it('rende i children di pagina dentro il main', () => {
    render(h(AppShell, { navItems: [], children: 'Contenuto pagina' }));
    expect(
      within(screen.getByRole('main')).getByText('Contenuto pagina'),
    ).toBeTruthy(); // covers: AC-022-5
  });
});
