import type { PlatformAPI } from './types'
import { electronPlatform } from './electron'
import { webPlatform } from './web'

export * from './types'

function detect(): PlatformAPI {
  if (typeof window !== 'undefined' && 'qianyuji' in window) return electronPlatform
  return webPlatform
}

export const platform: PlatformAPI = detect()

/** 导出守卫：返回 true 就拦下（纯欣赏项目开着时）；content 是要写出去的文本 */
let exportGuard: ((content?: string) => boolean) | null = null
export function setExportGuard(fn: (content?: string) => boolean): void {
  exportGuard = fn
}
const rawSaveText = platform.saveTextFile.bind(platform)
const rawExportFolder = platform.exportFolder.bind(platform)
const rawExportPdf = platform.exportPdf.bind(platform)
platform.saveTextFile = (name, content) =>
  exportGuard?.(content) ? Promise.resolve(false) : rawSaveText(name, content)
platform.exportFolder = (files, name) =>
  exportGuard?.() ? Promise.resolve(false) : rawExportFolder(files, name)
platform.exportPdf = (html, name) =>
  exportGuard?.() ? Promise.resolve(false) : rawExportPdf(html, name)
