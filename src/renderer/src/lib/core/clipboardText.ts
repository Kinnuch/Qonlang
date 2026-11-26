const PREFIX = 'QONLANG-RECORD-CLIPBOARD/1\n'
export const encodeClipboardText = (payload: unknown): string => PREFIX + JSON.stringify(payload)
/** Windows CF_UNICODETEXT 将真实换行变为 CRLF；JSON 内的转义换行保持原值。 */
export function decodeClipboardText(text: string): unknown | null {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith(PREFIX)) return null
  try {
    return JSON.parse(normalized.slice(PREFIX.length))
  } catch {
    return null
  }
}
