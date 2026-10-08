/**
 * 更新日志中英两份：GitHub 发布说明（scripts/release-notes.mjs）和开始页的「更新日志」都从这两份里取，
 * 每个版本段都要两边都有、顺序一样。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '..', '..')
const versions = (file: string): string[] =>
  readFileSync(join(root, file), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('## '))
    .map((l) => l.slice(3).split(' ')[0])

describe('changelog', () => {
  it('has the same versions in Chinese and English', () => {
    const zh = versions('CHANGELOG.md')
    expect(zh.length).toBeGreaterThan(0)
    expect(versions('CHANGELOG.en.md')).toEqual(zh)
  })
})
