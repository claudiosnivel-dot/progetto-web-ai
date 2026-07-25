import { describe, it, expect } from 'vitest';
import { applyBriefUpdate, isBriefComplete, emptyBrief } from '@/domain/onboarding/brief';

// T-122 (P1) — applyBriefUpdate + isBriefComplete (puri). Le asserzioni derivano
// dagli acceptance_criteria AC-122-1..5 (01-brief-model.md). Nessun DB.

describe('T-122 applyBriefUpdate — fusione deterministica', () => {
  // covers: AC-122-1
  it('applica business_name lasciando invariati TUTTI gli altri campi (core + content)', () => {
    // Base con "altri campi valorizzati" come richiede il given dell'AC (non un brief
    // quasi vuoto): description, phone, vertical e un'offerta preesistente.
    const base = applyBriefUpdate(emptyBrief('it'), {
      vertical: 'ristorazione',
      description: 'Storico bar del centro',
      phone: '+39 06 000',
      offerings: [{ name: 'Caffe', price: '1.20' }],
    }).brief;

    const { brief } = applyBriefUpdate(base, { business_name: 'Bar Sole' });

    expect(brief.business_name).toBe('Bar Sole'); // covers: AC-122-1 — campo applicato
    // TUTTI gli altri campi restano invariati (core + content):
    expect(brief.vertical).toBe('ristorazione'); // covers: AC-122-1
    expect(brief.description).toBe('Storico bar del centro'); // covers: AC-122-1
    expect(brief.phone).toBe('+39 06 000'); // covers: AC-122-1
    expect(brief.locale).toBe('it'); // covers: AC-122-1
    expect(brief.content.offerings).toHaveLength(1); // covers: AC-122-1 — content non azzerato
    expect(brief.content.offerings[0]).toMatchObject({ name: 'Caffe', price: '1.20' }); // covers: AC-122-1
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

  // covers: AC-122-3
  it('scarta una chiave che collide con un membro di Object.prototype, senza lanciare', () => {
    // La patch e' input NON FIDATO e JSON.parse crea queste chiavi come proprieta'
    // PROPRIE, quindi Object.entries le enumera: il lookup per-campo non deve
    // risolvere il prototype di Object (che non contiene schemi zod) ne' lanciare.
    const base = applyBriefUpdate(emptyBrief('it'), { business_name: 'Bar Sole' }).brief;

    for (const chiave of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
      // La patch porta ANCHE un campo valido: la chiave ostile non deve far cadere
      // il resto della patch (lo scarto e' per-campo).
      const patch: unknown = JSON.parse(`{"${chiave}":"x","description":"Storico bar"}`);

      expect(() => applyBriefUpdate(base, patch), chiave).not.toThrow(); // covers: AC-122-3

      const { brief, rejected } = applyBriefUpdate(base, patch);
      expect(rejected, chiave).toContain(chiave); // covers: AC-122-3 — scartata, non applicata
      expect(brief.description, chiave).toBe('Storico bar'); // covers: AC-122-3 — gli altri campi passano
      expect(brief.business_name, chiave).toBe('Bar Sole'); // covers: AC-122-3 — brief non corrotto
    }
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
