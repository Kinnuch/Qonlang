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
