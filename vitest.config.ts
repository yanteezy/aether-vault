import { configDefaults, defineConfig } from 'vitest/config'

// agents' git worktrees live under .claude/ and carry their own copy of the tests
export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.claude/**'] } })
