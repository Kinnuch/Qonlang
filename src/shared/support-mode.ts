export type SupportPaymentMode = 'personal-qr' | 'api'

/** 临时使用原个人收款码；恢复 API 时改这里，并重新验收后构建。 */
export const SUPPORT_PAYMENT_MODE = 'personal-qr' as SupportPaymentMode
