/**
 * 繁體中文文案：从 zh.ts 机器转换（OpenCC s2twp，台湾用词）生成 zh-Hant.ts。
 * 中文改了就重新跑一次：`npm run i18n:hant`（需要 python 的 opencc-python-reimplemented）。
 * 生成的文件别手改——结构、注释跟 zh.ts 一样，只有字符串值换成了繁体。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const i18n = join(root, 'src/renderer/src/lib/i18n')
const tmp = mkdtempSync(join(tmpdir(), 'qnl-hant-'))
const flatZh = join(tmp, 'zh.json')
const flatHant = join(tmp, 'hant.json')
const values = join(root, 'scripts/i18n-values.mjs')
const node = process.execPath

execFileSync(node, [values, 'dump', join(i18n, 'zh.ts'), flatZh], { stdio: 'inherit' })

const py = `
import io, json, opencc
c = opencc.OpenCC('s2twp')
src = json.load(io.open(r'${flatZh}', encoding='utf-8'))
out = {k: c.convert(v) for k, v in src.items()}
io.open(r'${flatHant}', 'w', encoding='utf-8', newline='\\n').write(json.dumps(out, ensure_ascii=False, indent=1))
print('转换', len(out), '条')
`
execFileSync('python', ['-c', py], { stdio: 'inherit' })

const dest = join(i18n, 'zh-Hant.ts')
execFileSync(node, [values, 'derive', join(i18n, 'zh.ts'), flatHant, dest], { stdio: 'inherit' })

const head = `/**
 * 繁體中文：由 zh.ts 機器轉換而來（OpenCC s2twp），別手改這個檔案——
 * 改了下次重新生成就沒了。要改先改 zh.ts，再跑 \`npm run i18n:hant\`。
 */
`
writeFileSync(dest, head + readFileSync(dest, 'utf8'))
console.log('写好', dest)
