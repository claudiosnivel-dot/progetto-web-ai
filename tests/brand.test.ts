import { describe, it, expect, afterEach } from 'vitest';
import { getBrandName } from '@/config/brand';

const original = process.env.NEXT_PUBLIC_BRAND_NAME;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_BRAND_NAME;
  else process.env.NEXT_PUBLIC_BRAND_NAME = original;
});

describe('T-006 modulo brand', () => {
  it('ritorna Belora quando NEXT_PUBLIC_BRAND_NAME non è impostata', () => {
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    expect(getBrandName()).toBe('Belora'); // covers: AC-006-1
  });

  it('ritorna il valore configurato', () => {
    process.env.NEXT_PUBLIC_BRAND_NAME = 'Acme Sites';
    expect(getBrandName()).toBe('Acme Sites'); // covers: AC-006-2
  });
});
