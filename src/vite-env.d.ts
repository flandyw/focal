/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_CHATGPT_BASE_PATH?: string
  readonly VITE_EXAMTRACK_URL?: string
}
