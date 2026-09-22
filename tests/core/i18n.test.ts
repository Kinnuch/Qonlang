/**
 * 界面里用到的每个 t('…') 键都得在中英两套文案里存在，两套结构也要一致。
 * （曾经漏过 lexicon.derivedWordsWords，界面上直接把键名印出来了。）
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import zh from '$lib/i18n/zh'
import en from '$lib/i18n/en'
import zhHant from '$lib/i18n/zh-Hant'
import ja from '$lib/i18n/ja'
import ko from '$lib/i18n/ko'
import fr from '$lib/i18n/fr'
import es from '$lib/i18n/es'
import ru from '$lib/i18n/ru'
import ar from '$lib/i18n/ar'
import { TOUR_STEPS } from '$lib/core/tourSteps'

type Dict = Record<string, unknown>

/** 除了中文之外的每一种：结构都要跟中文一模一样 */
const OTHERS: [string, Dict][] = [
  ['en', en as Dict],
  ['zh-Hant', zhHant as Dict],
  ['ja', ja as Dict],
  ['ko', ko as Dict],
  ['fr', fr as Dict],
  ['es', es as Dict],
  ['ru', ru as Dict],
  ['ar', ar as Dict]
]

const root = join(__dirname, '..', '..', 'src', 'renderer', 'src')

function get(dict: Dict, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Dict | undefined)?.[k], dict)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(svelte|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(root).filter((f) => !f.includes(join('lib', 'i18n')))

describe('i18n keys', () => {
  it('resolves every literal t() key in both locales', () => {
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const rel = f.slice(root.length + 1)
      for (const m of src.matchAll(/\bt\(\s*(['"`])([^'"`$]+?)\1/g)) {
        const key = m[2]
        // 不带点的多半不是文案键（比如 t(x) 之类），只有确实存在时才检查另一边
        if (!key.includes('.') && get(zh as Dict, key) === undefined) continue
        if (typeof get(zh as Dict, key) !== 'string' || typeof get(en as Dict, key) !== 'string')
          missing.push(`${rel}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('resolves the prefix of every templated t() key to a shared sub-object', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const rel = f.slice(root.length + 1)
      for (const m of src.matchAll(/\bt\(\s*`([^`]*\$\{[^`]*)`/g)) {
        const tpl = m[1]
        const prefix = tpl.slice(0, tpl.indexOf('${')).replace(/\.$/, '')
        if (!prefix) continue // 整个键都是变量，静态查不了
        const z = get(zh as Dict, prefix)
        const e = get(en as Dict, prefix)
        if (!z || !e || typeof z !== 'object' || typeof e !== 'object') {
          bad.push(`${rel}: ${tpl} → ${prefix}`)
          continue
        }
        const zk = Object.keys(z as Dict).sort()
        const ek = Object.keys(e as Dict).sort()
        if (JSON.stringify(zk) !== JSON.stringify(ek)) bad.push(`${rel}: ${prefix} 中英键不一致`)
      }
    }
    expect(bad).toEqual([])
  })

  // GuideLink 的 title 与 GuideTour 的标题都取 nav.<section>：漏了就把键名印在界面上
  it('resolves nav.<section> for every GuideLink', () => {
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const rel = f.slice(root.length + 1)
      for (const m of src.matchAll(/<GuideLink[^>]*section="([^"]+)"/g)) {
        const key = `nav.${m[1]}`
        if (typeof get(zh as Dict, key) !== 'string' || typeof get(en as Dict, key) !== 'string')
          missing.push(`${rel}: ${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  // 引导每一步的说明文案（气泡里那句）
  it('resolves nav and tour.steps for every guided section', () => {
    const missing: string[] = []
    for (const [section, steps] of Object.entries(TOUR_STEPS)) {
      for (const d of [zh, en])
        if (typeof get(d as Dict, `nav.${section}`) !== 'string') missing.push(`nav.${section}`)
      steps.forEach((_, i) => {
        const key = `tour.steps.${section}.${i}`
        for (const d of [zh, en]) if (typeof get(d as Dict, key) !== 'string') missing.push(key)
      })
    }
    expect([...new Set(missing)]).toEqual([])
  })

  it('keeps every locale structurally identical to zh', () => {
    const diff: string[] = []
    const compare = (a: Dict, b: Dict, path = ''): void => {
      for (const k of Object.keys(a)) {
        const p = path ? `${path}.${k}` : k
        const va = a[k]
        const vb = b[k]
        if (vb === undefined) diff.push(`缺: ${p}`)
        else if (typeof va === 'object' && va && typeof vb === 'object' && vb)
          compare(va as Dict, vb as Dict, p)
        else if (typeof va !== typeof vb) diff.push(`类型不同: ${p}`)
      }
    }
    for (const [name, d] of OTHERS) {
      const before = diff.length
      compare(zh as Dict, d)
      compare(d, zh as Dict)
      for (let i = before; i < diff.length; i++) diff[i] = `${name} ${diff[i]}`
    }
    expect([...new Set(diff)]).toEqual([])
  })
})
