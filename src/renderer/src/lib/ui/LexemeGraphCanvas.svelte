<script lang="ts">
  import { onDestroy, untrack } from 'svelte'
  import {
    ZoomIn,
    ZoomOut,
    LocateFixed,
    Maximize,
    Minimize,
    Expand,
    GitCompareArrows
  } from '@lucide/svelte'
  import type { Id, Lexeme, Project } from '$lib/core/model'
  import {
    collectLexemeGraph,
    graphLabelText,
    graphEdgeSemantic,
    type LexemeGraphModel
  } from '$lib/core/lexemeGraph'
  import { createForceLayout, type ForcePosition } from '$lib/graph/forceLayout'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { etymologyTypeLabel, relationLabel } from './labels'
  import { deletable, deleteKeyAllowed, editingDeleteTarget } from './deletable'
  import {
    readGraphSettings,
    saveGraphSettings,
    readGraphPanelCollapsed,
    saveGraphPanelCollapsed
  } from '$lib/state/graphSettings.svelte'
  import {
    createGraphColorResolver,
    defaultGraphRelationStyle,
    type GraphSettings
  } from './graphSettings'
  import { graphPinStorage } from './graphPins'
  import GraphSettingsPanel from './GraphSettingsPanel.svelte'

  let {
    project,
    model,
    center,
    onselect,
    ondelete,
    compareCount,
    oncompare
  }: {
    project: Project
    model: LexemeGraphModel
    center: Lexeme
    onselect: (id: Id) => void
    ondelete?: (id: Id) => unknown
    compareCount: number
    oncompare: () => void
  } = $props()
  // 切换工程或中心词时重建画布。设置按工程记忆，固定位置按中心词记忆。
  const scope = untrack(() => ({ projectId: project.meta.id, centerKey: 'l:' + center.id }))
  const storage = graphPinStorage(scope.projectId, scope.centerKey)
  const pins = storage.read()
  let settings = $state.raw(readGraphSettings(scope.projectId))
  let panelCollapsed = $state(readGraphPanelCollapsed(scope.projectId))
  let expanded = $state.raw(new Set<string>()),
    collapsed = $state.raw(new Set<string>())
  let selection = $state.raw(new Set<string>())
  const depth = $derived(settings.depth)
  const disabledSemantics = $derived(
    new Set(
      Object.entries(settings.relations)
        .filter(([, style]) => !style.enabled)
        .map(([key]) => key)
    )
  )
  const relationOptions = $derived(
    [...(model.semantics ?? [])].map(([key, label]) => ({
      key,
      label: graphLabelText(label, { t, etymology: etymologyTypeLabel, relation: relationLabel })
    }))
  )
  const layout = $derived(
    collectLexemeGraph(model, scope.centerKey, {
      depth,
      expanded,
      collapsed,
      disabledSemantics,
      maxNodes: settings.maxNodes,
      maxEdges: settings.maxEdges
    })
  )
  const crossLinks = $derived(settings.crossLinks)
  const visibleEdges = $derived(crossLinks ? layout.edges : layout.edges.filter((e) => e.tree))
  const degree = $derived.by(() => {
    const near = new Map<string, Set<string>>()
    for (const { from, to } of visibleEdges) {
      if (!near.has(from)) near.set(from, new Set())
      if (!near.has(to)) near.set(to, new Set())
      near.get(from)!.add(to)
      near.get(to)!.add(from)
    }
    return near
  })
  const groups = $derived(settings.groups),
    nodeColors = $derived(settings.nodeColors)
  const colorOf = $derived(createGraphColorResolver(project, { groups, nodeColors }))
  const a = $derived(settings.appearance)
  const nodeScale = $derived(a.nodeScale),
    frameScale = $derived(a.frameScale),
    card = $derived(a.shape === 'cards')
  const shapes = $derived.by(() =>
    layout.nodes.map(({ node }) => {
      const primary = node.key === scope.centerKey
      const weight = Math.min(4, Math.sqrt(degree.get(node.key)?.size ?? 0))
      const radius = (primary ? 11 + weight : 5.5 + weight) * nodeScale
      const width = (primary ? 128 : 102) * (1 + weight * 0.045) * frameScale * nodeScale
      const height = (primary ? 46 : 38) * frameScale * nodeScale
      const detail =
        node.kind !== 'external' && node.languageId && node.languageId !== center.languageId
          ? [node.languageLabel, node.sub].filter(Boolean).join(' · ')
          : node.sub
      return { node, primary, radius, width, height, detail, card }
    })
  )
  const strokes = $derived.by(() => {
    const seen = new Map<string, number>()
    return visibleEdges.map((edge) => {
      const pair = JSON.stringify([edge.from, edge.to].sort()),
        i = seen.get(pair) ?? 0
      seen.set(pair, i + 1)
      return {
        edge,
        style: settings.relations[graphEdgeSemantic(edge)] ?? defaultGraphRelationStyle(),
        label: graphLabelText(edge.label, {
          t,
          etymology: etymologyTypeLabel,
          relation: relationLabel
        }),
        bend: i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 24
      }
    })
  })

  let bw = $state(640),
    bh = $state(520)
  let view = $state({ x: 0, y: 0, k: 1 }),
    autoFit = true
  // 在整图视角仍可读出词头；放大时标签继续跟随节点。
  const dotTextScale = $derived(a.labelScale * Math.min(3.5, Math.max(1, 0.85 / view.k)))
  const detailedLabels = $derived(!a.adaptiveLabels || layout.nodes.length <= 400 || view.k >= 0.65)
  const simulation = createForceLayout([], [], { maxNodes: 5000, maxEdges: 20000 })
  let positions = $state.raw<Map<string, ForcePosition>>(new Map()),
    frame = 0
  function animate(): void {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const result = simulation.step(layout.nodes.length > 500 ? 1 : 2)
      positions = result.positions
      if (autoFit && positions.size && (result.iteration % 8 === 0 || result.stable)) fitView()
      if (!result.stable) animate()
      else autoFit = false
    })
  }
  onDestroy(() => {
    cancelAnimationFrame(frame)
    simulation.stop()
  })
  $effect(() => {
    const nodes = shapes.map((s) => ({
      key: s.node.key,
      radius: s.card ? Math.hypot(s.width, s.height) * 0.48 : s.radius + 6
    }))
    const edges = visibleEdges.map((e) => ({ source: e.from, target: e.to }))
    untrack(() => {
      const seeded = nodes.map((n) => ({
        ...n,
        ...(pins.get(n.key) ?? (n.key === scope.centerKey ? { x: 0, y: 0 } : {}))
      }))
      positions = simulation.updateTopology(seeded, edges).positions
      animate()
    })
  })
  $effect(() => {
    const { center, repel, link, length } = settings.forces
    simulation.setParameters({
      centerForce: center,
      repelForce: repel,
      linkForce: link,
      linkLength: length
    })
    animate()
  })
  function changeSettings(next: GraphSettings): void {
    if (next.depth !== settings.depth) {
      autoFit = true
      expanded = new Set()
      collapsed = new Set()
    }
    // 滑动外观或力度时沿用颜色分组索引，不重扫大词库。
    if (JSON.stringify(next.groups) === JSON.stringify(settings.groups))
      next.groups = settings.groups
    if (JSON.stringify(next.nodeColors) === JSON.stringify(settings.nodeColors))
      next.nodeColors = settings.nodeColors
    if (JSON.stringify(next.relations) === JSON.stringify(settings.relations))
      next.relations = settings.relations
    settings = next
    saveGraphSettings(scope.projectId, next)
  }
  function setPanel(value: boolean): void {
    panelCollapsed = value
    saveGraphPanelCollapsed(scope.projectId, value)
  }
  function isExpanded(key: string): boolean {
    return (
      !collapsed.has(key) &&
      (expanded.has(key) || (layout.byKey.get(key)?.depth ?? Infinity) < depth)
    )
  }
  function setExpanded(key: string, open: boolean): void {
    const yes = new Set(expanded),
      no = new Set(collapsed)
    if (open) {
      yes.add(key)
      no.delete(key)
    } else {
      no.add(key)
      yes.delete(key)
    }
    expanded = yes
    collapsed = no
  }
  function releasePin(key?: string): void {
    if (key) {
      pins.delete(key)
      simulation.unpin(key)
    } else {
      pins.clear()
      simulation.unpinAll()
    }
    storage.save(pins)
    positions = simulation.getPositions()
    animate()
  }
  function zoomAt(factor: number, px = 0, py = 0): void {
    autoFit = false
    const k = Math.min(4, Math.max(0.08, view.k * factor))
    view = { x: px - ((px - view.x) * k) / view.k, y: py - ((py - view.y) * k) / view.k, k }
  }
  function wheel(e: WheelEvent): void {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    zoomAt(
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
      e.clientX - rect.left - bw / 2,
      e.clientY - rect.top - bh / 2
    )
  }
  function resetView(): void {
    autoFit = false
    const root = positions.get(scope.centerKey)
    view = { x: -(root?.x ?? 0), y: -(root?.y ?? 0), k: 1 }
    menu = null
  }
  function fitView(): void {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity
    for (const s of shapes) {
      const p = positions.get(s.node.key)
      if (!p) continue
      const width = s.card
        ? s.width / 2
        : Math.max(
            s.radius,
            a.showLabels ? Math.min(100, s.node.label.length * 5 * a.labelScale) : 0
          )
      const h = s.card ? s.height / 2 : s.radius
      left = Math.min(left, p.x - width)
      right = Math.max(right, p.x + width)
      top = Math.min(top, p.y - h)
      bottom = Math.max(bottom, p.y + h + (s.card || !a.showLabels ? 0 : 25 * a.labelScale))
    }
    if (!Number.isFinite(left) || bw <= 60 || bh <= 80) return
    const k = Math.max(
      0.08,
      Math.min(1.25, (bw - 50) / Math.max(1, right - left), (bh - 80) / Math.max(1, bottom - top))
    )
    view = { x: (-(left + right) * k) / 2, y: (-(top + bottom) * k) / 2, k }
  }

  type Gesture = {
    id: number
    key: string | null
    x: number
    y: number
    vx: number
    vy: number
    k: number
    dragged: boolean
    starts: Map<string, ForcePosition>
  }
  let gesture: Gesture | null = null,
    dragging = $state(false)
  function down(e: PointerEvent): void {
    if (e.button !== 0 || gesture) return
    menu = null
    const key = (e.target as Element).closest<SVGGElement>('[data-key]')?.dataset.key ?? null
    autoFit = false
    const starts = new Map<string, ForcePosition>()
    for (const id of key && selection.has(key) ? selection : key ? [key] : []) {
      const p = positions.get(id)
      if (p) starts.set(id, p)
    }
    gesture = {
      id: e.pointerId,
      key,
      x: e.clientX,
      y: e.clientY,
      vx: view.x,
      vy: view.y,
      k: view.k,
      dragged: false,
      starts
    }
    ;(e.currentTarget as SVGElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent): void {
    const g = gesture
    if (!g || g.id !== e.pointerId) return
    const dx = e.clientX - g.x,
      dy = e.clientY - g.y
    if (!g.dragged && Math.hypot(dx, dy) < 4) return
    autoFit = false
    g.dragged = true
    dragging = true
    if (!g.key) {
      view = { x: g.vx + dx, y: g.vy + dy, k: g.k }
      return
    }
    if (!selection.has(g.key) && selection.size) selection = new Set()
    for (const [key, p] of g.starts) simulation.pin(key, p.x + dx / g.k, p.y + dy / g.k)
    positions = simulation.getPositions()
    animate()
  }
  function activate(key: string, multiple: boolean): void {
    if (multiple) {
      const next = new Set(selection)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      selection = next
      return
    }
    selection = new Set()
    const node = layout.byKey.get(key)?.node
    if (node && key !== scope.centerKey) {
      if (node.lexemeId) onselect(node.lexemeId)
      else if (node.morphemeId) ui.jump('morphemes', 'morpheme', node.morphemeId)
    }
  }
  function end(e: PointerEvent, cancel = false): void {
    const g = gesture
    if (!g || g.id !== e.pointerId) return
    gesture = null
    dragging = false
    if (g.dragged && g.key) {
      for (const [key, start] of g.starts) {
        if (cancel) {
          simulation.pin(key, start.x, start.y)
          if (!start.pinned) simulation.unpin(key)
        } else {
          const p = positions.get(key)
          if (p) pins.set(key, { ...p, pinned: true })
        }
      }
      if (!cancel) storage.save(pins)
      positions = simulation.getPositions()
      animate()
    } else if (!cancel && !g.dragged) {
      if (g.key) activate(g.key, e.shiftKey)
      else if (!e.shiftKey) selection = new Set()
    }
  }
  let menu = $state<{ x: number; y: number; key: string | null; links: boolean } | null>(null)
  function openMenu(e: MouseEvent, key: string | null): void {
    e.preventDefault()
    e.stopPropagation()
    menu = {
      x: Math.max(4, Math.min(e.clientX, window.innerWidth - 234)),
      y: Math.max(4, Math.min(e.clientY, window.innerHeight - (key ? 280 : 125))),
      key,
      links: !!key && !model.neighborsOf(key, disabledSemantics)[Symbol.iterator]().next().done
    }
  }
  $effect(() => {
    if (!menu) return
    const close = (ev: Event): void => {
      if (
        ev instanceof KeyboardEvent &&
        menuNode?.lexemeId &&
        ondelete &&
        deleteKeyAllowed(ev, {
          editable: editingDeleteTarget(ev.target),
          textSelection: !!window.getSelection()?.toString(),
          readOnly: projectState.readOnly,
          modal:
            !!(ui.confirmReq || ui.chooseReq || ui.promptReq || ui.paletteOpen) ||
            [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some(
              (node) => node.getClientRects().length > 0
            ),
          selected: true
        })
      ) {
        ev.preventDefault()
        void deleteWord(menuNode.lexemeId)
        return
      }
      if (ev instanceof KeyboardEvent && ev.key !== 'Escape') return
      if (ev.type === 'pointerdown' && (ev.target as Element).closest?.('.gmenu')) return
      menu = null
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    window.addEventListener('wheel', close, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
      window.removeEventListener('wheel', close)
    }
  })
  const menuNode = $derived(menu?.key ? (layout?.byKey.get(menu.key)?.node ?? null) : null)
  async function deleteWord(id: Id): Promise<void> {
    if (projectState.readOnly || projectState.project !== project || !ondelete) return
    const owner = project,
      existing = new Set(ui.toasts.map((toast) => toast.id))
    menu = null
    const result = ondelete(id)
    for (const toast of ui.toasts)
      if (!existing.has(toast.id) && toast.action?.label === t('common.undo')) {
        const undo = toast.action.run
        toast.action.run = () => {
          if (projectState.project === owner && !projectState.readOnly) undo()
        }
      }
    await result
  }
  function run(fn: () => void): void {
    fn()
    menu = null
  }
  let fullscreen = $state(false)
  function fullscreenSurface(
    node: HTMLElement,
    value: boolean
  ): { update(value: boolean): void; destroy(): void } {
    const anchor = document.createComment('graph location')
    node.before(anchor)
    const update = (value: boolean): void => {
      if (value) document.body.append(node)
      else anchor.after(node)
    }
    update(value)
    return {
      update,
      destroy() {
        anchor.remove()
      }
    }
  }
  $effect(() => {
    if (!fullscreen) return
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        menu = null
        fullscreen = false
      }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  })
</script>

<div
  class="lg"
  class:fullscreen
  use:fullscreenSurface={fullscreen}
  data-graph-fullscreen={fullscreen}
>
  <div class="small muted" data-graph-counts>
    {t('graph.size', {
      n: layout.nodes.length,
      e: visibleEdges.length
    })}{#if layout.nodeLimitReached}
      · {t('graph.nodeLimitReached', { n: settings.maxNodes })}{/if}{#if layout.edgeLimitReached}
      · {t('graph.edgeLimitReached', { n: settings.maxEdges })}{/if}
  </div>
  {#if !layout.legend.length}<div class="small muted">{t('lexicon.noGraph')}</div>
  {:else if layout.legend.length || layout.truncated}
    <div class="legend">
      {#each layout.legend as g (g.key)}<span class="badge"
          >{t(`lexicon.groups.${g.key}`)} {g.n}</span
        >{/each}
    </div>
  {/if}
  <div class="gwrap">
    <div
      class="graph-stage"
      class:with-panel={!panelCollapsed}
      bind:clientWidth={bw}
      bind:clientHeight={bh}
    >
      <svg
        class="graph"
        class:dragging
        width={bw}
        height={bh}
        role="application"
        aria-label={t('lexicon.graph')}
        onpointerdown={down}
        onpointermove={move}
        onpointerup={(e) => end(e)}
        onpointercancel={(e) => end(e, true)}
        onlostpointercapture={(e) => end(e, true)}
        onwheel={wheel}
        oncontextmenu={(e) => openMenu(e, null)}
      >
        <g transform={`translate(${bw / 2 + view.x} ${bh / 2 + view.y}) scale(${view.k})`}>
          {#each strokes as s (s.edge.key)}
            {@const p = positions.get(s.edge.from)}
            {@const q = positions.get(s.edge.to)}
            {#if p && q}
              {@const len = Math.hypot(q.x - p.x, q.y - p.y) || 1}
              {@const bend = s.edge.from < s.edge.to ? s.bend : -s.bend}
              {@const cx = (p.x + q.x) / 2 - ((q.y - p.y) / len) * bend}
              {@const cy = (p.y + q.y) / 2 + ((q.x - p.x) / len) * bend}
              {@const loop = s.edge.from === s.edge.to}
              {@const loopSize = (card ? 58 * frameScale : 24) * nodeScale + Math.abs(s.bend) / 2}
              <path
                class="edge"
                data-edge-semantic={graphEdgeSemantic(s.edge)}
                style:--edge-color={s.style.color}
                d={loop
                  ? `M ${p.x} ${p.y} c ${-loopSize * 1.8} ${-loopSize * 2} ${loopSize * 1.8} ${-loopSize * 2} 0 0`
                  : `M ${p.x} ${p.y} Q ${cx} ${cy} ${q.x} ${q.y}`}
                stroke-width={a.edgeWidth * s.style.width * 1.25}
                stroke-dasharray={s.style.style === 'dashed'
                  ? '8 5'
                  : s.style.style === 'dotted'
                    ? '1 5'
                    : undefined}
                stroke-linecap={s.style.style === 'dotted' ? 'round' : undefined}
                ><title>{s.label}</title></path
              >
              {#if a.showEdgeLabels}<text
                  x={(p.x + q.x) / 4 + cx / 2}
                  y={loop ? p.y - loopSize * 1.5 - 3 : (p.y + q.y) / 4 + cy / 2 - 3}
                  class="elabel">{s.label}</text
                >{/if}
            {/if}
          {/each}
          {#each shapes as s (s.node.key)}
            {@const n = s.node}
            {@const p = positions.get(n.key)}
            {#if p}
              <g
                class="node {n.kind}"
                class:center={s.primary}
                class:chosen={selection.has(n.key)}
                data-key={n.key}
                data-pinned={!!p.pinned}
                aria-pressed={selection.has(n.key)}
                aria-label={[n.label, s.detail, p.pinned ? t('graph.pinned') : '']
                  .filter(Boolean)
                  .join(' · ')}
                use:deletable={{
                  identity: n.lexemeId,
                  context: false,
                  selected: s.primary,
                  enabled: !!ondelete && !!n.lexemeId,
                  remove: () => (n.lexemeId ? deleteWord(n.lexemeId) : undefined)
                }}
                transform={`translate(${p.x}, ${p.y})`}
                style:--group-color={colorOf(n)}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    activate(n.key, e.shiftKey)
                  }
                }}
                oncontextmenu={(e) => openMenu(e, n.key)}
              >
                <title
                  >{[n.label, s.detail, p.pinned ? t('graph.pinned') : '']
                    .filter(Boolean)
                    .join(' · ')}</title
                >
                {#if s.card}
                  <rect
                    class="card-node"
                    x={-s.width / 2}
                    y={-s.height / 2}
                    width={s.width}
                    height={s.height}
                    rx={Math.min(10, s.height / 4)}
                  />
                  {#if a.showLabels && (detailedLabels || s.primary || selection.has(n.key) || p.pinned)}<foreignObject
                      x={-s.width / 2 + 4}
                      y={-s.height / 2}
                      width={Math.max(1, s.width - 8)}
                      height={s.height}
                    >
                      <div class="card-text" style:font-size={14 * a.labelScale + 'px'}>
                        <span>{n.label}</span>{#if s.detail}<small>{s.detail}</small>{/if}
                      </div>
                    </foreignObject>{/if}
                {:else}
                  <circle r={Math.max(10, s.radius)} fill="transparent" />
                  <circle class="dot" r={s.radius} />
                  {#if a.showLabels && (detailedLabels || s.primary || selection.has(n.key) || p.pinned)}
                    <foreignObject
                      x={-105 * dotTextScale}
                      y={s.radius + 3}
                      width={210 * dotTextScale}
                      height={23 * dotTextScale}
                      class="dot-label"
                    >
                      <div style:font-size={13 * dotTextScale + 'px'}>{n.label}</div>
                    </foreignObject>
                  {/if}
                {/if}
                {#if p.pinned}<circle
                    class="pin-mark"
                    cx={s.card ? s.width / 2 - 3 : s.radius * 0.72}
                    cy={s.card ? -s.height / 2 + 3 : -s.radius * 0.72}
                    r="3.2"
                  />{/if}
              </g>
            {/if}
          {/each}
        </g>
      </svg>
      <div class="tools">
        <button
          class="btn ghost icon sm"
          data-graph-fullscreen-toggle
          title={t(fullscreen ? 'graph.exitFullscreen' : 'graph.fullscreen')}
          onclick={() => (fullscreen = !fullscreen)}
          >{#if fullscreen}<Minimize size={15} />{:else}<Expand size={15} />{/if}</button
        >
        <button
          class="btn ghost icon sm"
          title={t('lexicon.graphZoomIn')}
          onclick={() => zoomAt(1.2)}><ZoomIn size={15} /></button
        >
        <button
          class="btn ghost icon sm"
          title={t('lexicon.graphZoomOut')}
          onclick={() => zoomAt(1 / 1.2)}><ZoomOut size={15} /></button
        >
        <button class="btn ghost icon sm" title={t('lexicon.graphReset')} onclick={resetView}
          ><LocateFixed size={15} /></button
        >
        <button
          class="btn ghost icon sm"
          title={t('graph.fit')}
          onclick={() => {
            autoFit = false
            fitView()
          }}><Maximize size={15} /></button
        >
        {#if compareCount}<button
            class="btn ghost sm compare"
            title={t('lexicon.compareTitle')}
            onclick={oncompare}><GitCompareArrows size={14} />{t('lexicon.compare')}</button
          >{/if}
      </div>
    </div>
    <GraphSettingsPanel
      {project}
      {settings}
      relations={relationOptions}
      onchange={changeSettings}
      collapsed={panelCollapsed}
      oncollapsed={setPanel}
    />
  </div>
  <div class="hint small muted">{t('graph.dragHint')}</div>
</div>
{#if menu}
  <div class="gmenu card" role="menu" style:left={`${menu.x}px`} style:top={`${menu.y}px`}>
    {#if menu.key}
      {@const key = menu.key}
      {#if menuNode}<div class="mhead data">{menuNode.label}</div>{/if}
      <button
        role="menuitem"
        disabled={isExpanded(key) || !menu.links}
        onclick={() => run(() => setExpanded(key, true))}>{t('lexicon.graphExpand')}</button
      >
      <button
        role="menuitem"
        disabled={!isExpanded(key)}
        onclick={() => run(() => setExpanded(key, false))}>{t('lexicon.graphCollapse')}</button
      >
      {#if positions.get(key)?.pinned}
        <button role="menuitem" onclick={() => run(() => releasePin(key))}
          >{t('graph.unpin')}</button
        >
      {/if}
      {#if menuNode?.lexemeId && key !== layout.centerKey}
        {@const id = menuNode.lexemeId}
        <hr />
        <button role="menuitem" onclick={() => run(() => onselect(id))}
          >{t('lexicon.graphRecenter')}</button
        >
      {:else if menuNode?.morphemeId}
        {@const id = menuNode.morphemeId}
        <hr />
        <button role="menuitem" onclick={() => run(() => ui.jump('morphemes', 'morpheme', id))}
          >{t('corpus.openInMorphemes')}</button
        >
      {/if}
      {#if menuNode?.lexemeId && ondelete}<hr />
        <button
          class="delete-object"
          role="menuitem"
          disabled={projectState.readOnly}
          onclick={() => {
            if (menuNode?.lexemeId) void deleteWord(menuNode.lexemeId)
          }}
          >{t('common.delete')}<span class="grow"></span><span class="small muted">Delete</span
          ></button
        >{/if}
    {:else}
      <button role="menuitem" disabled={!pins.size} onclick={() => run(() => releasePin())}
        >{t('graph.clearPins')}</button
      >
      <button role="menuitem" onclick={resetView}>{t('lexicon.graphReset')}</button>
      <button
        role="menuitem"
        onclick={() =>
          run(() => {
            expanded = new Set()
            collapsed = new Set([scope.centerKey])
          })}>{t('lexicon.graphCollapseAll')}</button
      >
    {/if}
  </div>
{/if}

<style>
  .lg {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    height: 100%;
    min-height: 360px;
    min-width: 0;
  }
  .lg.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 450;
    background: var(--bg);
    padding: 12px;
    box-sizing: border-box;
    height: 100%;
    min-height: 0;
  }
  .legend {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .gwrap {
    position: relative;
    flex: 1;
    min-height: 310px;
    overflow: hidden;
    container-type: inline-size;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-elev);
  }
  .graph-stage {
    position: absolute;
    inset: 0;
  }
  .graph-stage.with-panel {
    inset-inline-end: min(310px, 45%);
  }
  @container (max-width:650px) {
    .graph-stage.with-panel {
      inset-inline-end: 0;
      inset-block-end: 38%;
    }
    .gwrap :global(.graph-settings:not(.collapsed)) {
      inset-block: auto 4px;
      inset-inline: 4px;
      width: auto;
      max-width: none;
      max-height: 37%;
    }
  }
  .graph {
    position: absolute;
    inset: 0;
    touch-action: none;
    user-select: none;
    cursor: grab;
  }
  .node {
    --ink: var(--group-color, var(--text-3));
    color: var(--ink);
    cursor: grab;
    outline: none;
  }
  .node.morpheme {
    --ink: var(--group-color, #9973ba);
  }
  .node.external {
    --ink: var(--group-color, #aa8154);
  }
  .node.center {
    --ink: var(--group-color, var(--accent));
  }
  .dragging,
  .dragging .node {
    cursor: grabbing;
  }
  .edge {
    stroke: var(--edge-color, var(--border-strong));
    fill: none;
  }
  .elabel {
    font: 10px var(--font-ui);
    fill: var(--text-2);
    text-anchor: middle;
    paint-order: stroke;
    stroke: var(--bg-elev);
    stroke-width: 3;
    pointer-events: none;
  }
  .dot {
    fill: var(--ink);
    stroke: var(--bg-elev);
    stroke-width: 1.2;
  }
  .card-node {
    fill: color-mix(in srgb, var(--ink) 12%, var(--bg-elev));
    stroke: var(--ink);
    stroke-width: 1.5;
  }
  .external .card-node {
    stroke-dasharray: 4 2;
  }
  .node:hover .dot,
  .node:hover .card-node,
  .node.chosen .dot,
  .node.chosen .card-node,
  .node:focus-visible .dot,
  .node:focus-visible .card-node {
    stroke: var(--accent);
    stroke-width: 3;
  }
  .node.chosen .dot,
  .node.chosen .card-node {
    stroke-dasharray: 4 2;
  }
  .pin-mark {
    fill: var(--text);
    stroke: var(--bg-elev);
    stroke-width: 1;
  }
  .card-text,
  .dot-label div {
    text-align: center;
    font-family: var(--font-data);
    color: var(--text);
    line-height: 1.22;
  }
  .card-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    overflow: hidden;
  }
  .card-text span,
  .card-text small,
  .dot-label div {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-text small {
    font: 0.75em var(--font-ui);
    color: var(--text-2);
  }
  .dot-label {
    pointer-events: none;
  }
  .dot-label div {
    width: fit-content;
    max-width: 100%;
    margin-inline: auto;
    pointer-events: auto;
  }
  .center .dot-label div,
  .center .card-text span {
    font-weight: 650;
  }
  .tools {
    position: absolute;
    top: 7px;
    inset-inline-start: 7px;
    display: flex;
    gap: 1px;
    align-items: center;
    padding: 2px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    max-width: calc(100% - 14px);
    flex-wrap: wrap;
  }
  .hint {
    line-height: 1.35;
  }
  .gmenu button.delete-object {
    color: var(--danger);
  }
  .gmenu {
    position: fixed;
    z-index: 320;
    min-width: min(200px, calc(100vw - 8px));
    max-width: calc(100vw - 8px);
    max-height: calc(100vh - 8px);
    overflow: auto;
    padding: 4px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .gmenu .mhead {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 4px 10px 6px;
    font-size: 13px;
    color: var(--text-2);
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }
  .gmenu button {
    text-align: start;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .gmenu button:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .gmenu button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .gmenu hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
</style>
