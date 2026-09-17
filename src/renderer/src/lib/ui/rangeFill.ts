/**
 * 滑块已经拖过的那一段涂成主题色：把当前值占的比例写进 --fill，样式在 app.css。
 * 值会被绑定改（bind:value、代码里重置）时也跟着更新。
 */
export function rangeFill(
  node: HTMLInputElement,
  /** 当前值：传进来只是为了值一变 Svelte 就调 update */
  value?: number
): { update: (value?: number) => void; destroy: () => void } {
  void value
  const paint = (): void => {
    const min = Number(node.min || 0)
    const max = Number(node.max || 100)
    const v = Number(node.value)
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0
    node.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct))}%`)
  }
  paint()
  node.addEventListener('input', paint)
  // 值被外面改了（重置按钮、bind:value）不会触发 input：每帧看一眼太费，改用属性观察 + 下一帧补画
  const mo = new MutationObserver(paint)
  mo.observe(node, { attributes: true, attributeFilter: ['value', 'min', 'max'] })
  return {
    update: () => requestAnimationFrame(paint),
    destroy: () => {
      node.removeEventListener('input', paint)
      mo.disconnect()
    }
  }
}
