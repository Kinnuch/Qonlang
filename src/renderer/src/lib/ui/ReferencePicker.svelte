<script lang="ts">
  import { tick } from 'svelte'
  import { anchoredFloating } from './anchoredFloating'
  import { Plus, X } from '@lucide/svelte'
  import { createLexeme, createMorpheme, MORPHEME_TYPES } from '$lib/core/factory'
  import type { Id, Project, MorphemeType } from '$lib/core/model'
  import { rankReferences, referenceOptions } from '$lib/core/referenceSearch'
  import { projectState } from '$lib/state/project.svelte'
  import { derivePronunciations } from '$lib/core/pronounce'
  import { t } from '$lib/i18n/index.svelte'
  let {
    project,
    languageId,
    kind,
    excludeId,
    localOnly = false,
    type = '',
    glossLangs,
    selected = '',
    placeholder,
    onpick,
    allowClear = false,
    allowCreate = true
  }: {
    project: Project
    languageId: Id
    kind: 'lexeme' | 'morpheme'
    excludeId?: Id
    localOnly?: boolean
    type?: MorphemeType | ''
    glossLangs: string[]
    selected?: string
    placeholder: string
    onpick: (id: Id) => void
    allowClear?: boolean
    allowCreate?: boolean
  } = $props()
  let open = $state(false),
    query = $state(''),
    creating = $state(false),
    form = $state(''),
    secondForm = $state(''),
    meaning = $state(''),
    newType = $state<MorphemeType>('root'),
    newLanguage = $state<Id>(''),
    active = $state(-1)
  let input = $state<HTMLInputElement>(),
    formInput = $state<HTMLInputElement>(),
    box: HTMLDivElement
  let panel = $state<HTMLDivElement>()
  const uid = $props.id()
  const languageNames = $derived(new Map(project.languages.map((l) => [l.id, l.abbr || l.name])))
  const options = $derived(
    open
      ? referenceOptions(project, {
          kind,
          languageId,
          skip: excludeId,
          localOnly,
          type,
          glossLangs,
          typeName: (v) => t(`morphemes.types.${v}`)
        })
      : []
  )
  let visible = $state(40)
  const ranked = $derived(open ? rankReferences(project, options, query, languageId, Infinity) : [])
  const hits = $derived(ranked.slice(0, visible))
  const editable = $derived(projectState.project === project && !projectState.readOnly)
  function show(): void {
    if (open || !editable) return
    query = ''
    visible = 40
    active = -1
    open = true
  }
  function close(): void {
    open = false
    creating = false
    query = ''
    active = -1
  }
  function choose(id: Id): void {
    if (!editable) return
    onpick(id)
    close()
    input?.blur()
  }
  function begin(): void {
    form = query.trim()
    secondForm = ''
    meaning = ''
    newLanguage = languageId
    newType = type || 'root'
    creating = true
    void tick().then(() => formInput?.focus())
  }
  function save(): void {
    const name = form.trim()
    if (!editable || !creating || !name || !project.languages.some((l) => l.id === newLanguage))
      return
    const lang = glossLangs[0] || project.settings.glossLanguages[0] || 'zh'
    if (kind === 'lexeme') {
      const item = createLexeme(newLanguage, name)
      if (meaning.trim()) item.senses[0].definition[lang] = meaning.trim()
      const language = project.languages.find((l) => l.id === newLanguage)
      if (language) derivePronunciations(language, item, project)
      project.lexemes.push(item)
      choose(item.id)
    } else {
      const item = createMorpheme(newLanguage, newType)
      item.form = name
      if (newType === 'circumfix') item.form2 = secondForm.trim()
      if (meaning.trim()) item.meaning[lang] = meaning.trim()
      project.morphemes.push(item)
      choose(item.id)
    }
  }
  function keys(e: KeyboardEvent): void {
    if (e.isComposing) return
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close()
      input?.blur()
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && open && !creating && allowCreate) {
      const create = panel?.querySelector<HTMLButtonElement>('.create')
      if (create) {
        e.preventDefault()
        create.focus({ preventScroll: true })
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      show()
      if (e.key === 'ArrowDown' && active === hits.length - 1 && ranked.length > visible)
        visible += 40
      active = Math.min(hits.length - 1, Math.max(0, active + (e.key === 'ArrowDown' ? 1 : -1)))
      document.getElementById(uid + '-' + active)?.scrollIntoView({ block: 'nearest' })
    }
    if (e.key === 'Enter' && open) {
      e.preventDefault()
      if (hits[active < 0 ? 0 : active]) choose(hits[active < 0 ? 0 : active].id)
      else if (query.trim() && allowCreate) begin()
    }
  }
  $effect(() => {
    if (!open) return
    const outside = (e: Event): void => {
      if (e.target instanceof Node && !box.contains(e.target) && !panel?.contains(e.target)) close()
    }
    const panelKey = (e: KeyboardEvent): void => {
      if (e.isComposing || !panel?.contains(e.target as Node)) return
      const first = creating ? formInput : panel.querySelector('.create')
      if (e.key === 'Escape' || (e.key === 'Tab' && e.shiftKey && e.target === first)) {
        e.preventDefault()
        if (e.key === 'Escape') e.stopPropagation()
        input?.focus({ preventScroll: true })
        close()
      } else if (
        e.key === 'Tab' &&
        !e.shiftKey &&
        e.target ===
          (creating
            ? panel.querySelector('.create-actions button:last-child')
            : panel.querySelector('.create'))
      ) {
        // 将键盘交回原表单，浏览器按输入框原有的顺序继续 Tab。
        input?.focus({ preventScroll: true })
        close()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('focusin', outside)
    window.addEventListener('keydown', panelKey)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('focusin', outside)
      window.removeEventListener('keydown', panelKey)
    }
  })
</script>

<div class="ref-picker" bind:this={box}>
  <div class="row">
    <input
      class="input data grow"
      bind:this={input}
      role="combobox"
      aria-label={placeholder}
      aria-autocomplete="list"
      aria-expanded={open && !creating}
      aria-controls={open && !creating ? uid + '-list' : undefined}
      aria-activedescendant={open && active >= 0 ? uid + '-' + active : undefined}
      disabled={!editable}
      {placeholder}
      value={open ? query : selected}
      onfocus={show}
      onclick={show}
      oninput={(e) => {
        show()
        query = e.currentTarget.value
        visible = 40
        active = -1
        creating = false
      }}
      onkeydown={keys}
    />
    {#if allowClear && selected}<button
        type="button"
        class="btn ghost icon sm"
        aria-label={t('morphemeSlots.unbound')}
        disabled={!editable}
        onclick={() => choose('')}><X size={13} /></button
      >{/if}
  </div>
  {#if open}
    <div
      class="menu card"
      data-reference-popup
      bind:this={panel}
      use:anchoredFloating={{ anchor: input, onAnchorHidden: close }}
    >
      {#if !creating}
        <div
          class="hits"
          role="listbox"
          id={uid + '-list'}
          aria-label={placeholder}
          onscroll={(e) => {
            const el = e.currentTarget
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40 && visible < ranked.length)
              visible += 40
          }}
        >
          {#each hits as h, i (h.id)}
            <button
              type="button"
              class:active={i === active}
              class="hit"
              id={uid + '-' + i}
              role="option"
              tabindex="-1"
              aria-selected={i === active}
              data-ref-id={h.id}
              onmousedown={(e) => e.preventDefault()}
              onclick={() => choose(h.id)}
            >
              <strong class="data">{h.label || '∅'}</strong>
              {#if h.kind}<span class="badge">{h.kind}</span>{/if}<span class="small muted"
                >{h.note}</span
              >
              {#if !localOnly && h.languageId !== languageId}<small
                  >{languageNames.get(h.languageId)}</small
                >{/if}
            </button>
          {:else}<span class="small muted">{t('common.noResults')}</span>{/each}
        </div>
        {#if allowCreate}<button type="button" class="btn ghost sm create" onclick={begin}
            ><Plus size={13} />{kind === 'lexeme' ? t('lexicon.add') : t('morphemes.add')}</button
          >{/if}
      {:else}
        <input
          class="input data"
          aria-label={placeholder}
          {placeholder}
          bind:this={formInput}
          bind:value={form}
        />
        {#if !localOnly && project.languages.length > 1}<select
            class="select"
            aria-label={t('languages.title')}
            bind:value={newLanguage}
            >{#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option
              >{/each}</select
          >{/if}
        {#if kind === 'morpheme'}<select
            class="select"
            aria-label={t('morphemes.type')}
            bind:value={newType}
            >{#each MORPHEME_TYPES as mt (mt)}<option value={mt}
                >{t(`morphemes.types.${mt}`)}</option
              >{/each}</select
          >{/if}
        {#if kind === 'morpheme' && newType === 'circumfix'}<input
            class="input data"
            aria-label={t('morphemes.form2')}
            placeholder={t('morphemes.form2')}
            bind:value={secondForm}
          />{/if}
        <input
          class="input"
          aria-label={t('morphemes.meaning')}
          placeholder={t('morphemes.meaning')}
          bind:value={meaning}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) save()
          }}
        />
        <div class="row create-actions">
          <button type="button" class="btn primary sm" disabled={!form.trim()} onclick={save}
            >{t('common.ok')}</button
          ><button
            type="button"
            class="btn ghost sm"
            onclick={() => {
              creating = false
              void tick().then(() => input?.focus())
            }}>{t('common.cancel')}</button
          >
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .ref-picker {
    flex: 1 1 11em;
    min-width: 0;
  }
  .ref-picker input {
    min-width: 0;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 6px;
    z-index: 400;
    background: var(--bg-elev);
    box-shadow: var(--shadow-lg);
    overflow: auto;
    overscroll-behavior: contain;
  }
  .hits {
    max-height: 200px;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .hit {
    background: transparent;
    color: var(--text);
    font: inherit;
    border: 0;
    border-radius: 4px;
    display: flex;
    align-items: baseline;
    gap: 6px;
    text-align: start;
    padding: 5px;
    cursor: pointer;
  }
  .hit:hover,
  .hit.active {
    background: var(--bg-hover);
  }
  .hit span.small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .create {
    align-self: flex-start;
  }
</style>
