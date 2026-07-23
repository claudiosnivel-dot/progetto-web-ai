import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createElement as h } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@/ui/theme/ThemeProvider';

// Sentinella lanciata dalla spia notFound: consente di verificare che la
// guardia del layout abbia interrotto il rendering per un locale non supportato.
const { NOT_FOUND, notFoundSpy } = vi.hoisted(() => {
  const sentinel = Symbol('not-found');
  return {
    NOT_FOUND: sentinel,
    notFoundSpy: vi.fn(() => {
      throw sentinel;
    }),
  };
});

// Il layout usa notFound() da next/navigation e setRequestLocale/getMessages da
// next-intl/server: entrambi mockati perché il test ispeziona funzioni e alberi
// di elementi, non l'ambiente runtime di Next.
vi.mock('next/navigation', () => ({
  notFound: notFoundSpy,
}));

vi.mock('next-intl/server', () => ({
  getMessages: async () => ({}),
  setRequestLocale: () => {},
}));

// Import DOPO i mock (vi.mock è hoisted): il middleware non tocca i moduli
// mockati; il layout sì. Il path con parentesi quadre letterali deve risolvere.
import middleware, { config } from '@/middleware';
import LocaleLayout from '@/app/[locale]/layout';

const run = (p: string) =>
  middleware(new NextRequest(new URL(p, 'http://localhost')));

// Raccoglie ricorsivamente i .type di ogni elemento React nell'albero,
// scendendo solo lungo props.children.
function collectTypes(node: unknown, acc: Set<unknown>): void {
  if (node === null || node === undefined || typeof node !== 'object') return;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if ('type' in el) acc.add(el.type);
  const children = el.props?.children;
  if (Array.isArray(children)) {
    for (const child of children) collectTypes(child, acc);
  } else {
    collectTypes(children, acc);
  }
}

describe('T-080 routing e middleware next-intl', () => {
  beforeEach(() => {
    notFoundSpy.mockClear();
  });

  it('lascia passare /it senza redirect', () => {
    const res = run('/it');
    expect(res.headers.get('location')).toBeNull(); // covers: AC-080-1
    expect(res.status).toBe(200); // covers: AC-080-1
  });

  it('lascia passare /es senza redirect', () => {
    const res = run('/es');
    expect(res.headers.get('location')).toBeNull(); // covers: AC-080-2
    expect(res.status).toBe(200); // covers: AC-080-2
  });

  it('reindirizza / (senza prefisso) al locale di default /it', () => {
    const res = run('/');
    expect(res.status).toBe(307); // covers: AC-080-3
    expect(res.headers.get('location')).toMatch(/\/it$/); // covers: AC-080-3
  });

  it('la guardia del layout invoca notFound per un locale non supportato', async () => {
    await expect(
      LocaleLayout({
        params: Promise.resolve({ locale: 'fr' }),
        children: h('div'),
      }),
    ).rejects.toBe(NOT_FOUND);
    expect(notFoundSpy).toHaveBeenCalled(); // covers: AC-080-4
  });

  it('il matcher esclude /api e copre /it', () => {
    for (const pattern of config.matcher) {
      const re = new RegExp(`^${pattern}$`);
      expect(re.test('/api/health')).toBe(false); // covers: AC-080-6
    }
    const principal = new RegExp(`^${config.matcher[0]}$`);
    expect(principal.test('/it')).toBe(true); // covers: AC-080-6
  });

  it('il layout avvolge i children in NextIntlClientProvider e ThemeProvider', async () => {
    const el = await LocaleLayout({
      params: Promise.resolve({ locale: 'it' }),
      children: h('div', { id: 'child' }),
    });
    const types = new Set<unknown>();
    collectTypes(el, types);
    expect(types.has(NextIntlClientProvider)).toBe(true); // covers: AC-080-7
    expect(types.has(ThemeProvider)).toBe(true); // covers: AC-080-7
  });
});
