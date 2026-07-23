import { describe, it, expect } from 'vitest';

describe('T-003 smoke', () => {
  it('vitest gira e il test di smoke passa', () => {
    expect(1 + 1).toBe(2); // covers: AC-003-1
  });
});
