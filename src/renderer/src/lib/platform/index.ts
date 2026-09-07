import type { PlatformAPI } from './types'
import { electronPlatform } from './electron'
import { webPlatform } from './web'

export * from './types'

function detect(): PlatformAPI {
  if (typeof window !== 'undefined' && 'qianyuji' in window) return electronPlatform
  return webPlatform
}

export const platform: PlatformAPI = detect()
