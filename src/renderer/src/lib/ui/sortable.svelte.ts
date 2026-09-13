/**
 * 拖着换顺序：一串小圆框（维度、标签、流水线步骤、页签……）里按住一个拖到另一个上，松手就挪到那个位置。
 *
 * 用法：`<span {...sortable('dims', i, (from, to) => …)}>`，回调里自己改数据（一般是 moveItem）。
 * group 区分不同的列表：只能在同一个 group 里拖，页面上同时有几份同类列表时 group 要各不相同。
 *
 * 拖动中被拖的那个变淡、落点描一圈虚线，不插占位空白——占位会把后面的挤开，指针底下换了元素，看着就在抖。
 * 按在输入框、下拉框里不会拖（照常选字、改值）：只有按下的地方不是表单控件，这一项才临时变成可拖的。
 */
const FORM_CONTROLS = 'input, textarea, select, option, [contenteditable="true"]'

const drag = $state({ group: '', from: -1, over: -1, armedGroup: '', armedIndex: -1 })
/** 嵌套的时候（可拖的框里还有可拖的小框）只让最里面那个接这次按下 */
const handled = new WeakSet<Event>()

function disarm(): void {
  drag.armedGroup = ''
  drag.armedIndex = -1
}

function reset(): void {
  drag.group = ''
  drag.from = -1
  drag.over = -1
  disarm()
}

export interface SortableProps {
  draggable: 'true' | 'false'
  'data-sort-over': 'true' | undefined
  'data-sort-dragging': 'true' | undefined
  onpointerdown: (e: PointerEvent) => void
  ondragstart: (e: DragEvent) => void
  ondragover: (e: DragEvent) => void
  ondragleave: (e: DragEvent) => void
  ondrop: (e: DragEvent) => void
  ondragend: () => void
}

export function sortable(
  group: string,
  index: number,
  onMove: (from: number, to: number) => void
): SortableProps {
  const mine = drag.group === group
  return {
    draggable: drag.armedGroup === group && drag.armedIndex === index ? 'true' : 'false',
    'data-sort-over': mine && drag.over === index && drag.from !== index ? 'true' : undefined,
    'data-sort-dragging': mine && drag.from === index ? 'true' : undefined,
    onpointerdown: (e) => {
      if (e.button !== 0 || handled.has(e)) return
      handled.add(e)
      if ((e.target as Element | null)?.closest(FORM_CONTROLS)) return
      drag.armedGroup = group
      drag.armedIndex = index
      // 只是点了一下、没拖：松开就撤掉，免得这一项一直可拖
      window.addEventListener('pointerup', disarm, { once: true })
    },
    ondragstart: (e) => {
      if (drag.armedGroup !== group || drag.armedIndex !== index) return
      e.stopPropagation()
      drag.group = group
      drag.from = index
      drag.over = -1
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', '')
      }
    },
    ondragover: (e) => {
      if (drag.group !== group || drag.from < 0) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      if (drag.over !== index) drag.over = index
    },
    ondragleave: (e) => {
      if (drag.group !== group || drag.over !== index) return
      // 在这一项里面的子元素之间移动也会触发 dragleave：真的离开了才清掉
      const to = e.relatedTarget as Node | null
      if (!to || !(e.currentTarget as Node).contains(to)) drag.over = -1
    },
    ondrop: (e) => {
      if (drag.group !== group || drag.from < 0) return
      e.preventDefault()
      e.stopPropagation()
      const from = drag.from
      reset()
      if (from !== index) onMove(from, index)
    },
    ondragend: reset
  }
}
