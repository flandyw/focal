import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { CredentialEncryption } from "../vendor/siwc/local/src/index"

const SERVICE = "focal-chatgpt"
const ACCOUNT = "credential-key"

function run(command: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { encoding: "utf8", windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
    child.stdin?.end(input)
  })
}

const powershell = (script: string, input?: string) => run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], input)

/**
 * Fetches (or creates) the 256-bit key protecting saved ChatGPT credentials from the OS store:
 * Keychain on macOS, Secret Service on Linux, DPAPI on Windows. There is no plaintext fallback.
 */
async function loadKey(directory: string): Promise<Buffer> {
  if (process.platform === "darwin") {
    const find = () => run("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"])
    try { return Buffer.from(await find(), "hex") } catch { /* first run */ }
    const key = randomBytes(32).toString("hex")
    // ponytail: `security` takes the secret as an argument, so it is briefly visible to same-user `ps`; swap for a native keychain binding if that matters.
    await run("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", ACCOUNT, "-w", key])
    return Buffer.from(await find(), "hex")
  }
  if (process.platform === "linux") {
    const find = () => run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT])
    try { const found = await find(); if (found) return Buffer.from(found, "hex") } catch { /* first run */ }
    await run("secret-tool", ["store", "--label=Focal ChatGPT", "service", SERVICE, "account", ACCOUNT], randomBytes(32).toString("hex"))
    return Buffer.from(await find(), "hex")
  }
  if (process.platform === "win32") {
    const path = join(directory, "chatgpt-key.dpapi")
    const dpapi = (mode: "Protect" | "Unprotect") => `Add-Type -AssemblyName System.Security; $in=[Console]::In.ReadToEnd().Trim(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${mode}([Convert]::FromBase64String($in),$null,'CurrentUser'))`
    try { return Buffer.from(await powershell(dpapi("Unprotect"), (await readFile(path, "utf8")).trim()), "base64") } catch { /* first run */ }
    const key = randomBytes(32)
    await writeFile(path, await powershell(dpapi("Protect"), key.toString("base64")), { mode: 0o600 })
    return key
  }
  throw new Error(`No OS credential store is available on ${process.platform}.`)
}

export function createOsCredentialEncryption(directory: string): CredentialEncryption {
  let key: Promise<Buffer> | undefined
  const getKey = () => (key ??= loadKey(directory).then((value) => {
    if (value.length !== 32) throw new Error("The OS credential store returned an invalid key.")
    return value
  })).catch((error) => { key = undefined; throw error })
  return {
    id: "focal-os-keystore-aes256gcm-v1",
    async isAvailable() { try { await getKey(); return true } catch { return false } },
    async encrypt(plaintext) {
      const iv = randomBytes(12)
      const cipher = createCipheriv("aes-256-gcm", await getKey(), iv)
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), body]))
    },
    async decrypt(ciphertext) {
      const data = Buffer.from(ciphertext)
      const decipher = createDecipheriv("aes-256-gcm", await getKey(), data.subarray(0, 12))
      decipher.setAuthTag(data.subarray(12, 28))
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8")
    },
  }
}
