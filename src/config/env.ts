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

// T-130 (macrotask ai-onboarding, P1) — config Anthropic. ANTHROPIC_API_KEY e un
// SEGRETO server-only: mai NEXT_PUBLIC, mai riesportato verso il browser, e questo
// accessor e l'UNICO punto del sorgente che lo nomina. Non entra in REQUIRED_KEYS
// perche il boot deve riuscire anche dove l'LLM non serve: chi la chiave la usa
// fallisce qui in modo esplicito (fail-fast), non con una stringa vuota silenziosa.

// Modello dell'intervista di onboarding quando ANTHROPIC_MODEL_ONBOARDING e assente
// (decisione P1-D4). Config pubblica, non un segreto.
const DEFAULT_ANTHROPIC_MODEL_ONBOARDING = 'claude-haiku-4-5';

/**
 * Legge il segreto Anthropic (solo server-side).
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 * @throws Error di configurazione che nomina ANTHROPIC_API_KEY se assente o vuota.
 */
export function getAnthropicApiKey(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source.ANTHROPIC_API_KEY;
  if (value === undefined || value.trim() === '') {
    throw new Error("Variabile d'ambiente mancante: ANTHROPIC_API_KEY");
  }
  return value;
}

/**
 * Modello Anthropic dell'intervista di onboarding: il valore configurato se
 * valorizzato, altrimenti il default. Vuota/whitespace = non impostata (come loadEnv).
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 */
export function getAnthropicOnboardingModel(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source.ANTHROPIC_MODEL_ONBOARDING;
  return value !== undefined && value.trim() !== '' ? value : DEFAULT_ANTHROPIC_MODEL_ONBOARDING;
}

// T-224 (macrotask generation-llm, P2) — modello della GENERAZIONE dei mockup quando
// ANTHROPIC_MODEL_GENERATION e assente: Sonnet 5 (decisione P2-D11). E' un accessor
// SEPARATO da quello dell'intervista e non un default condiviso, perche' le due fasi
// hanno compiti e costi diversi — l'intervista e' dialogo breve, la generazione scrive
// il sito — e il giorno in cui una delle due cambia modello l'altra non deve seguirla
// per distrazione. Config pubblica, non un segreto.
const DEFAULT_ANTHROPIC_MODEL_GENERATION = 'claude-sonnet-5';

/**
 * Modello Anthropic della generazione dei mockup: il valore configurato se valorizzato,
 * altrimenti il default. Vuota/whitespace = non impostata (come loadEnv e come il modello
 * dell'intervista).
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 */
export function getAnthropicGenerationModel(
  source: Record<string, string | undefined> = process.env,
): string {
  const value = source.ANTHROPIC_MODEL_GENERATION;
  return value !== undefined && value.trim() !== '' ? value : DEFAULT_ANTHROPIC_MODEL_GENERATION;
}

// T-409 (macrotask seo-base, P4) — LA BASE URL PUBBLICA del sito, la radice assoluta da cui la
// serving compone canonical, og:url e ogni indirizzo che deve uscire ASSOLUTO (un canonical
// relativo non e' un canonical). NEXT_PUBLIC_SITE_URL e' CONFIG PUBBLICA, non un segreto: e'
// l'origine con cui il sito e' servito, la stessa che il browser gia' vede. Non entra in
// REQUIRED_KEYS perche' in sviluppo il default locale basta; in produzione la si valorizza.
const DEFAULT_SITE_BASE_URL = 'http://localhost:3000';

/**
 * La base URL pubblica SENZA slash finale (cosi' `${base}/s/<slug>` non produce mai `//`): il valore
 * configurato, ripulito da spazi e da eventuali slash in coda, altrimenti il default di sviluppo.
 * Vuota/whitespace = non impostata (come loadEnv e gli accessor dei modelli).
 * @param source sorgente delle variabili (default: process.env) — parametrizzato per i test.
 */
export function getSiteBaseUrl(source: Record<string, string | undefined> = process.env): string {
  const trimmed = source.NEXT_PUBLIC_SITE_URL?.trim();
  if (trimmed === undefined || trimmed === '') return DEFAULT_SITE_BASE_URL;
  return trimmed.replace(/\/+$/, '');
}
