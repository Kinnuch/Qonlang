<script lang="ts">
  /** 多语言文本字段：按项目的释义语言顺序给每种语言一个输入框 */
  let {
    value = $bindable<Record<string, string>>({}),
    languages = ['zh', 'en'],
    multiline = false,
    placeholder = '',
    onchange
  }: { value?: Record<string, string>; languages?: string[]; multiline?: boolean; placeholder?: string; onchange?: () => void } = $props()

  const extra = $derived(Object.keys(value).filter((k) => !languages.includes(k) && value[k]))
</script>

<div class="loc">
  {#each [...languages, ...extra] as lang (lang)}
    <div class="row">
      <span class="lang">{lang}</span>
      {#if multiline}
        <textarea class="textarea" rows="2" bind:value={value[lang]} {placeholder} oninput={() => onchange?.()}></textarea>
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
