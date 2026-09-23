/**
 * 学习包（给 Qonlang Study 的导出格式）：默认设置、跟项目对账、按文档排课、写出与读回。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { parseProject, serializeProject } from '$lib/core/serialize'
import {
  STUDY_PACK_EXTENSION,
  StudyPackError,
  defaultStudySettings,
  isPlaceholderLexeme,
  isStudyPack,
  lessonsFromDocs,
  newLesson,
  parseStudyPack,
  reconcileStudySettings,
  serializeStudyPack,
  studyAudioKey
} from '$lib/core/studyPack'
import type { Project } from '$lib/core/model'

const load = (): Project =>
  parseProject(readFileSync(join(__dirname, '..', '..', 'examples', 'Aelith.laim.json'), 'utf8'))

describe('学习包', () => {
  it('默认设置：每门语言一份，有词条的才默认导出，用主正字法', () => {
    const p = load()
    const s = defaultStudySettings(p)
    expect(s.projectId).toBe(p.meta.id)
    expect(s.languages.map((l) => l.languageId)).toEqual(p.languages.map((l) => l.id))
    const ae = p.languages.find((l) => l.abbr === 'ae')!
    const sa = s.languages.find((l) => l.languageId === ae.id)!
    expect(sa.include).toBe(true)
    expect(sa.display.orthographyId).toBe(ae.orthographies.find((o) => o.isPrimary)!.id)
    expect(sa.lessons).toEqual([])
  })

  it('没有字母的占位词条默认藏起来', () => {
    expect(isPlaceholderLexeme('·')).toBe(true)
    expect(isPlaceholderLexeme('-n')).toBe(false)
    const p = load()
    const ae = p.languages.find((l) => l.abbr === 'ae')!
    p.lexemes.push({
      ...structuredClone(p.lexemes.find((l) => l.languageId === ae.id)!),
      id: 'dot',
      lemma: '·'
    })
    const sa = defaultStudySettings(p).languages.find((l) => l.languageId === ae.id)!
    expect(sa.hidden.lexemeIds).toEqual(['dot'])
  })

  it('对账：项目里删掉的东西不再引用，坏的级别与录音丢掉，新语言补上', () => {
    const p = load()
    const ae = p.languages.find((l) => l.abbr === 'ae')!
    const lex = p.lexemes.filter((l) => l.languageId === ae.id)
    const saved = defaultStudySettings(p)
    const sa = saved.languages.find((l) => l.languageId === ae.id)!
    sa.lessons = [{ ...newLesson('第一课'), lexemeIds: [lex[0].id, 'gone'], docId: 'gone' }]
    sa.levels = { [lex[0].id]: 1, [lex[1].id]: 9, gone: 2 }
    sa.audio = {
      [studyAudioKey('lexeme', lex[0].id)]: {
        dataUrl: 'data:audio/webm;base64,AA',
        name: 'a.webm'
      },
      [studyAudioKey('lexeme', 'gone')]: { dataUrl: 'data:audio/webm;base64,AA', name: 'b.webm' }
    }
    saved.languages = saved.languages.filter((l) => l.languageId === ae.id)
    const r = reconcileStudySettings(saved, p)
    const ra = r.languages.find((l) => l.languageId === ae.id)!
    expect(ra.lessons[0]).toMatchObject({ title: '第一课', lexemeIds: [lex[0].id], docId: null })
    expect(ra.levels).toEqual({ [lex[0].id]: 1 })
    expect(Object.keys(ra.audio)).toEqual([studyAudioKey('lexeme', lex[0].id)])
    expect(r.languages).toHaveLength(p.languages.length)
  })

  it('读不懂的旧设置当没有', () => {
    const p = load()
    expect(reconcileStudySettings(null, p)).toMatchObject({ projectId: p.meta.id })
    expect(reconcileStudySettings({ languages: 'x' } as never, p).languages).toHaveLength(
      p.languages.length
    )
  })

  it('按文档排课：这门语言的文档和不分语言的文档，排过的、藏起来的不重复', () => {
    const p = load()
    const ae = p.languages.find((l) => l.abbr === 'ae')!
    const sa = defaultStudySettings(p).languages.find((l) => l.languageId === ae.id)!
    const docs = p.docs.filter((d) => d.languageId === ae.id || d.languageId === null)
    const first = lessonsFromDocs(p, sa)
    expect(first.map((l) => l.docId)).toEqual(docs.map((d) => d.id))
    expect(first.map((l) => l.title)).toEqual(docs.map((d) => d.title))
    sa.lessons = first.slice(0, 1)
    sa.hidden.docIds = [docs[1].id]
    expect(lessonsFromDocs(p, sa)).toEqual([])
  })

  it('写出再读回：项目与设置都一样', () => {
    const p = load()
    const s = defaultStudySettings(p)
    s.languages[0].intro = '# 欢迎'
    const text = serializeStudyPack(p, s, '0.12.4', '2026-09-23T00:00:00.000Z')
    expect(isStudyPack(text)).toBe(true)
    expect(isStudyPack(serializeProject(p))).toBe(false)
    const back = parseStudyPack(text)
    expect(back).toMatchObject({ version: 1, qonlangVersion: '0.12.4' })
    expect(back.project).toEqual(parseProject(serializeProject(p)))
    expect(back.study.languages[0].intro).toBe('# 欢迎')
    expect(STUDY_PACK_EXTENSION).toBe('.qstudy.json')
  })

  it('不是学习包、比软件新的学习包给出原因', () => {
    expect(() => parseStudyPack('{')).toThrow(StudyPackError)
    expect(() => parseStudyPack(serializeProject(load()))).toThrow(StudyPackError)
    const newer = serializeStudyPack(load(), defaultStudySettings(load()), 'x').replace(
      '"version":1',
      '"version":99'
    )
    try {
      parseStudyPack(newer)
      expect.unreachable()
    } catch (e) {
      expect((e as StudyPackError).code).toBe('newer-study-pack')
    }
  })
})
