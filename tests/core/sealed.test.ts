import { describe, expect, it } from 'vitest'
import { isSealed, sealText, unsealText } from '$lib/core/sealed'

describe('纯欣赏副本', () => {
  it('写出去的不是明文，读回来一模一样', async () => {
    const plain = JSON.stringify({
      schemaVersion: 9,
      meta: { name: '示例', readOnly: true },
      words: ['kaso', 'teli', 'ŋö̃']
    })
    const sealed = await sealText(plain)
    expect(isSealed(sealed)).toBe(true)
    expect(sealed).not.toContain('kaso')
    expect(await unsealText(sealed)).toBe(plain)
    expect(isSealed(plain)).toBe(false)
  })

  it('改动过的文件读不出来', async () => {
    const sealed = await sealText('{"a":1}')
    const i = sealed.length - 6
    const broken = sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1)
    await expect(unsealText(broken)).rejects.toBeTruthy()
  })
})
