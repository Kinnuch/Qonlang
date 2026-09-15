import { describe, expect, it } from 'vitest'
import { createLexeme, createSense } from '$lib/core/factory'
import { lexemeHasDefinition, lexiconIssues } from '$lib/core/lexiconIssues'

describe('词库的问题', () => {
  it('没有写释义的词条标红，同语言里词头重复的标黄', () => {
    const a = createLexeme('L', 'kaso')
    const b = createLexeme('L', 'kaso')
    const c = createLexeme('L', 'teli')
    const d = createLexeme('M', 'teli')
    for (const x of [a, b, d]) {
      const s = createSense()
      s.definition = { zh: '房子' }
      x.senses = [s]
    }
    const blank = createSense()
    blank.definition = { zh: '  ' }
    c.senses = [blank]
    expect(lexemeHasDefinition(c)).toBe(false)
    const issues = lexiconIssues([a, b, c, d])
    expect(issues.filter((i) => i.severity === 'error').map((i) => i.lexemeId)).toEqual([c.id])
    expect(issues.filter((i) => i.kind === 'duplicate').map((i) => i.lexemeId)).toEqual([
      a.id,
      b.id
    ])
  })
})
