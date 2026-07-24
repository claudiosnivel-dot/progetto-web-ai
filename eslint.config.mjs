import tseslint from 'typescript-eslint';

// Config ESLint flat (ESLint 9). Il linting mira a src/ e tests/.
// La regola no-restricted-imports impedisce di importare il client service_role
// (supabase-admin) fuori dai moduli server designati in src/data/** (R7 / A01:2025).
const supabaseAdminMessage =
  'Il client service_role (supabase-admin) bypassa la RLS: importalo solo dai moduli server designati in src/data/**.';

const supabaseAdminPaths = [{ name: '@/data/supabase-admin', message: supabaseAdminMessage }];
const supabaseAdminPatterns = [
  { group: ['**/data/supabase-admin', '**/supabase-admin'], message: supabaseAdminMessage },
];

// T-131 (P1): il confine LLM (src/data/anthropic) e server-only e usa la chiave
// Anthropic. In App Router un componente client puo' vivere ovunque sotto src/
// (src/app/**/page.tsx con 'use client', non solo src/ui/**): il percorso NON
// dice se un modulo finisce nel bundle del browser. Quindi si nega per default
// su tutto src/** e si riapre SOLO al layer che deve chiamarlo (src/domain/**,
// dove vive l'orchestrazione dell'intervista T-132) e ai moduli server di
// src/data/**. Un import accidentale lato client e' cosi' un errore di lint.
const anthropicBoundaryMessage =
  'Il confine LLM (src/data/anthropic) e server-only e usa il segreto Anthropic: non importarlo da codice client/browser.';

const anthropicBoundaryPaths = [{ name: '@/data/anthropic', message: anthropicBoundaryMessage }];
const anthropicBoundaryPatterns = [
  { group: ['**/data/anthropic'], message: anthropicBoundaryMessage },
];

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      '.trueline/**',
      'supabase/**',
      '*.config.*',
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Default: entrambi i confini privilegiati sono vietati ovunque sotto src/.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...supabaseAdminPaths, ...anthropicBoundaryPaths],
          patterns: [...supabaseAdminPatterns, ...anthropicBoundaryPatterns],
        },
      ],
    },
  },
  {
    // Layer di dominio (server): puo' chiamare il confine LLM — l'orchestrazione
    // dell'intervista (T-132) lo richiede — ma NON il client service_role.
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: supabaseAdminPaths, patterns: supabaseAdminPatterns },
      ],
    },
  },
  {
    // Moduli server designati e helper di test: possono importare entrambi.
    files: ['src/data/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
