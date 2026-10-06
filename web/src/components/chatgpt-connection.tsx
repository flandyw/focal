import { ChatGPTConnectionCard } from "../../../vendor/siwc/react/src/index"
import "../../../vendor/siwc/react/src/styles.css"
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
  return (
    <div className="grid gap-2">
      <ChatGPTConnectionCard
        appName="Focal"
        status={chatgpt.status}
        sharing={chatgpt.sharing}
        identity={chatgpt.identity}
        onConnect={() => void chatgpt.connect(chatgpt.status === "connected")}
        onDisconnect={() => void chatgpt.disconnect()}
        onManageUsage={openUsage}
      />
      {chatgpt.status === "connecting" ? <div><Button size="sm" variant="outline" onClick={() => void chatgpt.cancel()}>Cancel</Button></div> : null}
      {chatgpt.error ? <p role="alert" className="text-sm text-destructive">{chatgpt.error}</p> : null}
    </div>
  )
}
