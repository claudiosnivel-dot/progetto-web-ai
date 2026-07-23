import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 20000,
    setupFiles: ['tests/setup.env.ts'],
    // next-intl (ESM in node_modules) importa il bare specifier "next/server";
    // Next non dichiara "exports", quindi va inlinato per passare dal resolver
    // di Vite (che aggiunge .js) invece del loader esterno di vitest.
    server: {
      deps: {
        inline: ['next-intl'],
      },
    },
  },
});
