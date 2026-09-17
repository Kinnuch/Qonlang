/**
 * 词条的历史形式链：从词源来源（祖语的形式、上一阶段的词条或语素）按音变规则集一路推到这个词，
 * 列出经过的每个阶段的形式，比如 PSkr *seuk̂rēn → PTsr sok̂ren → ATsr … → Tsr theusrin。
 * 只有规则集里从来源那一段到这个词那一段的每个阶段标记都绑了语言（或语言的某个阶段）时才给链；
 * 规则集怎么解析跟音变页一样（第一个绑了语言的阶段所属语言的音类、多合字母）。纯函数，不碰界面。
 */
import type { Id, Language, LanguageStage, Lexeme, Project, RuleSet } from './model'
import { findLanguageByName, splitSourceForm } from './etymology'
import { findStageByName, stageShort } from './languageTree'
import { languageParseOptions } from '$lib/engine/phon'
import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'

export interface HistoryStep {
  /** 阶段短名：阶段缩写 → 语言缩写 → 阶段标记名 */
  label: string
  /** 悬浮时的全名 */
  title: string
  form: string
}

export interface HistoryChain {
  ruleSetId: Id
  ruleSetName: string
  steps: HistoryStep[]
  /** 推到最后跟词库里的写法一样 */
  matches: boolean
}

const programs = new WeakMap<RuleSet, { key: string; program: RuleProgram }>()
function programOf(project: Project, rs: RuleSet): RuleProgram {
  const boundId = Object.values(rs.stageLanguages).find((id) => !!id)
  const base = project.languages.find((l) => l.id === boundId) ?? null
  const opts = languageParseOptions(base, project)
  const key = rs.text + '\n' + JSON.stringify(opts)
  const hit = programs.get(rs)
  if (hit?.key === key) return hit.program
  const program = parseRuleText(rs.text, opts)
  programs.set(rs, { key, program })
  return program
}

const loose = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[-=*·+\sˈˌ.]/g, '')
    .toLowerCase()

interface Origin {
  languageId: Id
  stageId: Id | null
  form: string
}

/** 词源来源落到哪门语言（哪个阶段）的什么形式 */
function originsOf(project: Project, l: Lexeme): Origin[] {
  const out: Origin[] = []
  for (const s of l.etymology.sources) {
    if (s.kind === 'lexeme') {
      const x = project.lexemes.find((y) => y.id === s.id)
      if (x) out.push({ languageId: x.languageId, stageId: x.stageId ?? null, form: x.lemma })
    } else if (s.kind === 'morpheme') {
      const x = project.morphemes.find((y) => y.id === s.id)
      if (x) out.push({ languageId: x.languageId, stageId: x.stageId ?? null, form: x.form })
    } else if (s.form.trim()) {
      const lang = findLanguageByName(project, s.language)
      if (lang) out.push({ languageId: lang.id, stageId: null, form: s.form })
      else {
        const st = findStageByName(project, s.language)
        if (st) out.push({ languageId: st.language.id, stageId: st.stage.id, form: s.form })
      }
    }
  }
  return out
}

export function historyChain(project: Project, lexeme: Lexeme): HistoryChain | null {
  const origins = originsOf(project, lexeme)
  if (!origins.length) return null
  const langById = new Map(project.languages.map((x) => [x.id, x]))
  for (const origin of origins) {
    const input = splitSourceForm(project, origin.form).join('') || origin.form.trim()
    if (!input) continue
    for (const rs of project.ruleSets) {
      let program: RuleProgram
      try {
        program = programOf(project, rs)
      } catch {
        continue
      }
      const markers = program.markers
      const bind = (
        m: string
      ): { lang: Language | undefined; stage: LanguageStage | undefined } => {
        const lang = langById.get(rs.stageLanguages[m] ?? '')
        const sid = rs.stageLanguageStages?.[m]
        return { lang, stage: sid ? lang?.stages?.find((s) => s.id === sid) : undefined }
      }
      const fits = (m: string, languageId: Id, stageId: Id | null, latest = false): boolean => {
        const b = bind(m)
        if (b.lang?.id !== languageId || !b.stage) return b.lang?.id === languageId
        if (stageId) return b.stage.id === stageId
        // 没记阶段的词条算最新阶段：只对得上那门语言最后一个阶段
        return !latest || b.stage.id === b.lang.stages?.[b.lang.stages.length - 1]?.id
      }
      const iFrom = markers.findIndex((m) => fits(m, origin.languageId, origin.stageId))
      if (iFrom < 0) continue
      const targets = markers
        .map((m, i) => ({ m, i }))
        .filter((x) => x.i > iFrom && fits(x.m, lexeme.languageId, lexeme.stageId ?? null, true))
      if (!targets.length) continue
      let run
      try {
        run = runRules(program, input, {
          startAt: iFrom === 0 ? undefined : markers[iFrom],
          trace: false
        })
      } catch {
        continue
      }
      const formAt = (m: string): string => run.stages.find((s) => s.name === m)?.form ?? ''
      const want = loose(lexeme.lemma)
      const chosen = targets.find((x) => loose(formAt(x.m)) === want) ?? targets[targets.length - 1]
      const span = markers.slice(iFrom, chosen.i + 1)
      // 中间每个阶段都得绑上语言，链才完整
      if (span.some((m) => !bind(m).lang)) continue
      const steps: HistoryStep[] = []
      span.forEach((m, k) => {
        const b = bind(m)
        let label = b.stage ? stageShort(b.stage) : b.lang?.abbr.trim() || m
        const title = [b.lang?.name, b.stage?.name].filter(Boolean).join(' · ') || m
        const form = k === 0 ? origin.form.trim() : formAt(m)
        const prev = steps[steps.length - 1]
        if (prev && prev.label === label) {
          // 同一阶段绑了两个标记：形式也一样就并掉，不一样的后一个用标记名区分（比如最后一步转写法）
          if (prev.form === form) return
          label = m
        }
        steps.push({ label, title, form })
      })
      return {
        ruleSetId: rs.id,
        ruleSetName: rs.name,
        steps,
        matches: loose(formAt(chosen.m)) === want
      }
    }
  }
  return null
}
