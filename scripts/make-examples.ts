/**
 * 生成示例 / 夹具项目文件：
 *   examples/Aelith.laim.json           黏着先验语（虚构测试数据）
 *   examples/Tsahun.laim.json           孤立声调语（虚构测试数据）
 *   examples/private/Theusrin.laim.json 瑟乌丝林语（需要 tests/fixtures/private 里的 CSV，不入库）
 *
 * 运行：npm run examples
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createProject, createLanguage, createLexeme, createMorpheme, createRuleSet, createSentence, newId, now } from '$lib/core/factory'
import { serializeProject } from '$lib/core/serialize'
import { parseCsv } from '$lib/core/csv'
import { applyCsvImport, defaultMapping, type CsvMapping, type FieldSpec } from '$lib/importers/csvImport'
import { fromYinbianji } from '$lib/engine/sca'
import type { GrammaticalCategory, Id, PartOfSpeech, Project } from '$lib/core/model'

const root = process.cwd()
const outDir = join(root, 'examples')
mkdirSync(join(outDir, 'private'), { recursive: true })

function pos(p: Project, zh: string, en: string, abbr: string): PartOfSpeech {
  const x: PartOfSpeech = { id: newId(), name: { zh, en }, abbr, paradigmId: null }
  p.posList.push(x)
  return x
}
function category(p: Project, zh: string, en: string, values: [string, string, string][]): GrammaticalCategory {
  const c: GrammaticalCategory = { id: newId(), name: { zh, en }, values: values.map(([vzh, ven, abbr]) => ({ id: newId(), name: { zh: vzh, en: ven }, abbr })) }
  p.categories.push(c)
  return c
}
function value(c: GrammaticalCategory, abbr: string): Id {
  return c.values.find((v) => v.abbr === abbr)!.id
}
function save(name: string, p: Project): void {
  const file = join(outDir, name)
  writeFileSync(file, serializeProject(p), 'utf8')
  console.log('wrote', file, `${p.languages.length} langs, ${p.lexemes.length} lexemes, ${p.morphemes.length} morphemes`)
}

// ───────────────────────── Aelith：黏着先验语 ─────────────────────────
function makeAelith(): void {
  const p = createProject({ name: 'Aelith', template: 'blank', appVersion: '0.1.0', uiLocale: 'zh' })
  const L = p.languages[0]
  L.abbr = 'ae'
  L.notes = '虚构的黏着语测试夹具：前后元音和谐，名词后缀链 词根-数-格-领属，动词 词根-否定-时-人称。'
  L.alphabet = 'a b d e g i j k l m n o ö p r s t u ü v w'.split(' ')
  L.phonemes = 'p t k b d g m n s v r l j w a e i o u ö ü'.split(' ').map((s) => ({ id: newId(), symbol: s, features: {}, graphemes: {}, notes: '' }))
  L.classes = [
    { id: newId(), name: 'C', members: 'p t k b d g m n s v r l j w'.split(' '), featureQuery: null },
    { id: newId(), name: 'V', members: 'a e i o u ö ü'.split(' '), featureQuery: null },
    { id: newId(), name: 'Back', members: ['a', 'o', 'u'], featureQuery: null },
    { id: newId(), name: 'Front', members: ['e', 'ö', 'ü'], featureQuery: null }
  ]
  L.syllable = { enabled: true, template: '(C)V(C)', strategy: 'template' }
  L.prosody = { type: 'stress', rules: '; 重音固定在第一音节', tones: [] }
  L.phonotactics = { onsets: 'p t k b d g m n s v r l j w'.split(' '), nuclei: 'a e i o u ö ü'.split(' '), codas: 'n l r s t k m'.split(' '), illegal: ['jj', 'ww'], weights: {}, minSyllables: 1, maxSyllables: 3 }

  const N = pos(p, '名词', 'noun', 'n.')
  const V = pos(p, '动词', 'verb', 'v.')
  const A = pos(p, '形容词', 'adjective', 'adj.')
  const PRO = pos(p, '代词', 'pronoun', 'pron.')
  const num = category(p, '数', 'number', [['单数', 'singular', 'SG'], ['复数', 'plural', 'PL']])
  const kase = category(p, '格', 'case', [['主格', 'nominative', 'NOM'], ['宾格', 'accusative', 'ACC'], ['位格', 'locative', 'LOC'], ['与格', 'dative', 'DAT']])
  const person = category(p, '人称', 'person', [['第一人称', 'first person', '1'], ['第二人称', 'second person', '2'], ['第三人称', 'third person', '3']])
  const tense = category(p, '时', 'tense', [['现在', 'present', 'PRS'], ['过去', 'past', 'PST']])
  const polarity = category(p, '极性', 'polarity', [['肯定', 'affirmative', 'AFF'], ['否定', 'negative', 'NEG']])
  const harmony = category(p, '和谐类', 'harmony class', [['后元音', 'back', 'B'], ['前元音', 'front', 'F']])

  const suffix = (form: string, gloss: string, zh: string, en: string, allo: [string, string][] = [], feats: Record<Id, Id> = {}, type: 'suffix' | 'clitic' | 'particle' = 'suffix'): void => {
    const m = createMorpheme(L.id, type)
    m.form = form
    m.gloss = gloss
    m.meaning = { zh, en }
    m.allomorphs = allo.map(([f, env]) => ({ form: f, environment: env }))
    m.features = feats
    p.morphemes.push(m)
  }
  suffix('-lAr', 'PL', '复数', 'plural', [['-lar', '{Back}[^aeouöü]*_'], ['-ler', '{Front}[^aeouöü]*_']], { [num.id]: value(num, 'PL') })
  suffix('-(U)m', 'ACC', '宾格', 'accusative', [['-m', 'V_'], ['-um', '{Back}C_'], ['-üm', '{Front}C_']], { [kase.id]: value(kase, 'ACC') })
  suffix('-dA', 'LOC', '位格', 'locative', [['-da', '{Back}[^aeouöü]*_'], ['-de', '{Front}[^aeouöü]*_']], { [kase.id]: value(kase, 'LOC') })
  suffix('-kA', 'DAT', '与格', 'dative', [['-ka', '{Back}[^aeouöü]*_'], ['-ke', '{Front}[^aeouöü]*_']], { [kase.id]: value(kase, 'DAT') })
  suffix('-(U)m', '1SG.POSS', '我的', 'my', [['-m', 'V_'], ['-um', '{Back}C_'], ['-üm', '{Front}C_']], { [person.id]: value(person, '1') })
  suffix('-(U)n', '2SG.POSS', '你的', 'your', [['-n', 'V_'], ['-un', '{Back}C_'], ['-ün', '{Front}C_']], { [person.id]: value(person, '2') })
  suffix('-sI', '3SG.POSS', '他的', 'his/her', [['-si', '_']], { [person.id]: value(person, '3') })
  suffix('-mA', 'NEG', '否定', 'negative', [['-ma', '{Back}[^aeouöü]*_'], ['-me', '{Front}[^aeouöü]*_']], { [polarity.id]: value(polarity, 'NEG') })
  suffix('-dU', 'PST', '过去', 'past', [['-du', '{Back}[^aeouöü]*_'], ['-dü', '{Front}[^aeouöü]*_']], { [tense.id]: value(tense, 'PST') })
  suffix('-(U)m', '1SG', '第一人称单数', 'first singular', [['-m', 'V_'], ['-um', '{Back}C_'], ['-üm', '{Front}C_']], { [person.id]: value(person, '1') })
  suffix('-sAn', '2SG', '第二人称单数', 'second singular', [['-san', '{Back}[^aeouöü]*_'], ['-sen', '{Front}[^aeouöü]*_']], { [person.id]: value(person, '2') })
  suffix('=mU', 'Q', '疑问', 'question', [['=mu', '{Back}[^aeouöü]*_'], ['=mü', '{Front}[^aeouöü]*_']], {}, 'clitic')
  suffix('ve', 'and', '和', 'and', [], {}, 'particle')

  const words: [string, PartOfSpeech, string, string, string[]][] = [
    ['kaso', N, '房子', 'house', ['基础']],
    ['teli', N, '水', 'water', ['基础', '自然']],
    ['nöl', N, '太阳', 'sun', ['自然']],
    ['ura', N, '山', 'mountain', ['自然']],
    ['sepe', N, '鸟', 'bird', ['动物']],
    ['muk', N, '石头', 'stone', ['自然']],
    ['ilen', N, '孩子', 'child', ['人']],
    ['tovar', N, '朋友', 'friend', ['人']],
    ['göl', N, '湖', 'lake', ['自然']],
    ['dünar', N, '世界', 'world', []],
    ['bura', N, '面包', 'bread', ['食物']],
    ['kel-', V, '来', 'come', ['运动']],
    ['git-', V, '去', 'go', ['运动']],
    ['sör-', V, '看见', 'see', ['感知']],
    ['al-', V, '拿；取', 'take', []],
    ['ver-', V, '给', 'give', []],
    ['ol-', V, '是；成为', 'be; become', []],
    ['je-', V, '吃', 'eat', ['食物']],
    ['bil-', V, '知道', 'know', ['认知']],
    ['jat-', V, '睡', 'sleep', []],
    ['kara', A, '黑的', 'black', ['颜色']],
    ['pelin', A, '小的', 'small', ['尺寸']],
    ['oru', A, '大的', 'big', ['尺寸']],
    ['sürü', A, '快的', 'fast', []],
    ['men', PRO, '我', 'I', []],
    ['sen', PRO, '你', 'you (sg.)', []],
    ['o', PRO, '他 / 她 / 它', 'he / she / it', []],
    ['biz', PRO, '我们', 'we', []]
  ]
  for (const [lemma, ps, zh, en, tags] of words) {
    const lx = createLexeme(L.id, lemma)
    lx.posId = ps.id
    lx.senses[0].definition = { zh, en }
    lx.tags = tags
    const vowels = lemma.match(/[aeiouöü]/g) ?? []
    const last = vowels[vowels.length - 1]
    if (last) lx.features[harmony.id] = value(harmony, 'aou'.includes(last) ? 'B' : 'F')
    lx.stems = { 词干: lemma.replace(/-$/, '') }
    p.lexemes.push(lx)
  }

  const rs = createRuleSet(
    '元音和谐',
    [
      '; 后缀里的大写 A / U 是原音位，按词内最后一个元音的前后性实现；',
      '; Ŭ 是连接元音，词干以元音结尾时脱落；语素界写 ¢，最后删掉',
      'C=ptkbdgmnsvrljw',
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
  rs.testWords = 'kaso¢lAr¢Ŭm\nnöl¢dA\nilen¢lAr¢kA\nsör¢mA¢dU¢Ŭm\nkel¢dU¢sAn\nteli¢Ŭm'
  rs.stageLanguages = { 底层: L.id, 表层: L.id }
  p.ruleSets.push(rs)

  const sentences: [string, string, string][] = [
    ['ilenler kasoda jatdu', '孩子们在房子里睡了。', 'The children slept in the house.'],
    ['men teliüm aldum', '我拿了我的水。', 'I took my water.'],
    ['sen nölüm sördün mü', '你看见我的太阳了吗？', 'Did you see my sun?'],
    ['tovarum burake verdü', '我的朋友给了面包。', 'My friend gave bread.']
  ]
  for (const [text, zh, en] of sentences) {
    const s = createSentence(L.id)
    s.text = text
    s.translation = { zh, en }
    s.source = '夹具'
    p.sentences.push(s)
  }
  p.meta.description = '黏着先验语测试夹具（虚构）：元音和谐、多槽位后缀、异体形环境。'
  save('Aelith.laim.json', p)
}

// ───────────────────────── Tsahun：孤立声调语 ─────────────────────────
function makeTsahun(): void {
  const p = createProject({ name: 'Tsahun', template: 'blank', appVersion: '0.1.0', uiLocale: 'zh' })
  const L = p.languages[0]
  L.abbr = 'ts'
  L.notes = '虚构的孤立声调语测试夹具：单音节词，五个声调，无屈折，语法靠语序与小品词。罗马化用数字标调，另有西里尔字母正字法。'
  const rom = L.orthographies[0]
  rom.name = '罗马化'
  rom.rulesToIpa = ['; 数字调 → 五度标调字母', 'ts > t͡s', 'ng > ŋ', '55 > ˥', '35 > ˧˥', '21 > ˨˩', '51 > ˥˩', '33 > ˧'].join('\n')
  L.orthographies.push({
    id: newId(),
    name: '西里尔正字',
    font: '',
    direction: 'ltr',
    rulesToIpa: '',
    rulesFromIpa: ['t͡s > ц', 'ŋ > ң', 'w > в', 'j > й', 'h > х', 'k > к', 'p > п', 't > т', 'm > м', 'n > н', 's > с', 'l > л', 'a > а', 'i > и', 'u > у', 'e > е', 'o > о', '˥ > ⁵⁵', '˧˥ > ³⁵', '˨˩ > ²¹', '˥˩ > ⁵¹', '˧ > ³³'].join('\n'),
    isPrimary: false
  })
  L.phonemes = 'p t k t͡s m n ŋ s h l w j a i u e o'.split(' ').map((s) => ({ id: newId(), symbol: s, features: {}, graphemes: {}, notes: '' }))
  L.classes = [
    { id: newId(), name: 'C', members: 'p t k ts m n ng s h l w j'.split(' '), featureQuery: null },
    { id: newId(), name: 'V', members: 'a i u e o'.split(' '), featureQuery: null }
  ]
  L.syllable = { enabled: true, template: '(C)V(C)', strategy: 'template' }
  L.prosody = {
    type: 'tone',
    rules: '',
    tones: [
      { id: newId(), name: '高平', letter: '˥', digits: '55' },
      { id: newId(), name: '升', letter: '˧˥', digits: '35' },
      { id: newId(), name: '低降', letter: '˨˩', digits: '21' },
      { id: newId(), name: '降', letter: '˥˩', digits: '51' },
      { id: newId(), name: '中平', letter: '˧', digits: '33' }
    ]
  }
  L.phonotactics = { onsets: 'p t k ts m n ng s h l w j'.split(' '), nuclei: 'a i u e o'.split(' '), codas: ['n', 'ng', 'k', 'p', 't'], illegal: [], weights: {}, minSyllables: 1, maxSyllables: 1 }

  const N = pos(p, '名词', 'noun', 'n.')
  const V = pos(p, '动词', 'verb', 'v.')
  const A = pos(p, '形容词', 'adjective', 'adj.')
  const PRO = pos(p, '代词', 'pronoun', 'pron.')
  const PART = pos(p, '小品词', 'particle', 'part.')
  const words: [string, PartOfSpeech, string, string][] = [
    ['tsa55', N, '水', 'water'],
    ['tsa21', N, '火', 'fire'],
    ['lun35', N, '人', 'person'],
    ['wa55', N, '房子', 'house'],
    ['mek33', N, '山', 'mountain'],
    ['sip51', N, '鱼', 'fish'],
    ['nok21', N, '鸟', 'bird'],
    ['hu35', N, '路', 'road'],
    ['kwe51', V, '吃', 'eat'],
    ['hem55', V, '看', 'see'],
    ['lai33', V, '来', 'come'],
    ['pun21', V, '去', 'go'],
    ['tsun35', V, '住', 'live'],
    ['jam55', V, '给', 'give'],
    ['pak51', A, '大', 'big'],
    ['sin35', A, '小', 'small'],
    ['hok33', A, '红', 'red'],
    ['ngo21', PRO, '我', 'I'],
    ['ni33', PRO, '你', 'you'],
    ['ta51', PRO, '他 / 她', 'he / she'],
    ['ta33', PART, '完成体标记', 'perfective marker'],
    ['lo21', PART, '疑问语气', 'question particle'],
    ['ka55', PART, '领属连接', 'possessive linker'],
    ['mo35', PART, '否定', 'negation']
  ]
  for (const [lemma, ps, zh, en] of words) {
    const lx = createLexeme(L.id, lemma)
    lx.posId = ps.id
    lx.senses[0].definition = { zh, en }
    p.lexemes.push(lx)
  }
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
    p.morphemes.push(m)
  }
  const sentences: [string, string, string][] = [
    ['ngo21 kwe51 ta33 sip51', '我吃了鱼。', 'I ate fish.'],
    ['ni33 hem55 lun35 lo21', '你看见人了吗？', 'Did you see the person?'],
    ['ta51 ka55 wa55 pak51', '他的房子大。', 'His house is big.'],
    ['nok21 mo35 lai33', '鸟不来。', 'The bird does not come.']
  ]
  for (const [text, zh, en] of sentences) {
    const s = createSentence(L.id)
    s.text = text
    s.translation = { zh, en }
    s.source = '夹具'
    p.sentences.push(s)
  }
  p.meta.description = '孤立声调语测试夹具（虚构）：单音节、五声调、无范式、双正字法。'
  save('Tsahun.laim.json', p)
}

// ───────────────────────── Theusrin：用户的私有数据 ─────────────────────────
function makeTheusrin(): void {
  const priv = join(root, 'tests', 'fixtures', 'private')
  const fx = join(root, 'tests', 'fixtures')
  if (!existsSync(join(priv, '瑟乌丝林语词表 - Thsr H..csv'))) {
    console.log('skip Theusrin: private CSVs not present')
    return
  }
  const read = (f: string): string => readFileSync(f, 'utf8')
  const p = createProject({ name: '瑟乌丝林语', template: 'family', appVersion: '0.1.0', uiLocale: 'zh', familyNames: { proto: '原始希克林语', daughters: ['瑟乌丝林语', '群岛希克林语'] } })
  const [pskr, tsr, askr] = p.languages
  pskr.abbr = 'PSkr'
  tsr.abbr = 'Tsr'
  askr.abbr = 'ASkr'
  tsr.color = '#0E9F8A'
  askr.color = '#3B82F6'

  const rsT = createRuleSet('原始希克林语 → 瑟乌丝林语', fromYinbianji(read(join(fx, 'theusrin', 'Category.txt')), read(join(fx, 'theusrin', 'Replace.txt')), read(join(fx, 'theusrin', 'Rule.txt'))))
  rsT.testWords = read(join(fx, 'theusrin', 'Lexicon.txt')).trim()
  rsT.stageLanguages = { PSkr: pskr.id, Tsr: tsr.id, Orthography: tsr.id }
  const rsA = createRuleSet('原始希克林语 → 群岛希克林语', fromYinbianji(read(join(fx, 'archipelago', 'Category.txt')), read(join(fx, 'archipelago', 'Replace.txt')), read(join(fx, 'archipelago', 'Rule.txt'))))
  rsA.stageLanguages = { PSkr: pskr.id }
  p.ruleSets.push(rsT, rsA)

  const N = pos(p, '名词', 'noun', 'n.')
  const V = pos(p, '动词', 'verb', 'v.')
  const A = pos(p, '形容词', 'adjective', 'adj.')

  const imp = (file: string, fields: Record<string, FieldSpec>, target: CsvMapping['target'], languageId: Id, ps: PartOfSpeech | null): void => {
    const rows = parseCsv(read(join(priv, file))).rows
    const m = defaultMapping(languageId, rows[0].length)
    m.target = target
    m.columns = rows[0].map((h) => fields[h.trim()] ?? { kind: 'ignore' })
    const before = p.lexemes.length
    const r = applyCsvImport(p, rows, m)
    if (ps) for (const lx of p.lexemes.slice(before)) lx.posId = ps.id
    console.log(file, '→', r.created, 'created')
  }
  imp(
    '瑟乌丝林语词表 - Thsr H..csv',
    {
      原始希克林语: { kind: 'protoForm' },
      释义: { kind: 'definition', lang: 'zh' },
      备注: { kind: 'notes' },
      名词类别: { kind: 'feature', category: '名词类别' },
      重音类别: { kind: 'feature', category: '重音类别' },
      字典形: { kind: 'lemma' },
      强形: { kind: 'stem', name: '强形' },
      弱形: { kind: 'stem', name: '弱形' },
      '（中形）': { kind: 'stem', name: '中形' },
      及物格: { kind: 'form', slot: '及物格' },
      不及物格: { kind: 'form', slot: '不及物格' },
      欠格: { kind: 'form', slot: '欠格' },
      斜格: { kind: 'form', slot: '斜格' },
      复数: { kind: 'form', slot: '复数' }
    },
    'lexemes',
    tsr.id,
    N
  )
  imp(
    '瑟乌丝林语词表 - Thsr L..csv',
    {
      原始希克林语: { kind: 'protoForm' },
      释义: { kind: 'definition', lang: 'zh' },
      前缀点: { kind: 'notes' },
      动词类别: { kind: 'feature', category: '动词类别' },
      '字典形/无焦点形': { kind: 'lemma' },
      强焦点形: { kind: 'form', slot: '强焦点形' },
      弱焦点形: { kind: 'form', slot: '弱焦点形' },
      弱失焦形: { kind: 'form', slot: '弱失焦形' },
      强失焦形: { kind: 'form', slot: '强失焦形' },
      词干元音: { kind: 'stem', name: '词干元音' },
      副动词型: { kind: 'form', slot: '副动词型' },
      动名词: { kind: 'form', slot: '动名词' },
      动形词: { kind: 'form', slot: '动形词' },
      动副词: { kind: 'form', slot: '动副词' }
    },
    'lexemes',
    tsr.id,
    V
  )
  imp(
    '瑟乌丝林语词表 - Thsr X..csv',
    {
      原始希克林语: { kind: 'protoForm' },
      释义: { kind: 'definition', lang: 'zh' },
      备注: { kind: 'notes' },
      来源类型: { kind: 'feature', category: '来源类型' },
      字典形: { kind: 'lemma' },
      复数: { kind: 'form', slot: '复数' }
    },
    'lexemes',
    tsr.id,
    A
  )
  imp('瑟乌丝林语词表 - PSkr.csv', { 词根: { kind: 'lemma' }, 释义: { kind: 'definition', lang: 'zh' }, 备注: { kind: 'notes' }, 词性: { kind: 'tags' } }, 'morphemes', pskr.id, null)
  p.meta.description = '从五张词表和音变姬规则生成；T 表（惯用形 / 限定词 / 数词 / 小品词 / 代词）需在向导里分组导入。'
  p.meta.updatedAt = now()
  save(join('private', 'Theusrin.laim.json'), p)
}

makeAelith()
makeTsahun()
makeTheusrin()
