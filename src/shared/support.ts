import type { AccountState } from './account'

export const SUPPORT_OPERATIONS = ['status', 'orders', 'create', 'refresh', 'close'] as const
export type SupportOperation = (typeof SUPPORT_OPERATIONS)[number]
/** 请求号只由主进程生成、保存；页面不能指定价格之外的付款字段。 */
export interface SupportInput {
  amountFen?: number
  orderId?: string
}
export interface SupportCapability {
  enabled: boolean
  provider: 'yungouos' | null
  currency: 'CNY'
  minAmountFen: number
  maxAmountFen: number
}
export type SupportOrderState = 'pending' | 'paid' | 'closed' | 'refund_review' | 'refunded'
export interface SupportOrder {
  id: string
  amountFen: number
  currency: 'CNY'
  status: SupportOrderState
  createdAt: number
  paidAt?: number
  payment?: {
    provider: 'yungouos'
    method: 'wechat'
    state: 'creating' | SupportOrderState
    qrCodeUrl?: string
    expiresAt?: number
  }
}
export interface SupportResult {
  ok: boolean
  state: AccountState
  capability?: SupportCapability
  orders?: SupportOrder[]
  order?: SupportOrder
  error?: string
  retryable?: boolean
}
