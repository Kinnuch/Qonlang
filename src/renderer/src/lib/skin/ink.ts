import { tick } from 'svelte'

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

/**
 * 换皮肤时像墨水晕开：新皮肤从点的地方一圈圈洇出去，边缘是几团叠在一起的软边圆，不是一个死板的圆。
 * 用浏览器的视图过渡拍下换之前的样子，新样子套一个随半径长大的遮罩（半径 --ink-r 在 app.css 里注册成可动画的长度）。
 * 不支持视图过渡、系统要求减少动效、或者不是点出来的（没有鼠标位置）时直接换。
 */
export function inkTransition(e: MouseEvent | null | undefined, change: () => void): void {
  const doc = document as ViewTransitionDoc
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce || !e || (e.clientX === 0 && e.clientY === 0)) {
    change()
    return
  }
  const x = e.clientX
  const y = e.clientY
  const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
  const root = document.documentElement
  root.style.setProperty('--ink-x', `${x}px`)
  root.style.setProperty('--ink-y', `${y}px`)
  root.classList.add('ink-switch')
  const vt = doc.startViewTransition(async () => {
    change()
    await tick()
  })
  vt.ready
    .then(() => {
      root.animate({ '--ink-r': ['0px', `${Math.ceil(far * 1.45)}px`] } as unknown as Keyframe[], {
        duration: 1000,
        easing: 'cubic-bezier(0.3, 0.55, 0.25, 1)',
        pseudoElement: '::view-transition-new(root)',
        fill: 'both'
      })
    })
    .catch(() => {})
  vt.finished.finally(() => {
    root.classList.remove('ink-switch')
    root.style.removeProperty('--ink-x')
    root.style.removeProperty('--ink-y')
  })
}
