/**
 * 引擎里的报错、提示与构形推导的轨迹都用中文写（测试、MCP 都按原文认，引擎不碰界面语言）。
 * 显示到界面上时按句式认出是哪一条、取出里面的名字，交给界面文案的 ruleMsg.* / traceMsg.* 按界面语言写出来；
 * 认不出的原样显示。新加一种报错、轨迹时在这里补一条句式，再在 zh.ts 里补一条同样的文案（测试会核对中文写回来一字不差）。
 */

export interface EnginePattern {
  /** 文案键（ruleMsg.<key> 或 traceMsg.<key>） */
  key: string
  re: RegExp
  /** 这几个参数本身也是一条报错，先翻它 */
  nested?: string[]
  /** 这几个参数是「微调」这类步骤名，按 traceMsg.label* 翻 */
  labels?: string[]
}

/** 规则（音变、正字法、文字映射、重音、构形微调）的报错与提示 */
export const RULE_PATTERNS: EnginePattern[] = [
  {
    key: 'includeInner',
    re: /^「(?<ref>.*?)」里第 (?<line>\d+) 行：(?<msg>.*)$/s,
    nested: ['msg']
  },
  { key: 'includeNoStage', re: /^「(?<ref>.*?)」里没有叫「(?<stage>.*)」的阶段$/s },
  { key: 'includeCycle', re: /^「(?<ref>.*)」转着圈引用了自己$/s },
  { key: 'includeNotFound', re: /^找不到叫「(?<ref>.*)」的音变$/s },
  { key: 'includeTooDeep', re: /^引用套得太深了（最多四层）$/ },
  { key: 'includeSyntax', re: /^引用要写成 `-@ 规则集名 : 起始阶段 \.\. 终止阶段`$/ },
  {
    key: 'clauseNeedsPosition',
    re: /^「(?<piece>.*)」要以音节位置开头：1、2、-1、-2、0、\* 或 -\*（或者单独一个 @）$/s
  },
  { key: 'clauseNoUnderscore', re: /^「(?<piece>.*)」的环境缺少 _$/s },
  { key: 'excNoUnderscore', re: /^排除环境「(?<env>.*)」缺少 _$/s },
  { key: 'envNoUnderscore', re: /^环境「(?<env>.*)」缺少 _$/s },
  { key: 'undefinedClassLetter', re: /^未定义的音类 (?<name>.)，按字面字符处理$/su },
  { key: 'undefinedClassBraced', re: /^未定义的音类 \{(?<name>.*)\}$/s },
  { key: 'undefinedMorpheme', re: /^未定义的语素 @(?<name>.*)$/s },
  { key: 'undefinedFeature', re: /^未定义的特征 (?<name>.*)$/s },
  { key: 'featureEmpty', re: /^特征 \[(?<feature>.*)\] 没有成员$/s },
  {
    key: 'featureNeedsMembers',
    re: /^替换里的 \[(?<feature>.*)\] 要在特征定义里列出成员，才能按位置对应$/s
  },
  { key: 'regexInvalid', re: /^正则无法编译：(?<msg>.*)$/s },
  { key: 'missingArrow', re: /^缺少 >$/ },
  {
    key: 'onlyOneQuestion',
    re: /^一条规则的目标、替换里各只能有一个 \?（满足环境 \? 不满足环境）；要写问号本身用 \\\?$/
  },
  { key: 'elseTargetEmpty', re: /^\? 后面（不满足环境时）要改的目标不能为空$/ },
  { key: 'elseUnused', re: /^没有写环境：处处都算满足，\? 后面那一路用不上$/ }
]

const ADJUST = '(?<label>微调(?:\\((?:前|后)\\))?)'

/** 构形推导的轨迹（每一步一行，套进来的构形缩进两格） */
export const TRACE_PATTERNS: EnginePattern[] = [
  {
    key: 'adjustError',
    re: new RegExp(`^${ADJUST} ✗ (?<line>.+?): (?<msg>.*)$`, 's'),
    nested: ['msg'],
    labels: ['label']
  },
  { key: 'adjustUnknown', re: new RegExp(`^${ADJUST} \\? (?<line>.*)$`, 's'), labels: ['label'] },
  { key: 'adjustLine', re: new RegExp(`^${ADJUST} (?<rest>.*)$`, 's'), labels: ['label'] },
  { key: 'prefix', re: /^前缀 (?<rest>.*)$/s },
  { key: 'suffix', re: /^后缀 (?<rest>.*)$/s },
  { key: 'circumfix', re: /^环缀 (?<rest>.*)$/s },
  { key: 'infix', re: /^中缀 (?<rest>.*)$/s },
  { key: 'pattern', re: /^模板 (?<rest>.*)$/s },
  { key: 'reduplication', re: /^重叠 (?<rest>.*)$/s },
  { key: 'ruleSetMissing', re: /^规则集不存在$/ },
  { key: 'paradigmMissing', re: /^构形不存在$/ },
  { key: 'paradigmTooDeep', re: /^构形 (?<name>.*)：套得太深（超过 (?<n>\d+) 层），停在这里$/s },
  { key: 'paradigmNoSlot', re: /^构形 (?<name>.*)：没选槽位$/s },
  { key: 'paradigmEmptySlot', re: /^构形 (?<name>.*) · (?<slot>.*)：这一格没有写法$/s },
  { key: 'paradigmResult', re: /^构形 (?<rest>.*)$/s },
  { key: 'inheritMissing', re: /^继承的构形不存在$/ },
  { key: 'inheritTooDeep', re: /^继承 (?<name>.*)：套得太深（超过 (?<n>\d+) 层），停在这里$/s },
  { key: 'inheritSlotGone', re: /^继承 (?<name>.*)：那一格已经不在了$/s },
  { key: 'inheritEdited', re: /^继承 (?<name>.*) · (?<slot>.*)（手改过）: (?<form>.*)$/s },
  { key: 'inheritNoForm', re: /^继承 (?<name>.*) · (?<slot>.*)：那一格没有形式$/s },
  { key: 'inheritResult', re: /^继承 (?<rest>.*)$/s },
  { key: 'pronStart', re: /^发音起点: (?<rest>.*)$/s },
  { key: 'pron', re: /^发音: (?<rest>.*)$/s },
  { key: 'plugin', re: /^插件生成器 (?<rest>.*)$/s },
  { key: 'stemFallback', re: /^退回词干 (?<rest>.*)$/s },
  { key: 'stem', re: /^词干 (?<rest>.*)$/s },
  { key: 'conditionUnmatched', re: /^条件没对上任何取值：(?<list>.*)$/s },
  { key: 'joined', re: /^拼接: (?<rest>.*)$/s },
  { key: 'lemmaRef', re: /^引用词条 (?<rest>.*)$/s },
  { key: 'morphemeMissing', re: /^未找到语素 (?<rest>.*)$/s }
]

/** 「微调」「微调(前)」「微调(后)」→ traceMsg 里的键 */
export const LABEL_KEYS: Record<string, string> = {
  微调: 'labelAdjust',
  '微调(前)': 'labelAdjustPre',
  '微调(后)': 'labelAdjustPost'
}

export interface EngineMatch {
  key: string
  params: Record<string, string>
  nested: string[]
  labels: string[]
}

/** 认出一条报错或轨迹是哪种句式；认不出给 null */
export function matchEngineText(text: string, patterns: EnginePattern[]): EngineMatch | null {
  for (const p of patterns) {
    const m = p.re.exec(text)
    if (!m) continue
    return {
      key: p.key,
      params: { ...(m.groups ?? {}) },
      nested: p.nested ?? [],
      labels: p.labels ?? []
    }
  }
  return null
}

/**
 * 按界面语言写出来：tr 是界面的 t()。规则报错先翻嵌着的那一条；轨迹行先去掉开头的缩进，翻完再接上。
 * 认不出的原样返回
 */
export function localizeRuleMessage(
  text: string,
  tr: (key: string, params?: Record<string, string>) => string
): string {
  const m = matchEngineText(text, RULE_PATTERNS)
  if (!m) return text
  const params = { ...m.params }
  for (const k of m.nested) params[k] = localizeRuleMessage(params[k] ?? '', tr)
  return fill(tr(`ruleMsg.${m.key}`), params)
}

export function localizeTraceLine(
  line: string,
  tr: (key: string, params?: Record<string, string>) => string
): string {
  const indent = /^\s*/.exec(line)?.[0] ?? ''
  const body = line.slice(indent.length)
  const m = matchEngineText(body, TRACE_PATTERNS)
  if (!m) return line
  const params = { ...m.params }
  for (const k of m.nested) params[k] = localizeRuleMessage(params[k] ?? '', tr)
  for (const k of m.labels) {
    const key = LABEL_KEYS[params[k] ?? '']
    if (key) params[k] = tr(`traceMsg.${key}`)
  }
  return indent + fill(tr(`traceMsg.${m.key}`), params)
}

/** 自己填参数（一次换完）：参数里本身带着 {名字} 时不会被再换一遍 */
function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? params[k] : all))
}
