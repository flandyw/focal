import { useCallback, useEffect, useState } from "react"
import { supabase, withSupabaseSession } from "../lib/supabase"
import { Button } from "./ui/button"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"

export function GatewaySettings({ userId }: { userId: string }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setError("")
    try {
      const result = await withSupabaseSession(userId, () => supabase!.rpc("ai_gateway_key_status", { p_expected_user_id: userId }))
      if (result.error || typeof result.data !== "boolean") throw new Error()
      setHasKey(result.data)
    } catch { setError("Could not load your saved key. Try again.") }
  }, [userId])
  // Loading state follows the account-scoped status request.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function save(remove = false) {
    if (busy) return
    const apiKey = key.trim()
    if (!remove && (!apiKey || apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(apiKey))) {
      setError("Enter a valid Vercel AI Gateway API key.")
      return
    }
    setBusy(true)
    setError("")
    setMessage("")
    try {
      const result = await withSupabaseSession(userId, () => remove
        ? supabase!.rpc("ai_gateway_key_delete", { p_expected_user_id: userId })
        : supabase!.rpc("ai_gateway_key_save", { p_expected_user_id: userId, p_api_key: apiKey }))
      if (result.error) throw new Error()
      setKey("")
      setHasKey(!remove)
      setMessage(remove ? "Gateway key removed." : "Gateway key saved securely.")
    } catch { setError(remove ? "Could not remove your key. Try again." : "Could not save your key. Try again.") }
    finally { setBusy(false) }
  }

  return <form className="grid max-w-xl gap-4 py-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
    <p role="status" className="text-sm text-muted-foreground">{hasKey === null ? error ? "Saved key status unavailable." : "Checking saved key…" : hasKey ? "A Gateway key is saved to your account." : "No Gateway key saved."}</p>
    <Field>
      <FieldLabel htmlFor="gateway-api-key">{hasKey ? "Replace Gateway API key" : "Gateway API key"}</FieldLabel>
      <Input id="gateway-api-key" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} maxLength={4096} disabled={busy || hasKey === null} placeholder={hasKey ? "Paste a replacement key" : "Paste your Vercel AI Gateway API key"} aria-describedby="gateway-key-help" />
      <FieldDescription id="gateway-key-help">Encrypted in Supabase Vault and used by the chat server. Your saved key is never displayed. Usage is billed to your Gateway account.</FieldDescription>
    </Field>
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={busy || hasKey === null || !key.trim()}>{busy ? "Saving…" : hasKey ? "Replace key" : "Save key"}</Button>
      {hasKey ? <Button variant="outline" disabled={busy} onClick={() => { void save(true) }}>Remove key</Button> : null}
      {error && hasKey === null ? <Button variant="outline" onClick={() => { void load() }}>Retry</Button> : null}
    </div>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </form>
}
