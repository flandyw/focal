/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_CHATGPT_BASE_PATH?: string
  readonly VITE_FOCAL_WEB_URL?: string
}
