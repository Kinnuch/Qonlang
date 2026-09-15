import { COLLATION_TAIL } from './collate'
import { MOVE_BIAS } from './move'
import { FLASH_SEQ } from '$lib/ui/flash'
import { SYLLABLE_MARKS } from '$lib/engine/phon'
import { PACK_ORDER } from '$lib/script/pack'

const HEAD = 'QONLANG-VIEW:1:'

function material(): string {
  return [
    [...COLLATION_TAIL].reverse().join(''),
    String.fromCharCode(...FLASH_SEQ.map((n) => n - 7)),
    SYLLABLE_MARKS,
    [...PACK_ORDER].filter((_, i) => i % 2 === 0).join(''),
    atob(MOVE_BIAS)
  ].join('')
}

let cached: Promise<CryptoKey> | null = null
function key(): Promise<CryptoKey> {
  cached ??= crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(material()))
    .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  return cached
}

async function pipe(
  data: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer()
  return new Uint8Array(out)
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function isSealed(text: string): boolean {
  return text.startsWith(HEAD)
}

export async function sealText(plain: string): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(plain), new CompressionStream('deflate-raw'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), packed)
  )
  const all = new Uint8Array(iv.length + body.length)
  all.set(iv)
  all.set(body, iv.length)
  return HEAD + toBase64(all)
}

export async function unsealText(text: string): Promise<string> {
  const all = fromBase64(text.slice(HEAD.length).trim())
  const iv = all.slice(0, 12)
  const body = all.slice(12)
  const packed = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), body)
  )
  return new TextDecoder().decode(await pipe(packed, new DecompressionStream('deflate-raw')))
}
