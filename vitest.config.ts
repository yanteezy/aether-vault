import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

// Unit tests run in the browser mode of the app (no Tauri): jsdom gives window / localStorage,
// fake-indexeddb gives the photo store. Desktop-only code is tested with vi.mock('@tauri-apps/api/core').
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  }),
)
