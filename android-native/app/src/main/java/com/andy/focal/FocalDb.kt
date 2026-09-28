package com.andy.focal

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

data class FocalRow(val entity: String, val id: String, val data: JSONObject, val revision: Long = 0)
data class PendingChange(val id: String, val entity: String, val rowId: String, val operation: String, val payload: JSONObject?, val expectedSeq: Long = 0)
data class PendingSessionCommand(val mutationId: String, val sessionId: String, val payload: JSONObject)
data class NativeRemoteRow(val entity: String, val rowId: String, val operation: String, val payload: JSONObject?, val seq: Long)
data class MergeConflict(val entity: String, val rowId: String, val remote: JSONObject?)

class FocalDb(context: Context) : SQLiteOpenHelper(context, "focal-android.db", null, 3) {
    private val appContext = context.applicationContext
    @Volatile private var serverClockMillis: Long? = null
    @Volatile private var serverClockElapsed: Long = 0L
    @Volatile private var serverClockBootCount: Int = -1
    @Volatile private var nativeDeviceId = ""
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE items(account TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,entity,id))")
        db.execSQL("CREATE TABLE outbox(account TEXT NOT NULL, change_id TEXT PRIMARY KEY, entity TEXT NOT NULL, row_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT, base_revision INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE meta(account TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(account,key))")
        db.execSQL("CREATE TABLE conflicts(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, remote_payload TEXT, PRIMARY KEY(account,entity,row_id))")
        db.execSQL("CREATE TABLE notion_conflicts(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, remote_payload TEXT NOT NULL, PRIMARY KEY(account,entity,row_id))")
        db.execSQL("CREATE TABLE notion_outbox(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY(account,entity,row_id))")
        db.execSQL("CREATE TABLE session_commands(account TEXT NOT NULL, order_id INTEGER PRIMARY KEY AUTOINCREMENT, mutation_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, payload TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("ALTER TABLE outbox ADD COLUMN base_revision INTEGER NOT NULL DEFAULT 0")
        if (oldVersion < 3) db.execSQL("CREATE TABLE session_commands(account TEXT NOT NULL, order_id INTEGER PRIMARY KEY AUTOINCREMENT, mutation_id TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, payload TEXT NOT NULL)")
    }

    @Synchronized fun rows(account: String, entity: String): List<FocalRow> {
        val result = mutableListOf<FocalRow>()
        readableDatabase.rawQuery("SELECT id,payload,revision FROM items WHERE account=? AND entity=?", arrayOf(account, entity)).use { c ->
            while (c.moveToNext()) result += FocalRow(entity, c.getString(0), JSONObject(c.getString(1)), c.getLong(2))
        }
        return result
    }
    @Synchronized fun row(account: String, entity: String, id: String): FocalRow? = rows(account, entity).firstOrNull { it.id == id }
    @Synchronized fun pending(account: String): List<PendingChange> {
        val result = mutableListOf<PendingChange>()
        readableDatabase.rawQuery("SELECT change_id,entity,row_id,operation,payload,base_revision FROM outbox WHERE account=? ORDER BY rowid", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += PendingChange(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4)?.let(::JSONObject), c.getLong(5))
        }
        return result
    }
    @Synchronized fun conflicts(account: String): List<MergeConflict> {
        val result = mutableListOf<MergeConflict>()
        readableDatabase.rawQuery("SELECT entity,row_id,remote_payload FROM conflicts WHERE account=?", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += MergeConflict(c.getString(0), c.getString(1), c.getString(2)?.let(::JSONObject))
        }
        return result
    }
    @Synchronized fun notionConflicts(account: String): List<MergeConflict> {
        val result = mutableListOf<MergeConflict>()
        readableDatabase.rawQuery("SELECT entity,row_id,remote_payload FROM notion_conflicts WHERE account=?", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += MergeConflict(c.getString(0), c.getString(1), JSONObject(c.getString(2)))
        }
        return result
    }
    @Synchronized fun setNotionConflict(account: String, entity: String, id: String, remote: JSONObject) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO notion_conflicts(account,entity,row_id,remote_payload) VALUES(?,?,?,?)", arrayOf(account,entity,id,remote.toString()))
    }
    @Synchronized fun clearNotionConflict(account: String, entity: String, id: String) {
        writableDatabase.execSQL("DELETE FROM notion_conflicts WHERE account=? AND entity=? AND row_id=?", arrayOf(account,entity,id))
    }
    @Synchronized fun notionArchives(account: String): List<Triple<String,String,String>> {
        val result = mutableListOf<Triple<String,String,String>>()
        readableDatabase.rawQuery("SELECT entity,row_id,page_id FROM notion_outbox WHERE account=?", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += Triple(c.getString(0), c.getString(1), c.getString(2))
        }
        return result
    }
    @Synchronized fun acknowledgeNotionArchive(account: String, entity: String, id: String) {
        writableDatabase.execSQL("DELETE FROM notion_outbox WHERE account=? AND entity=? AND row_id=?", arrayOf(account,entity,id))
    }
    @Synchronized fun meta(account: String, key: String): String? = readableDatabase.rawQuery(
        "SELECT value FROM meta WHERE account=? AND key=?", arrayOf(account, key)
    ).use { if (it.moveToFirst()) it.getString(0) else null }
    @Synchronized fun setMeta(account: String, key: String, value: String) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO meta(account,key,value) VALUES(?,?,?)", arrayOf(account, key, value))
    }

    @Synchronized fun setDeviceId(value: String) { nativeDeviceId = value }

    @Synchronized fun setServerClock(serverNow: String) {
        val millis = runCatching { java.time.Instant.parse(serverNow).toEpochMilli() }.getOrNull() ?: return
        serverClockMillis = millis
        serverClockElapsed = android.os.SystemClock.elapsedRealtime()
        serverClockBootCount = TimerState.currentBootCount(appContext)
    }
    @Synchronized private fun estimatedServerNow(): String? {
        if (serverClockBootCount < 0 || serverClockBootCount != TimerState.currentBootCount(appContext)) return null
        val elapsed = android.os.SystemClock.elapsedRealtime() - serverClockElapsed
        if (elapsed < 0L) return null
        return serverClockMillis?.let { java.time.Instant.ofEpochMilli(it + elapsed).toString() }
    }

    @Synchronized fun saveLocal(account: String, entity: String, payload: JSONObject) {
        val id = payload.optString("id").takeIf { it.isNotBlank() } ?: error("Missing Focal id")
        val prior = row(account, entity, id)?.data
        val now = java.time.Instant.now().toString()
        payload.put("updated_at", now)
        payload.put("deleted_at", JSONObject.NULL)
        val db = writableDatabase
        db.beginTransaction()
        try {
            if (entity == "study_sessions") {
                enqueueSessionTransition(db, account, prior, payload, id)
                db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,COALESCE((SELECT revision FROM items WHERE account=? AND entity=? AND id=?),0))",
                    arrayOf(account, entity, id, payload.toString(), account, entity, id))
            } else {
                db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,COALESCE((SELECT revision FROM items WHERE account=? AND entity=? AND id=?),0))",
                    arrayOf(account, entity, id, payload.toString(), account, entity, id))
                queue(db, account, entity, id, "put", payload)
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized fun recoverSessionAfterReboot(account: String, id: String) {
        val session = row(account, "study_sessions", id)?.data ?: return
        val execution = session.optJSONObject("execution") ?: return
        val intervals = execution.optJSONArray("intervals") ?: return
        val last = intervals.optJSONObject(intervals.length() - 1) ?: return
        if (last.has("end")) return
        val start = runCatching { java.time.Instant.parse(last.optString("start")) }.getOrNull() ?: return
        last.put("end", start.plusMillis(1).toString())
        val integrations = session.optJSONObject("integrations")
        listOf("examtrack", "folio").forEach { key ->
            integrations?.optJSONObject(key)?.let { source ->
                source.put("phaseBeforePause", source.optString("phase")).put("phase", "paused")
            }
        }
        session.put("state", "paused").put("updated_at", java.time.Instant.now().toString())
        saveLocal(account, "study_sessions", session)
    }

    @Synchronized fun deleteLocal(account: String, entity: String, id: String) {
        val priorRow = row(account, entity, id)
        val prior = priorRow?.data
        if (entity == "study_sessions" && prior != null) {
            val cancelled = JSONObject(prior.toString()).put("deleted_at", java.time.Instant.now().toString())
            val db = writableDatabase
            db.beginTransaction()
            try {
                enqueueSessionTransition(db, account, prior, cancelled, id, forcedAction = "cancel")
                db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, entity, id))
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
            return
        }
        val source = prior?.optJSONObject("source") ?: prior?.optJSONObject("integrations")?.optJSONObject("notion")
        val tombstone = if (source?.optString("type") == "notion") JSONObject().put("notion", JSONObject()
            .put("pageId", source.optString("id")).put("kind", if (entity == "events") "event" else "session")
            .put("localId", id).put("dataSourceId", meta(account, "notion_database") ?: "")) else null
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, entity, id))
            queue(db, account, entity, id, "delete", tombstone, priorRow?.revision)
            if (source?.optString("type") == "notion" && source.optString("id").isNotBlank())
                db.execSQL("INSERT OR REPLACE INTO notion_outbox(account,entity,row_id,page_id) VALUES(?,?,?,?)", arrayOf(account,entity,id,source.getString("id")))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private fun enqueueSessionTransition(
        db: SQLiteDatabase,
        account: String,
        previous: JSONObject?,
        current: JSONObject,
        sessionId: String,
        forcedAction: String? = null
    ) {
        val monoNow = android.os.SystemClock.elapsedRealtime()
        val bootCount = TimerState.currentBootCount(appContext)
        val previousAnchor = previous?.optLong("timing_anchor_elapsed_ms", 0L)?.takeIf { it != 0L }
        val previousBoot = previous?.optInt("timing_anchor_boot_count", -1) ?: -1
        val overrideElapsed = current.optLong("timing_elapsed_override_ms", -1L)
        val rawElapsed = if (previousAnchor != null && previousBoot >= 0 && previousBoot == bootCount)
            monoNow - previousAnchor else 0L
        val elapsed = if (overrideElapsed >= 0L) overrideElapsed.coerceIn(0L, 604_800_000L)
            else rawElapsed.coerceIn(0L, 604_800_000L)
        val pendingCount = db.rawQuery("SELECT COUNT(*) FROM session_commands WHERE account=? AND session_id=?", arrayOf(account, sessionId))
            .use { if (it.moveToFirst()) it.getLong(0) else 0L }
        val occurrenceIsSafe = overrideElapsed < 0L && (
            previousAnchor != null && previousBoot >= 0 && previousBoot == bootCount && rawElapsed in 0L..604_800_000L ||
                previous == null && CanonicalSessionProtocol.state(current) == "running"
        )
        val occurredAt = estimatedServerNow().takeIf { occurrenceIsSafe }
        val expected = (previous?.optLong("revision") ?: current.optLong("revision")).coerceAtLeast(0L) + pendingCount
        val mutationId = UUID.randomUUID().toString()
        val commands = if (forcedAction == null) CanonicalSessionProtocol.command(
            previous, current, deviceIdForLocal(), expected, elapsed, occurredAt, mutationId
        ) else listOf(JSONObject().put("mutation_id", mutationId).put("session_id", sessionId)
            .put("expected_revision", expected).put("action", forcedAction).put("device_id", deviceIdForLocal())
            .put("app", "focal").put("kind", CanonicalSessionProtocol.kind(current))
            .put("phase", CanonicalSessionProtocol.phase(current)).put("title", current.optString("title"))
            .put("subject_id", current.optJSONArray("subjectIds")?.optString(0) ?: JSONObject.NULL)
            .put("metadata", JSONObject().put("legacy_metadata", JSONObject(current.toString())))
            .put("occurred_at", occurredAt ?: JSONObject.NULL).put("elapsed_since_previous_ms", elapsed))
        for (command in commands) {
            val id = command.getString("mutation_id")
            db.execSQL("INSERT INTO session_commands(account,mutation_id,session_id,payload) VALUES(?,?,?,?)",
                arrayOf(account, id, sessionId, command.toString()))
        }
        current.remove("timing_elapsed_override_ms")
        when (commands.lastOrNull()?.optString("action")) {
            "start", "pause", "resume", "phase_change" -> current
                .put("timing_anchor_elapsed_ms", monoNow).put("timing_anchor_boot_count", bootCount)
            "complete", "cancel" -> {
                current.remove("timing_anchor_elapsed_ms")
                current.remove("timing_anchor_boot_count")
            }
            else -> if (previousAnchor != null)
                current.put("timing_anchor_elapsed_ms", previousAnchor).put("timing_anchor_boot_count", previousBoot)
        }
    }

    private fun deviceIdForLocal(): String = nativeDeviceId.takeIf { it.isNotBlank() }
        ?: "00000000-0000-4000-8000-000000000001"

    @Synchronized fun migrateLegacySessionOutbox(account: String, deviceId: String) {
        val legacy = pending(account).filter { it.entity == "study_sessions" }
        for (change in legacy) {
            val payload = change.payload ?: JSONObject().put("id", change.rowId).put("title", "")
            val commands = if (change.operation == "delete" || change.payload == null) listOf(JSONObject()
                .put("mutation_id", change.id).put("session_id", change.rowId).put("expected_revision", 0)
                .put("action", "cancel").put("device_id", deviceId).put("app", "focal")
                .put("kind", "focus").put("phase", "focus").put("title", payload.optString("title"))
                .put("subject_id", JSONObject.NULL).put("metadata", JSONObject())
                .put("occurred_at", JSONObject.NULL).put("elapsed_since_previous_ms", 0))
            else CanonicalSessionProtocol.command(null, payload, deviceId, 0, 0, null, change.id)
            for (command in commands) {
                writableDatabase.execSQL("INSERT OR IGNORE INTO session_commands(account,mutation_id,session_id,payload) VALUES(?,?,?,?)",
                    arrayOf(account, command.getString("mutation_id"), command.getString("session_id"), command.toString()))
            }
            acknowledge(change.id)
        }
    }

    @Synchronized fun pendingSessionCommands(account: String): List<PendingSessionCommand> {
        val result = mutableListOf<PendingSessionCommand>()
        readableDatabase.rawQuery("SELECT mutation_id,session_id,payload FROM session_commands WHERE account=? ORDER BY order_id", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += PendingSessionCommand(c.getString(0), c.getString(1), JSONObject(c.getString(2)))
        }
        return result
    }

    @Synchronized fun rebaseSessionCommand(account: String, mutationId: String, command: JSONObject): String {
        val nextId = command.optString("mutation_id").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString().also { command.put("mutation_id", it) }
        writableDatabase.execSQL("UPDATE session_commands SET mutation_id=?, payload=? WHERE account=? AND mutation_id=?",
            arrayOf(nextId, command.toString(), account, mutationId))
        return nextId
    }

    private fun localCanonicalSession(canonical: JSONObject): JSONObject {
        val local = CanonicalSessionProtocol.toLocal(canonical)
        if (CanonicalSessionProtocol.state(local) !in setOf("running", "paused")) return local
        val boundary = canonical.optString("timing_at").takeIf { it.isNotBlank() }
            ?: if (canonical.optString("state") == "running") canonical.optString("segment_started_at").takeIf { it.isNotBlank() }
            else canonical.optString("paused_at").takeIf { it.isNotBlank() }
        val serverNow = estimatedServerNow()?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
        val boundaryMillis = boundary?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
        val elapsed = if (serverNow != null && boundaryMillis != null) serverNow - boundaryMillis else -1L
        if (elapsed in 0L..604_800_000L) {
            local.put("timing_anchor_elapsed_ms", android.os.SystemClock.elapsedRealtime() - elapsed)
                .put("timing_anchor_boot_count", TimerState.currentBootCount(appContext))
        }
        return local
    }

    @Synchronized fun finishSessionCommand(account: String, mutationId: String, canonical: JSONObject?, seq: Long) {
        val command = pendingSessionCommands(account).firstOrNull { it.mutationId == mutationId } ?: return
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("DELETE FROM session_commands WHERE account=? AND mutation_id=?", arrayOf(account, mutationId))
            val remaining = db.rawQuery("SELECT 1 FROM session_commands WHERE account=? AND session_id=? LIMIT 1", arrayOf(account, command.sessionId)).use { it.moveToFirst() }
            if (!remaining && canonical != null) {
                val local = localCanonicalSession(canonical)
                db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
                    arrayOf(account, "study_sessions", command.sessionId, local.toString(), seq))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized fun finishTerminalSessionCommands(account: String, sessionId: String, canonical: JSONObject?, seq: Long) {
        writableDatabase.execSQL("DELETE FROM session_commands WHERE account=? AND session_id=?", arrayOf(account, sessionId))
        if (canonical != null) {
            val local = localCanonicalSession(canonical)
            writableDatabase.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
                arrayOf(account, "study_sessions", sessionId, local.toString(), seq))
        }
    }

    @Synchronized fun applyCanonicalSession(account: String, id: String, payload: JSONObject, seq: Long) {
        val pending = readableDatabase.rawQuery("SELECT 1 FROM session_commands WHERE account=? AND session_id=? LIMIT 1", arrayOf(account, id)).use { it.moveToFirst() }
        if (pending) return
        val local = localCanonicalSession(payload)
        writableDatabase.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
            arrayOf(account, "study_sessions", id, local.toString(), seq))
    }

    @Synchronized fun applySnapshot(account: String, rows: List<NativeRemoteRow>, head: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val present = rows.mapTo(mutableSetOf()) { it.entity + "\\u0000" + it.rowId }
            val pending = pending(account).mapTo(mutableSetOf()) { it.entity + "\\u0000" + it.rowId }
            val pendingSessions = pendingSessionCommands(account).mapTo(mutableSetOf()) { it.sessionId }
            db.rawQuery("SELECT entity,id FROM items WHERE account=?", arrayOf(account)).use { cursor ->
                while (cursor.moveToNext()) {
                    val entity = cursor.getString(0); val id = cursor.getString(1)
                    val protected = if (entity == "study_sessions") id in pendingSessions else entity + "\\u0000" + id in pending
                    if (!protected && entity + "\\u0000" + id !in present)
                        db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, entity, id))
                }
            }
            for (row in rows) {
                if (row.entity == "study_sessions") {
                    if (row.rowId !in pendingSessions) {
                        if (row.operation == "delete") db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, row.entity, row.rowId))
                        else row.payload?.let { db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
                            arrayOf(account, row.entity, row.rowId, localCanonicalSession(it).toString(), row.seq)) }
                    }
                } else if (row.rowId.let { row.entity + "\\u0000" + it } !in pending) {
                    if (row.operation == "delete") db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, row.entity, row.rowId))
                    else row.payload?.let { db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
                        arrayOf(account, row.entity, row.rowId, it.toString(), row.seq)) }
                }
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized fun recordStale(account: String, entity: String, rowId: String, current: JSONObject?) {
        writableDatabase.execSQL("INSERT OR REPLACE INTO conflicts(account,entity,row_id,remote_payload) VALUES(?,?,?,?)",
            arrayOf(account, entity, rowId, current?.toString()))
    }

    private fun queue(db: SQLiteDatabase, account: String, entity: String, id: String, operation: String, payload: JSONObject?, baseRevision: Long? = null) {
        val revision = baseRevision ?: db.rawQuery("SELECT revision FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account,entity,id))
            .use { if (it.moveToFirst()) it.getLong(0) else 0L }
        db.execSQL("DELETE FROM outbox WHERE account=? AND entity=? AND row_id=?", arrayOf(account, entity, id))
        db.execSQL("INSERT INTO outbox(account,change_id,entity,row_id,operation,payload,base_revision) VALUES(?,?,?,?,?,?,?)",
            arrayOf(account, UUID.randomUUID().toString(), entity, id, operation, payload?.toString(), revision))
    }

    @Synchronized fun applyRemote(account: String, entity: String, id: String, operation: String, payload: JSONObject?, revision: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            val pending = db.rawQuery("SELECT 1 FROM outbox WHERE account=? AND entity=? AND row_id=?", arrayOf(account, entity, id)).use { it.moveToFirst() }
            if (pending) {
                val localRevision = db.rawQuery("SELECT base_revision FROM outbox WHERE account=? AND entity=? AND row_id=?", arrayOf(account,entity,id))
                    .use { if (it.moveToFirst()) it.getLong(0) else 0L }
                if (revision > localRevision) db.execSQL("INSERT OR REPLACE INTO conflicts(account,entity,row_id,remote_payload) VALUES(?,?,?,?)",
                    arrayOf(account, entity, id, if (operation == "delete") null else payload?.toString()))
            } else if (operation == "delete") {
                db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, entity, id))
                val notion = payload?.optJSONObject("notion")
                if (notion?.optString("pageId")?.isNotBlank() == true)
                    db.execSQL("INSERT OR REPLACE INTO notion_outbox(account,entity,row_id,page_id) VALUES(?,?,?,?)", arrayOf(account,entity,id,notion.getString("pageId")))
            } else if (payload != null) {
                db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,?)",
                    arrayOf(account, entity, id, payload.toString(), revision))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    @Synchronized fun acknowledge(changeId: String) { writableDatabase.execSQL("DELETE FROM outbox WHERE change_id=?", arrayOf(changeId)) }
    @Synchronized fun resolve(account: String, conflict: MergeConflict, keepLocal: Boolean) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            if (keepLocal) {
                val local = row(account, conflict.entity, conflict.rowId)?.data
                queue(db, account, conflict.entity, conflict.rowId, if (local == null) "delete" else "put", local)
            } else {
                db.execSQL("DELETE FROM outbox WHERE account=? AND entity=? AND row_id=?", arrayOf(account, conflict.entity, conflict.rowId))
                if (conflict.remote == null) db.execSQL("DELETE FROM items WHERE account=? AND entity=? AND id=?", arrayOf(account, conflict.entity, conflict.rowId))
                else db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,0)",
                    arrayOf(account, conflict.entity, conflict.rowId, conflict.remote.toString()))
            }
            db.execSQL("DELETE FROM conflicts WHERE account=? AND entity=? AND row_id=?", arrayOf(account, conflict.entity, conflict.rowId))
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    // ponytail: guest records merge only after the signed-in account has pulled its remote state.
    @Synchronized fun mergeGuest(account: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("""INSERT OR IGNORE INTO conflicts(account,entity,row_id,remote_payload)
                SELECT ?,guest.entity,guest.id,signed.payload FROM items guest
                JOIN items signed ON signed.account=? AND signed.entity=guest.entity AND signed.id=guest.id
                WHERE guest.account='guest' AND guest.payload<>signed.payload""", arrayOf(account,account))
            db.execSQL("INSERT OR IGNORE INTO items(account,entity,id,payload,revision) SELECT ?,entity,id,payload,0 FROM items WHERE account='guest'", arrayOf(account))
            db.execSQL("UPDATE outbox SET account=? WHERE account='guest'", arrayOf(account))
            db.execSQL("UPDATE session_commands SET account=? WHERE account='guest'", arrayOf(account))
            db.execSQL("INSERT OR IGNORE INTO notion_outbox(account,entity,row_id,page_id) SELECT ?,entity,row_id,page_id FROM notion_outbox WHERE account='guest'", arrayOf(account))
            db.execSQL("INSERT OR IGNORE INTO notion_conflicts(account,entity,row_id,remote_payload) SELECT ?,entity,row_id,remote_payload FROM notion_conflicts WHERE account='guest'", arrayOf(account))
            db.execSQL("INSERT OR IGNORE INTO meta(account,key,value) SELECT ?,key,value FROM meta WHERE account='guest' AND key IN ('notion_database','timer')", arrayOf(account))
            db.execSQL("DELETE FROM items WHERE account='guest'")
            db.execSQL("DELETE FROM notion_outbox WHERE account='guest'")
            db.execSQL("DELETE FROM notion_conflicts WHERE account='guest'")
            db.execSQL("DELETE FROM meta WHERE account='guest' AND key IN ('notion_database','timer')")
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
}
