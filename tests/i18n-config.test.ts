import { describe, it, expect } from 'vitest';
import { routing } from '@/i18n/routing';

// T-080 — la configurazione di routing next-intl deve dichiarare le lingue
// supportate e il locale di default esattamente come da blueprint.
describe('T-080 configurazione routing i18n', () => {
  it('routing.locales e routing.defaultLocale come da blueprint', () => {
    expect(routing.locales).toEqual(['it', 'es']); // covers: AC-080-5
    expect(routing.defaultLocale).toBe('it'); // covers: AC-080-5
  });
});
