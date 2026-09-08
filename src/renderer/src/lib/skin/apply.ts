import { FONT_VARS, SKIN_VARS, type Skin } from './presets'

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
}
