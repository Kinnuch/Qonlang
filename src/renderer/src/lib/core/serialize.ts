/**
 * 项目文件的读写：JSON 序列化、版本迁移、基本校验、文件夹格式导出。
 */
import { canonicalizeSlotKeys } from './slotKeys'
import { isSealed, sealText, unsealText } from './sealed'
import {
  CUSTOM_FIELD_KINDS,
  CUSTOM_FIELD_POSITIONS,
  SCHEMA_VERSION,
  type Etymology,
  type MorphStep,
  type Project,
  type SlotGenerator
} from './model'
import { createDoc, createEtymology, createProject, newId } from './factory'
import { splitRegisters } from './register'
import { normalizeDisplayLanguages } from './displayLanguages'
import { normalizeDocFolders } from './docFolders'
import { normalizeScriptFolderScope, normalizeScriptIds } from './scriptScope'
import { ensureProjectFolders } from './projectFolders'

export const PROJECT_EXTENSION = '.laim.json'

export class ProjectParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      'invalid-json' | 'not-a-project' | 'newer-schema' | 'invalid-csv' | 'sealed-broken'
  ) {
    super(message)
  }
}

/** 读进来的项目文件文本：纯欣赏副本是加过密的，先还原成 JSON；普通项目原样返回 */
export async function readProjectText(text: string): Promise<string> {
  if (!isSealed(text)) return text
  try {
    return await unsealText(text)
  } catch {
    throw new ProjectParseError('纯欣赏副本读不出来', 'sealed-broken')
  }
}

/** 纯欣赏项目写盘（另存为、导出副本）：加密后再写，别人拿到文件也看不到内容 */
export async function serializeForDisk(p: Project): Promise<string> {
  const json = serializeProject(p)
  return p.meta.readOnly ? sealText(json) : json
}

/**
 * 写盘时每个义项另带一份拼起来的 register（顿号连接）：0.7.1 及更早的版本只认这个字段，打开新文件也看得到语域。
 * 读回来时迁移会把它去掉，只留 registers。
 */
function withLegacyRegister(key: string, value: unknown): unknown {
  if (key !== 'senses' || !Array.isArray(value)) return value
  return value.map((se: unknown) => {
    const regs = (se as { registers?: unknown } | null)?.registers
    return Array.isArray(regs) ? { ...(se as object), register: regs.join('、') } : se
  })
}

export function serializeProject(p: Project): string {
  return JSON.stringify(p, withLegacyRegister, 2) + '\n'
}

/** 解析并迁移到当前 schema。缺失的顶层集合补空，未知字段保留。 */
export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ProjectParseError('文件不是合法的 JSON', 'invalid-json')
  }
  return projectFromObject(raw)
}

/** 已经解析成对象的项目（项目文件、项目 CSV 读回来的）：检查、迁移到当前 schema */
export function projectFromObject(raw: unknown): Project {
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
    'docs',
    'customFields'
  ] as const) {
    if (!Array.isArray(merged[key])) (merged as unknown as Record<string, unknown>)[key] = []
  }
  if (!merged.settings.imageSize) merged.settings.imageSize = { width: 320, height: 240 }
  if (
    merged.settings.folderView !== undefined &&
    !['icons', 'details'].includes(merged.settings.folderView)
  )
    delete merged.settings.folderView
  if (merged.settings.folderMetadata !== undefined) {
    if (!Array.isArray(merged.settings.folderMetadata)) delete merged.settings.folderMetadata
    else
      merged.settings.folderMetadata = [
        ...new Set(
          merged.settings.folderMetadata.filter((key) =>
            ['tags', 'createdAt', 'size', 'type'].includes(key)
          )
        )
      ]
  }
  for (const key of ['definitionDisplay', 'translationDisplay'] as const) {
    if (merged.settings[key] === undefined) continue
    const selection = normalizeDisplayLanguages(merged.settings[key])
    if (selection) merged.settings[key] = selection
    else delete merged.settings[key]
  }
  if (
    merged.folders !== undefined ||
    merged.corpusFolders !== undefined ||
    merged.docFolders !== undefined
  )
    ensureProjectFolders(merged)
  if (merged.docFolders !== undefined) merged.docFolders = normalizeDocFolders(merged.docFolders)
  if (merged.corpusFolders !== undefined) {
    const seen = new Set<string>()
    merged.corpusFolders = Array.isArray(merged.corpusFolders)
      ? merged.corpusFolders.filter((folder) => {
          if (
            !folder ||
            typeof folder.id !== 'string' ||
            !folder.id ||
            seen.has(folder.id) ||
            typeof folder.languageId !== 'string' ||
            typeof folder.name !== 'string'
          )
            return false
          seen.add(folder.id)
          return true
        })
      : []
  }
  // 检视器模块（0.7.3 起）：缺的设置补上默认值
  for (const f of merged.customFields) {
    if (!f.name || typeof f.name !== 'object') f.name = {}
    if (!CUSTOM_FIELD_KINDS.includes(f.kind)) f.kind = 'text'
    if (!CUSTOM_FIELD_POSITIONS.includes(f.position)) f.position = 'afterSenses'
    if (!Array.isArray(f.languageIds)) f.languageIds = []
    if (!Array.isArray(f.aliases)) f.aliases = []
    if (typeof f.scriptId !== 'string') f.scriptId = null
  }
  for (const s of merged.sentences)
    if (!s.scriptForms || typeof s.scriptForms !== 'object') s.scriptForms = {}
  for (const sentence of merged.sentences)
    if (sentence.hiddenScriptIds !== undefined)
      sentence.hiddenScriptIds = normalizeScriptIds(sentence.hiddenScriptIds).filter(Boolean)
  for (const l of merged.lexemes) {
    if (!Array.isArray(l.relations)) l.relations = []
    if (!l.scriptForms || typeof l.scriptForms !== 'object') l.scriptForms = {}
    if (!Array.isArray(l.images)) l.images = []
    if (l.custom !== undefined && (!l.custom || typeof l.custom !== 'object')) delete l.custom
    // 语域从一段文字改成了列表：旧文件里的 register 拆开放进 registers
    for (const se of Array.isArray(l.senses) ? l.senses : []) {
      const legacy = (se as { register?: unknown }).register
      if (!Array.isArray(se.registers))
        se.registers = typeof legacy === 'string' ? splitRegisters(legacy) : []
      delete (se as { register?: unknown }).register
    }
    l.etymology = migrateEtymology(l.etymology)
  }
  for (const m of merged.morphemes) m.etymology = migrateEtymology(m.etymology)
  for (const p of merged.paradigms) {
    if (!Array.isArray(p.variants)) p.variants = []
    for (const [k, g] of Object.entries(p.generators)) p.generators[k] = toPipeline(g)
  }
  // 槽位键跟维度先后无关（0.9.4 起）：旧文件里按维度先后拼的键换成按维度 id 排的
  canonicalizeSlotKeys(merged)
  for (const lang of merged.languages) {
    if (!lang.prosody)
      lang.prosody = { type: 'none', stressPosition: 'initial', rules: '', tones: [] }
    if (!lang.prosody.stressPosition) lang.prosody.stressPosition = 'initial'
    if (!Array.isArray(lang.phonemes)) lang.phonemes = []
    if (!Array.isArray(lang.classes)) lang.classes = []
    if (!Array.isArray(lang.digraphs)) lang.digraphs = []
    if (!Array.isArray(lang.scripts)) lang.scripts = []
    for (const script of lang.scripts)
      if (script.folderScope !== undefined) {
        const scope = normalizeScriptFolderScope(script.folderScope)
        if (scope) script.folderScope = scope
        else delete script.folderScope
      }
  }
  return merged
}

/**
 * 旧版的四种生成器转成流水线：起点是词干，后面按原来的执行顺序排好。
 * 旧写法仍能跑，转过来只是为了编辑器里统一成「一步一步加」。
 */
function toPipeline(g: SlotGenerator): SlotGenerator {
  if (!g || g.kind === 'none' || g.kind === 'table' || g.kind === 'pipeline' || g.kind === 'plugin')
    return g
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
  const j = (v: unknown): string => JSON.stringify(v, withLegacyRegister, 2) + '\n'
  const files: Record<string, string> = {
    'project.json': j({
      schemaVersion: p.schemaVersion,
      meta: p.meta,
      settings: p.settings,
      ...(p.glyphEditor ? { glyphEditor: p.glyphEditor } : {}),
      ...(p.morphemeSlots ? { morphemeSlots: p.morphemeSlots } : {}),
      ...(p.folders ? { folders: p.folders } : {}),
      ...(p.corpusFolders ? { corpusFolders: p.corpusFolders } : {}),
      ...(p.docFolders ? { docFolders: p.docFolders } : {})
    }),
    'languages.json': j(p.languages),
    'rule-sets.json': j(p.ruleSets.map((r) => ({ ...r, text: undefined }))),
    'categories.json': j(p.categories),
    'parts-of-speech.json': j(p.posList),
    'morphemes.json': j(p.morphemes),
    'lexemes.json': j(p.lexemes),
    'paradigms.json': j(p.paradigms),
    'sentences.json': j(p.sentences),
    'phrasebook.json': j(p.phrasebook),
    'abbreviations.json': j(p.abbreviations),
    'custom-fields.json': j(p.customFields)
  }
  // 规则文本各自一份，可直接喂给引擎或其他工具
  const rulePaths = folderPaths(
    p.ruleSets.map((r) => r.name || r.id),
    'rules',
    'txt'
  )
  for (const [i, r] of p.ruleSets.entries())
    files[rulePaths[i]] = r.text.endsWith('\n') ? r.text : r.text + '\n'
  const docPaths = folderPaths(
    p.docs.map((d) => d.title || d.id),
    'docs',
    p.docs.map((d) => (d.format === 'html' ? 'html' : 'md'))
  )
  files['docs.json'] = j(p.docs.map((d, i) => ({ ...d, markdown: undefined, path: docPaths[i] })))
  for (const [i, d] of p.docs.entries()) files[docPaths[i]] = d.markdown
  return files
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'untitled'
}

/** 文件名清理、大小写与 Unicode 规范化都可能使不同标题指向同一个文件。 */
function folderPaths(names: string[], dir: string, ext: string | string[]): string[] {
  const used = new Set<string>()
  const key = (name: string): string => name.normalize('NFC').toLowerCase()
  return names.map((name, index) => {
    const clean = safeName(name)
    let unique = clean
    let n = 2
    while (used.has(key(unique))) unique = `${clean} (${n++})`
    used.add(key(unique))
    return `${dir}/${unique}.${Array.isArray(ext) ? ext[index] : ext}`
  })
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
    glyphEditor?: Project['glyphEditor']
    morphemeSlots?: Project['morphemeSlots']
    folders?: Project['folders']
    corpusFolders?: Project['corpusFolders']
    docFolders?: Project['docFolders']
  }>('project.json', {
    schemaVersion: SCHEMA_VERSION,
    meta: undefined as never,
    settings: undefined as never
  })
  const storedRules = read<Project['ruleSets']>('rule-sets.json', [])
  const rulePaths = folderPaths(
    storedRules.map((r) => r.name || r.id),
    'rules',
    'txt'
  )
  const ruleSets = storedRules.map((r, i) => {
    const text = files[rulePaths[i]] ?? files[`rules/${safeName(r.name || r.id)}.txt`] ?? ''
    return { ...r, text: text.replace(/\n$/, '') }
  })
  const obj: Partial<Project> & { schemaVersion: number } = {
    schemaVersion: head.schemaVersion,
    meta: head.meta,
    settings: head.settings,
    ...(head.glyphEditor ? { glyphEditor: head.glyphEditor } : {}),
    ...(head.morphemeSlots ? { morphemeSlots: head.morphemeSlots } : {}),
    ...(head.folders ? { folders: head.folders } : {}),
    ...(head.corpusFolders ? { corpusFolders: head.corpusFolders } : {}),
    ...(head.docFolders ? { docFolders: head.docFolders } : {}),
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
    customFields: read('custom-fields.json', []),
    docs: []
  }
  // 新版目录保留文档ID、语言和格式；旧版只有docs/*.md，仍按标题恢复为项目通用文档。
  const docMeta = read<(Omit<Project['docs'][number], 'markdown'> & { path: string })[] | null>(
    'docs.json',
    null
  )
  if (Array.isArray(docMeta)) {
    obj.docs = docMeta
      .filter(
        (d) =>
          typeof d.path === 'string' &&
          /^docs\/[^/\\]+\.(?:md|html?)$/i.test(d.path) &&
          typeof files[d.path] === 'string'
      )
      .map(({ path, ...d }) => ({ ...d, markdown: files[path] }))
  } else {
    obj.docs = Object.entries(files)
      .filter(([path]) => /^docs\/[^/\\]+\.(?:md|html?)$/i.test(path))
      .map(([path, markdown]) => {
        const { createdAt: _unknownCreatedAt, ...doc } = createDoc(
          null,
          path.slice(5).replace(/\.(?:md|html?)$/i, '')
        )
        return { ...doc, ...(/\.html?$/i.test(path) ? { format: 'html' as const } : {}), markdown }
      })
  }
  if (!obj.meta) throw new ProjectParseError('缺少 project.json', 'not-a-project')
  return migrate(obj)
}
