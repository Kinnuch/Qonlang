import { describe, it, expect } from 'vitest'
import { parseRuleText, runRules } from '$lib/engine/sca'

function run(rules: string, word: string, keepDots = false) {
  return runRules(parseRuleText(rules), word, { keepDots }).output
}

describe('backslash escapes in the rule language', () => {
  it('\\? is a literal question mark, not the skip wildcard', () => {
    expect(run('\\? > x', 'ka?')).toBe('kax')
    expect(run('\\? > x', 'kat')).toBe('kat')
  })
  it('\\. is a literal dot (a bare dot only separates letters)', () => {
    // 输入里的点号默认也只是隔开字母，会被去掉；按字面保留时 \. 才对得上
    expect(run('a\\.b > c', 'a.b', true)).toBe('c')
    expect(run('a\\.b > c', 'axb', true)).toBe('axb')
    expect(run('a.b > c', 'ab')).toBe('c')
    expect(run('t > d', 'ka.ta')).toBe('kada')
  })
  it('an escaped class letter is the letter itself', () => {
    expect(run('C=ptk\n\\C > q', 'pCt')).toBe('pqt')
  })
  it('escaped separators do not split the line', () => {
    expect(run('\\> > x', 'a>b')).toBe('axb')
    expect(run('a > \\; ; a real comment', 'bab')).toBe('b;b')
    expect(run('\\_ > x / a_', 'a_')).toBe('ax')
    expect(run('\\# > x', '#')).toBe('x')
    expect(run('\\= > x', 'a=b')).toBe('axb')
    expect(run('\\| > x', 'a|b')).toBe('axb')
  })
  it('escaped replacements are plain text', () => {
    expect(run('x > \\2', 'axa')).toBe('a2a')
    expect(run('x > \\\\', 'axa')).toBe('a\\a')
    expect(run('C=ptk\nx > \\C', 'x')).toBe('C')
  })
  it('a lone backslash is still metathesis', () => {
    expect(run('bm > \\ / _', 'abma')).toBe('amba')
    expect(run('bm > \\', 'abma')).toBe('amba')
  })
  it('keeps the escapes in the parsed rule for display and editing', () => {
    const p = parseRuleText('\\? > x ; note')
    const r = p.steps[0]
    expect(r.kind).toBe('rule')
    if (r.kind === 'rule') {
      expect(r.target).toBe('\\?')
      expect(r.replacement).toBe('x')
      expect(r.comment).toBe('note')
    }
  })
})
