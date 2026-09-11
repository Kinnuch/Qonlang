/**
 * 各模块顶栏搜索认得的字段名（写成 字段=内容）。key 是英文名，aliases 里放中文名与缩写。
 */
import type { SearchField } from './query'

const f = (key: string, ...aliases: string[]): SearchField => ({ key, aliases })

export const SEARCH_FIELDS: Record<string, SearchField[]> = {
  lexicon: [
    f('word', 'w', 'lemma', '单词', '词', '词头'),
    f('gloss', 'g', 'def', 'meaning', '释义', '义项'),
    f('form', 'forms', '屈折形'),
    f('stem', 'stems', '词干'),
    f('ipa', 'pron', '发音'),
    f('pos', '词类'),
    f('tag', 'tags', '标签'),
    f('register', 'reg', '语域'),
    f('etym', 'etymology', '词源'),
    f('note', 'notes', '备注'),
    f('script', '文字')
  ],
  morphemes: [
    f('form', 'word', 'w', '形式', '单词'),
    f('gloss', 'g'),
    f('meaning', 'def', '意义', '释义'),
    f('type', '类型'),
    f('allo', 'allomorph', '异体形'),
    f('tag', 'tags', '标签'),
    f('note', 'notes', '备注')
  ],
  corpus: [
    f('text', 'word', 'w', '原文', '单词', '词'),
    f('gloss', 'g'),
    f('morph', 'seg', '切分'),
    f('tr', 'translation', '译文'),
    f('source', 'src', '出处'),
    f('tag', 'tags', '标签'),
    f('note', 'notes', '备注')
  ],
  phrasebook: [
    f('text', 'word', 'w', '原文'),
    f('tr', 'translation', '译文'),
    f('category', 'cat', '分类'),
    f('tag', 'tags', '标签'),
    f('ipa', 'pron', '发音')
  ],
  docs: [f('title', '标题'), f('body', 'text', '正文')],
  languages: [f('name', '名称'), f('abbr', '缩写'), f('note', 'notes', '备注')],
  paradigms: [f('slot', 'label', '槽位'), f('gloss', 'abbr', '缩写')],
  script: [f('char', '字符'), f('value', '转写'), f('name', '名称'), f('category', 'cat', '分类')],
  phonology: [
    f('symbol', '符号'),
    f('feature', '特征'),
    f('class', '音类'),
    f('note', 'notes', '备注')
  ],
  skin: [f('name', 'family', '字体'), f('tag', 'tags', '标签')]
}
