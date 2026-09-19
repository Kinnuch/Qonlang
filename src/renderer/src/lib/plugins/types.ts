/**
 * 插件对外的类型：写插件的人按这里的形状写。
 * 插件跟应用同权限跑（`qnlplugin://` 协议加载的 ES 模块），能力大，装别人的插件前先看代码。
 */
import type { Id, Lexeme, Project } from '$lib/core/model'
import type { SlotDef } from '$lib/engine/morph'

/** plugins/<目录>/plugin.json */
export interface PluginManifest {
  /** 唯一标识，只能用小写字母、数字和连字符 */
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  /** 入口文件，默认 index.js */
  main?: string
  /** 这个插件要求的千语集最低版本（写了就检查） */
  minAppVersion?: string
}

/** 插件在磁盘上的样子 */
export interface InstalledPlugin {
  manifest: PluginManifest
  /** 插件目录名 */
  dir: string
  /** 用户有没有关掉它 */
  enabled: boolean
  /** 载入时出的错（有就不算载入成功） */
  error?: string
  /** 已经载入并 activate 过 */
  loaded: boolean
}

// ───────────────────────── 扩展点 ─────────────────────────

/** 面板 / 页面：拿到一个 DOM 节点自己画，卸载时调 dispose */
export interface PluginView {
  id: string
  title: string
  /** 画在哪：inspector = 检视器里多一块，page = 左侧导航多一页 */
  where?: 'inspector' | 'page'
  /** 只在这几个模块里出现（where 为 inspector 时有用）；不写就处处都有 */
  sections?: string[]
  /** 导航里的图标（一个字或 emoji；不写用插件名首字） */
  icon?: string
  render: (el: HTMLElement, ctx: PluginViewContext) => void | (() => void)
}

export interface PluginViewContext {
  /** 当前项目（只读着看；要改走 api.edit） */
  project: Project | null
  /** 顶栏的当前语言 */
  languageId: Id | null
  /** 眼下在哪个模块 */
  section: string
  /** 检视器里选中的词条（词库页才有） */
  lexeme: Lexeme | null
}

/** 命令：出现在 Ctrl+K 命令面板里 */
export interface PluginCommand {
  id: string
  title: string
  /** 说明，显示在标题右边 */
  detail?: string
  run: () => void | Promise<void>
}

/** 导入：把文件内容变成对项目的改动 */
export interface PluginImporter {
  id: string
  name: string
  /** 认哪些后缀，如 ['.dict', '.csv'] */
  extensions: string[]
  run: (text: string, ctx: PluginIoContext) => void | Promise<void>
}

/** 导出：把项目变成一段文本（外层负责让用户挑存到哪） */
export interface PluginExporter {
  id: string
  name: string
  /** 默认文件名后缀，如 '.txt' */
  extension?: string
  run: (ctx: PluginIoContext) => string | Promise<string>
}

export interface PluginIoContext {
  project: Project
  languageId: Id | null
  edit: (fn: (p: Project) => void) => void
}

/** 生成器：构形的槽位可以选「插件 · 名字」，由插件算出这一格的形式 */
export interface PluginGenerator {
  id: string
  name: string
  run: (ctx: PluginGeneratorContext) => string
}

export interface PluginGeneratorContext {
  project: Project
  lexeme: Lexeme
  /** 这一格是哪几个取值 */
  slot: SlotDef
  /** 词干（构形里挑的那个，没有就是词头） */
  stem: string
}

/** 插件模块的默认导出（也可以什么都不导出，直接在模块里调全局 qonlang） */
export interface PluginModule {
  activate?: (api: unknown) => void | Promise<void>
  deactivate?: () => void
}
