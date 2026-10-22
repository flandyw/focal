import { isSecureEndpoint, supabase } from "./supabase"
import { z } from "zod"

export const CHAT_ENDPOINT = import.meta.env.VITE_CHAT_API_URL?.trim()
  || (import.meta.env.VITE_DESKTOP && !import.meta.env.DEV ? "" : "/api/chat")

export const gatewayModelSchema = z.object({
  id: z.string(), name: z.string(),
  contextWindow: z.number().int().positive().nullish(),
  inputPrice: z.number().nonnegative().nullish(),
  outputPrice: z.number().nonnegative().nullish(),
  released: z.number().nonnegative().nullish(),
  tags: z.array(z.string()).default([]),
  intelligence: z.number().nullish(),
  outputSpeed: z.number().positive().nullish(),
  latencySeconds: z.number().nonnegative().nullish(),
})
export type GatewayModel = z.infer<typeof gatewayModelSchema>
export const gatewayCatalogSchema = z.object({
  hasKey: z.boolean(), defaultModel: z.string(), models: z.array(gatewayModelSchema),
  benchmarksUpdatedAt: z.string().datetime().optional(),
})
export type GatewayCatalog = z.infer<typeof gatewayCatalogSchema>

export async function chatHeaders(userId: string | undefined): Promise<Record<string, string>> {
  if (!isSecureEndpoint(new URL(CHAT_ENDPOINT, window.location.href).href)) throw new Error("Chat needs an HTTPS endpoint or localhost.")
  const session = await supabase?.auth.getSession()
  if (session?.error || !session?.data.session || session.data.session.user.id !== userId) throw new Error("Sign in to Focal again to chat.")
  return { Authorization: `Bearer ${session.data.session.access_token}` }
}
