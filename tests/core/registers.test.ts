/**
 * 一个义项可以有几个语域：旧项目的 register 文字读入时转成列表；写盘另带一份旧字段给老版本看。
 */
import { describe, it, expect } from 'vitest'
import { createLexeme, createProject } from '$lib/core/factory'
import {
  parseProject,
  projectFromFolder,
  projectToFolder,
  serializeProject
} from '$lib/core/serialize'
import { splitRegisters } from '$lib/core/register'

const blank = (): ReturnType<typeof createProject> =>
  createProject({ name: 'x', template: 'blank', appVersion: '1', uiLocale: 'zh' })

describe('义项的几个语域', () => {
  it('旧项目里的 register 文字读入时拆成语域列表，旧字段去掉', () => {
    const p = blank()
    p.lexemes.push(createLexeme(p.languages[0].id, 'kala'))
    const raw = JSON.parse(serializeProject(p))
    const se = raw.lexemes[0].senses[0]
    delete se.registers
    se.register = '古语、文学'
    const back = parseProject(JSON.stringify(raw))
    expect(back.lexemes[0].senses[0].registers).toEqual(['古语', '文学'])
    expect('register' in back.lexemes[0].senses[0]).toBe(false)
  })

  it('写盘时每个义项另带拼起来的 register，读回来原样', () => {
    const p = blank()
    const l = createLexeme(p.languages[0].id, 'kala')
    l.senses[0].registers = ['古语', '文学']
    p.lexemes.push(l)
    const text = serializeProject(p)
    expect(JSON.parse(text).lexemes[0].senses[0].register).toBe('古语、文学')
    expect(parseProject(text)).toEqual(p)
    const folder = projectToFolder(p)
    expect(JSON.parse(folder['lexemes.json'])[0].senses[0].register).toBe('古语、文学')
    expect(projectFromFolder(folder).lexemes).toEqual(p.lexemes)
  })

  it('拆分语域文字：顿号、逗号、分号都算，去掉空的和重复的', () => {
    expect(splitRegisters(' 古语，文学;古语 ')).toEqual(['古语', '文学'])
    expect(splitRegisters('')).toEqual([])
  })
})
