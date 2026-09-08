/**
 * IPA 与造语常用符号的数据表。名称给中英两种，供面板显示与搜索。
 * 组合附标用 ◌ 展示；插入时只插附标本身。
 */

export interface Sym {
  s: string
  zh: string
  en: string
  /** 附标：是否为组合字符（非独立字符） */
  combining?: boolean
}

export const PLACES = [
  { zh: '双唇', en: 'bilabial' },
  { zh: '唇齿', en: 'labiodental' },
  { zh: '齿', en: 'dental' },
  { zh: '齿龈', en: 'alveolar' },
  { zh: '龈后', en: 'postalveolar' },
  { zh: '卷舌', en: 'retroflex' },
  { zh: '硬腭', en: 'palatal' },
  { zh: '软腭', en: 'velar' },
  { zh: '小舌', en: 'uvular' },
  { zh: '咽', en: 'pharyngeal' },
  { zh: '声门', en: 'glottal' }
]

export const MANNERS = [
  { zh: '塞音', en: 'plosive' },
  { zh: '鼻音', en: 'nasal' },
  { zh: '颤音', en: 'trill' },
  { zh: '闪音', en: 'tap or flap' },
  { zh: '擦音', en: 'fricative' },
  { zh: '边擦音', en: 'lateral fricative' },
  { zh: '近音', en: 'approximant' },
  { zh: '边近音', en: 'lateral approximant' }
]

type Cell = [string | null, string | null]
const _: Cell = [null, null]
/** [manner][place] = [清, 浊] */
export const PULMONIC: Cell[][] = [
  [['p', 'b'], _, _, ['t', 'd'], _, ['ʈ', 'ɖ'], ['c', 'ɟ'], ['k', 'ɡ'], ['q', 'ɢ'], _, ['ʔ', null]],
  [[null, 'm'], [null, 'ɱ'], _, [null, 'n'], _, [null, 'ɳ'], [null, 'ɲ'], [null, 'ŋ'], [null, 'ɴ'], _, _],
  [[null, 'ʙ'], _, _, [null, 'r'], _, _, _, _, [null, 'ʀ'], _, _],
  [_, [null, 'ⱱ'], _, [null, 'ɾ'], _, [null, 'ɽ'], _, _, _, _, _],
  [['ɸ', 'β'], ['f', 'v'], ['θ', 'ð'], ['s', 'z'], ['ʃ', 'ʒ'], ['ʂ', 'ʐ'], ['ç', 'ʝ'], ['x', 'ɣ'], ['χ', 'ʁ'], ['ħ', 'ʕ'], ['h', 'ɦ']],
  [_, _, _, ['ɬ', 'ɮ'], _, _, _, _, _, _, _],
  [_, [null, 'ʋ'], _, [null, 'ɹ'], _, [null, 'ɻ'], [null, 'j'], [null, 'ɰ'], _, _, _],
  [_, _, _, [null, 'l'], _, [null, 'ɭ'], [null, 'ʎ'], [null, 'ʟ'], _, _, _]
]

export function consonantName(manner: number, place: number, voiced: boolean): { zh: string; en: string } {
  const m = MANNERS[manner]
  const p = PLACES[place]
  return {
    zh: `${voiced ? '浊' : '清'}${p.zh}${m.zh}`,
    en: `${voiced ? 'voiced' : 'voiceless'} ${p.en} ${m.en}`
  }
}

export const OTHER_PULMONIC: Sym[] = [
  { s: 'ʍ', zh: '清唇软腭擦音', en: 'voiceless labial-velar fricative' },
  { s: 'w', zh: '浊唇软腭近音', en: 'voiced labial-velar approximant' },
  { s: 'ɥ', zh: '浊唇硬腭近音', en: 'voiced labial-palatal approximant' },
  { s: 'ʜ', zh: '清会厌擦音', en: 'voiceless epiglottal fricative' },
  { s: 'ʢ', zh: '浊会厌擦音', en: 'voiced epiglottal fricative' },
  { s: 'ʡ', zh: '会厌塞音', en: 'epiglottal plosive' },
  { s: 'ɕ', zh: '清龈腭擦音', en: 'voiceless alveolo-palatal fricative' },
  { s: 'ʑ', zh: '浊龈腭擦音', en: 'voiced alveolo-palatal fricative' },
  { s: 'ɺ', zh: '齿龈边闪音', en: 'alveolar lateral flap' },
  { s: 'ɧ', zh: '清腭软腭擦音', en: 'voiceless palatal-velar fricative' },
  { s: 'ɫ', zh: '软腭化齿龈边近音', en: 'velarized alveolar lateral approximant' },
  { s: 'ɡ', zh: '浊软腭塞音（IPA 字形）', en: 'voiced velar plosive (IPA glyph)' }
]

export const NON_PULMONIC: { zh: string; en: string; items: Sym[] }[] = [
  {
    zh: '搭嘴音',
    en: 'Clicks',
    items: [
      { s: 'ʘ', zh: '双唇搭嘴音', en: 'bilabial click' },
      { s: 'ǀ', zh: '齿搭嘴音', en: 'dental click' },
      { s: 'ǃ', zh: '龈后搭嘴音', en: '(post)alveolar click' },
      { s: 'ǂ', zh: '腭龈搭嘴音', en: 'palatoalveolar click' },
      { s: 'ǁ', zh: '齿龈边搭嘴音', en: 'alveolar lateral click' }
    ]
  },
  {
    zh: '内爆音',
    en: 'Implosives',
    items: [
      { s: 'ɓ', zh: '双唇内爆音', en: 'bilabial implosive' },
      { s: 'ɗ', zh: '齿龈内爆音', en: 'alveolar implosive' },
      { s: 'ʄ', zh: '硬腭内爆音', en: 'palatal implosive' },
      { s: 'ɠ', zh: '软腭内爆音', en: 'velar implosive' },
      { s: 'ʛ', zh: '小舌内爆音', en: 'uvular implosive' }
    ]
  },
  {
    zh: '挤喉音',
    en: 'Ejectives',
    items: [
      { s: 'ʼ', zh: '挤喉符', en: 'ejective mark' },
      { s: 'pʼ', zh: '双唇挤喉音', en: 'bilabial ejective' },
      { s: 'tʼ', zh: '齿龈挤喉音', en: 'alveolar ejective' },
      { s: 'kʼ', zh: '软腭挤喉音', en: 'velar ejective' },
      { s: 'sʼ', zh: '齿龈挤喉擦音', en: 'alveolar ejective fricative' },
      { s: 'tsʼ', zh: '齿龈挤喉塞擦音', en: 'alveolar ejective affricate' }
    ]
  }
]

export const HEIGHTS = [
  { zh: '闭', en: 'close' },
  { zh: '次闭', en: 'near-close' },
  { zh: '半闭', en: 'close-mid' },
  { zh: '中', en: 'mid' },
  { zh: '半开', en: 'open-mid' },
  { zh: '次开', en: 'near-open' },
  { zh: '开', en: 'open' }
]
export const BACKNESS = [
  { zh: '前', en: 'front' },
  { zh: '央', en: 'central' },
  { zh: '后', en: 'back' }
]
/** [height][backness] = [不圆唇, 圆唇] */
export const VOWELS: Cell[][] = [
  [['i', 'y'], ['ɨ', 'ʉ'], ['ɯ', 'u']],
  [['ɪ', 'ʏ'], _, [null, 'ʊ']],
  [['e', 'ø'], ['ɘ', 'ɵ'], ['ɤ', 'o']],
  [_, ['ə', null], _],
  [['ɛ', 'œ'], ['ɜ', 'ɞ'], ['ʌ', 'ɔ']],
  [['æ', null], ['ɐ', null], _],
  [['a', 'ɶ'], _, ['ɑ', 'ɒ']]
]
export function vowelName(h: number, b: number, rounded: boolean): { zh: string; en: string } {
  return {
    zh: `${HEIGHTS[h].zh}${BACKNESS[b].zh}${rounded ? '圆唇' : '不圆唇'}元音`,
    en: `${HEIGHTS[h].en} ${BACKNESS[b].en} ${rounded ? 'rounded' : 'unrounded'} vowel`
  }
}
export const OTHER_VOWELS: Sym[] = [
  { s: 'ɚ', zh: '卷舌中央元音', en: 'r-colored mid central vowel' },
  { s: 'ɝ', zh: '卷舌半开央元音', en: 'r-colored open-mid central vowel' },
  { s: 'ᵻ', zh: '次闭央不圆唇元音', en: 'near-close central unrounded vowel' },
  { s: 'ᵿ', zh: '次闭央圆唇元音', en: 'near-close central rounded vowel' }
]

export const DIACRITICS: Sym[] = [
  { s: '̥', zh: '清化', en: 'voiceless', combining: true },
  { s: '̬', zh: '浊化', en: 'voiced', combining: true },
  { s: 'ʰ', zh: '送气', en: 'aspirated' },
  { s: '̹', zh: '更圆唇', en: 'more rounded', combining: true },
  { s: '̜', zh: '更展唇', en: 'less rounded', combining: true },
  { s: '̟', zh: '前移', en: 'advanced', combining: true },
  { s: '̠', zh: '后移', en: 'retracted', combining: true },
  { s: '̈', zh: '央化', en: 'centralized', combining: true },
  { s: '̽', zh: '中央化', en: 'mid-centralized', combining: true },
  { s: '̩', zh: '成音节', en: 'syllabic', combining: true },
  { s: '̯', zh: '不成音节', en: 'non-syllabic', combining: true },
  { s: '˞', zh: '卷舌色彩', en: 'rhoticity' },
  { s: '̤', zh: '气声', en: 'breathy voiced', combining: true },
  { s: '̰', zh: '嘎裂声', en: 'creaky voiced', combining: true },
  { s: '̼', zh: '舌唇', en: 'linguolabial', combining: true },
  { s: 'ʷ', zh: '唇化', en: 'labialized' },
  { s: 'ʲ', zh: '腭化', en: 'palatalized' },
  { s: 'ˠ', zh: '软腭化', en: 'velarized' },
  { s: 'ˤ', zh: '咽化', en: 'pharyngealized' },
  { s: '̴', zh: '软腭化或咽化', en: 'velarized or pharyngealized', combining: true },
  { s: '̝', zh: '抬高', en: 'raised', combining: true },
  { s: '̞', zh: '降低', en: 'lowered', combining: true },
  { s: '̘', zh: '舌根前伸', en: 'advanced tongue root', combining: true },
  { s: '̙', zh: '舌根后缩', en: 'retracted tongue root', combining: true },
  { s: '̪', zh: '齿', en: 'dental', combining: true },
  { s: '̺', zh: '舌尖', en: 'apical', combining: true },
  { s: '̻', zh: '舌叶', en: 'laminal', combining: true },
  { s: '̃', zh: '鼻化', en: 'nasalized', combining: true },
  { s: 'ⁿ', zh: '鼻除阻', en: 'nasal release' },
  { s: 'ˡ', zh: '边除阻', en: 'lateral release' },
  { s: '̚', zh: '无除阻', en: 'no audible release', combining: true },
  { s: '͡', zh: '连音弧（上）', en: 'tie bar above', combining: true },
  { s: '͜', zh: '连音弧（下）', en: 'tie bar below', combining: true },
  { s: 'ʱ', zh: '浊送气', en: 'breathy aspirated' },
  { s: 'ˀ', zh: '喉塞化', en: 'glottalized' },
  { s: 'ᵊ', zh: '央元音除阻', en: 'schwa release' }
]

export const SUPRASEGMENTALS: Sym[] = [
  { s: 'ˈ', zh: '主重音', en: 'primary stress' },
  { s: 'ˌ', zh: '次重音', en: 'secondary stress' },
  { s: 'ː', zh: '长', en: 'long' },
  { s: 'ˑ', zh: '半长', en: 'half-long' },
  { s: '̆', zh: '超短', en: 'extra-short', combining: true },
  { s: '.', zh: '音节界', en: 'syllable break' },
  { s: '|', zh: '小停顿', en: 'minor group' },
  { s: '‖', zh: '大停顿', en: 'major group' },
  { s: '‿', zh: '连读', en: 'linking' },
  { s: '↗', zh: '全局升调', en: 'global rise' },
  { s: '↘', zh: '全局降调', en: 'global fall' },
  { s: '⁀', zh: '连接弧', en: 'tie' }
]

export const TONES: Sym[] = [
  { s: '˥', zh: '超高平（55）', en: 'extra high level' },
  { s: '˦', zh: '高平（44）', en: 'high level' },
  { s: '˧', zh: '中平（33）', en: 'mid level' },
  { s: '˨', zh: '低平（22）', en: 'low level' },
  { s: '˩', zh: '超低平（11）', en: 'extra low level' },
  { s: '˥˩', zh: '降（51）', en: 'falling' },
  { s: '˩˥', zh: '升（15）', en: 'rising' },
  { s: '˧˥', zh: '高升（35）', en: 'high rising' },
  { s: '˨˩˦', zh: '降升（214）', en: 'falling-rising' },
  { s: '˥˧', zh: '高降（53）', en: 'high falling' },
  { s: '̋', zh: '超高调符', en: 'extra high tone', combining: true },
  { s: '́', zh: '高调符', en: 'high tone', combining: true },
  { s: '̄', zh: '中调符', en: 'mid tone', combining: true },
  { s: '̀', zh: '低调符', en: 'low tone', combining: true },
  { s: '̏', zh: '超低调符', en: 'extra low tone', combining: true },
  { s: '̌', zh: '升调符', en: 'rising tone', combining: true },
  { s: '̂', zh: '降调符', en: 'falling tone', combining: true },
  { s: '᷄', zh: '高升调符', en: 'high rising tone', combining: true },
  { s: '᷅', zh: '低升调符', en: 'low rising tone', combining: true },
  { s: '᷈', zh: '升降调符', en: 'rising-falling tone', combining: true },
  { s: '⁰', zh: '上标 0', en: 'superscript 0' },
  { s: '¹', zh: '上标 1', en: 'superscript 1' },
  { s: '²', zh: '上标 2', en: 'superscript 2' },
  { s: '³', zh: '上标 3', en: 'superscript 3' },
  { s: '⁴', zh: '上标 4', en: 'superscript 4' },
  { s: '⁵', zh: '上标 5', en: 'superscript 5' }
]

export const SYMBOLS: Sym[] = [
  { s: '∅', zh: '零 / 空', en: 'zero / null' },
  { s: '→', zh: '变为', en: 'becomes' },
  { s: '←', zh: '来自', en: 'from' },
  { s: '⇒', zh: '推出', en: 'yields' },
  { s: '·', zh: '间隔点', en: 'middle dot' },
  { s: '¢', zh: '复合边界', en: 'compound boundary' },
  { s: '#', zh: '词界', en: 'word boundary' },
  { s: '_', zh: '目标位置', en: 'target slot' },
  { s: '=', zh: '附着词界', en: 'clitic boundary' },
  { s: '-', zh: '语素界', en: 'morpheme boundary' },
  { s: '‑', zh: '不换行连字符', en: 'non-breaking hyphen' },
  { s: '–', zh: '短横线', en: 'en dash' },
  { s: '—', zh: '长横线', en: 'em dash' },
  { s: '*', zh: '拟构 / 不合法', en: 'reconstructed / ungrammatical' },
  { s: '√', zh: '词根', en: 'root' },
  { s: '⟨', zh: '左尖括号（正字）', en: 'left angle bracket' },
  { s: '⟩', zh: '右尖括号（正字）', en: 'right angle bracket' },
  { s: '‹', zh: '左单书名号', en: 'single left angle quote' },
  { s: '›', zh: '右单书名号', en: 'single right angle quote' },
  { s: '«', zh: '左书名号', en: 'left guillemet' },
  { s: '»', zh: '右书名号', en: 'right guillemet' },
  { s: '/', zh: '音位斜线', en: 'phonemic slash' },
  { s: '[', zh: '左方括号（音值）', en: 'left bracket' },
  { s: ']', zh: '右方括号（音值）', en: 'right bracket' },
  { s: '⁓', zh: '交替', en: 'alternates with' },
  { s: '≈', zh: '约等', en: 'approximately' },
  { s: '′', zh: '撇', en: 'prime' },
  { s: '″', zh: '双撇', en: 'double prime' },
  { s: 'ʔ', zh: '声门塞音', en: 'glottal stop' },
  { s: 'ˀ', zh: '喉塞化', en: 'glottalization' },
  { s: '◌', zh: '虚位圆圈', en: 'dotted circle' }
]

export const LATIN_EXTRA: { zh: string; en: string; items: string[] }[] = [
  { zh: '长音', en: 'Macron', items: ['ā', 'ē', 'ī', 'ō', 'ū', 'ǣ', 'Ā', 'Ē', 'Ī', 'Ō', 'Ū'] },
  { zh: '锐音', en: 'Acute', items: ['á', 'é', 'í', 'ó', 'ú', 'ý', 'ǽ', 'ń', 'ś', 'ź', 'ć', 'ĺ', 'ŕ', 'Á', 'É', 'Í', 'Ó', 'Ú'] },
  { zh: '抑音', en: 'Grave', items: ['à', 'è', 'ì', 'ò', 'ù', 'ǹ', 'À', 'È', 'Ì', 'Ò', 'Ù'] },
  { zh: '扬抑', en: 'Circumflex', items: ['â', 'ê', 'î', 'ô', 'û', 'ŷ', 'ĉ', 'ĝ', 'ĥ', 'ĵ', 'ŝ', 'ŵ', 'Â', 'Ê', 'Î', 'Ô', 'Û'] },
  { zh: '抑扬', en: 'Caron', items: ['ǎ', 'ě', 'ǐ', 'ǒ', 'ǔ', 'č', 'š', 'ž', 'ř', 'ň', 'ď', 'ť', 'ľ', 'ǧ', 'ǰ', 'Č', 'Š', 'Ž'] },
  { zh: '分音', en: 'Diaeresis', items: ['ä', 'ë', 'ï', 'ö', 'ü', 'ÿ', 'Ä', 'Ë', 'Ï', 'Ö', 'Ü'] },
  { zh: '波浪', en: 'Tilde', items: ['ã', 'ẽ', 'ĩ', 'õ', 'ũ', 'ñ', 'ỹ', 'Ã', 'Ñ', 'Õ'] },
  { zh: '短音', en: 'Breve', items: ['ă', 'ĕ', 'ĭ', 'ŏ', 'ŭ', 'ğ', 'Ă', 'Ğ', 'Ŭ'] },
  { zh: '上点 / 下点', en: 'Dots', items: ['ȧ', 'ė', 'ȯ', 'ċ', 'ġ', 'ż', 'ạ', 'ẹ', 'ị', 'ọ', 'ụ', 'ḍ', 'ṭ', 'ṇ', 'ḷ', 'ṛ', 'ṣ', 'ḥ', 'ẓ', 'ṃ'] },
  { zh: '尾钩 / 软音', en: 'Ogonek & cedilla', items: ['ą', 'ę', 'į', 'ǫ', 'ų', 'ç', 'ş', 'ţ', 'ģ', 'ķ', 'ļ', 'ņ', 'ŗ', 'Ç', 'Ş'] },
  { zh: '其他字母', en: 'Other letters', items: ['æ', 'œ', 'ø', 'å', 'ð', 'þ', 'ŋ', 'ß', 'ł', 'đ', 'ħ', 'ı', 'ĸ', 'ſ', 'ƿ', 'ȝ', 'ƶ', 'ƀ', 'ɨ', 'ʉ', 'ɐ', 'ǝ', 'Æ', 'Œ', 'Ø', 'Å', 'Ð', 'Þ', 'Ŋ', 'Ł', 'Đ', 'Ħ'] },
  { zh: '双锐 / 双抑', en: 'Double acute & grave', items: ['ő', 'ű', 'ȁ', 'ȅ', 'ȉ', 'ȍ', 'ȕ', 'Ő', 'Ű'] },
  { zh: '上环 / 横杠', en: 'Ring & stroke', items: ['å', 'ů', 'ẘ', 'ẙ', 'ƀ', 'đ', 'ǥ', 'ħ', 'ɨ', 'ł', 'ø', 'ŧ', 'ʉ', 'ƶ'] }
]

/** 全部符号扁平化（用于搜索与命名） */
export function allSymbols(): Sym[] {
  const out: Sym[] = []
  PULMONIC.forEach((row, mi) =>
    row.forEach((cell, pi) => {
      if (cell[0]) out.push({ s: cell[0], ...consonantName(mi, pi, false) })
      if (cell[1]) out.push({ s: cell[1], ...consonantName(mi, pi, true) })
    })
  )
  out.push(...OTHER_PULMONIC)
  for (const g of NON_PULMONIC) out.push(...g.items)
  VOWELS.forEach((row, hi) =>
    row.forEach((cell, bi) => {
      if (cell[0]) out.push({ s: cell[0], ...vowelName(hi, bi, false) })
      if (cell[1]) out.push({ s: cell[1], ...vowelName(hi, bi, true) })
    })
  )
  out.push(...OTHER_VOWELS, ...DIACRITICS, ...SUPRASEGMENTALS, ...TONES, ...SYMBOLS)
  for (const g of LATIN_EXTRA) for (const s of g.items) out.push({ s, zh: `${g.zh} ${s}`, en: `${g.en} ${s}` })
  return out
}

const nameIndex = new Map<string, Sym>()
for (const sym of allSymbols()) if (!nameIndex.has(sym.s)) nameIndex.set(sym.s, sym)

export function symbolInfo(s: string): Sym | undefined {
  return nameIndex.get(s)
}

/** U+XXXX 码位列表 */
export function codepoints(s: string): string[] {
  return Array.from(s).map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
}
