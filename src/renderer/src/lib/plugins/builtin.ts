/**
 * 自带插件：跟着软件一起发，不用去插件目录装，**设置里勾上才生效，默认一个都不开**。
 * 跟磁盘上的插件（`qnlplugin://` 载入的 ES 模块）不是一回事——这些就是软件自己的页面，
 * 只是做成可开可关的一块，不用的人界面上完全看不见。
 */
import type { Section } from '$lib/state/ui.svelte'

export interface BuiltinPlugin {
  id: string
  /** 名字与说明的文案键 */
  nameKey: string
  hintKey: string
  /** 开了之后在左侧导航里多出来的模块 */
  section: Section
}

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  {
    id: 'ui-translate',
    nameKey: 'uiTranslate.title',
    hintKey: 'uiTranslate.pluginHint',
    section: 'uiTranslate'
  }
]

export const builtinById = (id: string): BuiltinPlugin | undefined =>
  BUILTIN_PLUGINS.find((p) => p.id === id)
