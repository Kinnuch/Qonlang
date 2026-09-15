/**
 * 存盘文本：从撤销栈里的 JSON 排出来的，跟直接序列化项目的一样（没有 Worker 的环境在当前线程做）。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject } from '$lib/core/factory'
import { serializeForDisk } from '$lib/core/serialize'
import { diskTextFromJson } from '$lib/core/diskText'

describe('存盘文本', () => {
  it('JSON 排成存盘格式，跟直接序列化一致', async () => {
    const p = createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })
    const l = createLexeme(p.languages[0].id, 'kala')
    l.senses[0].registers = ['文学', '古语']
    p.lexemes.push(l)
    expect(await diskTextFromJson(JSON.stringify(p))).toBe(await serializeForDisk(p))
    p.meta.readOnly = true
    const sealed = await diskTextFromJson(JSON.stringify(p))
    expect(sealed).not.toContain('kala')
  })
})
