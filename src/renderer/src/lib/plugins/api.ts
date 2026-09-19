/**
 * 给插件用的 API：`window.qonlang`，也会作为参数传给模块的 activate(api)。
 * 插件跟应用同权限跑，这里只是把常用的东西整理成稳定的形状——
 * 直接去翻内部模块也能做到，但那些随版本会变，这一层不会。
 */
import type { Id, Lexeme, Project } from '$lib/core/model'
import { createLexeme, createSentence, newId } from '$lib/core/factory'
import { projectState } from '$lib/state/project.svelte'
import { ui } from '$lib/state/ui.svelte'
import { parseQuery, matchQuery } from '$lib/core/query'
import { parseRuleText } from '$lib/engine/sca/parse'
import { runRules } from '$lib/engine/sca/apply'
import { languageParseOptions } from '$lib/engine/phon'
import { analyzeSentence, interlinear } from '$lib/engine/gloss'
import { generateForm, makeContext, paradigmsFor, paradigmSlots } from '$lib/engine/morph'
import { pluginRegistry } from './registry.svelte'
import type {
  PluginCommand,
  PluginExporter,
  PluginGenerator,
  PluginImporter,
  PluginView
} from './types'

/** 版本号：插件可以据此判断能不能用某个功能 */
export const PLUGIN_API_VERSION = 1

function need(): Project {
  const p = projectState.project
  if (!p) throw new Error('还没有打开项目')
  return p
}

export function makePluginApi(pluginId: string): Record<string, unknown> {
  const api = {
    /** 这套 API 的版本（加了新东西就 +1） */
    apiVersion: PLUGIN_API_VERSION,
    pluginId,

    // ── 项目 ──
    get project(): Project | null {
      return projectState.project
    },
    get languageId(): Id | null {
      return projectState.currentLanguageId
    },
    /** 改项目：改完自动记进撤销栈、标记未保存 */
    edit(fn: (p: Project) => void): void {
      fn(need())
      projectState.touch()
    },
    save(): Promise<unknown> {
      return projectState.save()
    },

    // ── 词库 ──
    lexicon: {
      /** 按顶栏那套搜索语法找词条 */
      search(query: string, opts: { languageId?: Id | null; limit?: number } = {}): Lexeme[] {
        const p = need()
        const lang = opts.languageId ?? null
        const pq = parseQuery(query || '')
        const out: Lexeme[] = []
        const limit = Math.min(opts.limit ?? 50, 500)
        for (const l of p.lexemes) {
          if (lang && l.languageId !== lang) continue
          if (
            pq.terms.length &&
            !matchQuery(pq, () => [
              l.lemma,
              ...l.senses.flatMap((s) => Object.values(s.definition)),
              ...l.tags
            ])
          )
            continue
          out.push(l)
          if (out.length >= limit) break
        }
        return out
      },
      get(id: Id): Lexeme | null {
        return need().lexemes.find((l) => l.id === id) ?? null
      },
      add(init: { languageId?: Id; lemma: string; definition?: string; lang?: string }): Lexeme {
        const p = need()
        const languageId = init.languageId ?? projectState.currentLanguageId ?? p.languages[0]?.id
        if (!languageId) throw new Error('项目里还没有语言')
        const l = createLexeme(languageId, init.lemma)
        if (init.definition)
          l.senses[0].definition = {
            [init.lang ?? p.settings.glossLanguages[0] ?? 'zh']: init.definition
          }
        p.lexemes.push(l)
        projectState.touch()
        return l
      },
      /** 这个词按构形推出来的全部形式（只算，不写进词条） */
      forms(lexeme: Lexeme): { slot: string; form: string }[] {
        const p = need()
        const lang = p.languages.find((x) => x.id === lexeme.languageId)
        if (!lang) return []
        const ctx = makeContext(p, lang)
        const out: { slot: string; form: string }[] = []
        for (const lp of paradigmsFor(p, lexeme))
          for (const slot of paradigmSlots(lp.paradigm, p.categories, p.settings.glossLanguages)) {
            const g = generateForm(ctx, lexeme, lp.paradigm, slot, lp.variantId)
            if (g?.surface) out.push({ slot: slot.label, form: g.surface })
          }
        return out
      }
    },

    // ── 音变 ──
    sounds: {
      /** 跑一套音变：给词，返回每个阶段的形式 */
      run(
        words: string[],
        opts: { ruleSetId?: Id; ruleSetName?: string; from?: string; to?: string } = {}
      ): { word: string; output: string; stages: { name: string; form: string }[] }[] {
        const p = need()
        const rs = opts.ruleSetId
          ? p.ruleSets.find((r) => r.id === opts.ruleSetId)
          : opts.ruleSetName
            ? p.ruleSets.find((r) => r.name === opts.ruleSetName)
            : p.ruleSets[0]
        if (!rs) throw new Error('找不到这套音变')
        const boundId = Object.values(rs.stageLanguages ?? {}).find((id) => !!id)
        const lang = p.languages.find((l) => l.id === (boundId ?? projectState.currentLanguageId))
        const program = parseRuleText(rs.text, languageParseOptions(lang, p))
        return words.map((w) => {
          const r = runRules(program, w, { startAt: opts.from, stopAt: opts.to })
          return { word: w, output: r.output, stages: r.stages.map((s) => ({ ...s })) }
        })
      }
    },

    // ── 语料 ──
    corpus: {
      /** 分析一句话（不写进项目） */
      analyze(text: string, languageId?: Id): { word: string; gloss: string }[] {
        const p = need()
        const lang = languageId ?? projectState.currentLanguageId ?? p.languages[0]?.id
        if (!lang) throw new Error('项目里还没有语言')
        const s = createSentence(lang)
        s.text = text
        analyzeSentence(p, s)
        const il = interlinear(p, s)
        return il.words.map((w) => ({ word: w.surface, gloss: w.gloss }))
      },
      /** 往语料里加一句并分析 */
      add(text: string, opts: { languageId?: Id; translation?: string; source?: string } = {}): Id {
        const p = need()
        const lang = opts.languageId ?? projectState.currentLanguageId ?? p.languages[0]?.id
        if (!lang) throw new Error('项目里还没有语言')
        const s = createSentence(lang)
        s.text = text
        if (opts.translation)
          s.translation = { [p.settings.glossLanguages[0] ?? 'zh']: opts.translation }
        if (opts.source) s.source = opts.source
        analyzeSentence(p, s)
        p.sentences.push(s)
        projectState.touch()
        return s.id
      }
    },

    // ── 界面 ──
    ui: {
      toast: (msg: string): void => void ui.toast(msg),
      error: (msg: string): void => void ui.error(msg),
      /** 跳到某个模块（'lexicon'、'corpus'…） */
      go: (section: string): void => {
        ui.section = section as typeof ui.section
      },
      /** 检视器里加一块，或左侧导航加一页 */
      addView: (v: PluginView): void => pluginRegistry.addView(pluginId, v)
    },

    // ── 扩展点 ──
    commands: {
      register: (c: PluginCommand): void => pluginRegistry.addCommand(pluginId, c)
    },
    io: {
      registerImporter: (i: PluginImporter): void => pluginRegistry.addImporter(pluginId, i),
      registerExporter: (e: PluginExporter): void => pluginRegistry.addExporter(pluginId, e)
    },
    rules: {
      /** 构形槽位里可以挑「插件 · 名字」，由这个函数算出形式 */
      registerGenerator: (g: PluginGenerator): void => pluginRegistry.addGenerator(pluginId, g)
    },

    // ── 小工具 ──
    util: { newId }
  }
  return api as unknown as Record<string, unknown>
}
