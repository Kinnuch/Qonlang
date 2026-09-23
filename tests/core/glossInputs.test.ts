import { describe, it, expect } from 'vitest'
import { glossInputLanguages, uiGlossCode } from '$lib/core/glossInputs'

describe('释义输入框给哪几种语言', () => {
  it('没设置就只给界面语言；繁体算中文，自己翻的按兜底语言', () => {
    expect(glossInputLanguages({}, 'zh')).toEqual(['zh'])
    expect(glossInputLanguages({ glossInputs: [] }, 'ja')).toEqual(['ja'])
    expect(uiGlossCode('zh-Hant')).toBe('zh')
    expect(glossInputLanguages(undefined, 'x-lang', 'en')).toEqual(['en'])
  })
  it('设置里列了就按设置（去掉空的、重复的）', () => {
    expect(glossInputLanguages({ glossInputs: ['zh', ' en ', '', 'zh'] }, 'ja')).toEqual([
      'zh',
      'en'
    ])
  })
})
