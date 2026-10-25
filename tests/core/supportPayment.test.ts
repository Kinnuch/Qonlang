import { describe, expect, it } from 'vitest'
import {
  paymentQr,
  supportAmountFen,
  supportYuan,
  unresolvedSupportOrder
} from '$lib/ui/supportPayment'
import type { SupportOrder } from '../../src/shared/support'

describe('支持开发金额与付款码', () => {
  it('按分解析金额，不把小数误差算进实际付款', () => {
    expect(supportAmountFen('0.01')).toBe(1)
    expect(supportAmountFen('6.1')).toBe(610)
    expect(supportAmountFen('6.01')).toBe(601)
    expect(supportAmountFen(' 600.00 ')).toBe(60000)
    expect(supportYuan(1)).toBe('0.01')
    expect(supportYuan(601)).toBe('6.01')
  })
  it('拒绝越界、多余小数、指数及混淆输入，不静默四舍五入', () => {
    for (const amount of [
      '',
      '0',
      '0.00',
      '0.001',
      '600.01',
      '601',
      '-1',
      '+1',
      '6e1',
      '1,00',
      '1.234',
      'Infinity',
      'NaN',
      '１',
      '1.',
      '01',
      '999999999999999999'
    ])
      expect(supportAmountFen(amount), amount).toBeNull()
    expect(supportAmountFen('1.00', 101, 60000)).toBeNull()
    expect(supportAmountFen('6.00', 1, 599)).toBeNull()
  })
  it('只让未完成订单阻止新建，终态记录不会误作付款入口', () => {
    const orders = (['paid', 'closed', 'refund_review', 'refunded', 'pending'] as const).map(
      (status, i) => ({
        id: String(i),
        amountFen: 600,
        currency: 'CNY' as const,
        status,
        createdAt: 1
      })
    ) satisfies SupportOrder[]
    expect(unresolvedSupportOrder(orders)?.id).toBe('4')
    expect(unresolvedSupportOrder(orders.slice(0, 4))).toBeUndefined()
  })
  it('生成带静区的本地QR路径，不含远程资源或可执行HTML', () => {
    const qr = paymentQr('weixin://wxpay/bizpayurl?pr=QonlangLocalTest')!
    expect(qr.size).toBeGreaterThan(28)
    expect(qr.path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/)
    expect(qr.path).not.toContain('http')
    expect(paymentQr('')).toBeNull()
    expect(paymentQr('x'.repeat(2049))).toBeNull()
    expect(paymentQr('weixin://wxpay/bizpayurl?pr=QonlangLocalTest')).toEqual(qr)
  })
})
