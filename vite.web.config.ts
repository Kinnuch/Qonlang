/**
 * 网页版构建：同一套渲染层代码，不带 Electron。
 *   npm run dev:web    本地预览
 *   npm run build:web  输出到 dist/web
 */
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: { $lib: resolve(__dirname, 'src/renderer/src/lib') }
  },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [svelte()],
  build: {
    outDir: resolve(__dirname, 'dist/web'),
    emptyOutDir: true
  }
})
