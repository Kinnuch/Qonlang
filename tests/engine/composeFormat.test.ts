import { describe, expect, it } from 'vitest'
import { createLexeme, createMorpheme, createProject, createSentence } from '$lib/core/factory'
import { analyzeSentence } from '$lib/engine/gloss'
import { tokenize } from '$lib/engine/gloss/tokens'
import { pinChoices } from '$lib/engine/compose'
import { loadComposeInput } from '$lib/engine/composeInput'
import {
  formatComposedText,
  layoutFromTranslation,
  parseComposedText,
  unplacedPunctuationMissing,
  type ComposeFormatOptions,
  type FormatWord
} from '$lib/engine/composeFormat'

const options: ComposeFormatOptions = { capitalize: true, punctuation: 'auto', defaultPeriod: true }
const words = (...forms: string[]): FormatWord[] => forms.map((form, i) => ({ id: 'w' + i, form }))
const format = (forms: string[], translation = '', settings = options) => {
  const ws = words(...forms)
  return formatComposedText(ws, layoutFromTranslation(translation, ws), settings).text
}

describe('workbench surface capitalization and punctuation', () => {
  it('requires a deliberate choice when unplaced punctuation would be lost, with equivalent glyphs counted', () => {
    expect(unplacedPunctuationMissing('Nara!', '，', 'Nara!')).toBe('，')
    expect(unplacedPunctuationMissing('Nara!', '，', 'Nara, bala!')).toBe('')
    expect(unplacedPunctuationMissing('Nara, bala!', '，', 'Nara, bala!')).toBe('，')
    expect(unplacedPunctuationMissing('Nara, bala!', '，', 'Nara, bala, cira!')).toBe('')
  })
  it('maps translation punctuation to readable Latin output with candidate anchors', () => {
    const ws: FormatWord[] = [
      { id: 'a', form: 'amid', sourceAt: 0, sourceEnd: 3 },
      { id: 'l', form: 'light', sourceAt: 1, sourceEnd: 2 },
      { id: 's', form: 'stars', sourceAt: 4, sourceEnd: 6 },
      { id: 'v', form: 'shine', sourceAt: 6, sourceEnd: 8 }
    ]
    const result = formatComposedText(ws, layoutFromTranslation('在光中，星星闪耀！', ws), options)
    expect(result.text).toBe('Amid light, stars shine!')
    expect(result.words.map((w) => w.form)).toEqual(['Amid', 'light', 'stars', 'shine'])
  })
  it('capitalizes after leading quotes and sentence boundaries, keeping the endings inside closing quotes', () => {
    const ws: FormatWord[] = [
      { id: 'a', form: 'nara', sourceAt: 1 },
      { id: 'b', form: 'bala', sourceAt: 4 }
    ]
    expect(formatComposedText(ws, layoutFromTranslation('“你好。再见！”', ws), options).text).toBe(
      '“Nara. Bala!”'
    )
    const source = words('nara')
    const parsed = parseComposedText('“nara”', source)
    expect(formatComposedText(source, parsed.layout, options).text).toBe('“Nara.”')
  })
  it('does not invent punctuation for empty drafts, defaults sentences to a period and leaves phrases alone', () => {
    expect(format([], '你好！')).toBe('')
    expect(format(['nara'])).toBe('Nara.')
    expect(format(['nara'], '', { ...options, defaultPeriod: false })).toBe('Nara')
    expect(format(['nara'], '你好！', { ...options, defaultPeriod: false })).toBe('Nara!')
  })
  it('keeps uncased scripts unchanged and permits explicitly preserving or mapping punctuation', () => {
    const ws: FormatWord[] = [
      { id: 'a', form: '日本', sourceAt: 0 },
      { id: 'b', form: '文字', sourceAt: 3 }
    ]
    expect(
      formatComposedText(
        ws,
        layoutFromTranslation('你好，朋友！', ws, 'character'),
        options,
        'character'
      ).text
    ).toBe('日本，文字！')
    expect(format(['nara'], '你好！', { ...options, punctuation: 'preserve' })).toBe('Nara！')
    expect(format(['nara'], 'hello!', { ...options, punctuation: 'fullwidth' })).toBe('Nara！')
    expect(format(['nara'], '', { ...options, capitalize: false })).toBe('nara.')
    expect(format(['日本abc'])).toBe('日本abc.')
  })
  it('preserves existing punctuation and spacing, lexical apostrophes and manual case when auto case is off', () => {
    const ws = words("'nara", 'bala'),
      parsed = parseComposedText("( 'nara,  bala?! )", ws, "'")
    expect(parsed.valid).toBe(true)
    expect(
      formatComposedText(ws, parsed.layout, {
        ...options,
        capitalize: false,
        punctuation: 'preserve'
      }).text
    ).toBe("( 'nara,  bala?! )")
    expect(parseComposedText("'nara bala", words('nara', 'bala'), "'").valid).toBe(false)
  })
  it('does not copy apostrophes inside words or decimal points as sentence punctuation', () => {
    const ws: FormatWord[] = [
      { id: 'a', form: 'nara', sourceAt: 0 },
      { id: 'b', form: 'bala', sourceAt: 10 }
    ]
    const text = formatComposedText(ws, layoutFromTranslation("don't pay 3.14!", ws), options).text
    expect(text).toBe('Nara bala!')
    expect(format(['3.14nara'])).toBe('3.14Nara.')
  })
  it('keeps manually entered punctuation under reorder and moves host punctuation past attached function words', () => {
    const ws = words('nara', 'bala'),
      parsed = parseComposedText('Nara, bala!', ws)
    const moved = formatComposedText([ws[1], ws[0]], parsed.layout, {
      ...options,
      punctuation: 'preserve'
    })
    expect(moved.text).toContain(',')
    expect(moved.text.endsWith('!')).toBe(true)
    expect(moved.review).toBe(true)
    const one = words('nara'),
      original = parseComposedText('“Nara!”', one)
    const attached: FormatWord[] = [
      { id: 'before', form: 'ka', hostId: 'w0' },
      one[0],
      { id: 'after', form: 'lo', hostId: 'w0' }
    ]
    expect(formatComposedText(attached, original.layout, options).text).toBe('“Ka Nara lo!”')
  })
  it('final editing accepts punctuation/case/spacing but rejects changed words, missing words and swapped IDs', () => {
    const ws = words('nara', 'bala')
    expect(parseComposedText('“NARA”;  bala?', ws).valid).toBe(true)
    expect(parseComposedText('nara cira', ws).valid).toBe(false)
    expect(parseComposedText('nara', ws).valid).toBe(false)
    expect(parseComposedText('bala nara', ws).valid).toBe(false)
    expect(parseComposedText('nara bala extra', ws).valid).toBe(false)
  })
  it('aligns multiword blocks and preserves literal punctuation within their lexical form', () => {
    const ws = words('ar mae', "ka'ra")
    const parsed = parseComposedText("“Ar   mae”, ka'ra.", ws)
    expect(parsed.valid).toBe(true)
    expect(parsed.words.map((w) => w.form)).toEqual(['Ar   mae', "ka'ra"])
  })
  it('keeps interior punctuation at current clause boundaries after moving a framework or a whole clause', () => {
    const translation = '在光中，星星闪耀！',
      ws: FormatWord[] = [
        { id: 'a', form: 'amid', sourceAt: 0, sourceEnd: 3 },
        { id: 'l', form: 'light', sourceAt: 1, sourceEnd: 2 },
        { id: 's', form: 'stars', sourceAt: 4, sourceEnd: 6 },
        { id: 'v', form: 'shine', sourceAt: 6, sourceEnd: 8 }
      ]
    const swapped = [ws[2], ws[3], ws[0], ws[1]],
      reversed = [ws[1], ws[0], ws[2], ws[3]]
    expect(
      formatComposedText(swapped, layoutFromTranslation(translation, swapped), options).text
    ).toBe('Stars shine, amid light!')
    expect(
      formatComposedText(reversed, layoutFromTranslation(translation, reversed), options).text
    ).toBe('Light amid, stars shine!')
    const interleaved = [ws[1], ws[2], ws[0], ws[3]],
      layout = layoutFromTranslation(translation, interleaved)
    expect(layout.review).toBe(true)
    expect(layout.unplaced).toBe('，')
    expect(formatComposedText(interleaved, layout, options).text).not.toContain(', !')
  })
  it('collects paired Unicode punctuation and Arabic sentence marks without losing quote order or spacing', () => {
    const ws: FormatWord[] = [
      { id: 'a', form: 'he', sourceAt: 0, sourceEnd: 1 },
      { id: 'b', form: 'says', sourceAt: 1, sourceEnd: 2 },
      { id: 'c', form: 'amid', sourceAt: 4, sourceEnd: 7 },
      { id: 'd', form: 'light', sourceAt: 5, sourceEnd: 6 }
    ]
    expect(
      formatComposedText(ws, layoutFromTranslation('他说：“在光中！”', ws), options).text
    ).toBe('He says: “Amid light!”')
    expect(format(['nara'], '（你好）', { ...options, punctuation: 'preserve' })).toBe('（Nara.）')
    expect(format(['nara'], '《你好！》', { ...options, punctuation: 'preserve' })).toBe(
      '《Nara！》'
    )
    expect(format(['nara'], '【你好？】', { ...options, punctuation: 'preserve' })).toBe(
      '【Nara？】'
    )
    expect(format(['nara'], 'مرحبا؟')).toBe('Nara?')
  })
  it('extends token edge punctuation narrowly while preserving word symbols and explicit letter overrides', () => {
    expect(tokenize('（Nara） 【bala】 《cira》')).toEqual(['Nara', 'bala', 'cira'])
    expect(tokenize('لغة، كلمة؛ سؤال؟')).toEqual(['لغة', 'كلمة', 'سؤال'])
    expect(tokenize('-ka- /ka/ *ka* _ka_')).toEqual(['-ka-', '/ka/', '*ka*', '_ka_'])
    expect(tokenize('【ka】 سؤال؟', { letters: '【】؟' })).toEqual(['【ka】', 'سؤال؟'])
  })
})

describe('loading existing workbench words without dictionary writes', () => {
  function setup() {
    const project = createProject({
        name: 'Synthetic workbench',
        template: 'blank',
        uiLocale: 'en'
      }),
      language = project.languages[0]
    const first = createLexeme(language.id, 'nara'),
      second = createLexeme(language.id, 'nara')
    first.senses[0].definition.en = 'first'
    second.senses[0].definition.en = 'second'
    project.lexemes.push(first, second)
    return { project, language, first, second }
  }
  it('does not treat an empty new sentence as an existing punctuation template', () => {
    const { project, language } = setup()
    for (const text of ['', '  \n\t'])
      expect(loadComposeInput(project, language.id, text)).toEqual({ words: [], layout: null })
    const punct = loadComposeInput(project, language.id, '“！”')
    expect(punct.words).toEqual([])
    expect(formatComposedText(words('nara'), punct.layout!, options).text).toBe('“Nara!”')
  })
  it('retains the explicitly confirmed homograph ID, exact surface and chosen analysis without touching lemmas', () => {
    const { project, language, first, second } = setup(),
      sentence = createSentence(language.id)
    sentence.text = '“Nara!”'
    sentence.tokens = [
      {
        surface: 'Nara',
        chosen: 1,
        confirmed: true,
        analyses: [
          {
            lexemeId: first.id,
            slot: null,
            morphs: [{ form: 'nara', gloss: 'FIRST', morphemeId: null }]
          },
          {
            lexemeId: second.id,
            slot: 'manual slot',
            morphs: [{ form: 'Nara', gloss: 'MY GLOSS', morphemeId: null, lexemeId: second.id }]
          }
        ]
      }
    ]
    const snapshot = JSON.stringify(project),
      loaded = loadComposeInput(project, language.id, sentence.text, sentence.tokens)
    expect(loaded.words[0].lexemeId).toBe(second.id)
    expect(loaded.words[0].surface).toBe('Nara')
    expect(loaded.words[0].loadedAnalysis?.slot).toBe('manual slot')
    expect(
      formatComposedText(
        loaded.words.map((w) => ({ id: w.id, form: w.surface! })),
        loaded.layout!,
        { ...options, punctuation: 'preserve' }
      ).text
    ).toBe('“Nara!”')
    expect(JSON.stringify(project)).toBe(snapshot)
  })
  it('does not guess an unconfirmed ambiguous analysis or reuse stale tokens', () => {
    const { project, language, first, second } = setup(),
      tokens = [
        {
          surface: 'nara',
          chosen: 1,
          confirmed: false,
          analyses: [
            { lexemeId: first.id, slot: null, morphs: [] },
            { lexemeId: second.id, slot: null, morphs: [] }
          ]
        }
      ]
    expect(
      loadComposeInput(project, language.id, 'Nara.', tokens).words[0].loadedAnalysis
    ).toBeUndefined()
    tokens[0].confirmed = true
    expect(
      loadComposeInput(project, language.id, 'bala.', tokens).words[0].lexemeId
    ).toBeUndefined()
  })
  it('keeps standalone morpheme IDs and compound confirmed analyses', () => {
    const { project, language } = setup(),
      m = createMorpheme(language.id, 'particle')
    m.form = 'ka'
    project.morphemes.push(m)
    const tokens = [
      {
        surface: 'ka',
        chosen: 0,
        confirmed: true,
        analyses: [
          { lexemeId: null, slot: null, morphs: [{ form: 'ka', gloss: 'Q', morphemeId: m.id }] }
        ]
      }
    ]
    const loaded = loadComposeInput(project, language.id, 'ka?', tokens)
    expect(loaded.words[0].morphemeId).toBe(m.id)
    expect(loaded.words[0].loadedAnalysis?.morphs[0].morphemeId).toBe(m.id)
  })
  it('uppercase output words pin the explicitly selected homograph without changing its headword', () => {
    const { project, language, first, second } = setup(),
      sentence = createSentence(language.id)
    sentence.text = 'Nara!'
    analyzeSentence(project, sentence)
    pinChoices(
      sentence.tokens,
      [{ lexemeId: second.id, form: 'Nara', slotKey: null }],
      () => 'second'
    )
    expect(sentence.tokens[0].analyses[sentence.tokens[0].chosen].lexemeId).toBe(second.id)
    expect(sentence.tokens[0].confirmed).toBe(true)
    expect(first.lemma).toBe('nara')
    expect(second.lemma).toBe('nara')
  })
  it('preserves the exact confirmed source analysis including manual gloss and slot after output formatting', () => {
    const { project, language, second } = setup(),
      sentence = createSentence(language.id),
      analysis = {
        lexemeId: second.id,
        slot: 'manual',
        morphs: [{ form: 'nara', gloss: 'MANUAL', morphemeId: null }]
      }
    const loaded = loadComposeInput(project, language.id, '“Nara!”', [
      { surface: 'Nara', chosen: 0, confirmed: true, analyses: [analysis] }
    ])
    sentence.text = '【Nara！】'
    analyzeSentence(project, sentence)
    pinChoices(
      sentence.tokens,
      [
        {
          lexemeId: second.id,
          form: 'Nara',
          slotKey: 'manual',
          analysis: loaded.words[0].loadedAnalysis
        }
      ],
      () => 'automatic'
    )
    expect(sentence.tokens[0].surface).toBe('Nara')
    expect(sentence.tokens[0].confirmed).toBe(true)
    expect(sentence.tokens[0].analyses[sentence.tokens[0].chosen]).toEqual(analysis)
  })
})
