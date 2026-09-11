import { FONT_VARS, SKIN_VARS, type Skin } from './presets'
import { scriptFontVar } from '$lib/script/fonts'

/** 上一次写上去的按文字字体变量，换皮肤时先清掉 */
let scriptVars: string[] = []
const quoteFamily = (v: string): string => (/[,'"]/.test(v) ? v : `"${v.replace(/"/g, '')}"`)

/** 把皮肤写到 <html> 的内联样式上（内联优先级高于主题选择器） */
export function applySkin(skin: Skin, theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  const st = document.documentElement.style
  for (const v of SKIN_VARS) st.removeProperty(v.name)
  for (const name of Object.values(FONT_VARS)) st.removeProperty(name)
  const vars = theme === 'dark' ? skin.dark : skin.light
  for (const [k, v] of Object.entries(vars ?? {})) if (v) st.setProperty(k, v)
  for (const [slot, name] of Object.entries(FONT_VARS) as [keyof Skin['fonts'], string][]) {
    const v = skin.fonts?.[slot]
    if (v && v.trim()) st.setProperty(name, v)
  }
  for (const name of scriptVars) st.removeProperty(name)
  scriptVars = []
  for (const [id, v] of Object.entries(skin.scriptFonts ?? {})) {
    if (!v || !v.trim()) continue
    const name = scriptFontVar(id)
    st.setProperty(name, quoteFamily(v.trim()))
    scriptVars.push(name)
  }
}
