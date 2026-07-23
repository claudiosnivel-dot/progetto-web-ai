// Augmentation dei tipi di next-intl (v4): it.json è la sorgente di verità per
// la forma dei messaggi. Tipizzando AppConfig.Messages con `typeof it.json`,
// le chiavi di useTranslations/getMessages diventano type-safe e il locale 'es'
// deve mantenere la stessa struttura (parità garantita anche a livello di tipi).
// File di sola dichiarazione: applicato all'intero programma via `include` di
// tsconfig, non richiede import da altri moduli runtime.
import type messages from '../../messages/it.json';

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof messages;
  }
}
