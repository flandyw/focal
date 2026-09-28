import {
  createChatGPTHandler,
  type RateLimitBucket,
  type StoredSession,
} from "@opencoredev/loginwithchatgpt-server"
import { createRedisStore } from "./redis-store.js"

export function createChatGPTAuth() {
  const secret = process.env.LWC_SECRET
  if (process.env.NODE_ENV === "production" && !secret) {
    throw new Error("LWC_SECRET is required in production.")
  }
  const sessionStore = createRedisStore<StoredSession>("examtrack:chatgpt:session:")
  const rateLimitStore = createRedisStore<RateLimitBucket>("examtrack:chatgpt:rate:")
  if (process.env.VERCEL && (!sessionStore || !rateLimitStore)) {
    throw new Error("Upstash Redis environment variables are required on Vercel.")
  }

  return createChatGPTHandler({
    secret,
    clientVersion: "0.144.4",
    sessionStore,
    responsesProxy: {
      allowedModels: (model) => /^gpt-(?:5|6)/.test(model),
      maxRequestBytes: 4_400_000,
      rateLimit: { limit: 20, windowMs: 60_000, store: rateLimitStore },
    },
  })
}
