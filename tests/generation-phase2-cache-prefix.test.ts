import { describe, it, expect } from 'vitest';
import { applyBriefUpdate, emptyBrief, type Brief } from '@/domain/onboarding/brief';
import type { PageRole } from '@/domain/generation/slots';
import type { PageSpec } from '@/domain/generation/pages';
import { buildPhase2ChunkPayload } from '@/domain/generation/phase2';

// T-234 (macrotask generation-ui, P2) — AC-234-2: la PARTE STABILE (tool + system prompt) del
// payload di fase 2 e' IDENTICA byte per byte fra i chunk della stessa fase, e differisce solo
// la parte VOLATILE con le pagine del chunk. E' la condizione perche' il prompt caching colpisca
// FRA i chunk: l'API rende tools -> system -> messages e confronta per PREFISSO, quindi un solo
// byte diverso nel tool o nel system a ogni chunk annullerebbe la cache scritta dal chunk prima.
//
// PURO come tests/generation-prompt.test.ts (AC-223-2): nessun DB e NESSUNA chiamata al modello —
// `buildPhase2ChunkPayload` assembla soltanto l'oggetto. Importa src/domain/generation/phase2,
// che a sua volta importa il confine server-only: nei test "server-only" e' risolto al suo
// empty.js (vitest.config), e il client reale nasce lazy solo alla chiamata — che qui non avviene.

/** Il PREFISSO STABILE, nell'ordine in cui l'API rende il prompt: tool, poi system. */
function prefissoStabile(payload: ReturnType<typeof buildPhase2ChunkPayload>): string {
  return `${JSON.stringify(payload.tools)}\n${payload.system}`;
}

/** La PARTE VOLATILE: i messaggi, cioe' l'unico posto in cui puo' entrare la variazione del chunk. */
function parteVolatile(payload: ReturnType<typeof buildPhase2ChunkPayload>): string {
  return JSON.stringify(payload.messages);
}

/**
 * Un brief RICCO, dominio REALE: il tool della fase 2 enumera gli slot dei blocchi delle pagine
 * interne (T-210/T-220), quindi il brief deve giustificare quei blocchi. Valori DISCORDANTI, con
 * il business_name che NON deve comparire nel prefisso (anti-fuga di T-220/T-223).
 */
function briefRicco(locale: Brief['locale']): Brief {
  const { brief, rejected } = applyBriefUpdate(emptyBrief(locale), {
    business_name: 'Trattoria Aurora',
    vertical: 'ristorazione',
    description: 'Cucina di mercato nel centro storico, aperta dal 1980.',
    highlights: ['Forno a legna', 'Terrazza sul fiume'],
    address: 'Via Verdi 12, Roma',
    phone: '+39 06 5551234',
    whatsapp: '+39 333 4445566',
    hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
    offerings: [
      { name: 'Antipasto', section: 'Cucina' },
      { name: 'Antipasto della casa', section: 'Cucina' },
      { name: 'Primo', section: 'Cucina' },
      { name: 'Dolce', section: 'Dessert' },
    ],
  });
  expect(rejected, 'la fixture non e un brief valido').toEqual([]);
  return brief;
}

/**
 * L'INTERO set di pagine interne della fase 2, fabbricato: PIU' di `pages_per_chunk`, cosi' un
 * chunk NON coincide con l'intero set. I ruoli sono INTERNI e reali (hanno blocchi per il brief
 * ricco), gli slug sono DISCORDANTI e uno e' PREFISSO di un altro ('in-1' / 'in-10'), cosi' un
 * confronto lasco su slug si vedrebbe sbagliare.
 */
function specInterna(role: PageRole, slug: string): PageSpec {
  return { role, slug, label_key: 'site.nav.offerings', shape: 'multi-page', absorbed_roles: [] };
}

function setInterno(): readonly PageSpec[] {
  return [
    specInterna('offerings', 'in-1'),
    specInterna('contact', 'in-2'),
    specInterna('hours', 'in-3'),
    specInterna('faq', 'in-4'),
    specInterna('offerings', 'in-5'),
    specInterna('contact', 'in-10'),
    specInterna('hours', 'in-7'),
  ];
}

describe('T-234 il prefisso stabile della fase 2 e cacheabile (AC-234-2)', () => {
  it('due chunk della STESSA fase: tool + system identici byte per byte, solo la volatile con le pagine del chunk cambia', () => {
    const brief = briefRicco('it');
    const innerPages = setInterno();
    // Due chunk DISGIUNTI dallo stesso set (come li produrrebbe lo spezzettamento a
    // pages_per_chunk): il tool e' costruito sull'INTERO set, quindi non dipende da quale chunk.
    const chunkUno = innerPages.slice(0, 4);
    const chunkDue = innerPages.slice(4);

    // Anti-vacuita': i due chunk sono davvero diversi, altrimenti "la volatile differisce" e
    // "il prefisso e identico" non direbbero nulla.
    expect(chunkUno.map((p) => p.slug)).not.toEqual(chunkDue.map((p) => p.slug)); // covers: AC-234-2

    const payloadUno = buildPhase2ChunkPayload(brief, innerPages, chunkUno);
    const payloadDue = buildPhase2ChunkPayload(brief, innerPages, chunkDue);

    // LA PARTE STABILE e' IDENTICA byte per byte: e' la condizione del colpo di cache fra chunk.
    expect(payloadUno.system).toBe(payloadDue.system); // covers: AC-234-2
    expect(JSON.stringify(payloadUno.tools)).toBe(JSON.stringify(payloadDue.tools)); // covers: AC-234-2
    expect(prefissoStabile(payloadUno)).toBe(prefissoStabile(payloadDue)); // covers: AC-234-2

    // …e differisce SOLO la parte volatile, che porta le pagine del chunk.
    expect(parteVolatile(payloadUno)).not.toBe(parteVolatile(payloadDue)); // covers: AC-234-2
    for (const spec of chunkUno) {
      expect(parteVolatile(payloadUno)).toContain(spec.slug); // covers: AC-234-2
    }
    for (const spec of chunkDue) {
      expect(parteVolatile(payloadDue)).toContain(spec.slug); // covers: AC-234-2
    }
    // La pagina 'in-10' (di chunkDue) NON compare nella volatile di chunkUno: la selezione del
    // chunk vive solo li'. 'in-1' e' PREFISSO di 'in-10', quindi questa riga si accorgerebbe di
    // un confronto lasco che facesse passare l'una per l'altra ('in-1, in-2' non contiene 'in-10').
    expect(parteVolatile(payloadUno)).not.toContain('in-10'); // covers: AC-234-2

    // Il prefisso stabile NON porta il brief di questo cliente (anti-fuga): sarebbe identico solo
    // finche' due clienti si somigliano.
    expect(prefissoStabile(payloadUno)).not.toContain(String(brief.business_name)); // covers: AC-234-2
    expect(prefissoStabile(payloadUno)).not.toContain(String(brief.description)); // covers: AC-234-2
  });

  it('lo stesso vale per un altro locale (es): il prefisso e stabile fra i chunk', () => {
    const brief = briefRicco('es');
    const innerPages = setInterno();
    const payloadUno = buildPhase2ChunkPayload(brief, innerPages, innerPages.slice(0, 4));
    const payloadDue = buildPhase2ChunkPayload(brief, innerPages, innerPages.slice(4));

    expect(prefissoStabile(payloadUno)).toBe(prefissoStabile(payloadDue)); // covers: AC-234-2
    // Il system e' quello DI QUESTO locale (non l'italiano): la fase 2 non cambia lingua.
    expect(payloadUno.system).toContain('ESPAÑOL'); // covers: AC-234-2
    expect(payloadUno.system).not.toContain('ITALIANO'); // covers: AC-234-2
  });
});
