<script lang="ts">
  /**
   * 音变链图：按阶段分层。每一列是一个阶段快照，节点是该阶段出现的音段 / 音类，
   * 边是规则（目标 → 替换），跨阶段自然串成链，如 k → c → s。
   */
  import { t } from '$lib/i18n/index.svelte'
  import { ruleOrdinals, type ParsedRule, type RuleProgram } from '$lib/engine/sca'

  let { program, selectedLine = $bindable<number | null>(null) }: { program: RuleProgram | null; selectedLine?: number | null } = $props()

  interface Node {
    id: string
    col: number
    label: string
    isClass: boolean
    y: number
    x: number
    w: number
  }
  interface Edge {
    line: number
    from: string
    to: string
    rule: ParsedRule
    ordinal: number
  }

  const COL_W = 190
  const ROW_H = 30
  const PAD_X = 24
  const PAD_Y = 44

  const graph = $derived.by(() => {
    if (!program) return null
    const ordinals = ruleOrdinals(program)
    const columns: string[] = []
    const hasPre = program.steps.length > 0 && program.steps[0].kind === 'rule'
    if (hasPre) columns.push(t('soundChanges.input'))
    for (const m of program.markers) columns.push(m)
    const last = program.steps[program.steps.length - 1]
    if (!last || last.kind !== 'marker') columns.push(t('soundChanges.output'))
    if (columns.length < 2) columns.push(t('soundChanges.output'))

    const nodes = new Map<string, Node>()
    const edges: Edge[] = []
    const order: string[][] = columns.map(() => [])
    const label = (s: string): string => s || '∅'
    const getNode = (col: number, s: string): Node => {
      const id = `${col}:${s}`
      let n = nodes.get(id)
      if (!n) {
        n = { id, col, label: label(s), isClass: /^[A-Z]$|^\{.*\}$|\[.*\]/.test(s), y: 0, x: 0, w: 0 }
        nodes.set(id, n)
        order[col].push(id)
      }
      return n
    }
    let col = hasPre ? 0 : -1
    for (const step of program.steps) {
      if (step.kind === 'marker') {
        col++
        continue
      }
      if (col < 0) continue
      const from = getNode(col, step.target)
      const to = getNode(Math.min(col + 1, columns.length - 1), step.replacement === '\\' ? step.target.split('').reverse().join('') : step.replacement === '2' ? step.target + step.target : step.replacement)
      edges.push({ line: step.line, from: from.id, to: to.id, rule: step, ordinal: ordinals.get(step.line) ?? 0 })
    }
    // 重心排序：按前驱平均位置排每一列
    const pos = new Map<string, number>()
    order[0].forEach((id, i) => pos.set(id, i))
    for (let c = 1; c < columns.length; c++) {
      const bary = new Map<string, number>()
      for (const id of order[c]) {
        const preds = edges.filter((e) => e.to === id).map((e) => pos.get(e.from) ?? 0)
        bary.set(id, preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : order[c].indexOf(id) + 1000)
      }
      order[c].sort((a, b) => bary.get(a)! - bary.get(b)!)
      order[c].forEach((id, i) => pos.set(id, i))
    }
    let maxRows = 1
    order.forEach((ids, c) => {
      maxRows = Math.max(maxRows, ids.length)
      ids.forEach((id, i) => {
        const n = nodes.get(id)!
        n.x = PAD_X + c * COL_W
        n.y = PAD_Y + i * ROW_H
        n.w = Math.max(30, Array.from(n.label).length * 9 + 16)
      })
    })
    return { columns, nodes: [...nodes.values()], edges, width: PAD_X * 2 + columns.length * COL_W, height: PAD_Y + maxRows * ROW_H + 20, nodeById: nodes }
  })

  let hover = $state<number | null>(null)

  function path(e: Edge): string {
    const a = graph!.nodeById.get(e.from)!
    const b = graph!.nodeById.get(e.to)!
    const x1 = a.x + a.w
    const y1 = a.y
    const x2 = b.x
    const y2 = b.y
    const dx = Math.max(40, (x2 - x1) / 2)
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
  }
  function edgeTitle(e: Edge): string {
    return `${t('soundChanges.ruleN', { n: e.ordinal })}  ${e.rule.raw.trim()}`
  }
  function connected(id: string): boolean {
    if (selectedLine == null || !graph) return false
    const e = graph.edges.find((x) => x.line === selectedLine)
    return !!e && (e.from === id || e.to === id)
  }
</script>

{#if !graph || graph.edges.length === 0}
  <p class="muted">{t('soundChanges.chainEmpty')}</p>
{:else}
  <p class="small muted hint">{t('soundChanges.chainHint')}</p>
  <div class="wrap">
    <svg width={graph.width} height={graph.height} class="chain">
      {#each graph.columns as c, i (i)}
        <text x={PAD_X + i * COL_W} y={22} class="col">{c}</text>
        <line x1={PAD_X + i * COL_W - 10} y1={30} x2={PAD_X + i * COL_W - 10} y2={graph.height - 10} class="sep" />
      {/each}
      {#each graph.edges as e (e.line)}
        <path
          d={path(e)}
          class="edge"
          class:sel={selectedLine === e.line}
          class:hov={hover === e.line}
          role="button"
          tabindex="-1"
          onmouseenter={() => (hover = e.line)}
          onmouseleave={() => (hover = null)}
          onclick={() => (selectedLine = selectedLine === e.line ? null : e.line)}
          onkeydown={(ev) => ev.key === 'Enter' && (selectedLine = e.line)}
        >
          <title>{edgeTitle(e)}</title>
        </path>
      {/each}
      {#each graph.nodes as n (n.id)}
        <g class="node" class:cls={n.isClass} class:lit={connected(n.id)} transform={`translate(${n.x}, ${n.y})`}>
          <rect x="0" y="-11" width={n.w} height="22" rx="11" />
          <text x={n.w / 2} y="4">{n.label}</text>
        </g>
      {/each}
      {#each graph.edges as e (e.line + 'l')}
        {#if selectedLine === e.line || hover === e.line}
          {@const a = graph.nodeById.get(e.from)!}
          {@const b = graph.nodeById.get(e.to)!}
          <text x={(a.x + a.w + b.x) / 2} y={(a.y + b.y) / 2 - 6} class="elabel">{e.ordinal}: {e.rule.contexts.map((c) => `${c.left}_${c.right}`).join(', ')}</text>
        {/if}
      {/each}
    </svg>
  </div>
{/if}

<style>
  .hint {
    margin-bottom: 6px;
  }
  .wrap {
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
  }
  .chain {
    display: block;
    font-family: var(--font-data);
  }
  .col {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    fill: var(--accent-text);
  }
  .sep {
    stroke: var(--border);
    stroke-dasharray: 2 4;
  }
  .edge {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.5;
    cursor: pointer;
  }
  .edge.hov {
    stroke: var(--text-2);
    stroke-width: 2.5;
  }
  .edge.sel {
    stroke: var(--accent);
    stroke-width: 3;
  }
  .node rect {
    fill: var(--bg);
    stroke: var(--border-strong);
  }
  .node.cls rect {
    fill: #f3e8ff;
    stroke: #8b5cf6;
  }
  :global([data-theme='dark']) .node.cls rect {
    fill: #2e1f4a;
  }
  .node.lit rect {
    stroke: var(--accent);
    stroke-width: 2;
    fill: var(--accent-soft);
  }
  .node text {
    font-size: 14px;
    text-anchor: middle;
    fill: var(--text);
  }
  .elabel {
    font-family: var(--font-mono);
    font-size: 11px;
    fill: var(--accent-text);
    text-anchor: middle;
    paint-order: stroke;
    stroke: var(--bg-elev);
    stroke-width: 4;
  }
</style>
