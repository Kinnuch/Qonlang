import { describe, expect, it } from 'vitest'
import { corpusTextSize } from '$lib/ui/corpusTextSize'

describe('例句文字大小偏好', () => {
  it('旧偏好与无效值保留原来的视觉大小', () => {
    for (const value of [undefined, null, '', '150', false, NaN, Infinity, -1, 0, 49, 201])
      expect(corpusTextSize(value)).toBe(100)
  })
  it('保存设置的范围与滑杆一致，并保留百分比基准', () => {
    expect(corpusTextSize(50)).toBe(50)
    expect(corpusTextSize(100)).toBe(100)
    expect(corpusTextSize(125)).toBe(125)
    expect(corpusTextSize(200)).toBe(200)
    expect(corpusTextSize(127)).toBe(125)
    expect(corpusTextSize(128)).toBe(130)
  })
})
