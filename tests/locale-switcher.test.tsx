// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// useLocale → 'it' (locale attivo); usePathname → '/dashboard'; setLocale
// spiato (il render non deve invocare la navigazione reale).
vi.mock('next-intl', () => ({
  useLocale: () => 'it',
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard',
}));
vi.mock('@/domain/setLocale', () => ({
  setLocale: vi.fn(),
}));

// Import DOPO i mock (vi.mock è hoisted).
import { LocaleSwitcher } from '@/ui/LocaleSwitcher';

afterEach(() => {
  cleanup();
});

describe('T-082 LocaleSwitcher (componente client)', () => {
  it('mostra le opzioni it/es e marca la lingua attiva con aria-current', () => {
    render(<LocaleSwitcher />);

    const it = screen.getByRole('button', { name: 'it' });
    const es = screen.getByRole('button', { name: 'es' });

    expect(it).toBeTruthy(); // covers: AC-082-5
    expect(es).toBeTruthy(); // covers: AC-082-5
    expect(it.getAttribute('aria-current')).toBe('true'); // covers: AC-082-5
    expect(es.getAttribute('aria-current')).toBe(null); // covers: AC-082-5
  });
});
