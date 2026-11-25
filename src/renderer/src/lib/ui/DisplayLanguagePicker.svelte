<script lang="ts">
  import type { DisplayLanguageSelection } from '$lib/core/model'
  import { normalizeDisplayLanguages } from '$lib/core/displayLanguages'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  let {
    kind,
    label,
    value,
    options,
    onchange,
    disabled = false
  }: {
    kind: string
    label: string
    value?: DisplayLanguageSelection
    options: readonly string[]
    onchange: (value: DisplayLanguageSelection | undefined) => void
    disabled?: boolean
  } = $props()
  const id = $props.id(),
    selection = $derived(normalizeDisplayLanguages(value))
  function mode(next: string): void {
    if (disabled) return
    if (next === 'legacy') onchange(undefined)
    else if (next === 'all') onchange({ mode: 'all' })
    else {
      const count = next === 'two' ? 2 : 1
      const previous = selection && selection.mode !== 'all' ? selection.languages : []
      const languages = [...new Set([...previous, ...options])].slice(0, count)
      if (languages.length === count) onchange({ mode: count === 1 ? 'one' : 'two', languages })
    }
  }
  function language(index: number, language: string): void {
    if (disabled || !selection || selection.mode === 'all') return
    const languages = [...selection.languages]
    const other = languages.indexOf(language)
    if (other >= 0 && other !== index) languages[other] = languages[index]
    languages[index] = language
    if (new Set(languages).size === languages.length) onchange({ ...selection, languages })
  }
</script>

<div class="field" data-display-language-picker={kind}>
  <label for={id}>{label}<HelpDot tip={t('displayLanguages.hint')} /></label>
  <select
    {id}
    class="select"
    data-display-mode={kind}
    {disabled}
    value={selection?.mode ?? 'legacy'}
    onchange={(e) => mode(e.currentTarget.value)}
  >
    <option value="legacy">{t('displayLanguages.legacy')}</option>
    <option value="one" disabled={!options.length}>{t('displayLanguages.one')}</option>
    <option value="two" disabled={options.length < 2}>{t('displayLanguages.two')}</option>
    <option value="all">{t('displayLanguages.all')}</option>
  </select>
  {#if selection && selection.mode !== 'all'}
    <div class="language-choices">
      {#each selection.languages as selected, index (index)}
        <label class="small muted"
          >{t('displayLanguages.language', { n: index + 1 })}
          <select
            class="select"
            data-display-code={`${kind}:${index}`}
            {disabled}
            value={selected}
            onchange={(e) => language(index, e.currentTarget.value)}
          >
            {#each options as option (option)}<option value={option}>{option}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
  {/if}
</div>

<style>
  .language-choices {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .language-choices label {
    flex: 1;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
