import { defineRouting } from 'next-intl/routing';

// Configurazione centrale del routing i18n (unica sorgente di verità per le
// lingue supportate). localePrefix 'always' → anche il default 'it' è sempre
// prefissato, così la root reindirizza esplicitamente al locale di default.
export const routing = defineRouting({
  locales: ['it', 'es'],
  defaultLocale: 'it',
  localePrefix: 'always',
});
