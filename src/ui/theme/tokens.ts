// Design token: unica sorgente di verità per colori, spaziature, tipografia e raggi.
// I colori sono RIFERIMENTI a CSS custom properties (var(--color-*)); i valori reali
// (hex) vivono solo in src/app/globals.css sotto :root e [data-theme="dark"], così
// nessun valore è duplicato. tailwind.config.ts deriva la propria theme da questi
// oggetti. Nessun segreto/credenziale qui: il modulo viene bundlato nel client (R7).

// Nomi colore semantici (pattern shadcn) -> riferimento alla CSS custom property.
export const colors: Record<string, string> = {
  background: 'var(--color-background)',
  foreground: 'var(--color-foreground)',
  primary: 'var(--color-primary)',
  'primary-foreground': 'var(--color-primary-foreground)',
  secondary: 'var(--color-secondary)',
  'secondary-foreground': 'var(--color-secondary-foreground)',
  muted: 'var(--color-muted)',
  'muted-foreground': 'var(--color-muted-foreground)',
  border: 'var(--color-border)',
};

// Scala di spaziatura (rem).
export const spacing: Record<string, string> = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
};

// Tipografia: famiglie e scala dimensioni.
export const typography: {
  fontFamily: { sans: string[] };
  fontSize: Record<string, string>;
} = {
  fontFamily: {
    sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  },
  fontSize: {
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  },
};

// Raggi di bordo.
export const borderRadius: Record<string, string> = {
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
};
