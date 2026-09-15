/**
 * 「生成到词库」的弹框：构形推出来的形式（词库录入里的屈折形、构形页测试台的结果）点一下，
 * 弹出新词条的表单，词源、关系已经按构形填好。
 */
import type { Id, Lexeme } from '$lib/core/model'

export interface NewLexemeRequest {
  languageId: Id
  form: string
  /** 原来的词条；测试台自由输入时没有 */
  base: Lexeme | null
  paradigmId: Id
  slotLabel: string
}

class NewLexemeState {
  req = $state<NewLexemeRequest | null>(null)
  open(r: NewLexemeRequest): void {
    this.req = r
  }
  close(): void {
    this.req = null
  }
}

export const newLexeme = new NewLexemeState()
