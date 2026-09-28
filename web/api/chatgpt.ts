import { createChatGPTAuth } from "../server/chatgpt.js"

const chatgptAuth = createChatGPTAuth()

export default {
  fetch(request: Request) {
    const url = new URL(request.url)
    const path = url.searchParams.get("lwcPath")
    if (path) {
      url.pathname = `/api/chatgpt/${path}`
      url.searchParams.delete("lwcPath")
    }
    return chatgptAuth.handler(new Request(url, request))
  },
}
