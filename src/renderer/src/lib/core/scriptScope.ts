/** 目录范围与每句文字显隐的唯一判断；不改手填文字、原文或分析，不长期缓存可变工程。 */
import type { Id, Language, Project, Script, Sentence } from './model'
import { projectFolderOf, projectFolders } from './projectFolders'
import { createFolderIndex } from './folderTree'

export const normalizeScriptIds = (value: unknown): Id[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
    : []
export function normalizeScriptFolderScope(value: unknown): Script['folderScope'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const scope = value as { mode?: unknown; folderIds?: unknown; excludedFolderIds?: unknown }
  if (scope.mode === 'none') return { mode: 'none', folderIds: [] }
  if (scope.mode !== 'selected') return undefined
  const excluded = normalizeScriptIds(scope.excludedFolderIds)
  return {
    mode: 'selected',
    folderIds: normalizeScriptIds(scope.folderIds),
    ...(excluded.length ? { excludedFolderIds: excluded } : {})
  }
}
export interface ScriptScopeRecord {
  languageId: Id
  folderId?: Id
}
export interface ScriptScopeResolver {
  applicable: (record: ScriptScopeRecord) => Script[]
  visible: (sentence: Sentence) => Script[]
  includes: (script: Script, record: ScriptScopeRecord) => boolean
}
export function createScriptScopeResolver(
  project: Project,
  language: Language | null | undefined,
  index = createFolderIndex(projectFolders(project))
): ScriptScopeResolver {
  const compiled = new Map<Script, Set<Id> | null>(),
    subtrees = new Map<Id, Set<Id>>()
  const descendants = (id: Id): Set<Id> => {
    if (id === '') return new Set([''])
    let value = subtrees.get(id)
    if (!value) {
      value = index.has(id) ? index.normalizedDescendants(id) : new Set()
      subtrees.set(id, value)
    }
    return value
  }
  for (const script of language?.scripts ?? []) {
    const scope = normalizeScriptFolderScope(script.folderScope)
    if (!scope) {
      compiled.set(script, null)
      continue
    }
    const ids = new Set<Id>()
    if (scope.mode === 'selected') {
      for (const id of scope.folderIds) for (const child of descendants(id)) ids.add(child)
      for (const id of scope.excludedFolderIds ?? [])
        for (const child of descendants(id)) ids.delete(child)
    }
    compiled.set(script, ids)
  }
  const includes = (script: Script, record: ScriptScopeRecord): boolean => {
    if (!language || record.languageId !== language.id || !compiled.has(script)) return false
    const ids = compiled.get(script)
    if (ids === null) return true
    const folder =
      project.folders === undefined
        ? projectFolderOf(project, record)
        : record.folderId && index.has(record.folderId)
          ? record.folderId
          : ''
    return !!ids?.has(folder)
  }
  const applicable = (record: ScriptScopeRecord): Script[] =>
    (language?.scripts ?? []).filter((script) => includes(script, record))
  return {
    includes,
    applicable,
    visible: (sentence) => {
      const scripts = applicable(sentence)
      if (scripts.length < 2) return scripts
      const hidden = new Set(sentence.hiddenScriptIds ?? [])
      return scripts.filter((script) => !hidden.has(script.id))
    }
  }
}
/** 一次批量展示/导出用一个快照；项目改动后由调用方重建，不留全局缓存。 */
export function createProjectScriptScopes(
  project: Project
): (languageId: Id) => ScriptScopeResolver {
  const index = createFolderIndex(projectFolders(project)),
    languages = new Map(project.languages.map((language) => [language.id, language])),
    scopes = new Map<Id, ScriptScopeResolver>()
  return (languageId) => {
    let scope = scopes.get(languageId)
    if (!scope) {
      scope = createScriptScopeResolver(project, languages.get(languageId), index)
      scopes.set(languageId, scope)
    }
    return scope
  }
}
/** 调用方负责工程归属与只读检查；单套适用时无不可恢复的隐藏状态。 */
export function setSentenceScriptVisible(
  sentence: Sentence,
  scriptId: Id,
  visible: boolean,
  resolver: ScriptScopeResolver
): boolean {
  const scripts = resolver.applicable(sentence)
  if (scripts.length < 2 || !scripts.some((script) => script.id === scriptId)) return false
  const before = new Set(sentence.hiddenScriptIds ?? []),
    next = new Set(before)
  if (visible) next.delete(scriptId)
  else next.add(scriptId)
  if (next.size === before.size && [...next].every((id) => before.has(id))) return false
  if (next.size) sentence.hiddenScriptIds = [...next]
  else delete sentence.hiddenScriptIds
  return true
}
