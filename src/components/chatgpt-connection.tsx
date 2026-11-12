import { ExternalLink } from "lucide-react"
import { ChatGPTConnectionCard } from "../../vendor/siwc/react/src/index"
import { ChatGPTMark } from "../../vendor/siwc/react/src/shared"
import "../../vendor/siwc/react/src/styles.css"
import { useChatGPT } from "../lib/chatgpt-client"
import { Button } from "./ui/button"

// A real link click, so the desktop shell's external-link handler opens it in the system browser.
function openUsage() {
  const link = Object.assign(document.createElement("a"), { href: "https://chatgpt.com/settings/usage", target: "_blank", rel: "noopener noreferrer" })
  document.body.append(link)
  link.click()
  link.remove()
}

/** Official Sign in with ChatGPT connection UI, wired to the local service. */
export function ChatGPTConnection() {
  const chatgpt = useChatGPT()
  if (chatgpt.status === "loading") return <p className="text-sm text-muted-foreground">Checking ChatGPT connection…</p>
  if (chatgpt.status === "unavailable") {
    return <p className="text-sm text-muted-foreground">The local ChatGPT service is not running. Restart Focal to try again.</p>
  }
  if (chatgpt.status === "connected") {
    const { identity, sharing } = chatgpt
    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background dark:[&_img]:invert"><ChatGPTMark kind="usage" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{identity?.name || "Connected with ChatGPT"}</p>
            <p className="truncate text-sm text-muted-foreground">{[identity?.email, sharing ? "Usage sharing on" : "Usage sharing off"].filter(Boolean).join(" · ")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {sharing
              ? <Button size="sm" variant="outline" aria-label="Manage ChatGPT usage (opens in browser)" onClick={openUsage}>Manage usage<ExternalLink /></Button>
              : <Button size="sm" variant="outline" onClick={() => void chatgpt.connect(true)}>Enable usage sharing</Button>}
            <Button size="sm" variant="ghost" onClick={() => void chatgpt.disconnect()}>Disconnect</Button>
          </div>
        </div>
        {chatgpt.error ? <p role="alert" className="text-sm text-destructive">{chatgpt.error}</p> : null}
      </div>
    )
  }
  return (
    <div className="grid gap-2">
      <ChatGPTConnectionCard
        appName="Focal"
        status={chatgpt.status}
        sharing={chatgpt.sharing}
        identity={chatgpt.identity}
        onConnect={() => void chatgpt.connect(false)}
      />
      {chatgpt.status === "connecting" ? <div><Button size="sm" variant="outline" onClick={() => void chatgpt.cancel()}>Cancel</Button></div> : null}
      {chatgpt.error ? <p role="alert" className="text-sm text-destructive">{chatgpt.error}</p> : null}
    </div>
  )
}
