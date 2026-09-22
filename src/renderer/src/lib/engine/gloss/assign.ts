/**
 * 悬浮卡里挑中一个词条 / 语素 / 切法之后怎么写进分析，勾了「同时改原文」时怎么换原文。
 * 语料与短语共用这一套：两边的「改」必须一个样子（纯函数，不碰界面状态）。
 */
import type { Analysis, Id, Project, Token } from '$lib/core/model'
import { analyzeToken, glossIndexFor, lexemeGloss, senseGloss } from './index'
import type { TokenizeOptions } from './tokens'
import { matchCase, replaceWordAt, wordAt, wordRangeOfToken } from './rewrite'

/** 挑中的词条、语素或一种切法（悬浮卡的 HoverChoice，这里只用得到这几项） */
export interface AssignChoice {
  lexemeId?: Id | null
  morphemeId?: Id | null
  analysis?: Analysis
  /** 挑的是这个词条的第几个义项；不写就用第一个 */
  senseIndex?: number | null
}

/** 一段带分析的原文：例句、短语都是这个样子（短语的分析是改过词才存下来的，可以没有） */
export interface AnalyzedText {
  languageId: Id
  text: string
  tokens?: Token[]
}

/** 分词的切法（整句分析、逐词写文字、改写原文共用一套） */
export function tokenizeOptionsFor(project: Project, languageId: Id): TokenizeOptions {
  return {
    mode: project.settings.tokenizer,
    pattern: project.settings.tokenizerPattern,
    letters:
      glossIndexFor(project, languageId).wordChars + (project.settings.tokenizerLetters ?? '')
  }
}

/** 脱掉响应式代理：写回去的分析得是一份自己的普通对象 */
function plain(a: Analysis): Analysis {
  return {
    ...a,
    ...(a.part ? { part: { ...a.part } } : {}),
    morphs: a.morphs.map((m) => ({ ...m }))
  }
}

/**
 * 把挑中的词条 / 语素 / 切法写进这个词的分析：整个词（index 为 null）写一条新分析并选中，
 * 切分里的一段只改那一段。什么都没挑中返回 false。
 */
export function writeChoice(
  project: Project,
  tk: Token,
  index: number | null,
  c: AssignChoice
): boolean {
  const glossLangs = project.settings.glossLanguages
  // 挑了一种切法：整个词换成它，或者把没找到的那一段拆成这几段
  if (c.analysis) {
    const picked: Analysis = {
      lexemeId: c.analysis.lexemeId,
      slot: c.analysis.slot,
      morphs: c.analysis.morphs
    }
    const cur = tk.analyses[tk.chosen]
    if (index === null || !cur?.morphs[index]) {
      tk.analyses.push(picked)
      tk.chosen = tk.analyses.length - 1
    } else {
      tk.analyses[tk.chosen] = {
        lexemeId: cur.lexemeId ?? picked.lexemeId,
        slot: cur.slot,
        morphs: [...cur.morphs.slice(0, index), ...picked.morphs, ...cur.morphs.slice(index + 1)]
      }
    }
    if (!tk.analyses[tk.chosen].morphs.some((x) => !x.gloss || x.gloss === '?')) tk.confirmed = true
    return true
  }
  const l = c.lexemeId ? project.lexemes.find((x) => x.id === c.lexemeId) : undefined
  const m = c.morphemeId ? project.morphemes.find((x) => x.id === c.morphemeId) : undefined
  if (!l && !m) return false
  const gloss = l
    ? (c.senseIndex != null ? senseGloss(l, c.senseIndex, glossLangs) : '') ||
      lexemeGloss(l, glossLangs)
    : m!.gloss || Object.values(m!.meaning).find(Boolean) || m!.form
  const cur = tk.analyses[tk.chosen]
  if (index === null || !cur?.morphs[index]) {
    tk.analyses.push({
      lexemeId: l?.id ?? null,
      slot: null,
      morphs: [{ form: tk.surface, gloss, morphemeId: m?.id ?? null, lexemeId: l?.id ?? null }]
    })
    tk.chosen = tk.analyses.length - 1
  } else {
    tk.analyses[tk.chosen] = {
      lexemeId: cur.lexemeId ?? l?.id ?? null,
      slot: cur.slot,
      morphs: cur.morphs.map((x, i) =>
        i === index ? { ...x, gloss, morphemeId: m?.id ?? null, lexemeId: l?.id ?? null } : x
      )
    }
  }
  if (!tk.analyses[tk.chosen].morphs.some((x) => !x.gloss || x.gloss === '?')) tk.confirmed = true
  return true
}

/** 这条分析里这个词该写成什么样：指着屈折形就用屈折形，否则用词头；切分与语素不改原文 */
export function analysisSpelling(project: Project, a: Analysis | undefined): string {
  if (!a || !a.lexemeId || a.morphs.length > 1) return ''
  const l = project.lexemes.find((x) => x.id === a.lexemeId)
  if (!l) return ''
  const form = a.slot ? (l.forms[a.slot]?.surface ?? '').trim().replace(/^\*/, '') : ''
  return form || l.lemma
}

/**
 * 勾了「同时改原文」：把原文里这一处（按位置，同一段里别处的同一个词不动）换成挑中词条的写法，
 * 再按新写法重新分析这个词——刚挑的那条仍排在头一个、仍是确认过的。改动了返回 true。
 */
export function rewriteWordInText(project: Project, s: AnalyzedText, at: number): boolean {
  const tokens = s.tokens
  const tk = tokens?.[at]
  const spelling = analysisSpelling(project, tk?.analyses[tk.chosen])
  if (!tokens || !tk || !spelling) return false
  const range = wordRangeOfToken(
    tokens.map((x) => x.surface),
    at
  )
  if (!range) return false
  const opts = tokenizeOptionsFor(project, s.languageId)
  // 原文里这个位置对不上这个词（自定义分词、原文刚改过）：宁可不动原文
  if (wordAt(s.text, range.index, opts, range.count) !== tk.surface) return false
  const next = replaceWordAt(s.text, range.index, spelling, opts, range.count)
  if (next === s.text) return false
  s.text = next
  tk.surface = matchCase(tk.surface, spelling)
  // 分析里的形式跟着新写法走，另外把按新写法分出来的几种排在后面备选
  const cur = tk.analyses[tk.chosen] ? plain(tk.analyses[tk.chosen]) : null
  if (cur && cur.morphs.length === 1) cur.morphs[0].form = tk.surface
  const fresh = analyzeToken(
    glossIndexFor(project, s.languageId),
    tk.surface,
    project.settings.morphemeBoundaries
  )
  // 跟刚挑的那条一样的（词条、槽位、每一段的形式与 gloss 都一样）不再重复列一遍
  const same = (a: Analysis): boolean =>
    !!cur &&
    a.lexemeId === cur.lexemeId &&
    a.slot === cur.slot &&
    a.morphs.length === cur.morphs.length &&
    a.morphs.every((m, i) => m.form === cur.morphs[i].form && m.gloss === cur.morphs[i].gloss)
  tk.analyses = cur ? [cur, ...fresh.filter((a) => !same(a))] : fresh
  tk.chosen = 0
  return true
}
