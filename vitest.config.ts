import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // "server-only" lancia all'import fuori dalla condizione react-server di
      // Next: nei test lo risolviamo al suo empty.js, lo stesso file che Next
      // usa in quella condizione. Solo infrastruttura di test: la guardia di
      // build resta intatta nei moduli server (src/data/**).
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // DB LOCALE CONDIVISO: i test d'integrazione (RLS runtime) girano tutti
    // contro un'unica Supabase locale. Il canary di T-407 (public-serving)
    // allarga per un istante una policy GLOBALE di tabella (ALTER POLICY anon
    // USING(true)) e la ripristina: in parallelo quella finestra andrebbe in
    // gara con le letture anon di altri file (T-401/T-404) → falso rosso
    // non-deterministico. Serializziamo i FILE (un file per volta): nessuna
    // gara su stato globale del DB, checkpoint deterministico. Costo: suite
    // più lenta, accettabile per una run di checkpoint su stato pulito.
    fileParallelism: false,
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
