/** 例句以现有字号为 100%，只改变阅读文字，不改按钮、项目内容或导出结果。 */
export const CORPUS_TEXT_SIZE_DEFAULT = 100
export const CORPUS_TEXT_SIZE_MIN = 50
export const CORPUS_TEXT_SIZE_MAX = 200
export const CORPUS_TEXT_SIZE_STEP = 5

/** 旧偏好没有这一项；无效或越界的值恢复默认，避免卡片文字消失。 */
export function corpusTextSize(value: unknown): number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= CORPUS_TEXT_SIZE_MIN &&
    value <= CORPUS_TEXT_SIZE_MAX
    ? Math.round(value / CORPUS_TEXT_SIZE_STEP) * CORPUS_TEXT_SIZE_STEP
    : CORPUS_TEXT_SIZE_DEFAULT
}
