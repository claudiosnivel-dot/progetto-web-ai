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

// (deploy pass) — ALLOWLIST DEI SIGNUP: gli indirizzi email autorizzati a registrarsi
// nel pre-lancio (il muro applicativo). SIGNUP_ALLOWLIST e' una lista separata da
// virgole (config, non un segreto: sono indirizzi, non credenziali). Qui si NORMALIZZA
// una volta sola (split, trim, lowercase, scarto dei vuoti) cosi' che la policy pura
// `isSignupAllowed` (domain) confronti per uguaglianza esatta su valori gia' puliti.
// Assente/vuota => `[]` => registrazioni aperte in sviluppo (in produzione
// assertProductionEnv esige che sia non vuota: prod = muro armato).
export function getSignupAllowlist(source: Record<string, string | undefined> = process.env): string[] {
  const raw = source.SIGNUP_ALLOWLIST;
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

// (deploy pass) — GATE FAIL-FAST DELLA CONFIG DI PRODUZIONE. In sviluppo bastano i
// default locali (loadEnv copre le 3 chiavi Supabase); in PRODUZIONE alcune variabili
// sono critiche e la loro assenza NON deve emergere a meta' richiesta ma al BOOT
// (src/instrumentation.ts la invoca quando NODE_ENV === 'production'). Raccoglie TUTTI
// i problemi e lancia un solo errore che li nomina — mai un valore segreto nel messaggio
// (i valori nominati qui sono URL/nomi di variabile pubblici, non credenziali).
//
// Requisiti di produzione (oltre alle 3 chiavi Supabase di loadEnv):
//  - ANTHROPIC_API_KEY: la generazione dei mockup non funziona senza (in dev il boot puo'
//    riuscire anche senza LLM, ma un deploy pubblico che genera siti la esige);
//  - NEXT_PUBLIC_SITE_URL: deve essere un URL https PUBBLICO (canonical/OG assoluti) — mai
//    il default localhost, che in produzione romperebbe SEO e link;
//  - SIGNUP_ALLOWLIST: il muro dei signup DEVE essere armato (non vuota) — altrimenti il
//    deploy pre-lancio accetterebbe registrazioni da chiunque.
export function assertProductionEnv(source: Record<string, string | undefined> = process.env): void {
  const problems: string[] = [];

  // Le 3 chiavi Supabase: riusa la semantica di loadEnv (assente/whitespace = mancante).
  try {
    loadEnv(source);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  const anthropic = source.ANTHROPIC_API_KEY;
  if (anthropic === undefined || anthropic.trim() === '') {
    problems.push('ANTHROPIC_API_KEY (assente)');
  }

  const siteUrl = source.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl === undefined || siteUrl === '') {
    problems.push('NEXT_PUBLIC_SITE_URL (assente)');
  } else if (!/^https:\/\//i.test(siteUrl) || /localhost|127\.0\.0\.1/i.test(siteUrl)) {
    problems.push(`NEXT_PUBLIC_SITE_URL (deve essere un URL https pubblico, trovato "${siteUrl}")`);
  }

  if (getSignupAllowlist(source).length === 0) {
    problems.push('SIGNUP_ALLOWLIST (il muro dei signup deve essere armato in produzione: nessun indirizzo autorizzato)');
  }

  if (problems.length > 0) {
    throw new Error(`Configurazione di produzione incompleta: ${problems.join(' ; ')}`);
  }
}

// (deploy pass) T-4 — CAP GIORNALIERO delle generazioni: la cintura di COSTO a livello app,
// oltre lo spending limit di Anthropic (il freno hard). Config pubblica, non un segreto.
// GENERATION_DAILY_CAP assente => default; un intero >= 0 valido => quel valore (0 = pausa totale,
// scelta legittima dell'amministratore); qualunque altra cosa (negativo, non-numero) => default,
// cosi' un valore storto non spalanca ne blocca per sbaglio.
const DEFAULT_DAILY_GENERATION_CAP = 20;

export function getDailyGenerationCap(source: Record<string, string | undefined> = process.env): number {
  const raw = source.GENERATION_DAILY_CAP?.trim();
  if (raw === undefined || raw === '') return DEFAULT_DAILY_GENERATION_CAP;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_DAILY_GENERATION_CAP;
}
