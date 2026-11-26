import { expect, it } from 'vitest'
import { encodeClipboardText, decodeClipboardText } from '$lib/core/clipboardText'
it('accepts real Windows CF_UNICODETEXT line endings without changing saved text', () => {
  const payload = { format: 'qonlang-records', notes: 'line 1\nline 2\r\nline 3' }
  expect(decodeClipboardText(encodeClipboardText(payload).replace(/\n/g, '\r\n'))).toEqual(payload)
})
it('does not consume ordinary or malformed pasted text', () => {
  expect(decodeClipboardText('ordinary text')).toBeNull()
  expect(decodeClipboardText('QONLANG-RECORD-CLIPBOARD/1\r\n{broken')).toBeNull()
})
