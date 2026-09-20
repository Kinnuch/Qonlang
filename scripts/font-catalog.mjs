/**
 * 把字体库目录（family / file / url / 预览文字）导出成 JSON，给 make-font-previews.py 用。
 * 目录本身是 TypeScript，这里用 esbuild 转一下再读。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmp = join(mkdtempSync(join(tmpdir(), 'qnl-fonts-')), 'presets.mjs')
execFileSync(
  'npx',
  [
    'esbuild',
    join(root, 'src/renderer/src/lib/skin/presets.ts'),
    '--format=esm',
    `--outfile=${tmp}`,
    '--log-level=error'
  ],
  { cwd: root, shell: process.platform === 'win32' }
)
const { FONT_CATALOG, fontSample } = await import(pathToFileURL(tmp).href)
const out = FONT_CATALOG.map((f) => ({
  family: f.family,
  file: f.file,
  url: f.url,
  builtin: !!f.builtin,
  sample: fontSample(f)
}))
const dest = join(root, 'scripts/.font-catalog.json')
writeFileSync(dest, JSON.stringify(out, null, 1) + '\n')
console.log(`写好 ${dest}：${out.length} 款`)
console.log(readFileSync(dest, 'utf8').slice(0, 160))
