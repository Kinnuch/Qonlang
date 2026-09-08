<script lang="ts">
  /**
   * 规则文本编辑器：透明 textarea 叠在高亮层上，行号栏在左，诊断行标红。
   */
  import type { Diagnostic } from '$lib/engine/sca'

  let {
    value = $bindable(''),
    diagnostics = [],
    placeholder = '',
    oninput
  }: {
    value?: string
    diagnostics?: Diagnostic[]
    placeholder?: string
    oninput?: () => void
  } = $props()

  let textarea = $state<HTMLTextAreaElement | null>(null)
  let scrollTop = $state(0)
  let scrollLeft = $state(0)

  const lines = $derived(value.split('\n'))
  const diagByLine = $derived.by(() => {
    const m = new Map<number, Diagnostic>()
    for (const d of diagnostics) if (!m.has(d.line) || d.severity === 'error') m.set(d.line, d)
    return m
  })

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  /** 单行高亮：返回 HTML */
  function highlight(raw: string): string {
    let code = raw
    let comment = ''
    const semi = raw.indexOf(';')
    if (semi >= 0) {
      code = raw.slice(0, semi)
      comment = raw.slice(semi)
    }
    const trimmed = code.trim()
    if (!trimmed) return `<span class="c">${esc(comment)}</span>`
    if (trimmed.startsWith('#')) return `<span class="c">${esc(raw)}</span>`
    if (trimmed.startsWith('-*'))
      return `<span class="m">${esc(code)}</span><span class="c">${esc(comment)}</span>`
    const cls = /^(\s*)(\{[^}]+\}|[A-Z])(\s*=)(.*)$/.exec(code)
    if (cls)
      return `${cls[1]}<span class="k">${esc(cls[2])}</span><span class="o">${cls[3]}</span><span class="v">${esc(cls[4])}</span><span class="c">${esc(comment)}</span>`
    if (!code.includes('>') && /^\s*\S+\s*\|\s*\S+\s*$/.test(code)) {
      return `<span class="v">${esc(code)}</span><span class="c">${esc(comment)}</span>`
    }
    // 规则：目标 > 替换 / 环境 - 排除
    let out = ''
    const gt = code.indexOf('>')
    const slash = code.indexOf('/')
    const rulePart = slash >= 0 ? code.slice(0, slash) : code
    if (gt >= 0) {
      out += `<span class="t">${esc(rulePart.slice(0, gt))}</span><span class="o">&gt;</span><span class="r">${esc(rulePart.slice(gt + 1))}</span>`
    } else out += `<span class="e">${esc(rulePart)}</span>`
    if (slash >= 0) {
      let ctx = code.slice(slash + 1)
      let exc = ''
      const dash = ctx.indexOf('-')
      if (dash >= 0) {
        exc = ctx.slice(dash + 1)
        ctx = ctx.slice(0, dash)
      }
      out += `<span class="o">/</span><span class="x">${esc(ctx).replace(/_/g, '<b>_</b>')}</span>`
      if (dash >= 0)
        out += `<span class="o">-</span><span class="n">${esc(exc).replace(/_/g, '<b>_</b>')}</span>`
    }
    return out + `<span class="c">${esc(comment)}</span>`
  }

  function onScroll(): void {
    if (!textarea) return
    scrollTop = textarea.scrollTop
    scrollLeft = textarea.scrollLeft
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Tab' && textarea) {
      e.preventDefault()
      const s = textarea.selectionStart
      const t = textarea.selectionEnd
      value = value.slice(0, s) + '  ' + value.slice(t)
      queueMicrotask(() => {
        textarea!.selectionStart = textarea!.selectionEnd = s + 2
      })
      oninput?.()
    }
  }

  /** 供外部调用：跳到某行 */
  export function goToLine(line: number): void {
    if (!textarea) return
    const ls = value.split('\n')
    let start = 0
    for (let i = 0; i < line - 1 && i < ls.length; i++) start += ls[i].length + 1
    const end = start + (ls[line - 1]?.length ?? 0)
    textarea.focus()
    textarea.setSelectionRange(start, end)
    const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 20
    textarea.scrollTop = Math.max(0, (line - 4) * lh)
    onScroll()
  }
</script>

<div class="editor">
  <div class="gutter" style:transform={`translateY(${-scrollTop}px)`}>
    {#each lines as _l, i (i)}
      {@const d = diagByLine.get(i + 1)}
      <div
        class="ln"
        class:err={d?.severity === 'error'}
        class:warn={d?.severity === 'warning'}
        title={d?.message}
      >
        {i + 1}
      </div>
    {/each}
  </div>
  <div class="body">
    <pre
      class="hl"
      aria-hidden="true"
      style:transform={`translate(${-scrollLeft}px, ${-scrollTop}px)`}>{#each lines as l, i (i)}{@const d =
          diagByLine.get(i + 1)}<div
          class="line"
          class:err={d?.severity === 'error'}>{@html highlight(l) || '&nbsp;'}</div>{/each}</pre>
    <textarea
      bind:this={textarea}
      bind:value
      {placeholder}
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      wrap="off"
      onscroll={onScroll}
      oninput={() => oninput?.()}
      onkeydown={onKeydown}
    ></textarea>
  </div>
</div>

<style>
  .editor {
    position: relative;
    flex: 1;
    min-height: 240px;
    height: 100%;
    max-height: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 20px;
  }
  .gutter {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 44px;
    padding: 10px 0;
    text-align: right;
    color: var(--text-3);
    background: var(--bg-sunken);
    border-right: 1px solid var(--border);
    user-select: none;
    overflow: hidden;
  }
  .ln {
    padding-right: 8px;
    height: 20px;
  }
  .ln.err {
    color: var(--danger);
    font-weight: 600;
  }
  .ln.warn {
    color: var(--warn);
  }
  .body {
    position: absolute;
    left: 44px;
    top: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
  }
  .hl,
  textarea {
    margin: 0;
    padding: 10px 12px;
    font: inherit;
    line-height: inherit;
    white-space: pre;
    tab-size: 2;
  }
  .hl {
    position: absolute;
    inset: 0;
    pointer-events: none;
    color: var(--text);
    overflow: visible;
  }
  .line {
    height: 20px;
  }
  .line.err {
    text-decoration: underline wavy var(--danger);
    text-underline-offset: 3px;
  }
  textarea {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    outline: none;
    resize: none;
    background: transparent;
    color: transparent;
    caret-color: var(--text);
    overflow: auto;
  }
  textarea::placeholder {
    color: var(--text-3);
  }
  textarea::selection {
    background: var(--accent-soft);
  }
  .hl :global(.c) {
    color: var(--text-3);
    font-style: italic;
  }
  .hl :global(.m) {
    color: var(--accent-text);
    font-weight: 700;
  }
  .hl :global(.k) {
    color: #8b5cf6;
    font-weight: 600;
  }
  .hl :global(.v) {
    color: var(--text-2);
  }
  .hl :global(.o) {
    color: var(--text-3);
  }
  .hl :global(.t) {
    color: #b45309;
  }
  .hl :global(.r) {
    color: #0f766e;
  }
  .hl :global(.x) {
    color: #1d4ed8;
  }
  .hl :global(.n) {
    color: var(--danger);
  }
  .hl :global(.e) {
    color: var(--danger);
  }
  .hl :global(b) {
    font-weight: 700;
    color: var(--text);
  }
  :global([data-theme='dark']) .hl :global(.k) {
    color: #c4b5fd;
  }
  :global([data-theme='dark']) .hl :global(.t) {
    color: #fbbf24;
  }
  :global([data-theme='dark']) .hl :global(.r) {
    color: #5eead4;
  }
  :global([data-theme='dark']) .hl :global(.x) {
    color: #93c5fd;
  }
</style>
