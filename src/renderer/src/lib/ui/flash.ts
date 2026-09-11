/**
 * Svelte action：`use:flashOn={value}`，value 变为真值（或变化）时给节点加一次绿色闪烁。
 * 用于「确认」「写入」「保存」之类动作完成的反馈。
 */
export function flashOn(node: HTMLElement, value: unknown): { update(v: unknown): void } {
  let last = value
  const play = (): void => {
    node.classList.remove('flash-ok')
    void node.offsetWidth
    node.classList.add('flash-ok')
    setTimeout(() => node.classList.remove('flash-ok'), 900)
  }
  return {
    update(v: unknown) {
      if (v !== last && v) play()
      last = v
    }
  }
}

export interface FlashChangeArg {
  /** 这一处显示的内容；变了就闪 */
  key: string
  /** 为假时只记下 key 不闪（刚载入的第一屏）；为真时新出现的节点也闪一下 */
  armed: boolean
}

/**
 * Svelte action：`use:flashChange={{ key, armed }}`，内容变了就先高亮、再慢慢褪掉。
 * 导入样例里用它标出跟着设置变了的地方。
 */
export function flashChange(
  node: HTMLElement,
  arg: FlashChangeArg
): { update(a: FlashChangeArg): void; destroy(): void } {
  let last = arg.key
  let timer: ReturnType<typeof setTimeout> | undefined
  const play = (): void => {
    node.classList.remove('flash-change')
    void node.offsetWidth
    node.classList.add('flash-change')
    clearTimeout(timer)
    timer = setTimeout(() => node.classList.remove('flash-change'), 1600)
  }
  if (arg.armed) play()
  return {
    update(a: FlashChangeArg) {
      if (a.key !== last && a.armed) play()
      last = a.key
    },
    destroy() {
      clearTimeout(timer)
    }
  }
}
