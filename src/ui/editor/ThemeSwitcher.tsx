'use client';

// T-308 (macrotask editor-core, P3) — LO SWITCH TEMA del chrome editor: scegliere fra i 5 temi
// VERSIONATI del catalogo (src/domain/generation/themes.ts) aggiorna `theme_id` nel draft e
// SCAMBIA le CSS custom property `--site-*` ALLA RADICE dell'anteprima. I blocchi non cambiano
// codice: leggono solo `var(--site-...)`, quindi restilizzarli e' cambiare le var alla radice —
// istantaneo, nessuna ri-implementazione del render (P2-D8, design §4).
//
// UNA SOLA SORGENTE DEI VALORI, MAI INPUT LIBERO (security_note T-308): le scelte sono i 5 di
// `THEMES` e i valori proiettati vengono da `siteThemeStyle` (src/ui/site/theme-style.ts), la
// PROIEZIONE UNICA gia' usata dal renderer. Questo componente non conosce un solo colore letterale
// (per questo passa lo scan anti-XSS di T-306, che vieta hex/rgb/hsl in src/ui/editor): i colori
// vivono nel catalogo di dominio, qui si spostano solo dei riferimenti. Non c'e' alcun campo di
// testo da cui digitare un tema: si sceglie, non si scrive.
//
// CONSUMA IL DRAFT DI T-307 SENZA POSSEDERLO: la shell attorno a `useEditorDraft` passa
// `themeId = draft.document.theme_id` e riceve `onThemeChange` per aggiornare quel campo del draft.
// Questo e' un COMPONENTE CONTROLLATO — `themeId` e' l'unica verita', l'effetto proietta SEMPRE il
// tema corrente alla radice (anche il fallback), cosi' un id stantio non lascia mai var indefinite.
// La persistenza a revisione dei save-point e' altrove (T-309): qui non si scrive nulla.

import { useEffect, type RefObject } from 'react';
import { THEMES, type SiteTheme } from '@/domain/generation/themes';
import { siteThemeStyle } from '@/ui/site/theme-style';

// IL FALLBACK ESPLICITO: il primo tema del catalogo. E' un tema REALE e completo, quindi la sua
// proiezione ha ogni `--site-*` definita — mai un collasso silenzioso delle var (AC-308-3). Il
// catalogo non e' mai vuoto (T-211 dichiara i 5 a mano), quindi `THEMES[0]` esiste per costruzione.
const FALLBACK_THEME: SiteTheme = THEMES[0];

/** L'esito della risoluzione di un `theme_id` per il render: se e' del catalogo, e con quale tema. */
type ThemeResolution = {
  /** true se `themeId` e' ESATTAMENTE un id del catalogo (versione compresa); false se e' un fallback. */
  readonly ok: boolean;
  /** Il tema da usare per il render: quello richiesto, oppure il fallback esplicito. Mai `undefined`. */
  readonly theme: SiteTheme;
};

/**
 * RISOLVE un `theme_id` al suo tema per il render, con FALLBACK ESPLICITO (AC-308-3).
 *
 * Lookup per UGUAGLIANZA ESATTA sull'array `THEMES` (mai per prefisso, mai su un oggetto indicizzato):
 * la stessa disciplina di `themeFor` (T-232) e della rotta anteprima (T-235). Un id come
 * 'sole-mediterraneo@2' — stesso nome, versione che il catalogo non ha — NON coerisce in silenzio a
 * '@1': ritorna `ok:false` col tema di fallback, cosi' chi risolve per il render riceve un tema
 * completo (var tutte definite) e un flag esplicito su cui puo' avvisare, invece di var indefinite.
 */
export function resolveSiteTheme(themeId: string): ThemeResolution {
  const theme = THEMES.find((candidate) => candidate.id === themeId);
  return theme === undefined ? { ok: false, theme: FALLBACK_THEME } : { ok: true, theme };
}

// La CHIAVE SENTINELLA con cui si riconosce un elemento che il renderer UNICO ha gia' stilato: se
// porta questa `--site-*` inline, e' uno degli elementi su cui `siteThemeStyle` proietta il tema
// (`.site-view` e OGNI `.site-page`, vedi SiteView.tsx). Non e' un colore letterale — e' il NOME di
// una custom property — quindi non fa scattare lo scan anti-XSS di T-306. E' scelta fra le chiavi
// che `siteThemeStyle` emette SEMPRE (i colori del tema sono obbligatori nel catalogo, T-211).
const SITE_VAR_SENTINEL = '--site-color-accent';

/**
 * Deposita le `--site-*` del tema su un elemento, IMPERATIVAMENTE: le stesse proprieta' che
 * `siteThemeStyle` da' al renderer, una a una con `setProperty`.
 */
function projectVars(element: HTMLElement, style: Record<string, string>): void {
  for (const [property, value] of Object.entries(style)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Applica le `--site-*` del tema alla radice dell'anteprima E a ogni discendente che il renderer
 * UNICO ha gia' stilato inline. E' cosi' che lo switch e' ISTANTANEO senza ri-eseguire il renderer:
 * i blocchi leggono `var(--site-...)` dall'ANTENATO STILATO PIU' VICINO, e in SiteView quell'antenato
 * NON e' la radice ma la `.site-page` che RIDICHIARA le var inline (misurato dal verifier, T-308/D2).
 * Depositare le var solo sulla radice le lascerebbe SCHERMATE da quelle inline di `.site-page`, e i
 * blocchi non si restilizzerebbero — lo switch toccherebbe un antenato che i blocchi non leggono.
 * Riproiettando su OGNI elemento gia' stilato (`.site-view` e ogni `.site-page`, riconosciuti dalla
 * sentinella `--site-*` inline) il tema nuovo raggiunge davvero i blocchi. Restano tutte `--site-*`
 * (lo garantisce `siteThemeStyle`): nessun valore letterale entra qui.
 */
function applyThemeToRoot(root: HTMLElement, theme: SiteTheme): void {
  const style = siteThemeStyle(theme) as Record<string, string>;
  projectVars(root, style);
  // I discendenti che il renderer ha proiettato inline: quelli che gia' portano una `--site-*`.
  // (`querySelectorAll('*')` NON include `root`, che e' comunque gia' stato aggiornato sopra.)
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (element.style.getPropertyValue(SITE_VAR_SENTINEL) !== '') {
      projectVars(element, style);
    }
  }
}

type ThemeSwitcherProps = {
  /** Il `theme_id` corrente del draft (la shell passa `draft.document.theme_id`). Unica verita'. */
  readonly themeId: string;
  /** Aggiorna `theme_id` nel draft. La shell la lega al draft di T-307; qui non si persiste nulla. */
  readonly onThemeChange: (themeId: string) => void;
  /** La radice dell'anteprima su cui scambiare le `--site-*` (il contenitore di SiteView). */
  readonly rootRef: RefObject<HTMLElement | null>;
};

/**
 * IL SELETTORE DI TEMA (chrome editor, client). Offre esattamente i 5 temi del catalogo; scegliere
 * uno chiama `onThemeChange` (aggiorna il draft) e — poiche' `themeId` torna come prop — l'effetto
 * proietta il nuovo tema alla radice. `aria-pressed` marca il tema corrente; quando `themeId` non e'
 * del catalogo nessuna opzione risulta premuta, segnale esplicito che il draft non e' su uno dei 5.
 */
export function ThemeSwitcher({ themeId, onThemeChange, rootRef }: ThemeSwitcherProps) {
  // Proietta SEMPRE il tema corrente (o il suo fallback esplicito) alla radice: al mount e a ogni
  // cambio di `themeId`. Cosi' la radice non ha mai `--site-*` indefinite, nemmeno con un id stantio.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    applyThemeToRoot(root, resolveSiteTheme(themeId).theme);
  }, [themeId, rootRef]);

  return (
    <div className="editor-theme-switcher" role="group" aria-label="Tema del sito">
      {THEMES.map((theme) => (
        <button
          key={theme.id}
          type="button"
          className="editor-theme-option"
          data-theme-option={theme.id}
          aria-pressed={theme.id === themeId}
          onClick={() => onThemeChange(theme.id)}
        >
          {theme.id}
        </button>
      ))}
    </div>
  );
}
