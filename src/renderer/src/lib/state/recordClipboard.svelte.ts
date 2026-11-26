/** 整条记录操作与系统剪贴板的唯一接线；普通文本编辑保持浏览器原有行为。 */
import type { Project, Id } from '$lib/core/model'
import { newId } from '$lib/core/factory'
import {
  createRecordClipboard,
  isRecordClipboard,
  pasteRecordClipboard,
  type RecordClipboardKind,
  type RecordPasteResult
} from '$lib/core/recordClipboard'
import {
  createProjectClipboard,
  pasteProjectClipboard,
  type ProjectClipboardRef,
  type ProjectPasteResult
} from '$lib/core/projectFolders'
import { projectState } from './project.svelte'
import { ui } from './ui.svelte'
import { t } from '$lib/i18n/index.svelte'
import { encodeClipboardText, decodeClipboardText } from '$lib/core/clipboardText'
let cached = $state<unknown>(null)
const editable = (project: Project): boolean =>
  projectState.project === project && !projectState.readOnly

export function clipboardRecordEventAllowed(event: Event): boolean {
  const el = event.target instanceof Element ? event.target : null
  return (
    !event.defaultPrevented &&
    !el?.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-delete-ignore]'
    ) &&
    !window.getSelection()?.toString() &&
    !ui.confirmReq &&
    !ui.chooseReq &&
    !ui.promptReq &&
    !ui.paletteOpen &&
    !Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"]')).some(
      (n) => n.getClientRects().length
    )
  )
}
async function write(payload: unknown, event?: ClipboardEvent): Promise<boolean> {
  const text = encodeClipboardText(payload)
  try {
    if (event?.clipboardData) {
      event.preventDefault()
      event.clipboardData.setData('text/plain', text)
    } else await navigator.clipboard.writeText(text)
    cached = payload
    return true
  } catch {
    ui.toast(t('clipboard.failed'))
    return false
  }
}
async function read(event?: ClipboardEvent): Promise<unknown> {
  try {
    const text =
      event?.clipboardData?.getData('text/plain') ?? (await navigator.clipboard.readText())
    const parsed = decodeClipboardText(text)
    if (!parsed) {
      cached = null
      return null
    }
    if (event) event.preventDefault()
    cached = parsed
    return parsed
  } catch {
    ui.toast(t('clipboard.failed'))
    return null
  }
}
export function projectClipboardAvailable(): boolean {
  return !!cached && !isRecordClipboard(cached)
}
export function recordClipboardAvailable(kind: RecordClipboardKind): boolean {
  return isRecordClipboard(cached) && cached.kind === kind
}
export async function copyRecords(
  project: Project,
  kind: RecordClipboardKind,
  ids: readonly Id[],
  mode: 'copy' | 'cut',
  event?: ClipboardEvent
): Promise<boolean> {
  if (!editable(project)) return false
  const payload = createRecordClipboard(project, kind, ids, mode)
  if (!payload) return false
  const ok = await write(payload, event)
  if (ok) ui.toast(t(mode === 'cut' ? 'clipboard.cutReady' : 'clipboard.copied', { n: ids.length }))
  return ok
}
export async function pasteRecords(
  project: Project,
  kind: RecordClipboardKind,
  languageId: Id | null,
  event?: ClipboardEvent,
  stillValid: () => boolean = () => true
): Promise<RecordPasteResult | null> {
  if (!editable(project)) return null
  const section = ui.section,
    currentLanguage = projectState.currentLanguageId
  const payload = await read(event)
  if (
    !editable(project) ||
    section !== ui.section ||
    currentLanguage !== projectState.currentLanguageId ||
    !stillValid()
  )
    return null
  if (!isRecordClipboard(payload) || payload.kind !== kind) return null
  const result = pasteRecordClipboard(project, payload, languageId)
  finish(project, result)
  return result
}
export async function copyProjectRecords(
  project: Project,
  refs: readonly ProjectClipboardRef[],
  mode: 'copy' | 'cut',
  event?: ClipboardEvent
): Promise<boolean> {
  if (!editable(project)) return false
  const payload = createProjectClipboard(project, refs, mode)
  if (!payload) return false
  const ok = await write(payload, event)
  if (ok)
    ui.toast(t(mode === 'cut' ? 'clipboard.cutReady' : 'clipboard.copied', { n: refs.length }))
  return ok
}
export async function pasteProjectRecords(
  project: Project,
  folderId: Id,
  event?: ClipboardEvent,
  stillValid: () => boolean = () => true
): Promise<ProjectPasteResult | null> {
  if (!editable(project)) return null
  const section = ui.section,
    currentLanguage = projectState.currentLanguageId
  const payload = await read(event)
  if (
    !editable(project) ||
    section !== ui.section ||
    currentLanguage !== projectState.currentLanguageId ||
    !stillValid() ||
    !payload ||
    isRecordClipboard(payload)
  )
    return null
  const result = pasteProjectClipboard(
    project,
    payload as Parameters<typeof pasteProjectClipboard>[1],
    folderId,
    { newId }
  )
  finish(project, result)
  return result
}
function finish(project: Project, result: RecordPasteResult | ProjectPasteResult): void {
  if (!result.ok) {
    ui.toast(t('clipboard.rejected'))
    return
  }
  if (projectState.project !== project) return
  projectState.touch()
  if (result.mode === 'cut') cached = null
  ui.toast(t('clipboard.pasted', { n: 'ids' in result ? result.ids.length : result.count }))
}
