import type { Project } from '../src/renderer/src/lib/core/model'
import { ensureProjectFolders } from '../src/renderer/src/lib/core/projectFolders'
import { setStrokeNodeMode } from '../src/renderer/src/lib/script/glyphStrokeNodes'

export function addSharedWorkspaceExample(p: Project): void {
  const lang = p.languages.find((l) => l.id === p.settings.defaultLanguageId) ?? p.languages[0]
  if (!lang) return
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
      '语料、短语和文档共享同一棵目录树。在「练习 · Practice」下的「摘录 · Excerpts」打开详情视图，可以同时看到三类记录。侧栏默认收起，点击目录按钮可展开。试着把例句复制或剪切到「校订 · Review」；剪切在成功粘贴后才移动原件。手写板可插入「节点 · Nodes」部件，在节点工具里选择一条笔画，切换平滑或尖锐，或双击曲线插入节点。\n\nCorpus sentences, phrases and documents share a folder tree. Open Practice → Excerpts in Details view to see all three kinds together. Expand the collapsed sidebar to browse. Try copying or cutting the sentence and pasting it in Review. A cut moves the original on paste. In the drawing pad, insert the Nodes component, select its stroke with the node tool, change an anchor between smooth and corner, or double-click the curve to insert an anchor.',
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
      '\n\n在三个模块中打开共享的「摘录 · Excerpts」目录，可练习剪切、复制和粘贴。查看其中的「共享目录 · Shared folder」说明，或在手写板导入「节点 · Nodes」试画平滑笔画。'
}
