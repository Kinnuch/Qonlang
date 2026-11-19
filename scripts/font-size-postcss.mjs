/** 只处理应用的字号声明；布局像素、图标尺寸、导出 HTML 和外部 CSS 保持原样。 */
export default function fontSizePostcss() {
  return {
    postcssPlugin: 'qonlang-font-role-sizes',
    /** @param {import('postcss').Root} root */
    Once(root) {
      const file = (root.source?.input.file ?? '').replaceAll('\\', '/')
      if (!file.includes('/src/renderer/src/')) return
      root.walkRules((rule) => {
        if (/tooltip|\.bubble\b|\.help\b/.test(rule.selector)) return
        let parent = rule.parent
        while (parent) {
          if (
            parent.type === 'atrule' &&
            (parent.name === 'font-face' || /print/.test(parent.params ?? ''))
          )
            return
          parent = parent.parent
        }
        const declarations = rule.nodes.filter((node) => node.type === 'decl')
        for (const declaration of declarations.filter((node) => node.prop === 'font-family')) {
          const match =
            /var\(--font-(corpus-text|corpus-tr|gloss|script|data|mono|ui)(?=[,)\s])/.exec(
              declaration.value
            )
          if (
            match &&
            !rule.nodes.some((node) => node.type === 'decl' && node.prop === '--font-role-scale')
          )
            declaration.cloneAfter({
              prop: '--font-role-scale',
              value: `var(--font-scale-${match[1]}, 1)`
            })
        }
        for (const declaration of declarations.filter((node) => node.prop === 'font-size')) {
          const value = declaration.value
          if (/--font-role-scale/.test(value) || !/\d(?:\.\d+)?(?:px|rem)\b/.test(value)) continue
          declaration.value = `calc(${value} * var(--font-role-scale, 1))`
        }
      })
    }
  }
}
