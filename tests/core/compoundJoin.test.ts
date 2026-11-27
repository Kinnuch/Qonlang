import { describe, expect, it } from 'vitest'
import { createLexeme, createProject } from '$lib/core/factory'
import { prepareCompoundJoin, type CompoundJoinStep } from '$lib/core/compoundJoin'
import { createCompoundLexeme } from '$lib/core/compoundBuilder'
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
describe('compound joining draft pipeline', () => {
  it('treats dictionary affix edge notation as the junction while deleting the final unit and explicitly setting zero/one connector', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
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
    const { lang } = fixture()
    lang.alphabet.push('-')
    let run = prepareCompoundJoin(lang)
    expect(run('pre-', 'rootword', [join('')]).surface).toBe('pre-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left')]).surface).toBe('prerootword')
    lang.alphabet = ['e-']
    run = prepareCompoundJoin(lang)
    expect(run('pre-', 'rootword', [join('')]).surface).toBe('pre-rootword')
    expect(run('pre-', 'rootword', [drop('drop-left')]).surface).toBe('prrootword')
  })
  it('no operation preserves exact source spelling with no implicit connector', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang),
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
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(
      run('kaath', 'THora', [drop('drop-left', 2), drop('drop-right', 1, 1, 'right')])
    ).toMatchObject({ left: 'ka', right: 'ora', surface: 'kaora', valid: true })
    const repeated = run('katapa', 'r', [drop('drop-left', 1, 3)])
    expect(repeated.left).toBe('kat')
    expect(repeated.trace[0].removed).toEqual(['a', 'p', 'a'])
  })
  it('retains distinct spellings of the same sound instead of transcribing them back to a preferred alias', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    const r = run('þas', 'THar', [drop('drop-left'), drop('drop-right', 1, 1, 'r')])
    expect(r.left).toBe('þa')
    expect(r.right).toBe('ar')
    expect(r.initialUnits.left).toEqual(['þ', 'a', 's'])
    expect(r.initialUnits.right).toEqual(['TH', 'a', 'r'])
  })
  it('uses language alphabet letters as whole units', () => {
    const { lang } = fixture()
    lang.alphabet = ['ch', 'a']
    expect(prepareCompoundJoin(lang)('ach', 'ta', [drop('drop-left')]).left).toBe('a')
  })
  it('respects an explicit case-sensitive orthography while preserving all source case', () => {
    const { lang, ortho } = fixture()
    ortho.caseInsensitive = false
    const run = prepareCompoundJoin(lang)
    expect(run('x', 'THora', [drop('drop-right')]).right).toBe('Hora')
    expect(run('x', 'thora', [drop('drop-right')]).right).toBe('ora')
  })
  it('g and IPA-g compare equivalently without rewriting the surviving spelling', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(run('Gɡ', 'ga', []).surface).toBe('Gɡga')
    expect(run('Gɡ', 'ga', [drop('drop-left')]).left).toBe('G')
  })
  it('protects decomposed marks and keeps untouched text byte-for-byte', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang),
      left = 'ka\u0301'
    expect(run(left, 'b', []).left).toBe(left)
    expect(run(left, 'a\u0301b', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface).toBe(
      'kb'
    )
  })
  it.each(['👩🏽‍🔬', '🇨🇳', '𐀀', '1️⃣'])(
    'never leaves part of an unknown multi-code-point grapheme %s',
    (glyph) => {
      const { lang } = fixture(),
        run = prepareCompoundJoin(lang)
      expect(
        run('a' + glyph, glyph + 'b', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface
      ).toBe('ab')
    }
  )
  it('does not leave half a tied IPA unit or an attached length/aspiration mark', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(run('at͡s', 'kʰa', [drop('drop-left'), drop('drop-right', 1, 1, 'r')]).surface).toBe('aa')
    expect(run('kaː', 'b', [drop('drop-left')]).left).toBe('k')
  })
  it('honors explicitly defined modifier units rather than always attaching them', () => {
    const { lang } = fixture()
    lang.phonemes.push({ id: 'modifier', symbol: 'ʰ', features: {}, graphemes: {}, notes: '' })
    const r = prepareCompoundJoin(lang)('kʰ', 'a', [drop('drop-left')])
    expect(r.left).toBe('k')
    expect(r.initialUnits.left).toEqual(['k', 'ʰ'])
  })
  it('executes real order: an insertion may form a new complete unit removed by a later step', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(run('t', 'a', [insert('left', 'h'), drop('drop-left')]).surface).toBe('a')
    expect(run('t', 'a', [drop('drop-left'), insert('left', 'h')]).surface).toBe('ha')
  })
  it('inserts at either junction side and then deletes from that current side', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(run('pa', 'ri', [insert('right', 's'), drop('drop-right')]).surface).toBe('pari')
    expect(run('pa', 'ri', [drop('drop-right'), insert('right', 's')]).surface).toBe('pasi')
  })
  it('supports literal custom connectors, including none, independently from insertion text', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
    expect(run('a', 'b', [join('·')]).surface).toBe('a·b')
    expect(run('a', 'b', [join(' ')]).surface).toBe('a b')
    expect(run('a', 'b', [insert('left', 'x'), join('-'), join('', 'none')]).surface).toBe('axb')
  })
  it('large positive deletion counts clip to available units in constant count arithmetic', () => {
    const { lang } = fixture(),
      r = prepareCompoundJoin(lang)('ath', 'b', [
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
      const { lang } = fixture(),
        r = prepareCompoundJoin(lang)('ath', 'b', [drop('drop-left', count)])
      expect(r.valid).toBe(false)
      expect(r.issue).toBe('invalidCount')
      expect(r.left).toBe('ath')
      expect(r.trace[0].removed).toEqual([])
    }
  )
  it('rejects invalid repetitions and marks oversized draft sequences explicitly', () => {
    const { lang } = fixture(),
      run = prepareCompoundJoin(lang)
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
    const { lang } = fixture(),
      r = prepareCompoundJoin(lang)('kath', 'ra', [
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
      r = prepareCompoundJoin(lang)(left.lemma, right.lemma, [
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
