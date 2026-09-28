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

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
  // user_state is a singleton keyed by user_id and has no id column, so it is remapped
  // by hand rather than through remapRow.
  rows.user_state = (bundle.tables?.user_state ?? []).map((row) => {
    assert(row?.user_id === fromUser, `user_state belongs to ${row?.user_id}, expected ${fromUser}`)
    assert(row?.payload == null || typeof row.payload === "object", "user_state payload must be an object")
    return { user_id: toUser, payload: row.payload ?? {}, updated_at: row.updated_at }
  })
  assert(rows.user_state.length <= 1, "bundle contains more than one user_state row")
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
      user_state: [{ user_id: from, payload: { a: 1 }, updated_at: "2026-09-01T10:00:00.000Z" }],
    },
    attachments: [{ localPath: "files/photo.png", path: `${from}/photo.png` }],
  }
  const first = planImport(bundle, to)
  const second = planImport(bundle, to)
  assert(JSON.stringify(first) === JSON.stringify(second), "the import plan must be idempotent")
  assert(first.rows.user_state[0].user_id === to, "user_state must move to the target user")
  assert(!("id" in first.rows.user_state[0]), "user_state has no id column, so none may be sent")
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
        if (entry.id) queue.push(path)
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

  const tables = { attempts: [], mistakes: [], user_state: [] }
  for (const table of TABLES) tables[table] = await readAllRows(client, table)
  const { data: stateRows, error: stateError } = await client.from("user_state").select("*")
  if (stateError) throw new Error(`user_state: ${stateError.message}`)
  tables.user_state = stateRows

  for (const table of [...TABLES, "user_state"]) {
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
  console.log(`user_state ${tables.user_state.length}`)
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
  const token = args.token ?? process.env.FOCAL_TARGET_ACCESS_TOKEN
  assert(url && key && token, "import needs --url, --key and --token")

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

  for (const table of [...TABLES, "user_state"]) {
    const rows = plan.rows[table]
    if (rows.length === 0) {
      console.log(`${table.padEnd(10)} 0`)
      continue
    }
    const onConflict = table === "user_state" ? "user_id" : "user_id,id"
    const { error } = await client.from(table).upsert(rows, { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`${table.padEnd(10)} ${rows.length}`)
  }

  for (const attachment of plan.attachments) {
    const body = await readFile(join(inDir, attachment.localPath))
    const { error } = await client.storage.from(BUCKET).upload(attachment.to, body, { upsert: true })
    if (error) throw new Error(`upload ${attachment.to}: ${error.message}`)
  }
  console.log(`files      ${plan.attachments.length}`)

  // Read back and compare, so a partial import cannot look like a successful one.
  for (const table of [...TABLES, "user_state"]) {
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
    else args[token.slice(2)] = argv[++i]
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
      "  node scripts/examtrack-merge.mjs import --in ../examtrack-report --url <focal url> --key <publishable key> --token <access token>",
    ].join("\n"),
  )

try {
  if (command === "selftest") selfTest()
  else if (command === "export") await runExport(args)
  else if (command === "import") await runImport(args)
  else if (command === undefined) {
    // Bare invocation is what scripts/check-all.mjs runs, so default to the self-check.
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
