import {
  firstChangedExample,
  syntheticExample,
  type SampleMessage,
  type SampleReply
} from './lexiconSample'

let current: Extract<SampleMessage, { kind: 'start' }>
const reply = (message: SampleReply): void => self.postMessage(message)
self.onmessage = (event: MessageEvent<SampleMessage>) => {
  const message = event.data
  if (message.kind === 'start') {
    current = message
    reply({ kind: 'more' })
    return
  }
  const hit = firstChangedExample(current.program, current.rule, message.words, current.options)
  if (hit || message.done)
    reply({
      kind: 'result',
      preview: hit ?? syntheticExample(current.program, current.rule, current.options)
    })
  else reply({ kind: 'more' })
}
