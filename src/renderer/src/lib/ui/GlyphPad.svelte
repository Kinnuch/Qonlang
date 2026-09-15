<script lang="ts">
  /**
   * 手写板：现场画一个字。画布是字体单位（一个 em = 1000），画着上伸线、大写高、x 高、基线、下伸线，
   * 左右两条竖线是字的起点和字宽（右边那条的小圆点可以拖）。
   * 画笔一笔一笔地画；框选把框到的笔画选中，按住选框拖着挪，Delete 删；橡皮点到哪笔删哪笔。
   */
  import { onMount, untrack } from 'svelte'
  import type { GlyphDrawing } from '$lib/core/model'
  import { GUIDES, simplify } from '$lib/script/drawnFont'
  import { t } from '$lib/i18n/index.svelte'
  import { PenLine, BoxSelect, Eraser, Undo2, Trash2 } from '@lucide/svelte'

  type Pt = [number, number]
  interface Stroke {
    points: Pt[]
    width: number
  }

  let {
    drawing,
    title,
    onsave,
    oncancel
  }: {
    drawing: GlyphDrawing | undefined
    title: string
    onsave: (d: GlyphDrawing) => void
    oncancel: () => void
  } = $props()

  const MARGIN = 160
  /** 打开时的样子：画板里改的是一份拷贝，点「保存」才写回字形 */
  const initial = untrack(() => drawing)
  let strokes = $state<Stroke[]>(
    (initial?.strokes ?? []).map((s) => ({
      width: s.width,
      points: s.points.map((p) => [p[0], p[1]] as Pt)
    }))
  )
  let advance = $state(initial?.advance ?? 1000)
  let width = $state(initial?.strokes.at(-1)?.width ?? 60)
  let tool = $state<'pen' | 'select' | 'erase'>('pen')
  let history: Stroke[][] = []
  let selected = $state<number[]>([])

  let svg = $state<SVGSVGElement | null>(null)
  /** 屏幕坐标 → 字体坐标（y 向上） */
  function toFont(e: PointerEvent): Pt {
    if (!svg) return [0, 0]
    const m = svg.getScreenCTM()
    if (!m) return [0, 0]
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return [Math.round(p.x), Math.round(-p.y)]
  }
  const clone = (list: Stroke[]): Stroke[] =>
    list.map((s) => ({ width: s.width, points: s.points.map((p) => [p[0], p[1]] as Pt) }))
  function remember(): void {
    history.push(clone(strokes))
    if (history.length > 100) history.shift()
  }
  function undo(): void {
    const prev = history.pop()
    if (prev) {
      strokes = prev
      selected = []
    }
  }
  function clearAll(): void {
    if (!strokes.length) return
    remember()
    strokes = []
    selected = []
  }

  // ── 画笔 ──
  let current = $state<Stroke | null>(null)
  // ── 框选与挪动 ──
  let band = $state<{ a: Pt; b: Pt } | null>(null)
  let moving: { from: Pt; orig: Stroke[] } | null = null
  // ── 拖字宽 ──
  let draggingAdvance = false

  function bboxOf(ids: number[]): { x0: number; y0: number; x1: number; y1: number } | null {
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null
    for (const i of ids) {
      const s = strokes[i]
      if (!s) continue
      const r = s.width / 2
      for (const [x, y] of s.points) {
        if (!box) box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r }
        else {
          box.x0 = Math.min(box.x0, x - r)
          box.y0 = Math.min(box.y0, y - r)
          box.x1 = Math.max(box.x1, x + r)
          box.y1 = Math.max(box.y1, y + r)
        }
      }
    }
    return box
  }
  const selBox = $derived(bboxOf(selected))
  const inBox = (p: Pt, b: { x0: number; y0: number; x1: number; y1: number } | null): boolean =>
    !!b && p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1

  /** 点到线段的距离 */
  function segDist(p: Pt, a: Pt, b: Pt): number {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const u = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    return Math.hypot(p[0] - (a[0] + u * dx), p[1] - (a[1] + u * dy))
  }
  function hitStroke(p: Pt): number {
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i]
      const tol = s.width / 2 + 14
      if (s.points.length === 1 && Math.hypot(p[0] - s.points[0][0], p[1] - s.points[0][1]) <= tol)
        return i
      for (let j = 0; j + 1 < s.points.length; j++)
        if (segDist(p, s.points[j], s.points[j + 1]) <= tol) return i
    }
    return -1
  }

  function down(e: PointerEvent): void {
    if (e.button !== 0) return
    const p = toFont(e)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (tool === 'pen') {
      current = { width, points: [p] }
    } else if (tool === 'erase') {
      const i = hitStroke(p)
      if (i >= 0) {
        remember()
        strokes = strokes.filter((_, k) => k !== i)
      }
    } else if (selected.length && inBox(p, selBox)) {
      remember()
      moving = { from: p, orig: clone(strokes) }
    } else {
      band = { a: p, b: p }
      selected = []
    }
  }
  function move(e: PointerEvent): void {
    const p = toFont(e)
    if (draggingAdvance) {
      advance = Math.max(100, Math.min(3000, Math.round(p[0] / 10) * 10))
      return
    }
    if (current) {
      const last = current.points[current.points.length - 1]
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 4) current.points = [...current.points, p]
    } else if (band) {
      band = { a: band.a, b: p }
    } else if (moving) {
      const dx = p[0] - moving.from[0]
      const dy = p[1] - moving.from[1]
      const orig = moving.orig
      strokes = strokes.map((s, i) =>
        selected.includes(i)
          ? { width: s.width, points: orig[i].points.map((q) => [q[0] + dx, q[1] + dy] as Pt) }
          : s
      )
    } else if (tool === 'erase' && e.buttons & 1) {
      const i = hitStroke(p)
      if (i >= 0) {
        remember()
        strokes = strokes.filter((_, k) => k !== i)
      }
    }
  }
  function up(): void {
    if (draggingAdvance) {
      draggingAdvance = false
      return
    }
    if (current) {
      remember()
      strokes = [...strokes, { width: current.width, points: simplify(current.points, 2) }]
      current = null
    } else if (band) {
      const x0 = Math.min(band.a[0], band.b[0])
      const x1 = Math.max(band.a[0], band.b[0])
      const y0 = Math.min(band.a[1], band.b[1])
      const y1 = Math.max(band.a[1], band.b[1])
      // 笔画真正经过框里才算框住（只看外接矩形的话，框一小段横也会把整个大斜笔选上）
      const inside = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1
      const crosses = (s: Stroke): boolean => {
        if (s.points.length === 1) return inside(s.points[0][0], s.points[0][1])
        for (let j = 0; j + 1 < s.points.length; j++) {
          const [ax, ay] = s.points[j]
          const [bx, by] = s.points[j + 1]
          const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 8))
          for (let k = 0; k <= n; k++)
            if (inside(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n)) return true
        }
        return false
      }
      selected = strokes.map((s, i) => (crosses(s) ? i : -1)).filter((i) => i >= 0)
      band = null
    } else if (moving) {
      moving = null
    }
  }
  function onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
      e.preventDefault()
      e.stopImmediatePropagation()
      remember()
      strokes = strokes.filter((_, i) => !selected.includes(i))
      selected = []
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      e.stopImmediatePropagation()
      undo()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopImmediatePropagation()
      oncancel()
    }
  }
  // 键盘在捕获阶段先接：Ctrl+Z 撤销的是画板里的笔画，不能让它漏到整个项目的撤销上
  onMount(() => {
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  function save(): void {
    onsave({
      advance: Math.round(advance),
      strokes: strokes
        .filter((s) => s.points.length)
        .map((s) => ({ width: s.width, points: s.points }))
    })
  }

  const pts = (s: Stroke): string => s.points.map((p) => `${p[0]},${-p[1]}`).join(' ')
  const top = GUIDES.ascender + MARGIN
  const viewBox = $derived(
    `${-MARGIN} ${-top} ${advance + MARGIN * 2} ${GUIDES.ascender - GUIDES.descender + MARGIN * 2}`
  )
  const guideLines = [
    { y: GUIDES.ascender, key: 'ascender' },
    { y: GUIDES.capHeight, key: 'capHeight' },
    { y: GUIDES.xHeight, key: 'xHeight' },
    { y: GUIDES.baseline, key: 'baseline' },
    { y: GUIDES.descender, key: 'descender' }
  ]
</script>

<div class="backdrop" role="presentation" onclick={oncancel}></div>
<div class="pad card" role="dialog" aria-modal="true" aria-label={title}>
  <div class="row head">
    <strong class="grow">{title}</strong>
    <div class="seg">
      <button class:active={tool === 'pen'} title={t('glyphPad.pen')} onclick={() => (tool = 'pen')}
        ><PenLine size={14} />{t('glyphPad.pen')}</button
      >
      <button
        class:active={tool === 'select'}
        title={t('glyphPad.selectHint')}
        onclick={() => (tool = 'select')}><BoxSelect size={14} />{t('glyphPad.select')}</button
      >
      <button
        class:active={tool === 'erase'}
        title={t('glyphPad.eraseHint')}
        onclick={() => (tool = 'erase')}><Eraser size={14} />{t('glyphPad.erase')}</button
      >
    </div>
  </div>
  <div class="row tools">
    <label class="row small"
      >{t('glyphPad.width')}
      <input type="range" min="10" max="220" step="5" bind:value={width} />
      <span class="num">{width}</span></label
    >
    <label class="row small"
      >{t('glyphPad.advance')}
      <input
        class="input sm num-in"
        type="number"
        min="100"
        max="3000"
        step="10"
        bind:value={advance}
      /></label
    >
    <span class="grow"></span>
    <button class="btn ghost sm" title={t('glyphPad.undo')} onclick={undo}
      ><Undo2 size={14} /></button
    >
    <button class="btn ghost sm" title={t('glyphPad.clear')} onclick={clearAll}
      ><Trash2 size={14} /></button
    >
  </div>
  <svg
    bind:this={svg}
    class="canvas"
    class:pen={tool === 'pen'}
    class:erase={tool === 'erase'}
    {viewBox}
    role="img"
    aria-label={title}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <!-- 字身框、参考线 -->
    <rect
      class="body"
      x="0"
      y={-GUIDES.ascender}
      width={advance}
      height={GUIDES.ascender - GUIDES.descender}
    />
    {#each guideLines as g (g.key)}
      <line
        class="guide"
        class:base={g.key === 'baseline'}
        x1={-MARGIN}
        x2={advance + MARGIN}
        y1={-g.y}
        y2={-g.y}
      />
      <text class="guide-label" x={-MARGIN + 8} y={-g.y - 8}>{t(`glyphPad.guides.${g.key}`)}</text>
    {/each}
    <line class="side" x1="0" x2="0" y1={-top} y2={-GUIDES.descender + MARGIN} />
    <line class="side" x1={advance} x2={advance} y1={-top} y2={-GUIDES.descender + MARGIN} />
    <circle
      class="adv-handle"
      role="presentation"
      cx={advance}
      cy={-GUIDES.descender + MARGIN / 2}
      r="22"
      onpointerdown={(e) => {
        e.stopPropagation()
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        draggingAdvance = true
      }}
    />
    <!-- 笔画 -->
    {#each strokes as s, i (i)}
      {#if s.points.length === 1}
        <circle
          class="ink"
          class:sel={selected.includes(i)}
          cx={s.points[0][0]}
          cy={-s.points[0][1]}
          r={s.width / 2}
        />
      {:else}
        <polyline
          class="stroke"
          class:sel={selected.includes(i)}
          points={pts(s)}
          stroke-width={s.width}
        />
      {/if}
    {/each}
    {#if current}
      {#if current.points.length === 1}
        <circle
          class="ink"
          cx={current.points[0][0]}
          cy={-current.points[0][1]}
          r={current.width / 2}
        />
      {:else}
        <polyline class="stroke" points={pts(current)} stroke-width={current.width} />
      {/if}
    {/if}
    {#if selBox && tool === 'select'}
      <rect
        class="sel-box"
        x={selBox.x0}
        y={-selBox.y1}
        width={selBox.x1 - selBox.x0}
        height={selBox.y1 - selBox.y0}
      />
    {/if}
    {#if band}
      <rect
        class="band"
        x={Math.min(band.a[0], band.b[0])}
        y={-Math.max(band.a[1], band.b[1])}
        width={Math.abs(band.b[0] - band.a[0])}
        height={Math.abs(band.b[1] - band.a[1])}
      />
    {/if}
  </svg>
  <p class="small muted hint">{t('glyphPad.hint')}</p>
  <div class="row foot">
    <span class="grow"></span>
    <button class="btn sm" onclick={oncancel}>{t('common.cancel')}</button>
    <button class="btn sm primary" onclick={save}>{t('glyphPad.save')}</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 30%);
    z-index: 400;
  }
  .pad {
    position: fixed;
    z-index: 401;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(640px, 94vw);
    max-height: 94vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    box-shadow: var(--shadow-lg);
  }
  .head,
  .tools {
    gap: 10px;
    flex-wrap: wrap;
  }
  .tools label {
    gap: 6px;
  }
  .num {
    width: 3ch;
    text-align: right;
  }
  .num-in {
    width: 80px;
  }
  .canvas {
    width: 100%;
    height: min(62vh, 560px);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    touch-action: none;
    cursor: default;
  }
  .canvas.pen {
    cursor: crosshair;
  }
  .canvas.erase {
    cursor: cell;
  }
  .body {
    fill: var(--bg-sunken);
    stroke: none;
  }
  .guide {
    stroke: var(--border-strong);
    stroke-width: 3;
    stroke-dasharray: 16 12;
  }
  .guide.base {
    stroke: var(--accent);
    stroke-width: 5;
    stroke-dasharray: none;
  }
  .guide-label {
    fill: var(--text-3);
    font-size: 34px;
    font-family: var(--font-ui);
    user-select: none;
    pointer-events: none;
  }
  .side {
    stroke: var(--border-strong);
    stroke-width: 3;
  }
  .adv-handle {
    fill: var(--accent);
    cursor: ew-resize;
  }
  .stroke {
    fill: none;
    stroke: var(--text);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .ink {
    fill: var(--text);
  }
  .stroke.sel {
    stroke: var(--accent-text);
  }
  .ink.sel {
    fill: var(--accent-text);
  }
  .sel-box,
  .band {
    fill: color-mix(in srgb, var(--accent) 8%, transparent);
    stroke: var(--accent);
    stroke-width: 4;
    stroke-dasharray: 14 10;
  }
  .hint {
    margin: 0;
  }
  .foot {
    gap: 6px;
  }
</style>
