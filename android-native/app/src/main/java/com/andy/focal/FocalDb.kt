package com.andy.focal

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

data class FocalRow(val entity: String, val id: String, val data: JSONObject, val revision: Long = 0)
data class PendingChange(val id: String, val entity: String, val rowId: String, val operation: String, val payload: JSONObject?)
data class MergeConflict(val entity: String, val rowId: String, val remote: JSONObject?)

class FocalDb(context: Context) : SQLiteOpenHelper(context, "focal-android.db", null, 2) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE items(account TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(account,entity,id))")
        db.execSQL("CREATE TABLE outbox(account TEXT NOT NULL, change_id TEXT PRIMARY KEY, entity TEXT NOT NULL, row_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT, base_revision INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE meta(account TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(account,key))")
        db.execSQL("CREATE TABLE conflicts(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, remote_payload TEXT, PRIMARY KEY(account,entity,row_id))")
        db.execSQL("CREATE TABLE notion_conflicts(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, remote_payload TEXT NOT NULL, PRIMARY KEY(account,entity,row_id))")
        db.execSQL("CREATE TABLE notion_outbox(account TEXT NOT NULL, entity TEXT NOT NULL, row_id TEXT NOT NULL, page_id TEXT NOT NULL, PRIMARY KEY(account,entity,row_id))")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) db.execSQL("ALTER TABLE outbox ADD COLUMN base_revision INTEGER NOT NULL DEFAULT 0")
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
        readableDatabase.rawQuery("SELECT change_id,entity,row_id,operation,payload FROM outbox WHERE account=? ORDER BY rowid", arrayOf(account)).use { c ->
            while (c.moveToNext()) result += PendingChange(c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4)?.let(::JSONObject))
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

    @Synchronized fun saveLocal(account: String, entity: String, payload: JSONObject) {
        val id = payload.optString("id").takeIf { it.isNotBlank() } ?: error("Missing Focal id")
        val now = java.time.Instant.now().toString()
        payload.put("updated_at", now)
        payload.put("deleted_at", JSONObject.NULL)
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.execSQL("INSERT OR REPLACE INTO items(account,entity,id,payload,revision) VALUES(?,?,?,?,COALESCE((SELECT revision FROM items WHERE account=? AND entity=? AND id=?),0))",
                arrayOf(account, entity, id, payload.toString(), account, entity, id))
            queue(db, account, entity, id, "put", payload)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    @Synchronized fun deleteLocal(account: String, entity: String, id: String) {
        val priorRow = row(account, entity, id)
        val prior = priorRow?.data
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
