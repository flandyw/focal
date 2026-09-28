import { expect, test } from "bun:test"
import { RedisStore, resolveRedisCredentials } from "../server/redis-store"

test("accepts current Upstash and Vercel KV REST variable names", () => {
  expect(resolveRedisCredentials({ UPSTASH_REDIS_REST_URL: "https://upstash", UPSTASH_REDIS_REST_TOKEN: "upstash-token" })).toEqual({ url: "https://upstash", token: "upstash-token" })
  expect(resolveRedisCredentials({ KV_REST_API_URL: "https://vercel-kv", KV_REST_API_TOKEN: "kv-token" })).toEqual({ url: "https://vercel-kv", token: "kv-token" })
  expect(resolveRedisCredentials({ KV_REST_API_URL: "https://vercel-kv", KV_REST_API_READ_ONLY_TOKEN: "read-only" })).toBeUndefined()
})

test("adapts the Login with ChatGPT store contract to Redis", async () => {
  const values = new Map<string, unknown>()
  const calls: unknown[][] = []
  const redis = {
    async get<T>(key: string) { return values.get(key) as T | null },
    async set<T>(key: string, value: T, options?: { px: number }) { values.set(key, value); calls.push([key, options]); return "OK" },
    async del(key: string) { values.delete(key); return 1 },
  }
  const store = new RedisStore<{ value: number }>(redis as never, "test:")

  await store.set("session", { value: 7 }, { ttlMs: 1_500 })
  expect(await store.get("session")).toEqual({ value: 7 })
  expect(calls).toEqual([["test:session", { px: 1_500 }]])
  await store.delete("session")
  expect(await store.get("session")).toBeUndefined()
})
