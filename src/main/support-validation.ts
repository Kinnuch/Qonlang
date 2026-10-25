import type {
  SupportCapability,
  SupportInput,
  SupportOperation,
  SupportOrder
} from '../shared/support'

export const SUPPORT_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const states = ['pending', 'paid', 'closed', 'refund_review', 'refunded']
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_RESPONSE')
  return value as Record<string, unknown>
}
export function supportInput(operation: SupportOperation, value?: unknown): SupportInput {
  const input = value ?? {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_INPUT')
  const body = input as Record<string, unknown>
  const allowed =
    operation === 'create'
      ? ['amountFen']
      : ['refresh', 'close'].includes(operation)
        ? ['orderId']
        : []
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('INVALID_INPUT')
  if (operation === 'create') {
    if (
      !Number.isSafeInteger(body.amountFen) ||
      Number(body.amountFen) < 1 ||
      Number(body.amountFen) > 60000
    )
      throw new Error('INVALID_AMOUNT')
    return { amountFen: Number(body.amountFen) }
  }
  if (operation === 'refresh' || operation === 'close') {
    if (typeof body.orderId !== 'string' || !SUPPORT_ID.test(body.orderId))
      throw new Error('INVALID_INPUT')
    return { orderId: body.orderId }
  }
  return {}
}
export function supportCapability(value: unknown): SupportCapability {
  const p = object(value)
  if (
    typeof p.enabled !== 'boolean' ||
    p.currency !== 'CNY' ||
    p.minAmountFen !== 1 ||
    p.maxAmountFen !== 60000 ||
    (p.enabled ? p.provider !== 'yungouos' : p.provider !== null)
  )
    throw new Error('INVALID_RESPONSE')
  return {
    enabled: p.enabled,
    provider: p.provider as 'yungouos' | null,
    currency: 'CNY',
    minAmountFen: 1,
    maxAmountFen: 60000
  }
}
/** 只返回订单的公开字段，付款地址绝不能成为任意网页或脚本的入口。 */
export function supportOrder(value: unknown): SupportOrder {
  const o = object(value)
  if (
    typeof o.id !== 'string' ||
    !SUPPORT_ID.test(o.id) ||
    !Number.isSafeInteger(o.amountFen) ||
    Number(o.amountFen) < 1 ||
    Number(o.amountFen) > 60000 ||
    o.currency !== 'CNY' ||
    !states.includes(String(o.status)) ||
    !Number.isSafeInteger(o.createdAt) ||
    Number(o.createdAt) <= 0 ||
    (o.paidAt !== undefined &&
      (!Number.isSafeInteger(o.paidAt) || Number(o.paidAt) < Number(o.createdAt)))
  )
    throw new Error('INVALID_RESPONSE')
  const out: SupportOrder = {
    id: o.id,
    amountFen: Number(o.amountFen),
    currency: 'CNY',
    status: o.status as SupportOrder['status'],
    createdAt: Number(o.createdAt),
    ...(o.paidAt !== undefined ? { paidAt: Number(o.paidAt) } : {})
  }
  if (o.payment !== undefined) {
    const p = object(o.payment)
    if (
      p.provider !== 'yungouos' ||
      p.method !== 'wechat' ||
      !['creating', ...states].includes(String(p.state)) ||
      (o.status === 'pending'
        ? !['creating', 'pending'].includes(String(p.state))
        : p.state !== o.status) ||
      (p.expiresAt !== undefined &&
        (!Number.isSafeInteger(p.expiresAt) || Number(p.expiresAt) <= Number(o.createdAt))) ||
      (p.qrCodeUrl !== undefined &&
        (o.status !== 'pending' ||
          p.state !== 'pending' ||
          typeof p.qrCodeUrl !== 'string' ||
          !/^weixin:\/\/wxpay\/bizpayurl\?pr=[A-Za-z0-9_-]{1,256}$/.test(p.qrCodeUrl) ||
          p.expiresAt === undefined))
    )
      throw new Error('INVALID_RESPONSE')
    out.payment = {
      provider: 'yungouos',
      method: 'wechat',
      state: p.state as NonNullable<SupportOrder['payment']>['state'],
      ...(p.qrCodeUrl !== undefined ? { qrCodeUrl: String(p.qrCodeUrl) } : {}),
      ...(p.expiresAt !== undefined ? { expiresAt: Number(p.expiresAt) } : {})
    }
  }
  return out
}
