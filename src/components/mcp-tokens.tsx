import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, KeyRound, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
  const [revoking, setRevoking] = useState<string | null>(null)
  // "create" or the id of the token being revoked; the ref blocks a second mutation before React re-renders.
  const [pending, setPending] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [list, setList] = useState<"loading" | "ready" | "error">("loading")
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setList("loading")
    try {
      const { data, error } = await supabase!.rpc("mcp_token_list")
      if (error) throw error
      if (sequence !== loadSequence.current) return
      setTokens(data as Token[])
      setList("ready")
    } catch {
      if (sequence === loadSequence.current) setList("error")
    }
  }, [])
  // load updates state only after the token-list RPC resolves.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load() }, [load])

  async function mutate(key: string, action: () => Promise<void>, failure: string) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(key)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage((error as { message?: string } | null)?.message || failure)
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  function create() {
    const trimmed = name.trim()
    if (!trimmed) return setMessage("Enter a token name.")
    void mutate("create", async () => {
      const { data, error } = await supabase!.rpc("mcp_token_create", { p_name: trimmed })
      if (error) throw error
      setCreated(data as string)
      setName("")
      void load()
    }, "Could not create the token.")
  }

  function revoke(id: string) {
    void mutate(id, async () => {
      const { error } = await supabase!.rpc("mcp_token_revoke", { p_id: id })
      if (error) throw error
      setRevoking(null)
      toast.success("Token revoked")
      void load()
    }, "Could not revoke the token.")
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error("Could not copy. Select the text above and copy it manually.")
    }
  }

  const command = `claude mcp add --transport http focal ${MCP_URL} --header "Authorization: Bearer ${created}"`
  return (
    <div className="grid gap-3 py-4">
      <form className="grid max-w-md gap-1.5" onSubmit={(event) => { event.preventDefault(); create() }}>
        <div className="flex gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Token name, e.g. Claude Code" aria-label="Token name" maxLength={60} required disabled={!!pending} aria-invalid={name && !name.trim() ? true : undefined} aria-describedby={name && !name.trim() ? "mcp-token-name-error" : undefined} />
          <Button type="submit" disabled={!!pending || !name.trim()}><KeyRound />{pending === "create" ? "Creating…" : "Create"}</Button>
        </div>
        {name && !name.trim() ? <p id="mcp-token-name-error" className="text-sm text-destructive">Enter a name, not just spaces.</p> : null}
      </form>
      {created ? (
        <div className="grid gap-2 rounded-xs border p-3 text-sm">
          <p>Copy this now; it won't be shown again.</p>
          <code className="break-all text-xs">{command}</code>
          <p className="text-muted-foreground">For connectors that can't send headers (claude.ai), use this URL with no sign-in:</p>
          <code className="break-all text-xs">{`${MCP_URL}/${created}`}</code>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(created, "Token")}><Copy />Copy token</Button>
            <Button variant="outline" size="sm" onClick={() => copy(command, "Command")}><Copy />Copy command</Button>
            <Button variant="outline" size="sm" onClick={() => copy(`${MCP_URL}/${created}`, "URL")}><Copy />Copy URL</Button>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      ) : null}
      {message ? <p role="status" className="text-sm text-destructive">{message}</p> : null}
      {list === "error" ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm"><p>Could not load tokens.</p><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Retry</Button></div>
        : list === "loading" && !tokens.length ? <p role="status" className="text-sm text-muted-foreground">Loading tokens…</p> : null}
      {tokens.map((token) => (
        <div key={token.id} className="flex items-center justify-between gap-4 border-t pt-3 text-sm">
          <div className="min-w-0">
            <div className="font-medium">{token.name}</div>
            <div className="text-muted-foreground">Created {new Date(token.created_at).toLocaleDateString("en-AU")} · {token.last_used_at ? `used ${new Date(token.last_used_at).toLocaleDateString("en-AU")}` : "never used"}</div>
          </div>
          {revoking === token.id
            ? <div className="flex shrink-0 gap-1.5"><Button variant="ghost" size="sm" disabled={!!pending} onClick={() => setRevoking(null)}>Keep</Button><Button variant="destructive" size="sm" disabled={!!pending} onClick={() => revoke(token.id)}><Trash2 />{pending === token.id ? "Revoking…" : "Revoke for good?"}</Button></div>
            : <Button variant="outline" size="sm" disabled={!!pending} onClick={() => setRevoking(token.id)}><Trash2 />Revoke</Button>}
        </div>
      ))}
    </div>
  )
}
