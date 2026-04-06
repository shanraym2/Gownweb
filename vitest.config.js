// vitest.config.js
// Place this in your project root alongside package.json

import { defineConfig } from 'vitest/config'
import path from 'path'

// Your Next.js source files live inside app/
// Tests live at the root in tests/
// So `../utils/recommender/foo` from tests/ resolves to app/utils/recommender/foo
const APP = path.resolve(__dirname, 'app')

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'app/utils/recommender/**',
        'app/hooks/useRecommendations.js',
      ],
      thresholds: {
        lines:      80,
        functions:  80,
        branches:   75,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: [
      // `@/foo` → app/foo  (matches your Next.js tsconfig paths)
      { find: '@', replacement: APP },
      // `../utils/foo` from tests/ → app/utils/foo
      { find: /^\.\.\/utils\/(.*)/, replacement: `${APP}/utils/$1` },
      // `../hooks/foo` from tests/ → app/hooks/foo
      { find: /^\.\.\/hooks\/(.*)/, replacement: `${APP}/hooks/$1` },
    ],
  },
})