/**
 * 存盘用的文本：交给后台线程（diskWorker）排版、加密；没有 Worker（测试、网页版起不来时）就在当前线程做，结果一样。
 */
import { serializeForDisk } from './serialize'
import type { Project } from './model'

type Waiting = { resolve: (text: string) => void; reject: (e: Error) => void }

let worker: Worker | null | undefined
let seq = 0
const waiting = new Map<number, Waiting>()

function failAll(message: string): void {
  for (const w of waiting.values()) w.reject(new Error(message))
  waiting.clear()
}

function diskWorker(): Worker | null {
  if (worker !== undefined) return worker
  if (typeof Worker === 'undefined') return (worker = null)
  try {
    worker = new Worker(new URL('./diskWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; text?: string; error?: string }>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      waiting.delete(e.data.id)
      if (e.data.error !== undefined) w.reject(new Error(e.data.error))
      else w.resolve(e.data.text ?? '')
    }
    // 线程起不来（文件被拦、加载失败）：以后都在当前线程做
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      failAll('worker')
    }
  } catch {
    worker = null
  }
  return worker
}

/** 项目的 JSON（JSON.stringify 出来的）→ 写进文件的文本 */
export async function diskTextFromJson(json: string): Promise<string> {
  const w = diskWorker()
  if (w) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const id = ++seq
        waiting.set(id, { resolve, reject })
        w.postMessage({ id, json })
      })
    } catch {
      // 交给下面在当前线程做
    }
  }
  return serializeForDisk(JSON.parse(json) as Project)
}
