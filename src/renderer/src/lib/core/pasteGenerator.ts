import type { SlotGenerator } from './model'
import { newId } from './factory'

/** 贴进来的生成方式：整份拷贝，流水线的每一步换新 id（同一页里不会撞键） */
export function pastedGenerator(g: SlotGenerator): SlotGenerator {
  const c = JSON.parse(JSON.stringify(g)) as SlotGenerator
  if (c.kind === 'pipeline') c.steps = c.steps.map((s) => ({ ...s, id: newId() }))
  return c
}
