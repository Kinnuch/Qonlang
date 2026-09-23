<script lang="ts">
  /**
   * 多语言文本字段（释义、译文、名字）：默认只给当前界面语言一个框，
   * 项目设置里列了「释义要填的语言」就按那几种给；已经有内容的语言照样摆出来。
   */
  import { projectState } from '$lib/state/project.svelte'
  import { i18n } from '$lib/i18n/index.svelte'
  import { glossInputLanguages } from '$lib/core/glossInputs'

  let {
    value = $bindable<Record<string, string>>({}),
    languages,
    multiline = false,
    placeholder = '',
    onchange
  }: {
    value?: Record<string, string>
    languages?: string[]
    multiline?: boolean
    placeholder?: string
    onchange?: () => void
  } = $props()

  const langs = $derived(
    languages ?? glossInputLanguages(projectState.project?.settings, i18n.locale, i18n.custom?.base)
  )
  const extra = $derived(Object.keys(value).filter((k) => !langs.includes(k) && value[k]))
</script>

<div class="loc">
  {#each [...langs, ...extra] as lang (lang)}
    <div class="row">
      <span class="lang">{lang}</span>
      {#if multiline}
        <textarea
          class="textarea"
          rows="2"
          bind:value={value[lang]}
          {placeholder}
          oninput={() => onchange?.()}
        ></textarea>
      {:else}
        <input class="input" bind:value={value[lang]} {placeholder} oninput={() => onchange?.()} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .loc {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    gap: 6px;
  }
  .lang {
    width: 22px;
    flex: none;
    font-size: 11px;
    color: var(--text-3);
    font-family: var(--font-mono);
  }
  .textarea {
    min-height: 44px;
  }
</style>
