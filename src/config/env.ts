// Loader di ambiente tipizzato. Valida la presenza delle variabili richieste e
// fallisce esplicitamente nominando quella mancante. Nessun segreto nel sorgente:
// tutti i valori arrivano da process.env.

export interface AppEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

/**
 * Legge e valida le variabili d'ambiente richieste.
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 * @throws Error il cui messaggio nomina le variabili mancanti.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = source[key];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(`Variabili d'ambiente mancanti: ${missing.join(', ')}`);
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL as string,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    SUPABASE_SERVICE_ROLE_KEY: source.SUPABASE_SERVICE_ROLE_KEY as string,
  };
}
