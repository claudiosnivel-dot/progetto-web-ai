import { describe, it, expect } from 'vitest';
import { applyBriefUpdate, isBriefComplete, emptyBrief } from '@/domain/onboarding/brief';

// T-122 (P1) — applyBriefUpdate + isBriefComplete (puri). Le asserzioni derivano
// dagli acceptance_criteria AC-122-1..5 (01-brief-model.md). Nessun DB.

describe('T-122 applyBriefUpdate — fusione deterministica', () => {
  // covers: AC-122-1
  it('applica business_name lasciando invariati gli altri campi', () => {
    const base = emptyBrief('it'); // vertical 'altro', nessun business_name
    const { brief } = applyBriefUpdate(base, { business_name: 'Bar Sole' });
    expect(brief.business_name).toBe('Bar Sole'); // covers: AC-122-1
    expect(brief.vertical).toBe('altro'); // covers: AC-122-1 — invariato
    expect(brief.locale).toBe('it'); // covers: AC-122-1 — invariato
  });

  // covers: AC-122-2
  it('fonde le offerings per name: aggiorna la voce esistente e appende quella nuova', () => {
    const base = applyBriefUpdate(emptyBrief('it'), { offerings: [{ name: 'Caffe' }] }).brief;
    const { brief } = applyBriefUpdate(base, {
      offerings: [{ name: 'Caffe', price: '1.20' }, { name: 'Cornetto' }],
    });
    const offs = brief.content.offerings;
    expect(offs).toHaveLength(2); // covers: AC-122-2 — nessun duplicato
    const caffe = offs.find((o) => o.name === 'Caffe');
    const cornetto = offs.find((o) => o.name === 'Cornetto');
    expect(caffe?.price).toBe('1.20'); // covers: AC-122-2 — voce aggiornata
    expect(cornetto).toBeTruthy(); // covers: AC-122-2 — voce appesa
  });

  // covers: AC-122-3
  it('scarta un campo invalido (vertical fuori allowlist) senza corrompere il brief ne lanciare', () => {
    const base = applyBriefUpdate(emptyBrief('it'), { vertical: 'ristorazione' }).brief;
    const { brief, rejected } = applyBriefUpdate(base, { vertical: 'casino' });
    expect(brief.vertical).toBe('ristorazione'); // covers: AC-122-3 — invariato
    expect(rejected).toContain('vertical'); // covers: AC-122-3 — segnalato, non applicato
  });

  // covers: AC-122-4
  it('isBriefComplete = false quando manca primary_goal', () => {
    const base = applyBriefUpdate(emptyBrief('it'), { business_name: 'Bar Sole' }).brief;
    expect(isBriefComplete(base)).toBe(false); // covers: AC-122-4
  });

  // covers: AC-122-5
  it('isBriefComplete = true con business_name, vertical, primary_goal e locale valorizzati', () => {
    const base = applyBriefUpdate(emptyBrief('it'), {
      business_name: 'Bar Sole',
      primary_goal: 'contatta',
    }).brief;
    expect(isBriefComplete(base)).toBe(true); // covers: AC-122-5
  });
});
