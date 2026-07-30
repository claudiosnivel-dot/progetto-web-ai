// T-211 (macrotask generation-engine, P2) — I CINQUE TEMI DEL SITO GENERATO: colori,
// tipografia, spaziature e raggi che appartengono al SITO DEL CLIENTE e non al chrome
// del builder. Dominio PURO: nessun accesso al DB, nessun I/O, nessun side effect — e
// nessun import, perche' il modulo e' un catalogo dichiarato e nient'altro.
//
// PERCHE' VIVONO QUI E NON IN src/ui/theme/ (P2-D14): il design system dell'app
// (src/ui/theme/tokens.ts) e' il vestito del PANNELLO e cambia quando cambia il
// pannello; i suoi colori sono per costruzione dei RIFERIMENTI a CSS custom property
// ('var(--color-background)'), cioe' valori che qualcun altro decide a runtime. Un tema
// del sito generato non puo' poggiare su quei riferimenti: il sito del cliente e' un
// ARTEFATTO CONGELATO, scelto una volta e pubblicato, e un ritocco al pannello non deve
// poterlo riscrivere. Per questo i valori qui sotto sono PROPRI — esadecimali, rem, nomi
// di famiglia — e non c'e' alcun 'var(--...)' in nessuno di essi.
//
// LA SEPARAZIONE E' IMPOSTA DAL MECCANISMO, non sorvegliata dalla disciplina: una regola
// ESLint no-restricted-imports (eslint.config.mjs) vieta a src/ui/site/** — il layer che
// rendera' i blocchi, T-231 — di importare src/ui/theme/tokens, per alias e per percorso
// relativo. E' lo stesso pattern con cui P1-D7 chiude il confine LLM (T-131), ed e'
// verificata da tests/generation-theme-isolation.test.ts eseguendo ESLint su un modulo
// fixture VIRTUALE. Senza quella regola la separazione sarebbe una convenzione, cioe'
// una cosa che regge finche' nessuno ha fretta.
//
// GLI ID NASCONO VERSIONATI, ed e' una PRECONDIZIONE EREDITATA e misurata (T-202,
// 2026-07-28): il documento congelato registra `theme_id` nella forma 'nome-kebab@N' e
// un id senza '@N' fa cadere l'INTERO documento, non solo il campo. La versione e' DENTRO
// l'id e non accanto perche' e' cosi' che un ritocco futuro a un tema non riscrive un
// sito gia' scelto: cambiare i valori di 'sole-mediterraneo@1' senza passare a '@2'
// significa cambiare sotto i piedi i siti che lo citano.
//
// IL CARATTERE DI OGNI TEMA E' DICHIARATO IN UN COMMENTO, MA IL COMMENTO NON E'
// UN'ASSERZIONE (L-COL-006): "caldo", "essenziale", "asciutto" dicono a chi si rivolge il
// tema e che sensazione punta a dare, e servono a chi in futuro dovra' scegliere dove
// mettere le mani. Nessun test prova che un tema sia BELLO — lo stile non e' oracolabile
// (P1 §6-bis p.8). Cio' che i test provano e' che il layer esiste, che le chiavi sono le
// stesse ovunque, che le cinque palette sono distinte e che nessun valore rimanda al
// builder.
//
// COSA NON C'E' QUI, deliberatamente:
// - l'APPLICAZIONE del tema nel rendering (T-231): questo modulo dichiara i valori, non
//   li scrive in nessuna pagina e non conosce React;
// - l'ACCOPPIAMENTO tema-ricetta (T-212): quale direzione usi quale tema e' una
//   decisione delle ricette, e dichiararla qui la scriverebbe due volte;
// - `brand_hints` come SELETTORE del tema: escluso in v1. E' testo libero che il cliente
//   scrive e che il modello puo' riscrivere (update_brief, T-132): farne un selettore
//   aprirebbe un canale dal testo NON FIDATO alla scelta dell'aspetto del sito, cioe'
//   una leva in piu' per chi tentasse un'injection. Il tema lo sceglie la ricetta.
// - l'IMAGERY del tema: il documento (T-202) nomina i placeholder con un token, ma il
//   catalogo di quei token non e' di questo task.

/**
 * I TOKEN DI COLORE, gli stessi per tutti i temi. Sono SEMANTICI e non descrittivi
 * ('accent', non 'arancione'): e' cio' che permette al rendering (T-231) di essere
 * scritto una volta sola per cinque temi.
 *
 * `accent_contrast` e' il colore del testo che sta SOPRA l'accento (l'etichetta dentro
 * il bottone): non e' un secondo accento, e tenerlo separato e' cio' che evita che un
 * tema scuro finisca con un testo scuro su fondo scuro.
 */
type ColorToken =
  | 'background'
  | 'surface'
  | 'text'
  | 'text_muted'
  | 'accent'
  | 'accent_contrast'
  | 'border';

/** I due ruoli tipografici: i titoli e il corpo del testo. */
type FontRole = 'heading' | 'body';

/** I passi della scala tipografica, dal piu' piccolo al piu' grande. */
type TypeScaleStep = 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';

/** I passi del ritmo verticale e orizzontale, dal piu' stretto al piu' largo. */
type SpacingStep = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** I raggi di bordo. `pill` e' il raggio "completo" dei bottoni a pillola. */
type RadiusStep = 'sm' | 'md' | 'lg' | 'pill';

/**
 * UN TEMA DEL SITO GENERATO.
 *
 * IL TIPO E' TOTALE SULLE CHIAVI, ed e' il punto: ogni gruppo e' un `Record` sulla
 * propria unione chiusa di token, quindi un tema a cui manchi anche un solo token NON
 * COMPILA (AC-211-5). Non e' pedanteria: il rendering leggera' `colors.border` senza
 * chiedersi se quel tema ce l'ha, e un token mancante diventerebbe `undefined` in una
 * proprieta' CSS — cioe' un bordo che sparisce in produzione su un tema solo, che e' il
 * genere di difetto che nessuno vede finche' non lo vede un cliente.
 */
export type SiteTheme = {
  /**
   * Identificatore STABILE e VERSIONATO nella forma 'nome-kebab@N', che e' quella
   * richiesta da `SiteDocumentSchema` (T-202) per `theme_id`. Qui non e' confrontato con
   * quello schema — il confronto vive dove il documento si costruisce (T-214) — ma e'
   * scelto per passarlo, e il test lo verifica DERIVANDO il controllo da quello schema.
   */
  readonly id: string;
  readonly colors: Readonly<Record<ColorToken, string>>;
  readonly typography: {
    /** Stack completi, col fallback di sistema: un font che non carica non lascia il sito senza testo. */
    readonly font_family: Readonly<Record<FontRole, string>>;
    readonly scale: Readonly<Record<TypeScaleStep, string>>;
  };
  readonly spacing: Readonly<Record<SpacingStep, string>>;
  readonly radius: Readonly<Record<RadiusStep, string>>;
};

/**
 * I CINQUE TEMI, nell'ordine in cui vengono offerti. Sono dichiarati a mano da noi e non
 * inventati dal modello (P2-D1): insieme alle ricette (T-212) sono la ragione per cui la
 * promessa "risultati brutti strutturalmente impossibili" e' verificabile — il modello
 * scrive prosa, non sceglie i colori.
 *
 * I VALORI SONO PROPRI DI P2. Nessuno e' un 'var(--...)', nemmeno dove coincide per caso
 * con un numero del builder: una spaziatura di '1rem' e' un rem scelto qui, non il
 * medesimo rem del pannello, e il giorno in cui il pannello cambia il suo questo resta
 * dov'e'.
 */
export const THEMES: readonly SiteTheme[] = [
  {
    // SOLE MEDITERRANEO — per osterie, trattorie, forni e botteghe di gastronomia.
    // Terracotta su crema, titoli con le grazie: punta alla sensazione della tavola
    // apparecchiata di giorno, calda e senza pretese. E' il tema piu' "vecchia insegna"
    // dei cinque.
    id: 'sole-mediterraneo@1',
    colors: {
      background: '#fdf6ec',
      surface: '#fffdf9',
      text: '#2b1d14',
      text_muted: '#7a6a5c',
      accent: '#c0492b',
      accent_contrast: '#fff8f2',
      border: '#e6d7c3',
    },
    typography: {
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
  {
    // LINEA ESSENZIALE — per studi professionali, consulenti, saloni con clientela
    // urbana. Grafite su bianco, un blu di lavoro come unico accento, raggi quasi vivi:
    // punta alla sensazione della competenza sobria, dove il sito non alza la voce.
    id: 'linea-essenziale@1',
    colors: {
      background: '#ffffff',
      surface: '#f5f7f9',
      text: '#14171a',
      text_muted: '#5c656e',
      accent: '#1f4fd8',
      accent_contrast: '#ffffff',
      border: '#dfe3e8',
    },
    typography: {
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
  {
    // SCATTO VITALE — per palestre, box di functional training, scuole di danza.
    // L'unico tema SCURO dei cinque: lime elettrico su antracite, titoli condensati,
    // spigoli vivi (il raggio piu' piccolo e' zero). Punta alla sensazione dell'energia
    // e del movimento, ed e' anche il tema che regge meglio le foto a tutta larghezza.
    id: 'scatto-vitale@1',
    colors: {
      background: '#0f1115',
      surface: '#191d24',
      text: '#f2f5f8',
      text_muted: '#9aa6b2',
      accent: '#b6ff3b',
      accent_contrast: '#101318',
      border: '#2b323d',
    },
    typography: {
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
  {
    // BOTTEGA ARTIGIANA — per laboratori, negozi di quartiere, produttori che vendono
    // cio' che fanno. Carta e inchiostro con un verde bosco, titoli con le grazie e
    // ritmo stretto: punta alla sensazione del mestiere fatto a mano, dove conta il
    // prodotto e non la vetrina.
    id: 'bottega-artigiana@1',
    colors: {
      background: '#f4f1ea',
      surface: '#fffdf8',
      text: '#1f2a1f',
      text_muted: '#6b7566',
      accent: '#2f6b4f',
      accent_contrast: '#f7fdf9',
      border: '#d8d2c2',
    },
    typography: {
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
  {
    // BREZZA COSTIERA — per B&B, case vacanza, stabilimenti, servizi al turismo.
    // Acqua e sabbia chiara, geometrie morbide e il ritmo piu' ARIOSO dei cinque (e' il
    // tema con le spaziature piu' larghe): punta alla sensazione dell'aria aperta e del
    // tempo che non stringe.
    id: 'brezza-costiera@1',
    colors: {
      background: '#f5fafc',
      surface: '#ffffff',
      text: '#0e2a38',
      text_muted: '#5b7684',
      accent: '#0f7c93',
      accent_contrast: '#ffffff',
      border: '#cfe2ea',
    },
    typography: {
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
];
