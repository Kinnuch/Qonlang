/**
 * 重建「瑟乌丝林语」示例项目。数据来源全部是既有资料，本脚本只做搬运与结构化：
 *
 *   站点仓库（默认 ../kinnuch.github.io，可用 QONLANG_SITE 覆盖）
 *     laim/Theusṛin.md                     语法书：音系表、科飒尔文字形表、98 条 gloss 例句、
 *                                          惯用语与问候语、行间标注缩写、各章正文 → 文档页
 *     laim/shikrin.assets/SCA/*.txt        音变姬规则：PSkr → PTsr → ATsr → OTsr → Tsr → 正字法
 *     assets/fonts/kessar.woff2            科飒尔文字体 → 内嵌进项目
 *
 *   本仓库 tests/fixtures/private/*.csv    词表：名词 H / 动词 L / 形容词 X / 惯用与词表 T / PSkr 词根
 *
 * 输出 examples/private/Theusrin.laim.json（私有词表，默认不进版本库）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  createDoc,
  createLanguage,
  createLexeme,
  createMorpheme,
  createPhrase,
  createRuleSet,
  createScript,
  createSentence,
  createProject,
  newId,
  now,
  createSense
} from '$lib/core/factory'
import { serializeProject } from '$lib/core/serialize'
import { parseCsv } from '$lib/core/csv'
import { fromYinbianji } from '$lib/engine/sca'
import { inferFeatures } from '$lib/ipa/features'
import type {
  GrammaticalCategory,
  Glyph,
  Id,
  Language,
  Lexeme,
  Paradigm,
  PartOfSpeech,
  Project,
  SlotGenerator,
  Etymology
} from '$lib/core/model'

const root = join(__dirname, '..')
const SITE = process.env['QONLANG_SITE'] ?? join(root, '..', 'kinnuch.github.io')
const PRIV = join(root, 'tests', 'fixtures', 'private')
const OUT = join(root, 'examples', 'private')

const read = (p: string) => readFileSync(p, 'utf8')
const has = (p: string) => existsSync(p)

// 语法书文件名里的 ṛ 在磁盘上是分解形式，按前缀找
function grammarPath(): string | null {
  const dir = join(SITE, 'laim')
  if (!has(dir)) return null
  const f = readdirSync(dir).find((x) => x.toLowerCase().startsWith('theus') && x.endsWith('.md'))
  return f ? join(dir, f) : null
}

// ───────────────────────── 通用小工具 ─────────────────────────

function slice(s: string, from: string, to?: string): string {
  const a = s.indexOf(from)
  if (a < 0) return ''
  const b = to ? s.indexOf(to, a + from.length) : -1
  return b < 0 ? s.slice(a) : s.slice(a, b)
}

/** 去掉站点特有的行内标记，留下可读文本 */
function plain(x: string): string {
  return x
    .replace(/<span class="kessar">[^<]*<\/span>/g, '')
    .replace(/<abbr[^>]*title="([^"]*)"[^>]*>([^<]*)<\/abbr>/g, '$2〔$1〕')
    .replace(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g, '$1（$2）')
    .replace(/<sup>(.*?)<\/sup>/g, '^$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#124;/g, '|')
    .replace(/\[\^\d+\]/g, '')
    .trim()
}

/** 表格行 → 单元格数组 */
function cells(line: string): string[] {
  const t = line.trim()
  if (!t.startsWith('|')) return []
  return t
    .slice(1, t.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((c) => c.trim())
}
const isSep = (c: string[]) => c.length > 0 && c.every((x) => /^:?-{2,}:?$/.test(x))

/** 抽出一段文本里的所有表格（表头 + 数据行，原始单元格） */
function tables(section: string): string[][][] {
  const out: string[][][] = []
  let cur: string[][] | null = null
  for (const line of section.split('\n')) {
    const c = cells(line)
    if (c.length) {
      if (isSep(c)) continue
      if (!cur) {
        cur = []
        out.push(cur)
      }
      cur.push(c)
    } else cur = null
  }
  return out
}

const SMALLCAPS: Record<string, string> = {
  ᴀ: 'A',
  ᴃ: 'B',
  ᴄ: 'C',
  ᴅ: 'D',
  ᴇ: 'E',
  ꜰ: 'F',
  ɢ: 'G',
  ʜ: 'H',
  ɪ: 'I',
  ᴊ: 'J',
  ᴋ: 'K',
  ʟ: 'L',
  ᴍ: 'M',
  ɴ: 'N',
  ᴏ: 'O',
  ᴘ: 'P',
  ꞯ: 'Q',
  ʀ: 'R',
  ꜱ: 'S',
  ᴛ: 'T',
  ᴜ: 'U',
  ᴠ: 'V',
  ᴡ: 'W',
  ʏ: 'Y',
  ᴢ: 'Z'
}
/** 「预言式ᴘʀᴇᴅ」→ { name: '预言式', abbr: 'PRED' } */
function splitAbbr(cell: string): { name: string; abbr: string } | null {
  const t = plain(cell).replace(/\*\*/g, '').trim()
  if (!t) return null
  let name = ''
  let abbr = ''
  for (const ch of t) {
    const up = SMALLCAPS[ch]
    if (up) abbr += up
    else name += ch
  }
  return abbr ? { name: name.trim(), abbr } : null
}

// ───────────────────────── 项目骨架 ─────────────────────────

const p: Project = createProject({
  name: '瑟乌丝林语',
  template: 'blank',
  appVersion: '0.4.0',
  uiLocale: 'zh'
})
p.languages = []
p.settings.glossLanguages = ['zh', 'en']
// 中点分隔词头与词干，撇号接附着词；两者都算语素边界，语料切分与索引都要认
p.settings.morphemeBoundaries = ['-', '=', '·', "'"]
p.meta.author = 'Kinnuch'
p.meta.description =
  '希克林语系北支的瑟乌丝林语（Theusrin）。音系、科飒尔文、四格系统、动词焦点与整条音变链均取自 kinnuch.github.io 的语法书，词库来自作者的词表。'

function lang(
  name: string,
  abbr: string,
  color: string,
  parent: Language | null,
  notes: string
): Language {
  const l = createLanguage({ name, abbr, color, parentId: parent?.id ?? null, notes })
  p.languages.push(l)
  return l
}
const PSkr = lang(
  '原始希克林语',
  'PSkr',
  '#8B7355',
  null,
  '希克林语系的共同祖语，词根表见「语素」页。'
)
const PTsr = lang(
  '原始瑟乌丝林语',
  'PTsr',
  '#A0785A',
  PSkr,
  '词干重整发生的阶段：格缀附着于真词干之后。'
)
const ATsr = lang(
  '上古瑟乌丝林语',
  'ATsr',
  '#B08968',
  PTsr,
  '咝音化（腭-软腭-唇化软腭三分并入两分）发生的阶段。'
)
const OTsr = lang('古瑟乌丝林语', 'OTsr', '#6B8E9F', ATsr, '云鲸纪之前的书面语阶段。')
const Tsr = lang(
  '瑟乌丝林语',
  'Tsr',
  '#0E9F8A',
  OTsr,
  '标准语＝北边境森林的羽归木方言（埃泽尔方言）。'
)
p.settings.defaultLanguageId = Tsr.id
Tsr.dialects = [
  { id: newId(), name: '羽归木方言（埃泽尔）', abbr: 'Aed' },
  { id: newId(), name: '南林地方言（多瑞安）', abbr: 'Dor' },
  { id: newId(), name: '北涧汀方言（法尔芙尔）', abbr: 'Fal' }
]

// ───────────────────────── 音系 ─────────────────────────

const rom = Tsr.orthographies[0]
rom.name = '拉丁转写'
rom.font = ''

function phoneme(symbol: string, grapheme: string, notes = '', extra: Record<string, string> = {}) {
  Tsr.phonemes.push({
    id: newId(),
    symbol,
    features: { ...inferFeatures(symbol), ...extra },
    graphemes: { [rom.id]: grapheme },
    notes
  })
}
// 辅音（正字法见尖括号）
const CONS: [string, string, string][] = [
  ['m', 'm', ''],
  ['n', 'n', ''],
  ['ŋ', 'ñ', '只出现在元音后'],
  ['p', 'p', ''],
  ['b', 'b', ''],
  ['t', 't', ''],
  ['d', 'd', ''],
  ['k', 'c', ''],
  ['g', 'g', ''],
  ['β', 'w', '双唇擦音，不是半元音'],
  ['f', 'f', ''],
  ['s', 's', ''],
  ['z', 'z', '相邻音节的两个 r 常写作 z'],
  ['θ', 'th', ''],
  ['ð', 'dh', ''],
  ['x', 'ch', ''],
  ['h', 'h', '只出现在词首，非词首的 h 一律是 ch'],
  ['j', 'i', '元音前的 i 是辅音'],
  ['r̥', 'rh', ''],
  ['r', 'r', ''],
  ['l̥', 'lh', ''],
  ['l', 'l', ''],
  ['ts', 'ts', ''],
  ['dz', 'ds', '']
]
for (const [ipa, g, n] of CONS) phoneme(ipa, g, n)
const VOWELS: [string, string, string][] = [
  ['ä', 'a', ''],
  ['e̞', 'e', ''],
  ['i', 'i', ''],
  ['o̞', 'o', ''],
  ['u', 'u', '']
]
for (const [ipa, g, n] of VOWELS) phoneme(ipa, g, n, { type: 'vowel', syllabic: 'yes' })
const DIPH: [string, string][] = [
  ['aɪ̯', 'ai'],
  ['aɛ̯', 'ae'],
  ['aʊ̯', 'au'],
  ['eɪ̯', 'ei'],
  ['oɛ̯', 'oe'],
  ['ɛʊ̯', 'eu']
]
for (const [ipa, g] of DIPH)
  phoneme(ipa, g, '降双元音', { type: 'vowel', syllabic: 'yes', length: 'diphthong' })
phoneme('kθ', 'x', '合字：/kθ/', { type: 'consonant' })

const cls = (name: string, members: string[]) =>
  Tsr.classes.push({ id: newId(), name, members, featureQuery: null })
cls(
  'C',
  CONS.map((c) => c[0])
)
cls('V', [...VOWELS.map((v) => v[0]), ...DIPH.map((d) => d[0])])
cls('{响音}', ['l', 'r', 'm', 'n', 'β', 'j'])
cls('{咝音}', ['s', 'z'])
cls('{塞音}', ['p', 'b', 't', 'd', 'k', 'g'])
cls('{鼻音}', ['m', 'n', 'ŋ'])

Tsr.digraphs = [
  { from: 'th', to: 'θ' },
  { from: 'dh', to: 'ð' },
  { from: 'ch', to: 'x' },
  { from: 'rh', to: 'ṙ' },
  { from: 'lh', to: 'ḷ' },
  { from: 'ds', to: 'ʣ' },
  { from: 'ts', to: 'ʦ' }
]

rom.rulesToIpa = [
  '; 正字法 → 音位。多合字母已在「音系 → 音类」里声明，这里直接写字母。',
  'th > θ',
  'dh > ð',
  'ch > x',
  'rh > r̥',
  'lh > l̥',
  'ds > dz',
  'x > kθ',
  'c > k',
  'ñ > ŋ',
  'w > β',
  '; 元音前的 i 是辅音',
  'i > j / _[aeiouáéíóúâêîôû]',
  '; 双元音',
  'ai > aɪ̯',
  'ae > aɛ̯',
  'au > aʊ̯',
  'ei > eɪ̯',
  'oe > oɛ̯',
  'eu > ɛʊ̯',
  '; 半长（锐音符）：标准语里与短元音等长，只标重音',
  'á > ä',
  'é > e̞',
  'í > i',
  'ó > o̞',
  'ú > u',
  '; 全长（抑扬符）',
  'â > äː',
  'ê > e̞ː',
  'î > iː',
  'ô > o̞ː',
  'û > uː',
  '; 短元音',
  'a > ä',
  'e > e̞',
  'o > o̞'
].join('\n')
rom.rulesFromIpa = [
  '; 音位 → 正字法（造词时把生成的音串拼回拼写）',
  'aɪ̯ > ai',
  'aɛ̯ > ae',
  'aʊ̯ > au',
  'eɪ̯ > ei',
  'oɛ̯ > oe',
  'ɛʊ̯ > eu',
  'äː > â',
  'e̞ː > ê',
  'iː > î',
  'o̞ː > ô',
  'uː > û',
  'ä > a',
  'e̞ > e',
  'o̞ > o',
  'θ > th',
  'ð > dh',
  'kθ > x',
  'x > ch',
  'r̥ > rh',
  'l̥ > lh',
  'dz > ds',
  'k > c',
  'ŋ > ñ',
  'β > w',
  'j > i'
].join('\n')

Tsr.syllable = { enabled: true, template: '(C)(C)V(C)(C)', strategy: 'maximal-onset' }
Tsr.prosody = {
  type: 'stress',
  stressPosition: 'weight',
  rules: [
    '; 短音节＝短元音且其后至多一个辅音；其余为长音节。下一音节的音节首辅音参与计算但不属于该音节。',
    '; 1 单音节词自动重读',
    '; 2 标了半长元音（á é í ó ú）的音节重读',
    '; 3 双音节词：第二音节含双元音则重读第二音节，否则重读第一音节',
    '; 4 多音节词：倒数第二音节为长音节则重读它，否则重读倒数第三音节；音节很多时词首带次重音',
    '; 5 复合词各词分别计算，整词重音落在最后一个词上',
    '; 例：ces**sail** / **fi**bich / dhal**wów** / the**chel**lans / athe**no**wabad / mola**xí**'
  ].join('\n'),
  tones: []
}
Tsr.phonotactics = {
  onsets: [
    ...CONS.map((c) => c[0]),
    'kθ',
    'sp',
    'st',
    'sk',
    'pl',
    'pr',
    'tr',
    'kl',
    'kr',
    'br',
    'dr',
    'gl',
    'gr',
    'fl',
    'fr',
    'θl',
    'θr',
    'ðr',
    'ms',
    'ns'
  ],
  nuclei: [...VOWELS.map((v) => v[0]), ...DIPH.map((d) => d[0])],
  codas: [
    'm',
    'n',
    'ŋ',
    'p',
    't',
    'k',
    'β',
    'f',
    's',
    'z',
    'θ',
    'ð',
    'x',
    'r',
    'l',
    'ts',
    'lt',
    'rt',
    'st',
    'ns',
    'lθ',
    'rθ'
  ],
  illegal: ['hh', 'ŋ#'],
  weights: {},
  minSyllables: 1,
  maxSyllables: 4
}
Tsr.alphabet = 'a b c ch d dh ds e f g h i l lh m n ñ o p r rh s t th ts u w x z'.split(' ')

// ───────────────────────── 科飒尔文 ─────────────────────────

const grammar = grammarPath()
const md = grammar ? read(grammar) : ''

const kessar = createScript('科飒尔文')
kessar.type = 'mixed'
kessar.direction = 'ltr'
kessar.font.family = 'Kessar'
kessar.notes = [
  '科飒尔文（cessar）与书写原始希克林语的冰脉文共享字符集，码位在私用区 U+F300–U+F380。',
  '字形分三类：本征音（整词读音，源自象形）、二分音（弱词根的前后半段）、特征音（元音 / 元音-辅音 / 辅音-元音音节）。',
  '书写时本征音与二分音优先于特征音；短元音写两次、长元音在中央写一次；清浊由是否连写决定；',
  '词首清音、音节末无元音的辅音、ss 与 zz 都要配合特殊功能符号。完整规则见文档页「文字」。',
  '下面的映射规则只实现「最长读音优先」这一层，不足以覆盖全部书写规则，例句里的科飒尔文取自语法书原文。'
].join('\n')

const fontFile = join(SITE, 'assets', 'fonts', 'kessar.woff2')
if (has(fontFile)) {
  kessar.font.dataUrl = `data:font/woff2;base64,${readFileSync(fontFile).toString('base64')}`
  kessar.font.fileName = 'kessar.woff2'
}

type RawGlyph = { char: string; read: string; sense: string; cat: string }
function parseGlyphs(): RawGlyph[] {
  if (!md) return []
  const out: RawGlyph[] = []
  const sec = slice(md, '### 文字构成', '### 书写规则')
  const cellRe =
    /<span class="ks-cell"><span class="kessar">([^<]*)<\/span>(?:<span class="ks-cell__sense">([^<]*)<\/span>)?(?:<span class="ks-cell__read">([^<]*)<\/span>)?/g
  // 本征音
  const intrinsic = slice(sec, '#### 本征音', '#### 特征音')
  for (const m of intrinsic.matchAll(cellRe))
    out.push({ char: m[1], sense: m[2] ?? '', read: m[3] ?? '', cat: '本征音' })
  // 二分音：| 字符 | 读音 | 字符 | 读音 | 字符 | 读音 |
  const bipartite = slice(sec, '#### 二分音', '#### 数字符号')
  for (const row of tables(bipartite).flat()) {
    for (let i = 0; i + 1 < row.length; i += 2) {
      const ch = /<span class="kessar">([^<]*)<\/span>/.exec(row[i])?.[1]
      const read = plain(row[i + 1]).trim()
      if (ch && read && read !== '对应的二分音')
        out.push({ char: ch, sense: '', read, cat: '二分音' })
    }
  }
  // 特征音：三张矩阵。仅元音表读音就是表头；
  // 「先\后」表的读音是 行(元音) + 列(辅音)，「后\先」表反过来是 列(辅音) + 行(元音)。
  const feat = slice(sec, '#### 特征音', '#### 二分音')
  for (const tbl of tables(feat)) {
    if (tbl.length < 2) continue
    const head = tbl[0].map((c) => plain(c).replace(/\*\*/g, '').trim())
    const corner = head[0] ?? ''
    const onlyVowels = head.every((h) => /^[aeiou]$/.test(h))
    if (onlyVowels) {
      for (const row of tbl.slice(1))
        for (let i = 0; i < row.length; i++) {
          const ch = /<span class="kessar">([^<]*)<\/span>/.exec(row[i])?.[1]
          if (ch && head[i]) out.push({ char: ch, sense: '', read: head[i], cat: '特征音' })
        }
      continue
    }
    const vowelFirst = corner.includes('先') && corner.indexOf('先') < corner.indexOf('后')
    for (const row of tbl.slice(1)) {
      const rowLabel = plain(row[0]).replace(/\*\*/g, '').trim()
      if (!rowLabel) continue
      for (let i = 1; i < row.length; i++) {
        const ch = /<span class="kessar">([^<]*)<\/span>/.exec(row[i])?.[1]
        const col = head[i] ?? ''
        if (!ch || !col || col === '\\') continue
        const read = vowelFirst ? rowLabel + col : col + rowLabel
        if (/^[a-zàáâéèêíìîóòôúùûñç]+$/i.test(read))
          out.push({ char: ch, sense: '', read, cat: '特征音' })
      }
    }
  }
  // 数字与运算符
  const num = slice(sec, '#### 数字符号', '#### 标点符号')
  const numTables = tables(num)
  for (const tbl of numTables.slice(0, 2)) {
    if (tbl.length < 2) continue
    const head = tbl[0].map((c) => plain(c))
    for (let i = 0; i < tbl[1].length; i++) {
      const ch = /<span class="kessar">([^<]*)<\/span>/.exec(tbl[1][i])?.[1]
      if (ch && head[i])
        out.push({
          char: ch,
          sense: head[i],
          read: '',
          cat: head[i].length === 1 && /\d/.test(head[i]) ? '数字' : '符号'
        })
    }
  }
  return out
}

{
  const raws = parseGlyphs()
  const seenChar = new Map<string, Glyph>()
  const order = ['本征音', '二分音', '特征音', '数字', '符号']
  raws.sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat))
  for (const r of raws) {
    if (!r.char) continue
    const reads = r.read
      .split('/')
      .map((x) => x.trim())
      .filter(Boolean)
    let g = seenChar.get(r.char)
    if (!g) {
      g = { id: newId(), char: r.char, name: r.sense, value: '', category: r.cat, notes: '' }
      seenChar.set(r.char, g)
      kessar.glyphs.push(g)
    }
    if (!g.name && r.sense) g.name = r.sense
    // 一个字形可以有多个读音（本征音 / 二分音 / 特征音），全部记进 value，映射时按最长优先
    const own = new Set(g.value.split('/').filter(Boolean))
    for (const rd of reads) own.add(rd)
    g.value = [...own].join('/')
    if (r.cat !== g.category) g.notes = [g.notes, `另为${r.cat}`].filter(Boolean).join('；')
  }
  // 标点与特殊功能符号（语法书里以行文描述，没有表格）
  const punct: [string, string, string][] = [
    ['', '左界标', ''],
    ['', '右界标', ''],
    ['', '停顿', ''],
    ['', '中点', '·'],
    ['', '特殊功能符号', ''],
    ['', '数式间隔', '']
  ]
  for (const [ch, name, value] of punct)
    if (!seenChar.has(ch))
      kessar.glyphs.push({
        id: newId(),
        char: ch,
        name,
        value,
        category: name === '特殊功能符号' ? '功能' : '标点',
        notes:
          name === '特殊功能符号'
            ? '词首清化、音节末去元音、ss / zz 的书写都要用它；本征音与二分音不受它影响'
            : ''
      })
  kessar.rules = [
    '; 先按最长读音把拉丁转写换成字形；本征音与二分音的读音更长，因此自动优先于特征音。',
    '; 半长与全长元音先归为短元音，音变式的写法差异见文档页「文字 → 书写规则」。',
    'á > a',
    'é > e',
    'í > i',
    'ó > o',
    'ú > u',
    'â > a',
    'ê > e',
    'î > i',
    'ô > o',
    'û > u',
    "[·'] > ",
    '@glyphs'
  ].join('\n')
  Tsr.scripts.push(kessar)
}

// ───────────────────────── 音变规则集 ─────────────────────────

const scaDir = join(SITE, 'laim', 'shikrin.assets', 'SCA')
let ruleSetId = ''
if (has(join(scaDir, 'Rule.txt'))) {
  const notation = [
    '; 词表用的记法（eu / ei / k̂ / ĝ / ñ、语素界 -、可选段括号）先转成音变输入记法，',
    '; 这样从词表里复制来的祖语形式可以直接丢进测试台。',
    'eu > œ',
    'ei > æ',
    'k̂ > c',
    'ĝ > j',
    'ñ > ŋ',
    '[-] > ',
    '[(] > ',
    '[)] > ',
    ''
  ].join('\n')
  const rs = createRuleSet(
    '原始希克林语 → 瑟乌丝林语',
    notation +
      fromYinbianji(
        read(join(scaDir, 'Category.txt')),
        has(join(scaDir, 'Replace.txt')) ? read(join(scaDir, 'Replace.txt')) : '',
        read(join(scaDir, 'Rule.txt'))
      )
  )
  rs.notes = [
    '与站点音变器 laim/shikrin.assets/SCA 使用同一份 Category.txt / Rule.txt。',
    '六个阶段：PSkr（输入）→ PTsr → ATsr → OTsr → Tsr（音位形）→ Orthography（正字法形）。',
    '名词变格＝真词干（强形 / 弱形 / 中形）+ 格缀，然后走完整条链，见「范式」页。'
  ].join('\n')
  rs.stageLanguages = {
    PSkr: PSkr.id,
    PTsr: PTsr.id,
    ATsr: ATsr.id,
    OTsr: OTsr.id,
    Tsr: Tsr.id,
    Orthography: Tsr.id
  }
  const lex = has(join(scaDir, 'Lexicon.txt')) ? read(join(scaDir, 'Lexicon.txt')).trim() : ''
  rs.testWords = [lex, 'rahars', 'raharm', 'ébews', 'bēwhr', 'shngwsats'].filter(Boolean).join('\n')
  p.ruleSets.push(rs)
  ruleSetId = rs.id
}

// ───────────────────────── 词类与维度 ─────────────────────────

function pos(zh: string, en: string, abbr: string): PartOfSpeech {
  const x: PartOfSpeech = { id: newId(), name: { zh, en }, abbr, paradigmId: null }
  p.posList.push(x)
  return x
}
const N = pos('名词', 'noun', 'H.')
const V = pos('动词', 'verb', 'L.')
const A = pos('形容词', 'adjective', 'X.')
const PRO = pos('代词', 'pronoun', 'R.')
const NUM = pos('数词', 'numeral', 'N.')
const PART = pos('小品词', 'particle', 'P.')
pos('惯用语', 'idiom', 'T.')

function category(zh: string, en: string, values: [string, string][]): GrammaticalCategory {
  const c: GrammaticalCategory = {
    id: newId(),
    name: { zh, en },
    values: values.map(([n, ab]) => ({ id: newId(), name: { zh: n }, abbr: ab }))
  }
  p.categories.push(c)
  return c
}
const val = (c: GrammaticalCategory, abbr: string) => c.values.find((v) => v.abbr === abbr)!.id
const valByName = (c: GrammaticalCategory, name: string) =>
  c.values.find((v) => v.name.zh === name)?.id ?? ''

const catNumber = category('数', 'number', [
  ['单数', 'SG'],
  ['复数', 'PL'],
  ['双数', 'DU']
])
const catCase = category('格', 'case', [
  ['及物格', 'TR'],
  ['不及物格', 'NOMS'],
  ['欠格', 'ABE'],
  ['斜格', 'OBL']
])
const catGender = category('名词类别', 'noun class', [
  ['ó/é', 'ó/é'],
  ['∅', '∅'],
  ['s', 's'],
  ['g', 'g'],
  ['w', 'w'],
  ['其他', '其他']
])
const catAccent = category('重音类别', 'accent class', [
  ['极静m.', '极静m.'],
  ['极静f. Narten', '极静f.N'],
  ['极静f. Normal', '极静f.'],
  ['前动m.', '前动m.'],
  ['前动f.', '前动f.'],
  ['中动m.', '中动m.'],
  ['中动f.', '中动f.'],
  ['后动', '后动'],
  ['侧动', '侧动']
])
const catFocus = category('焦点', 'focus', [
  ['无焦点', 'NFOC'],
  ['强焦点', 'SFOC'],
  ['弱焦点', 'WFOC'],
  ['弱失焦', 'WELF'],
  ['强失焦', 'SELF']
])
const catValency = category('动词类别', 'valency', [
  ['零价', '0'],
  ['一价', '1'],
  ['二价', '2'],
  ['三价受事亲和', '3p'],
  ['三价与事亲和', '3d'],
  ['其他', '其他']
])
const catAdjSource = category('形容词来源', 'adjective source', [
  ['来自名词', '←H'],
  ['来自动词', '←L'],
  ['本身', '本身']
])

// ───────────────────────── 范式 ─────────────────────────

const nounParadigm: Paradigm = {
  id: newId(),
  name: { zh: '名词变格', en: 'noun declension' },
  dimensionIds: [catNumber.id, catCase.id],
  variants: [],
  disabledSlots: [],
  generators: {},
  inheritsFrom: null
}
{
  const gen = (stem: string, suffix: string, post = ''): SlotGenerator => ({
    kind: 'affix-sca',
    stem,
    prefix: '',
    suffix,
    ruleSetId,
    fromStage: 'PSkr',
    toStage: '',
    post
  })
  // 欠格：音变跑完后尾部的 -at 脱落，只留 -w，词尾写作 -u
  const abePost = [
    '; 音变跑完后：尾部的 -at / -ad 脱落，只留 -w；复数的 -iw 收为 -i，其余词尾 w 写作 u',
    'a[dt] > / _#',
    'w > / i_#',
    'w > u / _#'
  ].join(String.fromCharCode(10))
  const sg = val(catNumber, 'SG')
  const pl = val(catNumber, 'PL')
  const du = val(catNumber, 'DU')
  nounParadigm.generators[`${sg}|${val(catCase, 'TR')}`] = gen('强形', 's')
  nounParadigm.generators[`${sg}|${val(catCase, 'NOMS')}`] = gen('强形', 'm')
  nounParadigm.generators[`${sg}|${val(catCase, 'ABE')}`] = gen('弱形', 'wat', abePost)
  // 斜格取决于有生性（有生 ✶-st / 无生 ✶-hr），词表里没有这一列，所以不自动推导，只保留词典实录
  nounParadigm.generators[`${sg}|${val(catCase, 'OBL')}`] = { kind: 'none' }
  nounParadigm.generators[`${pl}|${val(catCase, 'TR')}`] = gen('强形', 'is')
  nounParadigm.generators[`${pl}|${val(catCase, 'NOMS')}`] = gen('强形', 'im')
  nounParadigm.generators[`${pl}|${val(catCase, 'ABE')}`] = gen('弱形', 'iwat', abePost)
  nounParadigm.generators[`${pl}|${val(catCase, 'OBL')}`] = { kind: 'none' }
  // 双数只在少数身体部位名词里残留，逐词填写
  for (const k of catCase.values) nounParadigm.generators[`${du}|${k.id}`] = { kind: 'table' }
  p.paradigms.push(nounParadigm)
  N.paradigmId = nounParadigm.id
}

const verbParadigm: Paradigm = {
  id: newId(),
  name: { zh: '动词焦点', en: 'verb focus' },
  dimensionIds: [catFocus.id],
  variants: [],
  disabledSlots: [],
  generators: {},
  inheritsFrom: null
}
for (const f of catFocus.values) verbParadigm.generators[f.id] = { kind: 'table' }
p.paradigms.push(verbParadigm)
V.paradigmId = verbParadigm.id

const adjParadigm: Paradigm = {
  id: newId(),
  name: { zh: '形容词', en: 'adjective' },
  dimensionIds: [catNumber.id],
  variants: [],
  disabledSlots: [`${val(catNumber, 'DU')}`],
  generators: {
    [val(catNumber, 'SG')]: { kind: 'none' },
    [val(catNumber, 'PL')]: { kind: 'table' }
  },
  inheritsFrom: null
}
p.paradigms.push(adjParadigm)
A.paradigmId = adjParadigm.id

// ───────────────────────── 词表 ─────────────────────────

const csv = (file: string) => {
  const f = join(PRIV, file)
  return has(f) ? parseCsv(read(f)).rows : []
}
const byHeader = (rows: string[][]) => {
  const head = rows[0].map((h) => h.trim())
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {}
    head.forEach((h, i) => (o[h] = (r[i] ?? '').trim()))
    return o
  })
}

/** 释义里的「A > B」：前半是构词说明，后半才是词义 */
function splitDefinition(x: string): { def: string; etym: string } {
  const i = x.indexOf(' > ')
  if (i < 0) return { def: x, etym: '' }
  return { def: x.slice(i + 3).trim(), etym: x.slice(0, i).trim() }
}
/** 释义按中英文分号拆成多个义项，去掉原有编号 */
function setSenses(l: Lexeme, text: string): void {
  const parts = (text ?? '')
    .split(/[;；]/)
    .map((x) => x.trim().replace(/^\d+\s*[、.．)）]\s*/, ''))
    .filter(Boolean)
  if (!parts.length) return
  l.senses[0].definition = { zh: parts[0] }
  for (const d of parts.slice(1)) l.senses.push({ ...createSense(), definition: { zh: d } })
}
/** 原始希克林语那一列：`A > B > C` 拆成来源 A 与中间态 B、C */
function protoEtymology(form: string): Pick<Etymology, 'sources' | 'stages'> {
  const parts = (form ?? '')
    .split('>')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!parts.length) return { sources: [], stages: [] }
  return {
    sources: [{ kind: 'external', language: '原始希克林语', form: parts[0], meaning: '' }],
    stages: parts.slice(1).map((f) => ({ id: newId(), form: f, type: 'soundChange', notes: '' }))
  }
}
const setForm = (l: Lexeme, slot: string, surface: string) => {
  const s = surface.trim()
  if (s) l.forms[slot] = { surface: s, derived: false, override: true, trace: [] }
}
const label = (numAbbr: string, caseAbbr: string) => {
  const n = catNumber.values.find((v) => v.abbr === numAbbr)!.name.zh
  const c = catCase.values.find((v) => v.abbr === caseAbbr)!.name.zh
  return `${n}.${c}`
}

// 名词
{
  const rows = csv('瑟乌丝林语词表 - Thsr H..csv')
  for (const r of byHeader(rows)) {
    const lemma = r['字典形']
    if (!lemma) continue
    const l = createLexeme(Tsr.id, lemma)
    l.posId = N.id
    const { def, etym } = splitDefinition(r['释义'] ?? '')
    setSenses(l, def || r['释义'] || '')
    l.etymology = {
      type: r['备注']?.includes('借词') ? 'borrowing' : 'inherited',
      ...protoEtymology(r['原始希克林语'] ?? ''),
      notes: [etym && `构词：${etym}`, r['备注']].filter(Boolean).join('；')
    }
    if (r['名词类别']) {
      const v = valByName(catGender, r['名词类别'])
      if (v) l.features[catGender.id] = v
    }
    if (r['重音类别']) {
      const v = valByName(catAccent, r['重音类别'])
      if (v) l.features[catAccent.id] = v
    }
    for (const [col, name] of [
      ['强形', '强形'],
      ['弱形', '弱形'],
      ['（中形）', '中形']
    ] as const) {
      const s = (r[col] ?? '').replace(/-$/, '').trim()
      if (s) l.stems[name] = s
    }
    setForm(l, label('SG', 'TR'), r['及物格'] ?? '')
    setForm(l, label('SG', 'NOMS'), r['不及物格'] ?? '')
    setForm(l, label('SG', 'ABE'), r['欠格'] ?? '')
    setForm(l, label('SG', 'OBL'), r['斜格'] ?? '')
    // 复数列依次是 及物 / 不及物 / 欠格 /（斜格）
    const pls = (r['复数'] ?? '')
      .split(/[,，]/)
      .map((x) => x.trim())
      .filter(Boolean)
    const order: [string, string][] = [
      ['PL', 'TR'],
      ['PL', 'NOMS'],
      ['PL', 'ABE'],
      ['PL', 'OBL']
    ]
    pls.forEach((v, i) => {
      if (order[i]) setForm(l, label(order[i][0], order[i][1]), v)
    })
    if (pls.length === 3 && pls[1]) setForm(l, label('PL', 'OBL'), pls[1])
    if (l.forms[label('SG', 'OBL')]?.surface === '' && r['不及物格'])
      setForm(l, label('SG', 'OBL'), r['不及物格'])
    p.lexemes.push(l)
  }
}
// 动词
{
  const rows = csv('瑟乌丝林语词表 - Thsr L..csv')
  for (const r of byHeader(rows)) {
    const lemma = r['字典形/无焦点形']
    if (!lemma) continue
    const l = createLexeme(Tsr.id, lemma)
    l.posId = V.id
    setSenses(l, r['释义'] ?? '')
    l.etymology = {
      type: 'inherited',
      ...protoEtymology(r['原始希克林语'] ?? ''),
      notes: r['前缀点'] ? `前缀点：${r['前缀点']}` : ''
    }
    const cls = (r['动词类别'] ?? '').split(/[,，]/)[0]?.trim()
    const map: Record<string, string> = { '0': '0', '1': '1', '2': '2', '3p': '3p', '3d': '3d' }
    const v = catValency.values.find((x) => x.abbr === (map[cls] ?? '其他'))
    if (v) l.features[catValency.id] = v.id
    if (r['词干元音']) l.stems['词干元音'] = r['词干元音']
    const focus = catFocus.values
    const put = (abbr: string, value: string) => {
      const f = focus.find((x) => x.abbr === abbr)!
      setForm(l, f.name.zh, value)
    }
    put('NFOC', lemma)
    put('SFOC', r['强焦点形'] ?? '')
    put('WFOC', r['弱焦点形'] ?? '')
    put('WELF', r['弱失焦形'] ?? '')
    put('SELF', r['强失焦形'] ?? '')
    for (const [col, slot] of [
      ['副动词型', '副动词形'],
      ['动名词', '动名词'],
      ['动形词', '动形词'],
      ['动副词', '动副词']
    ] as const)
      setForm(l, slot, r[col] ?? '')
    p.lexemes.push(l)
  }
}
// 形容词
{
  const rows = csv('瑟乌丝林语词表 - Thsr X..csv')
  for (const r of byHeader(rows)) {
    const lemma = r['字典形']
    if (!lemma) continue
    const l = createLexeme(Tsr.id, lemma)
    l.posId = A.id
    const { def, etym } = splitDefinition(r['释义'] ?? '')
    setSenses(l, def || r['释义'] || '')
    l.etymology = {
      type: 'derivation',
      ...protoEtymology(r['原始希克林语'] ?? ''),
      notes: [etym && `构词：${etym}`, r['备注']].filter(Boolean).join('；')
    }
    if (r['来源类型']) {
      const v = valByName(catAdjSource, r['来源类型'])
      if (v) l.features[catAdjSource.id] = v
    }
    setForm(l, '复数', r['复数'] ?? '')
    p.lexemes.push(l)
  }
}
// T 表：代词 / 数词 / 小品词 / 词头与限定词 / 惯用句式
{
  const rows = csv('瑟乌丝林语词表 - Thsr T..csv')
  const list = byHeader(rows)
  for (const r of list) {
    // 代词：四个形式
    if (r['代词'] && r['字典/及物形']) {
      const l = createLexeme(Tsr.id, r['字典/及物形'].split('/')[0])
      l.posId = PRO.id
      l.senses[0].definition = { zh: r['代词'] }
      setForm(l, label('SG', 'TR'), r['字典/及物形'])
      setForm(l, label('SG', 'NOMS'), r['不及物/斜格形'] ?? '')
      setForm(l, label('SG', 'ABE'), r['欠格形'] ?? '')
      setForm(l, '物主形', r['物主形'] ?? '')
      p.lexemes.push(l)
    }
    // 数词
    if (r['数词'] && r['拼写']) {
      const l = createLexeme(Tsr.id, r['拼写'].split('/')[0])
      l.posId = NUM.id
      l.senses[0].definition = { zh: `${r['数词']}（六进制）` }
      l.tags = ['数词']
      p.lexemes.push(l)
    }
    // 小品词（表里第二个「拼写」列会被同名覆盖，用备注列兜底）
    if (r['小品词']) {
      const form = (r['拼写'] ?? '').trim()
      if (form) {
        const l = createLexeme(Tsr.id, form.split('/')[0])
        l.posId = PART.id
        l.senses[0].definition = { zh: r['小品词'] }
        l.notes = r['备注'] ?? ''
        l.tags = ['小品词']
        p.lexemes.push(l)
      }
    }
  }
  // 词头与限定词 → 语素
  for (const r of list) {
    const head = r['词头']
    if (!head) continue
    const m = createMorpheme(Tsr.id, 'prefix')
    m.form = head === '∅' ? '∅' : `${head}·`
    m.gloss = 'CLF'
    m.meaning = { zh: '词头' }
    m.tags = ['词头']
    m.notes = [
      r['单数限定'] && `单数限定 ${r['单数限定']}（古 ${r['单数限定（古）'] ?? ''}）`,
      r['复数限定'] && `复数限定 ${r['复数限定']}（古 ${r['复数限定（古）'] ?? ''}）`,
      r['全指'] && `全指 ${r['全指']}`,
      r['领属'] && `领属 ${r['领属']}`
    ]
      .filter(Boolean)
      .join('；')
    p.morphemes.push(m)
  }
}
// PSkr 词根
{
  const rows = csv('瑟乌丝林语词表 - PSkr.csv')
  for (const r of byHeader(rows)) {
    if (!r['词根']) continue
    const m = createMorpheme(PSkr.id, 'root')
    m.form = r['词根']
    m.meaning = { zh: r['释义'] ?? '' }
    m.notes = r['备注'] ?? ''
    m.tags = [r['词性'] ?? ''].filter(Boolean)
    p.morphemes.push(m)
  }
}
// 瑟乌丝林语的语法语素
{
  const gm = (
    form: string,
    type: Parameters<typeof createMorpheme>[1],
    gloss: string,
    zh: string,
    notes = ''
  ) => {
    const m = createMorpheme(Tsr.id, type)
    m.form = form
    m.gloss = gloss
    m.meaning = { zh }
    m.notes = notes
    p.morphemes.push(m)
    return m
  }
  gm('-s', 'suffix', 'TR', '及物格', '来自数词 √K̂A「二」；跟在 -s 结尾的真词干后脱落')
  gm('-m', 'suffix', 'NOMS', '不及物格', '来自数词 √HĒM「一」；PTsr 阶段起变为 -n')
  gm(
    '-wat',
    'suffix',
    'ABE',
    '欠格',
    '来自 √WĀT「其他的，余下的」；音变后 -at 脱落，只留 -w（写作 -u）'
  )
  gm('-st', 'suffix', 'OBL.ANIM', '斜格（有生）', '来自 √LEST「穗」')
  gm('-hr', 'suffix', 'OBL.INAN', '斜格（无生）', '来自 √HOR「侧面的」')
  gm('-i-', 'infix', 'PL', '复数中缀', '插在真词干与格缀之间：-is / -im / -iwat / -ist / -ihr')
  gm('-u-', 'infix', 'DU', '双数中缀', '只在少数天生成对的身体部位名词里残留')
  gm('á-', 'prefix', 'EM', '感音槽', '动词头第一槽：辅音 + 标记元音 á')
  gm('e-', 'prefix', 'MOD', '式槽', '动词头：预言式 / 希求式 / 命令式 / 条件式；空置为直陈式')
  gm('o-', 'prefix', 'ASP', '体槽', '动词头：惯常 / 格言 / 临终 / 未完成 / 完成；空置为一般体貌')
  gm('ó-', 'prefix', 'TA', '时槽', '动词头：远过去 / 过去 / 现在；空置为现在时')
  gm('i-', 'prefix', 'CSF', '扩流前缀', '致使式；零价动词上表示第二补充者的促成')
  gm('a-', 'prefix', 'CF', '逆流前缀', '零价动词上表示动作的隐没')
  gm('u-', 'prefix', 'APLF', '换流前缀', '双系式（应动式）')
  gm('re-', 'particle', 'GEN', '属于', '领属小品词，A of B 中引导 B')
  gm('na-', 'prefix', 'in', '在……中', '介词，其宾语取字典形')
  gm('ar-', 'prefix', 'INS', '用……', '工具 / 媒介介词')
  gm('tar-', 'prefix', 'AUG', '大化', '口语缩为 ta’')
  gm('al-', 'prefix', 'DIM', '小化', '口语缩为 a’')
}

// ───────────────────────── 语料：语法书里的 gloss 例句 ─────────────────────────

/**
 * 例句里的词要挂到正确的词条上。同一个写法常有多个词条（gwauch 既是「气体.欠格」
 * 又是「呼喊.弱焦点」），所以按语法书给的 gloss 打分挑最像的那个。
 */
interface LexCand {
  id: Id
  slot: string
  def: string
}
const headForms = p.morphemes
  .filter((m) => m.languageId === Tsr.id && m.type === 'prefix')
  .map((m) => m.form.replace(/[·-]/g, '').toLowerCase())
  .filter(Boolean)
/**
 * 一个词形的各种等价写法：原样、去中点、去掉词头之后的词干。
 * 只取词头之后的部分——第一段是词头，单独拿它去匹配会撞上一堆别的词。
 */
function keyVariants(raw: string): string[] {
  const base = raw.trim().toLowerCase()
  if (!base) return []
  const out = new Set<string>([base])
  if (base.includes('·')) {
    out.add(base.replace(/·/g, ''))
    const segs = base.split('·')
    for (const seg of segs.slice(1)) if (seg.length > 1) out.add(seg)
  }
  const flat = base.replace(/·/g, '')
  for (const h of headForms)
    if (h && flat.startsWith(h) && flat.length - h.length > 1) out.add(flat.slice(h.length))
  return [...out]
}
const lexCands = new Map<string, LexCand[]>()
function addCand(raw: string, cand: LexCand): void {
  for (const part of raw.split(/[,，/]/)) {
    for (const k of keyVariants(part)) {
      const arr = lexCands.get(k)
      if (arr) {
        if (!arr.some((x) => x.id === cand.id && x.slot === cand.slot)) arr.push(cand)
      } else lexCands.set(k, [cand])
    }
  }
}
for (const l of p.lexemes) {
  if (l.languageId !== Tsr.id) continue
  const def = l.senses
    .map((se) => se.definition['zh'] ?? '')
    .filter(Boolean)
    .join('；')
  addCand(l.lemma, { id: l.id, slot: '', def })
  for (const st of Object.values(l.stems)) addCand(st, { id: l.id, slot: '', def })
  for (const [slot, f] of Object.entries(l.forms)) addCand(f.surface, { id: l.id, slot, def })
}
/** 按 gloss 文本给候选打分：槽位名与释义里的词出现得越多越像 */
function pickLexeme(surface: string, gloss: string): Id | null {
  const seen = new Set<string>()
  const cands: (LexCand & { exact: boolean })[] = []
  const keys = keyVariants(surface)
  for (const [ki, k] of keys.entries())
    for (const c of lexCands.get(k) ?? []) {
      const sig = c.id + '|' + c.slot
      if (seen.has(sig)) continue
      seen.add(sig)
      cands.push({ ...c, exact: ki === 0 })
    }
  if (!cands.length) return null
  if (!gloss) return cands[0].id
  const g = gloss.toLowerCase()
  let best = cands[0]
  let bestScore = -1
  for (const c of cands) {
    let score = c.exact ? 2 : 0
    for (const part of c.slot.split('.')) if (part && g.includes(part.toLowerCase())) score += 3
    for (const piece of c.def.split(/[；;，,、]/))
      if (piece.replace(/^\d+/, '').length > 1 && g.includes(piece.replace(/^\d+/, ''))) score += 2
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best.id
}

// ─── 语流 × 人称的合并前缀（语法书《人称中缀》一节的表） ───
const FLOW_PERSON: Record<string, Record<string, string[]>> = {
  顺流: {
    '三单.回指': ['e'],
    '三单.祂': ['w', 'u'],
    一单: ['m'],
    '二单.亲': ['d'],
    '二单.敬': ['ei'],
    '三单.有生': [],
    一复: ['a'],
    二复: ['o'],
    三复: ['s'],
    '三单.无生': ['eu']
  },
  逆流: {
    '三单.回指': ['ae'],
    '三单.祂': ['aw'],
    一单: ['am'],
    '二单.亲': ['ad'],
    '二单.敬': ['ai'],
    '三单.有生': ['a'],
    一复: ['á'],
    二复: ['ao'],
    三复: ['as'],
    '三单.无生': ['au']
  },
  扩流: {
    '三单.回指': ['ie'],
    '三单.祂': ['iw'],
    一单: ['im'],
    '二单.亲': ['id'],
    '二单.敬': ['í'],
    '三单.有生': ['i'],
    一复: ['ia'],
    二复: ['io'],
    三复: ['is'],
    '三单.无生': ['ieu']
  },
  换流: {
    '三单.回指': ['we'],
    '三单.祂': ['ú'],
    一单: ['um'],
    '二单.亲': ['ud'],
    '二单.敬': ['ui'],
    '三单.有生': ['wu', 'u', 'w'],
    一复: ['wa'],
    二复: ['wo'],
    三复: ['us'],
    '三单.无生': ['weu']
  },
  滞流: {
    '三单.回指': ['é'],
    '三单.祂': ['ew'],
    一单: ['em'],
    '二单.亲': ['ed'],
    '二单.敬': ['é'],
    '三单.有生': ['e'],
    一复: ['ea'],
    二复: ['eo'],
    三复: ['es'],
    '三单.无生': ['oe']
  }
}
const flowMorphemes = new Map<string, Id>()
/** 语流 + 人称的合并前缀单独建一个语素，语料里点得开、也能在语素页查 */
function flowMorpheme(flow: string, person: string, form: string): Id {
  const key = flow + '<' + person + '>'
  const hit = flowMorphemes.get(key)
  if (hit) return hit
  const m = createMorpheme(Tsr.id, 'prefix')
  m.form = form ? form + '-' : '∅-'
  m.gloss = key
  m.meaning = { zh: key }
  m.notes = '语流与人称的合并前缀：语法书《人称中缀》一节'
  p.morphemes.push(m)
  flowMorphemes.set(key, m.id)
  return m.id
}
/** gloss 形如「顺流<三单.祂>停留.强焦点」时，按表里的前缀把动词干拆开 */
function splitFlow(
  surface: string,
  gloss: string
): { morphs: { form: string; gloss: string; morphemeId: Id | null }[]; stem: string } | null {
  const m = /^(顺流|逆流|滞流|扩流|换流)<([^>]*)>(.*)$/.exec(gloss)
  if (!m) return null
  const [, flow, person, rest] = m
  const forms = FLOW_PERSON[flow]?.[person]
  if (!forms) return null
  const low = surface.toLowerCase()
  const pick = [...forms].sort((a, b) => b.length - a.length).find((f) => low.startsWith(f))
  if (!forms.length || pick === undefined) {
    // 零前缀（或表里查不到）：不拆，但词干就是整个词形
    return { morphs: [{ form: surface, gloss, morphemeId: null }], stem: surface }
  }
  const stem = surface.slice(pick.length)
  if (!stem) return { morphs: [{ form: surface, gloss, morphemeId: null }], stem: surface }
  return {
    morphs: [
      {
        form: pick + '-',
        gloss: flow + '<' + person + '>',
        morphemeId: flowMorpheme(flow, person, pick)
      },
      { form: stem, gloss: rest, morphemeId: null }
    ],
    stem
  }
}

/** 动词头（时体式感音那一截）按语法书的 gloss 建成语素，语料里就能认出来 */
const headMorphemes = new Map<string, Id>()
function headMorpheme(form: string, gloss: string): Id {
  const key = form.toLowerCase()
  const hit = headMorphemes.get(key)
  if (hit) return hit
  const m = createMorpheme(Tsr.id, 'prefix')
  m.form = form + '·'
  m.gloss = gloss.replace(/[=]/g, '').replace(/-/g, '-')
  m.meaning = { zh: gloss }
  m.notes = '动词头：语法书《动词结构》一节'
  p.morphemes.push(m)
  headMorphemes.set(key, m.id)
  return m.id
}
function splitHead(
  surface: string,
  gloss: string
): { form: string; gloss: string; morphemeId: Id | null }[] {
  const si = surface.indexOf('·')
  const head = surface.slice(0, si)
  const rest = surface.slice(si + 1)
  if (!head || !rest) return [{ form: surface, gloss, morphemeId: null }]
  const gi = gloss.indexOf('·')
  if (gi > 0) {
    // 语法书的 gloss 也带中点：两边一一对应
    return [
      {
        form: head + '·',
        gloss: gloss.slice(0, gi),
        morphemeId: headMorpheme(head, gloss.slice(0, gi))
      },
      { form: rest, gloss: gloss.slice(gi + 1), morphemeId: null }
    ]
  }
  // gloss 压成一整条：只有当这个词头已经在语素表里时才拆，免得把名词词头也拆开
  const known = headMorphemes.get(head.toLowerCase())
  if (!known) return [{ form: surface, gloss, morphemeId: null }]
  const m = p.morphemes.find((x) => x.id === known)
  return [
    { form: head + '·', gloss: m?.gloss ?? '', morphemeId: known },
    { form: rest, gloss, morphemeId: null }
  ]
}

/** 语素表：按形式查，用来给拆出来的段挂上语素 */
const morphByForm = new Map<string, Id>()
function indexMorphemes(): void {
  morphByForm.clear()
  for (const m of p.morphemes) {
    if (m.languageId !== Tsr.id) continue
    for (const f of [m.form, ...m.allomorphs.map((a) => a.form)]) {
      const k = f.replace(/[-=·]/g, '').toLowerCase()
      if (k && !morphByForm.has(k)) morphByForm.set(k, m.id)
    }
  }
}
/**
 * 语法书里 aen-re-anar / em'to 这类写法，gloss 的分段与词形一一对应
 * （阳光-属于-天海日、环绕=你.及物格），段数相同就照着拆。
 */
function zipSplit(
  surface: string,
  gloss: string,
  sep: RegExp,
  glossSep: RegExp
): { form: string; gloss: string; morphemeId: Id | null }[] | null {
  const parts = surface.split(sep)
  const glosses = gloss.split(glossSep)
  if (parts.length < 2 || parts.length !== glosses.length) return null
  return parts.map((form, i) => ({
    form,
    gloss: glosses[i],
    morphemeId: morphByForm.get(form.replace(/[-=·]/g, '').toLowerCase()) ?? null
  }))
}

/** 一个词形拆成语素：先分动词头，再分语流人称前缀 */
function morphsOf(
  surface: string,
  gloss: string
): {
  morphs: { form: string; gloss: string; morphemeId: Id | null }[]
  stem: string
} {
  const zipped = zipSplit(surface, gloss, /-/g, /-/g) ?? zipSplit(surface, gloss, /'/g, /=/g)
  if (zipped) {
    const main = zipped.reduce((a, b) => (b.form.length > a.form.length ? b : a)).form
    return { morphs: zipped, stem: main }
  }
  const parts = surface.includes('·')
    ? splitHead(surface, gloss)
    : [{ form: surface, gloss, morphemeId: null as Id | null }]
  const out: { form: string; gloss: string; morphemeId: Id | null }[] = []
  let stem = surface
  for (const part of parts) {
    const f = splitFlow(part.form, part.gloss)
    if (f) {
      out.push(...f.morphs)
      stem = f.stem
    } else {
      out.push(part)
      if (!part.form.endsWith('·')) stem = part.form
    }
  }
  return { morphs: out, stem }
}

indexMorphemes()

if (md) {
  const glossRe = /<div class="gloss"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g
  const wordRe =
    /<span class="gl__w">(?:<span class="gl__ks">([\s\S]*?)<\/span>)?<span class="gl__lat">([\s\S]*?)<\/span>(?:<span class="gl__spell">([\s\S]*?)<\/span>)?(?:<span class="gl__morph">([\s\S]*?)<\/span>)?<\/span>/g
  const trRe = /<div class="gloss__tr">([\s\S]*?)<\/div>/
  // 每条例句挂到它所在的章节标题上
  const heads: { pos: number; title: string }[] = []
  for (const m of md.matchAll(/^#{2,4} (.+?)(?: \{#.*\})?$/gm))
    heads.push({ pos: m.index ?? 0, title: m[1].replace(/\*\*/g, '').trim() })
  const sectionAt = (i: number) => {
    let t = ''
    for (const h of heads) if (h.pos < i) t = h.title
    return t
  }
  for (const m of md.matchAll(glossRe)) {
    const block = m[0]
    const words = [...block.matchAll(wordRe)].map((w) => ({
      ks: (w[1] ?? '').replace(/<[^>]+>/g, '').trim(),
      lat: plain(w[2] ?? ''),
      spell: plain(w[3] ?? ''),
      morph: plain(w[4] ?? '')
    }))
    if (!words.length) continue
    const tr = plain(trRe.exec(block)?.[1] ?? '').replace(/^——/, '')
    const s = createSentence(Tsr.id)
    s.text = words.map((w) => w.lat).join(' ')
    s.translation = { zh: tr }
    s.source = `语法书 · ${sectionAt(m.index ?? 0) || '概述'}`
    const ks = words
      .map((w) => w.ks)
      .filter(Boolean)
      .join(' ')
    if (ks) s.scriptForms[kessar.id] = ks
    const spell = words
      .map((w) => w.spell)
      .filter(Boolean)
      .join('  ')
    if (spell) s.extraLines.push({ label: '科飒尔文拼写', text: spell })
    s.tokens = words.map((w) => {
      const surface = w.lat.replace(/^[（(]/, '').replace(/[.,!?；。，！？）)]+$/g, '')
      const gloss = w.morph || '?'
      // gloss 里也带中点，说明这个词是「动词头·动词干」，拆成两个语素
      const { morphs, stem } = morphsOf(surface, gloss)
      return {
        surface,
        analyses: [
          {
            lexemeId: pickLexeme(surface, gloss) ?? pickLexeme(stem, gloss),
            slot: null,
            morphs
          }
        ],
        chosen: 0,
        confirmed: !!w.morph
      }
    })
    p.sentences.push(s)
  }
}

// ───────────────────────── 短语簿：惯用句式与问候语 ─────────────────────────

if (md) {
  const sec = slice(md, '### 惯用形与问候语', '## 构词')
  const tbs = tables(sec)
  const add = (rowsIn: string[][], cat: string) => {
    for (const row of rowsIn.slice(1)) {
      const text = plain(row[0] ?? '')
      if (!text || text === '瑟乌丝林语') continue
      const ph = createPhrase(Tsr.id, cat)
      ph.text = text
      const lit = plain(row[1] ?? '')
      const use = plain(row[2] ?? '')
      ph.translation = { zh: use || lit }
      if (lit && use) ph.variants.push({ text: '', note: `直译：${lit}` })
      p.phrasebook.push(ph)
    }
  }
  if (tbs[0]) add(tbs[0], '固定句式')
  if (tbs[1]) add(tbs[1], '问候与祝福')
}
// T 表里的词组也进短语簿
{
  const list = byHeader(csv('瑟乌丝林语词表 - Thsr T..csv'))
  for (const r of list) {
    const text = r['瑟乌丝林语词组']
    if (!text) continue
    const ph = createPhrase(Tsr.id, '词表 · 惯用')
    ph.text = text
    const { def, etym } = splitDefinition(r['释义'] ?? '')
    ph.translation = { zh: def || r['释义'] || '' }
    if (etym) ph.variants.push({ text: '', note: `直译：${etym}` })
    ph.tags = [r['备注'] ?? ''].filter(Boolean)
    p.phrasebook.push(ph)
  }
}

// ───────────────────────── 缩写表 ─────────────────────────

if (md) {
  const sec = slice(md, '## 缩写', '## 形态')
  for (const tbl of tables(sec))
    for (const row of tbl)
      for (const c of row.slice(1)) {
        const a = splitAbbr(c)
        if (a && !p.abbreviations.some((x) => x.abbr === a.abbr))
          p.abbreviations.push({ abbr: a.abbr, name: { zh: a.name } })
      }
}

// ───────────────────────── 文档页：语法书正文 ─────────────────────────

if (md) {
  /** 把站点 Markdown 转成应用里的 Markdown：去掉站点组件，保留标题 / 列表 / 表格 */
  function toDoc(section: string): string {
    const out: string[] = []
    let inGloss = false
    let glossWords: string[] = []
    let glossTr = ''
    for (const raw of section.split('\n')) {
      const line = raw.trimEnd()
      if (line.includes('<div class="gloss"')) {
        inGloss = true
        glossWords = []
        glossTr = ''
      }
      if (inGloss) {
        for (const w of line.matchAll(/<span class="gl__lat">([\s\S]*?)<\/span>/g))
          glossWords.push(plain(w[1]))
        const t = /<div class="gloss__tr">([\s\S]*?)<\/div>/.exec(line)
        if (t) {
          glossTr = plain(t[1])
          out.push(`> ${glossWords.join(' ')}`, `> ${glossTr}`, '')
          inGloss = false
        }
        continue
      }
      if (
        /^<(details|summary|\/details|figure|img|figcaption|\/figure|aside|dl|dt|dd|\/aside|\/dl)/.test(
          line.trim()
        )
      )
        continue
      if (/^<p class="ts-seealso"/.test(line.trim())) {
        out.push(`> ${plain(line)}`)
        continue
      }
      if (/^<div class="(tool-note|tool-warn|page-note)"/.test(line.trim())) {
        out.push(`> ${plain(line)}`)
        continue
      }
      if (/^<blockquote/.test(line.trim())) {
        out.push(`> ${plain(line)}`)
        continue
      }
      const t = plain(line)
      if (!t && !line.trim()) out.push('')
      else if (t) out.push(t)
    }
    return out
      .join('\n')
      .replace(/^(#{1,6} .*?)[ \t]*\{#[^}]*\}[ \t]*$/gm, '$1') // 去掉站点标题里的锚点
      .replace(/\]\(\/(laim|cerf|gell)\//g, '](https://kinnuch.github.io/$1/') // 站内链接补全域名
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  const parts: { title: string; from: string; to: string }[] = [
    { title: '概述', from: '# Theusrin | 瑟乌丝林语', to: '## 音系' },
    { title: '音系', from: '## 音系', to: '## 文字' },
    { title: '文字：科飒尔文', from: '## 文字', to: '## 缩写' },
    { title: '行间标注缩写', from: '## 缩写', to: '## 形态' },
    { title: '名词形态', from: '### 名词形态', to: '### 形容词形态' },
    { title: '形容词形态', from: '### 形容词形态', to: '### 动词形态' },
    { title: '动词形态', from: '### 动词形态', to: '### 代词' },
    { title: '代词与数词', from: '### 代词', to: '### 小品词与介词' },
    { title: '小品词与介词', from: '### 小品词与介词', to: '## 句法' },
    { title: '句法：惯用形与问候语', from: '## 句法', to: '## 构词' },
    { title: '演化与音变', from: '## 演化', to: '## 备注' },
    { title: '备注', from: '## 备注', to: '' }
  ]
  for (const part of parts) {
    const sec = slice(md, part.from, part.to || undefined)
    if (!sec.trim()) continue
    const d = createDoc(Tsr.id, part.title)
    d.markdown = toDoc(sec)
    p.docs.push(d)
  }
  const intro = createDoc(null, '这个项目里有什么')
  intro.markdown = [
    '本项目由 `npm run examples:theusrin` 从下列资料生成，可以直接当作千语集各模块的完整示例：',
    '',
    '| 模块 | 内容 | 来源 |',
    '| --- | --- | --- |',
    '| 语言 | 原始希克林语 → 原始 / 上古 / 古瑟乌丝林语 → 标准语，共 5 门 | 语法书「演化」 |',
    '| 音系 | 24 个辅音、5 个单元音、6 个双元音、音类、正字法双向规则、音节与重音、配列 | 语法书「音系」 |',
    '| 文字 | 科飒尔文 129 个字形（本征音 / 二分音 / 特征音 / 数字 / 符号）、内嵌字体、映射规则 | 语法书「文字」 |',
    '| 音变 | PSkr → PTsr → ATsr → OTsr → Tsr → 正字法，六阶段共 231 条规则 | 站点音变器的 Rule.txt |',
    '| 语素 | 原始希克林语词根、格缀与数中缀、动词头槽位、语流前缀、词头与限定词 | 词表 + 语法书 |',
    '| 词库 | 名词 / 动词 / 形容词 / 代词 / 数词 / 小品词，含真词干、四格、复数与焦点形 | 作者词表 |',
    '| 范式 | 名词变格＝真词干 + 格缀 + 整条音变链；动词焦点与形容词复数逐词填写 | 语法书「变格法」 |',
    '| 语料 | 语法书里的 98 条行间标注例句，带科飒尔文与拼写分解 | 语法书全文 |',
    '| 短语簿 | 固定句式、问候与祝福 | 语法书「惯用形与问候语」 |',
    '| 文档 | 语法书各章正文 | 语法书 |',
    '',
    '## 怎么看名词变格',
    '',
    '打开[词库]，选一个名词（例如 [[cessar]]、[[anar]]、[[é·bae]]），录入模式里能看到：',
    '',
    '- **词干**：强形 / 弱形 /（中形），即原始瑟乌丝林语的真词干；',
    '- **屈折形**：词典实录的单复数四格；',
    '- 点「推导」会用「范式 → 名词变格」重算一遍：真词干 + 格缀，再走完整条音变链。',
    '',
    '推导值与词典实录不一致的地方，用「范式 → 对账报告」可以一次看全 —— 这正是这套方法论要检验的东西：',
    '哪些词的格尾能由音变链解释，哪些是词典单独记住的。目前及物 / 不及物格约四分之一的词能对上，',
    '欠格略低；对不上的多半是真词干的构拟记法与音变器输入记法有出入（如 ✶sgēstem- 一类含 st 的词干），',
    '或者词典形本身经过了类推。斜格取决于有生性（有生 ✶-st、无生 ✶-hr），词表里没有这一列，因此不自动推导。',
    '',
    '## 怎么看科飒尔文',
    '',
    '「文字」页列出全部字形与读音；「语料」里每条例句的第一行就是语法书原文的科飒尔文，',
    '需要装字体才能显示 —— 字体已经内嵌在项目文件里，打开即可。'
  ].join('\n')
  p.docs.push(intro)
}

// ───────────────────────── 写盘 ─────────────────────────

p.meta.updatedAt = now()
mkdirSync(OUT, { recursive: true })
const file = join(OUT, 'Theusrin.laim.json')
writeFileSync(file, serializeProject(p), 'utf8')
console.log(
  `wrote ${file}\n  语言 ${p.languages.length} · 音位 ${Tsr.phonemes.length} · 字形 ${kessar.glyphs.length}` +
    ` · 规则集 ${p.ruleSets.length} · 语素 ${p.morphemes.length} · 词条 ${p.lexemes.length}` +
    ` · 范式 ${p.paradigms.length} · 例句 ${p.sentences.length} · 短语 ${p.phrasebook.length}` +
    ` · 文档 ${p.docs.length} · 缩写 ${p.abbreviations.length}`
)
