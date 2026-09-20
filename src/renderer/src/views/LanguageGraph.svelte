<script lang="ts">
  /**
   * 语言页的树状图：从最外层的分类节点往下画到每门语言，语言自己的历时阶段挂在它右边一小串。
   * 滚轮缩放、按住拖动平移，「适应」把整张图缩到看得全。点一个节点就选中它（跟列表一样）。
   */
  import type { Id } from '$lib/core/model'
  import { stageShort, type TreeItem } from '$lib/core/languageTree'
  import { t } from '$lib/i18n/index.svelte'
  import { sectionCollapsed, toggleSection } from '$lib/ui/section.svelte'
  import { ZoomIn, ZoomOut, Maximize2 } from '@lucide/svelte'

  let {
    items,
    visible = null,
    selectedId,
    defaultId,
    compareIds = [],
    hlNodes = new Set<string>(),
    hlEdges = new Set<string>(),
    onselect
  }: {
    items: TreeItem[]
    /** 顶栏搜索筛出来的可见节点；null 表示不筛 */
    visible?: Set<Id> | null
    selectedId: Id | null
    defaultId: Id | null
    /** 正在对比的两门语言 */
    compareIds?: Id[]
    /** 要描出来的节点 key（两条路径上的） */
    hlNodes?: Set<string>
    /** 要描出来的连线 key（`父key>子key`） */
    hlEdges?: Set<string>
    onselect: (id: Id, kind: 'group' | 'language', addToCompare: boolean) => void
  } = $props()

  const NW = 136
  const NH = 40
  const HGAP = 20
  const VGAP = 66
  const PAD = 30

  interface GNode {
    key: string
    kind: 'group' | 'language'
    id: Id
    label: string
    abbr: string
    color: string
    /** 分类节点的层级名 */
    level: string
    stages: string[]
    depth: number
    x: number
    y: number
    /** 这个节点底下收起来了：底下有几个节点没画 */
    hidden: number
  }

  const nodeKey = (kind: 'group' | 'language', id: Id): string =>
    (kind === 'group' ? 'g:' : 'l:') + id
  const short = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const itemId = (x: TreeItem): Id => (x.kind === 'group' ? x.group.id : x.language.id)
  /** 阶段挂在节点下方、居中一行：这行大概多宽（9.5px 的字按 5.4px 一个字符估） */
  const stagesText = (stages: string[]): string => stages.join(' › ')
  const stagesWidth = (stages: string[]): number =>
    stages.length ? Math.round(stagesText(stages).length * 5.4) : 0
  /** 比节点宽出来的那一半，左右各留一点，免得压到兄弟 */
  const stagesOverhang = (stages: string[]): number => Math.max(0, (stagesWidth(stages) - NW) / 2)

  /**
   * 分类节点（语系 / 语族 / 语支）只是用来结构化的，不是真的语言：
   * 它的代表原始语不跟下一级语支并排，而是语支和别的语言都挂在这门原始语下面
   * （列表视图里也是这么摆的：祖语跟分类节点的标题行对齐，下一级往里缩）。
   */
  const underProto = (item: TreeItem, kids: TreeItem[]): TreeItem[] => {
    if (item.kind !== 'group' || !item.group.protoLanguageId || kids.length < 2) return kids
    const i = kids.findIndex(
      (k) => k.kind === 'language' && k.language.id === item.group.protoLanguageId
    )
    if (i < 0) return kids
    const proto = kids[i]
    const rest = kids.filter((_, j) => j !== i)
    return [{ ...proto, children: [...proto.children, ...rest] }]
  }

  const layout = $derived.by(() => {
    const nodes: GNode[] = []
    const edges: { key: string; from: string; to: string }[] = []
    const nextX: number[] = []
    const rightHalf = (n: GNode): number => NW / 2 + stagesOverhang(n.stages)
    const walk = (item: TreeItem, depth: number): { node: GNode; all: GNode[] } => {
      const shown = item.children.filter((c) => !visible || visible.has(itemId(c)))
      const key0 = nodeKey(item.kind, itemId(item))
      // 右键收起来的节点：底下不画，牌子上写还有几个
      const off = sectionCollapsed(`langNode:${key0}`)
      const kids = off ? [] : underProto(item, shown)
      let hidden = 0
      if (off) {
        const count = (list: TreeItem[]): void => {
          for (const x of list) {
            hidden++
            count(x.children)
          }
        }
        count(shown)
      }
      const parts = kids.map((k) => walk(k, depth + 1))
      const all: GNode[] = []
      for (const p of parts) all.push(...p.all)
      const node: GNode =
        item.kind === 'group'
          ? {
              key: nodeKey('group', item.group.id),
              kind: 'group',
              id: item.group.id,
              label: item.group.name || t('languages.untitledGroup'),
              abbr: item.group.abbr,
              color: '',
              level: t(`languages.groupLevels.${item.group.level}`),
              stages: [],
              depth,
              x: 0,
              y: depth * (NH + VGAP),
              hidden
            }
          : {
              key: nodeKey('language', item.language.id),
              kind: 'language',
              id: item.language.id,
              label: item.language.name || t('app.untitledLanguage'),
              abbr: item.language.abbr,
              color: item.language.color,
              level: '',
              stages: (item.language.stages ?? []).map(stageShort).filter(Boolean),
              depth,
              x: 0,
              y: depth * (NH + VGAP),
              hidden
            }
      const kidNodes = parts.map((p) => p.node)
      const minLeft = nextX[depth] ?? 0
      let x = kidNodes.length
        ? (kidNodes[0].x + kidNodes[kidNodes.length - 1].x) / 2
        : minLeft + NW / 2
      if (x - NW / 2 < minLeft) {
        // 这一层左边已经有东西了：整棵子树往右挪
        const shift = minLeft - (x - NW / 2)
        for (const n of all) n.x += shift
        x += shift
      }
      node.x = x
      all.push(node)
      for (const n of all) nextX[n.depth] = Math.max(nextX[n.depth] ?? 0, n.x + rightHalf(n) + HGAP)
      nodes.push(node)
      for (const k of kidNodes)
        edges.push({ key: node.key + '>' + k.key, from: node.key, to: k.key })
      return { node, all }
    }
    for (const it of items) walk(it, 0)
    const byKey = new Map(nodes.map((n) => [n.key, n]))
    const xs = nodes.map((n) => n.x)
    const box = nodes.length
      ? {
          x: Math.min(...xs) - NW / 2 - PAD,
          y: -NH / 2 - PAD,
          w: Math.max(...nodes.map((n) => n.x + rightHalf(n))) - Math.min(...xs) + NW / 2 + PAD * 2,
          // 最下面一排如果挂着阶段那一行，底下多留一点
          h: Math.max(...nodes.map((n) => n.y + (n.stages.length ? 18 : 0))) + NH + PAD * 2
        }
      : { x: 0, y: 0, w: 1, h: 1 }
    return { nodes, edges, byKey, box }
  })

  // ── 平移与缩放 ──
  let bw = $state(0)
  let bh = $state(0)
  let view = $state({ x: 0, y: 0, k: 1 })
  let panning = $state(false)
  let pan: { id: number; sx: number; sy: number; vx: number; vy: number } | null = null
  /** 换了项目或者第一次画：自动缩到看得全 */
  let fitted = ''
  $effect(() => {
    const sig = layout.nodes.map((n) => n.key).join(',')
    if (!bw || !bh || !layout.nodes.length || fitted === sig) return
    fitted = sig
    fit()
  })

  function fit(): void {
    const b = layout.box
    if (!bw || !bh || !layout.nodes.length) return
    const k = Math.min(2, Math.max(0.2, Math.min(bw / b.w, bh / b.h)))
    view = { x: bw / 2 - (b.x + b.w / 2) * k, y: bh / 2 - (b.y + b.h / 2) * k, k }
  }
  function zoomAt(factor: number, px = bw / 2, py = bh / 2): void {
    const k = Math.min(2.5, Math.max(0.2, view.k * factor))
    view = { x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k, k }
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top)
  }
  function startPan(e: PointerEvent): void {
    if (e.button !== 0 || (e.target as Element).closest('.gnode')) return
    pan = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
    panning = true
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  function movePan(e: PointerEvent): void {
    if (!pan || e.pointerId !== pan.id) return
    view = { ...view, x: pan.vx + e.clientX - pan.sx, y: pan.vy + e.clientY - pan.sy }
  }
  function endPan(): void {
    pan = null
    panning = false
  }
</script>

<div class="graph-wrap">
  <div class="gcanvas" bind:clientWidth={bw} bind:clientHeight={bh}>
    {#if !layout.nodes.length}
      <p class="small muted mid">{t('languages.graph.empty')}</p>
    {:else}
      <svg
        class="ltree"
        class:panning
        width={bw}
        height={bh}
        role="application"
        aria-label={t('languages.views.tree')}
        onpointerdown={startPan}
        onpointermove={movePan}
        onpointerup={endPan}
        onpointercancel={endPan}
        onwheel={onWheel}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {#each layout.edges as e (e.key)}
            {@const a = layout.byKey.get(e.from)}
            {@const b = layout.byKey.get(e.to)}
            {#if a && b}
              {@const my = (a.y + NH / 2 + (b.y - NH / 2)) / 2}
              <path
                class="edge"
                class:dashed={a.kind === 'group'}
                class:hl={hlEdges.has(e.key)}
                d={`M ${a.x} ${a.y + NH / 2} L ${a.x} ${my} L ${b.x} ${my} L ${b.x} ${b.y - NH / 2}`}
              />
            {/if}
          {/each}
          {#each layout.nodes as n (n.key)}
            <g
              class="gnode {n.kind}"
              class:sel={selectedId === n.id}
              class:hl={hlNodes.has(n.key)}
              class:cmp={compareIds.includes(n.id)}
              data-key={n.key}
              transform={`translate(${n.x} ${n.y})`}
              role="button"
              tabindex="0"
              onclick={(e) => onselect(n.id, n.kind, e.ctrlKey || e.metaKey)}
              onkeydown={(e) => e.key === 'Enter' && onselect(n.id, n.kind, false)}
              oncontextmenu={(e) => {
                e.preventDefault()
                toggleSection(`langNode:${n.key}`)
              }}
            >
              <rect class="box" x={-NW / 2} y={-NH / 2} width={NW} height={NH} rx="9" />
              {#if n.kind === 'language'}
                <circle class="dot" cx={-NW / 2 + 12} cy="0" r="4.5" style:fill={n.color} />
              {/if}
              <text class="label" x={-NW / 2 + (n.kind === 'language' ? 24 : 12)} y="-1"
                >{short(n.label, 13)}</text
              >
              <text class="sub" x={-NW / 2 + (n.kind === 'language' ? 24 : 12)} y="13"
                >{n.kind === 'group'
                  ? n.level + (n.abbr ? ' · ' + n.abbr : '')
                  : n.abbr || (defaultId === n.id ? t('languages.isDefault') : '')}</text
              >
              {#if n.hidden}
                <g class="more" aria-hidden="true">
                  <rect x={-14} y={NH / 2 - 2} width="28" height="16" rx="8" />
                  <text class="mtext" x="0" y={NH / 2 + 10}>+{n.hidden}</text>
                </g>
              {/if}
              {#if n.stages.length}
                <!-- 历时阶段挂在节点下方居中的一行：原来挂在右边，把左右的兄弟顶开太多 -->
                <text class="stages" x="0" y={NH / 2 + (n.hidden ? 30 : 14)}
                  >{short(stagesText(n.stages), 30)}<title>{stagesText(n.stages)}</title></text
                >
              {/if}
            </g>
          {/each}
        </g>
      </svg>
      <div class="gtools">
        <button
          class="btn ghost icon sm"
          title={t('languages.graph.zoomIn')}
          onclick={() => zoomAt(1.2)}><ZoomIn size={15} /></button
        >
        <button
          class="btn ghost icon sm"
          title={t('languages.graph.zoomOut')}
          onclick={() => zoomAt(1 / 1.2)}><ZoomOut size={15} /></button
        >
        <button class="btn ghost icon sm" title={t('languages.graph.fit')} onclick={fit}
          ><Maximize2 size={15} /></button
        >
      </div>
      <span class="small muted ghint">{t('languages.graph.hint')}</span>
    {/if}
  </div>
</div>

<style>
  .graph-wrap {
    margin-top: 4px;
  }
  .gcanvas {
    position: relative;
    height: 62vh;
    min-height: 320px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .mid {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .ltree {
    display: block;
    cursor: grab;
    touch-action: none;
  }
  .ltree.panning {
    cursor: grabbing;
  }
  .gtools {
    position: absolute;
    right: 8px;
    top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px;
  }
  /* 右键收起来的节点：下面挂一个「+n」的小牌子 */
  .more rect {
    fill: var(--bg-sunken);
    stroke: var(--border-strong);
  }
  .mtext {
    fill: var(--text-2);
    font-size: 11px;
    text-anchor: middle;
  }
  .ghint {
    position: absolute;
    left: 10px;
    bottom: 8px;
    pointer-events: none;
  }
  .edge {
    fill: none;
    stroke: var(--border-strong);
    stroke-width: 1.5;
  }
  .edge.dashed {
    stroke-dasharray: 4 3;
  }
  .edge.hl {
    stroke: var(--accent);
    stroke-width: 2.5;
    stroke-dasharray: 7 5;
    animation: march 0.9s linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -24;
    }
  }
  .gnode {
    cursor: pointer;
  }
  .gnode .box {
    fill: var(--bg-elev);
    stroke: var(--border);
    stroke-width: 1;
  }
  .gnode.group .box {
    fill: var(--bg-sunken);
    stroke-dasharray: 5 3;
    stroke: var(--border-strong);
  }
  .gnode:hover .box {
    stroke: var(--border-strong);
  }
  .gnode.sel .box {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .gnode.hl .box {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 6 4;
    animation: blink 1.1s ease-in-out infinite;
  }
  .gnode.cmp .box {
    fill: var(--accent-soft);
  }
  @keyframes blink {
    50% {
      stroke-opacity: 0.3;
    }
  }
  /* 图里的字跟界面别处一套字体 */
  .ltree text {
    font-family: var(--font-ui);
  }
  .label {
    fill: var(--text);
    font-size: 12.5px;
    font-weight: 500;
  }
  .sub {
    fill: var(--text-3);
    font-size: 10.5px;
  }
  .stages {
    fill: var(--text-3);
    font-size: 9.5px;
    text-anchor: middle;
  }
  @media (prefers-reduced-motion: reduce) {
    .edge.hl,
    .gnode.hl .box {
      animation: none;
    }
  }
</style>
