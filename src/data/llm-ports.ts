import { runOnboardingTurn } from '@/data/anthropic';
import type { OnboardingLlmPort } from '@/domain/onboarding/llm-port';
// Porta LLM di onboarding legata al confine reale (src/data/anthropic). Il dominio la
// riceve iniettata: qui, nel layer data, l'import del confine e' lecito. NON ri-esportare
// runOnboardingTurn (la guardia del confine pretende un solo modulo esportatore).
export const onboardingLlmPort: OnboardingLlmPort = runOnboardingTurn;
