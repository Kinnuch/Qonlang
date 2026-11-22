import type { Glyph, GlyphDrawing } from '$lib/core/model'
import { newId } from '$lib/core/factory'
import { canonicalG } from '$lib/ipa/equivalence'

export const GLYPH_CLIPBOARD_TYPE = 'application/x-qonlang-glyphs+json'
type GlyphRecord = Omit<Glyph, 'id'>

export function encodeGlyphs(glyphs: readonly Glyph[]): string {
  const rows = glyphs.map(({ char, name, value, category, notes, drawing }) => ({
    char,
    name,
    value,
    category,
    notes,
    drawing
  }))
  return JSON.stringify({ version: 1, glyphs: rows })
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
function validDrawing(d: unknown): d is GlyphDrawing {
  if (!record(d) || !finite(d.advance) || !Array.isArray(d.strokes)) return false
  if (
    !d.strokes.every(
      (s) =>
        record(s) &&
        finite(s.width) &&
        Array.isArray(s.points) &&
        s.points.every((p: unknown) => Array.isArray(p) && p.length === 2 && p.every(finite))
    )
  )
    return false
  return (
    d.contours === undefined ||
    (Array.isArray(d.contours) &&
      d.contours.every(
        (c) =>
          record(c) &&
          Array.isArray(c.cmds) &&
          c.cmds.every((cmd: unknown) => {
            if (!Array.isArray(cmd)) return false
            const lens: Record<string, number> = { M: 3, L: 3, Q: 5, C: 7, Z: 1 }
            return (
              typeof cmd[0] === 'string' &&
              lens[cmd[0]] === cmd.length &&
              cmd.slice(1).every(finite)
            )
          })
      ))
  )
}

/** 读取系统剪贴板时仅接收字形字段，目标项目重新分配 ID。 */
export function decodeGlyphs(text: string): GlyphRecord[] | null {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return null
  }
  if (!record(payload) || payload.version !== 1 || !Array.isArray(payload.glyphs)) return null
  const glyphs: GlyphRecord[] = []
  for (const row of payload.glyphs) {
    if (!record(row)) return null
    const { char, name, value, category, notes, drawing } = row
    if (
      typeof char !== 'string' ||
      typeof name !== 'string' ||
      typeof value !== 'string' ||
      typeof category !== 'string' ||
      typeof notes !== 'string' ||
      (drawing !== undefined && !validDrawing(drawing))
    )
      return null
    glyphs.push({ char, name, value, category, notes, ...(drawing ? { drawing } : {}) })
  }
  return glyphs
}

export function pasteGlyphs(existing: readonly Glyph[], rows: readonly GlyphRecord[]): Glyph[] {
  const have = new Set(existing.map((g) => canonicalG(g.char)).filter(Boolean))
  const added: Glyph[] = []
  for (const row of rows) {
    const key = canonicalG(row.char)
    if (key && have.has(key)) continue
    have.add(key)
    added.push({ ...row, id: newId() })
  }
  return added
}
