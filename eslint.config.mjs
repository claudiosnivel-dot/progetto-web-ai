import tseslint from 'typescript-eslint';

// Config ESLint flat (ESLint 9). Il linting mira a src/ e tests/.
// La regola no-restricted-imports impedisce di importare il client service_role
// (supabase-admin) fuori dai moduli server designati in src/data/** (R7 / A01:2025).
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
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/data/supabase-admin',
              message:
                'Il client service_role (supabase-admin) bypassa la RLS: importalo solo dai moduli server designati in src/data/**.',
            },
          ],
          patterns: [
            {
              group: ['**/data/supabase-admin', '**/supabase-admin'],
              message:
                'Il client service_role (supabase-admin) bypassa la RLS: importalo solo dai moduli server designati in src/data/**.',
            },
          ],
        },
      ],
    },
  },
  {
    // Moduli server designati e helper di test: possono importare il client admin.
    files: ['src/data/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
