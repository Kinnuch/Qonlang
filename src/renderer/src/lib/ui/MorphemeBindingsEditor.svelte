<script lang="ts">
  import type { Id, Lexeme, MorphemeSlot, MorphemeType, Project } from '$lib/core/model'
  import { MORPHEME_TYPES } from '$lib/core/factory'
  import { boundMorpheme, splitMorphemePart } from '$lib/core/morphemeSlots'
  import { createMorphemeSlot } from '$lib/state/morphemeSlotActions'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { Plus, Scissors, X } from '@lucide/svelte'
  import ReferencePicker from './ReferencePicker.svelte'
  import { morphemeLabel } from '$lib/core/etymology'
  import HelpDot from './HelpDot.svelte'
  import { canonicalG } from '$lib/ipa/equivalence'

  let { project, lexeme, onchange }: { project: Project; lexeme: Lexeme; onchange: () => void } =
    $props()
  let filters = $state<Record<Id, MorphemeType | ''>>({})
  let split = $state<{
    slotId: Id
    side: 'prefix' | 'suffix'
    part: string
    stemName: string
  } | null>(null)
  const local = $derived(project.morphemes.filter((m) => m.languageId === lexeme.languageId))
  const orphanIds = $derived(
    Object.keys(lexeme.morphemeBindings ?? {}).filter(
      (id) => !project.morphemeSlots?.some((slot) => slot.id === id)
    )
  )
  const remainder = $derived(split ? splitMorphemePart(lexeme.lemma, split.part, split.side) : null)
  $effect(() => {
    void lexeme.id
    split = null
    filters = {}
  })

  function bind(slotId: Id, id: Id): void {
    if (
      projectState.readOnly ||
      projectState.project !== project ||
      !project.lexemes.includes(lexeme)
    )
      return
    if (id && !local.some((m) => m.id === id)) return
    const next = { ...lexeme.morphemeBindings }
    if (id) next[slotId] = id
    else delete next[slotId]
    if (Object.keys(next).length) lexeme.morphemeBindings = next
    else delete lexeme.morphemeBindings
    onchange()
  }
  function openSplit(slot: MorphemeSlot): void {
    const hit = boundMorpheme(project, lexeme, slot.id)
    if (!hit.morpheme || projectState.readOnly) return
    const input = document.getElementById('lx-lemma') as HTMLInputElement | null
    const start = input?.selectionStart ?? 0,
      end = input?.selectionEnd ?? 0
    const selected = end > start && (start === 0 || end === lexeme.lemma.length)
    const side: 'prefix' | 'suffix' = selected
      ? start === 0
        ? 'prefix'
        : 'suffix'
      : hit.morpheme.type === 'suffix'
        ? 'suffix'
        : 'prefix'
    let part = selected ? lexeme.lemma.slice(start, end) : hit.morpheme.form.replace(/^-+|-+$/g, '')
    if (!selected && side === 'prefix' && canonicalG(lexeme.lemma).startsWith(canonicalG(part))) {
      part = lexeme.lemma.slice(0, part.length)
      const tail = lexeme.lemma.slice(part.length)
      const separators = [...new Set([...project.settings.morphemeBoundaries, '·', ' '])]
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
      let rest = tail
      for (;;) {
        const separator = separators.find((candidate) => rest.startsWith(candidate))
        if (!separator) break
        part += separator
        rest = rest.slice(separator.length)
      }
    }
    split = { slotId: slot.id, side, part, stemName: t('morphemeSlots.baseStem') }
  }
  async function applySplit(): Promise<void> {
    if (!split || projectState.readOnly || remainder === null || !split.stemName.trim()) return
    const target = lexeme,
      draft = { ...split },
      stem = remainder,
      name = draft.stemName.trim(),
      old = target.stems[name],
      lemma = target.lemma,
      languageId = target.languageId,
      section = ui.section,
      currentLanguage = projectState.currentLanguageId,
      binding = target.morphemeBindings?.[draft.slotId]
    if (
      old &&
      old !== stem &&
      !(await ui.confirm(t('morphemeSlots.overwriteStem', { name, old, next: stem })))
    )
      return
    if (
      projectState.project !== project ||
      projectState.readOnly ||
      lexeme !== target ||
      !project.lexemes.includes(target) ||
      target.morphemeBindings?.[draft.slotId] !== binding ||
      target.lemma !== lemma ||
      target.languageId !== languageId ||
      ui.section !== section ||
      projectState.currentLanguageId !== currentLanguage ||
      target.stems[name] !== old ||
      boundMorpheme(project, target, draft.slotId).issue
    )
      return
    target.stems[name] = stem
    split = null
    onchange()
    ui.toast(t('morphemeSlots.splitSaved', { name, stem }))
  }
</script>

<div class="field morpheme-slots" data-morpheme-bindings>
  <div class="row">
    <span class="small muted">{t('morphemeSlots.title')}</span><HelpDot
      tip={t('morphemeSlots.hint')}
    /><span class="grow"></span>
    <button
      class="btn ghost sm"
      disabled={projectState.readOnly}
      onclick={() => void createMorphemeSlot(project)}
      ><Plus size={14} />{t('morphemeSlots.add')}</button
    >
  </div>
  {#each project.morphemeSlots ?? [] as slot (slot.id)}
    {@const hit = boundMorpheme(project, lexeme, slot.id)}
    {@const selected = lexeme.morphemeBindings?.[slot.id] ?? ''}
    <div class="slot card" data-binding-row={slot.id}>
      <div class="small" title={slot.description}>{slot.name}</div>
      <ReferencePicker
        {project}
        kind="morpheme"
        languageId={lexeme.languageId}
        localOnly
        type={filters[slot.id]}
        glossLangs={project.settings.glossLanguages}
        selected={hit.morpheme
          ? [morphemeLabel(hit.morpheme) || '∅', hit.morpheme.gloss].filter(Boolean).join(' — ')
          : selected
            ? t('morphemeSlots.invalidBinding')
            : ''}
        placeholder={t('morphemeSlots.unbound') + ' · ' + t('lexicon.pickMorpheme')}
        allowClear
        onpick={(id) => bind(slot.id, id)}
      />
      <div class="row controls">
        <select
          class="select small-filter"
          aria-label={t('morphemeSlots.filterType')}
          value={filters[slot.id] ?? ''}
          onchange={(e) => (filters[slot.id] = e.currentTarget.value as MorphemeType | '')}
        >
          <option value="">{t('morphemes.allTypes')}</option>
          {#each MORPHEME_TYPES as type (type)}<option value={type}
              >{t(`morphemes.types.${type}`)}</option
            >{/each}
        </select>
        <button
          class="btn ghost sm"
          disabled={!hit.morpheme || projectState.readOnly}
          onclick={() => openSplit(slot)}><Scissors size={13} />{t('morphemeSlots.split')}</button
        >
      </div>
      {#if selected && hit.issue}<span class="bad small" role="alert"
          >{t(`morphemeSlots.issues.${hit.issue}`)}</span
        >{/if}
      {#if split?.slotId === slot.id}
        {@const draft = split}
        <div class="split" data-morpheme-split>
          <label class="small"
            >{t('morphemeSlots.side')}<select class="select" bind:value={draft.side}
              ><option value="prefix">{t('paradigms.prefix')}</option><option value="suffix"
                >{t('paradigms.suffix')}</option
              ></select
            ></label
          >
          <label class="small"
            >{t('morphemeSlots.part')}<input
              class="input data"
              data-split-part
              bind:value={draft.part}
            /></label
          >
          <label class="small"
            >{t('morphemeSlots.stemName')}<input
              class="input"
              data-split-stem-name
              bind:value={draft.stemName}
            /></label
          >
          <div class="small" data-split-preview>
            {t('morphemeSlots.remaining')}: <strong class="data">{remainder ?? '—'}</strong>
          </div>
          {#if remainder === null}<span class="bad small">{t('morphemeSlots.splitInvalid')}</span
            >{/if}
          <div class="row">
            <button
              class="btn sm"
              data-confirm-morpheme-split
              disabled={remainder === null || !draft.stemName.trim() || projectState.readOnly}
              onclick={() => void applySplit()}>{t('morphemeSlots.confirmSplit')}</button
            ><button class="btn ghost sm" onclick={() => (split = null)}
              >{t('common.cancel')}</button
            >
          </div>
        </div>
      {/if}
    </div>
  {/each}
  {#each orphanIds as id (id)}<div class="row small bad">
      {t('morphemeSlots.issues.slot-missing')}<span class="grow"></span><button
        class="btn ghost icon sm"
        title={t('common.delete')}
        disabled={projectState.readOnly}
        onclick={() => bind(id, '')}><X size={13} /></button
      >
    </div>{/each}
</div>

<style>
  .slot {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .select,
  .input {
    width: 100%;
    min-width: 0;
  }
  .controls {
    flex-wrap: wrap;
    gap: 4px;
  }
  .small-filter {
    width: auto;
    max-width: 140px;
  }
  .split {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
  .bad {
    color: var(--danger);
  }
</style>
