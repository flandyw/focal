package com.andy.focal

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException
import java.util.UUID

data class NotionSettings(val database: String, val title: String, val date: String, val type: String, val completed: String, val subject: String)

class NotionSync(private val db: FocalDb, private val secrets: SecretStore) {
    private val base = "https://api.notion.com/v1"
    private fun headers(token: String) = mapOf("Authorization" to "Bearer $token", "Notion-Version" to "2022-06-28")
    private fun call(token: String, method: String, path: String, body: JSONObject? = null): JSONObject =
        request(method, "$base$path", body, headers(token))
    private fun text(value: String): JSONArray {
        require(value.length <= 200_000) { "Notion text is too long to sync safely." }
        return JSONArray().apply {
        value.chunked(2000).forEach { put(JSONObject().put("type", "text").put("text", JSONObject().put("content", it))) }
        }
    }
    private fun rich(value: String) = JSONObject().put("rich_text", text(value))
    private fun propertyText(property: JSONObject?): String {
        if (property == null) return ""
        for (key in listOf("title", "rich_text")) {
            val array = property.optJSONArray(key) ?: continue
            return (0 until array.length()).joinToString("") { array.optJSONObject(it)?.optString("plain_text")
                ?.ifBlank { array.optJSONObject(it)?.optJSONObject("text")?.optString("content").orEmpty() }.orEmpty() }
        }
        return property.optJSONObject("select")?.optString("name")
            ?: property.optJSONObject("status")?.optString("name") ?: property.optString("url")
    }
    private fun iso(value: String?): String? = try {
        if (value.isNullOrBlank()) null else if (value.length == 10) LocalDate.parse(value).atStartOfDay(ZoneId.systemDefault()).toInstant().toString()
        else Instant.parse(value).toString()
    } catch (_: DateTimeParseException) { value?.let { runCatching { java.time.OffsetDateTime.parse(it).toInstant().toString() }.getOrNull() } }
    private fun minute(value: String?): String? = iso(value)?.let { Instant.parse(it).let { instant -> Instant.ofEpochSecond(instant.epochSecond / 60 * 60).toString() } }
    private fun config(account: String): NotionSettings {
        val settings = db.row(account, "user_settings", "user_settings")?.data
        fun pref(key: String, fallback: String) = if (settings?.has(key) == true) settings.optString(key) else fallback
        return NotionSettings(
            pref("notion_data_source_id", db.meta(account, "notion_database") ?: ""),
            pref("notion_title_property", "Name"), pref("notion_date_property", "Date"),
            pref("notion_type_property", "Type"), pref("notion_completed_property", "Complete"),
            pref("notion_subject_property", "Subject")
        )
    }
    fun settings(account: String) = config(account)
    fun token() = secrets.get("notion_token").orEmpty()
    fun saveSettings(account: String, token: String, mapping: NotionSettings) {
        val database = mapping.database.trim()
        require(database.isBlank() || database.matches(Regex("[a-fA-F0-9-]{32,36}"))) { "Enter a Notion database ID." }
        require(mapping.title.isNotBlank() && mapping.date.isNotBlank()) { "Title and date property names are required." }
        secrets.put("notion_token", token.trim().takeIf { it.isNotEmpty() })
        db.setMeta(account, "notion_database", database.trim())
        val settings = db.row(account, "user_settings", "user_settings")?.data ?: JSONObject()
        settings.put("notion_data_source_id", database.trim())
        settings.put("notion_title_property", mapping.title.trim())
        settings.put("notion_date_property", mapping.date.trim())
        settings.put("notion_type_property", mapping.type.trim())
        settings.put("notion_completed_property", mapping.completed.trim())
        settings.put("notion_subject_property", mapping.subject.trim())
        // The desktop client stores a singleton row under this id.
        settings.put("id", "user_settings")
        db.saveLocal(account, "user_settings", settings)
    }

    suspend fun sync(account: String): Int = withContext(Dispatchers.IO) {
        val token = token()
        val settings = config(account)
        if (token.isBlank() || settings.database.isBlank()) return@withContext 0
        val schemaPage = call(token, "GET", "/databases/${settings.database}")
        var schema = schemaPage.getJSONObject("properties")
        if (!schema.has("Focal ID") || !schema.has("Focal Kind")) {
            val add = JSONObject()
            if (!schema.has("Focal ID")) add.put("Focal ID", JSONObject().put("rich_text", JSONObject()))
            if (!schema.has("Focal Kind")) add.put("Focal Kind", JSONObject().put("rich_text", JSONObject()))
            schema = call(token, "PATCH", "/databases/${settings.database}", JSONObject().put("properties", add)).getJSONObject("properties")
        }
        val pages = queryPages(token, settings.database)
        val archiveIds = db.notionArchives(account)
        for ((entity, id, pageId) in archiveIds) {
            call(token, "PATCH", "/pages/$pageId", JSONObject().put("archived", true))
            db.acknowledgeNotionArchive(account, entity, id)
        }
        val visiblePages = pages.filterNot { page -> archiveIds.any { it.third == page.optString("id") } }
        val linked = mutableSetOf<String>()
        val byIdentity = mutableMapOf<String, JSONObject>()
        for (page in visiblePages) {
            val id = propertyText(page.optJSONObject("properties")?.optJSONObject("Focal ID"))
            val kind = propertyText(page.optJSONObject("properties")?.optJSONObject("Focal Kind"))
            if (id.isNotBlank() && kind in listOf("event", "session")) {
                val identity = "$kind:$id"
                if (byIdentity.containsKey(identity)) {
                    // Keep the first linked page; archive an identity duplicate on the next pass.
                    val kept = byIdentity.getValue(identity)
                    val entity = if (kind == "event") "events" else "study_sessions"
                    val localPageId = db.row(account, entity, id)?.data?.let(::source)?.optString("id")
                    val duplicate = if (localPageId == page.optString("id")) kept else page
                    if (duplicate !== kept) call(token, "PATCH", "/pages/${duplicate.getString("id")}", JSONObject().put("archived", true))
                    else byIdentity[identity] = page
                    continue
                }
                byIdentity[identity] = page
            }
        }
        var changed = 0
        for (page in byIdentity.values + visiblePages.filter { page ->
            val p = page.optJSONObject("properties")
            propertyText(p?.optJSONObject("Focal ID")).isBlank() || propertyText(p?.optJSONObject("Focal Kind")).isBlank()
        }) {
            val properties = page.optJSONObject("properties") ?: continue
            val taggedKind = propertyText(properties.optJSONObject("Focal Kind"))
            if (taggedKind.isNotBlank() && taggedKind !in listOf("event", "session")) continue
            val kind = if (taggedKind == "session" || taggedKind.isBlank()
                && propertyText(properties.optJSONObject(settings.type)).lowercase().contains("session")) "session" else "event"
            val entity = if (kind == "event") "events" else "study_sessions"
            val taggedId = propertyText(properties.optJSONObject("Focal ID"))
            val possibleId = taggedId.ifBlank {
                UUID.nameUUIDFromBytes("notion:${page.getString("id")}".toByteArray()).toString()
            }
            val current = db.row(account, entity, possibleId)?.data
                ?: db.rows(account, entity).firstOrNull { source(it.data)?.optString("id") == page.optString("id") }?.data
                ?: db.rows(account, entity).firstOrNull { local ->
                    taggedId.isBlank() && local.data.optString("title") == propertyText(properties.optJSONObject(settings.title))
                        && minute(local.data.optString("startTime")) == minute(properties.optJSONObject(settings.date)?.optJSONObject("date")?.optString("start"))
                        && minute(local.data.optString("endTime")) == minute(properties.optJSONObject(settings.date)?.optJSONObject("date")?.let { date -> date.optString("end").ifBlank { date.optString("start") } })
                }?.data
            val id = current?.optString("id")?.takeIf { it.isNotBlank() } ?: possibleId
            val remote = mappedRecord(account, page, settings, id, kind, current)
            if (remote == null) { linked += "$kind:$id"; continue }
            val localSnapshot = current?.let { snapshot(it, kind, settings) }
            val remoteSnapshot = snapshot(remote, kind, settings)
            val baseline = source(current)?.optJSONObject("syncSnapshot")
            val localChanged = baseline != null && (!sameSnapshot(localSnapshot, baseline)
                || bodyHash(recordBody(current, kind)) != source(current)?.optString("bodyHash")?.takeIf { it.isNotBlank() })
            val remoteChanged = baseline == null || !sameSnapshot(remoteSnapshot, baseline)
            linked += "$kind:$id"
            when {
                current == null || baseline != null && !localChanged && remoteChanged -> {
                    setSource(remote, kind, page, remoteSnapshot)
                    db.saveLocal(account, entity, remote)
                    changed++
                }
                baseline == null && !sameSnapshot(localSnapshot, remoteSnapshot) -> {
                    setSource(remote, kind, page, remoteSnapshot)
                    db.setNotionConflict(account, entity, id, remote)
                }
                baseline != null && localChanged && remoteChanged -> {
                    val merged = mergeRecords(baseline, localSnapshot!!, remoteSnapshot, current, remote, kind)
                    if (merged == null) {
                        setSource(remote, kind, page, remoteSnapshot)
                        db.setNotionConflict(account, entity, id, remote)
                    } else {
                        push(token, settings, schema, merged, kind, page.optString("id"), account)
                        changed++
                    }
                }
                localChanged || baseline == null -> {
                    push(token, settings, schema, current, kind, page.optString("id"), account)
                    changed++
                }
                else -> Unit
            }
        }
        for (entity in listOf("events", "study_sessions")) {
            val kind = if (entity == "events") "event" else "session"
            for (row in db.rows(account, entity)) {
                if ("$kind:${row.id}" in linked || db.notionConflicts(account).any { it.entity == entity && it.rowId == row.id }) continue
                push(token, settings, schema, row.data, kind, null, account)
                changed++
            }
        }
        changed
    }

    private fun queryPages(token: String, database: String): List<JSONObject> {
        val result = mutableListOf<JSONObject>()
        var cursor: String? = null
        do {
            val body = JSONObject().apply { if (cursor != null) put("start_cursor", cursor) }
            val page = call(token, "POST", "/databases/$database/query", body)
            val array = page.optJSONArray("results") ?: JSONArray()
            for (i in 0 until array.length()) array.optJSONObject(i)?.let(result::add)
            cursor = page.optString("next_cursor").takeIf { it.isNotBlank() }
        } while (cursor != null)
        return result
    }
    private fun source(record: JSONObject?): JSONObject? = record?.optJSONObject("source")
        ?: record?.optJSONObject("integrations")?.optJSONObject("notion")
    private fun subjectId(account: String, name: String): String? = Subjects.idForName(name)
        ?: db.rows(account, "custom_subjects").firstOrNull { it.data.optString("name").equals(name, true) || it.data.optString("shortCode").equals(name, true) }?.id
    private fun subjectName(account: String, id: String): String? = Subjects.name(id)
        ?: db.row(account, "custom_subjects", id)?.data?.optString("name")?.takeIf { it.isNotBlank() }
    private fun sameSnapshot(a: JSONObject?, b: JSONObject?): Boolean {
        if (a == null || b == null) return a == b
        val keys = (a.keys().asSequence() + b.keys().asSequence()).toSet()
        return keys.all { key -> a.opt(key)?.toString() == b.opt(key)?.toString() }
    }
    private fun mergeRecords(baseline: JSONObject, local: JSONObject, remote: JSONObject, localRecord: JSONObject,
        remoteRecord: JSONObject, kind: String): JSONObject? {
        val merged = JSONObject(remoteRecord.toString())
        val keys = (baseline.keys().asSequence() + local.keys().asSequence() + remote.keys().asSequence()).toSet()
        for (key in keys) {
            val old = baseline.opt(key)?.toString()
            val mine = local.opt(key)?.toString()
            val theirs = remote.opt(key)?.toString()
            val mineChanged = mine != old
            val theirsChanged = theirs != old
            if (mineChanged && theirsChanged && mine != theirs) return null
            if (!mineChanged) continue
            when (key) {
                "title", "startTime", "endTime", "eventType", "isFinished", "subjectId" -> {
                    if (key == "subjectId" && kind == "session") {
                        val ids = JSONArray()
                        val first = localRecord.optJSONArray("subjectIds")?.optString(0)
                        if (!first.isNullOrBlank()) ids.put(first)
                        merged.put("subjectIds", ids)
                    } else merged.put(key, localRecord.opt(key) ?: JSONObject.NULL)
                }
                "isCompleted" -> {
                    val completed = local.optBoolean("isCompleted")
                    merged.put("status", if (completed) "completed" else "in-progress")
                    val execution = merged.optJSONObject("execution") ?: JSONObject().put("intervals", JSONArray())
                    execution.put("state", if (completed) "completed" else "in-progress")
                    if (completed) execution.put("completedAt", localRecord.optString("completedAt", Instant.now().toString()))
                    else execution.remove("completedAt")
                    merged.put("execution", execution)
                }
            }
        }
        if (kind == "session") {
            val blocks = JSONArray().put(JSONObject().put("start", merged.optString("startTime")).put("end", merged.optString("endTime")))
            merged.put("schedule", JSONObject().put("blocks", blocks))
        }
        return merged
    }
    private fun bodyHash(text: String): String? {
        if (text.trim().isEmpty()) return null
        var hash = 0
        for (character in text.trim()) hash = hash * 31 + character.code
        return hash.toString(36)
    }
    private fun recordBody(record: JSONObject?, kind: String): String {
        if (record == null) return ""
        val description = record.optString("description")
        if (kind != "session") return description
        val notes = record.optJSONObject("reflection")?.optString("notes").orEmpty()
        val base = listOf(description, notes).filter { it.isNotBlank() }.joinToString("\n\n")
        val intervals = record.optJSONObject("execution")?.optJSONArray("intervals") ?: return base
        val closed = (0 until intervals.length()).mapNotNull { index -> intervals.optJSONObject(index)?.takeIf { it.optString("end").isNotBlank() } }
            .sortedBy { it.optString("start") }
        if (closed.isEmpty()) return base
        val lines = mutableListOf<String>()
        var lastEnd: Instant? = null
        var total = 0L
        val timeFormat = java.time.format.DateTimeFormatter.ofPattern("h:mm a")
        fun clock(value: Instant) = value.atZone(java.time.ZoneId.systemDefault()).format(timeFormat)
        for (interval in closed) {
            val start = runCatching { Instant.parse(interval.getString("start")) }.getOrNull() ?: continue
            val end = runCatching { Instant.parse(interval.getString("end")) }.getOrNull() ?: continue
            lastEnd?.let { lines += "Break: ${clock(it)} – ${clock(start)} (${java.time.Duration.between(it, start).toMinutes()}m)" }
            val minutes = kotlin.math.round(java.time.Duration.between(start, end).toMillis() / 60_000.0).toLong()
            total += minutes
            lines += "Active: ${clock(start)} – ${clock(end)} (${minutes}m)"
            lastEnd = end
        }
        lines += "\nTotal active study: ${total}m"
        val timeline = lines.joinToString("\n")
        return if (base.isBlank()) timeline else "$base\n\n$timeline"
    }
    private fun setSource(record: JSONObject, kind: String, page: JSONObject, snapshot: JSONObject) {
        val value = JSONObject().put("type", "notion").put("id", page.getString("id"))
            .put("url", page.optString("url")).put("lastEditedTime", page.optString("last_edited_time"))
            .put("kind", kind).put("syncSnapshot", snapshot)
        bodyHash(recordBody(record, kind))?.let { value.put("bodyHash", it) }
        if (kind == "event") record.put("source", value)
        else record.put("integrations", (record.optJSONObject("integrations") ?: JSONObject()).put("notion", value))
    }
    private fun mappedRecord(account: String, page: JSONObject, settings: NotionSettings, id: String, kind: String, current: JSONObject?): JSONObject? {
        val p = page.getJSONObject("properties")
        val date = p.optJSONObject(settings.date)?.optJSONObject("date") ?: return null
        val start = iso(date.optString("start")) ?: return null
        val end = iso(date.optString("end")) ?: start
        val title = propertyText(p.optJSONObject(settings.title)).ifBlank { "Untitled" }
        val completed = p.optJSONObject(settings.completed)?.optBoolean("checkbox") == true
        val subjectName = propertyText(p.optJSONObject(settings.subject))
        val subjectId = subjectId(account, subjectName)
        val now = Instant.now().toString()
        val result = current?.let { JSONObject(it.toString()) } ?: JSONObject()
        result.put("id", id).put("title", title).put("created_at", current?.optString("created_at")?.takeIf { it.isNotBlank() } ?: now)
            .put("updated_at", now).put("startTime", start).put("endTime", end)
        if (kind == "event") {
            result.put("eventType", notionEventType(propertyText(p.optJSONObject(settings.type))))
                .put("isFinished", completed)
            if (subjectId != null) result.put("subjectId", subjectId)
        } else {
            result.put("schemaVersion", 2).put("createdVia", current?.optString("createdVia")?.takeIf { it.isNotBlank() } ?: "notion")
                .put("subjectIds", JSONArray().apply { if (subjectId != null) put(subjectId) })
                .put("schedule", JSONObject().put("blocks", JSONArray().put(JSONObject().put("start", start).put("end", end))))
                .put("status", if (completed) "completed" else current?.optString("status")?.takeIf { it == "in-progress" } ?: "planned")
            if (current == null) result.put("execution", if (completed) JSONObject().put("state", "completed").put("intervals", JSONArray()).put("completedAt", now)
                else JSONObject().put("state", "planned").put("intervals", JSONArray()))
            else if (completed && result.optJSONObject("execution")?.optString("state") != "completed")
                result.put("execution", JSONObject(result.getJSONObject("execution").toString()).put("state", "completed").put("completedAt", now))
            else if (!completed && result.optJSONObject("execution")?.optString("state") == "completed") {
                val execution = JSONObject(result.getJSONObject("execution").toString()).put("state", "in-progress")
                execution.remove("completedAt")
                result.put("execution", execution)
            }
        }
        return result
    }
    private fun notionEventType(value: String): String = when (value.lowercase().replace(" ", "")) {
        "sac" -> "sac"; "exam" -> "exam"; "assignment" -> "assignment"; "homework" -> "homework"; "practicesac" -> "practice-sac"; "other" -> "other"; else -> "event"
    }
    private fun snapshot(record: JSONObject, kind: String, settings: NotionSettings): JSONObject {
        val result = JSONObject().put("title", record.optString("title")).put("startTime", minute(record.optString("startTime")))
            .put("endTime", minute(record.optString("endTime")))
        if (kind == "event") {
            if (settings.type.isNotBlank()) result.put("eventType", record.optString("eventType", "event"))
            if (settings.completed.isNotBlank()) result.put("isFinished", record.optBoolean("isFinished"))
            if (settings.subject.isNotBlank()) result.put("subjectId", record.optString("subjectId").takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        } else {
            if (settings.completed.isNotBlank()) result.put("isCompleted", record.optString("status") == "completed" || record.optJSONObject("execution")?.optString("state") == "completed")
            if (settings.subject.isNotBlank()) result.put("subjectId", record.optJSONArray("subjectIds")?.optString(0)?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
        }
        return result
    }
    private fun push(token: String, settings: NotionSettings, schema: JSONObject, record: JSONObject, kind: String, pageId: String?, account: String) {
        val props = JSONObject().put("Focal ID", rich(record.getString("id"))).put("Focal Kind", rich(kind))
            .put(settings.title, JSONObject().put("title", text(record.optString("title"))))
            .put(settings.date, JSONObject().put("date", JSONObject().put("start", record.optString("startTime")).put("end", record.optString("endTime"))))
        if (settings.type.isNotBlank() && schema.has(settings.type)) putMapped(props, settings.type, schema, if (kind == "event") record.optString("eventType") else "Study Session")
        if (settings.completed.isNotBlank() && schema.has(settings.completed)) props.put(settings.completed, JSONObject().put("checkbox",
            if (kind == "event") record.optBoolean("isFinished") else record.optString("status") == "completed"))
        if (settings.subject.isNotBlank() && schema.has(settings.subject)) {
            val subjectId = if (kind == "event") record.optString("subjectId") else record.optJSONArray("subjectIds")?.optString(0).orEmpty()
            subjectName(account, subjectId)?.let { putMapped(props, settings.subject, schema, it) }
        }
        val description = recordBody(record, kind).trim()
        val children = if (description.isNotBlank()) JSONArray().put(JSONObject().put("object", "block").put("type", "paragraph")
            .put("paragraph", JSONObject().put("rich_text", text(description)))) else JSONArray()
        var page = if (pageId == null) call(token, "POST", "/pages", JSONObject().put("parent", JSONObject().put("database_id", settings.database))
            .put("properties", props).apply { if (children.length() > 0) put("children", children) })
        else call(token, "PATCH", "/pages/$pageId", JSONObject().put("properties", props))
        if (pageId != null && source(record)?.optString("bodyHash") != bodyHash(description)) {
            replaceBody(token, pageId, children)
            page = call(token, "GET", "/pages/$pageId")
        }
        val saved = JSONObject(record.toString())
        setSource(saved, kind, page, snapshot(saved, kind, settings))
        db.saveLocal(account, if (kind == "event") "events" else "study_sessions", saved)
    }
    private fun replaceBody(token: String, pageId: String, children: JSONArray) {
        val oldIds = mutableListOf<String>()
        var cursor: String? = null
        do {
            val suffix = cursor?.let { "&start_cursor=${URLEncoder.encode(it, "UTF-8")}" } ?: ""
            val response = call(token, "GET", "/blocks/$pageId/children?page_size=100$suffix")
            val blocks = response.optJSONArray("results") ?: JSONArray()
            for (i in 0 until blocks.length()) blocks.optJSONObject(i)?.optString("id")?.takeIf { it.isNotBlank() }?.let(oldIds::add)
            cursor = response.optString("next_cursor").takeIf { it.isNotBlank() }
        } while (cursor != null)
        // Append before removing old content so a failed request retains a readable copy.
        if (children.length() > 0) call(token, "PATCH", "/blocks/$pageId/children", JSONObject().put("children", children))
        for (id in oldIds) call(token, "DELETE", "/blocks/$id")
    }
    private fun putMapped(props: JSONObject, name: String, schema: JSONObject, value: String) {
        when (schema.optJSONObject(name)?.optString("type")) {
            "select" -> props.put(name, JSONObject().put("select", JSONObject().put("name", value)))
            "status" -> props.put(name, JSONObject().put("status", JSONObject().put("name", value)))
            "multi_select" -> props.put(name, JSONObject().put("multi_select", JSONArray().put(JSONObject().put("name", value))))
            else -> props.put(name, rich(value))
        }
    }
    fun resolve(account: String, conflict: MergeConflict, keepLocal: Boolean) {
        if (!keepLocal && conflict.remote != null) db.saveLocal(account, conflict.entity, conflict.remote)
        if (keepLocal) {
            val current = db.row(account, conflict.entity, conflict.rowId)?.data ?: return
            val baseline = source(conflict.remote)?.optJSONObject("syncSnapshot") ?: JSONObject()
            val copy = JSONObject(current.toString())
            source(copy)?.put("syncSnapshot", baseline)
            db.saveLocal(account, conflict.entity, copy)
        }
        db.clearNotionConflict(account, conflict.entity, conflict.rowId)
    }
}
