import { validateUIMessages, type UIMessage } from "ai"
import { z } from "zod"

export const chatMetadataSchema = z.object({
  model: z.string().max(200), createdAt: z.number().nonnegative(),
  latencyMs: z.number().nonnegative().optional(),
  tokensPerSecond: z.number().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
}).optional()
export type ChatMessage = UIMessage<z.infer<typeof chatMetadataSchema>>

const chatSchema = z.object({
  owner: z.string(), id: z.string(), title: z.string().max(200), model: z.string().max(200),
  updatedAt: z.number().nonnegative(), draft: z.string().max(12000), interrupted: z.boolean(),
  messages: z.array(z.unknown()),
})
export type LocalChat = Omit<z.infer<typeof chatSchema>, "messages"> & { messages: ChatMessage[] }
const settingsSchema = z.object({
  owner: z.string(), favourites: z.array(z.string().max(200)), model: z.string().max(200), activeId: z.string(),
})
export type ChatSettings = z.infer<typeof settingsSchema>

let database: Promise<IDBDatabase> | undefined
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("examtrack:chat:v1", 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore("chats", { keyPath: ["owner", "id"] }).createIndex("owner", "owner")
      request.result.createObjectStore("settings", { keyPath: "owner" })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); database = undefined }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error("Local chat storage is unavailable."))
    request.onblocked = () => reject(new Error("Close other Focal tabs and retry local history."))
  }).catch((error: unknown) => { database = undefined; throw error })
  return database
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error("Local chat changes could not be saved."))
    transaction.onerror = () => reject(transaction.error)
  })
}

export function newLocalChat(owner: string, model: string): LocalChat {
  return { owner, id: crypto.randomUUID(), title: "New chat", model, updatedAt: Date.now(), draft: "", interrupted: false, messages: [] }
}

export async function loadLocalChats(owner: string) {
  const db = await openDatabase()
  const transaction = db.transaction(["chats", "settings"], "readonly")
  const [rows, savedSettings] = await Promise.all([
    result(transaction.objectStore("chats").index("owner").getAll(owner) as IDBRequest<unknown[]>),
    result(transaction.objectStore("settings").get(owner) as IDBRequest<unknown>),
  ])
  // shortcut: history loads complete conversations; split out summaries if large archives make opening chat slow.
  const chats = await Promise.all(rows.map(async (row): Promise<LocalChat> => {
    const chat = chatSchema.parse(row)
    if (chat.owner !== owner) throw new Error("Chat account mismatch.")
    return { ...chat, messages: chat.messages.length ? await validateUIMessages<ChatMessage>({ messages: chat.messages, metadataSchema: chatMetadataSchema }) : [] }
  }))
  chats.sort((a, b) => b.updatedAt - a.updatedAt)
  const settings = savedSettings === undefined ? { owner, favourites: [], model: "", activeId: "" } : settingsSchema.parse(savedSettings)
  if (settings.owner !== owner) throw new Error("Chat settings account mismatch.")
  return { chats, settings }
}

export async function saveLocalChat(chat: LocalChat) {
  const db = await openDatabase()
  const transaction = db.transaction("chats", "readwrite")
  transaction.objectStore("chats").put(chat)
  await completed(transaction)
}
export async function deleteLocalChat(owner: string, id: string) {
  const db = await openDatabase()
  const transaction = db.transaction("chats", "readwrite")
  transaction.objectStore("chats").delete([owner, id])
  await completed(transaction)
}
export async function saveChatSettings(settings: ChatSettings) {
  const db = await openDatabase()
  const transaction = db.transaction("settings", "readwrite")
  transaction.objectStore("settings").put(settings)
  await completed(transaction)
}
