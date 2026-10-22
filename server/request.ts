/** Null means too large. Count bytes while streaming, before decoding or parsing JSON. */
export async function readRequestText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null
  const reader = request.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks).toString("utf8")
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
}
