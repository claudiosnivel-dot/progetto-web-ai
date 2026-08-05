import type Anthropic from '@anthropic-ai/sdk';
// Porta LLM di onboarding: il DOMINIO la riceve come argomento (dependency inversion),
// cosi' non importa il confine server-only @/data/anthropic. Firma = primo argomento di
// runOnboardingTurn; il client reale (lazy) e' incapsulato dal provider in src/data.
export type OnboardingLlmPort = (turn: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.ToolUnion[];
}) => Promise<Anthropic.Message>;
