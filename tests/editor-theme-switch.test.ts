// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, useState, useRef } from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { THEMES } from '@/domain/generation/themes';
import { siteThemeStyle } from '@/ui/site/theme-style';
import type { SiteDocument } from '@/domain/generation/document';
import { ThemeSwitcher, resolveSiteTheme } from '@/ui/editor/ThemeSwitcher';

// T-308 (macrotask editor-core, P3) — SWITCH TEMA fra i 5 via CSS custom property. Le asserzioni
// derivano dagli acceptance_criteria di 01-editor-core.md (AC-308-1..3), taggate `// covers:` sulla
// riga dell'EXPECT. Test HERMETIC (jsdom): nessuna auth Supabase, nessun DB — si monta il chrome
// editor su un draft in memoria e si guarda cosa cambia nel draft e nelle var alla radice.
//
// CIO' CHE IL TEST PROVA:
//   • il selettore offre ESATTAMENTE i 5 temi del catalogo versionato, nessun valore libero (AC-308-2);
//   • scegliere un tema aggiorna theme_id nel draft E scambia le --site-* alla radice (AC-308-1);
//   • un theme_id la cui VERSIONE non esiste ('sole-mediterraneo@2') non risolve in silenzio '@1':
//     da' un fallback ESPLICITO e le var alla radice restano tutte definite, mai un collasso (AC-308-3).
//
// SICUREZZA (security_note T-308): le scelte e i valori proiettati vengono SOLO dal catalogo THEMES
// e dalla proiezione unica siteThemeStyle (src/ui/site/theme-style.ts). Il test lo rende osservabile:
// le opzioni sono esattamente i 5 id del catalogo e non esiste alcun campo di testo libero da cui
// iniettare un valore di stile.

afterEach(() => cleanup());

// ── fixture di dominio ────────────────────────────────────────────────────────
// Un draft minimo che soddisfa il tipo SiteDocument (non passa dal gate qui): serve solo a portare
// il theme_id corrente e a mostrare che scegliere un tema tocca QUEL campo.
function draftDoc(themeId: string): SiteDocument {
  return {
    recipe_id: 'ricetta-uno@1',
    theme_id: themeId,
    pages: [
      {
        slug: 'home',
        role: 'home',
        title: 'Panificio Aurora',
        meta_description: 'Pane fresco ogni mattina',
        blocks: [
          {
            id: 'hero',
            content: { hero_title: 'Ciao' },
            data: {},
            brief_fields_rendered: [],
            images: [],
          },
        ],
      },
    ],
  };
}

// Le --site-* attese per un tema: la STESSA proiezione unica del renderer (mai una copia).
function expectedVars(themeId: string): Record<string, string> {
  const { theme } = resolveSiteTheme(themeId);
  return siteThemeStyle(theme) as Record<string, string>;
}

// HARNESS che rappresenta il chrome editor: tiene il DRAFT in stato (come farebbe la shell attorno
// all'hook di T-307), passa draft.theme_id a ThemeSwitcher e ne applica onThemeChange al draft. Il
// `site-root` e' l'elemento a cui il renderer unico applica le var: qui ThemeSwitcher le scambia.
function Harness({ startId }: { startId: string }) {
  const [doc, setDoc] = useState<SiteDocument>(() => draftDoc(startId));
  const rootRef = useRef<HTMLDivElement>(null);
  return createElement(
    'div',
    null,
    createElement(ThemeSwitcher, {
      themeId: doc.theme_id,
      onThemeChange: (id: string) => setDoc((current) => ({ ...current, theme_id: id })),
      rootRef,
    }),
    createElement('span', { 'data-testid': 'draft-theme-id' }, doc.theme_id),
    createElement('div', { 'data-testid': 'site-root', ref: rootRef }),
  );
}

function optionIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-theme-option]')].map(
    (el) => el.getAttribute('data-theme-option') ?? '',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AC-308-2 — il selettore elenca ESATTAMENTE i 5 temi del catalogo, nessun valore libero.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-308-2 — le scelte sono esattamente i 5 temi versionati del catalogo', () => {
  it('offre una scelta per ognuno dei 5 temi, con i loro id versionati, e non una di piu', () => {
    const { container } = render(createElement(Harness, { startId: THEMES[0].id }));

    // Anti-vacuita' e ancoraggio: il catalogo ha davvero 5 temi.
    expect(THEMES).toHaveLength(5); // covers: AC-308-2

    // Le opzioni sono, per id e in ordine, ESATTAMENTE i 5 del catalogo: non 4, non 6, e nessun
    // id inventato. Un tema aggiunto/rimosso al catalogo cambierebbe qui, mai in un elenco a mano.
    expect(optionIds(container)).toEqual(THEMES.map((theme) => theme.id)); // covers: AC-308-2
  });

  it('non esiste alcun campo di testo libero: solo scelte predefinite (nessuna iniezione via stile)', () => {
    const { container } = render(createElement(Harness, { startId: THEMES[0].id }));

    // Nessun input/textarea/contenteditable: l'utente non puo' DIGITARE un valore di tema, puo' solo
    // scegliere fra i 5. E' la forma della difesa della security_note T-308 (nessun input libero).
    expect(
      container.querySelectorAll('input, textarea, [contenteditable="true"]'),
    ).toHaveLength(0); // covers: AC-308-2
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-308-1 — scegliere un tema aggiorna theme_id nel draft E le --site-* alla radice.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-308-1 — scegliere un tema aggiorna il draft e le custom property alla radice', () => {
  it('parte dal tema iniziale: draft.theme_id e le var alla radice riflettono il primo tema', () => {
    const start = THEMES[0];
    const { getByTestId } = render(createElement(Harness, { startId: start.id }));

    expect(getByTestId('draft-theme-id').textContent).toBe(start.id); // covers: AC-308-1

    // Alla radice le var sono gia' quelle del tema iniziale (nessuna var vuota all'avvio).
    const root = getByTestId('site-root');
    const expected = expectedVars(start.id);
    for (const [property, value] of Object.entries(expected)) {
      expect(root.style.getPropertyValue(property)).toBe(value); // covers: AC-308-1
    }
  });

  it('scegliendo un altro dei 5 temi: theme_id nel draft cambia e le --site-* alla radice si scambiano', () => {
    const start = THEMES[0];
    const chosen = THEMES[2]; // valori DISCORDANTI dal primo (scatto-vitale, l'unico scuro)
    const { container, getByTestId } = render(createElement(Harness, { startId: start.id }));

    const root = getByTestId('site-root');

    // Precondizione: NON siamo gia' sul tema che sceglieremo (altrimenti l'asserzione sarebbe vacua).
    expect(getByTestId('draft-theme-id').textContent).not.toBe(chosen.id);

    // Si sceglie il tema dalla sola scelta predefinita (un click sull'opzione del catalogo).
    fireEvent.click(container.querySelector(`[data-theme-option="${chosen.id}"]`) as HTMLElement);

    // (a) theme_id NEL DRAFT e' aggiornato al tema scelto.
    expect(getByTestId('draft-theme-id').textContent).toBe(chosen.id); // covers: AC-308-1

    // (b) le custom property ALLA RADICE riflettono il tema scelto — l'INTERA tabella proiettata,
    // non solo un colore. I blocchi (che leggono var(--site-...)) si restilizzano senza cambiare codice.
    const expected = expectedVars(chosen.id);
    for (const [property, value] of Object.entries(expected)) {
      expect(root.style.getPropertyValue(property)).toBe(value); // covers: AC-308-1
    }

    // Prova che lo scambio e' reale: almeno un valore differisce fra i due temi ed e' cambiato.
    const before = siteThemeStyle(start) as Record<string, string>;
    const accentKey = '--site-color-accent';
    expect(before[accentKey]).not.toBe(expected[accentKey]);
    expect(root.style.getPropertyValue(accentKey)).toBe(expected[accentKey]); // covers: AC-308-1
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-308-3 — un theme_id la cui versione non esiste: fallback ESPLICITO, mai var indefinite.
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-308-3 — theme_id versionato inesistente: errore/fallback esplicito, non collasso silenzioso', () => {
  it('resolveSiteTheme distingue esattamente sulla VERSIONE: un id esistente risolve, uno no', () => {
    const real = THEMES[0];

    // Un id del catalogo risolve al SUO tema (uguaglianza esatta, versione compresa).
    const good = resolveSiteTheme(real.id);
    expect(good.ok).toBe(true); // covers: AC-308-3
    expect(good.theme).toBe(real); // covers: AC-308-3

    // Stesso nome, VERSIONE inesistente ('@2' non e' nel catalogo): il flag e' ESPLICITO (ok:false),
    // non un'accettazione silenziosa. Il tema di fallback e' comunque un tema reale del catalogo (mai
    // `undefined`, mai var indefinite) e non porta MAI l'id stantio richiesto: '@2' non diventa un
    // tema fantasma. Che il fallback coincida con '@1' e' una scelta (il primo del catalogo), non una
    // coercizione della versione — a distinguerle e' proprio `ok:false`.
    const stale = resolveSiteTheme('sole-mediterraneo@2');
    expect(stale.ok).toBe(false); // covers: AC-308-3
    expect(THEMES).toContain(stale.theme); // covers: AC-308-3 (fallback = tema reale, mai undefined)
    expect(stale.theme.id).not.toBe('sole-mediterraneo@2'); // covers: AC-308-3 (nessun tema fantasma)
  });

  it('con un theme_id inesistente le --site-* alla radice restano TUTTE definite (nessuna vuota)', () => {
    const { getByTestId } = render(createElement(Harness, { startId: 'sole-mediterraneo@2' }));
    const root = getByTestId('site-root');

    // Le var alla radice sono quelle del fallback esplicito di resolveSiteTheme: identiche, e nessuna
    // vuota. Un collasso silenzioso lascerebbe queste proprieta' assenti (getPropertyValue -> '').
    const expected = expectedVars('sole-mediterraneo@2');
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    for (const [property, value] of Object.entries(expected)) {
      const applied = root.style.getPropertyValue(property);
      expect(applied).not.toBe(''); // covers: AC-308-3 (mai una var indefinita alla radice)
      expect(applied).toBe(value); // covers: AC-308-3
    }
  });
});
