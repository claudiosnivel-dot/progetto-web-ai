import { describe, it, expect } from 'vitest';
import { BriefSchema } from '@/domain/onboarding/brief';

// T-121 (P1) — schema di dominio del Business Brief (zod). Le asserzioni derivano
// dagli acceptance_criteria AC-121-1..5 (01-brief-model.md). Funzione pura: nessun DB.

describe('T-121 BriefSchema — validazione', () => {
  const validBrief = {
    business_name: 'Bar Sole',
    vertical: 'ristorazione',
    primary_goal: 'contatta',
    locale: 'it',
    content: { offerings: [{ name: 'Caffe' }], social_links: [], highlights: [] },
  };

  // covers: AC-121-1
  it('accetta un brief valido e restituisce il brief tipizzato', () => {
    const res = BriefSchema.safeParse(validBrief);
    expect(res.success).toBe(true); // covers: AC-121-1
    if (!res.success) throw new Error('BriefSchema avrebbe dovuto validare');
    expect(res.data.business_name).toBe('Bar Sole'); // covers: AC-121-1
    expect(res.data.vertical).toBe('ristorazione'); // covers: AC-121-1
    expect(res.data.content.offerings[0].name).toBe('Caffe'); // covers: AC-121-1
  });

  // covers: AC-121-2
  it("rifiuta un vertical fuori allowlist ('casino'), indicando il campo vertical", () => {
    const res = BriefSchema.safeParse({ ...validBrief, vertical: 'casino' });
    expect(res.success).toBe(false); // covers: AC-121-2
    if (res.success) throw new Error('vertical fuori allowlist non doveva validare');
    expect(res.error.issues.some((i) => i.path.includes('vertical'))).toBe(true); // covers: AC-121-2
  });

  // covers: AC-121-3
  it("rifiuta un primary_goal fuori allowlist ('spam'), indicando il campo primary_goal", () => {
    const res = BriefSchema.safeParse({ ...validBrief, primary_goal: 'spam' });
    expect(res.success).toBe(false); // covers: AC-121-3
    if (res.success) throw new Error('primary_goal fuori allowlist non doveva validare');
    expect(res.error.issues.some((i) => i.path.includes('primary_goal'))).toBe(true); // covers: AC-121-3
  });

  // covers: AC-121-4
  it("rifiuta un'offerta priva di name (name vuoto), indicando la voce offerings", () => {
    const res = BriefSchema.safeParse({
      ...validBrief,
      content: { offerings: [{ name: '   ' }], social_links: [], highlights: [] },
    });
    expect(res.success).toBe(false); // covers: AC-121-4
    if (res.success) throw new Error("un'offerta senza name non doveva validare");
    expect(res.error.issues.some((i) => i.path.includes('offerings'))).toBe(true); // covers: AC-121-4
  });

  // covers: AC-121-5
  it('rifiuta una chiave sconosciuta al top-level (strict) — is_admin non finisce nel brief', () => {
    const res = BriefSchema.safeParse({ ...validBrief, is_admin: true });
    expect(res.success).toBe(false); // covers: AC-121-5
    if (res.success) throw new Error('una chiave sconosciuta non doveva passare in strict');
    // La chiave sconosciuta e la ragione del rifiuto (unrecognized_keys).
    const hasUnrecognized = res.error.issues.some(
      (i) => i.code === 'unrecognized_keys' || JSON.stringify(i).includes('is_admin'),
    );
    expect(hasUnrecognized).toBe(true); // covers: AC-121-5
  });
});
