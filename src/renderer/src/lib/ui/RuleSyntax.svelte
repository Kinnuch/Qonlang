<script lang="ts">
  /**
   * 规则语法说明：首页侧栏和各模块的检视器共用。anchor 指定打开时滚到哪一节。
   * 正文是 assets/docs/rule-syntax.*.md，标题后的 {#id} 摘下来挂到生成的标题上。
   */
  import { mdToHtml } from '$lib/core/markdown'
  import { i18n } from '$lib/i18n/index.svelte'
  import zhDoc from '../../assets/docs/rule-syntax.zh.md?raw'
  import enDoc from '../../assets/docs/rule-syntax.en.md?raw'

  let { anchor = '' }: { anchor?: string } = $props()
  let root = $state<HTMLElement | null>(null)

  const html = $derived.by(() => {
    const ids = new Map<string, string>()
    const md = (i18n.locale.startsWith('zh') ? zhDoc : enDoc).replace(
      /^(#{2,3}) (.*?)\s*\{#([\w-]+)\}\s*$/gm,
      (_m, hashes: string, text: string, id: string) => {
        ids.set(text.trim(), id)
        return `${hashes} ${text.trim()}`
      }
    )
    return mdToHtml(md).replace(
      /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
      (all, level: string, attrs: string, inner: string) => {
        const id = ids.get(inner.replace(/<[^>]+>/g, '').trim())
        return id ? `<h${level}${attrs} id="syntax-${id}">${inner}</h${level}>` : all
      }
    )
  })

  $effect(() => {
    const target = anchor
    void html
    if (!root || !target) return
    const el = root
    requestAnimationFrame(() =>
      el.querySelector(`#syntax-${target}`)?.scrollIntoView({ block: 'start' })
    )
  })
</script>

<div class="syntax" bind:this={root}>
  <!-- 正文是随软件带的文档，不是用户输入 -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html html}
</div>

<style>
  .syntax {
    font-size: 13px;
    line-height: 1.7;
  }
  .syntax :global(h1) {
    font-size: 18px;
    margin: 0 0 8px;
  }
  .syntax :global(h2) {
    font-size: 15px;
    margin: 18px 0 6px;
    scroll-margin-top: 8px;
  }
  .syntax :global(h3) {
    font-size: 13px;
    margin: 14px 0 4px;
    scroll-margin-top: 8px;
  }
  .syntax :global(p),
  .syntax :global(ul) {
    margin: 4px 0 8px;
  }
  .syntax :global(ul) {
    padding-left: 20px;
  }
  .syntax :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: var(--bg-sunken);
    border-radius: 4px;
    padding: 0 4px;
  }
  .syntax :global(pre) {
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    padding: 8px 10px;
    overflow-x: auto;
  }
  .syntax :global(pre code) {
    background: none;
    padding: 0;
  }
  .syntax :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 6px 0 10px;
    font-size: 12px;
  }
  .syntax :global(th),
  .syntax :global(td) {
    border: 1px solid var(--border);
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  .syntax :global(th) {
    background: var(--bg-sunken);
  }
</style>
