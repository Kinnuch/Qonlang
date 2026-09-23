/**
 * 学习包：给 Qonlang Study（学语言的软件）用的导出格式。
 *
 * 学习设置（课程编排、不给学习者看的内容、默认显示、个别词的级别、作者录音……）**不写进项目文件**：
 * 存在本机（按项目 id 记住，下次导出接着用），导出时跟项目一起打进一个 `.qstudy.json`。
 * Qonlang Study 同步千语集引擎时会拿到这个文件，两边读写的是同一份定义。
 */
import type { Id, Project } from './model'
import { projectFromObject, serializeProject } from './serialize'

export const STUDY_PACK_FORMAT = 'qonlang-study-pack'
export const STUDY_PACK_VERSION = 1
export const STUDY_PACK_EXTENSION = '.qstudy.json'
/** 手动钉级别时最多几级（Qonlang Study 按词频分 3–5 级，钉得比实际级数高时落到最后一级） */
export const STUDY_MAX_LEVEL = 5

/** 一课：标题、讲解用的文档、这一课的新词和例句、短语 */
export interface StudyLesson {
  id: Id
  title: string
  docId: Id | null
  lexemeIds: Id[]
  sentenceIds: Id[]
  phraseIds: Id[]
}

/** 作者录的一段音：data URL（audio/webm、audio/mpeg……），文件名只是给人看的 */
export interface StudyAudio {
  dataUrl: string
  name: string
}

export interface StudyLanguage {
  languageId: Id
  /** 导不导出这门语言 */
  include: boolean
  /** 学习包的标题（学习者看到的这门语言的名字），空着用语言名 */
  title: string
  /** 封面介绍（Markdown） */
  intro: string
  lessons: StudyLesson[]
  /** 不给学习者看的内容 */
  hidden: { lexemeIds: Id[]; sentenceIds: Id[]; phraseIds: Id[]; docIds: Id[] }
  /** 手动钉的级别：词条 id → 1…STUDY_MAX_LEVEL；没钉的按词频自动分 */
  levels: Record<Id, number>
  /** 学习者默认看到什么：用哪套正字法、默认用哪套文字写（null 是用字母写）、显不显示 IPA */
  display: { orthographyId: Id | null; scriptId: Id | null; showIpa: boolean }
  /** 作者的录音：`lexeme-<词条 id>`、`phrase-<短语 id>`、`sentence-<例句 id>` → 录音 */
  audio: Record<string, StudyAudio>
}

export interface StudySettings {
  projectId: Id
  author: string
  languages: StudyLanguage[]
  updatedAt: string
}

export interface StudyPackFile {
  format: typeof STUDY_PACK_FORMAT
  version: number
  exportedAt: string
  /** 导出它的千语集版本 */
  qonlangVersion: string
  study: StudySettings
  project: Project
}

export class StudyPackError extends Error {
  constructor(
    message: string,
    public readonly code: 'not-a-study-pack' | 'newer-study-pack'
  ) {
    super(message)
  }
}

const newLessonId = (): Id =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'l' + Math.random().toString(36).slice(2)

/** 词头里一个字母都没有的词条（套构形用的「·」这类占位）：默认建议藏起来 */
export function isPlaceholderLexeme(lemma: string): boolean {
  return !/\p{L}/u.test(lemma)
}

function defaultLanguage(project: Project, languageId: Id): StudyLanguage {
  const lang = project.languages.find((l) => l.id === languageId)
  const primary = lang?.orthographies.find((o) => o.isPrimary) ?? lang?.orthographies[0]
  return {
    languageId,
    include: project.lexemes.some((l) => l.languageId === languageId),
    title: '',
    intro: '',
    lessons: [],
    hidden: {
      lexemeIds: project.lexemes
        .filter((l) => l.languageId === languageId && isPlaceholderLexeme(l.lemma))
        .map((l) => l.id),
      sentenceIds: [],
      phraseIds: [],
      docIds: []
    },
    levels: {},
    display: { orthographyId: primary?.id ?? null, scriptId: null, showIpa: true },
    audio: {}
  }
}

export function defaultStudySettings(project: Project): StudySettings {
  return {
    projectId: project.meta.id,
    author: project.meta.author,
    languages: project.languages.map((l) => defaultLanguage(project, l.id)),
    updatedAt: new Date().toISOString()
  }
}

/**
 * 记下的设置跟现在的项目对一对：项目里删掉的词条、例句、文档、语言不再引用，新加的语言补上默认设置。
 * 读进来的设置可能是旧版本写的、缺字段，这里一并补齐。
 */
export function reconcileStudySettings(
  saved: Partial<StudySettings> | null | undefined,
  project: Project
): StudySettings {
  const base = defaultStudySettings(project)
  if (!saved || typeof saved !== 'object') return base
  const lexemes = new Set(project.lexemes.map((x) => x.id))
  const sentences = new Set(project.sentences.map((x) => x.id))
  const phrases = new Set(project.phrasebook.map((x) => x.id))
  const docs = new Set(project.docs.map((x) => x.id))
  const keep = (ids: unknown, set: Set<Id>): Id[] =>
    Array.isArray(ids) ? ids.filter((x): x is Id => typeof x === 'string' && set.has(x)) : []
  const audioKeyAlive = (key: string): boolean => {
    const [kind, ...rest] = key.split('-')
    const id = rest.join('-')
    return kind === 'lexeme'
      ? lexemes.has(id)
      : kind === 'phrase'
        ? phrases.has(id)
        : kind === 'sentence'
          ? sentences.has(id)
          : false
  }
  const savedLangs = Array.isArray(saved.languages) ? saved.languages : []
  return {
    projectId: project.meta.id,
    author: typeof saved.author === 'string' ? saved.author : base.author,
    updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : base.updatedAt,
    languages: base.languages.map((def) => {
      const s = savedLangs.find((x) => x?.languageId === def.languageId)
      if (!s) return def
      const lang = project.languages.find((l) => l.id === def.languageId)
      const orthoOk = (id: unknown): id is Id =>
        typeof id === 'string' && !!lang?.orthographies.some((o) => o.id === id)
      const scriptOk = (id: unknown): id is Id =>
        typeof id === 'string' && !!lang?.scripts.some((x) => x.id === id)
      return {
        languageId: def.languageId,
        include: typeof s.include === 'boolean' ? s.include : def.include,
        title: typeof s.title === 'string' ? s.title : '',
        intro: typeof s.intro === 'string' ? s.intro : '',
        lessons: (Array.isArray(s.lessons) ? s.lessons : []).map((l) => ({
          id: typeof l?.id === 'string' ? l.id : newLessonId(),
          title: typeof l?.title === 'string' ? l.title : '',
          docId: typeof l?.docId === 'string' && docs.has(l.docId) ? l.docId : null,
          lexemeIds: keep(l?.lexemeIds, lexemes),
          sentenceIds: keep(l?.sentenceIds, sentences),
          phraseIds: keep(l?.phraseIds, phrases)
        })),
        hidden: {
          lexemeIds: keep(s.hidden?.lexemeIds, lexemes),
          sentenceIds: keep(s.hidden?.sentenceIds, sentences),
          phraseIds: keep(s.hidden?.phraseIds, phrases),
          docIds: keep(s.hidden?.docIds, docs)
        },
        levels: Object.fromEntries(
          Object.entries(s.levels ?? {}).filter(
            ([id, n]) => lexemes.has(id) && Number.isInteger(n) && n >= 1 && n <= STUDY_MAX_LEVEL
          )
        ),
        display: {
          orthographyId: orthoOk(s.display?.orthographyId)
            ? s.display.orthographyId
            : def.display.orthographyId,
          scriptId: scriptOk(s.display?.scriptId) ? s.display.scriptId : null,
          showIpa: typeof s.display?.showIpa === 'boolean' ? s.display.showIpa : true
        },
        audio: Object.fromEntries(
          Object.entries(s.audio ?? {}).filter(
            ([k, a]) => audioKeyAlive(k) && typeof a?.dataUrl === 'string'
          )
        )
      }
    })
  }
}

/** 新的一课 */
export function newLesson(title = ''): StudyLesson {
  return { id: newLessonId(), title, docId: null, lexemeIds: [], sentenceIds: [], phraseIds: [] }
}

/**
 * 按文档排课：这门语言的文档（和没指定语言的文档）每篇一课，标题用文档标题。
 * 已经排进课里的文档不重复加。
 */
export function lessonsFromDocs(project: Project, lang: StudyLanguage): StudyLesson[] {
  const used = new Set(lang.lessons.map((l) => l.docId).filter(Boolean))
  return project.docs
    .filter(
      (d) =>
        (d.languageId === lang.languageId || d.languageId === null) &&
        !used.has(d.id) &&
        !lang.hidden.docIds.includes(d.id)
    )
    .map((d) => ({ ...newLesson(d.title), docId: d.id }))
}

/** 录音键：`lexeme-<id>` 这种 */
export const studyAudioKey = (kind: 'lexeme' | 'phrase' | 'sentence', id: Id): string =>
  `${kind}-${id}`

/** 导出：学习包文件的文字（格式标记放在最前面，读的时候看开头就认得出） */
export function serializeStudyPack(
  project: Project,
  settings: StudySettings,
  qonlangVersion: string,
  exportedAt = new Date().toISOString()
): string {
  const head = {
    format: STUDY_PACK_FORMAT,
    version: STUDY_PACK_VERSION,
    exportedAt,
    qonlangVersion,
    study: { ...settings, projectId: project.meta.id }
  }
  // 项目部分用项目文件自己的写法（旧版本字段照带），拼在最后
  const projectJson = serializeProject(project).trimEnd()
  return JSON.stringify(head).slice(0, -1) + ',"project":' + projectJson + '}\n'
}

/** 看开头认得出是不是学习包 */
export function isStudyPack(text: string): boolean {
  return /^\s*\{\s*"format"\s*:\s*"qonlang-study-pack"/.test(text.slice(0, 200))
}

/** 读学习包：项目照项目文件的规矩检查、迁移；学习设置跟项目对一遍 */
export function parseStudyPack(text: string): StudyPackFile {
  let raw: Partial<StudyPackFile>
  try {
    raw = JSON.parse(text)
  } catch {
    throw new StudyPackError('学习包不是合法的 JSON', 'not-a-study-pack')
  }
  if (!raw || raw.format !== STUDY_PACK_FORMAT || typeof raw.project !== 'object')
    throw new StudyPackError('不是学习包', 'not-a-study-pack')
  if (typeof raw.version === 'number' && raw.version > STUDY_PACK_VERSION)
    throw new StudyPackError('学习包的版本比这个软件新', 'newer-study-pack')
  const project = projectFromObject(raw.project)
  return {
    format: STUDY_PACK_FORMAT,
    version: raw.version ?? STUDY_PACK_VERSION,
    exportedAt: String(raw.exportedAt ?? ''),
    qonlangVersion: String(raw.qonlangVersion ?? ''),
    study: reconcileStudySettings(raw.study, project),
    project
  }
}
