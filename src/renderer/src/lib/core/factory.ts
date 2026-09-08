/**
 * 创建各类空对象的工厂。所有默认值都是「空」而不是某门语言的预设。
 */
import {
  SCHEMA_VERSION,
  type Id,
  type Language,
  type Lexeme,
  type Morpheme,
  type MorphemeType,
  type Orthography,
  type Project,
  type ProjectTemplate,
  type RuleSet,
  type Sentence,
  type Phrase,
  type DocPage,
  type Script,
  type Sense
} from './model'

export function newId(): Id {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // 极简回退（非加密用途）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function now(): string {
  return new Date().toISOString()
}

/** 语言卡片的可选色板（仅是给用户挑的默认，随时可改） */
export const LANGUAGE_COLORS = [
  '#0E9F8A',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#64748B'
]

export const MORPHEME_TYPES: MorphemeType[] = [
  'root',
  'prefix',
  'suffix',
  'infix',
  'circumfix',
  'clitic',
  'pattern',
  'particle'
]

export function createOrthography(name: string, isPrimary = false): Orthography {
  return {
    id: newId(),
    name,
    font: '',
    direction: 'ltr',
    rulesToIpa: '',
    rulesFromIpa: '',
    isPrimary
  }
}

export function createScript(name: string): Script {
  return {
    id: newId(),
    name,
    type: 'alphabet',
    direction: 'ltr',
    font: { family: '', dataUrl: null, fileName: '' },
    glyphs: [],
    rules: '@glyphs',
    notes: ''
  }
}

export function createLanguage(init: Partial<Language> & { name: string }): Language {
  const primaryOrthoName = 'Romanization'
  return {
    id: newId(),
    abbr: '',
    color: LANGUAGE_COLORS[0],
    parentId: null,
    notes: '',
    phonemes: [],
    classes: [],
    digraphs: [],
    orthographies: [createOrthography(primaryOrthoName, true)],
    syllable: { enabled: false, template: '', strategy: 'maximal-onset' },
    prosody: { type: 'none', stressPosition: 'initial', rules: '', tones: [] },
    phonotactics: {
      onsets: [],
      nuclei: [],
      codas: [],
      illegal: [],
      weights: {},
      minSyllables: 1,
      maxSyllables: 3
    },
    alphabet: [],
    dialects: [],
    scripts: [],
    ...init
  }
}

export function createSense(): Sense {
  return { id: newId(), definition: {}, tags: [], dialectIds: [], register: '', examples: [] }
}

export function createLexeme(languageId: Id, lemma = ''): Lexeme {
  const t = now()
  return {
    id: newId(),
    languageId,
    lemma,
    posId: null,
    features: {},
    tags: [],
    dialectIds: [],
    senses: [createSense()],
    etymology: { type: 'unknown', sources: [], protoForm: '', notes: '' },
    stems: {},
    forms: {},
    pronunciations: {},
    relations: [],
    scriptForms: {},
    notes: '',
    createdAt: t,
    updatedAt: t
  }
}

export function createMorpheme(languageId: Id, type: MorphemeType = 'root'): Morpheme {
  return {
    id: newId(),
    languageId,
    type,
    form: '',
    form2: '',
    allomorphs: [],
    gloss: '',
    meaning: {},
    features: {},
    tags: [],
    notes: ''
  }
}

export function createPhrase(languageId: Id, category = ''): Phrase {
  return {
    id: newId(),
    languageId,
    category,
    text: '',
    translation: {},
    pronunciations: {},
    variants: [],
    tags: []
  }
}

export function createDoc(languageId: Id | null, title = ''): DocPage {
  return { id: newId(), languageId, title, markdown: '', updatedAt: now() }
}

export function createSentence(languageId: Id): Sentence {
  return {
    id: newId(),
    languageId,
    text: '',
    orthoTexts: {},
    translation: {},
    source: '',
    tags: [],
    tokens: [],
    extraLines: [],
    notes: ''
  }
}

export function createRuleSet(name: string, text = ''): RuleSet {
  return { id: newId(), name, notes: '', text, stageLanguages: {}, testWords: '', updatedAt: now() }
}

export interface CreateProjectOptions {
  name: string
  template: ProjectTemplate
  appVersion: string
  /** 界面语言，决定默认释义语言顺序 */
  uiLocale: string
  /** family 模板：祖语名与子语言名 */
  familyNames?: { proto: string; daughters: string[] }
}

export function createProject(opts: CreateProjectOptions): Project {
  const t = now()
  const languages: Language[] = []
  if (opts.template === 'family' && opts.familyNames) {
    const proto = createLanguage({ name: opts.familyNames.proto, color: LANGUAGE_COLORS[7] })
    languages.push(proto)
    opts.familyNames.daughters.forEach((n, i) => {
      if (!n.trim()) return
      languages.push(
        createLanguage({
          name: n.trim(),
          parentId: proto.id,
          color: LANGUAGE_COLORS[i % (LANGUAGE_COLORS.length - 1)]
        })
      )
    })
  } else if (opts.template === 'blank') {
    languages.push(createLanguage({ name: opts.name }))
  }
  const glossLanguages = opts.uiLocale.startsWith('zh') ? ['zh', 'en'] : ['en', 'zh']
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      id: newId(),
      name: opts.name,
      description: '',
      author: '',
      createdAt: t,
      updatedAt: t,
      template: opts.template,
      appVersion: opts.appVersion
    },
    languages,
    ruleSets: [],
    categories: [],
    posList: [],
    morphemes: [],
    lexemes: [],
    paradigms: [],
    sentences: [],
    phrasebook: [],
    abbreviations: [],
    docs: [],
    settings: {
      defaultLanguageId: languages[0]?.id ?? null,
      glossLanguages,
      morphemeBoundaries: ['-', '='],
      abbreviationStyle: 'leipzig',
      exportTemplates: [],
      dataFont: '',
      lexiconColumns: []
    }
  }
}

/** 语系树：返回 parentId → 子语言列表 */
export function languageChildren(languages: Language[]): Map<Id | null, Language[]> {
  const m = new Map<Id | null, Language[]>()
  for (const l of languages) {
    const key = l.parentId && languages.some((x) => x.id === l.parentId) ? l.parentId : null
    if (!m.has(key)) m.set(key, [])
    m.get(key)!.push(l)
  }
  return m
}

/** 把 languageId 的祖先链（含自身）从根到叶排出来 */
export function languageLineage(languages: Language[], id: Id): Language[] {
  const byId = new Map(languages.map((l) => [l.id, l]))
  const out: Language[] = []
  let cur = byId.get(id)
  const seen = new Set<Id>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    out.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return out
}

/** 判断把 childId 挂到 newParentId 下会不会成环 */
export function wouldCreateCycle(
  languages: Language[],
  childId: Id,
  newParentId: Id | null
): boolean {
  if (!newParentId) return false
  if (childId === newParentId) return true
  const byId = new Map(languages.map((l) => [l.id, l]))
  let cur = byId.get(newParentId)
  const seen = new Set<Id>()
  while (cur && !seen.has(cur.id)) {
    if (cur.id === childId) return true
    seen.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return false
}
