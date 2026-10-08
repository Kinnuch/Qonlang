/**
 * 引擎的中文报错、推导轨迹 → 按界面语言写出来：每种句式都认得出；中文文案填回去跟原文一字不差；
 * 英文能翻、嵌着的报错也翻；认不出的原样留着。另外拿真的规则错误跑一遍，防止引擎改了句式这边没跟上。
 */
import { describe, it, expect } from 'vitest'
import zh from '$lib/i18n/zh'
import en from '$lib/i18n/en'
import {
  RULE_PATTERNS,
  TRACE_PATTERNS,
  localizeRuleMessage,
  localizeTraceLine,
  matchEngineText
} from '$lib/i18n/engineText'
import { parseRuleText } from '$lib/engine/sca/parse'

const lookup = (dict: unknown, key: string): string | undefined => {
  let cur: unknown = dict
  for (const part of key.split('.')) cur = (cur as Record<string, unknown> | undefined)?.[part]
  return typeof cur === 'string' ? cur : undefined
}
const trOf =
  (dict: unknown) =>
  (key: string): string =>
    lookup(dict, key) ?? key

const RULES = [
  '未定义的音类 {Back}',
  '未定义的语素 @pl',
  '未定义的特征 +nasal',
  '未定义的音类 X，按字面字符处理',
  '「1 a > b」要以音节位置开头：1、2、-1、-2、0、* 或 -*（或者单独一个 @）',
  '「1: a > b / x」的环境缺少 _',
  '引用要写成 `-@ 规则集名 : 起始阶段 .. 终止阶段`',
  '「古音」转着圈引用了自己',
  '引用套得太深了（最多四层）',
  '找不到叫「古音」的音变',
  '「古音」里第 3 行：缺少 >',
  '「古音」里没有叫「中古」的阶段',
  '特征 [+voice] 没有成员',
  '正则无法编译：Invalid regular expression: /(/: Unterminated group',
  '缺少 >',
  '环境「x」缺少 _',
  '排除环境「y」缺少 _',
  '一条规则的目标、替换里各只能有一个 ?（满足环境 ? 不满足环境）；要写问号本身用 \\?',
  '? 后面（不满足环境时）要改的目标不能为空',
  '没有写环境：处处都算满足，? 后面那一路用不上',
  '替换里的 [+voice] 要在特征定义里列出成员，才能按位置对应'
]

const TRACES = [
  '微调 ✗ a > b / x: 环境「x」缺少 _',
  '微调(前) ? xyz',
  '微调(后) -a: kasoa → kaso',
  '前缀 ka-: kaso',
  '后缀 -lar → -ler: evler',
  '环缀 ge…t: gemacht',
  '中缀 um @ V1: sumulat',
  '模板 CaCaC: katab',
  '重叠 first: kakaso',
  '规则集不存在',
  '构形不存在',
  '构形 动词：套得太深（超过 4 层），停在这里',
  '构形 动词：没选槽位',
  '构形 动词 · SG.NOM：这一格没有写法',
  '构形 动词 · SG.NOM: kaso',
  '继承的构形不存在',
  '继承 名词：套得太深（超过 4 层），停在这里',
  '继承 名词：那一格已经不在了',
  '继承 名词 · SG.NOM（手改过）: kaso',
  '继承 名词 · SG.NOM：那一格没有形式',
  '继承 名词 · SG.NOM: kaso',
  '发音起点: kaso',
  '发音: ˈkaso',
  '插件生成器 my-gen: kaso',
  '退回词干 past→lemma: kaso',
  '词干 lemma: kaso',
  '条件没对上任何取值：阴、阳',
  '拼接: kaso',
  '引用词条 mo',
  '未找到语素 pl',
  '  前缀 ka-: kaso'
]

describe('引擎文字按界面语言显示', () => {
  it('规则的每种报错都认得出，中文填回去一字不差', () => {
    for (const text of RULES) {
      expect(matchEngineText(text, RULE_PATTERNS), text).not.toBeNull()
      expect(localizeRuleMessage(text, trOf(zh))).toBe(text)
    }
  })
  it('推导轨迹的每种句式都认得出，中文填回去一字不差（缩进照留）', () => {
    for (const text of TRACES) {
      expect(matchEngineText(text.trim(), TRACE_PATTERNS), text).not.toBeNull()
      expect(localizeTraceLine(text, trOf(zh))).toBe(text)
    }
  })
  it('每个句式都有中英文案', () => {
    for (const p of RULE_PATTERNS) {
      expect(lookup(zh, `ruleMsg.${p.key}`), p.key).toBeTruthy()
      expect(lookup(en, `ruleMsg.${p.key}`), p.key).toBeTruthy()
    }
    for (const p of TRACE_PATTERNS) {
      expect(lookup(zh, `traceMsg.${p.key}`), p.key).toBeTruthy()
      expect(lookup(en, `traceMsg.${p.key}`), p.key).toBeTruthy()
    }
  })
  it('英文：参数照填，嵌着的报错、步骤名也翻', () => {
    const tr = trOf(en)
    expect(localizeRuleMessage('未定义的音类 {Back}', tr)).toBe('Undefined class {Back}')
    expect(localizeRuleMessage('「古音」里第 3 行：缺少 >', tr)).toBe('Line 3 of “古音”: Missing >')
    expect(localizeTraceLine('微调 ✗ a > b / x: 环境「x」缺少 _', tr)).toBe(
      'Tweak ✗ a > b / x: The environment “x” has no _'
    )
    expect(localizeTraceLine('  后缀 -lar: evler', tr)).toBe('  Suffix -lar: evler')
    // 认不出的原样留着
    expect(localizeTraceLine('a → b (a → b, L3)', tr)).toBe('a → b (a → b, L3)')
    expect(localizeRuleMessage('something else', tr)).toBe('something else')
  })
  it('真的规则错误都认得出（引擎改了句式这里会提醒）', () => {
    const samples = [
      'a b',
      'a > b / x',
      'a > b / x_ - y',
      'a > b / {Nope}_',
      'a > b / @nope_',
      'a > b / X_'
    ]
    for (const text of samples) {
      const p = parseRuleText(text)
      expect(p.diagnostics.length, text).toBeGreaterThan(0)
      for (const d of p.diagnostics)
        expect(matchEngineText(d.message, RULE_PATTERNS), `${text} → ${d.message}`).not.toBeNull()
    }
  })
})
