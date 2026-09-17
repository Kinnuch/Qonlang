/**
 * 检查更新的状态：右下角的更新提示与设置页的「立即检查」共用。
 * 自动检查尊重「跳过这个版本」「稍后再说」；手动检查查到了就一定弹出来。
 */
import { platform, type UpdateCheck, type UpdateInfo } from '$lib/platform'
import { ui } from './ui.svelte'

class Updates {
  /** 正在提示的新版本 */
  info = $state<UpdateInfo | null>(null)
  checking = $state(false)
  /** 最近一次检查的结果 */
  last = $state<UpdateCheck | null>(null)
  /** 正在下载或安装：不再查 */
  busy = false
  /** 这次运行里点过「稍后再说」的版本：同一个版本不再反复弹，出了更新的版本照样提示 */
  dismissed = ''

  async check(manual = false): Promise<UpdateCheck | null> {
    if (this.busy || this.checking) return null
    // 已经在提示了也不再自动查——除非那时 Release 上还没有本机的安装包（另一个平台的包先传完了），
    // 再查一次，传上来了就换成能直接装的
    if (!manual && (!ui.prefs.checkUpdates || this.info?.installer)) return null
    this.checking = true
    try {
      const r = await platform.checkUpdate()
      this.last = r
      const found = r.status === 'newer' ? r.info : undefined
      if (found) {
        if (manual) this.info = found
        else if (this.info && found.version !== this.info.version) return r
        else if (found.version !== ui.prefs.skippedVersion && found.version !== this.dismissed)
          this.info = found
      }
      return r
    } catch {
      const r: UpdateCheck = { status: 'failed', error: 'offline' }
      this.last = r
      return r
    } finally {
      this.checking = false
    }
  }
}

export const updates = new Updates()
