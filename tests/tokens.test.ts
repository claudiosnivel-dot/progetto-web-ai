import { describe, it, expect } from 'vitest';
import tailwindConfig from '../tailwind.config';
import { colors, spacing, typography } from '@/ui/theme/tokens';

// T-020 — i design token sono l'unica sorgente di verità: la theme di Tailwind
// deve derivare da essi, senza palette esadecimali duplicate a mano nella config.
describe('T-020 design tokens', () => {
  it('theme.extend.colors della config Tailwind è deep-equal a tokens.colors', () => {
    expect(tailwindConfig.theme.extend.colors).toEqual(colors); // covers: AC-020-1
  });

  it('le scale spacing e typography.fontSize hanno almeno 4 step', () => {
    expect(Object.keys(spacing).length).toBeGreaterThanOrEqual(4); // covers: AC-020-5
    expect(Object.keys(typography.fontSize).length).toBeGreaterThanOrEqual(4); // covers: AC-020-5
  });
});
