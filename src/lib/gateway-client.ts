import { isSecureEndpoint, supabase } from "./supabase"
import { z } from "zod"

export const CHAT_ENDPOINT = import.meta.env.VITE_CHAT_API_URL?.trim()
  || (import.meta.env.VITE_DESKTOP && !import.meta.env.DEV ? "" : "/api/chat")

export const gatewayCatalogSchema = z.object({
  hasKey: z.boolean(), defaultModel: z.string(), models: z.array(z.object({ id: z.string(), name: z.string() })),
})
export type GatewayCatalog = z.infer<typeof gatewayCatalogSchema>

export async function chatHeaders(userId: string | undefined): Promise<Record<string, string>> {
  if (!isSecureEndpoint(new URL(CHAT_ENDPOINT, window.location.href).href)) throw new Error("Chat needs an HTTPS endpoint or localhost.")
  const session = await supabase?.auth.getSession()
  if (session?.error || !session?.data.session || session.data.session.user.id !== userId) throw new Error("Sign in to Focal again to chat.")
  return { Authorization: `Bearer ${session.data.session.access_token}` }
}
