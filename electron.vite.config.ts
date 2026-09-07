import { defineConfig } from 'electron-vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { $lib: resolve(__dirname, 'src/renderer/src/lib') }
    },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [svelte()]
  }
})
