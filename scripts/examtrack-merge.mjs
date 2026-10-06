// One-shot merge of the ExamTrack project into the Focal project.
//
// Two phases, because the two projects have different auth ids and the mistake photos
// live in storage rather than the database:
//
//   node scripts/examtrack-merge.mjs export --out ../examtrack-export
//   node scripts/examtrack-merge.mjs import --in  ../examtrack-export --to-user <focal-uid>
//
// Both phases authenticate as you, with a user access token, so row-level security
// applies and no service-role key is ever needed or accepted. Get a token from the
// relevant app: sign in, open DevTools -> Application -> Local Storage ->
// `sb-<project-ref>-auth-token` -> `access_token`.
//
// `updated_at` is copied verbatim, never bumped: ExamTrack and Folio resolve
// attempts/mistakes by comparing that timestamp, so a fresh value would make an old row
// look newer than the local copy and the merge would appear to work while silently
// dropping local edits.
//
// ponytail: this is a one-user, one-shot migration. It is idempotent (re-running
// overwrites with the same values) and it never deletes. The upgrade path, if the data
// ever needs to move again, is the same script with a different --to-user.

import { rmSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, extname } from "node:path"
import process from "node:process"

const TABLES = ["attempts", "mistakes"]
const BUCKET = "mistake-attachments"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isUuid(value) {
  return typeof value === "string" && UUID.test(value)
}

// ---------------------------------------------------------------------------
// Pure transforms - the only part worth testing, so the self-check covers these
// ---------------------------------------------------------------------------

export function remapRow(row, fromUser, toUser) {
  assert(isUuid(row?.user_id), `row is missing a user_id uuid: ${JSON.stringify(row?.user_id)}`)
  assert(isUuid(row?.id), `row is missing an id uuid: ${JSON.stringify(row?.id)}`)
  assert(row.user_id === fromUser, `row belongs to ${row.user_id}, expected ${fromUser}`)
  assert(typeof row.updated_at === "string" && !Number.isNaN(Date.parse(row.updated_at)), "row is missing updated_at")
  if (row.deleted_at) {
    // A tombstone must keep a null payload: both tables enforce it.
    assert(row.payload == null, `tombstone ${row.id} carries a payload`)
    return { user_id: toUser, id: row.id, payload: null, updated_at: row.updated_at, deleted_at: row.deleted_at }
  }
  return {
    user_id: toUser,
    id: row.id,
    payload: row.payload ?? null,
    updated_at: row.updated_at,
    deleted_at: null,
  }
}

export function remapAttachmentPath(name, fromUser, toUser) {
  assert(typeof name === "string" && name.length > 0, "attachment path is empty")
  const [folder, ...rest] = name.split("/")
  assert(folder === fromUser, `attachment ${name} is not under the exported account folder`)
  assert(rest.length > 0 && rest.join("/").length > 0, `attachment ${name} has no filename`)
  return [toUser, ...rest].join("/")
}

export function planImport(bundle, toUser) {
  assert(isUuid(bundle?.sourceUserId), "bundle.sourceUserId must be a uuid")
  assert(isUuid(toUser), "--to-user must be a uuid")
  const fromUser = bundle.sourceUserId
  const rows = {}
  for (const table of TABLES) {
    rows[table] = (bundle.tables?.[table] ?? []).map((row) => remapRow(row, fromUser, toUser))
  }
  const attachments = (bundle.attachments ?? []).map((entry) => ({
    localPath: entry.localPath,
    from: entry.path,
    to: remapAttachmentPath(entry.path, fromUser, toUser),
  }))
  return { sourceUserId: fromUser, targetUserId: toUser, rows, attachments }
}

// ---------------------------------------------------------------------------
// Self-check
// ---------------------------------------------------------------------------

function selfTest() {
  const from = "11111111-1111-4111-8111-111111111111"
  const to = "22222222-2222-4222-8222-222222222222"

  const live = remapRow(
    { user_id: from, id: from, payload: { subject: "Chemistry" }, updated_at: "2026-09-01T10:00:00.000Z", deleted_at: null },
    from,
    to,
  )
  assert(live.user_id === to && live.id === from, "live row must move to the target user but keep its id")
  assert(live.updated_at === "2026-09-01T10:00:00.000Z", "updated_at must not be rewritten")
  assert(live.payload.subject === "Chemistry", "payload must survive verbatim")

  const dead = remapRow(
    { user_id: from, id: from, payload: null, updated_at: "2026-09-02T10:00:00.000Z", deleted_at: "2026-09-02T10:00:00.000Z" },
    from,
    to,
  )
  assert(dead.payload === null && dead.deleted_at === "2026-09-02T10:00:00.000Z", "tombstones must survive")

  let threw = false
  try {
    remapRow({ user_id: to, id: from, payload: {}, updated_at: "2026-09-01T10:00:00.000Z" }, from, to)
  } catch {
    threw = true
  }
  assert(threw, "a row from another account must be rejected")

  assert(
    remapAttachmentPath(`${from}/photo.png`, from, to) === `${to}/photo.png`,
    "attachment folders must be rewritten to the target user",
  )
  threw = false
  try {
    remapAttachmentPath("someone-else/photo.png", from, to)
  } catch {
    threw = true
  }
  assert(threw, "an attachment outside the exported folder must be rejected")

  const bundle = {
    sourceUserId: from,
    tables: {
      attempts: [],
      mistakes: [{ user_id: from, id: from, payload: { subject: "Chemistry" }, updated_at: "2026-09-01T10:00:00.000Z", deleted_at: null }],
    },
    attachments: [{ localPath: "files/photo.png", path: `${from}/photo.png` }],
  }
  const first = planImport(bundle, to)
  const second = planImport(bundle, to)
  assert(JSON.stringify(first) === JSON.stringify(second), "the import plan must be idempotent")
  assert(first.rows.mistakes[0].user_id === to, "mistakes must move to the target user")
  assert(first.rows.mistakes[0].id === from, "mistake ids must not be rewritten")
  assert(first.attachments[0].to === `${to}/photo.png`, "attachments must be re-uploaded under the target folder")

  process.stdout.write("ExamTrack merge self-check passed\n")
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function loadSupabase() {
  return (await import("@supabase/supabase-js")).createClient
}

async function readAllRows(client, table) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

async function listObjects(client, prefix) {
  const found = []
  const queue = [prefix]
  while (queue.length > 0) {
    const folder = queue.shift()
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.storage.from(BUCKET).list(folder, { limit: 1000, offset })
      if (error) throw new Error(`${BUCKET}/${folder}: ${error.message}`)
      for (const entry of data) {
        const path = `${folder}/${entry.name}`
        // Storage lists a folder with `id: null` and a file with its object id.
        if (entry.id == null) queue.push(path)
        else found.push(path)
      }
      if (data.length < 1000) break
    }
  }
  return found
}

// The access token is not an API key. PostgREST and Storage authenticate the caller from
// the Authorization header, so the client is keyed with the project's publishable key and
// the user's JWT rides along as a bearer token on every request.
async function makeClient(url, key, token) {
  const createClient = await loadSupabase()
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

// Focal is a Tauri app, so its session never reaches a browser localStorage a human can
// open. It lives in the `preferences` table of the install's SQLite database instead, under
// the same credential key the app uses, and it refreshes on its own while the app runs.
// Reading it here is a convenience for a one-user migration: it saves copying a token that
// expires every hour out of a devtools panel that a Tauri window does not have.
export async function tokenFromFocalDatabase(path) {
  const { DatabaseSync } = await import("node:sqlite")
  const { copyFileSync } = await import("node:fs")
  // Copy first: the app holds this database open with a write-ahead log, and reading the
  // live file would miss anything still sitting in the WAL.
  const snapshot = join(tmpdir(), `focal-merge-${process.pid}.db`)
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      copyFileSync(path + suffix, snapshot + suffix)
    } catch (error) {
      if (suffix === "") throw new Error(`could not read ${path}: ${error.message}`)
    }
  }
  const database = new DatabaseSync(snapshot, { readOnly: true })
  const row = database
    .prepare("select value from preferences where key = ?")
    .get("focal-supabase-auth-session")
  database.close()
  for (const suffix of ["", "-wal", "-shm"]) rmSync(snapshot + suffix, { force: true })
  if (!row) throw new Error("Focal has no stored Supabase session. Sign in in Focal first.")
  let session = JSON.parse(row.value)
  if (typeof session === "string") session = JSON.parse(session)
  assert(session.access_token, "Focal's stored session has no access token")
  return session.access_token
}

// A Buffer arrives with no type, and supabase-js then guesses text/plain, which the
// bucket's allowed_mime_types rejects. The bucket only takes these four.
const MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

function contentTypeFor(path) {
  const extension = extname(path).toLowerCase()
  const type = MIME_TYPES[extension]
  assert(type, `no content type for ${path}; the bucket accepts ${Object.keys(MIME_TYPES).join(", ")}`)
  return type
}

async function runExport(args) {
  const url = args.url ?? process.env.EXAMTRACK_SOURCE_URL
  const key = args.key ?? process.env.EXAMTRACK_SOURCE_PUBLISHABLE_KEY
  const token = args.token ?? process.env.EXAMTRACK_SOURCE_ACCESS_TOKEN
  const out = args.out ?? "./examtrack-export"
  assert(url && key && token, "export needs --url, --key and --token")

  const client = await makeClient(url, key, token)

  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError) throw new Error(`the export token was rejected: ${userError.message}`)
  const sourceUserId = userData.user.id
  console.log(`source project ${url} user ${sourceUserId}`)

  // user_state is not a table: settings live as user_state rows in the ordered feed, and no
  // client reads a mirror of them. There is nothing to export or import for it any more.
  const tables = { attempts: [], mistakes: [] }
  for (const table of TABLES) tables[table] = await readAllRows(client, table)

  for (const table of TABLES) {
    const foreign = tables[table].filter((row) => row.user_id !== sourceUserId)
    assert(foreign.length === 0, `${table} contains ${foreign.length} rows owned by another account`)
  }

  const paths = await listObjects(client, sourceUserId)
  const attachments = []
  for (const path of paths) {
    const { data, error } = await client.storage.from(BUCKET).download(path)
    if (error) throw new Error(`download ${path}: ${error.message}`)
    const localPath = join("files", path.slice(sourceUserId.length + 1))
    const target = join(out, localPath)
    await mkdir(join(target, ".."), { recursive: true })
    await writeFile(target, Buffer.from(await data.arrayBuffer()))
    attachments.push({ localPath, path })
  }

  const bundle = { exportedAt: new Date().toISOString(), sourceUrl: url, sourceUserId, tables, attachments }
  await mkdir(out, { recursive: true })
  await writeFile(join(out, "bundle.json"), `${JSON.stringify(bundle, null, 2)}\n`)

  console.log(`attempts   ${tables.attempts.length}`)
  console.log(`mistakes   ${tables.mistakes.length} (${tables.mistakes.filter((r) => r.deleted_at).length} tombstones)`)
  console.log(`files      ${attachments.length} -> ${out}`)
  console.log(`\nwrote ${join(out, "bundle.json")}`)
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

async function runImport(args) {
  const inDir = args.in ?? "./examtrack-export"
  const url = args.url ?? process.env.FOCAL_TARGET_URL
  const key = args.key ?? process.env.FOCAL_TARGET_PUBLISHABLE_KEY
  assert(url && key, "import needs --url and --key")
  const token = args.token
    ?? process.env.FOCAL_TARGET_ACCESS_TOKEN
    ?? (args.focalDb ? await tokenFromFocalDatabase(args.focalDb) : null)
  assert(token, "import needs --token, or --focal-db <path to focal.db>")

  const client = await makeClient(url, key, token)

  const { data: userData, error: userError } = await client.auth.getUser(token)
  if (userError) throw new Error(`the import token was rejected: ${userError.message}`)
  // The signed-in account is the target, so --to-user is only a way to assert it.
  const toUser = args.toUser ?? userData.user.id
  assert(
    toUser === userData.user.id,
    `--to-user ${toUser} does not match the signed-in account ${userData.user.id}`,
  )

  const bundle = JSON.parse(await readFile(join(inDir, "bundle.json"), "utf8"))
  const plan = planImport(bundle, toUser)
  console.log(`merging ${plan.sourceUserId} -> ${plan.targetUserId}`)

  for (const table of TABLES) {
    const rows = plan.rows[table]
    if (rows.length === 0) {
      console.log(`${table.padEnd(10)} 0`)
      continue
    }
    const onConflict = "user_id,id"
    const { error } = await client.from(table).upsert(rows, { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`${table.padEnd(10)} ${rows.length}`)
  }

  for (const attachment of plan.attachments) {
    const body = await readFile(join(inDir, attachment.localPath))
    const { error } = await client.storage
      .from(BUCKET)
      .upload(attachment.to, body, { upsert: true, contentType: contentTypeFor(attachment.to) })
    if (error) throw new Error(`upload ${attachment.to}: ${error.message}`)
  }
  console.log(`files      ${plan.attachments.length}`)

  // Read back and compare, so a partial import cannot look like a successful one.
  for (const table of TABLES) {
    const { data, error } = await client.from(table).select("*")
    if (error) throw new Error(`${table} verify: ${error.message}`)
    assert(
      data.length === plan.rows[table].length,
      `${table} holds ${data.length} rows after import, expected ${plan.rows[table].length}`,
    )
  }
  console.log("\nverified row counts match the bundle")
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) args._.push(token)
    else {
      // --focal-db becomes args.focalDb, so callers never index a hyphenated key.
      const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      args[key] = argv[++i]
    }
  }
  return args
}

const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)

const usage = () =>
  console.log(
    [
      "usage:",
      "  node scripts/examtrack-merge.mjs selftest",
      "  node scripts/examtrack-merge.mjs export --out ../examtrack-report --url <examtrack url> --key <publishable key> --token <access token>",
      "  node scripts/examtrack-merge.mjs import --in ../examtrack-report --url <focal url> --key <publishable key> --focal-db <path to focal.db>",
    ].join("\n"),
  )

try {
  if (command === "selftest") selfTest()
  else if (command === "export") await runExport(args)
  else if (command === "import") await runImport(args)
  else if (command === undefined) {
    // Bare invocation defaults to the self-check.
    selfTest()
    usage()
  } else {
    usage()
    process.exitCode = 1
  }
} catch (error) {
  console.error(`\n${error.message}`)
  process.exitCode = 1
}
