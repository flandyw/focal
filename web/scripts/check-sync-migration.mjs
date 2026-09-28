/**
 * Structural checks on the Supabase migration. There is no Postgres in this repository's
 * toolchain, so these do not replace applying the migration — they catch the mistakes that
 * are actually made while editing SQL by hand: an unbalanced dollar-quoted block, a function
 * with no language, an object that was renamed in one place and not another.
 */
import { readFileSync } from "node:fs"

const path = new URL("../supabase/migrations/20260926020000_change_log.sql", import.meta.url)
const sql = readFileSync(path, "utf8")
const failures = []

if ((sql.match(/\$\$/g) ?? []).length % 2 !== 0) failures.push("unbalanced $$ quoting")
if ((sql.match(/^\s*begin;/gm) ?? []).length < 1) failures.push("the migration must run inside a transaction")

for (const match of sql.matchAll(/create or replace function\s+([\w.]+)\s*\(([^)]*)\)\s*\nreturns[\s\S]*?\$\$(.*?)\$\$/g)) {
  const [, name, , body] = match
  if (!/language plpgsql/.test(body.slice(0, 400))) failures.push(`${name} must declare language plpgsql`)
  // A security definer function that never checks the caller is the classic sync hole.
  if (/security definer/.test(body.slice(0, 400)) && !/auth\.uid\(\)/.test(body)) {
    failures.push(`${name} is security definer but never checks auth.uid()`)
  }
}

// The vocabulary must match the clients, which parse the log with these exact names.
for (const entity of ["mistakes", "attempts", "user_state", "folio_notebooks", "folio_pages", "folio_strokes"]) {
  if (!sql.includes(`'${entity}'`)) failures.push(`entity ${entity} is missing from the log`)
}

for (const required of [
  "create table if not exists public.sync_log",
  "create table if not exists public.sync_state",
  "create table if not exists public.sync_floors",
  "create table if not exists public.sync_receipts",
  "create or replace function public.sync_apply_changes",
  "create or replace function public.sync_read_changes",
  "sync_log_receipt_after_insert",
  "sync_log_state_after_insert",
  "compact_sync_log_after_insert",
  "sync_log_mistakes_after_write",
  "sync_log_attempts_after_write",
  "sync_log_user_state_after_write",
  "sync_state_project_web_row_after_change",
  "insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)",
  "Sync v3 tables are missing",
  "A web table is not feeding the sync log",
  "The log is not projected back into the web tables",
]) {
  if (!sql.includes(required)) failures.push(`missing: ${required}`)
}

// Every client call must resolve to a function the migration creates.
for (const call of ["sync_apply_changes", "sync_read_changes"]) {
  if (!sql.includes(`grant execute on function public.${call}`)) failures.push(`${call} is not granted to authenticated`)
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`Sync migration check failed: ${failure}`)
  process.exit(1)
}
console.warn("sync migration structure check passed")
