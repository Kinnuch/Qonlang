import qrcode from 'qrcode-generator'
import type { SupportOrder } from '$lib/platform'

/** 金额始终按分计算，避免小数乘法产生取整误差。 */
export function supportAmountFen(value: string, minimum = 1, maximum = 60000): number | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount >= minimum && amount <= maximum ? amount : null
}

export function supportYuan(amountFen: number): string {
  return (amountFen / 100).toFixed(2)
}

export function unresolvedSupportOrder(orders: SupportOrder[]): SupportOrder | undefined {
  return orders.find((order) => order.status === 'pending')
}

/** 只在本地编码主进程验证过的付款地址，不请求远程图片或打开付款网页。 */
export function paymentQr(value: string): { size: number; path: string } | null {
  if (!value || value.length > 2048) return null
  try {
    const code = qrcode(0, 'M')
    code.addData(value, 'Byte')
    code.make()
    const count = code.getModuleCount()
    const paths: string[] = []
    for (let row = 0; row < count; row++)
      for (let column = 0; column < count; column++)
        if (code.isDark(row, column)) paths.push(`M${column + 4} ${row + 4}h1v1h-1z`)
    return { size: count + 8, path: paths.join('') }
  } catch {
    return null
  }
}

/** 对话框焦点不越过遮罩；Esc 只收起当前框，回到原来的按钮。 */
export function supportDialogFocus(node: HTMLElement, close: () => void): { destroy(): void } {
  const previous = document.activeElement as HTMLElement | null
  const controls = (): HTMLElement[] =>
    Array.from(
      node.querySelectorAll<HTMLElement>(
        'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [href], [tabindex="0"]'
      )
    )
  node.focus({ preventScroll: true })
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    } else if (event.key === 'Tab') {
      const items = controls()
      const first = items[0]
      const last = items.at(-1)
      if (
        !first ||
        !node.contains(document.activeElement) ||
        document.activeElement === node ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first)?.focus()
      }
    }
  }
  const focusin = (event: FocusEvent): void => {
    if (!node.contains(event.target as Node)) node.focus({ preventScroll: true })
  }
  document.addEventListener('keydown', keydown, true)
  document.addEventListener('focusin', focusin, true)
  return {
    destroy() {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin, true)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }
}
