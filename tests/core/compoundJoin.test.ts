import { describe, expect, it } from 'vitest'
import { createLexeme, createProject } from '$lib/core/factory'
import { prepareCompoundJoin, type CompoundJoinStep } from '$lib/core/compoundJoin'
import { createCompoundLexeme } from '$lib/core/compoundBuilder'
import { applyAdjust, makeContext } from '$lib/engine/morph'
function fixture() {
  const p = createProject({
      name: 'Joining QA',
      template: 'blank',
      uiLocale: 'en',
      appVersion: '1.1.2'
    }),
    lang = p.languages[0],
    ortho = lang.orthographies[0]
  lang.phonemes = [
    {
      id: 'theta',
      symbol: 'θ',
      features: { type: 'consonant' },
      graphemes: { [ortho.id]: 'th, þ' },
      notes: ''
    },
    {
      id: 'a',
      symbol: 'a',
      features: { type: 'vowel', syllabic: 'yes' },
      graphemes: { [ortho.id]: 'a' },
      notes: ''
    },
    {
      id: 'g',
      symbol: 'ɡ',
      features: { type: 'consonant' },
      graphemes: { [ortho.id]: 'g' },
      notes: ''
    }
  ]
  return { p, lang, ortho }
}
const drop = (
  kind: 'drop-left' | 'drop-right',
  count = 1,
  times = 1,
  id = 'drop'
): CompoundJoinStep => ({ id, kind, count, times })
const insert = (side: 'left' | 'right', text: string, id = 'insert'): CompoundJoinStep => ({
  id,
  kind: 'insert',
  side,
  text
})
const join = (text: string, id = 'join'): CompoundJoinStep => ({ id, kind: 'separator', text })
const adjust = (side: 'left' | 'right', text: string, id = 'adjust'): CompoundJoinStep => ({
  id,
  kind: 'adjust',
  side,
  text
})
describe('compound joining draft pipeline', () => {
  it('an unchosen added step is an exact no-op, including dictionary boundary notation', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const result = run('pre-', '-root', [{ id: 'new', kind: 'none' }])
    expect(result).toMatchObject({
      left: 'pre-',
      right: '-root',
      separator: '',
      surface: 'pre--root',
      valid: true
    })
  })
  it('uses the real tweak interpreter for a directly copyable final metathesis rule on the left only', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const result = run('cab', 'dab', [adjust('left', 'ab > ba / _#')])
    expect(result).toMatchObject({ left: 'cba', right: 'dab', surface: 'cbadab', valid: true })
    expect(result.trace[0].adjustments).toEqual(['微调 ab > ba / _#: cab → cba'])
    expect(result.trace[0].diagnostics).toBeUndefined()
    expect(run('abca', 'dab', [adjust('left', 'ab > ba / _#')]).left).toBe('abca')
  })
  it('can explicitly target the current right form, without changing the left form or connector', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('cab', 'dab', [join('·'), adjust('right', 'ab > ba / _#')])).toMatchObject({
      left: 'cab',
      right: 'dba',
      separator: '·',
      surface: 'cab·dba',
      valid: true
    })
  })
  it('keeps source spellings that are outside the chosen tweak untouched', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang),
      right = 'THa\u0301ɡ'
    expect(run('cab', right, [adjust('left', 'ab > ba / _#')]).right).toBe(right)
  })
  it('opens dictionary notation for a word-end rule but keeps it out of the selected word', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('cab-', 'root', [adjust('left', 'ab > ba / _#')]).surface).toBe('cba-root')
    expect(run('cab-', 'root', [adjust('left', 'ab > ba / _#'), join('')]).surface).toBe('cbaroot')
    expect(run('cab-', '-root', [adjust('left', 'ab > ba / _#'), join('-')]).surface).toBe(
      'cba-root'
    )
  })
  it('keeps tweak, insertion and complete-unit deletion in actual order', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('ca', 'r', [insert('left', 'b'), adjust('left', 'ab > ba / _#')]).surface).toBe(
      'cbar'
    )
    expect(run('ca', 'r', [adjust('left', 'ab > ba / _#'), insert('left', 'b')]).surface).toBe(
      'cabr'
    )
    expect(run('cab', 'r', [adjust('left', 'ab > ba / _#'), drop('drop-left')]).surface).toBe('cbr')
    expect(run('cab', 'r', [drop('drop-left'), adjust('left', 'ab > ba / _#')]).surface).toBe('car')
  })
  it('shares class declarations, comments and all four short operations with morphology tweaks', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const text = '; comment\nV=ae\nV > i / _#\n-i\n+x\n^-c\n^+z'
    expect(run('ca', 'r', [adjust('left', text)])).toMatchObject({
      left: 'zx',
      surface: 'zxr',
      valid: true
    })
  })
  it('empty and comment-only tweaks preserve a valid unchanged draft', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('cab-', 'root', [adjust('left', '')])).toMatchObject({
      left: 'cab-',
      right: 'root',
      separator: '',
      valid: true
    })
    expect(run('cab', 'root', [adjust('left', '; comment')])).toMatchObject({
      left: 'cab',
      right: 'root',
      valid: true
    })
  })
  it.each(['ab > ba / abc', 'unrecognized instruction', 'ab → ba / _#'])(
    'rejects an invalid tweak without applying preceding lines: %s',
    (line) => {
      const { p, lang } = fixture(),
        run = prepareCompoundJoin(p, lang)
      const result = run('cab-', '-root', [adjust('left', '+x\n' + line)])
      expect(result).toMatchObject({
        left: 'cab-',
        right: '-root',
        separator: '',
        surface: 'cab--root',
        valid: false,
        issue: 'invalidAdjust'
      })
      expect(result.trace[0].before).toEqual(result.trace[0].after)
      expect(result.trace[0].diagnostics?.length).toBeGreaterThan(0)
    }
  )
  it('retains prior valid changes but never accepts a later invalid tweak as a valid final result', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const result = run('cab', 'root', [
      join('·'),
      adjust('left', '+x\ninvalid'),
      insert('right', 'y')
    ])
    expect(result).toMatchObject({
      left: 'cab',
      right: 'yroot',
      separator: '·',
      surface: 'cab·yroot',
      valid: false
    })
    expect(result.trace[1].before).toEqual(result.trace[1].after)
  })
  it('does not infer errors from marker characters inside valid tweak instructions', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('cab', 'root', [adjust('left', '+✗\n+?')])).toMatchObject({
      left: 'cab✗?',
      valid: true
    })
  })
  it('rejects invalid tweak targets from malformed draft data', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const result = run('cab', 'root', [
      { id: 'bad', kind: 'adjust', side: 'whole', text: '+x' } as unknown as CompoundJoinStep
    ])
    expect(result).toMatchObject({ surface: 'cabroot', valid: false, issue: 'invalidText' })
  })
  it('does not retain errors when a tweak is corrected or reordered on a subsequent evaluation', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('cab', 'r', [adjust('left', 'bad')]).valid).toBe(false)
    expect(run('cab', 'r', [adjust('left', 'ab > ba / _#')])).toMatchObject({
      surface: 'cbar',
      valid: true
    })
    expect(run('cab', 'r', []).surface).toBe('cabr')
  })
  it('retains the legacy morphology interpreter behavior for callers that do not request strict diagnostics', () => {
    const { p, lang } = fixture(),
      trace: string[] = []
    expect(applyAdjust(makeContext(p, lang), 'cab', '+x\nbad', trace, '微调')).toBe('cabx')
    expect(trace).toEqual(['微调 +x: cab → cabx', '微调 ? bad'])
  })
  it('treats dictionary affix edge notation as the junction while deleting the final unit and explicitly setting zero/one connector', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('pre-', 'rootword', []).surface).toBe('pre-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left')]).surface).toBe('pr-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left'), join('')]).surface).toBe('prrootword')
    expect(run('pre-', 'rootword', [drop('drop-left'), join('-')]).surface).toBe('pr-rootword')
    expect(run('pre-', '-rootword', [join('-')]).surface).toBe('pre-rootword')
    expect(run('left-pre-', 'root-word', [drop('drop-left'), join('')]).surface).toBe(
      'left-prroot-word'
    )
  })
  it('preserves registered real delimiter units and delimiter-containing letters instead of stripping them as notation', () => {
    const { p, lang } = fixture()
    lang.alphabet.push('-')
    let run = prepareCompoundJoin(p, lang)
    expect(run('pre-', 'rootword', [join('')]).surface).toBe('pre-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left')]).surface).toBe('prerootword')
    lang.alphabet = ['e-']
    run = prepareCompoundJoin(p, lang)
    expect(run('pre-', 'rootword', [join('')]).surface).toBe('pre-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left')]).surface).toBe('prrootword')
  })
  it('no operation preserves exact source spelling with no implicit connector', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang),
      left = 'þa\u0301',
      right = 'THar'
    const r = run(left, right, [])
    expect(r.surface).toBe(left + right)
    expect(r.left).toBe(left)
    expect(r.right).toBe(right)
    expect(r.separator).toBe('')
    expect(r.trace).toEqual([])
    expect(r.valid).toBe(true)
  })
  it('deletes complete primary-orthography digraphs and counts several units or repetitions', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(
      run('kaath', 'THora', [drop('drop-left', 2), drop('drop-right', 1, 1, 'right')])
    ).toMatchObject({ left: 'ka', right: 'ora', surface: 'kaora', valid: true })
    const repeated = run('katapa', 'r', [drop('drop-left', 1, 3)])
    expect(repeated.left).toBe('kat')
    expect(repeated.trace[0].removed).toEqual(['a', 'p', 'a'])
  })
  it('retains distinct spellings of the same sound instead of transcribing them back to a preferred alias', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    const r = run('þas', 'THar', [drop('drop-left'), drop('drop-right', 1, 1, 'r')])
    expect(r.left).toBe('þa')
    expect(r.right).toBe('ar')
    expect(r.initialUnits.left).toEqual(['þ', 'a', 's'])
    expect(r.initialUnits.right).toEqual(['TH', 'a', 'r'])
  })
  it('uses language alphabet letters as whole units', () => {
    const { p, lang } = fixture()
    lang.alphabet = ['ch', 'a']
    expect(prepareCompoundJoin(p, lang)('ach', 'ta', [drop('drop-left')]).left).toBe('a')
  })
  it('respects an explicit case-sensitive orthography while preserving all source case', () => {
    const { p, lang, ortho } = fixture()
    ortho.caseInsensitive = false
    const run = prepareCompoundJoin(p, lang)
    expect(run('x', 'THora', [drop('drop-right')]).right).toBe('Hora')
    expect(run('x', 'thora', [drop('drop-right')]).right).toBe('ora')
  })
  it('g and IPA-g compare equivalently without rewriting the surviving spelling', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('Gɡ', 'ga', []).surface).toBe('Gɡga')
    expect(run('Gɡ', 'ga', [drop('drop-left')]).left).toBe('G')
  })
  it('protects decomposed marks and keeps untouched text byte-for-byte', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang),
      left = 'ka\u0301'
    expect(run(left, 'b', []).left).toBe(left)
    expect(run(left, 'a\u0301b', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface).toBe(
      'kb'
    )
  })
  it.each(['👩🏽‍🔬', '🇨🇳', '𐀀', '1️⃣'])(
    'never leaves part of an unknown multi-code-point grapheme %s',
    (glyph) => {
      const { p, lang } = fixture(),
        run = prepareCompoundJoin(p, lang)
      expect(
        run('a' + glyph, glyph + 'b', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface
      ).toBe('ab')
    }
  )
  it('does not leave half a tied IPA unit or an attached length/aspiration mark', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('at͡s', 'kʰa', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface).toBe('aa')
    expect(run('kaː', 'b', [drop('drop-left')]).left).toBe('k')
  })
  it('honors explicitly defined modifier units rather than always attaching them', () => {
    const { p, lang } = fixture()
    lang.phonemes.push({ id: 'modifier', symbol: 'ʰ', features: {}, graphemes: {}, notes: '' })
    const r = prepareCompoundJoin(p, lang)('kʰ', 'a', [drop('drop-left')])
    expect(r.left).toBe('k')
    expect(r.initialUnits.left).toEqual(['k', 'ʰ'])
  })
  it('executes real order: an insertion may form a new complete unit removed by a later step', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('t', 'a', [insert('left', 'h'), drop('drop-left')]).surface).toBe('a')
    expect(run('t', 'a', [drop('drop-left'), insert('left', 'h')]).surface).toBe('ha')
  })
  it('inserts at either junction side and then deletes from that current side', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('pa', 'ri', [insert('right', 's'), drop('drop-right')]).surface).toBe('pari')
    expect(run('pa', 'ri', [drop('drop-right'), insert('right', 's')]).surface).toBe('pasi')
  })
  it('supports literal custom connectors, including none, independently from insertion text', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('a', 'b', [join('·')]).surface).toBe('a·b')
    expect(run('a', 'b', [join(' ')]).surface).toBe('a b')
    expect(run('a', 'b', [insert('left', 'x'), join('-'), join('', 'none')]).surface).toBe('axb')
  })
  it('large positive deletion counts clip to available units in constant count arithmetic', () => {
    const { p, lang } = fixture(),
      r = prepareCompoundJoin(p, lang)('ath', 'b', [
        drop('drop-left', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
      ])
    expect(r.left).toBe('')
    expect(r.surface).toBe('b')
    expect(r.trace[0].removed).toEqual(['a', 'th'])
    expect(r.valid).toBe(true)
  })
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid count %s without partially deleting',
    (count) => {
      const { p, lang } = fixture(),
        r = prepareCompoundJoin(p, lang)('ath', 'b', [drop('drop-left', count)])
      expect(r.valid).toBe(false)
      expect(r.issue).toBe('invalidCount')
      expect(r.left).toBe('ath')
      expect(r.trace[0].removed).toEqual([])
    }
  )
  it('rejects invalid repetitions and marks oversized draft sequences explicitly', () => {
    const { p, lang } = fixture(),
      run = prepareCompoundJoin(p, lang)
    expect(run('a', 'b', [drop('drop-left', 1, 0)]).issue).toBe('invalidCount')
    const r = run(
      'a',
      'b',
      Array.from({ length: 101 }, (_, i) => join('-', String(i)))
    )
    expect(r.issue).toBe('tooMany')
    expect(r.valid).toBe(false)
    expect(r.trace).toHaveLength(100)
  })
  it('stores independent before/after snapshots and reports actual removed complete units', () => {
    const { p, lang } = fixture(),
      r = prepareCompoundJoin(p, lang)('kath', 'ra', [
        drop('drop-left'),
        insert('right', 'i'),
        join('-')
      ])
    expect(r.trace.map((t) => t.after.surface)).toEqual(['kara', 'kaira', 'ka-ira'])
    expect(r.trace[1].before.surface).toBe(r.trace[0].after.surface)
    r.trace[0].after.left = 'changed'
    expect(r.trace[1].before.left).toBe('ka')
    expect(r.left).toBe('ka')
  })
  it('passes only the final form into existing creation and leaves both source records unchanged', () => {
    const { p, lang } = fixture(),
      left = createLexeme(lang.id, 'aþ'),
      right = createLexeme(lang.id, 'thb')
    p.lexemes.push(left, right)
    const before = JSON.stringify(p),
      r = prepareCompoundJoin(p, lang)(left.lemma, right.lemma, [
        drop('drop-left'),
        drop('drop-right', 1, 1, 'r')
      ]),
      word = createCompoundLexeme(p, {
        languageId: lang.id,
        firstId: left.id,
        secondId: right.id,
        lemma: r.surface
      })!
    expect(word.lemma).toBe('ab')
    expect(word.etymology.sources).toEqual([
      { kind: 'lexeme', id: left.id },
      { kind: 'lexeme', id: right.id }
    ])
    expect(word.relations).toEqual([])
    expect(JSON.stringify(p)).toBe(before)
  })
})
