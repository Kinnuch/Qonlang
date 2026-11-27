import type { Project } from '../src/renderer/src/lib/core/model'
import { ensureProjectFolders } from '../src/renderer/src/lib/core/projectFolders'
import { setStrokeNodeMode } from '../src/renderer/src/lib/script/glyphStrokeNodes'

export function addSharedWorkspaceExample(p: Project): void {
  const lang = p.languages.find((l) => l.id === p.settings.defaultLanguageId) ?? p.languages[0]
  if (!lang) return
  // 用工程已有的词类、标签示范自定义颜色。
  const word = p.lexemes.find((w) => w.languageId === lang.id && w.tags.length && w.posId)
  if (word) {
    p.settings.lexiconTagColors = { ...p.settings.lexiconTagColors, [word.tags[0]]: '#b4d8cb' }
    const pos = p.posList.find((entry) => entry.id === word.posId)
    if (pos) pos.color = '#c4cfee'
  }
  ensureProjectFolders(p)
  delete p.corpusFolders
  delete p.docFolders
  const folderId = 'example-excerpts',
    sentence = p.sentences.find((s) => s.languageId === lang.id),
    phrase = p.phrasebook.find((s) => s.languageId === lang.id)
  if (sentence) sentence.folderId = folderId
  if (phrase) phrase.folderId = folderId
  p.docs.push({
    id: 'example-shared-workspace',
    folderId,
    title: '共享目录 · Shared folder',
    languageId: null,
    markdown:
      '语料、短语和文档共享同一棵目录树。在「练习 · Practice」下的「摘录 · Excerpts」打开详情视图，可以同时看到三类记录。点击「根目录」左侧的小三角可展开或收起整列侧栏。根目录下「练习」的数量包含「摘录」里的例句、短语和文档。试着把例句复制或剪切到「校订 · Review」；剪切在成功粘贴后才移动原件。手写板可插入「节点 · Nodes」部件，在节点工具里选择一条笔画，切换平滑或尖锐，或双击曲线插入节点。\n\nCorpus sentences, phrases and documents share a folder tree. Open Practice → Excerpts in Details view to see all three kinds together. Click the triangle beside Root directory to show or hide the sidebar. In the root directory, Practice includes records in Excerpts in its count. Try copying or cutting the sentence and pasting it in Review. A cut moves the original on paste. In the drawing pad, insert the Nodes component, select its stroke with the node tool, change an anchor between smooth and corner, or double-click the curve to insert an anchor.',
    tags: ['1.1.1'],
    updatedAt: p.meta.updatedAt
  })
  const script = lang.scripts[0]
  if (script)
    script.components = [
      ...(script.components ?? []),
      {
        id: 'example-smooth-pen',
        name: '节点 · Nodes',
        drawing: {
          advance: 760,
          strokes: [
            setStrokeNodeMode(
              {
                points: [
                  [90, 160],
                  [340, 560],
                  [650, 220]
                ],
                width: 48
              },
              1,
              'smooth'
            )
          ]
        }
      }
    ]
  const about = p.docs.find((d) => d.title === '关于这个示例')
  if (about)
    about.markdown +=
      '\n\n在三个模块中打开共享的「摘录 · Excerpts」目录，可练习剪切、复制和粘贴。查看其中的「共享目录 · Shared folder」说明，或在手写板导入「节点 · Nodes」试画平滑笔画。词库中可在单词漏斗里只看带记号的词；在词类或标签的编辑位置可修改徽章颜色。'
  const compound = p.lexemes.find(
    (entry) =>
      entry.languageId === lang.id &&
      entry.etymology.type === 'compound' &&
      entry.etymology.sources.length === 2 &&
      entry.etymology.sources.every((s) => s.kind === 'lexeme')
  )
  if (about && compound) {
    const [first, second] = compound.etymology.sources.map((source) =>
      source.kind === 'lexeme'
        ? p.lexemes.find((entry) => entry.id === source.id)?.lemma
        : undefined
    )
    if (first && second) {
      about.markdown += `\n\n在词库检视器里点击「${compound.lemma}」这个词头，即可在列表中找到它。试着在「新增词条」右侧的小三角里选「新增复合词」，依次选择 ${first} 和 ${second}。在「连接调整」添加一个删前词末音的步骤，看看预览有何变化，再移除这一步。用上下键即可选择相邻词条。若要查看已有词的构词成分，可打开 ${compound.lemma} 的「词源 → 复合」。在语料或短语页切换「单卡画廊」和「瀑布流」，看看同一组记录的不同排法。`
    }
  }
}
