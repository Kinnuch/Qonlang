<script lang="ts">
  /**
   * 手写板：现场画一个字，或者改内嵌字体里的字。画布是字体单位（一个 em = 1000），画着上伸线、大写高、x 高、基线、下伸线，
   * 左右两条竖线是字的起点和字宽（右边那条下面的小圆点可以拖）。
   * 字由两样东西组成：笔画（点列 + 粗细）和轮廓（填实的闭合路径，从字体载入或用形状工具拉出来的）。
   * 画笔带拉绳式防抖；形状拉矩形 / 椭圆 / 正多边形 / 直线；选择点选框选、拖着挪、拖角缩放；
   * 节点工具拖轮廓和笔画上的点；橡皮点到哪个删哪个。选中的（没选就是整个字）可以改宽高、翻转、反向、勾线、加粗、复制。
   */
  import { onMount, untrack } from 'svelte'
  import { rangeFill } from '$lib/ui/rangeFill'
  import type { GlyphDrawing } from '$lib/core/model'
  import { GUIDES } from '$lib/script/drawnFont'
  import { drawingFromFont } from '$lib/script/fontBuild'
  import {
    contourOutline,
    contourSvg,
    createStabilizer,
    ellipseContour,
    finishStroke,
    flattenContour,
    mapStroke,
    pointInPolygon,
    polyBox,
    polygonContour,
    polygonEdgeDist,
    rectContour,
    reverseContour,
    roundContour,
    scaleAbout,
    signedArea,
    strokeBox,
    strokeDist,
    transformContour,
    translate,
    unionBox,
    type Box,
    type GlyphContour,
    type PathCmd,
    type PointMap,
    type Pt
  } from '$lib/script/glyphGeometry'
  import { t } from '$lib/i18n/index.svelte'
  import {
    PenLine,
    Shapes,
    MousePointer2,
    Spline,
    Eraser,
    Undo2,
    Redo2,
    Trash2,
    Square,
    Circle,
    Hexagon,
    Slash,
    FlipHorizontal2,
    FlipVertical2,
    Repeat2,
    SquareDashed,
    Bold,
    Copy,
    Link2,
    Link2Off,
    Scan,
    FileDown
  } from '@lucide/svelte'

  interface Stroke {
    points: Pt[]
    width: number
  }
  interface Snap {
    strokes: Stroke[]
    contours: GlyphContour[]
    advance: number
  }
  /** 一组对象：笔画下标、轮廓下标 */
  interface Idx {
    s: number[]
    c: number[]
  }
  type Tool = 'pen' | 'shape' | 'select' | 'node' | 'erase'
  type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'line'
  /** 节点：轮廓第 cmd 条命令的第 slot 个点（0 终点、1 第一个控制点、2 第二个控制点），或笔画的第 pt 个点 */
  type NodeRef =
    { kind: 'c'; i: number; cmd: number; slot: number } | { kind: 's'; i: number; pt: number }

  let {
    drawing,
    title,
    fontData = null,
    char = '',
    onsave,
    oncancel
  }: {
    drawing: GlyphDrawing | undefined
    title: string
    /** 这套文字内嵌字体的数据：有它才能「从字体载入」 */
    fontData?: ArrayBuffer | null
    /** 这个字形的字符，从字体里按它找字 */
    char?: string
    onsave: (d: GlyphDrawing) => void
    oncancel: () => void
  } = $props()

  const MARGIN = 160
  const STAB_KEY = 'qianyuji.glyphPad.stabilizer'
  /** 打开时的样子：画板里改的是一份拷贝，点「保存」才写回字形 */
  const initial = untrack(() => drawing)
  let strokes = $state<Stroke[]>(
    (initial?.strokes ?? []).map((s) => ({
      width: s.width,
      points: s.points.map((p) => [p[0], p[1]] as Pt)
    }))
  )
  let contours = $state<GlyphContour[]>(
    (initial?.contours ?? []).map((c) => ({ cmds: c.cmds.map((x) => [...x] as PathCmd) }))
  )
  let advance = $state(initial?.advance ?? 1000)
  let width = $state(initial?.strokes.at(-1)?.width ?? 60)
  let tool = $state<Tool>('pen')
  let shapeKind = $state<ShapeKind>('rect')
  let sides = $state(6)
  let boldAmount = $state(30)
  let lockRatio = $state(true)
  let strength = $state(readStrength())
  let msg = $state('')

  function readStrength(): number {
    try {
      const raw = localStorage.getItem(STAB_KEY)
      const v = Number(raw)
      if (raw !== null && v >= 0 && v <= 10) return v
    } catch {
      /* 读不了就用默认 */
    }
    return 5
  }
  $effect(() => {
    const v = strength
    try {
      localStorage.setItem(STAB_KEY, String(v))
    } catch {
      /* 存不了就算了 */
    }
  })

  // ───── 撤销 / 重做 ─────
  let history: Snap[] = []
  let future: Snap[] = []
  const snap = (): Snap => ({
    strokes: $state.snapshot(strokes) as Stroke[],
    contours: $state.snapshot(contours) as GlyphContour[],
    advance
  })
  function pushHistory(s: Snap): void {
    history.push(s)
    if (history.length > 200) history.shift()
    future = []
  }
  function remember(): void {
    pushHistory(snap())
  }
  /** 拖动类操作：按下时记下原样，真的改了才进撤销栈 */
  let pending: Snap | null = null
  function changed(): void {
    if (pending) {
      pushHistory(pending)
      pending = null
    }
  }
  function clearSelection(): void {
    selS = []
    selC = []
    nodeTarget = null
    selNode = null
  }
  function restore(s: Snap): void {
    strokes = s.strokes
    contours = s.contours
    advance = s.advance
    clearSelection()
  }
  function undo(): void {
    const prev = history.pop()
    if (!prev) return
    future.push(snap())
    restore(prev)
  }
  function redo(): void {
    const next = future.pop()
    if (!next) return
    history.push(snap())
    restore(next)
  }
  function clearAll(): void {
    if (!strokes.length && !contours.length) return
    remember()
    strokes = []
    contours = []
    clearSelection()
  }

  // ───── 从字体载入 ─────
  const canLoad = $derived(!!fontData && [...char].length === 1)
  /** 把内嵌字体里这个字换进来；auto 是打开时自动载入（不进撤销、字体里没有也不提示） */
  function loadFromFont(auto = false): void {
    if (!fontData) return
    try {
      const d = drawingFromFont(fontData, char)
      if (!d) {
        if (!auto) msg = t('glyphPad.fontNoChar')
        return
      }
      if (!auto) remember()
      strokes = []
      contours = d.contours ?? []
      advance = d.advance
      clearSelection()
      msg = auto ? t('glyphPad.fontLoadedAuto') : ''
    } catch (e) {
      msg = t('glyphPad.fontError', { err: e instanceof Error ? e.message : String(e) })
    }
  }

  // ───── 视图：缩放、平移 ─────
  let svg = $state<SVGSVGElement | null>(null)
  let zoom = $state(1)
  /** 视图中心（SVG 坐标，y 向下）；null 是默认居中 */
  let center = $state<Pt | null>(null)
  const top = GUIDES.ascender + MARGIN
  const baseW = $derived(advance + MARGIN * 2)
  const baseH = GUIDES.ascender - GUIDES.descender + MARGIN * 2
  const viewCenter = $derived<Pt>(center ?? [-MARGIN + baseW / 2, -top + baseH / 2])
  const viewBox = $derived(
    `${viewCenter[0] - baseW / zoom / 2} ${viewCenter[1] - baseH / zoom / 2} ${baseW / zoom} ${baseH / zoom}`
  )
  /** 一个屏幕像素合多少字体单位（手柄大小、命中范围、防抖绳长都按它算） */
  let upp = $state(1.4)
  function measure(): void {
    const m = svg?.getScreenCTM()
    if (m && m.a) upp = 1 / m.a
  }
  $effect(() => {
    void viewBox
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  })
  /** 屏幕坐标 → SVG 坐标（y 向下） */
  function svgPoint(x: number, y: number): Pt {
    const m = svg?.getScreenCTM()
    if (!m) return [0, 0]
    const p = new DOMPoint(x, y).matrixTransform(m.inverse())
    return [p.x, p.y]
  }
  /** 屏幕坐标 → 字体坐标（y 向上，保留一位小数） */
  function toFont(e: { clientX: number; clientY: number }): Pt {
    const [x, y] = svgPoint(e.clientX, e.clientY)
    return [Math.round(x * 10) / 10, Math.round(-y * 10) / 10]
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault()
    const p = svgPoint(e.clientX, e.clientY)
    const next = Math.max(0.25, Math.min(12, zoom * Math.exp(-e.deltaY * 0.0015)))
    const k = zoom / next
    // 指针下的那一点缩放前后不动
    center = [p[0] + (viewCenter[0] - p[0]) * k, p[1] + (viewCenter[1] - p[1]) * k]
    zoom = next
  }
  function resetView(): void {
    zoom = 1
    center = null
  }

  // ───── 选择 ─────
  let selS = $state<number[]>([])
  let selC = $state<number[]>([])
  const hasSel = $derived(selS.length + selC.length > 0)
  /** 轮廓展平后的多边形：命中、框选、外框都用它 */
  const polys = $derived(contours.map((c) => flattenContour(c)))
  /** 操作对象：选了就是选中的，没选就是整个字 */
  const target = $derived<Idx>(
    hasSel ? { s: selS, c: selC } : { s: strokes.map((_, i) => i), c: contours.map((_, i) => i) }
  )
  const boxOf = (idx: Idx, withWidth = true): Box | null =>
    unionBox([
      ...idx.s.map((i) => (strokes[i] ? strokeBox(strokes[i], withWidth) : null)),
      ...idx.c.map((i) => (polys[i] ? polyBox(polys[i]) : null))
    ])
  const selBox = $derived(hasSel ? boxOf({ s: selS, c: selC }) : null)
  const targetBox = $derived(boxOf(target))
  const targetGeom = $derived(boxOf(target, false))
  const inBox = (p: Pt, b: Box | null): boolean =>
    !!b && p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1

  /** 点到了哪个对象：笔画在上面先看；轮廓先看贴着边的，再看包住这一点的里面最小的那个 */
  function hitItem(p: Pt): { kind: 's' | 'c'; i: number } | null {
    const tol = 12 * upp
    for (let i = strokes.length - 1; i >= 0; i--)
      if (strokeDist(p, strokes[i]) <= strokes[i].width / 2 + tol) return { kind: 's', i }
    let best = -1
    let bestDist = tol
    for (let i = polys.length - 1; i >= 0; i--) {
      const d = polygonEdgeDist(p, polys[i])
      if (d <= bestDist) {
        best = i
        bestDist = d
      }
    }
    if (best >= 0) return { kind: 'c', i: best }
    let bestArea = Infinity
    for (let i = polys.length - 1; i >= 0; i--) {
      if (!pointInPolygon(p, polys[i])) continue
      const a = Math.abs(signedArea(polys[i]))
      if (a < bestArea) {
        best = i
        bestArea = a
      }
    }
    return best >= 0 ? { kind: 'c', i: best } : null
  }

  /** 从 base 出发，把 idx 里的对象过一遍 f（翻转时轮廓绕向再反回来） */
  function mapped(base: Snap, idx: Idx, f: PointMap, mirrors = false): void {
    strokes = base.strokes.map((s, i) => (idx.s.includes(i) ? mapStroke(s, f) : s))
    contours = base.contours.map((c, i) =>
      idx.c.includes(i) ? transformContour(c, f, mirrors) : c
    )
  }

  // ───── 节点 ─────
  let nodeTarget = $state<{ kind: 's' | 'c'; i: number } | null>(null)
  let selNode = $state<NodeRef | null>(null)
  /** 命令里第 slot 个点的坐标在数组里的位置 */
  function slotAt(cmd: PathCmd, slot: number): [number, number] | null {
    if (cmd[0] === 'M' || cmd[0] === 'L') return slot === 0 ? [1, 2] : null
    if (cmd[0] === 'Q') return slot === 0 ? [3, 4] : slot === 1 ? [1, 2] : null
    if (cmd[0] === 'C')
      return slot === 0 ? [5, 6] : slot === 1 ? [1, 2] : slot === 2 ? [3, 4] : null
    return null
  }
  const num = (cmd: PathCmd, k: number): number => (cmd as (string | number)[])[k] as number
  interface NodeView {
    ref: NodeRef
    x: number
    y: number
    on: boolean
    /** 控制点连向的 on-curve 点 */
    links: Pt[]
  }
  const nodes = $derived.by<NodeView[]>(() => {
    const nt = nodeTarget
    if (tool !== 'node' || !nt) return []
    const out: NodeView[] = []
    if (nt.kind === 's') {
      const s = strokes[nt.i]
      if (!s) return []
      s.points.forEach((p, pt) =>
        out.push({ ref: { kind: 's', i: nt.i, pt }, x: p[0], y: p[1], on: true, links: [] })
      )
      return out
    }
    const c = contours[nt.i]
    if (!c) return []
    let prev: Pt = [0, 0]
    c.cmds.forEach((cmd, k) => {
      const ref = (slot: number): NodeRef => ({ kind: 'c', i: nt.i, cmd: k, slot })
      if (cmd[0] === 'M' || cmd[0] === 'L') {
        out.push({ ref: ref(0), x: cmd[1], y: cmd[2], on: true, links: [] })
        prev = [cmd[1], cmd[2]]
      } else if (cmd[0] === 'Q') {
        const end: Pt = [cmd[3], cmd[4]]
        out.push({ ref: ref(1), x: cmd[1], y: cmd[2], on: false, links: [prev, end] })
        out.push({ ref: ref(0), x: end[0], y: end[1], on: true, links: [] })
        prev = end
      } else if (cmd[0] === 'C') {
        const end: Pt = [cmd[5], cmd[6]]
        out.push({ ref: ref(1), x: cmd[1], y: cmd[2], on: false, links: [prev] })
        out.push({ ref: ref(2), x: cmd[3], y: cmd[4], on: false, links: [end] })
        out.push({ ref: ref(0), x: end[0], y: end[1], on: true, links: [] })
        prev = end
      }
    })
    return out
  })
  function sameRef(a: NodeRef | null, b: NodeRef): boolean {
    if (!a || a.kind !== b.kind || a.i !== b.i) return false
    if (a.kind === 's' && b.kind === 's') return a.pt === b.pt
    if (a.kind === 'c' && b.kind === 'c') return a.cmd === b.cmd && a.slot === b.slot
    return false
  }
  function hitNode(p: Pt): NodeRef | null {
    let best: NodeRef | null = null
    let bestDist = 9 * upp
    for (const n of nodes) {
      const d = Math.hypot(p[0] - n.x, p[1] - n.y)
      if (d <= bestDist) {
        best = n.ref
        bestDist = d
      }
    }
    return best
  }
  /**
   * 拖一个节点时跟着动的坐标：节点本身；拖的是三次曲线接头上的 on-curve 点，两边挨着它的控制点一起动；
   * 起点和闭合回来的末点重合时两个一起动。
   */
  function nodeMovers(base: Snap, ref: NodeRef): { cmd: number; at: [number, number] }[] {
    if (ref.kind !== 'c') return []
    const cmds = base.contours[ref.i]?.cmds
    if (!cmds?.[ref.cmd]) return []
    const at = slotAt(cmds[ref.cmd], ref.slot)
    if (!at) return []
    const out = [{ cmd: ref.cmd, at }]
    if (ref.slot !== 0) return out
    const ends = [ref.cmd]
    const x = num(cmds[ref.cmd], at[0])
    const y = num(cmds[ref.cmd], at[1])
    const lastDraw = cmds.findLastIndex((c) => c[0] !== 'Z')
    const lastAt = lastDraw > 0 ? slotAt(cmds[lastDraw], 0) : null
    if (ref.cmd === 0 && lastAt) {
      if (num(cmds[lastDraw], lastAt[0]) === x && num(cmds[lastDraw], lastAt[1]) === y) {
        out.push({ cmd: lastDraw, at: lastAt })
        ends.push(lastDraw)
      }
    } else if (ref.cmd === lastDraw && num(cmds[0], 1) === x && num(cmds[0], 2) === y) {
      out.push({ cmd: 0, at: [1, 2] })
      ends.push(0)
    }
    for (const e of ends) {
      if (cmds[e][0] === 'C') out.push({ cmd: e, at: [3, 4] })
      const next = cmds[e + 1]
      if (next && next[0] === 'C') out.push({ cmd: e + 1, at: [1, 2] })
    }
    return out
  }
  function dragNode(base: Snap, ref: NodeRef, dx: number, dy: number): void {
    if (ref.kind === 's') {
      strokes = base.strokes.map((s, i) =>
        i === ref.i
          ? {
              width: s.width,
              points: s.points.map((q, k) => (k === ref.pt ? ([q[0] + dx, q[1] + dy] as Pt) : q))
            }
          : s
      )
      return
    }
    const movers = nodeMovers(base, ref)
    contours = base.contours.map((c, i) => {
      if (i !== ref.i) return c
      const cmds = c.cmds.map((x) => [...x] as (string | number)[])
      for (const m of movers) {
        cmds[m.cmd][m.at[0]] = (cmds[m.cmd][m.at[0]] as number) + dx
        cmds[m.cmd][m.at[1]] = (cmds[m.cmd][m.at[1]] as number) + dy
      }
      return { cmds: cmds as PathCmd[] }
    })
  }
  /** 删掉选中的节点：on-curve 点整段去掉（轮廓至少留 3 个点），控制点去掉就把曲线降一级 */
  function deleteNode(ref: NodeRef): void {
    if (ref.kind === 's') {
      const s = strokes[ref.i]
      if (!s) return
      remember()
      if (s.points.length <= 1) {
        strokes = strokes.filter((_, i) => i !== ref.i)
        nodeTarget = null
      } else
        strokes = strokes.map((x, i) =>
          i === ref.i ? { width: x.width, points: x.points.filter((_, k) => k !== ref.pt) } : x
        )
      selNode = null
      return
    }
    const c = contours[ref.i]
    if (!c?.cmds[ref.cmd]) return
    const cmds = c.cmds.map((x) => [...x] as PathCmd)
    const cmd = cmds[ref.cmd]
    if (ref.slot === 0) {
      if (cmds.filter((x) => x[0] !== 'Z').length <= 3) return
      if (ref.cmd === 0) {
        // 删起点：下一段的终点当新起点
        const end = slotAt(cmds[1], 0)
        if (!end) return
        cmds[0] = ['M', num(cmds[1], end[0]), num(cmds[1], end[1])]
        cmds.splice(1, 1)
      } else cmds.splice(ref.cmd, 1)
    } else if (cmd[0] === 'Q') cmds[ref.cmd] = ['L', cmd[3], cmd[4]]
    else if (cmd[0] === 'C')
      cmds[ref.cmd] =
        ref.slot === 1
          ? ['Q', cmd[3], cmd[4], cmd[5], cmd[6]]
          : ['Q', cmd[1], cmd[2], cmd[5], cmd[6]]
    remember()
    contours = contours.map((x, i) => (i === ref.i ? { cmds } : x))
    selNode = null
  }

  // ───── 指针 ─────
  type Drag =
    | { kind: 'pen' }
    | { kind: 'shape'; a: Pt; b: Pt; shift: boolean }
    | { kind: 'band'; a: Pt; b: Pt; keep: Idx }
    | { kind: 'move'; from: Pt; base: Snap; idx: Idx }
    | { kind: 'scale'; base: Snap; idx: Idx; ink: Box; geom: Box }
    | { kind: 'node'; from: Pt; base: Snap; ref: NodeRef }
    | { kind: 'advance' }
    | { kind: 'pan'; from: Pt; center: Pt }
    | { kind: 'erase' }
  let drag = $state.raw<Drag | null>(null)

  // 画笔：正在画的这一笔、指针位置、笔尖位置、防抖器
  let current = $state<Stroke | null>(null)
  let pointer = $state<Pt>([0, 0])
  let ink = $state<Pt>([0, 0])
  let stab: ReturnType<typeof createStabilizer> | null = null
  /** 防抖绳长（画的时候显示那个圈） */
  let ropeRadius = $state(0)
  let raf = 0
  function feed(p: Pt): void {
    if (!stab || !current) return
    const q = stab.push(p)
    if (!q) return
    ink = [q[0], q[1]]
    const last = current.points[current.points.length - 1]
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) >= Math.max(0.8, upp * 0.8))
      current.points.push([q[0], q[1]])
  }
  // 指针停着不动时笔尖也要每帧往指针那边收
  function tick(): void {
    if (drag?.kind !== 'pen') return
    feed(pointer)
    raf = requestAnimationFrame(tick)
  }

  function eraseAt(p: Pt): void {
    const hit = hitItem(p)
    if (!hit) return
    remember()
    if (hit.kind === 's') strokes = strokes.filter((_, k) => k !== hit.i)
    else contours = contours.filter((_, k) => k !== hit.i)
    clearSelection()
  }

  function down(e: PointerEvent): void {
    measure()
    if (e.button === 1) {
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      drag = { kind: 'pan', from: [e.clientX, e.clientY], center: [...viewCenter] }
      return
    }
    if (e.button !== 0) return
    const p = toFont(e)
    msg = ''
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    if (tool === 'pen') {
      pointer = p
      ink = p
      stab = createStabilizer(strength, p, upp)
      ropeRadius = stab.radius
      current = { width, points: [p] }
      drag = { kind: 'pen' }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(tick)
    } else if (tool === 'shape') {
      drag = { kind: 'shape', a: p, b: p, shift: e.shiftKey }
    } else if (tool === 'erase') {
      drag = { kind: 'erase' }
      eraseAt(p)
    } else if (tool === 'node') {
      const n = hitNode(p)
      if (n) {
        selNode = n
        pending = snap()
        drag = { kind: 'node', from: p, base: snap(), ref: n }
        return
      }
      nodeTarget = hitItem(p)
      selNode = null
    } else {
      const hit = hitItem(p)
      if (hit) {
        const list = hit.kind === 's' ? selS : selC
        const on = list.includes(hit.i)
        if (e.shiftKey) {
          const next = on ? list.filter((x) => x !== hit.i) : [...list, hit.i]
          if (hit.kind === 's') selS = next
          else selC = next
        } else if (!on) {
          selS = hit.kind === 's' ? [hit.i] : []
          selC = hit.kind === 'c' ? [hit.i] : []
        }
      } else if (!(hasSel && inBox(p, selBox))) {
        drag = {
          kind: 'band',
          a: p,
          b: p,
          keep: e.shiftKey ? { s: [...selS], c: [...selC] } : { s: [], c: [] }
        }
        if (!e.shiftKey) {
          selS = []
          selC = []
        }
        return
      }
      if (!hasSel) return
      pending = snap()
      drag = { kind: 'move', from: p, base: snap(), idx: { s: [...selS], c: [...selC] } }
    }
  }
  function startScale(e: PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0 || !selBox) return
    const geom = boxOf({ s: selS, c: selC }, false)
    if (!geom) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pending = snap()
    drag = {
      kind: 'scale',
      base: snap(),
      idx: { s: [...selS], c: [...selC] },
      ink: { ...selBox },
      geom
    }
  }
  function startAdvance(e: PointerEvent): void {
    e.stopPropagation()
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pending = snap()
    drag = { kind: 'advance' }
  }

  function move(e: PointerEvent): void {
    const d = drag
    if (!d) return
    if (d.kind === 'pan') {
      center = [
        d.center[0] - (e.clientX - d.from[0]) * upp,
        d.center[1] - (e.clientY - d.from[1]) * upp
      ]
      return
    }
    const p = toFont(e)
    if (d.kind === 'pen') {
      // 回报率高的笔一帧里有好几个点，一个个喂给防抖器
      const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      for (const ev of evs.length ? evs : [e]) {
        pointer = toFont(ev)
        feed(pointer)
      }
    } else if (d.kind === 'advance') {
      const next = Math.max(100, Math.min(3000, Math.round(p[0] / 10) * 10))
      if (next !== advance) {
        changed()
        advance = next
      }
    } else if (d.kind === 'shape') {
      drag = { ...d, b: p, shift: e.shiftKey }
    } else if (d.kind === 'band') {
      drag = { ...d, b: p }
    } else if (d.kind === 'move') {
      const dx = p[0] - d.from[0]
      const dy = p[1] - d.from[1]
      if (!dx && !dy) return
      changed()
      mapped(d.base, d.idx, translate(dx, dy))
    } else if (d.kind === 'scale') {
      const gw = d.geom.x1 - d.geom.x0
      const gh = d.geom.y1 - d.geom.y0
      // 右上角拖到 p：左下角不动，笔画粗细不跟着缩（外框比几何框多出来的那圈是笔画粗细）
      let sx = gw > 0 ? Math.max(0.02, (p[0] - d.ink.x0 - (d.ink.x1 - d.ink.x0 - gw)) / gw) : 1
      let sy = gh > 0 ? Math.max(0.02, (p[1] - d.ink.y0 - (d.ink.y1 - d.ink.y0 - gh)) / gh) : 1
      if (e.shiftKey) {
        const k = gw <= 0 ? sy : gh <= 0 ? sx : Math.max(sx, sy)
        sx = gw > 0 ? k : 1
        sy = gh > 0 ? k : 1
      }
      changed()
      mapped(d.base, d.idx, scaleAbout(d.geom.x0, d.geom.y0, sx, sy))
    } else if (d.kind === 'node') {
      const dx = p[0] - d.from[0]
      const dy = p[1] - d.from[1]
      if (!dx && !dy) return
      changed()
      dragNode(d.base, d.ref, dx, dy)
    } else if (d.kind === 'erase' && e.buttons & 1) {
      eraseAt(p)
    }
  }

  /** 形状工具拉出来的东西：矩形、椭圆、多边形是轮廓，直线是一笔 */
  function shapeOf(
    a: Pt,
    b: Pt,
    shift: boolean
  ): { contour?: GlyphContour; stroke?: Stroke } | null {
    const r = (v: number): number => Math.round(v * 10) / 10
    let dx = b[0] - a[0]
    let dy = b[1] - a[1]
    if (shapeKind === 'line') {
      if (shift) {
        const len = Math.hypot(dx, dy)
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
        dx = len * Math.cos(ang)
        dy = len * Math.sin(ang)
      }
      if (Math.hypot(dx, dy) < 4) return null
      return { stroke: { width, points: [a, [r(a[0] + dx), r(a[1] + dy)]] } }
    }
    if (shift) {
      const s = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * s
      dy = Math.sign(dy || 1) * s
    }
    if (Math.abs(dx) < 4 || Math.abs(dy) < 4) return null
    const x0 = Math.min(a[0], a[0] + dx)
    const y0 = Math.min(a[1], a[1] + dy)
    const w = Math.abs(dx)
    const h = Math.abs(dy)
    const c =
      shapeKind === 'rect'
        ? rectContour(x0, y0, x0 + w, y0 + h)
        : shapeKind === 'ellipse'
          ? ellipseContour(x0 + w / 2, y0 + h / 2, w / 2, h / 2)
          : polygonContour(x0 + w / 2, y0 + h / 2, w / 2, h / 2, sides)
    return { contour: roundContour(c) }
  }
  const shapePreview = $derived(drag?.kind === 'shape' ? shapeOf(drag.a, drag.b, drag.shift) : null)

  function up(): void {
    const d = drag
    drag = null
    pending = null
    if (!d) return
    if (d.kind === 'pen' && current && stab) {
      cancelAnimationFrame(raf)
      // 抬笔：笔尖收绳追到指针，再平滑、抽稀
      for (const q of stab.finish(pointer)) current.points.push(q)
      let done = finishStroke($state.snapshot(current.points) as Pt[], strength)
      const [x0, y0] = done[0]
      if (done.every((q) => Math.hypot(q[0] - x0, q[1] - y0) < 1)) done = [done[0]]
      remember()
      strokes = [...strokes, { width: current.width, points: done }]
      current = null
      stab = null
    } else if (d.kind === 'shape') {
      const sh = shapeOf(d.a, d.b, d.shift)
      if (!sh) return
      remember()
      if (sh.contour) contours = [...contours, sh.contour]
      if (sh.stroke) strokes = [...strokes, sh.stroke]
    } else if (d.kind === 'band') {
      const x0 = Math.min(d.a[0], d.b[0])
      const x1 = Math.max(d.a[0], d.b[0])
      const y0 = Math.min(d.a[1], d.b[1])
      const y1 = Math.max(d.a[1], d.b[1])
      // 笔画真正经过框里才算框住（只看外接矩形的话，框一小段横也会把整个大斜笔选上）；轮廓有点落在框里就算
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
      const s = strokes.map((st, i) => (crosses(st) ? i : -1)).filter((i) => i >= 0)
      const c = polys
        .map((poly, i) => (poly.some((q) => inside(q[0], q[1])) ? i : -1))
        .filter((i) => i >= 0)
      selS = [...new Set([...d.keep.s, ...s])]
      selC = [...new Set([...d.keep.c, ...c])]
    }
  }

  // ───── 对选中的（没选就是整个字）的操作 ─────
  /** 改宽或高：左下角不动；笔画粗细不跟着缩，所以按几何框算比例 */
  function setSize(axis: 'w' | 'h', value: number): void {
    const inkBox = targetBox
    const geom = targetGeom
    if (!inkBox || !geom || !(value > 0)) return
    const inkSize = axis === 'w' ? inkBox.x1 - inkBox.x0 : inkBox.y1 - inkBox.y0
    const geomSize = axis === 'w' ? geom.x1 - geom.x0 : geom.y1 - geom.y0
    const pad = inkSize - geomSize
    if (geomSize <= 0 || value <= pad) return
    const k = (value - pad) / geomSize
    const otherSize = axis === 'w' ? geom.y1 - geom.y0 : geom.x1 - geom.x0
    const both = lockRatio && otherSize > 0
    remember()
    mapped(
      snap(),
      target,
      scaleAbout(geom.x0, geom.y0, axis === 'w' || both ? k : 1, axis === 'h' || both ? k : 1)
    )
  }
  function flip(horizontal: boolean): void {
    const g = targetGeom
    if (!g) return
    remember()
    mapped(
      snap(),
      target,
      scaleAbout((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, horizontal ? -1 : 1, horizontal ? 1 : -1),
      true
    )
  }
  function reverseDir(): void {
    const idx = target
    if (!idx.s.length && !idx.c.length) return
    remember()
    strokes = strokes.map((s, i) =>
      idx.s.includes(i) ? { width: s.width, points: [...s.points].reverse() } : s
    )
    contours = contours.map((c, i) => (idx.c.includes(i) ? reverseContour(c) : c))
  }
  /** 勾线：轮廓换成沿边一圈的笔画（画笔的粗细），字变成空心的 */
  function outline(): void {
    const idx = target
    if (!idx.c.length) return
    const wasSel = hasSel
    remember()
    const added = idx.c
      .map((i) => contourOutline(contours[i]))
      .filter((line) => line.length > 1)
      .map((points) => ({ width, points }))
    const base = strokes.length
    strokes = [...strokes, ...added]
    contours = contours.filter((_, i) => !idx.c.includes(i))
    clearSelection()
    if (wasSel) selS = added.map((_, k) => base + k)
  }
  /** 一键加粗：每边加粗 boldAmount。笔画直接加粗细；轮廓沿边描一圈两倍粗的笔画，外边往外长、洞往里缩 */
  function bold(): void {
    const idx = target
    const a = Math.max(1, Number(boldAmount) || 0)
    if (!idx.s.length && !idx.c.length) return
    const wasSel = hasSel
    remember()
    const grown = strokes.map((s, i) =>
      idx.s.includes(i) ? { width: s.width + a * 2, points: s.points } : s
    )
    const added = idx.c
      .map((i) => contourOutline(contours[i]))
      .filter((line) => line.length > 1)
      .map((points) => ({ width: a * 2, points }))
    strokes = [...grown, ...added]
    if (wasSel) selS = [...selS, ...added.map((_, k) => grown.length + k)]
  }
  function duplicate(): void {
    if (!hasSel) return
    remember()
    const f = translate(40, -40)
    const ns = selS.map((i) => mapStroke(strokes[i], f))
    const nc = selC.map((i) => transformContour(contours[i], f, false))
    const s0 = strokes.length
    const c0 = contours.length
    strokes = [...strokes, ...ns]
    contours = [...contours, ...nc]
    selS = ns.map((_, k) => s0 + k)
    selC = nc.map((_, k) => c0 + k)
  }
  function deleteSel(): void {
    if (!hasSel) return
    remember()
    strokes = strokes.filter((_, i) => !selS.includes(i))
    contours = contours.filter((_, i) => !selC.includes(i))
    clearSelection()
  }
  function nudge(dx: number, dy: number): void {
    remember()
    mapped(snap(), { s: selS, c: selC }, translate(dx, dy))
  }

  function onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'))
      return
    const stop = (): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (e.key === 'Delete' || e.key === 'Backspace') {
      stop()
      if (tool === 'node' && selNode) deleteNode(selNode)
      else deleteSel()
    } else if (mod && key === 'z') {
      stop()
      if (e.shiftKey) redo()
      else undo()
    } else if (mod && key === 'y') {
      stop()
      redo()
    } else if (mod && key === 'a') {
      stop()
      tool = 'select'
      selS = strokes.map((_, i) => i)
      selC = contours.map((_, i) => i)
    } else if (e.key.startsWith('Arrow') && hasSel) {
      stop()
      const step = e.shiftKey ? 50 : 10
      nudge(
        e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0
      )
    } else if (e.key === 'Escape') {
      stop()
      if (selNode || nodeTarget || hasSel) clearSelection()
      else oncancel()
    }
  }
  // 键盘在捕获阶段先接：Ctrl+Z 撤销的是画板里的东西，不能让它漏到整个项目的撤销上
  onMount(() => {
    window.addEventListener('keydown', onKey, true)
    // 还没画过、内嵌字体里有这个字：打开就把字体里的样子载进来
    if (!initial && canLoad) loadFromFont(true)
    measure()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      cancelAnimationFrame(raf)
    }
  })
  function save(): void {
    const r = (v: number): number => Math.round(v * 10) / 10
    const out: GlyphDrawing = {
      advance: Math.round(advance),
      strokes: strokes
        .filter((s) => s.points.length)
        .map((s) => ({
          width: r(s.width),
          points: s.points.map((p) => [r(p[0]), r(p[1])] as Pt)
        }))
    }
    const cs = ($state.snapshot(contours) as GlyphContour[])
      .filter((c) => c.cmds.length > 2)
      .map((c) => roundContour(c))
    if (cs.length) out.contours = cs
    onsave(out)
  }

  const pts = (s: Stroke): string => s.points.map((p) => `${p[0]},${-p[1]}`).join(' ')
  const allContours = $derived(contours.map(contourSvg).join(''))
  const guideLines = [
    { y: GUIDES.ascender, key: 'ascender' },
    { y: GUIDES.capHeight, key: 'capHeight' },
    { y: GUIDES.xHeight, key: 'xHeight' },
    { y: GUIDES.baseline, key: 'baseline' },
    { y: GUIDES.descender, key: 'descender' }
  ]
  const TOOLS: { id: Tool; icon: typeof PenLine }[] = [
    { id: 'pen', icon: PenLine },
    { id: 'shape', icon: Shapes },
    { id: 'select', icon: MousePointer2 },
    { id: 'node', icon: Spline },
    { id: 'erase', icon: Eraser }
  ]
  const SHAPES: { id: ShapeKind; icon: typeof PenLine }[] = [
    { id: 'rect', icon: Square },
    { id: 'ellipse', icon: Circle },
    { id: 'polygon', icon: Hexagon },
    { id: 'line', icon: Slash }
  ]
  const boxW = $derived(targetBox ? Math.round(targetBox.x1 - targetBox.x0) : 0)
  const boxH = $derived(targetBox ? Math.round(targetBox.y1 - targetBox.y0) : 0)
  const empty = $derived(!strokes.length && !contours.length)
  /** 手柄半边长（屏幕上约 7 像素） */
  const hs = $derived(7 * upp)
</script>

<div class="backdrop" role="presentation" onclick={oncancel}></div>
<div class="pad card" role="dialog" aria-modal="true" aria-label={title}>
  <div class="row head">
    <strong class="grow">{title}</strong>
    {#if canLoad}
      <button class="btn sm" title={t('glyphPad.loadFontHint')} onclick={() => loadFromFont()}
        ><FileDown size={14} />{t('glyphPad.loadFont')}</button
      >
    {/if}
    <div class="seg">
      {#each TOOLS as tl (tl.id)}
        <button
          class:active={tool === tl.id}
          title={t(`glyphPad.${tl.id}Hint`)}
          onclick={() => {
            tool = tl.id
            selNode = null
          }}><tl.icon size={14} />{t(`glyphPad.${tl.id}`)}</button
        >
      {/each}
    </div>
  </div>
  <div class="row tools">
    {#if tool === 'shape'}
      <div class="seg">
        {#each SHAPES as sh (sh.id)}
          <button
            class:active={shapeKind === sh.id}
            title={t(`glyphPad.shapes.${sh.id}`)}
            onclick={() => (shapeKind = sh.id)}><sh.icon size={14} /></button
          >
        {/each}
      </div>
      {#if shapeKind === 'polygon'}
        <label class="row small"
          >{t('glyphPad.sides')}
          <input
            class="input sm num-in short"
            type="number"
            min="3"
            max="64"
            bind:value={sides}
          /></label
        >
      {/if}
    {/if}
    <label class="row small" title={t('glyphPad.widthHint')}
      >{t('glyphPad.width')}
      <input type="range" min="10" max="220" step="5" bind:value={width} use:rangeFill={width} />
      <span class="num">{width}</span></label
    >
    {#if tool === 'pen'}
      <label class="row small" title={t('glyphPad.stabilizerHint')}
        >{t('glyphPad.stabilizer')}
        <input
          type="range"
          min="0"
          max="10"
          step="1"
          bind:value={strength}
          use:rangeFill={strength}
        />
        <span class="num">{strength}</span></label
      >
    {/if}
    <label class="row small"
      >{t('glyphPad.advance')}
      <input
        class="input sm num-in"
        type="number"
        min="100"
        max="3000"
        step="10"
        value={advance}
        onchange={(e) => {
          const v = Math.round(Number((e.currentTarget as HTMLInputElement).value))
          if (v >= 1 && v !== advance) {
            remember()
            advance = Math.min(3000, v)
          }
        }}
      /></label
    >
    <span class="grow"></span>
    <button
      class="btn ghost sm"
      title={t('glyphPad.zoomReset')}
      disabled={zoom === 1 && !center}
      onclick={resetView}><Scan size={14} />{Math.round(zoom * 100)}%</button
    >
    <button class="btn ghost sm" title={t('glyphPad.undo')} onclick={undo}
      ><Undo2 size={14} /></button
    >
    <button class="btn ghost sm" title={t('glyphPad.redo')} onclick={redo}
      ><Redo2 size={14} /></button
    >
    <button class="btn ghost sm" title={t('glyphPad.clear')} onclick={clearAll}
      ><Trash2 size={14} /></button
    >
  </div>
  <div class="row actions">
    <span class="small muted target"
      >{hasSel
        ? t('glyphPad.selectedN', { n: selS.length + selC.length })
        : t('glyphPad.wholeGlyph')}</span
    >
    <label class="row small" title={t('glyphPad.sizeHint')}
      >{t('glyphPad.w')}
      <input
        class="input sm num-in"
        type="number"
        min="1"
        value={boxW}
        disabled={empty}
        onchange={(e) => setSize('w', Number((e.currentTarget as HTMLInputElement).value))}
      /></label
    >
    <button
      class="btn ghost sm icon"
      class:on={lockRatio}
      title={t('glyphPad.lockRatio')}
      onclick={() => (lockRatio = !lockRatio)}
      >{#if lockRatio}<Link2 size={14} />{:else}<Link2Off size={14} />{/if}</button
    >
    <label class="row small" title={t('glyphPad.sizeHint')}
      >{t('glyphPad.h')}
      <input
        class="input sm num-in"
        type="number"
        min="1"
        value={boxH}
        disabled={empty}
        onchange={(e) => setSize('h', Number((e.currentTarget as HTMLInputElement).value))}
      /></label
    >
    <button
      class="btn ghost sm"
      title={t('glyphPad.flipH')}
      disabled={empty}
      onclick={() => flip(true)}><FlipHorizontal2 size={14} /></button
    >
    <button
      class="btn ghost sm"
      title={t('glyphPad.flipV')}
      disabled={empty}
      onclick={() => flip(false)}><FlipVertical2 size={14} /></button
    >
    <button
      class="btn ghost sm"
      title={t('glyphPad.reverseHint')}
      disabled={empty}
      onclick={reverseDir}><Repeat2 size={14} />{t('glyphPad.reverse')}</button
    >
    <button
      class="btn ghost sm"
      title={t('glyphPad.outlineHint')}
      disabled={!target.c.length}
      onclick={outline}><SquareDashed size={14} />{t('glyphPad.outline')}</button
    >
    <span class="row bold-group">
      <button class="btn ghost sm" title={t('glyphPad.boldHint')} disabled={empty} onclick={bold}
        ><Bold size={14} />{t('glyphPad.bold')}</button
      >
      <input
        class="input sm num-in short"
        type="number"
        min="1"
        max="200"
        title={t('glyphPad.boldHint')}
        bind:value={boldAmount}
      />
    </span>
    <button
      class="btn ghost sm"
      title={t('glyphPad.duplicate')}
      disabled={!hasSel}
      onclick={duplicate}><Copy size={14} /></button
    >
    <button class="btn ghost sm" title={t('glyphPad.delete')} disabled={!hasSel} onclick={deleteSel}
      ><Trash2 size={14} />{t('glyphPad.delete')}</button
    >
  </div>
  <svg
    bind:this={svg}
    class="canvas"
    class:pen={tool === 'pen' || tool === 'shape'}
    class:erase={tool === 'erase'}
    class:panning={drag?.kind === 'pan'}
    {viewBox}
    role="img"
    aria-label={title}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onwheel={onWheel}
    onauxclick={(e) => e.preventDefault()}
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
        x1={-MARGIN * 6}
        x2={advance + MARGIN * 6}
        y1={-g.y}
        y2={-g.y}
        vector-effect="non-scaling-stroke"
      />
      <text class="guide-label" x={-MARGIN + 8} y={-g.y - 8}>{t(`glyphPad.guides.${g.key}`)}</text>
    {/each}
    {#each [0, advance] as sx (sx)}
      <line
        class="side"
        x1={sx}
        x2={sx}
        y1={-top - MARGIN * 4}
        y2={-GUIDES.descender + MARGIN * 5}
        vector-effect="non-scaling-stroke"
      />
    {/each}
    <circle
      class="adv-handle"
      role="presentation"
      cx={advance}
      cy={-GUIDES.descender + MARGIN / 2}
      r={Math.max(10, 10 * upp)}
      onpointerdown={startAdvance}
    />
    <!-- 轮廓：合成一条路径按非零规则填，内洞才是空的 -->
    {#if allContours}<path class="fill" d={allContours} />{/if}
    {#each selC as ci (ci)}
      {#if contours[ci]}<path
          class="c-sel"
          d={contourSvg(contours[ci])}
          vector-effect="non-scaling-stroke"
        />{/if}
    {/each}
    <!-- 笔画 -->
    {#each strokes as s, i (i)}
      {#if s.points.length === 1}
        <circle
          class="ink"
          class:sel={selS.includes(i)}
          cx={s.points[0][0]}
          cy={-s.points[0][1]}
          r={s.width / 2}
        />
      {:else}
        <polyline
          class="stroke"
          class:sel={selS.includes(i)}
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
      {#if strength > 0}
        <!-- 防抖的绳子：指针那头一个圈（绳长），一根线拉着笔尖 -->
        <circle
          class="rope-ring"
          cx={pointer[0]}
          cy={-pointer[1]}
          r={Math.max(0.01, ropeRadius)}
          vector-effect="non-scaling-stroke"
        />
        <line
          class="rope"
          x1={ink[0]}
          y1={-ink[1]}
          x2={pointer[0]}
          y2={-pointer[1]}
          vector-effect="non-scaling-stroke"
        />
        <circle class="rope-tip" cx={ink[0]} cy={-ink[1]} r={3 * upp} />
      {/if}
    {/if}
    {#if shapePreview?.contour}
      <path
        class="preview"
        d={contourSvg(shapePreview.contour)}
        vector-effect="non-scaling-stroke"
      />
    {:else if shapePreview?.stroke}
      <polyline
        class="stroke ghosted"
        points={pts(shapePreview.stroke)}
        stroke-width={shapePreview.stroke.width}
      />
    {/if}
    {#if selBox && tool === 'select'}
      <rect
        class="sel-box"
        x={selBox.x0}
        y={-selBox.y1}
        width={selBox.x1 - selBox.x0}
        height={selBox.y1 - selBox.y0}
        vector-effect="non-scaling-stroke"
      />
      <rect
        class="scale-handle"
        role="presentation"
        x={selBox.x1 - hs}
        y={-selBox.y1 - hs}
        width={hs * 2}
        height={hs * 2}
        vector-effect="non-scaling-stroke"
        onpointerdown={startScale}
      />
    {/if}
    {#if drag?.kind === 'band'}
      <rect
        class="band"
        x={Math.min(drag.a[0], drag.b[0])}
        y={-Math.max(drag.a[1], drag.b[1])}
        width={Math.abs(drag.b[0] - drag.a[0])}
        height={Math.abs(drag.b[1] - drag.a[1])}
        vector-effect="non-scaling-stroke"
      />
    {/if}
    <!-- 节点：on-curve 点是方块，控制点是小圆，细线连到它挨着的 on-curve 点 -->
    {#if nodes.length}
      {#if nodeTarget?.kind === 'c' && contours[nodeTarget.i]}
        <path
          class="c-sel"
          d={contourSvg(contours[nodeTarget.i])}
          vector-effect="non-scaling-stroke"
        />
      {/if}
      {#each nodes as n, ni (ni)}
        {#each n.links as l, li (li)}
          <line
            class="handle-line"
            x1={n.x}
            y1={-n.y}
            x2={l[0]}
            y2={-l[1]}
            vector-effect="non-scaling-stroke"
          />
        {/each}
      {/each}
      {#each nodes as n, ni (ni)}
        {#if n.on}
          <rect
            class="node"
            class:sel={sameRef(selNode, n.ref)}
            x={n.x - hs * 0.8}
            y={-n.y - hs * 0.8}
            width={hs * 1.6}
            height={hs * 1.6}
            vector-effect="non-scaling-stroke"
          />
        {:else}
          <circle
            class="node ctl"
            class:sel={sameRef(selNode, n.ref)}
            cx={n.x}
            cy={-n.y}
            r={hs * 0.65}
            vector-effect="non-scaling-stroke"
          />
        {/if}
      {/each}
    {/if}
  </svg>
  <p class="small muted hint">
    {#if msg}<span class="msg">{msg}</span>{/if}{t('glyphPad.hint')}
  </p>
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
    width: min(980px, 96vw);
    max-height: 96vh;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    box-shadow: var(--shadow-lg);
  }
  .head,
  .tools,
  .actions {
    gap: 10px;
    flex-wrap: wrap;
  }
  .actions {
    gap: 4px 6px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .actions .target {
    margin-right: 4px;
  }
  .tools label,
  .actions label {
    gap: 6px;
  }
  .bold-group {
    gap: 2px;
  }
  .num {
    width: 3ch;
    text-align: right;
  }
  .num-in {
    width: 76px;
  }
  .num-in.short {
    width: 58px;
  }
  .btn.icon.on {
    color: var(--accent-text);
  }
  .canvas {
    width: 100%;
    height: min(70vh, 680px);
    min-height: 240px;
    flex: 1 1 auto;
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
  .canvas.panning {
    cursor: grabbing;
  }
  .body {
    fill: var(--bg-sunken);
    stroke: none;
  }
  .guide {
    stroke: var(--border-strong);
    stroke-width: 1.5;
    stroke-dasharray: 8 6;
  }
  .guide.base {
    stroke: var(--accent);
    stroke-width: 2.5;
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
    stroke-width: 1.5;
  }
  .adv-handle {
    fill: var(--accent);
    cursor: ew-resize;
  }
  .fill {
    fill: var(--text);
  }
  .c-sel {
    fill: color-mix(in srgb, var(--accent) 14%, transparent);
    stroke: var(--accent);
    stroke-width: 2;
    pointer-events: none;
  }
  .stroke {
    fill: none;
    stroke: var(--text);
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .stroke.ghosted {
    opacity: 0.45;
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
  .preview {
    fill: color-mix(in srgb, var(--text) 35%, transparent);
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .rope,
  .rope-ring {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    pointer-events: none;
  }
  .rope-ring {
    stroke-dasharray: 4 3;
    opacity: 0.8;
  }
  .rope-tip {
    fill: var(--accent);
    pointer-events: none;
  }
  .sel-box,
  .band {
    fill: color-mix(in srgb, var(--accent) 8%, transparent);
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .sel-box {
    fill: none;
    pointer-events: none;
  }
  .scale-handle {
    fill: var(--bg-elev);
    stroke: var(--accent);
    stroke-width: 2;
    cursor: nesw-resize;
  }
  .handle-line {
    stroke: var(--text-3);
    stroke-width: 1;
    pointer-events: none;
  }
  .node {
    fill: var(--bg-elev);
    stroke: var(--accent);
    stroke-width: 1.5;
    pointer-events: none;
  }
  .node.ctl {
    stroke: var(--text-2);
  }
  .node.sel {
    fill: var(--accent);
  }
  .hint {
    margin: 0;
  }
  .msg {
    color: var(--accent-text);
    margin-right: 8px;
  }
  .foot {
    gap: 6px;
  }
</style>
