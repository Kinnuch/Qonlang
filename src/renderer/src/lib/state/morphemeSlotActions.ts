import type { Id, Project } from '$lib/core/model'
import { newId } from '$lib/core/factory'
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
  ;(project.morphemeSlots ??= []).push({ id, name, description: '' })
  projectState.touch()
  return id
}
