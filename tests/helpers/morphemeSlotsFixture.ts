import {
  createLanguage,
  createLexeme,
  createMorpheme,
  createProject,
  newId
} from '$lib/core/factory'
import type { Paradigm } from '$lib/core/model'
import { paradigmSlots } from '$lib/engine/morph'

/** 仓内测试默认只用合成词；本地 QA 可显式传入另一个已授权的演示。 */
export function morphemeSlotsFixture(
  sample: {
    lemma: string
    prefixForms: [string, string]
    stems: [string, string]
    meaning: string
  } = {
    lemma: 'pa·mora',
    prefixForms: ['pa-', 'pe-'],
    stems: ['mora', 'morb'],
    meaning: '功能演示合成词（不是语言事实）'
  }
) {
  const project = createProject({
    name: '语素槽：同一构形与不同前缀',
    template: 'blank',
    uiLocale: 'zh'
  })
  const language = project.languages[0]
  language.name = '语素槽功能演示'
  language.classes = [
    { id: newId(), name: 'V', members: ['a', 'e', 'i', 'o', 'u', 'ú'], featureQuery: null }
  ]
  project.categories = [
    {
      id: 'dependency',
      name: { zh: '依附性', en: 'Dependency' },
      values: [
        { id: 'independent', name: { zh: '独立' }, abbr: 'IND' },
        { id: 'dependent', name: { zh: '附属' }, abbr: 'DEP' }
      ]
    },
    {
      id: 'mood',
      name: { zh: '语气', en: 'Mood' },
      values: [
        { id: 'plain', name: { zh: '普通' }, abbr: 'PLAIN' },
        { id: 'soft', name: { zh: '轻微命令' }, abbr: 'SOFT' },
        { id: 'emphatic', name: { zh: '强调' }, abbr: 'EMPH' }
      ]
    }
  ]
  project.morphemeSlots = [
    { id: 'prefix-slot', name: '词条前缀', description: '每个词条手工指定具体前缀语素' },
    { id: 'ending-slot', name: '语气后缀', description: '普通为零，轻微命令／强调为-u' }
  ]
  const prefix = createMorpheme(language.id, 'prefix')
  prefix.form = sample.prefixForms[0]
  prefix.gloss = 'MOTION.PFX'
  prefix.allomorphs = [
    { form: sample.prefixForms[0], environment: '', values: ['independent'] },
    { form: sample.prefixForms[1], environment: '', values: ['dependent'] }
  ]
  const otherPrefix = createMorpheme(language.id, 'prefix')
  otherPrefix.form = 'na-'
  otherPrefix.gloss = 'DEMO.PFX'
  otherPrefix.meaning.zh = '功能演示合成前缀'
  otherPrefix.allomorphs = [
    { form: 'na-', environment: '', values: ['independent'] },
    { form: 'ni-', environment: '', values: ['dependent'] }
  ]
  const ending = createMorpheme(language.id, 'suffix')
  ending.form = '-'
  ending.gloss = 'U'
  ending.allomorphs = [
    { form: '-u', environment: '', values: ['soft', 'emphatic'], valueMatch: 'any' }
  ]
  project.morphemes.push(prefix, otherPrefix, ending)
  const foreignLanguage = createLanguage({ name: '其他语言（绑定验证）' }),
    foreign = createMorpheme(foreignLanguage.id, 'prefix')
  foreign.form = 'foreign-'
  project.languages.push(foreignLanguage)
  project.morphemes.push(foreign)
  const word = createLexeme(language.id, sample.lemma)
  word.senses[0].definition.zh = sample.meaning
  word.stems = { 普通词干: sample.stems[0], u前词干: sample.stems[1] }
  word.morphemeBindings = { 'prefix-slot': prefix.id, 'ending-slot': ending.id }
  const otherWord = createLexeme(language.id, 'na·demo')
  otherWord.senses[0].definition.zh = '功能演示合成词（不是语言事实）'
  otherWord.stems = { 普通词干: 'demo', u前词干: 'demb' }
  otherWord.morphemeBindings = { 'prefix-slot': otherPrefix.id, 'ending-slot': ending.id }
  const unboundWord = createLexeme(language.id, '未绑定示例')
  unboundWord.senses[0].definition.zh = '故意留空，用来查看缺绑定诊断'
  unboundWord.stems = { 普通词干: 'demo', u前词干: 'demb' }
  const paradigm: Paradigm = {
    id: 'shared-paradigm',
    name: { zh: '共用构形：依附性 × 语气', en: 'Shared paradigm' },
    variants: [],
    dimensionIds: ['dependency', 'mood'],
    disabledSlots: [],
    generators: {},
    inheritsFrom: null
  }
  project.paradigms.push(paradigm)
  for (const item of [word, otherWord, unboundWord]) {
    item.paradigmId = paradigm.id
    project.lexemes.push(item)
  }
  const slots = paradigmSlots(paradigm, project.categories, ['zh'])
  for (const slot of slots)
    paradigm.generators[slot.key] = {
      kind: 'pipeline',
      stem: slot.values.some((v) => v.valueId === 'soft' || v.valueId === 'emphatic')
        ? 'u前词干'
        : '普通词干',
      steps: [
        { id: newId(), kind: 'prefix', text: '', morphemeSlot: 'prefix-slot', slotAfter: '·' },
        { id: newId(), kind: 'suffix', text: '', morphemeSlot: 'ending-slot' }
      ]
    }
  return {
    project,
    language,
    prefix,
    otherPrefix,
    ending,
    foreign,
    word,
    otherWord,
    unboundWord,
    paradigm,
    slots
  }
}
