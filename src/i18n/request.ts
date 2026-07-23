import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import defaultMessages from '../../messages/it.json';

// Type guard: oggetto "plain" (record annidato), non null e non array.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Deep-merge di due alberi di messaggi: le chiavi dell'override (locale attivo)
// vincono; le chiavi presenti solo nella base (defaultLocale 'it') vengono
// ereditate. Così una traduzione mancante nel locale attivo ricade sull'IT.
function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isRecord(current) && isRecord(value)
        ? deepMerge(current, value)
        : value;
  }
  return result as T;
}

// Config di richiesta next-intl: risolve il locale attivo (validato contro
// l'allowlist di routing.locales, con fallback al defaultLocale) e carica il
// catalogo di messaggi corrispondente. Il defaultLocale ('it') è la sorgente
// di verità: per una chiave assente nel locale attivo si usa il valore di 'it'
// tramite deep-merge (l'attivo resta override). Per 'it' il catalogo è già
// completo, nessun merge necessario.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  let messages = defaultMessages;
  if (locale !== routing.defaultLocale) {
    const active = (await import(`../../messages/${locale}.json`)).default;
    messages = deepMerge(defaultMessages, active);
  }

  return {
    locale,
    messages,
  };
});
