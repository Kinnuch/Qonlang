import type { ParsedRule, RuleProgram } from '$lib/engine/sca/parse'
import { changedRuleResult } from '$lib/engine/sca/apply'
import type { RunOptions } from '$lib/engine/sca/apply'
import {
  ExampleWordIndex,
  syntheticExample,
  type RuleExample,
  type SampleReply,
  type SampleMessage
} from '$lib/engine/sca/lexiconSample'

/** 只查当前选中的规则。分批向 worker 提供文字，切行或卸载即停止；不复制工程对象。 */
export function findRuleExample(
  index: ExampleWordIndex,
  program: RuleProgram,
  rule: ParsedRule,
  show: (preview: RuleExample) => void,
  options: RunOptions = {}
): () => void {
  const cached = index.results.get(rule)
  if (cached) {
    show(cached)
    return () => {}
  }
  let worker: Worker | undefined
  let cancelled = false
  let offset = 0
  let timer: ReturnType<typeof setTimeout>
  function finish(result: RuleExample): void {
    worker?.terminate()
    if (cancelled) return
    index.results.set(rule, result)
    show(result)
  }
  // 某些浏览器不允许启动本地 worker。回退时也在小批次之间让出界面线程。
  function fallback(): void {
    if (cancelled) return
    worker?.terminate()
    worker = undefined
    const batch = index.batch(offset)
    const deadline = performance.now() + 3
    for (const entry of batch.words) {
      offset++
      const after = changedRuleResult(program, rule, entry.word, options)
      if (after !== null) {
        finish({ sample: entry.word, after, lemma: entry.lemma })
        return
      }
      if (performance.now() >= deadline) {
        timer = setTimeout(fallback, 0)
        return
      }
    }
    if (batch.done) finish(syntheticExample(program, rule, options))
    else timer = setTimeout(fallback, 0)
  }
  // 快速切换行时，不启动即将丢弃的搜索。
  timer = setTimeout(() => {
    try {
      worker = new Worker(new URL('../engine/sca/sampleWorker.ts', import.meta.url), {
        type: 'module'
      })
      worker.onmessage = (event: MessageEvent<SampleReply>) => {
        if (cancelled || !worker) return
        if (event.data.kind === 'result') {
          finish(event.data.preview)
          return
        }
        const batch = index.batch(offset)
        offset += batch.words.length
        worker.postMessage({ kind: 'batch', ...batch } satisfies SampleMessage)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        offset = 0
        fallback()
      }
      worker.postMessage(
        $state.snapshot({
          kind: 'start',
          rule,
          options,
          program: {
            classes: program.classes,
            replacements: program.replacements,
            syllables: program.syllables,
            hasStress: program.hasStress,
            lines: [],
            steps: [],
            markers: [],
            diagnostics: []
          }
        } satisfies SampleMessage)
      )
    } catch {
      offset = 0
      fallback()
    }
  }, 80)
  return () => {
    cancelled = true
    clearTimeout(timer)
    worker?.terminate()
  }
}
