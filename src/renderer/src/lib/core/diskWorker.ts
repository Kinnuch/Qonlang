/**
 * 后台线程：把项目 JSON 排成存盘的格式（缩进、给旧版本带的 register、纯欣赏副本加密）。
 * 几 MB 的项目在主线程排一次要卡一下，存盘、自动保存都放到这里做。
 */
import { serializeForDisk } from './serialize'
import type { Project } from './model'

interface Request {
  id: number
  json: string
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const { id, json } = e.data
  try {
    const text = await serializeForDisk(JSON.parse(json) as Project)
    self.postMessage({ id, text })
  } catch (err) {
    self.postMessage({ id, error: (err as Error).message })
  }
}
