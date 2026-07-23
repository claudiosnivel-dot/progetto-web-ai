import { describe, it, expect } from 'vitest';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';
import { flattenKeys } from '@/i18n/keys';

// Differenza simmetrica tra due Set: elementi presenti in uno solo dei due.
function symmetricDifference<T>(a: Set<T>, b: Set<T>): Set<T> {
  const diff = new Set<T>();
  for (const x of a) if (!b.has(x)) diff.add(x);
  for (const x of b) if (!a.has(x)) diff.add(x);
  return diff;
}

// Assert deterministico di uguaglianza fra due Set di chiavi: lancia se le
// cardinalità differiscono o se una chiave di `a` manca in `b`.
function assertEqualSets(a: Set<string>, b: Set<string>): void {
  if (a.size !== b.size) {
    throw new Error(`Set di dimensioni diverse: ${a.size} vs ${b.size}`);
  }
  for (const x of a) {
    if (!b.has(x)) throw new Error(`Chiave mancante: ${x}`);
  }
}

// Visita ricorsiva: verifica che ogni foglia sia una stringa non vuota.
function assertLeavesNonEmpty(obj: Record<string, unknown>): void {
  for (const value of Object.values(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      assertLeavesNonEmpty(value as Record<string, unknown>);
    } else {
      expect(typeof value).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  }
}

describe('T-081 parità chiavi cataloghi i18n', () => {
  it('le chiavi appiattite di it ed es coincidono (differenza simmetrica vuota)', () => {
    const ki = flattenKeys(itMessages);
    const ke = flattenKeys(esMessages);
    expect(symmetricDifference(ki, ke).size).toBe(0); // covers: AC-081-1
    expect([...ki].sort()).toEqual([...ke].sort()); // covers: AC-081-1
  });

  it('identifica una chiave presente solo in it come mancante in es e fa fallire l’uguaglianza', () => {
    const clone = structuredClone(itMessages) as Record<string, unknown>;
    (clone.common as Record<string, unknown>).__test_only = 'solo it';
    const kClone = flattenKeys(clone);
    const ke = flattenKeys(esMessages);
    expect(symmetricDifference(kClone, ke).has('common.__test_only')).toBe(true); // covers: AC-081-2
    expect(() => assertEqualSets(kClone, ke)).toThrow(); // covers: AC-081-2
  });

  it('ogni foglia di it ed es è una stringa non vuota', () => {
    assertLeavesNonEmpty(itMessages); // covers: AC-081-5
    assertLeavesNonEmpty(esMessages); // covers: AC-081-5
  });
});
