/**
 * 项目文件的读写：JSON 序列化、版本迁移、基本校验、文件夹格式导出。
 */
import {
  SCHEMA_VERSION,
  type Etymology,
  type MorphStep,
  type Project,
  type SlotGenerator
} from './model'
import { createEtymology, createProject, newId } from './factory'

export const PROJECT_EXTENSION = '.laim.json'

export class ProjectParseError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid-json' | 'not-a-project' | 'newer-schema'
  ) {
    super(message)
  }
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2) + '\n'
}

/** 解析并迁移到当前 schema。缺失的顶层集合补空，未知字段保留。 */
export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectParseError('文件不是合法的 JSON', 'invalid-json')
  }
  if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || !('meta' in raw)) {
    throw new ProjectParseError('文件不是千语集项目', 'not-a-project')
  }
  const obj = raw as Partial<Project> & { schemaVersion: number }
  if (obj.schemaVersion > SCHEMA_VERSION) {
    throw new ProjectParseError('此文件由更新版本的千语集创建', 'newer-schema')
  }
  return migrate(obj)
}

function migrate(obj: Partial<Project> & { schemaVersion: number }): Project {
  // v1 之后的迁移在这里逐级追加：if (obj.schemaVersion < 2) { ... obj.schemaVersion = 2 }
  const blank = createProject({
    name: obj.meta?.name ?? '',
    template: obj.meta?.template ?? 'blank',
    appVersion: obj.meta?.appVersion ?? '',
    uiLocale: 'zh'
  })
  blank.languages = []
  blank.settings.defaultLanguageId = null
  const merged: Project = {
    ...blank,
    ...obj,
    meta: { ...blank.meta, ...(obj.meta ?? {}) },
    settings: { ...blank.settings, ...(obj.settings ?? {}) },
    schemaVersion: SCHEMA_VERSION
  }
  for (const key of [
    'languages',
    'ruleSets',
    'categories',
    'posList',
    'morphemes',
    'lexemes',
    'paradigms',
    'sentences',
    'phrasebook',
    'abbreviations',
    'docs'
  ] as const) {
    if (!Array.isArray(merged[key])) (merged as unknown as Record<string, unknown>)[key] = []
  }
  if (!merged.settings.imageSize) merged.settings.imageSize = { width: 320, height: 240 }
  for (const s of merged.sentences)
    if (!s.scriptForms || typeof s.scriptForms !== 'object') s.scriptForms = {}
  for (const l of merged.lexemes) {
    if (!Array.isArray(l.relations)) l.relations = []
    if (!l.scriptForms || typeof l.scriptForms !== 'object') l.scriptForms = {}
    if (!Array.isArray(l.images)) l.images = []
    l.etymology = migrateEtymology(l.etymology)
  }
  for (const m of merged.morphemes) m.etymology = migrateEtymology(m.etymology)
  for (const p of merged.paradigms) {
    if (!Array.isArray(p.variants)) p.variants = []
    for (const [k, g] of Object.entries(p.generators)) p.generators[k] = toPipeline(g)
  }
  for (const lang of merged.languages) {
    if (!lang.prosody)
      lang.prosody = { type: 'none', stressPosition: 'initial', rules: '', tones: [] }
    if (!lang.prosody.stressPosition) lang.prosody.stressPosition = 'initial'
    if (!Array.isArray(lang.phonemes)) lang.phonemes = []
    if (!Array.isArray(lang.classes)) lang.classes = []
    if (!Array.isArray(lang.digraphs)) lang.digraphs = []
    if (!Array.isArray(lang.scripts)) lang.scripts = []
  }
  return merged
}

/**
 * 旧版的四种生成器转成流水线：起点是词干，后面按原来的执行顺序排好。
 * 旧写法仍能跑，转过来只是为了编辑器里统一成「一步一步加」。
 */
function toPipeline(g: SlotGenerator): SlotGenerator {
  if (!g || g.kind === 'none' || g.kind === 'table' || g.kind === 'pipeline') return g
  type StepBody = { [K in MorphStep as never]: never } & Record<string, unknown>
  const step = (x: StepBody): MorphStep => ({ id: newId(), ...x }) as unknown as MorphStep
  const steps: MorphStep[] = []
  if (g.kind === 'affix' || g.kind === 'affix-sca') {
    if (g.kind === 'affix' && g.infix)
      steps.push(step({ kind: 'infix', text: g.infix, at: g.infixAt ?? '' }))
    if (g.prefix) steps.push(step({ kind: 'prefix', text: g.prefix }))
    if (g.suffix) steps.push(step({ kind: 'suffix', text: g.suffix }))
  } else if (g.kind === 'pattern') steps.push(step({ kind: 'pattern', pattern: g.pattern }))
  else if (g.kind === 'reduplication')
    steps.push(step({ kind: 'reduplication', scope: g.scope, length: g.length }))
  if (g.pre) {
    const adjust = step({ kind: 'adjust', text: g.pre })
    // 模板与重叠的 pre 原本在动作之前跑
    if (g.kind === 'pattern' || g.kind === 'reduplication') steps.unshift(adjust)
    else steps.push(adjust)
  }
  if (g.kind === 'affix-sca' && g.ruleSetId)
    steps.push(
      step({ kind: 'sca', ruleSetId: g.ruleSetId, fromStage: g.fromStage, toStage: g.toStage })
    )
  if (g.post) steps.push(step({ kind: 'adjust', text: g.post }))
  return { kind: 'pipeline', stem: g.stem ?? '', steps }
}

/** 旧版的「原始形」并入来源；补上中间态数组 */
function migrateEtymology(e: Etymology | undefined): Etymology {
  const ety = e ?? createEtymology()
  if (!Array.isArray(ety.sources)) ety.sources = []
  if (!Array.isArray(ety.stages)) ety.stages = []
  if (typeof ety.type !== 'string') ety.type = 'unknown'
  if (typeof ety.notes !== 'string') ety.notes = ''
  const proto = (ety.protoForm ?? '').trim()
  if (proto) {
    if (!ety.sources.length)
      ety.sources.push({ kind: 'external', language: '', form: proto, meaning: '' })
    delete ety.protoForm
  }
  return ety
}

/**
 * 文件夹格式：每个集合一个文件，便于 git diff。
 * 返回相对路径 → 内容。规则集另出一份纯文本。
 */
export function projectToFolder(p: Project): Record<string, string> {
  const j = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'
  const files: Record<string, string> = {
    'project.json': j({ schemaVersion: p.schemaVersion, meta: p.meta, settings: p.settings }),
    'languages.json': j(p.languages),
    'rule-sets.json': j(p.ruleSets.map((r) => ({ ...r, text: undefined }))),
    'categories.json': j(p.categories),
    'parts-of-speech.json': j(p.posList),
    'morphemes.json': j(p.morphemes),
    'lexemes.json': j(p.lexemes),
    'paradigms.json': j(p.paradigms),
    'sentences.json': j(p.sentences),
    'phrasebook.json': j(p.phrasebook),
    'abbreviations.json': j(p.abbreviations)
  }
  // 规则文本各自一份，可直接喂给引擎或其他工具
  for (const r of p.ruleSets)
    files[`rules/${safeName(r.name || r.id)}.txt`] = r.text.endsWith('\n') ? r.text : r.text + '\n'
  for (const d of p.docs) files[`docs/${safeName(d.title || d.id)}.md`] = d.markdown
  return files
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

/** 从文件夹格式读回（用于导入） */
export function projectFromFolder(files: Record<string, string>): Project {
  const read = <T>(name: string, fallback: T): T => {
    const t = files[name]
    if (t == null) return fallback
    return JSON.parse(t) as T
  }
  const head = read<{
    schemaVersion: number
    meta: Project['meta']
    settings: Project['settings']
  }>('project.json', {
    schemaVersion: SCHEMA_VERSION,
    meta: undefined as never,
    settings: undefined as never
  })
  const ruleSets = read<Project['ruleSets']>('rule-sets.json', []).map((r) => {
    const text = files[`rules/${safeName(r.name || r.id)}.txt`] ?? ''
    return { ...r, text: text.replace(/\n$/, '') }
  })
  const obj: Partial<Project> & { schemaVersion: number } = {
    schemaVersion: head.schemaVersion,
    meta: head.meta,
    settings: head.settings,
    languages: read('languages.json', []),
    ruleSets,
    categories: read('categories.json', []),
    posList: read('parts-of-speech.json', []),
    morphemes: read('morphemes.json', []),
    lexemes: read('lexemes.json', []),
    paradigms: read('paradigms.json', []),
    sentences: read('sentences.json', []),
    phrasebook: read('phrasebook.json', []),
    abbreviations: read('abbreviations.json', []),
    docs: []
  }
  if (!obj.meta) throw new ProjectParseError('缺少 project.json', 'not-a-project')
  return migrate(obj)
}
