/**
 * 生成示例项目文件（首页「示例工程」按钮打开的就是它们）：
 *   examples/Aelith.laim.json  黏着先验语：语系、元音和谐、多槽位后缀、流水线的每一种步骤、
 *                              变体与继承、词源链与关系图、已 gloss 的语料、短语、文档…
 *   examples/Tsahun.laim.json  孤立声调语：声调、双正字法、音节文字拼合与竖排、重叠构形、手填表…
 *
 * 两个项目合起来把每个模块的功能都走一遍；数据全是虚构的，只求把功能摆出来。
 * 运行：npm run examples。瑟乌丝林语见 scripts/make-theusrin.ts。
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  createProject,
  createLanguage,
  createLexeme,
  createMorpheme,
  createRuleSet,
  createSentence,
  createScript,
  createSense,
  createPhrase,
  createDoc,
  newId
} from '$lib/core/factory'
import { serializeProject } from '$lib/core/serialize'
import { inferFeatures } from '$lib/ipa/features'
import { analyzeSentence } from '$lib/engine/gloss'
import { makeContext, deriveForms, paradigmFor } from '$lib/engine/morph'
import type {
  GrammaticalCategory,
  Id,
  Language,
  Lexeme,
  Morpheme,
  MorphStep,
  Paradigm,
  PartOfSpeech,
  Project,
  Sentence,
  SlotGenerator
} from '$lib/core/model'

const root = process.cwd()
const outDir = join(root, 'examples')
mkdirSync(join(outDir, 'private'), { recursive: true })

// ───────────────────────── 小工具 ─────────────────────────

function pos(p: Project, zh: string, en: string, abbr: string): PartOfSpeech {
  const x: PartOfSpeech = { id: newId(), name: { zh, en }, abbr, paradigmId: null }
  p.posList.push(x)
  return x
}
function category(
  p: Project,
  zh: string,
  en: string,
  values: [string, string, string][]
): GrammaticalCategory {
  const c: GrammaticalCategory = {
    id: newId(),
    name: { zh, en },
    values: values.map(([vzh, ven, abbr]) => ({ id: newId(), name: { zh: vzh, en: ven }, abbr }))
  }
  p.categories.push(c)
  return c
}
function value(c: GrammaticalCategory, abbr: string): Id {
  return c.values.find((v) => v.abbr === abbr)!.id
}
function step<K extends MorphStep['kind']>(
  kind: K,
  props: Omit<Extract<MorphStep, { kind: K }>, 'id' | 'kind'>
): MorphStep {
  return { id: newId(), kind, ...props } as MorphStep
}
function pipeline(stem: string, ...steps: MorphStep[]): SlotGenerator {
  return { kind: 'pipeline', stem, steps }
}
function paradigm(
  p: Project,
  zh: string,
  en: string,
  dims: GrammaticalCategory[],
  extra: Partial<Paradigm> = {}
): Paradigm {
  const x: Paradigm = {
    id: newId(),
    name: { zh, en },
    variants: [],
    dimensionIds: dims.map((d) => d.id),
    disabledSlots: [],
    generators: {},
    inheritsFrom: null,
    ...extra
  }
  p.paradigms.push(x)
  return x
}
function abbrs(p: Project, list: [string, string, string][]): void {
  for (const [abbr, zh, en] of list) p.abbreviations.push({ abbr, name: { zh, en } })
}
/** 一张小 SVG 当配图，不依赖外部文件 */
function svgImage(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="${color}"/><text x="160" y="134" font-size="40" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}
/** 跑一遍自动分析；认得出来的标成已确认，示例打开就是「做完」的样子 */
function analyzeAll(p: Project, sentences: Sentence[]): number {
  let bad = 0
  for (const s of sentences) {
    analyzeSentence(p, s, { force: true })
    for (const t of s.tokens) {
      const a = t.analyses[t.chosen]
      if (a && !a.morphs.some((m) => m.gloss === '?')) t.confirmed = true
      else bad++
    }
  }
  return bad
}
/** 给绑定了构形的词条推导屈折形 */
function deriveAll(p: Project, lang: Language): number {
  const ctx = makeContext(p, lang)
  let n = 0
  for (const l of p.lexemes) {
    if (l.languageId !== lang.id) continue
    const para = paradigmFor(p, l)
    if (para) n += deriveForms(ctx, l, para, undefined, l.paradigmVariantId)
  }
  return n
}
function save(name: string, p: Project): void {
  const file = join(outDir, name)
  writeFileSync(file, serializeProject(p), 'utf8')
  const tokens = p.sentences.reduce((a, s) => a + s.tokens.length, 0)
  const confirmed = p.sentences.reduce((a, s) => a + s.tokens.filter((t) => t.confirmed).length, 0)
  console.log(
    `wrote ${file}\n  语言 ${p.languages.length} · 语素 ${p.morphemes.length} · 词条 ${p.lexemes.length}` +
      ` · 构形 ${p.paradigms.length} · 规则集 ${p.ruleSets.length} · 例句 ${p.sentences.length}` +
      `（词次 ${tokens}，已确认 ${confirmed}）· 短语 ${p.phrasebook.length} · 文档 ${p.docs.length}`
  )
}

// ───────────────────────── Aelith：黏着先验语 ─────────────────────────
function makeAelith(): void {
  const p = createProject({
    name: 'Aelith',
    template: 'family',
    appVersion: '0.6.5',
    uiLocale: 'zh'
  })
  p.meta.author = '千语集示例'
  p.meta.description =
    '黏着先验语示例（虚构）：祖语→现代语的语系、元音和谐、多槽位后缀、流水线构形的每一种步骤、变体与继承、词源链与关系图、已 gloss 的语料。'
  // 语系：Proto-Aelith → Aelith
  p.languages = []
  const P = createLanguage({ name: 'Proto-Aelith', abbr: 'PAe', color: '#8b5cf6' })
  P.notes = '重构的祖语：词根表在「语素」页，「音变 → Proto → Aelith」把它推到现代语。'
  P.alphabet = 'a e i o u k t p s h m n l r w j θ'.split(' ')
  P.phonemes = 'p t k s h m n l r w j a e i o u'
    .split(' ')
    .map((s) => ({ id: newId(), symbol: s, features: inferFeatures(s), graphemes: {}, notes: '' }))
  const L = createLanguage({ name: 'Aelith', abbr: 'ae', color: '#0e9f8a', parentId: P.id })
  p.languages.push(P, L)
  p.settings.defaultLanguageId = L.id
  L.notes =
    '黏着语：前后元音和谐；名词 词根-数-格，动词 词根-否定-时-人称。\n方言：标准语与北方话（北方话 ö → o）。'
  L.alphabet = 'a b d e g i j k l m n ng o ö p r s t u ü v w z'.split(' ')
  L.dialects = [
    { id: newId(), name: '标准语', abbr: 'std' },
    { id: newId(), name: '北方话', abbr: 'N' }
  ]
  const [stdDialect, northDialect] = L.dialects

  // ── 音系 ──
  L.phonemes = 'p t k b d g m n ŋ s z v r l j w a e i o u ø y'.split(' ').map((s) => ({
    id: newId(),
    symbol: s,
    features: inferFeatures(s),
    graphemes: {},
    notes: s === 'ŋ' ? '只出现在音节尾，拼写 ng' : ''
  }))
  L.digraphs = [{ from: 'ng', to: 'ŋ' }]
  L.classes = [
    {
      id: newId(),
      name: 'C',
      members: 'p t k b d g m n ng s z v r l j w'.split(' '),
      featureQuery: null
    },
    { id: newId(), name: 'V', members: 'a e i o u ö ü'.split(' '), featureQuery: null },
    { id: newId(), name: 'Back', members: ['a', 'o', 'u'], featureQuery: null },
    { id: newId(), name: 'Front', members: ['e', 'ö', 'ü'], featureQuery: null },
    // 由特征生成的音类：音位表一改它就跟着变
    { id: newId(), name: 'Nasal', members: ['m', 'n', 'ŋ'], featureQuery: { manner: 'nasal' } }
  ]
  const rom = L.orthographies[0]
  rom.name = '罗马化'
  rom.rulesToIpa = ['ng > ŋ', 'ö > ø', 'ü > y'].join('\n')
  rom.rulesFromIpa = ['ŋ > ng', 'ø > ö', 'y > ü'].join('\n')
  L.orthographies.push({
    id: newId(),
    name: '学术转写',
    font: '',
    direction: 'ltr',
    rulesToIpa: ['ng > ŋ', 'oe > ø', 'ue > y'].join('\n'),
    rulesFromIpa: ['ŋ > ng', 'ø > oe', 'y > ue'].join('\n'),
    isPrimary: false
  })
  const academic = L.orthographies[1]
  L.syllable = { enabled: true, template: '(C)V(C)', strategy: 'template' }
  L.prosody = {
    type: 'stress',
    stressPosition: 'initial',
    rules: '复合词的第二成分保留次重音。',
    tones: []
  }
  L.phonotactics = {
    onsets: 'p t k b d g m n s z v r l j w'.split(' '),
    nuclei: 'a e i o u ö ü'.split(' '),
    codas: 'n l r s z t k m ng'.split(' '),
    illegal: ['jj', 'ww', 'ngng'],
    weights: { k: 3, t: 3, s: 2, a: 3, e: 2, ü: 0.5 },
    minSyllables: 1,
    maxSyllables: 3
  }

  // ── 词类与维度 ──
  const N = pos(p, '名词', 'noun', 'n.')
  const V = pos(p, '动词', 'verb', 'v.')
  const A = pos(p, '形容词', 'adjective', 'adj.')
  const PRO = pos(p, '代词', 'pronoun', 'pron.')
  const PART = pos(p, '小品词', 'particle', 'part.')
  const num = category(p, '数', 'number', [
    ['单数', 'singular', 'SG'],
    ['复数', 'plural', 'PL']
  ])
  const kase = category(p, '格', 'case', [
    ['主格', 'nominative', 'NOM'],
    ['宾格', 'accusative', 'ACC'],
    ['位格', 'locative', 'LOC'],
    ['与格', 'dative', 'DAT']
  ])
  const person = category(p, '人称', 'person', [
    ['第一人称', 'first person', '1'],
    ['第二人称', 'second person', '2'],
    ['第三人称', 'third person', '3']
  ])
  const tense = category(p, '时', 'tense', [
    ['现在', 'present', 'PRS'],
    ['过去', 'past', 'PST']
  ])
  const polarity = category(p, '极性', 'polarity', [
    ['肯定', 'affirmative', 'AFF'],
    ['否定', 'negative', 'NEG']
  ])
  // 形容词的「级与派生」：一个维度演示流水线的各种步骤
  const degree = category(p, '级与派生', 'degree & derivation', [
    ['原级', 'positive', 'POS'],
    ['比较级', 'comparative', 'CMP'],
    ['最高级', 'superlative', 'SUP'],
    ['强调', 'intensive', 'INT'],
    ['小称', 'diminutive', 'DIM'],
    ['抽象名词', 'abstract noun', 'ABS'],
    ['无…的', 'privative', 'PRIV']
  ])
  const harmony = category(p, '和谐类', 'harmony class', [
    ['后元音', 'back', 'B'],
    ['前元音', 'front', 'F']
  ])

  // ── 语素：祖语词根 + 现代语的各类词缀 ──
  const protoRoots = new Map<string, Morpheme>()
  const protoRoot = (form: string, gloss: string, zh: string, en: string): Morpheme => {
    const m = createMorpheme(P.id, 'root')
    m.form = form
    m.gloss = gloss
    m.meaning = { zh, en }
    m.tags = ['词根']
    m.etymology = {
      type: 'root',
      sources: [{ kind: 'external', language: 'Pre-Aelith', form: '*' + form + 'e', meaning: en }],
      stages: [],
      notes: '内部拟构'
    }
    p.morphemes.push(m)
    protoRoots.set(form, m)
    return m
  }
  protoRoot('kasu', 'house', '房子', 'house')
  protoRoot('teli', 'water', '水', 'water')
  protoRoot('nol', 'sun', '太阳', 'sun')
  protoRoot('ura', 'mountain', '山', 'mountain')
  protoRoot('sepe', 'bird', '鸟', 'bird')
  protoRoot('muk', 'stone', '石头', 'stone')
  protoRoot('ilen', 'child', '孩子', 'child')
  protoRoot('kel', 'come', '来', 'come')
  protoRoot('sor', 'see', '看见', 'see')
  protoRoot('kara', 'black', '黑', 'black')

  const morph = (
    type: Morpheme['type'],
    form: string,
    gloss: string,
    zh: string,
    en: string,
    opts: {
      allo?: [string, string][]
      feats?: Record<Id, Id>
      form2?: string
      tags?: string[]
      notes?: string
    } = {}
  ): Morpheme => {
    const m = createMorpheme(L.id, type)
    m.form = form
    m.form2 = opts.form2 ?? ''
    m.gloss = gloss
    m.meaning = { zh, en }
    m.allomorphs = (opts.allo ?? []).map(([f, env]) => ({ form: f, environment: env }))
    m.features = opts.feats ?? {}
    m.tags = opts.tags ?? []
    m.notes = opts.notes ?? ''
    p.morphemes.push(m)
    return m
  }
  const backEnv = '{Back}[^aeouöü]*_'
  const frontEnv = '{Front}[^aeouöü]*_'
  morph('suffix', '-lAr', 'PL', '复数', 'plural', {
    allo: [
      ['-lar', backEnv],
      ['-ler', frontEnv]
    ],
    feats: { [num.id]: value(num, 'PL') },
    tags: ['名词后缀'],
    notes: '大写 A 是原音位，按和谐实现（见规则集「元音和谐」）。'
  })
  morph('suffix', '-(U)m', 'ACC', '宾格', 'accusative', {
    allo: [
      ['-m', 'V_'],
      ['-um', '{Back}C_'],
      ['-üm', '{Front}C_']
    ],
    feats: { [kase.id]: value(kase, 'ACC') },
    tags: ['名词后缀']
  })
  morph('suffix', '-dA', 'LOC', '位格', 'locative', {
    allo: [
      ['-da', backEnv],
      ['-de', frontEnv]
    ],
    feats: { [kase.id]: value(kase, 'LOC') },
    tags: ['名词后缀']
  })
  morph('suffix', '-kA', 'DAT', '与格', 'dative', {
    allo: [
      ['-ka', backEnv],
      ['-ke', frontEnv]
    ],
    feats: { [kase.id]: value(kase, 'DAT') },
    tags: ['名词后缀']
  })
  morph('suffix', '-(U)m', '1SG.POSS', '我的', 'my', {
    allo: [
      ['-m', 'V_'],
      ['-um', '{Back}C_'],
      ['-üm', '{Front}C_']
    ],
    feats: { [person.id]: value(person, '1') },
    tags: ['领属']
  })
  morph('suffix', '-(U)n', '2SG.POSS', '你的', 'your', {
    allo: [
      ['-n', 'V_'],
      ['-un', '{Back}C_'],
      ['-ün', '{Front}C_']
    ],
    feats: { [person.id]: value(person, '2') },
    tags: ['领属']
  })
  morph('suffix', '-sI', '3SG.POSS', '他的', 'his/her', {
    allo: [['-si', '_']],
    feats: { [person.id]: value(person, '3') },
    tags: ['领属']
  })
  morph('suffix', '-mA', 'NEG', '否定', 'negative', {
    allo: [
      ['-ma', backEnv],
      ['-me', frontEnv]
    ],
    feats: { [polarity.id]: value(polarity, 'NEG') },
    tags: ['动词后缀']
  })
  morph('suffix', '-dU', 'PST', '过去', 'past', {
    allo: [
      ['-du', backEnv],
      ['-dü', frontEnv]
    ],
    feats: { [tense.id]: value(tense, 'PST') },
    tags: ['动词后缀']
  })
  morph('suffix', '-(U)m', '1SG', '第一人称单数', 'first singular', {
    allo: [
      ['-m', 'V_'],
      ['-um', '{Back}C_'],
      ['-üm', '{Front}C_']
    ],
    feats: { [person.id]: value(person, '1') },
    tags: ['动词后缀']
  })
  morph('suffix', '-sAn', '2SG', '第二人称单数', 'second singular', {
    allo: [
      ['-san', backEnv],
      ['-sen', frontEnv]
    ],
    feats: { [person.id]: value(person, '2') },
    tags: ['动词后缀']
  })
  const AGT = morph('suffix', '-lU', 'AGT', '施事名词化（…的人）', 'agent nominalizer', {
    allo: [
      ['-lu', backEnv],
      ['-lü', frontEnv]
    ],
    tags: ['派生']
  })
  morph('prefix', 'be-', 'PRIV', '无…的', 'privative (without)', {
    tags: ['派生'],
    notes: '构形流水线里写 @PRIV 就能引用它。'
  })
  morph('infix', '-in-', 'DIM', '小称', 'diminutive', {
    tags: ['派生'],
    notes: '插在第一个元音之后：kara → kainra'
  })
  morph('circumfix', 'en-', 'SUP', '最高级', 'superlative', { form2: '-ik', tags: ['形容词'] })
  morph('clitic', '=mU', 'Q', '疑问', 'question', {
    allo: [
      ['=mu', backEnv],
      ['=mü', frontEnv]
    ]
  })
  morph('particle', 've', 'and', '和', 'and')

  // ── 词条 ──
  const words: [string, PartOfSpeech, string, string, string[], string?][] = [
    ['kaso', N, '房子', 'house', ['基础'], 'kasu'],
    ['teli', N, '水', 'water', ['基础', '自然'], 'teli'],
    ['nöl', N, '太阳', 'sun', ['自然'], 'nol'],
    ['ura', N, '山', 'mountain', ['自然'], 'ura'],
    ['sepe', N, '鸟', 'bird', ['动物'], 'sepe'],
    ['muk', N, '石头', 'stone', ['自然'], 'muk'],
    ['ilen', N, '孩子', 'child', ['人'], 'ilen'],
    ['tovar', N, '朋友', 'friend', ['人']],
    ['göl', N, '湖', 'lake', ['自然']],
    ['dünar', N, '世界', 'world', []],
    ['bura', N, '面包', 'bread', ['食物']],
    ['kel-', V, '来', 'come', ['运动'], 'kel'],
    ['git-', V, '去', 'go', ['运动']],
    ['sör-', V, '看见', 'see', ['感知'], 'sor'],
    ['al-', V, '拿；取', 'take', []],
    ['ver-', V, '给', 'give', []],
    ['ol-', V, '是；成为', 'be; become', []],
    ['je-', V, '吃', 'eat', ['食物']],
    ['bil-', V, '知道', 'know', ['认知']],
    ['jat-', V, '睡', 'sleep', []],
    ['kara', A, '黑的', 'black', ['颜色'], 'kara'],
    ['pelin', A, '小的', 'small', ['尺寸']],
    ['oru', A, '大的', 'big', ['尺寸']],
    ['sürü', A, '快的', 'fast', []],
    ['men', PRO, '我', 'I', []],
    ['sen', PRO, '你', 'you (sg.)', []],
    ['o', PRO, '他 / 她 / 它', 'he / she / it', []],
    ['biz', PRO, '我们', 'we', []],
    ['ve', PART, '和', 'and', []],
    ['mü', PART, '吗（疑问）', 'question particle', []]
  ]
  const lex = new Map<string, Lexeme>()
  for (const [lemma, ps, zh, en, tags, proto] of words) {
    const lx = createLexeme(L.id, lemma)
    lx.posId = ps.id
    lx.senses[0].definition = { zh, en }
    lx.tags = tags
    lx.dialectIds = [stdDialect.id]
    const vowels = lemma.match(/[aeiouöü]/g) ?? []
    const last = vowels[vowels.length - 1]
    if (last) lx.features[harmony.id] = value(harmony, 'aou'.includes(last) ? 'B' : 'F')
    lx.stems = { 词干: lemma.replace(/-$/, '') }
    if (proto) {
      const m = protoRoots.get(proto)!
      lx.etymology = {
        type: 'soundChange',
        sources: [{ kind: 'morpheme', id: m.id }],
        stages: [{ id: newId(), form: '*' + proto, type: '', notes: '祖语形' }],
        notes: '经规则集「Proto → Aelith」推出'
      }
    }
    p.lexemes.push(lx)
    lex.set(lemma, lx)
  }
  // 多义项、语域、方言、备注、配图、手改发音
  const kaso = lex.get('kaso')!
  kaso.senses[0].tags = ['建筑']
  const kasoHome = createSense()
  kasoHome.definition = { zh: '家；家庭', en: 'home; household' }
  kasoHome.register = '口语'
  kasoHome.tags = ['引申']
  kaso.senses.push(kasoHome)
  kaso.notes = '最常用的名词之一。'
  kaso.images.push({ id: newId(), dataUrl: svgImage('kaso', '#0e9f8a'), caption: '房子' })
  kaso.pronunciations[rom.id] = { ipa: 'ˈka.so', irregular: true }
  const nol = lex.get('nöl')!
  nol.dialectIds = [stdDialect.id, northDialect.id]
  const nolNorth = createSense()
  nolNorth.definition = { zh: '白天（北方话）', en: 'daytime (Northern)' }
  nolNorth.dialectIds = [northDialect.id]
  nol.senses.push(nolNorth)
  nol.images.push({ id: newId(), dataUrl: svgImage('nöl', '#d97706'), caption: '太阳' })
  // 同形兼类：kara 既是形容词也当名词「黑色」
  lex.get('kara')!.extraPosIds = [N.id]
  const rel = (a: string, kind: string, b: string): void => {
    lex.get(a)!.relations.push({ kind, lexemeId: lex.get(b)!.id })
  }
  rel('pelin', 'antonym', 'oru')
  rel('oru', 'antonym', 'pelin')
  rel('göl', 'related', 'teli')
  rel('kel-', 'antonym', 'git-')
  rel('kaso', 'related', 'dünar')
  // 派生词、复合词、借词：三种词源
  const kasolu = createLexeme(L.id, 'kasolu')
  kasolu.posId = N.id
  kasolu.senses[0].definition = { zh: '房主', en: 'householder' }
  kasolu.tags = ['人', '派生']
  kasolu.features[harmony.id] = value(harmony, 'B')
  kasolu.stems = { 词干: 'kasolu' }
  kasolu.etymology = {
    type: 'derivation',
    sources: [
      { kind: 'lexeme', id: kaso.id },
      { kind: 'morpheme', id: AGT.id }
    ],
    stages: [],
    notes: ''
  }
  kaso.relations.push({ kind: 'derivation', lexemeId: kasolu.id })
  p.lexemes.push(kasolu)
  lex.set('kasolu', kasolu)
  const telikaso = createLexeme(L.id, 'telikaso')
  telikaso.posId = N.id
  telikaso.senses[0].definition = { zh: '磨坊（字面：水屋）', en: 'mill (lit. water-house)' }
  telikaso.tags = ['复合', '建筑']
  telikaso.features[harmony.id] = value(harmony, 'B')
  telikaso.stems = { 词干: 'telikaso' }
  telikaso.etymology = {
    type: 'compound',
    sources: [
      { kind: 'lexeme', id: lex.get('teli')!.id },
      { kind: 'lexeme', id: kaso.id }
    ],
    stages: [{ id: newId(), form: 'teli-kaso', type: '', notes: '早期仍分写' }],
    notes: ''
  }
  p.lexemes.push(telikaso)
  const sawa = createLexeme(L.id, 'sawa')
  sawa.posId = N.id
  sawa.senses[0].definition = { zh: '井（借词）', en: 'well (loan)' }
  sawa.tags = ['借词']
  sawa.features[harmony.id] = value(harmony, 'B')
  sawa.stems = { 词干: 'sawa' }
  sawa.etymology = {
    type: 'borrowing',
    sources: [{ kind: 'external', language: 'Tsahun', form: 'tsa55-wa55', meaning: '水-房子' }],
    stages: [{ id: newId(), form: 'tsawa', type: '', notes: '借入时丢了声调' }],
    notes: '自定义来源里带连字符的形式，关系图会拆成两个节点。'
  }
  p.lexemes.push(sawa)
  // 祖语也有词条：现代词的来源指向它，关系图里可以跨语言跳
  const pKasu = createLexeme(P.id, 'kasu')
  pKasu.posId = N.id
  pKasu.senses[0].definition = { zh: '房子（祖语）', en: 'house (proto)' }
  pKasu.etymology = {
    type: 'root',
    sources: [{ kind: 'morpheme', id: protoRoots.get('kasu')!.id }],
    stages: [],
    notes: ''
  }
  p.lexemes.push(pKasu)
  kaso.etymology.sources.unshift({ kind: 'lexeme', id: pKasu.id })

  // ── 音变规则集 ──
  const harmonyRs = createRuleSet(
    '元音和谐',
    [
      '; 后缀里的大写 A / U / I 是原音位，按词内最后一个元音的前后性实现；',
      '; Ŭ 是连接元音，词干以元音结尾时脱落；语素界写 ¢，最后删掉',
      'C=ptkbdgmnszvrljw',
      'V=aeiouöü',
      '{Back}=a o u',
      '{Front}=e ö ü',
      '-* 底层',
      'A > e / {Front}[^aeouöü]*_',
      'A > a / _',
      'U > ü / {Front}[^aeouöü]*_',
      'U > u / _',
      'I > i / _',
      'Ŭ > / V¢_',
      'Ŭ > ü / {Front}[^aeouöü]*_',
      'Ŭ > u / _',
      '¢ > / _',
      '-* 表层'
    ].join('\n')
  )
  harmonyRs.notes = '构形流水线里「音变」那一步引用它：先拼上原音位后缀，再由这里实现。'
  harmonyRs.testWords = 'kaso¢lAr¢Ŭm\nnöl¢dA\nilen¢lAr¢kA\nsör¢mA¢dU¢Ŭm\nkel¢dU¢sAn\nteli¢Ŭm'
  harmonyRs.stageLanguages = { 底层: L.id, 表层: L.id }
  p.ruleSets.push(harmonyRs)
  const protoRs = createRuleSet(
    'Proto → Aelith',
    [
      '; 祖语到现代语：词尾 u 降为 o，前元音环境里 o 变 ö，s 在元音间浊化为 v',
      'th|θ',
      'C=ptkbdgmnsvrljwθ',
      'V=aeiouöü',
      '-* 祖语',
      'u > o / _#',
      'o > ö / _[^aeiou]*[ei]',
      'o > ö / [ei][^aeiou]*_',
      's > v / V_V',
      'θ > t',
      '-* 现代语'
    ].join('\n')
  )
  protoRs.notes = '「整库演化」用它把祖语的语素表整体推到 Aelith 词库。'
  protoRs.testWords = 'kasu\nteli\nnol\nkel\nsor\nkara\nθura'
  protoRs.stageLanguages = { 祖语: P.id, 现代语: L.id }
  p.ruleSets.push(protoRs)

  // ── 构形：流水线的八种步骤各露一次脸 ──
  const sca = (): MorphStep =>
    step('sca', { ruleSetId: harmonyRs.id, fromStage: '底层', toStage: '表层' })
  const nounP = paradigm(p, '名词', 'noun', [num, kase])
  const caseSuffix: Record<string, string> = { NOM: '', ACC: '¢Ŭm', LOC: '¢dA', DAT: '¢kA' }
  for (const n of num.values)
    for (const k of kase.values) {
      const steps: MorphStep[] = []
      if (n.abbr === 'PL') steps.push(step('suffix', { text: '¢lAr' }))
      if (caseSuffix[k.abbr]) steps.push(step('suffix', { text: caseSuffix[k.abbr] }))
      steps.push(sca())
      nounP.generators[`${n.id}|${k.id}`] = pipeline('词干', ...steps)
    }
  N.paradigmId = nounP.id

  // 动词：变体「口语」把第一人称的 -Ŭm 换成 -Ŭ；否定现在第三人称用迂说法，屏蔽掉
  const spoken = { id: newId(), name: '口语' }
  const verbP = paradigm(p, '动词', 'verb', [polarity, tense, person], { variants: [spoken] })
  const personSuffix: Record<string, string> = { '1': '¢Ŭm', '2': '¢sAn', '3': '' }
  for (const po of polarity.values)
    for (const te of tense.values)
      for (const pe of person.values) {
        const key = `${po.id}|${te.id}|${pe.id}`
        const base: MorphStep[] = []
        if (po.abbr === 'NEG') base.push(step('suffix', { text: '¢mA' }))
        if (te.abbr === 'PST') base.push(step('suffix', { text: '¢dU' }))
        const tail = personSuffix[pe.abbr]
        verbP.generators[key] = pipeline(
          '词干',
          ...base,
          ...(tail ? [step('suffix', { text: tail })] : []),
          sca()
        )
        if (pe.abbr === '1')
          verbP.generators[`${key}#${spoken.id}`] = pipeline(
            '词干',
            ...base,
            step('suffix', { text: '¢Ŭ' }),
            sca()
          )
      }
  verbP.disabledSlots = [`${value(polarity, 'NEG')}|${value(tense, 'PRS')}|${value(person, '3')}`]
  V.paradigmId = verbP.id
  lex.get('kel-')!.paradigmVariantId = spoken.id

  // 不规则动词：继承上面的动词构形，只覆盖过去时（改用「过去词干」）
  const irregVerbP = paradigm(p, '动词（不规则）', 'verb (irregular)', [polarity, tense, person], {
    inheritsFrom: verbP.id
  })
  for (const po of polarity.values)
    for (const pe of person.values) {
      const key = `${po.id}|${value(tense, 'PST')}|${pe.id}`
      const steps: MorphStep[] = []
      if (po.abbr === 'NEG') steps.push(step('suffix', { text: '¢mA' }))
      const tail = personSuffix[pe.abbr]
      if (tail) steps.push(step('suffix', { text: tail }))
      steps.push(sca())
      irregVerbP.generators[key] = pipeline('过去词干', ...steps)
    }
  const ol = lex.get('ol-')!
  ol.paradigmId = irregVerbP.id
  ol.stems = { 词干: 'ol', 过去词干: 'oldu' }
  ol.notes = '过去时不规则：另有「过去词干」oldu，由继承的构形「动词（不规则）」接手。'

  // 形容词：一个维度演示前缀 / 环缀 / 中缀 / 模板 / 重叠 / 微调
  const adjP = paradigm(p, '形容词', 'adjective', [degree])
  adjP.generators[value(degree, 'POS')] = pipeline('词干')
  adjP.generators[value(degree, 'CMP')] = pipeline('词干', step('suffix', { text: '¢rA' }), sca())
  adjP.generators[value(degree, 'SUP')] = pipeline(
    '词干',
    step('circumfix', { text: 'en-', text2: '-ik' }),
    step('adjust', { text: '; 元音相撞时前一个脱落\nai > i\noi > i\nui > i\nei > i' })
  )
  adjP.generators[value(degree, 'INT')] = pipeline(
    '词干',
    step('reduplication', { scope: 'initial', length: 2 })
  )
  adjP.generators[value(degree, 'DIM')] = pipeline(
    '词干',
    step('infix', { text: '-in-', at: 'V1' })
  )
  adjP.generators[value(degree, 'ABS')] = pipeline('词干', step('pattern', { pattern: 'C1eC2iC3' }))
  adjP.generators[value(degree, 'PRIV')] = pipeline('词干', step('prefix', { text: '@PRIV' }))
  A.paradigmId = adjP.id

  // 代词：不规则，手填表
  const proP = paradigm(p, '代词', 'pronoun', [kase])
  for (const k of kase.values) proP.generators[k.id] = { kind: 'table' }
  PRO.paradigmId = proP.id
  lex.get('men')!.forms = {
    主格: { surface: 'men', derived: false, override: true, trace: [] },
    宾格: { surface: 'meni', derived: false, override: true, trace: [] },
    位格: { surface: 'mende', derived: false, override: true, trace: [] },
    与格: { surface: 'menke', derived: false, override: true, trace: [] }
  }
  lex.get('sen')!.forms = {
    主格: { surface: 'sen', derived: false, override: true, trace: [] },
    宾格: { surface: 'seni', derived: false, override: true, trace: [] },
    位格: { surface: 'sende', derived: false, override: true, trace: [] },
    与格: { surface: 'senke', derived: false, override: true, trace: [] }
  }
  lex.get('o')!.forms = {
    主格: { surface: 'o', derived: false, override: true, trace: [] },
    宾格: { surface: 'onu', derived: false, override: true, trace: [] },
    位格: { surface: 'onda', derived: false, override: true, trace: [] },
    与格: { surface: 'ona', derived: false, override: true, trace: [] }
  }
  lex.get('biz')!.forms = {
    主格: { surface: 'biz', derived: false, override: true, trace: [] },
    宾格: { surface: 'bizi', derived: false, override: true, trace: [] },
    位格: { surface: 'bizde', derived: false, override: true, trace: [] },
    与格: { surface: 'bizke', derived: false, override: true, trace: [] }
  }
  console.log(`  Aelith 推导屈折形 ${deriveAll(p, L)} 个`)

  // ── 文字：卢恩区做一套刻文 ──
  const runes = createScript('Aelith 刻文')
  runes.type = 'alphabet'
  runes.font.family = 'Segoe UI Historic'
  const pairs: [string, string, string][] = [
    ['a', 'ᚨ', 'ansuz'],
    ['e', 'ᛖ', 'ehwaz'],
    ['i', 'ᛁ', 'isaz'],
    ['o', 'ᛟ', 'othala'],
    ['u', 'ᚢ', 'uruz'],
    ['ö', 'ᛜ', 'ingwaz'],
    ['ü', 'ᛇ', 'eihwaz'],
    ['p', 'ᛈ', 'pertho'],
    ['t', 'ᛏ', 'tiwaz'],
    ['k', 'ᚲ', 'kaunan'],
    ['b', 'ᛒ', 'berkanan'],
    ['d', 'ᛞ', 'dagaz'],
    ['g', 'ᚷ', 'gebo'],
    ['m', 'ᛗ', 'mannaz'],
    ['n', 'ᚾ', 'naudiz'],
    ['ng', 'ᛝ', 'ingwaz variant'],
    ['s', 'ᛊ', 'sowilo'],
    ['v', 'ᚠ', 'fehu'],
    ['r', 'ᚱ', 'raido'],
    ['l', 'ᛚ', 'laguz'],
    ['j', 'ᛃ', 'jera'],
    ['w', 'ᚹ', 'wunjo'],
    ['z', 'ᛉ', 'algiz']
  ]
  runes.glyphs = pairs.map(([v, char, name]) => ({
    id: newId(),
    char,
    name,
    value: v,
    category: 'aeiouöü'.includes(v) ? 'vowel' : 'consonant',
    notes: ''
  }))
  runes.rules = ['; 双写辅音只刻一次（C1C1：同一个辅音写两遍）', 'C1C1 > C1', '@glyphs'].join('\n')
  runes.notes = '拉丁转写 → 卢恩区字符：规则先合并双辅音，再套字形表。'
  L.scripts.push(runes)
  kaso.scriptForms[runes.id] = 'ᚲᚨᛊᛟ'

  // ── 语料 ──
  const sentences: [string, string, string, string, string[]][] = [
    [
      'ilenler kasoda jatdu',
      '孩子们在房子里睡了。',
      'The children slept in the house.',
      '语法书 · 名词的数与格',
      ['名词', '位格']
    ],
    ['men telim aldum', '我拿了水。', 'I took the water.', '语法书 · 宾格', ['宾格']],
    [
      'sen nölüm sördüsen mü',
      '你看见我的太阳了吗？',
      'Did you see my sun?',
      '语法书 · 疑问',
      ['疑问']
    ],
    [
      'tovarum buraka verdü',
      '我的朋友给了面包。',
      'My friend gave bread.',
      '语法书 · 与格',
      ['与格']
    ],
    [
      'sepeler nölke kelmedü',
      '鸟儿们没有飞向太阳。',
      'The birds did not come to the sun.',
      '民歌',
      ['否定']
    ],
    [
      'kasolu ve ilen gölde',
      '房主和孩子在湖边。',
      'The householder and the child are at the lake.',
      '民歌',
      ['派生']
    ]
  ]
  const sents: Sentence[] = []
  for (const [text, zh, en, source, tags] of sentences) {
    const s = createSentence(L.id)
    s.text = text
    s.translation = { zh, en }
    s.source = source
    s.tags = tags
    s.orthoTexts[academic.id] = text.replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    p.sentences.push(s)
    sents.push(s)
  }
  sents[0].extraLines.push({ label: '直译', text: '孩子-复数 房子-位格 睡-过去' })
  sents[0].notes = '教科书例句：数与格叠加在同一个词上。'
  const badAe = analyzeAll(p, sents)
  kaso.senses[0].examples.push(sents[0].id)
  lex.get('ilen')!.senses[0].examples.push(sents[0].id, sents[5].id)
  if (badAe) console.log(`  Aelith 语料里还有 ${badAe} 个词没认出来`)

  // ── 短语簿 ──
  const phrase = (
    cat: string,
    text: string,
    zh: string,
    en: string,
    variants: [string, string][] = [],
    tags: string[] = []
  ): void => {
    const x = createPhrase(L.id, cat)
    x.text = text
    x.translation = { zh, en }
    x.variants = variants.map(([t, note]) => ({ text: t, note }))
    x.tags = tags
    p.phrasebook.push(x)
  }
  phrase(
    '问候',
    'nöl sen',
    '你好（字面：太阳你）',
    'hello (lit. sun you)',
    [['nöl', '熟人之间']],
    ['日常']
  )
  phrase('问候', 'jat oru', '晚安（字面：睡大）', 'good night', [], ['日常'])
  phrase('句式', 'kaso [名词]da', '在[名词]的房子里', 'at [noun]’s house', [], ['占位符'])
  phrase('旅行', 'sen kel mü', '你来吗？', 'Are you coming?', [['sen kelsen mü', '正式']], ['疑问'])
  const thanks = createPhrase(L.id, '礼貌')
  thanks.text = 'bil men'
  thanks.translation = { zh: '谢谢（字面：我知道）', en: 'thanks (lit. I know)' }
  thanks.pronunciations[rom.id] = { ipa: 'bil ˈmen', irregular: true }
  p.phrasebook.push(thanks)

  // ── 文档 ──
  const about = createDoc(null, '关于这个示例')
  about.markdown = [
    '# 关于这个示例',
    '',
    'Aelith 是虚构的黏着语，用来把千语集每个模块的功能摆一遍（数据都是编的，不对应任何真实语言）：',
    '',
    '- **语言**：语系树（Proto-Aelith → Aelith）、方言、字母表',
    '- **音系**：音位与特征、由特征生成的音类、多合字母、两套正字法、音节与重音、配列与造词',
    '- **文字**：卢恩刻文、映射规则、手填的文字写法',
    '- **音变**：两套规则集，阶段绑定语言，测试台词表',
    '- **语素**：词根 / 前缀 / 后缀 / 中缀 / 环缀 / 附着词 / 小品词，异体形环境，词源',
    '- **词库**：多义项、语域、方言、标签、维度、词源链（词根 / 复合 / 派生 / 音变 / 借词）、关系、配图、手改发音',
    '- **构形**：流水线的八种步骤（前缀、后缀、中缀、环缀、音变、模板、重叠、微调）、变体、继承、屏蔽槽位、手填表',
    '- **语料**：已 gloss 并确认的例句、其他正字法、自由行、出处与标签',
    '- **短语**：分类、变体、发音、方括号占位符',
    '- **文档**：项目级与语言级页面',
    '- **设置**：导出模板、缩写表',
    '',
    '想看孤立语、声调、音节文字与竖排，请打开另一个示例 **Tsahun**。'
  ].join('\n')
  const grammar = createDoc(L.id, 'Aelith 语法概要')
  grammar.markdown = [
    '# Aelith 语法概要',
    '',
    '## 音系',
    '- 七个元音分前后两组：a o u / e ö ü，i 中性。',
    '- 后缀里的 A / U 按词内最后一个元音实现（见「音变 → 元音和谐」）。',
    '',
    '## 名词',
    '词根-数-格：复数 -lAr，宾格 -(U)m，位格 -dA，与格 -kA。',
    '',
    '| | 单数 | 复数 |',
    '|---|---|---|',
    '| 主格 | kaso | kasolar |',
    '| 位格 | kasoda | kasolarda |',
    '',
    '## 动词',
    '词根-否定-时-人称：`sör-me-dü-m` 我没看见。第三人称零标记，否定现在第三人称用迂说法（构形里已屏蔽）。',
    '',
    '## 疑问',
    '句末附着词 =mU：`sen kelsen mü`。'
  ].join('\n')
  const protoDoc = createDoc(P.id, '祖语拟构说明')
  protoDoc.markdown =
    '# 祖语拟构说明\n\n词根表在「语素」页；「音变 → Proto → Aelith」给出到现代语的规则，用「整库演化」可以整表推导。'
  p.docs.push(about, grammar, protoDoc)

  // ── 缩写表、导出模板、默认列 ──
  abbrs(p, [
    ['SG', '单数', 'singular'],
    ['PL', '复数', 'plural'],
    ['NOM', '主格', 'nominative'],
    ['ACC', '宾格', 'accusative'],
    ['LOC', '位格', 'locative'],
    ['DAT', '与格', 'dative'],
    ['1', '第一人称', 'first person'],
    ['2', '第二人称', 'second person'],
    ['3', '第三人称', 'third person'],
    ['PRS', '现在', 'present'],
    ['PST', '过去', 'past'],
    ['NEG', '否定', 'negative'],
    ['POSS', '领属', 'possessive'],
    ['Q', '疑问', 'question'],
    ['AGT', '施事名词化', 'agent nominalizer'],
    ['DIM', '小称', 'diminutive'],
    ['SUP', '最高级', 'superlative'],
    ['PRIV', '无…的', 'privative']
  ])
  p.settings.exportTemplates.push(
    {
      id: newId(),
      name: '四行 gloss',
      kind: 'gloss',
      template:
        '{{text}}\n{{#tokens}}{{sep}}{{morphs}}{{/tokens}}\n{{#tokens}}{{sep}}{{gloss}}{{/tokens}}\n‘{{translation}}’（{{source}}）'
    },
    {
      id: newId(),
      name: '简明词条',
      kind: 'entry',
      template: '**{{lemma}}** /{{ipa}}/ {{pos}} — {{definition}}'
    }
  )
  p.settings.lexiconColumns = ['pos', 'def:zh', 'def:en', 'tags']
  save('Aelith.laim.json', p)
}

// ───────────────────────── Tsahun：孤立声调语 ─────────────────────────
function makeTsahun(): void {
  const p = createProject({
    name: 'Tsahun',
    template: 'blank',
    appVersion: '0.6.5',
    uiLocale: 'zh'
  })
  p.meta.author = '千语集示例'
  p.meta.description =
    '孤立声调语示例（虚构）：单音节、五声调、双正字法、音节文字的拼合与竖排、重叠构形、手填表、已 gloss 的语料。'
  const L = p.languages[0]
  L.abbr = 'ts'
  L.color = '#d97706'
  L.notes =
    '孤立声调语：单音节词，五个声调，无屈折，语法靠语序与小品词。罗马化用数字标调，另有西里尔正字法；音节文字不写声调。'
  L.alphabet = 'a e i o u p t k ts m n ng s h l w j'.split(' ')
  L.dialects = [{ id: newId(), name: '河谷话', abbr: 'R' }]
  const rom = L.orthographies[0]
  rom.name = '罗马化'
  rom.rulesToIpa = [
    '; 数字调 → 五度标调字母',
    'ts > t͡s',
    'ng > ŋ',
    '55 > ˥',
    '35 > ˧˥',
    '21 > ˨˩',
    '51 > ˥˩',
    '33 > ˧'
  ].join('\n')
  rom.rulesFromIpa = [
    't͡s > ts',
    'ŋ > ng',
    '˧˥ > 35',
    '˨˩ > 21',
    '˥˩ > 51',
    '˥ > 55',
    '˧ > 33'
  ].join('\n')
  L.orthographies.push({
    id: newId(),
    name: '西里尔正字',
    font: '',
    direction: 'ltr',
    rulesToIpa: '',
    rulesFromIpa: [
      't͡s > ц',
      'ŋ > ң',
      'w > в',
      'j > й',
      'h > х',
      'k > к',
      'p > п',
      't > т',
      'm > м',
      'n > н',
      's > с',
      'l > л',
      'a > а',
      'i > и',
      'u > у',
      'e > е',
      'o > о',
      '˥ > ⁵⁵',
      '˧˥ > ³⁵',
      '˨˩ > ²¹',
      '˥˩ > ⁵¹',
      '˧ > ³³'
    ].join('\n'),
    isPrimary: false
  })
  const cyr = L.orthographies[1]
  L.phonemes = 'p t k t͡s m n ŋ s h l w j a i u e o'.split(' ').map((s) => ({
    id: newId(),
    symbol: s,
    features:
      s === 't͡s'
        ? {
            type: 'consonant',
            voice: 'voiceless',
            place: 'alveolar',
            manner: 'affricate',
            syllabic: 'no'
          }
        : inferFeatures(s),
    graphemes: {},
    notes: ''
  }))
  L.digraphs = [{ from: 'ng', to: 'ŋ' }]
  L.classes = [
    { id: newId(), name: 'C', members: 'p t k ts m n ng s h l w j'.split(' '), featureQuery: null },
    { id: newId(), name: 'V', members: 'a i u e o'.split(' '), featureQuery: null },
    { id: newId(), name: 'T', members: ['55', '35', '21', '51', '33'], featureQuery: null }
  ]
  L.syllable = { enabled: true, template: '(C)V(C)', strategy: 'template' }
  L.prosody = {
    type: 'tone',
    stressPosition: 'initial',
    rules: '连读变调：21 在 55 前读 35。',
    tones: [
      { id: newId(), name: '高平', letter: '˥', digits: '55' },
      { id: newId(), name: '升', letter: '˧˥', digits: '35' },
      { id: newId(), name: '低降', letter: '˨˩', digits: '21' },
      { id: newId(), name: '降', letter: '˥˩', digits: '51' },
      { id: newId(), name: '中平', letter: '˧', digits: '33' }
    ]
  }
  L.phonotactics = {
    onsets: 'p t k t͡s m n ŋ s h l w j kw'.split(' '),
    nuclei: 'a i u e o ai'.split(' '),
    codas: ['n', 'ŋ', 'm', 'k', 'p', 't'],
    illegal: ['ŋi'],
    weights: { k: 2, t: 2, a: 3, kw: 0.5 },
    minSyllables: 1,
    maxSyllables: 1
  }

  const N = pos(p, '名词', 'noun', 'n.')
  const V = pos(p, '动词', 'verb', 'v.')
  const A = pos(p, '形容词', 'adjective', 'adj.')
  const PRO = pos(p, '代词', 'pronoun', 'pron.')
  const PART = pos(p, '小品词', 'particle', 'part.')
  const NUM = pos(p, '数词', 'numeral', 'num.')
  const number = category(p, '数', 'number', [
    ['单数', 'singular', 'SG'],
    ['复数', 'plural', 'PL']
  ])
  const degree = category(p, '级', 'degree', [
    ['原级', 'positive', 'POS'],
    ['强调', 'intensive', 'INT']
  ])
  const words: [string, PartOfSpeech, string, string, string[]][] = [
    ['tsa55', N, '水', 'water', ['自然']],
    ['tsa21', N, '火', 'fire', ['自然']],
    ['lun35', N, '人', 'person', ['人']],
    ['wa55', N, '房子', 'house', ['建筑']],
    ['mek33', N, '山', 'mountain', ['自然']],
    ['sip51', N, '鱼', 'fish', ['动物', '食物']],
    ['nok21', N, '鸟', 'bird', ['动物']],
    ['hu35', N, '路', 'road', []],
    ['kwe51', V, '吃', 'eat', ['食物']],
    ['hem55', V, '看', 'see', ['感知']],
    ['lai33', V, '来', 'come', ['运动']],
    ['pun21', V, '去', 'go', ['运动']],
    ['tsun35', V, '住', 'live', []],
    ['jam55', V, '给', 'give', []],
    ['pak51', A, '大', 'big', ['尺寸']],
    ['sin35', A, '小', 'small', ['尺寸']],
    ['hok33', A, '红', 'red', ['颜色']],
    ['ngo21', PRO, '我', 'I', []],
    ['ni33', PRO, '你', 'you', []],
    ['ta51', PRO, '他 / 她', 'he / she', []],
    ['ta33', PART, '完成体标记', 'perfective marker', []],
    ['lo21', PART, '疑问语气', 'question particle', []],
    ['ka55', PART, '领属连接', 'possessive linker', []],
    ['mo35', PART, '否定', 'negation', []],
    ['it55', NUM, '一', 'one', ['数']],
    ['ni51', NUM, '二', 'two', ['数']],
    ['sam33', NUM, '三', 'three', ['数']]
  ]
  const lex = new Map<string, Lexeme>()
  for (const [lemma, ps, zh, en, tags] of words) {
    const lx = createLexeme(L.id, lemma)
    lx.posId = ps.id
    lx.senses[0].definition = { zh, en }
    lx.tags = tags
    lx.stems = { 词干: lemma }
    p.lexemes.push(lx)
    lex.set(lemma, lx)
  }
  // 同音节异调的最小对
  lex.get('tsa55')!.relations.push({ kind: 'related', lexemeId: lex.get('tsa21')!.id })
  lex.get('tsa21')!.relations.push({ kind: 'related', lexemeId: lex.get('tsa55')!.id })
  lex.get('pak51')!.relations.push({ kind: 'antonym', lexemeId: lex.get('sin35')!.id })
  lex.get('sin35')!.relations.push({ kind: 'antonym', lexemeId: lex.get('pak51')!.id })
  const hu = lex.get('hu35')!
  const huWay = createSense()
  huWay.definition = { zh: '方法；办法', en: 'way; method' }
  huWay.register = '书面'
  hu.senses.push(huWay)
  hu.notes = '「路」引申为「方法」。'
  const tsa = lex.get('tsa55')!
  tsa.images.push({ id: newId(), dataUrl: svgImage('tsa55', '#2563eb'), caption: '水' })
  tsa.dialectIds = [L.dialects[0].id]
  tsa.pronunciations[rom.id] = { ipa: 't͡saː˥', irregular: true }
  // 复合词与借词
  const well = createLexeme(L.id, 'tsa55wa55')
  well.posId = N.id
  well.senses[0].definition = { zh: '井（字面：水屋）', en: 'well (lit. water-house)' }
  well.tags = ['复合', '建筑']
  well.stems = { 词干: 'tsa55wa55' }
  well.etymology = {
    type: 'compound',
    sources: [
      { kind: 'lexeme', id: tsa.id },
      { kind: 'lexeme', id: lex.get('wa55')!.id }
    ],
    stages: [],
    notes: '复合词修饰语在前。'
  }
  p.lexemes.push(well)
  for (const n of ['it55', 'ni51', 'sam33']) {
    const lx = lex.get(n)!
    lx.etymology = {
      type: 'borrowing',
      sources: [
        {
          kind: 'external',
          language: '邻语',
          form: n.replace(/\d+$/, ''),
          meaning: lx.senses[0].definition.zh
        }
      ],
      stages: [],
      notes: '数词整套借入，声调按本语音系重配。'
    }
  }
  // 语素：小品词与量词
  for (const [form, gloss, zh, en] of [
    ['ta33', 'PFV', '完成体', 'perfective'],
    ['lo21', 'Q', '疑问', 'question'],
    ['ka55', 'POSS', '领属', 'possessive'],
    ['mo35', 'NEG', '否定', 'negation']
  ]) {
    const m = createMorpheme(L.id, 'particle')
    m.form = form
    m.gloss = gloss
    m.meaning = { zh, en }
    m.tags = ['小品词']
    if (form === 'ta33')
      m.etymology = {
        type: 'derivation',
        sources: [{ kind: 'lexeme', id: lex.get('ta51')!.id }],
        stages: [{ id: newId(), form: 'ta51', type: '', notes: '第三人称代词虚化，变调' }],
        notes: ''
      }
    p.morphemes.push(m)
  }
  const clf = createMorpheme(L.id, 'root')
  clf.form = 'lun35'
  clf.gloss = 'CLF'
  clf.meaning = { zh: '量词（人）', en: 'classifier (people)' }
  clf.tags = ['量词']
  clf.notes = '与名词 lun35「人」同形，用在数词之后。'
  p.morphemes.push(clf)

  // 构形：孤立语也有——名词复数整词重叠，形容词强调重叠首音节；代词手填表
  const nounP = paradigm(p, '名词（重叠复数）', 'noun (reduplicated plural)', [number])
  nounP.generators[value(number, 'SG')] = pipeline('词干')
  nounP.generators[value(number, 'PL')] = pipeline(
    '词干',
    step('reduplication', { scope: 'full', length: 1 })
  )
  N.paradigmId = nounP.id
  const adjP = paradigm(p, '形容词（强调）', 'adjective (intensive)', [degree])
  adjP.generators[value(degree, 'POS')] = pipeline('词干')
  adjP.generators[value(degree, 'INT')] = pipeline(
    '词干',
    step('reduplication', { scope: 'initial', length: 2 })
  )
  A.paradigmId = adjP.id
  const proP = paradigm(p, '代词（手填）', 'pronoun (table)', [number])
  for (const v of number.values) proP.generators[v.id] = { kind: 'table' }
  PRO.paradigmId = proP.id
  lex.get('ngo21')!.forms = {
    单数: { surface: 'ngo21', derived: false, override: true, trace: [] },
    复数: { surface: 'ngo21 lun35', derived: false, override: true, trace: [] }
  }
  console.log(`  Tsahun 推导屈折形 ${deriveAll(p, L)} 个`)

  // ── 文字：音节文字（切罗基区），拼合 + 竖排 ──
  const syl = createScript('Tsahun 音节文字')
  syl.type = 'syllabary'
  syl.vertical = true
  syl.font.family = 'Segoe UI Historic'
  const cons = ['', 'p', 't', 'k', 'ts', 'm', 'n', 'ng', 's', 'h', 'l', 'w', 'j']
  const vows = ['a', 'i', 'u', 'e', 'o']
  let cp = 0x13a0
  for (const c of cons)
    for (const v of vows)
      syl.glyphs.push({
        id: newId(),
        char: String.fromCodePoint(cp++),
        name: `${c}${v}`,
        value: c + v,
        category: c ? 'syllable' : 'vowel',
        notes: ''
      })
  syl.glyphs.push({
    id: newId(),
    char: 'Ᏹ',
    name: 'killer',
    value: '°',
    category: 'sign',
    notes: '消音符：前一个音节的元音不读，用来写尾辅音'
  })
  syl.packing = {
    enabled: true,
    killer: '°',
    letterMap: '',
    marked: '',
    lengths: '',
    baseVowels: '',
    dummyVowel: 'a',
    letters: 'ts ng p t k m n s h l w j a i u e o',
    vowels: 'a i u e o'
  }
  syl.rules = '@glyphs'
  syl.notes =
    '拼合模式：mek → me + ka + 消音符。数字声调不写进文字。勾了「竖排显示」，语料与词库里都竖着排。'
  L.scripts.push(syl)

  // ── 语料 ──
  const sentences: [string, string, string, string, string[]][] = [
    ['ngo21 kwe51 ta33 sip51', '我吃了鱼。', 'I ate fish.', '语法书 · 体', ['完成体']],
    [
      'ni33 hem55 lun35 lo21',
      '你看见人了吗？',
      'Did you see the person?',
      '语法书 · 疑问',
      ['疑问']
    ],
    ['ta51 ka55 wa55 pak51', '他的房子大。', 'His house is big.', '语法书 · 领属', ['领属']],
    ['nok21 mo35 lai33', '鸟不来。', 'The bird does not come.', '语法书 · 否定', ['否定']],
    [
      'sam33 lun35 tsun35 mek33',
      '三个人住在山上。',
      'Three people live on the mountain.',
      '民间故事',
      ['数词', '量词']
    ],
    [
      'lun35lun35 pun21 hu35',
      '人们上路了。',
      'The people took the road.',
      '民间故事',
      ['复数', '重叠']
    ]
  ]
  const sents: Sentence[] = []
  for (const [text, zh, en, source, tags] of sentences) {
    const s = createSentence(L.id)
    s.text = text
    s.translation = { zh, en }
    s.source = source
    s.tags = tags
    p.sentences.push(s)
    sents.push(s)
  }
  sents[0].orthoTexts[cyr.id] = 'ңо²¹ кве⁵¹ та³³ сип⁵¹'
  sents[0].extraLines.push({ label: '声调', text: '21 51 33 51' })
  sents[1].notes = '疑问语气词放句末。'
  const badTs = analyzeAll(p, sents)
  lex.get('kwe51')!.senses[0].examples.push(sents[0].id)
  lex.get('lun35')!.senses[0].examples.push(sents[1].id, sents[5].id)
  if (badTs) console.log(`  Tsahun 语料里还有 ${badTs} 个词没认出来`)

  // ── 短语簿 ──
  const phrase = (
    cat: string,
    text: string,
    zh: string,
    en: string,
    variants: [string, string][] = []
  ): void => {
    const x = createPhrase(L.id, cat)
    x.text = text
    x.translation = { zh, en }
    x.variants = variants.map(([t, note]) => ({ text: t, note }))
    x.tags = [cat]
    p.phrasebook.push(x)
  }
  phrase('问候', 'ni33 lai33 lo21', '你来了？', 'You’ve come?', [['lai33 lo21', '熟人之间']])
  phrase('问候', 'hem55 ni33', '再见（字面：看你）', 'goodbye (lit. see you)')
  phrase('句式', 'ngo21 jam55 [数词] tsa55', '我给[数词]份水', 'I give [numeral] water')
  phrase('市集', 'sip51 pak51 lo21', '鱼大吗？', 'Is the fish big?')

  // ── 文档、缩写、导出模板 ──
  const about = createDoc(null, '关于这个示例')
  about.markdown = [
    '# 关于这个示例',
    '',
    'Tsahun 是虚构的孤立声调语，与另一个示例 **Aelith** 互补，专门展示这些功能：',
    '',
    '- **声调**：韵律类型选「声调」，五个调各有调符与数字',
    '- **双正字法**：罗马化（数字标调）与西里尔正字，例句可以并列两种写法',
    '- **文字**：音节文字的**拼合**（辅音+元音自动拼格，尾辅音用消音符）与**竖排显示**',
    '- **构形**：孤立语也有构形——重叠出复数与强调，代词用手填表',
    '- **语料**：重叠形也能被自动 gloss 认出来（`lun35lun35`）',
    '- **词库**：同音异调的最小对、复合词、整套借入的数词'
  ].join('\n')
  const doc = createDoc(L.id, 'Tsahun 语法概要')
  doc.markdown = [
    '# Tsahun 语法概要',
    '',
    '## 声调',
    '五个声调：55 高平、35 升、21 低降、51 降、33 中平。同音节异调是不同的词：tsa55「水」/ tsa21「火」。',
    '',
    '## 语序',
    'SVO；领属用 ka55 连接：`ta51 ka55 wa55` 他的房子。',
    '',
    '## 体与否定',
    '完成体 ta33 在动词后；否定 mo35 在动词前。',
    '',
    '## 复数',
    '名词整词重叠：`lun35lun35` 人们。'
  ].join('\n')
  p.docs.push(about, doc)
  abbrs(p, [
    ['PFV', '完成体', 'perfective'],
    ['Q', '疑问', 'question'],
    ['POSS', '领属', 'possessive'],
    ['NEG', '否定', 'negation'],
    ['CLF', '量词', 'classifier'],
    ['SG', '单数', 'singular'],
    ['PL', '复数', 'plural']
  ])
  p.settings.exportTemplates.push({
    id: newId(),
    name: '三行 gloss',
    kind: 'gloss',
    template: '{{text}}\n{{gloss}}\n‘{{translation}}’'
  })
  p.settings.lexiconColumns = ['pos', 'def:zh', 'tags', `script:${syl.id}`]
  save('Tsahun.laim.json', p)
}

// 瑟乌丝林语示例项目由 scripts/make-theusrin.ts 单独生成（npm run examples:theusrin）。

makeAelith()
makeTsahun()
