import { describe, expect, it } from 'vitest'
import postcss from 'postcss'
import { resolve } from 'node:path'
import fontSizePostcss from '../../scripts/font-size-postcss.mjs'
import { fontSize, fontSizeMap, scriptFontSize, scriptFontScaleVar } from '$lib/skin/fontSizes'
import { exportSkinFile, parseSkinFile } from '$lib/skin/transfer'
import { DEFAULT_SKIN } from '$lib/skin/presets'

describe('主题字体字号', () => {
  it('旧偏好保持100%，子角色继承一个值，不连乘父倍率', () => {
    expect(fontSize({}, 'corpusText')).toBe(100)
    const skin = { fontSizes: { data: 150, mono: 125, ui: 200 } }
    expect(fontSize(skin, 'corpusText')).toBe(150)
    expect(fontSize(skin, 'script')).toBe(150)
    expect(fontSize(skin, 'gloss')).toBe(125)
    expect(fontSize(skin, 'corpusTr')).toBe(200)
    expect(fontSize({ fontSizes: { data: 150, corpusText: 100 } }, 'corpusText')).toBe(100)
    expect(scriptFontSize({ ...skin, scriptFontSizes: { a: 75 } }, 'a')).toBe(75)
    expect(scriptFontSize(skin, 'b')).toBe(150)
  })
  it('无效外部字号不导致文本消失，不同文字id不会变量碰撞', () => {
    expect(fontSizeMap({ ui: 0, data: 500, mono: '150', gloss: 125, unknown: 150 }, true)).toEqual({
      gloss: 125
    })
    expect(fontSizeMap({ scriptA: 100, scriptB: NaN })).toEqual({ scriptA: 100 })
    expect(scriptFontScaleVar('a-b')).not.toBe(scriptFontScaleVar('a_b'))
  })
  it('皮肤文件保留显式100%和单文字覆盖，旧文件仍可读取', () => {
    const skin = {
      ...structuredClone(DEFAULT_SKIN),
      fontSizes: { data: 150, corpusText: 100 },
      scriptFontSizes: { test: 125 }
    }
    const read = parseSkinFile(exportSkinFile(skin, { name: 'size', withBackground: false }))
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.skin.fontSizes).toEqual(skin.fontSizes)
      expect(read.skin.scriptFontSizes).toEqual(skin.scriptFontSizes)
    }
    const old = parseSkinFile(JSON.stringify({ qonlangSkin: 1, skin: { fonts: {} } }))
    expect(old.ok).toBe(true)
    if (old.ok) expect(fontSize(old.skin, 'ui')).toBe(100)
  })
  it('只转换应用绝对字号，角色切换只乘一次，布局、相对字和提示不改', async () => {
    const css =
      '.ui{font-family:var(--font-ui);font-size:14px;width:44px}.data{font-family:var(--font-data);font-size:15px}.nested{font-size:.8em}.bubble{font-size:12px}.example{font-size:calc(17px * var(--corpus-text-scale,1))}'
    const from = resolve('src/renderer/src/app.css')
    const output = await postcss([fontSizePostcss()]).process(css, { from })
    expect(output.css).toContain('--font-role-scale:var(--font-scale-data, 1)')
    expect(output.css).toContain('calc(15px * var(--font-role-scale, 1))')
    expect(output.css).toContain('width:44px')
    expect(output.css).toContain('font-size:.8em')
    expect(output.css).toContain('.bubble{font-size:12px}')
    expect(output.css).toContain(
      'calc(calc(17px * var(--corpus-text-scale,1)) * var(--font-role-scale, 1))'
    )
    const twice = await postcss([fontSizePostcss()]).process(output.css, { from })
    expect(twice.css).toBe(output.css)
    const external = await postcss([fontSizePostcss()]).process(css, {
      from: resolve('user-export.css')
    })
    expect(external.css).toBe(css)
  })
})
