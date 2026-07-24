import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, getAnthropicOnboardingModel } from '@/config/env';

// T-131 (macrotask ai-onboarding, P1) — confine UNICO con l'LLM: tutta la parte
// non deterministica del prodotto passa da qui. Vive solo server-side
// ("server-only" fa fallire il build se importato da un contesto client, e una
// regola ESLint vieta l'import da src/ui/**). Nessun segreto nel sorgente:
// chiave e modello arrivano dagli accessor di config/env (T-130).
// Il client e' un parametro iniettabile: i test passano un doppio e gli oracoli
// restano deterministici.

// Superficie minima del client SDK usata dal confine: e' il seam di mock.
type OnboardingLlmClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
};

// Budget di output di un turno di intervista (max_tokens e' obbligatorio nella request).
const ONBOARDING_MAX_TOKENS = 2048;

// Il client reale nasce alla PRIMA chiamata, non all'import: importare questo
// modulo senza il segreto configurato non deve lanciare (lo fa solo chi lo usa).
let realClient: OnboardingLlmClient | undefined;

function getRealClient(): OnboardingLlmClient {
  realClient ??= new Anthropic({ apiKey: getAnthropicApiKey() });
  return realClient;
}

/**
 * Esegue un turno dell'intervista di onboarding sul modello configurato.
 * @param turn system prompt, messaggi della conversazione e tool dichiarati.
 * @param client client SDK — iniettabile nei test; default: quello reale (lazy).
 */
export function runOnboardingTurn(
  turn: {
    system: string;
    messages: Anthropic.MessageParam[];
    tools: Anthropic.ToolUnion[];
  },
  client: OnboardingLlmClient = getRealClient(),
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: getAnthropicOnboardingModel(),
    max_tokens: ONBOARDING_MAX_TOKENS,
    system: turn.system,
    messages: turn.messages,
    tools: turn.tools,
  });
}
