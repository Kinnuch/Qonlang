import { describe, expect, it } from 'vitest'
import { NATIVE_FALLBACK, nativeLabel, pickLocale } from '../../src/main/locale'
import { pickLocale as pickLocaleWeb } from '$lib/i18n/systemLocale'
import zh from '$lib/i18n/zh'

describe('first-run interface language', () => {
  const cases: [string[], string][] = [
    [['zh-CN'], 'zh'],
    [['zh-Hans-CN', 'en-US'], 'zh'],
    [['zh-TW'], 'zh-Hant'],
    [['zh-Hant-HK'], 'zh-Hant'],
    [['zh_HK'], 'zh-Hant'],
    [['ja-JP', 'en-US'], 'ja'],
    [['ko'], 'ko'],
    [['fr-CA'], 'fr'],
    [['es-419'], 'es'],
    [['ru-RU'], 'ru'],
    [['ar-EG'], 'ar'],
    [['en-GB'], 'en'],
    // 系统首选语言不是九种之一时，往后找第二、第三偏好
    [['de-DE', 'fr-FR'], 'fr'],
    [['de-DE', 'nl-NL'], 'en'],
    [[], 'en']
  ]

  it.each(cases)('%j → %s', (langs, want) => {
    expect(pickLocale(langs)).toBe(want)
    // 网页版用的那份规则一样
    expect(pickLocaleWeb(langs)).toBe(want)
  })
})

describe('native menu text', () => {
  it('prefers what the interface sent, then falls back to Chinese or English', () => {
    expect(nativeLabel({ copy: 'コピー' }, 'ja', 'copy')).toBe('コピー')
    expect(nativeLabel({}, 'ja', 'copy')).toBe(NATIVE_FALLBACK.en.copy)
    expect(nativeLabel({}, 'zh-Hant', 'copy')).toBe(NATIVE_FALLBACK.zh.copy)
    expect(nativeLabel({}, 'en', 'no-such-key')).toBe('no-such-key')
  })

  it('has a fallback for every key the interface sends', () => {
    const keys = Object.keys(zh.native).sort()
    expect(Object.keys(NATIVE_FALLBACK.zh).sort()).toEqual(keys)
    expect(Object.keys(NATIVE_FALLBACK.en).sort()).toEqual(keys)
  })
})
