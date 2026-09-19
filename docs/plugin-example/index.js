/**
 * 千语集示例插件：四种扩展点各用一遍。
 * 复制这个文件夹到「设置 → 插件 → 打开插件目录」里，回来点「重新载入」就能看到效果。
 */
export default {
  activate(qonlang) {
    // 1) 检视器面板：数一数当前语言有多少词、平均多长
    qonlang.ui.addView({
      id: 'stats',
      title: '示例 · 词长统计',
      where: 'inspector',
      sections: ['lexicon'],
      render(el, ctx) {
        const words = (ctx.project?.lexemes ?? []).filter(
          (l) => !ctx.languageId || l.languageId === ctx.languageId
        )
        const avg = words.length
          ? (words.reduce((n, l) => n + l.lemma.length, 0) / words.length).toFixed(2)
          : '0'
        el.textContent = `${words.length} 个词，平均 ${avg} 个字符`
      }
    })

    // 2) 导航页：最长的十个词
    qonlang.ui.addView({
      id: 'longest',
      title: '示例 · 最长的词',
      where: 'page',
      icon: '长',
      render(el, ctx) {
        const list = [...(ctx.project?.lexemes ?? [])]
          .filter((l) => !ctx.languageId || l.languageId === ctx.languageId)
          .sort((a, b) => b.lemma.length - a.lemma.length)
          .slice(0, 10)
        el.innerHTML =
          '<h2>最长的十个词</h2><ol>' +
          list.map((l) => `<li><b>${l.lemma}</b> (${l.lemma.length})</li>`).join('') +
          '</ol>'
      }
    })

    // 3) 命令：Ctrl+K 里能搜到
    qonlang.commands.register({
      id: 'count',
      title: '示例插件：数一数词条',
      detail: '示例插件',
      run() {
        const n = qonlang.project?.lexemes.length ?? 0
        qonlang.ui.toast(`一共有 ${n} 条词条`)
      }
    })

    // 4) 导出：一行一个词，制表符隔开释义
    qonlang.io.registerExporter({
      id: 'tsv',
      name: '示例插件：导出词表 TSV',
      extension: '.tsv',
      run(ctx) {
        return ctx.project.lexemes
          .filter((l) => !ctx.languageId || l.languageId === ctx.languageId)
          .map((l) => `${l.lemma}\t${Object.values(l.senses[0]?.definition ?? {})[0] ?? ''}`)
          .join('\n')
      }
    })

    // 5) 导入：一行一个「词<TAB>释义」
    qonlang.io.registerImporter({
      id: 'tsv',
      name: '示例插件：导入词表 TSV',
      extensions: ['.tsv', '.txt'],
      run(text, ctx) {
        let n = 0
        for (const line of text.split(/\r?\n/)) {
          const [lemma, def] = line.split('\t')
          if (!lemma?.trim()) continue
          qonlang.lexicon.add({
            languageId: ctx.languageId ?? undefined,
            lemma: lemma.trim(),
            definition: (def ?? '').trim()
          })
          n++
        }
        qonlang.ui.toast(`导入了 ${n} 条`)
      }
    })

    // 6) 构形生成器：构形的槽位里可以挑「插件 · 倒过来写」
    qonlang.rules.registerGenerator({
      id: 'reverse',
      name: '倒过来写',
      run(ctx) {
        return [...ctx.stem].reverse().join('')
      }
    })
  }
}
