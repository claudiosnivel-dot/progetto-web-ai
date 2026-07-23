import { describe, it, expect } from 'vitest';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-081 — i valori concreti dei cataloghi: la chiave comune 'common.save' deve
// avere la traduzione attesa in ciascuna lingua ed essere effettivamente diversa
// tra IT ed ES (nessuna stringa non tradotta).
describe('T-081 valori dei cataloghi i18n', () => {
  it('risolve common.save = "Salva" nel catalogo it', () => {
    expect(itMessages.common.save).toBe('Salva'); // covers: AC-081-3
  });

  it('risolve common.save = "Guardar" nel catalogo es, diverso dall’IT', () => {
    expect(esMessages.common.save).toBe('Guardar'); // covers: AC-081-4
    expect(esMessages.common.save).not.toBe(itMessages.common.save); // covers: AC-081-4
  });
});
