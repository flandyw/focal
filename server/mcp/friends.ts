import { z } from "zod"
import { rpc } from "./store.js"
import type { Define } from "./tools.js"
import { day, instant } from "./util.js"

const timeZone = z.string().max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true } catch { return false }
}, "Use an IANA time zone, e.g. Australia/Melbourne").default("Australia/Melbourne")
const user = { p_user_id: z.uuid() }
const room = { p_id: z.uuid() }

// Reuse the app's user-scoped RPCs; friendship, invitation and sharing checks stay in Postgres.
export function friendTools(define: Define) {
  define("friends_list", "Friends, requests, shared study activity and shared exam results. Visibility follows each friend's privacy settings.", { p_tz: timeZone }, "read", (args) => rpc("friends_list", () => args))
  define("friends_day", "Friends' shared study blocks on a date.", { p_day: day, p_tz: timeZone }, "read", (args) => rpc("friends_day", () => args))
  for (const [name, description] of [
    ["friends_me", "Your social profile and sharing preferences."],
    ["friends_cheers", "Received and sent cheers."],
    ["friends_groups", "Your friend groups and study goals."],
    ["friends_countdowns", "Friends' shared exam countdowns."],
    ["friends_blocked", "Your blocked users."],
    ["friend_study_list", "Shared study sessions, invitations and participants."],
  ]) define(name, description, {}, "read", () => rpc(name, () => ({})))

  define("friends_update_profile", "Save your social profile and privacy preferences. This changes what friends can see.", {
    p_username: z.string().trim().min(3).max(24), p_display_name: z.string().trim().min(1).max(40), p_status_message: z.string().max(60),
    p_share_exams: z.boolean(), p_share_subjects: z.boolean(), p_require_requests: z.boolean(),
  }, "write", (args) => rpc("friends_update_profile", () => args))
  define("friends_add", "Add a friend or send a friend request. Only call when the user asks to connect with this person.", { p_username: z.string().trim().min(1).max(24) }, "write", (args) => rpc("friends_add", () => args))
  for (const [name, description, hint] of [
    ["friends_accept", "Accept a friend request.", "write"],
    ["friends_remove", "Remove a friend, decline an incoming request or cancel an outgoing request.", "delete"],
    ["friends_block", "Block a user and remove the friendship.", "delete"],
    ["friends_unblock", "Unblock a user.", "write"],
  ] as const) define(name, description, user, hint, (args) => rpc(name, () => args))
  define("friends_set_nickname", "Set your private nickname for a friend; null clears it.", { ...user, p_nickname: z.string().max(40).nullable() }, "write", (args) => rpc("friends_set_nickname", () => args))
  define("friends_cheer", "Send a cheer to a friend. Only call when the user explicitly asks to send it.", { ...user, p_message: z.enum(["Good luck!", "Keep going!", "Join me?", "Nice work!"]).nullable() }, "write", (args) => rpc("friends_cheer", () => args))
  define("friends_group_save", "Create or edit a friend group. p_id null creates a group; p_members replaces its membership.", {
    p_id: z.uuid().nullable(), p_name: z.string().trim().min(1).max(40), p_goal_minutes: z.number().int().min(0).max(10080), p_members: z.array(z.uuid()).max(100),
  }, "write", (args) => rpc("friends_group_save", () => args))
  define("friends_group_delete", "Delete one of your friend groups.", room, "delete", (args) => rpc("friends_group_delete", () => args))

  define("friend_study_create", "Create a shared study session and invite members. Only invite people when the user asks. Does not start a personal study timer.", {
    p_title: z.string().trim().min(1).max(80), p_note: z.string().max(500), p_kind: z.enum(["desk", "round"]),
    p_visibility: z.enum(["friends", "invite"]), p_starts_at: instant.nullable(), p_focus_minutes: z.number().int().min(1).max(180),
    p_break_minutes: z.number().int().min(0).max(30), p_members: z.array(z.uuid()).max(100),
  }, "write", (args) => {
    const p_id = crypto.randomUUID()
    return rpc("friend_study_create", () => ({ ...args, p_id }))
  })
  define("friend_study_respond", "Accept, join, decline or leave a shared study session. Personal timers are unchanged.", { ...room, p_action: z.enum(["accept", "join", "decline", "leave"]) }, "write", (args) => rpc("friend_study_respond", () => args))
  define("friend_study_invite", "Invite friends to your shared study session. Only call when the user explicitly asks to invite them.", { ...room, p_members: z.array(z.uuid()).min(1).max(100) }, "write", (args) => rpc("friend_study_invite", () => args))
  define("friend_study_withdraw", "Withdraw a shared-study invitation.", { ...room, ...user }, "delete", (args) => rpc("friend_study_withdraw", () => args))
  define("friend_study_end", "End your shared study session.", room, "delete", (args) => rpc("friend_study_end", () => args))
}
