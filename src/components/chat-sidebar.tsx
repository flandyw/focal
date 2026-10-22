import { useState } from "react"
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import type { LocalChat } from "../lib/chat-history"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog"

export function ChatSidebar({ chats, activeId, disabled, onNew, onSelect, onRename, onDelete }: {
  chats: LocalChat[]
  activeId: string
  disabled: boolean
  onNew: () => void
  onSelect: (chat: LocalChat) => void
  onRename: (chat: LocalChat, title: string) => Promise<void>
  onDelete: (chat: LocalChat) => Promise<void>
}) {
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<LocalChat | null>(null)
  const [deleting, setDeleting] = useState<LocalChat | null>(null)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const terms = search.trim().toLowerCase()
  const matching = chats.filter((chat) => chat.title.toLowerCase().includes(terms) || chat.draft.toLowerCase().includes(terms)
    || chat.messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.toLowerCase().includes(terms))))

  async function change(remove: boolean) {
    const chat = remove ? deleting : editing
    if (!chat || saving || (!remove && !title.trim())) return
    setSaving(true)
    setError("")
    try {
      if (remove) { await onDelete(chat); setDeleting(null) }
      else { await onRename(chat, title.trim()); setEditing(null) }
    } catch { setError("Could not save this change. Your chat has been kept. Try again.") }
    finally { setSaving(false) }
  }

  return <>
    <div className="flex h-full min-h-0 flex-col gap-4 p-3">
      <Button variant="ghost" className="justify-start" disabled={disabled} onClick={onNew}><Plus aria-hidden />New chat</Button>
      <Input aria-label="Search chats" placeholder="Search chats…" className="border-border bg-transparent dark:bg-transparent" value={search} onChange={(event) => setSearch(event.target.value)} />
      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-2 pb-2 text-xs font-medium text-muted-foreground">Your chats</p>
        {matching.map((chat) => <div key={chat.id} className={`group flex items-center rounded-md ${chat.id === activeId ? "bg-accent" : "hover:bg-muted"}`}>
          <Button variant="ghost" disabled={disabled} onClick={() => onSelect(chat)} aria-current={chat.id === activeId ? "page" : undefined} className="h-10 min-w-0 flex-1 justify-start px-2 text-left font-normal" title={`${chat.title} · ${new Date(chat.updatedAt).toLocaleString()}`}>
            <span className="truncate">{chat.title}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="mr-1 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 aria-expanded:opacity-100" disabled={disabled} />} aria-label={`Options for ${chat.title}`}><MoreHorizontal aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => { setEditing(chat); setTitle(chat.title); setError("") }}><Pencil aria-hidden />Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => { setDeleting(chat); setError("") }}><Trash2 aria-hidden />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>)}
        {matching.length === 0 ? <p className="px-2 py-3 text-sm text-muted-foreground">{search ? "No chats match your search." : "Your conversations will appear here after you start chatting."}</p> : null}
      </nav>
      <p className="px-2 text-xs leading-relaxed text-muted-foreground">{disabled ? "Stop the response to switch chats." : "Saved on this device, for your account."}</p>
    </div>
    <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null) }}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); void change(false) }} className="grid gap-4">
          <DialogHeader><DialogTitle>Rename chat</DialogTitle><DialogDescription>Give this conversation a name you can find later.</DialogDescription></DialogHeader>
          <label className="grid gap-2 text-sm">Chat name<Input autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} disabled={saving} /></label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save name"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => { if (!open && !saving) setDeleting(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete this chat?</AlertDialogTitle><AlertDialogDescription>“{deleting?.title}” will be removed from this device. Changes already made to your study data will stay.</AlertDialogDescription></AlertDialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving} onClick={() => { void change(true) }}>{saving ? "Deleting…" : "Delete chat"}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
