/** 文档→例句只建一次索引，切换语料选择时按ID取，不逐句扫描文档。 */
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import type { Id, Project } from './model'
import { docLink } from './docLinks'
import { renderDocument } from './documentFormat'
import { canonicalG } from '$lib/ipa/equivalence'

export interface SentenceDocReference {
  docId: Id
  title: string
  languageId: Id | null
  kind: 'link' | 'text'
}
const key = (s: string): string => canonicalG(s.trim().replace(/\s+/g, ' '))
/** 普通正文只认足够长的独立完整原句；短词和包含相似字串的段落不当作引用。 */
const standalone = (s: string): boolean =>
  [...s].length >= 8 &&
  (/\s/u.test(s) || /[.!?。！？]$/u.test(s) || (s.match(/\p{Script=Han}/gu)?.length ?? 0) >= 8)
/** 完整段落或成对引号内的完整句子；每个候选直接查索引，不遍历语料。 */
export function sentenceTextMentions(text: string): string[] {
  const candidates = [text]
  for (const match of text.matchAll(
    /“([^“”\n]+)”|‘([^‘’\n]+)’|「([^「」\n]+)」|『([^『』\n]+)』|"([^"\n]+)"|'([^'\n]+)'|«([^«»\n]+)»/gu
  ))
    candidates.push(match.slice(1).find((value) => value !== undefined) ?? '')
  return [...new Set(candidates.map(key).filter(standalone))]
}
export function hasSentenceTextMention(text: string, sentence: string): boolean {
  return sentenceTextMentions(text).includes(key(sentence))
}
export function buildSentenceDocReferences(project: Project): Map<Id, SentenceDocReference[]> {
  const result = new Map<Id, SentenceDocReference[]>(),
    texts = new Map<string, Project['sentences']>()
  for (const sentence of project.sentences) {
    const text = key(sentence.text)
    if (!standalone(text)) continue
    const same = texts.get(text)
    if (same) same.push(sentence)
    else texts.set(text, [sentence])
  }
  for (const doc of project.docs) {
    const found = new Map<Id, 'link' | 'text'>()
    const html = renderDocument(doc, {
      resolve: (inner) => {
        const { ref, hit } = docLink(project, inner, doc.languageId)
        return {
          text: ref.label || ref.name,
          ...(hit ? { target: { kind: hit.kind, id: hit.id } } : {})
        }
      }
    })
    type Node = DefaultTreeAdapterTypes.ChildNode
    const plain = (node: Node): string =>
      node.nodeName === '#text'
        ? (node as DefaultTreeAdapterTypes.TextNode).value
        : 'tagName' in node
          ? ['pre', 'code'].includes(node.tagName)
            ? '\0'
            : node.childNodes.map(plain).join('')
          : ''
    const visit = (node: Node): void => {
      if (!('tagName' in node) || ['pre', 'code'].includes(node.tagName)) return
      if (
        node.tagName === 'a' &&
        node.attrs.some((a) => a.name === 'data-kind' && a.value === 'sentence')
      ) {
        const id = node.attrs.find((a) => a.name === 'data-id')?.value
        if (id) found.set(id, 'link')
      } else if (['p', 'li', 'blockquote', 'div', 'q'].includes(node.tagName)) {
        for (const mention of sentenceTextMentions(plain(node))) {
          const candidates = texts.get(mention) ?? []
          const local = doc.languageId
            ? candidates.filter((s) => s.languageId === doc.languageId)
            : []
          const matches = local.length ? local : candidates
          if (matches.length === 1 && !found.has(matches[0].id)) found.set(matches[0].id, 'text')
        }
      }
      for (const child of node.childNodes) visit(child)
    }
    for (const node of parseFragment(html).childNodes) visit(node)
    for (const [id, kind] of found) {
      const reference = { docId: doc.id, title: doc.title, languageId: doc.languageId, kind }
      const same = result.get(id)
      if (same) same.push(reference)
      else result.set(id, [reference])
    }
  }
  return result
}
