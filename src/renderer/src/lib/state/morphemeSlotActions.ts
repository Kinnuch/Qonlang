import type { Id, Project } from '$lib/core/model'
import { newId } from '$lib/core/factory'
import { detachMorphemeSlot, restoreMorphemeSlot, slotUsage } from '$lib/core/morphemeSlots'
import { projectState } from './project.svelte'
import { ui } from './ui.svelte'
import { t } from '$lib/i18n/index.svelte'

export async function createMorphemeSlot(project: Project): Promise<Id | null> {
  if (projectState.readOnly) return null
  const name = (await ui.prompt(t('morphemeSlots.newName'), ''))?.trim()
  if (!name || projectState.project !== project || projectState.readOnly) return null
  if (
    project.morphemeSlots?.some(
      (slot) => slot.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  ) {
    ui.error(t('morphemeSlots.duplicateName'))
    return null
  }
  const id = newId()
  project.morphemeSlots = [...(project.morphemeSlots ?? []), { id, name, description: '' }]
  projectState.touch()
  return id
}

export async function removeMorphemeSlot(project: Project, id: Id): Promise<void> {
  if (projectState.project !== project || projectState.readOnly) return
  const slot = project.morphemeSlots?.find((item) => item.id === id)
  if (!slot) return
  const usage = slotUsage(project, id)
  const title = t('morphemeSlots.deleteSlot', { name: slot.name })
  if (!(await ui.confirm(title, t('morphemeSlots.deleteImpact', usage), t('common.delete')))) return
  if (
    projectState.project !== project ||
    projectState.readOnly ||
    !project.morphemeSlots?.includes(slot)
  )
    return
  const removed = detachMorphemeSlot(project, id)
  if (!removed) return
  projectState.touch()
  ui.toast(t('morphemeSlots.deleted', { name: slot.name }), {
    action: {
      label: t('common.undo'),
      run: () => {
        if (
          projectState.project === project &&
          !projectState.readOnly &&
          restoreMorphemeSlot(project, removed)
        )
          projectState.touch()
      }
    }
  })
}
