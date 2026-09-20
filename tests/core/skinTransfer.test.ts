/** 皮肤的导出与导入：记号、版本、只收认得的字段；字体库预览文字按标签挑 */
import { describe, it, expect } from 'vitest'
import { exportSkinFile, parseSkinFile, SKIN_FILE_MARK } from '$lib/skin/transfer'
import {
  FONT_CATALOG,
  fontSample,
  FONT_SAMPLE_CJK,
  FONT_SAMPLE_LATIN,
  type Skin
} from '$lib/skin/presets'

const IMG = 'data:image/webp;base64,AAAA'

function makeSkin(): Skin {
  return {
    preset: 'custom',
    light: { '--bg': '#ffffff', '--accent': '#0e9f8a' },
    dark: { '--bg': '#111111' },
    fonts: {
      ui: 'Inter',
      data: '',
      mono: '',
      corpusText: '',
      corpusTr: '',
      gloss: '',
      script: ''
    },
    mirror: 'https://example.invalid/',
    scriptFonts: { sc1: 'Andika' },
    background: {
      image: IMG,
      width: 800,
      height: 600,
      fit: 'tile',
      opacity: 0.3,
      scale: 1.5,
      blur: 2,
      position: 'top'
    }
  }
}

describe('皮肤文件', () => {
  it('导出带记号和版本号，镜像不跟着走', () => {
    const o = JSON.parse(exportSkinFile(makeSkin(), { name: '我的皮肤', withBackground: false }))
    expect(o[SKIN_FILE_MARK]).toBe(1)
    expect(o.name).toBe('我的皮肤')
    expect(o.skin.light['--bg']).toBe('#ffffff')
    expect(o.skin.fonts.ui).toBe('Inter')
    expect(o.skin.scriptFonts.sc1).toBe('Andika')
    expect('mirror' in o.skin).toBe(false)
  })

  it('背景图按选择带或不带', () => {
    const without = exportSkinFile(makeSkin(), { name: 'a', withBackground: false })
    expect(without.includes(IMG)).toBe(false)
    const with_ = exportSkinFile(makeSkin(), { name: 'a', withBackground: true })
    expect(JSON.parse(with_).skin.background.image).toBe(IMG)
  })

  it('导出的能原样读回来', () => {
    const r = parseSkinFile(exportSkinFile(makeSkin(), { name: '我的皮肤', withBackground: true }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.name).toBe('我的皮肤')
    expect(r.hasBackground).toBe(true)
    expect(r.skin.dark['--bg']).toBe('#111111')
    expect(r.skin.background?.fit).toBe('tile')
    expect(r.skin.background?.scale).toBe(1.5)
  })

  it('不是皮肤文件、版本太新都不收', () => {
    expect(parseSkinFile('不是 JSON')).toEqual({ ok: false, reason: 'format' })
    expect(parseSkinFile('{"a":1}')).toEqual({ ok: false, reason: 'format' })
    expect(parseSkinFile(`{"${SKIN_FILE_MARK}":99}`)).toEqual({ ok: false, reason: 'version' })
  })

  it('认不得的变量、槽位、外链背景图都丢掉', () => {
    const r = parseSkinFile(
      JSON.stringify({
        [SKIN_FILE_MARK]: 1,
        name: 'x',
        skin: {
          light: { '--bg': '#fff', '--evil': 'red' },
          fonts: { ui: 'Inter', nope: 'Evil' },
          background: { image: 'https://example.invalid/a.png' }
        }
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.keys(r.skin.light)).toEqual(['--bg'])
    expect('nope' in r.skin.fonts).toBe(false)
    expect(r.hasBackground).toBe(false)
    expect(r.skin.background).toBeUndefined()
  })
})

describe('字体库的预览文字', () => {
  it('拉丁字体只写拉丁句', () => {
    expect(fontSample({ tags: ['latin', 'serif'] })).toBe(FONT_SAMPLE_LATIN)
    expect(fontSample({ tags: [] })).toBe(FONT_SAMPLE_LATIN)
  })

  it('覆盖汉字的再带一小段汉字', () => {
    expect(fontSample({ tags: ['cjk', 'kai'] })).toBe(FONT_SAMPLE_LATIN + ' ' + FONT_SAMPLE_CJK)
  })

  it('没有拉丁字形的文字块 / 符号字体：条目自己写了预览就用它，没写才空着', () => {
    expect(fontSample({ tags: ['script'] })).toBe('')
    expect(fontSample({ tags: ['symbols'] })).toBe('')
    expect(fontSample({ tags: ['script'], sample: 'ᚦᛖ' })).toBe('ᚦᛖ')
  })

  it('目录里没有拉丁字形的字体都写了自己的预览', () => {
    for (const f of FONT_CATALOG)
      if (f.tags.includes('script') || f.tags.includes('symbols'))
        expect(fontSample(f), f.family).not.toBe('')
  })
})
