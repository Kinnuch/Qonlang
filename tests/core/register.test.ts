import { describe, it, expect } from 'vitest'
import { registerShort } from '$lib/core/register'

describe('语域简写', () => {
  it('汉字、假名、谚文取第一个字', () => {
    expect(registerShort('文学')).toBe('文')
    expect(registerShort(' 专有名词 ')).toBe('专')
    expect(registerShort('古語')).toBe('古')
    expect(registerShort('고어')).toBe('고')
    expect(registerShort('')).toBe('')
  })
  it('拉丁字母取到第一个元音后面的辅音为止，本来就短或截不短的原样', () => {
    expect(registerShort('archaic')).toBe('arch.')
    expect(registerShort('literary')).toBe('lit.')
    expect(registerShort('poetic')).toBe('poet.')
    expect(registerShort('colloquial')).toBe('col.')
    expect(registerShort('written')).toBe('writ.')
    expect(registerShort('slang')).toBe('slang')
    expect(registerShort('rare')).toBe('rare')
    expect(registerShort('place name')).toBe('place')
  })
})
