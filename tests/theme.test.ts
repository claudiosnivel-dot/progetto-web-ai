// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createElement as h } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ThemeProvider, useTheme } from '@/ui/theme/ThemeProvider';

afterEach(cleanup);

// T-020 — tema chiaro/scuro guidato da data-theme su document.documentElement.
describe('T-020 tema chiaro/scuro', () => {
  it('al montaggio imposta data-theme = "light" (default)', () => {
    render(h(ThemeProvider, null, h('div', null, 'x')));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light'); // covers: AC-020-2
  });

  it('setTheme("dark") porta data-theme a "dark"', () => {
    function Consumer() {
      const { setTheme } = useTheme();
      return h('button', { onClick: () => setTheme('dark') }, 'to-dark');
    }
    const { container } = render(h(ThemeProvider, null, h(Consumer)));
    const button = container.querySelector('button');
    if (button === null) throw new Error('button non trovato');
    fireEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark'); // covers: AC-020-3
  });

  it('globals.css: --color-background differisce tra :root e [data-theme="dark"]', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/);
    const darkBlock = css.match(/\[data-theme=["']dark["']\]\s*\{([^}]*)\}/);
    expect(rootBlock).not.toBeNull();
    expect(darkBlock).not.toBeNull();
    const bgOf = (blk: RegExpMatchArray | null): string | undefined =>
      blk?.[1].match(/--color-background:\s*([^;]+);/)?.[1].trim();
    const rootBg = bgOf(rootBlock);
    const darkBg = bgOf(darkBlock);
    expect(rootBg).toBeTruthy();
    expect(darkBg).toBeTruthy();
    expect(rootBg).not.toBe(darkBg); // covers: AC-020-4
  });
});
