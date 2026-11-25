import type { Project } from '../src/renderer/src/lib/core/model'
import { normalizeEditorSettings } from '../src/renderer/src/lib/script/glyphEditor'

/** 两个公开示例共用同一组练习数据；不改变已有词条、字形或语料的归属。 */
export function addEditorExamples(p: Project): void {
  const lang = p.languages.find((l) => l.id === p.settings.defaultLanguageId) ?? p.languages[0]
  if (!lang) return
  const script = lang.scripts[0]
  if (script)
    script.components = [
      {
        id: 'example-curve-part',
        name: '弧线 · Arc',
        drawing: {
          advance: 700,
          strokes: [],
          contours: [
            {
              cmds: [
                ['M', 100, 240],
                ['C', 180, 560, 480, 720, 600, 590],
                ['Q', 330, 640, 100, 240],
                ['Z']
              ]
            }
          ]
        }
      }
    ]
  p.glyphEditor = {
    presets: [
      {
        id: 'example-grid',
        name: '方格 · Grid',
        settings: normalizeEditorSettings({
          advance: 700,
          width: 45,
          showGrid: true,
          snap: true,
          step: 50,
          originX: 0,
          originY: 0,
          showGuides: true,
          guides: [{ id: 'example-guide', name: '中线', axis: 'x', position: 350 }]
        })
      }
    ]
  }
  p.corpusFolders = [{ id: 'example-practice', name: '练习 · Practice', languageId: lang.id }]
  const about = p.docs.find((d) => d.title === '关于这个示例')
  if (about)
    about.markdown +=
      '\n\n## 文字和语料练习\n\n在文字页切到「部件」可查看弧线。打开一个字符的手写板，调用「方格 · Grid」预设，插入弧线后拖动组合。语料打开时会进入 Default；返回文件夹视图即可看到「练习 · Practice」，可以将练习例句移动到这里。'
}
