import { describe, it, expect } from 'vitest';
import { THEMES, type SiteTheme } from '@/domain/generation/themes';
import { DOCUMENT_LIMITS, SiteDocumentSchema, parseDocument } from '@/domain/generation/document';
// NB: questo file NON importa piu' src/ui/theme/tokens. La derivazione da li' e' stata
// tolta perche' misurata inerte (vedi il describe sui valori propri di P2), e con lei se
// n'e' andato l'accoppiamento di P2 alla rappresentazione interna del design system del
// builder. Il confine fra i due layer resta imposto da eslint.config.mjs e provato da
// tests/generation-theme-isolation.test.ts, che e' la sua sede.

// T-211 (macrotask generation-engine, P2) — i cinque temi del SITO GENERATO. Le
// asserzioni DERIVANO dagli acceptance_criteria AC-211-1, AC-211-2, AC-211-3 e AC-211-5
// (docs/blueprint/P2-generation/02-generation-engine.md); gli oracoli in fondo sono
// dichiarati come AGGIUNTIVI e nominano cio' che provano.
//
// CIO' CHE QUESTO FILE NON PROVA, scritto invece che sottinteso (L-COL-006): NON prova
// che i temi siano BELLI, ne che una palette sia leggibile o accessibile, ne che una
// scala tipografica sia armoniosa, ne che il carattere dichiarato nel commento di ogni
// tema ("caldo", "essenziale", ...) sia davvero quello che un occhio umano ci legge. Lo
// stile non e' oracolabile (P1 §6-bis p.8) e i commenti del modulo NON sono asserzioni.
// Qui si giudica soltanto che il layer dei temi sia CABLATO (cinque temi, le stesse
// chiavi di token, id versionati che il documento congelato accetta) e DISTINTO (palette
// diverse a due a due, nessun valore che rimandi al design system del builder).

// ── le chiavi attese ─────────────────────────────────────────────────────────
// Elenchi LETTERALI, scritti a mano: derivarli da THEMES li renderebbe veri per
// costruzione. Il TIPO del record e' pero' quello del modulo, quindi ogni mappa e'
// TOTALE PER TIPO — una chiave di token nuova in `SiteTheme` senza la sua riga qui non
// compila, ed e' l'unica derivazione ammessa (dal contratto, non dal dato).

const CHIAVI_TEMA: Record<keyof SiteTheme, true> = {
  id: true,
  colors: true,
  typography: true,
  spacing: true,
  radius: true,
};

const CHIAVI_COLORE: Record<keyof SiteTheme['colors'], true> = {
  background: true,
  surface: true,
  text: true,
  text_muted: true,
  accent: true,
  accent_contrast: true,
  border: true,
};

const CHIAVI_TIPOGRAFIA: Record<keyof SiteTheme['typography'], true> = {
  font_family: true,
  scale: true,
};

const CHIAVI_FAMIGLIA: Record<keyof SiteTheme['typography']['font_family'], true> = {
  heading: true,
  body: true,
};

const CHIAVI_SCALA: Record<keyof SiteTheme['typography']['scale'], true> = {
  sm: true,
  base: true,
  lg: true,
  xl: true,
  '2xl': true,
  '3xl': true,
};

const CHIAVI_SPAZIATURA: Record<keyof SiteTheme['spacing'], true> = {
  xs: true,
  sm: true,
  md: true,
  lg: true,
  xl: true,
  '2xl': true,
};

const CHIAVI_RAGGIO: Record<keyof SiteTheme['radius'], true> = {
  sm: true,
  md: true,
  lg: true,
  pill: true,
};

function chiavi(mappa: Record<string, true>): string[] {
  return Object.keys(mappa).sort();
}

// ── i valori attesi, tema per tema ───────────────────────────────────────────
// La mappa e' LETTERALE e completa. Non basta la PROPRIETA' "le palette differiscono"
// (AC-211-2): scambiare fra loro le palette di due temi, o riassegnare una famiglia
// tipografica, conserva ogni differenza a coppie e non sposta nessun conteggio —
// e' l'ASSEGNAZIONE (quale tema possiede cosa) che resterebbe senza giudice, la stessa
// classe di buco misurata in T-210. Qui l'assegnazione e' pinnata voce per voce.
//
// COSTO DICHIARATO: ritoccare un valore di un tema rende rosso questo file. E' voluto —
// un tema e' un artefatto congelato che i siti gia' pubblicati citano per id (P2-D14, e
// la versione e' DENTRO l'id proprio per questo), quindi cambiarne i valori senza
// alzare la versione e' esattamente la cosa che deve passare sotto gli occhi di chi
// rivede.

type TemaAtteso = {
  readonly colors: Record<keyof SiteTheme['colors'], string>;
  readonly font_family: Record<keyof SiteTheme['typography']['font_family'], string>;
  readonly scale: Record<keyof SiteTheme['typography']['scale'], string>;
  readonly spacing: Record<keyof SiteTheme['spacing'], string>;
  readonly radius: Record<keyof SiteTheme['radius'], string>;
};

const TEMI_ATTESI: Record<string, TemaAtteso> = {
  'sole-mediterraneo@1': {
    colors: {
      background: '#fdf6ec',
      surface: '#fffdf9',
      text: '#2b1d14',
      text_muted: '#7a6a5c',
      accent: '#c0492b',
      accent_contrast: '#fff8f2',
      border: '#e6d7c3',
    },
    font_family: {
      heading: 'Fraunces, Georgia, serif',
      body: 'Source Sans 3, Segoe UI, sans-serif',
    },
    scale: {
      sm: '0.875rem',
      base: '1.0625rem',
      lg: '1.375rem',
      xl: '1.875rem',
      '2xl': '2.5rem',
      '3xl': '3.25rem',
    },
    spacing: {
      xs: '0.375rem',
      sm: '0.75rem',
      md: '1.25rem',
      lg: '2rem',
      xl: '3.25rem',
      '2xl': '5rem',
    },
    radius: { sm: '0.25rem', md: '0.5rem', lg: '1rem', pill: '99rem' },
  },
  'linea-essenziale@1': {
    colors: {
      background: '#ffffff',
      surface: '#f5f7f9',
      text: '#14171a',
      text_muted: '#5c656e',
      accent: '#1f4fd8',
      accent_contrast: '#ffffff',
      border: '#dfe3e8',
    },
    font_family: {
      heading: 'Space Grotesk, Helvetica Neue, sans-serif',
      body: 'Inter, Helvetica Neue, sans-serif',
    },
    scale: {
      sm: '0.8125rem',
      base: '1rem',
      lg: '1.25rem',
      xl: '1.625rem',
      '2xl': '2.125rem',
      '3xl': '2.75rem',
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.75rem',
      xl: '2.75rem',
      '2xl': '4rem',
    },
    radius: { sm: '0.125rem', md: '0.25rem', lg: '0.5rem', pill: '99rem' },
  },
  'scatto-vitale@1': {
    colors: {
      background: '#0f1115',
      surface: '#191d24',
      text: '#f2f5f8',
      text_muted: '#9aa6b2',
      accent: '#b6ff3b',
      accent_contrast: '#101318',
      border: '#2b323d',
    },
    font_family: {
      heading: 'Barlow Condensed, Oswald, sans-serif',
      body: 'Barlow, Roboto, sans-serif',
    },
    scale: {
      sm: '0.875rem',
      base: '1.0625rem',
      lg: '1.3125rem',
      xl: '1.75rem',
      '2xl': '2.375rem',
      '3xl': '3.5rem',
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.625rem',
      md: '1.125rem',
      lg: '1.5rem',
      xl: '2.5rem',
      '2xl': '3.5rem',
    },
    radius: { sm: '0rem', md: '0.125rem', lg: '0.25rem', pill: '99rem' },
  },
  'bottega-artigiana@1': {
    colors: {
      background: '#f4f1ea',
      surface: '#fffdf8',
      text: '#1f2a1f',
      text_muted: '#6b7566',
      accent: '#2f6b4f',
      accent_contrast: '#f7fdf9',
      border: '#d8d2c2',
    },
    font_family: {
      heading: 'Libre Baskerville, Georgia, serif',
      body: 'Karla, Helvetica, sans-serif',
    },
    scale: {
      sm: '0.8125rem',
      base: '1rem',
      lg: '1.1875rem',
      xl: '1.5rem',
      '2xl': '2rem',
      '3xl': '2.625rem',
    },
    spacing: {
      xs: '0.375rem',
      sm: '0.625rem',
      md: '1rem',
      lg: '1.625rem',
      xl: '2.5rem',
      '2xl': '3.75rem',
    },
    radius: { sm: '0.1875rem', md: '0.375rem', lg: '0.625rem', pill: '99rem' },
  },
  'brezza-costiera@1': {
    colors: {
      background: '#f5fafc',
      surface: '#ffffff',
      text: '#0e2a38',
      text_muted: '#5b7684',
      accent: '#0f7c93',
      accent_contrast: '#ffffff',
      border: '#cfe2ea',
    },
    font_family: {
      heading: 'Poppins, Avenir Next, sans-serif',
      body: 'Nunito Sans, Segoe UI, sans-serif',
    },
    scale: {
      sm: '0.875rem',
      base: '1.0625rem',
      lg: '1.3125rem',
      xl: '1.6875rem',
      '2xl': '2.25rem',
      '3xl': '3rem',
    },
    spacing: {
      xs: '0.5rem',
      sm: '0.875rem',
      md: '1.375rem',
      lg: '2.25rem',
      xl: '3.5rem',
      '2xl': '5.5rem',
    },
    radius: { sm: '0.5rem', md: '0.875rem', lg: '1.5rem', pill: '99rem' },
  },
};

// L'ORDINE di dichiarazione del catalogo, letterale: e' l'ordine in cui le ricette
// (T-212) troveranno i temi e quello in cui un'interfaccia li mostrera'. Non pinnarlo
// lascerebbe senza giudice un riordino, che e' una modifica visibile al prodotto.
const ORDINE_DICHIARATO = [
  'sole-mediterraneo@1',
  'linea-essenziale@1',
  'scatto-vitale@1',
  'bottega-artigiana@1',
  'brezza-costiera@1',
];

// ── strumenti di lettura ─────────────────────────────────────────────────────

/** Ogni valore STRINGA del tema, col proprio percorso: colori, famiglie, scale, raggi. */
function valoriDelTema(tema: SiteTheme): readonly { percorso: string; valore: string }[] {
  const raccolti: { percorso: string; valore: string }[] = [];
  const visita = (nodo: unknown, percorso: string): void => {
    if (typeof nodo === 'string') {
      raccolti.push({ percorso, valore: nodo });
      return;
    }
    if (nodo !== null && typeof nodo === 'object') {
      for (const [chiave, figlio] of Object.entries(nodo)) visita(figlio, `${percorso}.${chiave}`);
    }
  };
  visita(tema, tema.id);
  return raccolti;
}

/** Il numero di valori che un tema completo espone: 1 (id) + le chiavi di ogni gruppo. */
const VALORI_PER_TEMA =
  1 +
  Object.keys(CHIAVI_COLORE).length +
  Object.keys(CHIAVI_FAMIGLIA).length +
  Object.keys(CHIAVI_SCALA).length +
  Object.keys(CHIAVI_SPAZIATURA).length +
  Object.keys(CHIAVI_RAGGIO).length;

function rem(valore: string): number {
  const numero = Number(valore.replace(/rem$/, ''));
  expect(Number.isFinite(numero), `valore non in rem: ${valore}`).toBe(true);
  return numero;
}

function atteso(id: string): TemaAtteso {
  const trovato = TEMI_ATTESI[id];
  if (!trovato) throw new Error(`tema senza attesa dichiarata: ${id}`);
  return trovato;
}

// ── AC-211-1 — cinque temi, lo stesso insieme di chiavi ──────────────────────

describe('T-211 THEMES — cinque temi con lo stesso insieme di chiavi di token', () => {
  // covers: AC-211-1
  it('sono esattamente cinque, con id distinti, nell ordine dichiarato', () => {
    expect(THEMES).toHaveLength(5); // covers: AC-211-1
    // L'ordine e l'IDENTITA' di ciascuno, non solo il conteggio: un tema sostituito da
    // un duplicato di un altro conserverebbe il cinque.
    expect(THEMES.map((tema) => tema.id)).toEqual(ORDINE_DICHIARATO); // covers: AC-211-1
    expect(new Set(THEMES.map((tema) => tema.id)).size).toBe(5); // covers: AC-211-1
    // Un tema NUOVO senza la sua riga nella mappa attesa rende rosso questo file invece
    // di nascere coi propri valori non giudicati.
    expect(new Set(Object.keys(TEMI_ATTESI))).toEqual(new Set(THEMES.map((tema) => tema.id)));
  });

  // covers: AC-211-1
  it('ciascuno espone lo stesso insieme di chiavi, senza chiavi mancanti e senza chiavi in piu', () => {
    // Un catalogo vuoto renderebbe VACUAMENTE vere tutte le asserzioni del ciclo. Il
    // CINQUE e' letterale, non THEMES.length: derivarlo dal dato che si sta giudicando
    // renderebbe la guardia stessa vera per costruzione.
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-211-1

    for (const tema of THEMES) {
      // Uguaglianza ESATTA in entrambi i versi: dice sia che non manca nulla sia che non
      // c'e' nulla in piu' (una chiave che un solo tema porta sarebbe un token che il
      // rendering non puo' usare, T-231).
      expect(Object.keys(tema).sort(), tema.id).toEqual(chiavi(CHIAVI_TEMA)); // covers: AC-211-1
      expect(Object.keys(tema.colors).sort(), tema.id).toEqual(chiavi(CHIAVI_COLORE)); // covers: AC-211-1
      expect(Object.keys(tema.typography).sort(), tema.id).toEqual(chiavi(CHIAVI_TIPOGRAFIA)); // covers: AC-211-1
      expect(Object.keys(tema.typography.font_family).sort(), tema.id).toEqual(
        chiavi(CHIAVI_FAMIGLIA),
      ); // covers: AC-211-1
      expect(Object.keys(tema.typography.scale).sort(), tema.id).toEqual(chiavi(CHIAVI_SCALA)); // covers: AC-211-1
      expect(Object.keys(tema.spacing).sort(), tema.id).toEqual(chiavi(CHIAVI_SPAZIATURA)); // covers: AC-211-1
      expect(Object.keys(tema.radius).sort(), tema.id).toEqual(chiavi(CHIAVI_RAGGIO)); // covers: AC-211-1
    }

    // E la stessa cosa detta CONFRONTANDO I TEMI FRA LORO, che e' la lettera dell'AC
    // ("ciascuno espone lo stesso insieme di chiavi"): se le mappe attese qui sopra
    // sbagliassero tutte allo stesso modo, questo confronto no. E' sui PERCORSI, quindi
    // vede anche una chiave mancante in fondo a un gruppo annidato.
    const insiemi = THEMES.map((tema) =>
      valoriDelTema(tema)
        .map((voce) => voce.percorso.slice(tema.id.length))
        .sort()
        .join('\n'),
    );
    expect(new Set(insiemi).size, insiemi.join('\n---\n')).toBe(1); // covers: AC-211-1
  });

  // covers: AC-211-1
  it('ogni tema porta ESATTAMENTE i valori che gli competono (assegnazione pinnata)', () => {
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-211-1

    for (const tema of THEMES) {
      const suo = atteso(tema.id);
      // Uguaglianza per OGGETTO INTERO, non token per token: prende sia il valore
      // cambiato sia la palette scambiata fra due temi.
      expect(tema.colors, tema.id).toEqual(suo.colors);
      expect(tema.typography.font_family, tema.id).toEqual(suo.font_family);
      expect(tema.typography.scale, tema.id).toEqual(suo.scale);
      expect(tema.spacing, tema.id).toEqual(suo.spacing);
      expect(tema.radius, tema.id).toEqual(suo.radius);
    }
  });
});

// ── AC-211-2 — le dieci coppie hanno palette diverse ─────────────────────────

describe('T-211 THEMES — nessuna coppia di temi ha la stessa palette', () => {
  // covers: AC-211-2
  it('le dieci coppie differiscono tutte su almeno un token di colore', () => {
    const coppie: { a: SiteTheme; b: SiteTheme }[] = [];
    for (let i = 0; i < THEMES.length; i += 1) {
      for (let j = i + 1; j < THEMES.length; j += 1) {
        const a = THEMES[i];
        const b = THEMES[j];
        if (a && b) coppie.push({ a, b });
      }
    }

    // Le coppie sono DIECI: senza questo conteggio un catalogo ridotto renderebbe il
    // ciclo vero per vacuita' (e con un solo tema le coppie sarebbero zero).
    expect(coppie).toHaveLength(10); // covers: AC-211-2

    for (const { a, b } of coppie) {
      const diversi = Object.keys(CHIAVI_COLORE).filter(
        (token) =>
          a.colors[token as keyof SiteTheme['colors']] !==
          b.colors[token as keyof SiteTheme['colors']],
      );
      expect(diversi.length, `${a.id} e ${b.id} hanno la stessa palette`).toBeGreaterThan(0); // covers: AC-211-2
    }
  });
});

// ── AC-211-3 — nessun riferimento al design system del builder ───────────────

describe('T-211 THEMES — i valori sono propri di P2, non riferimenti ai token dell app', () => {
  // COSA REGGE DAVVERO AC-211-3, misurato e non argomentato: `valore.includes('var(')`
  // su OGNI valore di OGNI tema. E' un controllo PIU' FORTE di quello che l'AC descrive
  // alla lettera — vieta qualunque rimando a una variabile di chiunque, non solo ai nomi
  // che il builder usa oggi — e non ha bisogno di leggere src/ui/theme/tokens.ts.
  //
  // QUI C'ERA UNA DERIVAZIONE DA tokens.ts, ed e' stata TOLTA perche' MISURATA INERTE
  // (2026-07-29). Cercava dentro i temi i NOMI di custom property del builder
  // ('--color-background', ...). Tre mutazioni indipendenti l'hanno trovata senza alcun
  // potere di presa: sostituire quei nomi con una stringa che non c'entra nulla -> VERDE;
  // cancellare l'intero ciclo che li cercava -> VERDE; cancellare la riga che ne contava
  // le voci -> VERDE (confrontava la lunghezza di un `.map()` con quella della lista da
  // cui nasceva: vera per definizione del linguaggio, non per una proprieta' del codice).
  // La ragione e' che ogni valore ha gia' un controllo di FORMA piu' stretto nel test qui
  // sotto — colori esadecimali, misure in rem, famiglie che iniziano per lettera — che
  // rigetta un nome nudo di custom property prima ancora che qualcuno lo cerchi.
  //
  // Toglierla chiude per giunta l'accoppiamento di P2 alla RAPPRESENTAZIONE interna del
  // design system del builder: quel modulo puo' migrare a valori letterali (OKLCH, hex)
  // senza rendere rosso un file di P2 che non c'entra. Un oracolo che non puo' fallire
  // non e' una difesa in piu': e' una copertura dichiarata che non esiste.

  // covers: AC-211-3
  it('nessun valore di nessun tema contiene un riferimento alle custom property dell app', () => {
    const tutti = THEMES.flatMap((tema) => valoriDelTema(tema));
    // Il numero di valori ispezionati e' DICHIARATO col CINQUE letterale, non con
    // THEMES.length: derivarlo dal catalogo renderebbe l'uguaglianza vera anche su un
    // catalogo vuoto (0 === 0) e l'intero ciclo qui sotto vero per vacuita'. Serve anche
    // a dire che il walk scende: fermandosi al primo livello vedrebbe il solo `id`.
    expect(tutti).toHaveLength(VALORI_PER_TEMA * 5); // covers: AC-211-3

    for (const { percorso, valore } of tutti) {
      // Nessuna funzione var() in alcuna forma: e' la sola sintassi con cui un valore
      // puo' rimandare a una variabile di qualcun altro. E' LA riga che regge l'AC, ed e'
      // viva: la mutazione che porta un colore di un tema a 'var(--color-primary)' e'
      // rossa proprio qui.
      expect(valore.includes('var('), `${percorso} = ${valore}`).toBe(false); // covers: AC-211-3
    }
  });

  // covers: AC-211-3
  it('i valori sono valori PROPRI: esadecimali per i colori, rem per le misure, nomi di famiglia', () => {
    // L'altra meta' dell'AC ("i valori dei temi sono propri di P2"): non basta che non
    // rimandino altrove, devono essere valori che un rendering puo' usare da soli. Una
    // stringa vuota, o un 'inherit', supererebbe il controllo qui sopra.
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-211-3

    for (const tema of THEMES) {
      for (const [token, valore] of Object.entries(tema.colors)) {
        expect(valore, `${tema.id}.colors.${token}`).toMatch(/^#[0-9a-f]{6}$/); // covers: AC-211-3
      }
      const misure = [
        ...Object.entries(tema.typography.scale),
        ...Object.entries(tema.spacing),
        ...Object.entries(tema.radius),
      ];
      for (const [token, valore] of misure) {
        expect(valore, `${tema.id}.${token}`).toMatch(/^[0-9]+(\.[0-9]+)?rem$/); // covers: AC-211-3
      }
      for (const [ruolo, famiglia] of Object.entries(tema.typography.font_family)) {
        // Uno STACK, non un nome solo: un tema che nominasse un solo font lascerebbe il
        // sito senza fallback. La virgola e' il separatore della proprieta' CSS.
        expect(famiglia, `${tema.id}.font_family.${ruolo}`).toMatch(
          /^[A-Za-z][A-Za-z0-9 ]*(, [A-Za-z][A-Za-z0-9 -]*)+$/,
        ); // covers: AC-211-3
      }
    }
  });
});

// ── AC-211-5 — il tipo dei temi e' TOTALE sulle chiavi ───────────────────────

describe('T-211 SiteTheme — il tipo e totale: un tema incompleto non compila', () => {
  // AC-211-5 parla del TYPECHECK, non del runtime: l'oracolo e' quindi ESEGUIBILE e non
  // affermato a parole, ed e' il '@ts-expect-error' qui sotto. Il meccanismo:
  // - oggi il tema e' incompleto (manca il token di colore 'border'), TypeScript emette
  //   l'errore e la direttiva lo attende: 'npm run typecheck' e' VERDE;
  // - il giorno in cui `SiteTheme` smettesse di essere totale sulle chiavi (colors reso
  //   Partial, o un token diventato opzionale) l'errore sparirebbe, la direttiva
  //   resterebbe INUTILIZZATA e 'npm run typecheck' andrebbe ROSSO con TS2578.
  // E' cioe' un controllo che sa diventare rosso in entrambi i versi: se il tema si
  // completa, e se il tipo si allenta.
  const TEMA_SENZA_UN_TOKEN: SiteTheme = {
    id: 'tema-di-prova-incompleto@1',
    // @ts-expect-error AC-211-5: manca il token di colore 'border'. Se questa riga
    // smettesse di essere un errore, il tipo dei temi non sarebbe piu' totale.
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      text: '#101010',
      text_muted: '#606060',
      accent: '#3355ff',
      accent_contrast: '#ffffff',
    },
    typography: {
      font_family: { heading: 'Inter, sans-serif', body: 'Inter, sans-serif' },
      scale: {
        sm: '0.875rem',
        base: '1rem',
        lg: '1.25rem',
        xl: '1.5rem',
        '2xl': '2rem',
        '3xl': '2.5rem',
      },
    },
    spacing: {
      xs: '0.25rem',
      sm: '0.5rem',
      md: '1rem',
      lg: '1.5rem',
      xl: '2rem',
      '2xl': '3rem',
    },
    radius: { sm: '0.25rem', md: '0.5rem', lg: '1rem', pill: '99rem' },
  };

  // covers: AC-211-5
  it('il tema di prova e DAVVERO incompleto, quindi la direttiva del typecheck ha una preda', () => {
    // Se il fixture si completasse, il '@ts-expect-error' diventerebbe inutilizzato e il
    // typecheck sarebbe rosso — ma il tempo fra le due cose sarebbe cieco. Questa riga
    // dichiara a runtime cio' che la direttiva attende a compile time.
    expect(Object.keys(TEMA_SENZA_UN_TOKEN.colors)).not.toContain('border'); // covers: AC-211-5
    // E i temi VERI, che non hanno la direttiva, quel token ce l'hanno tutti: e' il ramo
    // positivo della stessa proprieta'.
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5); // covers: AC-211-5

    for (const tema of THEMES) {
      expect(Object.keys(tema.colors), tema.id).toContain('border'); // covers: AC-211-5
    }
  });
});

// ── oracoli AGGIUNTIVI dichiarati (non derivano da un AC) ────────────────────

describe('T-211 oracoli aggiuntivi — gli id nascono VERSIONATI (precondizione di T-202)', () => {
  // NON e' un AC: e' la precondizione MISURATA ed EREDITATA da T-202 (2026-07-28). Il
  // documento congelato RICHIEDE `recipe_id` e `theme_id` nella forma 'nome-kebab@N' —
  // un id senza '@N' fa cadere l'INTERO documento, non solo il campo.
  //
  // IL CONTROLLO E' DERIVATO DAL CONTRATTO A MONTE, mai riscritto: la forma non compare
  // in questo file. Si usa lo schema di T-202 (`SiteDocumentSchema`) e il suo gate
  // (`parseDocument`), cosi' il giorno in cui la forma dell'id cambia la' questo file
  // diventa rosso invece di continuare a giudicare con una regex sua.
  const SCHEMA_ID_VERSIONATO = SiteDocumentSchema.innerType().shape.theme_id;

  /** Il documento valido piu' piccolo che T-202 accetti, col theme_id sotto esame. */
  function documentoCon(themeId: string): Record<string, unknown> {
    return {
      recipe_id: 'ricetta-di-prova@1',
      theme_id: themeId,
      pages: [
        {
          slug: 'home',
          role: 'home',
          title: 'Osteria del Ponte',
          meta_description: 'Osteria di quartiere a Bologna, cucina di stagione.',
          blocks: [{ id: 'hero', content: {}, data: {}, brief_fields_rendered: [], images: [] }],
        },
      ],
    };
  }

  it('ogni id passa lo schema di T-202 e sta sotto il tetto di DOCUMENT_LIMITS', () => {
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const tema of THEMES) {
      expect(SCHEMA_ID_VERSIONATO.safeParse(tema.id).success, tema.id).toBe(true);
      expect(tema.id.length, tema.id).toBeLessThanOrEqual(DOCUMENT_LIMITS.versioned_id);
    }
  });

  it('senza la versione nell id cade il documento INTERO, non solo il campo', () => {
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const tema of THEMES) {
      // Il ramo POSITIVO: l'id vero fa passare un documento altrimenti valido.
      expect(parseDocument(documentoCon(tema.id)).ok, tema.id).toBe(true);

      // Il ramo NEGATIVO, costruito togliendo la versione. Il taglio NON e' l'oracolo
      // (l'oracolo resta parseDocument): serve solo a fabbricare il controesempio, ed e'
      // dichiarato non vuoto qui sotto perche' un id gia' privo di '@N' renderebbe i due
      // rami lo stesso caso.
      const senzaVersione = tema.id.replace(/@[0-9]+$/, '');
      expect(senzaVersione, `id gia privo di versione: ${tema.id}`).not.toBe(tema.id);
      expect(SCHEMA_ID_VERSIONATO.safeParse(senzaVersione).success, senzaVersione).toBe(false);
      expect(parseDocument(documentoCon(senzaVersione)).ok, senzaVersione).toBe(false);
    }
  });
});

describe('T-211 oracoli aggiuntivi — i cinque temi sono distinti anche fuori dai colori', () => {
  // NON e' un AC (AC-211-2 chiede la sola palette): la DoD chiede cinque set "completi e
  // DISTINTI", e due temi che condividessero famiglia tipografica e scala sarebbero due
  // varianti di colore dello stesso tema — cioe' cinque direzioni che ne offrono meno di
  // cinque (P2-D1).
  it('accento, coppia di famiglie tipografiche e scala sono distinti a due a due', () => {
    const accenti = THEMES.map((tema) => tema.colors.accent);
    const famiglie = THEMES.map(
      (tema) => `${tema.typography.font_family.heading}|${tema.typography.font_family.body}`,
    );
    const scale = THEMES.map((tema) => JSON.stringify(tema.typography.scale));
    const spaziature = THEMES.map((tema) => JSON.stringify(tema.spacing));

    // Il CINQUE e' letterale e non THEMES.length: derivato dal catalogo, un catalogo
    // vuoto renderebbe queste quattro righe vere per vacuita' (0 === 0) e un catalogo
    // dimezzato le renderebbe vere su meta' delle direzioni promesse.
    expect(new Set(accenti).size, accenti.join(',')).toBe(5);
    expect(new Set(famiglie).size, famiglie.join(',')).toBe(5);
    expect(new Set(scale).size).toBe(5);
    expect(new Set(spaziature).size).toBe(5);
  });

  it('ogni scala CRESCE: la gerarchia e una proprieta, non una sequenza di numeri qualsiasi', () => {
    // NON e' un AC ed e' l'unica cosa vicina allo stile che sia oracolabile: 'lg' piu'
    // piccolo di 'sm' non e' brutto, e' rotto — il rendering (T-231) legge questi passi
    // come una gerarchia. Una scala rimescolata conserva conteggio, chiavi e distinzione
    // a coppie, quindi nessun altro controllo di questo file la vedrebbe.
    expect(THEMES, 'catalogo vuoto o ridotto: il ciclo sarebbe vero per vacuita').toHaveLength(5);

    for (const tema of THEMES) {
      // I passi sono elencati NELL'ORDINE atteso, a mano e per esteso: e' l'ordine la
      // cosa giudicata, e leggerlo da Object.keys lo prenderebbe dal dato.
      const gerarchie: readonly {
        readonly gruppo: string;
        readonly passi: readonly (readonly [string, string])[];
      }[] = [
        {
          gruppo: 'typography.scale',
          passi: [
            ['sm', tema.typography.scale.sm],
            ['base', tema.typography.scale.base],
            ['lg', tema.typography.scale.lg],
            ['xl', tema.typography.scale.xl],
            ['2xl', tema.typography.scale['2xl']],
            ['3xl', tema.typography.scale['3xl']],
          ],
        },
        {
          gruppo: 'spacing',
          passi: [
            ['xs', tema.spacing.xs],
            ['sm', tema.spacing.sm],
            ['md', tema.spacing.md],
            ['lg', tema.spacing.lg],
            ['xl', tema.spacing.xl],
            ['2xl', tema.spacing['2xl']],
          ],
        },
        {
          gruppo: 'radius',
          passi: [
            ['sm', tema.radius.sm],
            ['md', tema.radius.md],
            ['lg', tema.radius.lg],
            ['pill', tema.radius.pill],
          ],
        },
      ];

      for (const { gruppo, passi } of gerarchie) {
        for (let i = 1; i < passi.length; i += 1) {
          const [nomePrecedente, valorePrecedente] = passi[i - 1];
          const [nome, valore] = passi[i];
          expect(
            rem(valore) > rem(valorePrecedente),
            `${tema.id}.${gruppo}: ${nomePrecedente}=${valorePrecedente} non precede ${nome}=${valore}`,
          ).toBe(true);
        }
      }
    }
  });
});
