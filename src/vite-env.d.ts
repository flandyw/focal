/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP: boolean
  readonly VITE_APP_VERSION: string
  readonly VITE_COMMIT_HASH: string
  readonly VITE_CHATGPT_BASE_PATH?: string
  readonly VITE_CHAT_API_URL?: string
}
