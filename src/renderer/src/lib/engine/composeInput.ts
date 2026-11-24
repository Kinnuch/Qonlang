/** 把已有原文和已确认分析载入工作台草稿；不改来源或猜选同形词。 */
import type { Analysis, Project, Token } from '$lib/core/model'
import type { WordSpec } from './attach'
import { tokenize, tokensMatchText } from './gloss/tokens'
import { wordCharsFor } from './gloss'
import { newId } from '$lib/core/factory'
import { parseComposedText, type ComposeLayout } from './composeFormat'

export interface ComposeWordMetadata {
  sourceAt?: number
  sourceEnd?: number
  loadedAnalysis?: Analysis
  loadedForm?: string
  sourceTranslation?: string
}
export type LoadedComposeWord = WordSpec & ComposeWordMetadata & { id: string }

export function loadComposeInput(
  project: Project,
  languageId: string,
  text: string,
  tokens: readonly Token[] = []
): { words: LoadedComposeWord[]; layout: ComposeLayout | null } {
  if (!text.trim()) return { words: [], layout: null }
  const options = {
    mode: project.settings.tokenizer,
    pattern: project.settings.tokenizerPattern,
    letters: wordCharsFor(project, languageId) + (project.settings.tokenizerLetters ?? '')
  }
  const matches = tokensMatchText(
    text,
    tokens.map((token) => token.surface),
    options
  )
  const parts = matches
    ? tokens.map((token) => ({
        form: token.surface,
        analysis: token.confirmed ? token.analyses[token.chosen] : undefined
      }))
    : tokenize(text, options).map((form) => ({ form, analysis: undefined }))
  const words: LoadedComposeWord[] = parts.map(({ form, analysis }) => {
    const single = analysis?.morphs.length === 1 ? analysis.morphs[0] : undefined
    const lexemeId = analysis?.lexemeId ?? single?.lexemeId ?? undefined,
      morphemeId = !lexemeId ? (single?.morphemeId ?? undefined) : undefined
    return {
      id: newId(),
      base: form,
      surface: form,
      lexemeId,
      morphemeId,
      own: null,
      pieces: [],
      mutation: null,
      ...(analysis
        ? { loadedAnalysis: JSON.parse(JSON.stringify(analysis)) as Analysis, loadedForm: form }
        : {})
    }
  })
  if (!words.length) {
    let leading = '',
      trailing = '',
      started = false
    for (const c of Array.from(text)) {
      if (!started && /[\p{Ps}\p{Pi}]/u.test(c)) leading += c
      else {
        started = true
        trailing += c
      }
    }
    return { words, layout: { leading, trailing, before: {}, after: {}, order: [] } }
  }
  const parsed = parseComposedText(
    text,
    words.map((word) => ({ id: word.id, form: word.base })),
    options.letters
  )
  return { words, layout: parsed.valid ? parsed.layout : null }
}
