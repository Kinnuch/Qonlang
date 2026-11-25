/** 每个节点登记自己的删除流程；嵌套对象始终使用离指针/焦点最近的一项。 */
export interface DeleteOptions {
  selected?: boolean
  enabled?: boolean
  context?: boolean
  label?: string
  /** 行号等会复用的节点可提供逻辑身份；重解析后不沿用旧菜单。 */
  identity?: unknown
  actions?: { label: string; run: () => unknown; disabled?: boolean }[]
  select?: () => void
  remove: () => unknown | Promise<unknown>
}
export interface DeleteTarget {
  node: Element
  options: DeleteOptions
}
const targets = new WeakMap<Element, DeleteTarget>()

export function deletable(
  node: Element,
  options: DeleteOptions
): {
  update(value: DeleteOptions): void
  destroy(): void
} {
  const target = { node, options }
  targets.set(node, target)
  node.setAttribute('data-delete-target', '')
  return {
    update: (value) => {
      target.options = value
    },
    destroy: () => {
      targets.delete(node)
      node.removeAttribute('data-delete-target')
    }
  }
}

export function deleteTargetFor(node: EventTarget | null): DeleteTarget | null {
  let element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  while (element) {
    const found = targets.get(element)
    if (found) return found
    element = element.parentElement
  }
  return null
}

/** 文本和控件中的 Delete 保持原生行为，不把它上交给父列表。 */
export function editingDeleteTarget(node: EventTarget | null): boolean {
  const element = node instanceof Element ? node : node instanceof Node ? node.parentElement : null
  return !!element?.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-delete-ignore], a[href]'
  )
}

export function deleteKeyAllowed(
  event: Pick<
    KeyboardEvent,
    'key' | 'defaultPrevented' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'
  >,
  state: {
    editable: boolean
    textSelection: boolean
    readOnly: boolean
    modal: boolean
    selected: boolean
  }
): boolean {
  return (
    event.key === 'Delete' &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    !state.editable &&
    !state.textSelection &&
    !state.readOnly &&
    !state.modal &&
    state.selected
  )
}
