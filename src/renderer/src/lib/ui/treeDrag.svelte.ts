/**
 * 语言树的拖动：既能拖到一张卡片「上面」（换挂靠），也能拖到两张卡片「中间」（换顺序）。
 *
 * lib/ui/sortable 只能表达「拖到第几项」，这里两种落法都要，所以单独写一个。
 * 样子跟 sortable 一致：被拖的那张变淡（data-sort-dragging），落到卡片上时描一圈虚线（data-sort-over），
 * 落到两张中间时那一条边画一道线（data-drop=before/after），放不下去的落点整个描红（data-drop-bad）。
 * 放不下去还松了手：卡片从指针那儿滑回原位（约 200ms），系统里设了「减少动态效果」就直接跳回去。
 */
import type { TreeRef } from '$lib/core/languageTree'

export type DropZone = 'into' | 'before' | 'after'

export interface TreeDragOptions {
  /** 这一下放得下去吗（target 为 null 是最外层的空白处） */
  canDrop: (src: TreeRef, target: TreeRef | null, zone: DropZone) => boolean
  /** 真的放下了 */
  onDrop: (src: TreeRef, target: TreeRef | null, zone: DropZone) => void
}

const NO_DRAG = 'input, textarea, select, option, button, [contenteditable="true"]'
/** 上下各三成是「插到中间」，当中是「放到它下面」 */
const EDGE = 0.3
const BACK_MS = 200

const drag = $state<{
  src: TreeRef | null
  over: TreeRef | null
  /** 落在最外层空白处 */
  overRoot: boolean
  zone: DropZone
  ok: boolean
  armed: string
}>({ src: null, over: null, overRoot: false, zone: 'into', ok: true, armed: '' })

const keyOf = (r: TreeRef): string => r.kind + ':' + r.id
const same = (a: TreeRef | null, b: TreeRef | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.id === b.id

/** 按下的位置和被拖的那张卡片，放不下去时按它滑回去 */
let startX = 0
let startY = 0
let srcEl: HTMLElement | null = null
let dropped = false

function reset(): void {
  drag.src = null
  drag.over = null
  drag.overRoot = false
  drag.zone = 'into'
  drag.ok = true
  drag.armed = ''
}

function reduceMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 从松手的地方滑回原位 */
function flyBack(x: number, y: number): void {
  const el = srcEl
  srcEl = null
  if (!el || reduceMotion()) return
  const dx = x - startX
  const dy = y - startY
  if (!dx && !dy) return
  el.style.transition = 'none'
  el.style.transform = `translate(${dx}px, ${dy}px)`
  requestAnimationFrame(() => {
    el.style.transition = `transform ${BACK_MS}ms ease`
    el.style.transform = ''
    setTimeout(() => {
      el.style.transition = ''
      el.style.transform = ''
    }, BACK_MS + 40)
  })
}

function zoneOf(src: TreeRef, target: TreeRef, e: DragEvent): DropZone {
  // 不同类的东西不讲顺序（树里分类节点总排在语言前面），只能放到它下面
  if (src.kind !== target.kind) return 'into'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const r = rect.height ? (e.clientY - rect.top) / rect.height : 0.5
  return r < EDGE ? 'before' : r > 1 - EDGE ? 'after' : 'into'
}

export interface TreeDragProps {
  draggable: 'true' | 'false'
  'data-sort-dragging': 'true' | undefined
  'data-sort-over': 'true' | undefined
  'data-drop': DropZone | undefined
  'data-drop-bad': 'true' | undefined
  onpointerdown: (e: PointerEvent) => void
  ondragstart: (e: DragEvent) => void
  ondragover: (e: DragEvent) => void
  ondragleave: (e: DragEvent) => void
  ondrop: (e: DragEvent) => void
  ondragend: (e: DragEvent) => void
}

/** 一张卡片上的拖动属性，直接 `{...treeDragProps(ref, opt)}` 铺开 */
export function treeDragProps(ref: TreeRef, opt: TreeDragOptions): TreeDragProps {
  const key = keyOf(ref)
  const mine = same(drag.over, ref)
  return {
    draggable: drag.armed === key ? 'true' : 'false',
    'data-sort-dragging': same(drag.src, ref) ? 'true' : undefined,
    'data-sort-over': mine && drag.zone === 'into' && drag.ok ? 'true' : undefined,
    'data-drop': mine ? drag.zone : undefined,
    'data-drop-bad': mine && !drag.ok ? 'true' : undefined,
    onpointerdown: (e) => {
      if (e.button !== 0) return
      // 按在按钮、输入框里照常用，不变成可拖
      if ((e.target as Element | null)?.closest(NO_DRAG)) return
      drag.armed = key
      window.addEventListener('pointerup', () => (drag.armed = ''), { once: true })
    },
    ondragstart: (e) => {
      if (drag.armed !== key) return
      e.stopPropagation()
      drag.src = ref
      drag.over = null
      drag.overRoot = false
      dropped = false
      startX = e.clientX
      startY = e.clientY
      srcEl = e.currentTarget as HTMLElement
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', key)
      }
    },
    ondragover: (e) => {
      const src = drag.src
      if (!src) return
      // 放不下去的也要拦下来，不然松手时收不到 drop、画不了滑回去
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      // 拖到自己身上：什么都不标
      if (same(src, ref)) {
        drag.over = null
        drag.overRoot = false
        return
      }
      const zone = zoneOf(src, ref, e)
      const ok = opt.canDrop(src, ref, zone)
      if (e.dataTransfer && ok) e.dataTransfer.dropEffect = 'move'
      if (!same(drag.over, ref) || drag.zone !== zone || drag.ok !== ok) {
        drag.over = ref
        drag.overRoot = false
        drag.zone = zone
        drag.ok = ok
      }
    },
    ondragleave: (e) => {
      if (!same(drag.over, ref)) return
      // 在卡片内部的子元素之间移动也会触发：真的离开了才清掉
      const to = e.relatedTarget as Node | null
      if (!to || !(e.currentTarget as Node).contains(to)) drag.over = null
    },
    ondrop: (e) => {
      const src = drag.src
      if (!src) return
      e.preventDefault()
      e.stopPropagation()
      const zone = drag.zone
      const ok = drag.ok && same(drag.over, ref)
      dropped = true
      reset()
      if (ok) srcEl = null
      else flyBack(e.clientX, e.clientY)
      if (ok) opt.onDrop(src, ref, zone)
    },
    ondragend: (e) => {
      // 松在树外面：也滑回去
      if (!dropped) flyBack(e.clientX, e.clientY)
      dropped = false
      srcEl = null
      reset()
    }
  }
}

export interface RootDropProps {
  'data-drop': 'into' | undefined
  'data-drop-bad': 'true' | undefined
  ondragover: (e: DragEvent) => void
  ondragleave: (e: DragEvent) => void
  ondrop: (e: DragEvent) => void
}

/** 最外层的落点：放到这里就是不挂在任何语言、任何分类节点下 */
export function treeRootDropProps(opt: TreeDragOptions): RootDropProps {
  return {
    'data-drop': drag.overRoot && drag.ok ? 'into' : undefined,
    'data-drop-bad': drag.overRoot && !drag.ok ? 'true' : undefined,
    ondragover: (e) => {
      const src = drag.src
      if (!src) return
      e.preventDefault()
      e.stopPropagation()
      const ok = opt.canDrop(src, null, 'into')
      if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'move' : 'none'
      if (!drag.overRoot || drag.ok !== ok) {
        drag.over = null
        drag.overRoot = true
        drag.zone = 'into'
        drag.ok = ok
      }
    },
    ondragleave: (e) => {
      const to = e.relatedTarget as Node | null
      if (!to || !(e.currentTarget as Node).contains(to)) drag.overRoot = false
    },
    ondrop: (e) => {
      const src = drag.src
      if (!src) return
      e.preventDefault()
      e.stopPropagation()
      const ok = drag.ok
      dropped = true
      reset()
      if (ok) srcEl = null
      else flyBack(e.clientX, e.clientY)
      if (ok) opt.onDrop(src, null, 'into')
    }
  }
}

/** 正在拖东西吗（最外层落点只在拖的时候露出来） */
export function draggingRef(): TreeRef | null {
  return drag.src
}
