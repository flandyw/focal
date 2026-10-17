import { useCallback, useEffect, useState } from "react"
import { Copy, KeyRound, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { supabase } from "../lib/supabase"

type Token = { id: string; name: string; created_at: string; last_used_at: string | null }

const MCP_URL = "https://focal.flandolf.me/mcp"

/** Personal access tokens for the MCP server (docs/mcp.md). The plaintext is shown once, at creation. */
export function McpTokens() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [name, setName] = useState("")
  const [created, setCreated] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase!.rpc("mcp_token_list")
    if (error) setMessage("Could not load tokens.")
    else setTokens(data as Token[])
  }, [])
  useEffect(() => { void load() }, [load])

  async function create() {
    setMessage(null)
    const { data, error } = await supabase!.rpc("mcp_token_create", { p_name: name })
    if (error) return setMessage(error.message)
    setCreated(data as string)
    setName("")
    void load()
  }

  async function revoke(id: string) {
    const { error } = await supabase!.rpc("mcp_token_revoke", { p_id: id })
    if (error) setMessage("Could not revoke the token.")
    void load()
  }

  const command = `claude mcp add --transport http focal ${MCP_URL} --header "Authorization: Bearer ${created}"`
  return (
    <div className="grid gap-3 py-4">
      <form className="flex max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); void create() }}>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Token name, e.g. Claude Code" aria-label="Token name" maxLength={60} required />
        <Button type="submit"><KeyRound />Create</Button>
      </form>
      {created ? (
        <div className="grid gap-2 rounded-xs border p-3 text-sm">
          <p>Copy this now; it won't be shown again.</p>
          <code className="break-all text-xs">{command}</code>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(created)}><Copy />Copy token</Button>
            <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(command)}><Copy />Copy command</Button>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm text-destructive">{message}</p> : null}
      {tokens.map((token) => (
        <div key={token.id} className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{token.name}</div>
            <div className="text-muted-foreground">Created {new Date(token.created_at).toLocaleDateString()} · {token.last_used_at ? `used ${new Date(token.last_used_at).toLocaleDateString()}` : "never used"}</div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void revoke(token.id)}><Trash2 />Revoke</Button>
        </div>
      ))}
    </div>
  )
}
