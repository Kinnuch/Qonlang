/**
 * 整个项目导出成一个 CSV，改完还能原样读回来（「打开项目」里选这个 .csv）。
 *
 * 版式：
 * - 第一行 `#qonlang-project-csv,1,<schemaVersion>` 是格式标记。
 * - 往下一段一张表：`#table,表名,中文名` 这一行开头，下一行是列名，再往下一行一条，直到下一个 `#table`；空行不算。
 * - `project` 表一行一项（schemaVersion、meta、settings……），值是 JSON。
 * - 项目里每个对象数组一张表（languages、lexemes……）；嵌套的数组拆成子表（lexemes.senses、languages.scripts.glyphs），
 *   子表的 `@parent` 列指回上一层的 id，读回时按行的先后排回去；父表的 `字段:rows` 列写有几行子行，空着表示没有这个字段。
 * - 列名后缀：不带后缀是文字；`:opt` 是可以没有的文字（空格子表示没有这个字段）；`?` 是可为 null 的文字（空格子是 null）；
 *   `:num` 数字、`:bool` 真假、`:json` 其余一律写 JSON，这三种空格子都表示没有这个字段。
 *   名称、释义、意义、译文这类多语言文字拆成 `name.zh`、`name.en` 几列。
 * - `~` 开头的列（语言名、词类名）和 `@row` 只给人看，读回时不管；`id` 空着的行读回时自动补一个。
 * - 超过 30000 字的格子（内嵌字体、配图）换成 `@@chunk:序号`，内容分段放在最后的 `chunks` 表里，免得 Excel 截断。
 */
import type { Project } from './model'
import { parseCsv, toCsv } from './csv'
import { newId } from './factory'
import { ProjectParseError, projectFromObject } from './serialize'

export const PROJECT_CSV_MARK = '#qonlang-project-csv'
const FORMAT_VERSION = '1'
const TABLE_MARK = '#table'
const CHUNK_MARK = '@@chunk:'
/** 一格最多放多少字，多了分段（Excel 一格最多 32767 字） */
const CHUNK_SIZE = 30000

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** 拆成子表的嵌套数组：表名 → 字段 */
const CHILDREN: Record<string, string[]> = {
  languages: ['phonemes', 'classes', 'digraphs', 'orthographies', 'dialects', 'scripts'],
  'languages.scripts': ['glyphs'],
  categories: ['values'],
  morphemes: ['allomorphs'],
  lexemes: ['senses']
}
/** 拆成 name.zh 这样几列的多语言文字字段 */
const LOCALIZED = new Set(['name', 'definition', 'meaning', 'translation'])
/** 表的中文名，只给人看 */
const TABLE_LABELS: Record<string, string> = {
  project: '项目',
  languages: '语言',
  'languages.phonemes': '语言 · 音位',
  'languages.classes': '语言 · 音类',
  'languages.digraphs': '语言 · 多合字母',
  'languages.orthographies': '语言 · 正字法',
  'languages.dialects': '语言 · 方言',
  'languages.scripts': '语言 · 文字',
  'languages.scripts.glyphs': '文字 · 字形',
  ruleSets: '音变规则集',
  categories: '语法维度',
  'categories.values': '维度 · 取值',
  posList: '词类',
  morphemes: '语素',
  'morphemes.allomorphs': '语素 · 异体形',
  lexemes: '词条',
  'lexemes.senses': '词条 · 义项',
  paradigms: '构形',
  sentences: '例句',
  phrasebook: '短语',
  abbreviations: '缩写表',
  docs: '文档',
  chunks: '长内容分段'
}

type Enc = 'text' | 'opt' | 'null' | 'num' | 'bool' | 'json'
const SUFFIX: Record<Enc, string> = {
  text: '',
  opt: ':opt',
  null: '?',
  num: ':num',
  bool: ':bool',
  json: ':json'
}

/** 是不是 projectToCsv 写出来的文件 */
export function isProjectCsv(text: string): boolean {
  return text.replace(/^\uFEFF/, '').startsWith(PROJECT_CSV_MARK)
}

/** 一列该怎么写；values 里 undefined 表示这一条没有这个字段 */
function encodingOf(values: unknown[]): Enc {
  const present = values.filter((v) => v !== undefined)
  const absent = present.length < values.length
  if (present.every((v) => typeof v === 'string'))
    return !absent ? 'text' : present.includes('') ? 'json' : 'opt'
  if (present.every((v) => typeof v === 'string' || v === null))
    return absent || present.includes('') ? 'json' : 'null'
  if (present.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'num'
  if (present.every((v) => typeof v === 'boolean')) return 'bool'
  return 'json'
}

/** 整个项目写成一个 CSV */
export function projectToCsv(p: Project): string {
  const out: string[][] = [[PROJECT_CSV_MARK, FORMAT_VERSION, String(p.schemaVersion)]]
  const chunks: string[][] = []
  let chunkCount = 0
  /** 太长的格子（或者本身就长得像分段引用的）拆进 chunks 表 */
  const cell = (s: string): string => {
    if (s.length <= CHUNK_SIZE && !s.startsWith(CHUNK_MARK)) return s
    const ref = `${CHUNK_MARK}${++chunkCount}`
    for (let i = 0; i === 0 || i * CHUNK_SIZE < s.length; i++)
      chunks.push([ref, String(i), s.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE)])
    return ref
  }
  const encode = (v: unknown, enc: Enc): string => {
    if (v === undefined) return ''
    if (enc === 'text' || enc === 'opt') return cell(v as string)
    if (enc === 'null') return v === null ? '' : cell(v as string)
    if (enc === 'num' || enc === 'bool') return String(v)
    return cell(JSON.stringify(v))
  }
  const langName = new Map(p.languages.map((l) => [l.id, l.name]))
  const posName = new Map(
    p.posList.map((x) => [x.id, x.abbr || Object.values(x.name).find(Boolean) || ''])
  )

  const emit = (path: string, items: Obj[], owners: string[] | null): void => {
    const keys: string[] = []
    for (const it of items) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k)
    const ids = items.map((it) => it.id)
    const idsOk =
      ids.every((id) => typeof id === 'string' && id !== '') && new Set(ids).size === ids.length
    // 父表每条都有不重复的 id、这个字段又都是对象数组（或者没有）时，才拆成子表
    const children = (CHILDREN[path] ?? []).filter(
      (k) =>
        idsOk &&
        keys.includes(k) &&
        items.every(
          (it) => it[k] === undefined || (Array.isArray(it[k]) && (it[k] as unknown[]).every(isObj))
        )
    )
    const header: string[] = []
    const getters: ((it: Obj, i: number) => string)[] = []
    const add = (name: string, get: (it: Obj, i: number) => string): void => {
      header.push(name)
      getters.push(get)
    }
    const addDisplay = (): void => {
      if (keys.includes('languageId'))
        add('~language', (it) => langName.get(it.languageId as string) ?? '')
      if (keys.includes('posId')) add('~pos', (it) => posName.get(it.posId as string) ?? '')
    }
    /** 多语言文字拆成 name.zh 几列：每条都有、都是「语言 → 文字」时才拆 */
    const expandLocalized = (k: string): boolean => {
      if (!LOCALIZED.has(k) || !items.length) return false
      const values = items.map((it) => it[k])
      if (!values.every((v) => isObj(v) && Object.values(v).every((x) => typeof x === 'string')))
        return false
      const langs: string[] = []
      for (const v of values as Obj[])
        for (const lang of Object.keys(v)) if (!langs.includes(lang)) langs.push(lang)
      if (!langs.length || !langs.every((lang) => /^[A-Za-z0-9_-]+$/.test(lang))) return false
      for (const lang of langs) {
        const enc = encodingOf((values as Obj[]).map((v) => v[lang]))
        add(`${k}.${lang}${SUFFIX[enc]}`, (it) => encode((it[k] as Obj)[lang], enc))
      }
      return true
    }
    if (owners) add('@parent', (_it, i) => owners[i])
    if (!keys.includes('id')) addDisplay()
    for (const k of keys.includes('id') ? ['id', ...keys.filter((x) => x !== 'id')] : keys) {
      if (children.includes(k))
        add(`${k}:rows`, (it) => (Array.isArray(it[k]) ? String((it[k] as unknown[]).length) : ''))
      else if (!expandLocalized(k)) {
        const enc = encodingOf(items.map((it) => it[k]))
        add(`${k}${SUFFIX[enc]}`, (it) => encode(it[k], enc))
      }
      if (k === 'id') addDisplay()
    }
    const rows = items.map((it, i) => getters.map((get) => get(it, i)))
    // 整行都空的记录（比如空着的缩写）读回时会被当成空行跳过，前面加一列行号
    if (rows.some((r) => r.every((c) => c.trim() === ''))) {
      header.unshift('@row')
      rows.forEach((r, i) => r.unshift(String(i + 1)))
    }
    out.push([TABLE_MARK, path, TABLE_LABELS[path] ?? path], header, ...rows)
    for (const k of children) {
      const kids: Obj[] = []
      const kidOwners: string[] = []
      for (const it of items)
        for (const c of (it[k] as Obj[] | undefined) ?? []) {
          kids.push(c)
          kidOwners.push(it.id as string)
        }
      emit(`${path}.${k}`, kids, kidOwners)
    }
  }

  const tables: [string, Obj[]][] = []
  out.push([TABLE_MARK, 'project', TABLE_LABELS.project], ['key', 'value:json'])
  for (const [key, value] of Object.entries(p as unknown as Obj)) {
    if (Array.isArray(value) && value.every(isObj)) tables.push([key, value as Obj[]])
    else if (value !== undefined) out.push([key, cell(JSON.stringify(value))])
  }
  for (const [key, items] of tables) emit(key, items, null)
  if (chunks.length)
    out.push([TABLE_MARK, 'chunks', TABLE_LABELS.chunks], ['ref', 'part:num', 'text'], ...chunks)
  return toCsv(out)
}

interface Column {
  key: string
  /** name.zh 里的 zh */
  sub: string | null
  enc: Enc | 'rows' | 'parent' | 'skip'
}

function parseHeader(name: string): Column {
  if (name === '@parent') return { key: '', sub: null, enc: 'parent' }
  if (!name || name.startsWith('~') || name.startsWith('@'))
    return { key: '', sub: null, enc: 'skip' }
  let base = name
  let enc: Column['enc'] = 'text'
  const m = /:(opt|num|bool|json|rows)$/.exec(base)
  if (m) {
    enc = m[1] as Column['enc']
    base = base.slice(0, -m[0].length)
  } else if (base.endsWith('?')) {
    enc = 'null'
    base = base.slice(0, -1)
  }
  const dot = base.indexOf('.')
  return dot > 0
    ? { key: base.slice(0, dot), sub: base.slice(dot + 1), enc }
    : { key: base, sub: null, enc }
}

/** 读回 projectToCsv 写出的 CSV（在表格软件里改过也行）；不是这种文件、或者写坏了就抛 ProjectParseError */
export function projectFromCsv(text: string): Project {
  const { rows } = parseCsv(text, ',')
  if (!rows.length || rows[0][0] !== PROJECT_CSV_MARK)
    throw new ProjectParseError('不是千语集导出的项目 CSV', 'not-a-project')
  const sections: { path: string; header: Column[] | null; rows: string[][] }[] = []
  for (const r of rows.slice(1)) {
    if (r[0] === TABLE_MARK) {
      sections.push({ path: (r[1] ?? '').trim(), header: null, rows: [] })
      continue
    }
    const cur = sections[sections.length - 1]
    if (!cur) continue
    if (!cur.header) cur.header = r.map((c) => parseHeader(c.trim()))
    else cur.rows.push(r)
  }
  const bad = (path: string, n: number, col: string, why: string): ProjectParseError =>
    new ProjectParseError(`${path} 表第 ${n} 行「${col}」：${why}`, 'invalid-csv')

  const pieces = new Map<string, string[]>()
  for (const s of sections)
    if (s.path === 'chunks')
      for (const r of s.rows) {
        const list = pieces.get(r[0]) ?? []
        list[Number(r[1])] = r[2] ?? ''
        pieces.set(r[0], list)
      }
  const whole = (v: string): string =>
    v.startsWith(CHUNK_MARK) && pieces.has(v) ? (pieces.get(v) ?? []).join('') : v

  const raw: Obj = {}
  const decoded = new Map<string, { obj: Obj; parent: string | null }[]>()
  for (const s of sections) {
    if (!s.path || s.path === 'chunks') continue
    if (s.path === 'project') {
      s.rows.forEach((r, n) => {
        const key = (r[0] ?? '').trim()
        if (!key) return
        try {
          raw[key] = JSON.parse(whole(r[1] ?? ''))
        } catch {
          throw bad(s.path, n + 1, key, 'JSON 写得不对')
        }
      })
      continue
    }
    const list: { obj: Obj; parent: string | null }[] = []
    for (const [n, r] of s.rows.entries()) {
      const obj: Obj = {}
      let parent: string | null = null
      for (const [ci, c] of (s.header ?? []).entries()) {
        const v = r[ci] ?? ''
        if (c.enc === 'skip') continue
        if (c.enc === 'parent') {
          parent = v.trim()
          continue
        }
        if (c.enc === 'rows') {
          if (v.trim() !== '') obj[c.key] = []
          continue
        }
        let target = obj
        let k = c.key
        if (c.sub !== null) {
          if (!isObj(obj[c.key])) obj[c.key] = {}
          target = obj[c.key] as Obj
          k = c.sub
        }
        const name = c.sub === null ? c.key : `${c.key}.${c.sub}`
        if (c.enc === 'text') target[k] = whole(v)
        else if (c.enc === 'opt') {
          if (v !== '') target[k] = whole(v)
        } else if (c.enc === 'null') target[k] = v === '' ? null : whole(v)
        else if (c.enc === 'num') {
          if (v.trim() === '') continue
          const x = Number(v)
          if (!Number.isFinite(x)) throw bad(s.path, n + 1, name, '不是数字')
          target[k] = x
        } else if (c.enc === 'bool') {
          if (v.trim() !== '') target[k] = v.trim().toLowerCase() === 'true'
        } else if (v !== '') {
          try {
            target[k] = JSON.parse(whole(v))
          } catch {
            throw bad(s.path, n + 1, name, 'JSON 写得不对')
          }
        }
      }
      list.push({ obj, parent })
    }
    decoded.set(s.path, list)
  }

  // 先放顶层的表，再一层层把子行挂回上一层；id 空着的（人加的行）补一个
  const byId = new Map<string, Map<string, Obj>>()
  const paths = [...decoded.keys()].sort((a, b) => a.split('.').length - b.split('.').length)
  for (const path of paths) {
    const list = decoded.get(path) ?? []
    for (const { obj } of list) if (obj.id === '') obj.id = newId()
    const dot = path.lastIndexOf('.')
    if (dot < 0) raw[path] = list.map((x) => x.obj)
    else {
      const owners = byId.get(path.slice(0, dot))
      const field = path.slice(dot + 1)
      list.forEach(({ obj, parent }, n) => {
        const owner = parent ? owners?.get(parent) : undefined
        if (!owner) throw bad(path, n + 1, '@parent', `上一层里没有 id「${parent ?? ''}」`)
        if (!Array.isArray(owner[field])) owner[field] = []
        ;(owner[field] as Obj[]).push(obj)
      })
    }
    const index = new Map<string, Obj>()
    for (const { obj } of list) if (typeof obj.id === 'string') index.set(obj.id, obj)
    byId.set(path, index)
  }
  if (typeof raw.schemaVersion !== 'number' || !isObj(raw.meta))
    throw new ProjectParseError('缺少项目信息（project 表）', 'not-a-project')
  return projectFromObject(raw)
}
