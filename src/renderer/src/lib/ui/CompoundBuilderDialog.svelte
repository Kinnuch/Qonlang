<script lang="ts">
  import { untrack } from 'svelte'
  import type { Id, Lexeme, Project } from '$lib/core/model'
  import { createCompoundLexeme } from '$lib/core/compoundBuilder'
  import { prepareCompoundJoin, type CompoundJoinStep } from '$lib/core/compoundJoin'
  import { projectState } from '$lib/state/project.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { gEquivalent } from '$lib/ipa/equivalence'
  import ReferencePicker from './ReferencePicker.svelte'
  import LocalizedInput from './LocalizedInput.svelte'
  import HelpDot from './HelpDot.svelte'
  import CompoundJoinEditor from './CompoundJoinEditor.svelte'
  import { X, Combine } from '@lucide/svelte'
  let {
    project,
    initialLanguageId,
    onclose,
    oncreate
  }: {
    project: Project
    initialLanguageId: Id
    onclose: () => void
    oncreate: (word: Lexeme) => void
  } = $props()
  let languageId = $state(untrack(() => initialLanguageId)),
    firstId = $state(''),
    secondId = $state(''),
    joinSteps = $state<CompoundJoinStep[]>([]),
    lemma = $state(''),
    customForm = $state(false),
    posId = $state(''),
    definitions = $state<Record<string, string>>({})
  const language = $derived(project.languages.find((lang) => lang.id === languageId))
  const first = $derived(
      project.lexemes.find((word) => word.id === firstId && word.languageId === languageId)
    ),
    second = $derived(
      project.lexemes.find((word) => word.id === secondId && word.languageId === languageId)
    )
  const joiner = $derived(language ? prepareCompoundJoin(project, language) : null)
  const joining = $derived(
    joiner ? joiner(first?.lemma ?? '', second?.lemma ?? '', joinSteps) : null
  )
  const combined = $derived(joining?.surface ?? '')
  const editable = $derived(
    projectState.project === project && !projectState.readOnly && !!language
  )
  const valid = $derived(
    editable &&
      !!joining?.valid &&
      !!first?.lemma.trim() &&
      !!second?.lemma.trim() &&
      !!lemma.trim() &&
      (!posId || project.posList.some((pos) => pos.id === posId))
  )
  const duplicate = $derived(
    lemma.trim()
      ? project.lexemes.some(
          (word) => word.languageId === languageId && gEquivalent(word.lemma, lemma.trim())
        )
      : false
  )
  $effect(() => {
    if (!customForm) lemma = combined
  })
  function label(word: Lexeme | undefined): string {
    if (!word) return ''
    const pos = project.posList.find((pos) => pos.id === word.posId)
    return [
      word.lemma,
      pos?.abbr || pickText(pos?.name ?? {}, project.settings.glossLanguages),
      pickText(word.senses[0]?.definition ?? {}, project.settings.glossLanguages)
    ]
      .filter(Boolean)
      .join(' — ')
  }
  function languageChanged(value: Id): void {
    languageId = value
    firstId = ''
    secondId = ''
    joinSteps = []
    customForm = false
    lemma = ''
  }
  function confirm(): void {
    if (!valid) return
    const word = createCompoundLexeme(project, {
      languageId,
      firstId,
      secondId,
      lemma,
      posId: posId || null,
      definitions
    })
    if (word) oncreate(word)
  }
  function key(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !document.querySelector('[data-reference-popup]')) {
      event.preventDefault()
      onclose()
    }
  }
</script>

<svelte:window onkeydown={key} />
<div class="compound-backdrop" role="presentation" onclick={onclose}></div>
<div
  class="compound-dialog card"
  role="dialog"
  aria-modal="true"
  aria-label={t('compoundBuilder.title')}
  data-compound-dialog
>
  <div class="row">
    <Combine size={18} />
    <h2 class="grow">{t('compoundBuilder.title')}</h2>
    <button class="btn ghost icon sm" aria-label={t('common.close')} onclick={onclose}
      ><X size={16} /></button
    >
  </div>
  <label class="field"
    >{t('compoundBuilder.language')}<select
      class="select"
      data-compound-language
      value={languageId}
      disabled={!editable}
      onchange={(event) => languageChanged(event.currentTarget.value)}
      >{#each project.languages as lang (lang.id)}<option value={lang.id}>{lang.name}</option
        >{/each}</select
    ></label
  >
  <div class="compound-parts">
    <div class="field compound-part" data-compound-first>
      <span>{t('compoundBuilder.first')}</span><ReferencePicker
        {project}
        {languageId}
        kind="lexeme"
        localOnly
        allowCreate={false}
        allowClear
        glossLangs={project.settings.glossLanguages}
        selected={label(first)}
        placeholder={t('compoundBuilder.searchFirst')}
        onpick={(id) => (firstId = id)}
      />
    </div>
    <div class="field compound-part" data-compound-second>
      <span>{t('compoundBuilder.second')}</span><ReferencePicker
        {project}
        {languageId}
        kind="lexeme"
        localOnly
        allowCreate={false}
        allowClear
        glossLangs={project.settings.glossLanguages}
        selected={label(second)}
        placeholder={t('compoundBuilder.searchSecond')}
        onpick={(id) => (secondId = id)}
      />
    </div>
  </div>
  {#if joining}<CompoundJoinEditor
      bind:steps={joinSteps}
      result={joining}
      readOnly={!editable}
    />{/if}
  <div class="sources small" data-compound-sources>
    {first?.lemma || '…'} + {second?.lemma || '…'} →
    <strong class="data">{lemma || '…'}</strong><HelpDot tip={t('compoundBuilder.sourceHint')} />
  </div>
  <label class="field"
    ><span class="row"
      >{t('compoundBuilder.form')}{#if customForm}<span class="small muted"
          >{t('compoundJoin.manual')}</span
        ><HelpDot tip={t('compoundJoin.manualHint')} />{/if}</span
    ><input
      class="input data"
      data-compound-form
      bind:value={lemma}
      disabled={!editable}
      oninput={() => (customForm = true)}
    /></label
  >
  {#if customForm}<button
      class="btn ghost sm reset-form"
      disabled={!editable}
      onclick={() => (customForm = false)}>{t('compoundBuilder.resetForm')}</button
    >{/if}
  <label class="field"
    >{t('compoundBuilder.pos')}<select
      class="select"
      data-compound-pos
      bind:value={posId}
      disabled={!editable}
      ><option value="">—</option>{#each project.posList as pos (pos.id)}<option value={pos.id}
          >{pickText(pos.name, project.settings.glossLanguages) || pos.abbr}</option
        >{/each}</select
    ></label
  >
  <div class="field" data-compound-definitions>
    <span>{t('compoundBuilder.definitions')}</span><LocalizedInput
      bind:value={definitions}
      multiline
      placeholder={t('compoundBuilder.definitionPlaceholder')}
    />
  </div>
  {#if duplicate}<p class="small warn">{t('compoundBuilder.duplicate')}</p>{/if}
  <div class="row end">
    <button class="btn" onclick={onclose}>{t('common.cancel')}</button><button
      class="btn primary"
      data-confirm-compound
      disabled={!valid}
      onclick={confirm}>{t('compoundBuilder.create')}</button
    >
  </div>
</div>

<style>
  .compound-backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0/0.25);
    z-index: 350;
  }
  .compound-dialog {
    position: fixed;
    inset-inline-start: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 351;
    inline-size: min(680px, 94vw);
    max-block-size: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    box-shadow: var(--shadow-lg);
  }
  h2 {
    font-size: 17px;
    margin: 0;
  }
  .field {
    display: flex;
    margin: 0;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    min-inline-size: 0;
  }
  .compound-parts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    align-items: start;
    flex: none;
  }
  /* 搜索框的行内flex-basis不能在纵向field里变成11em高度。浮层仍由原组件定位。 */
  .compound-part :global(.ref-picker) {
    flex: 0 0 auto;
    inline-size: 100%;
    min-inline-size: 0;
  }
  .sources {
    padding: 8px;
    border-radius: 6px;
    background: var(--bg-sunken);
    overflow-wrap: anywhere;
  }
  .end {
    justify-content: flex-end;
  }
  .reset-form {
    align-self: flex-start;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  @media (max-width: 600px) {
    .compound-parts {
      grid-template-columns: 1fr;
    }
  }
</style>
