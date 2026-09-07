import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: { $lib: resolve(__dirname, 'src/renderer/src/lib') }
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node'
  }
})
