import type { AppApi } from '../shared/类型'

declare global {
  interface Window {
    作息记录: AppApi
  }
}

export {}
