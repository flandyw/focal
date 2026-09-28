package com.andy.focal

import org.json.JSONArray
import org.json.JSONObject

/** Native Android's local timer document is only a view; lifecycle writes use canonical commands. */
internal object CanonicalSessionProtocol {
    fun state(value: JSONObject?): String {
        if (value == null) return "planned"
        if (value.optString("deleted_at").isNotBlank() && !value.isNull("deleted_at")) return "cancelled"
        val execution = value.optJSONObject("execution")
        if (execution?.optString("state") == "completed" || value.optString("status") == "completed") return "completed"
        if (execution?.optString("state") == "planned" || value.optString("status") == "planned") return "planned"
        val stored = value.optString("state")
        if (stored in setOf("completed", "cancelled", "planned")) return stored
        val intervals = execution?.optJSONArray("intervals") ?: value.optJSONArray("activeDurations")
        val last = intervals?.optJSONObject((intervals?.length() ?: 0) - 1)
        if (last != null) return if (!last.has("end")) "running" else "paused"
        return stored.takeIf { it in setOf("running", "paused") } ?: "planned"
    }

    fun phase(value: JSONObject?): String {
        val stored = value?.optString("phase")
        val integrations = value?.optJSONObject("integrations")
        val source = integrations?.optJSONObject("examtrack") ?: integrations?.optJSONObject("folio")
        val phase = source?.optString("phase")
        return when {
            stored in setOf("reading", "writing") -> stored!!
            phase in setOf("reading", "writing") -> phase!!
            source?.optString("phaseBeforePause") in setOf("reading", "writing") -> source?.optString("phaseBeforePause") ?: "focus"
            else -> "focus"
        }
    }

    fun kind(value: JSONObject?): String {
        val integrations = value?.optJSONObject("integrations")
        val examtrack = integrations?.optJSONObject("examtrack")
        val folio = integrations?.optJSONObject("folio")
        val candidate = examtrack?.optString("kind") ?: folio?.optString("kind") ?: value?.optString("kind")
        return candidate?.takeIf { it in setOf("exam", "sac") } ?: "focus"
    }

    fun command(
        previous: JSONObject?,
        current: JSONObject,
        deviceId: String,
        expectedRevision: Long,
        elapsedSincePreviousMs: Long,
        occurredAt: String?,
        mutationId: String
    ): List<JSONObject> {
        val sessionId = current.optString("id")
        require(sessionId.isNotBlank()) { "Missing canonical study session id" }
        val before = state(previous)
        val after = state(current)
        val action = when {
            after == "cancelled" && before != "cancelled" -> "cancel"
            after == "completed" && before != "completed" -> "complete"
            before == "planned" && after == "running" -> "start"
            before == "running" && after == "paused" -> "pause"
            before == "paused" && after == "running" -> "resume"
            before == "running" && after == "running" && phase(previous) != phase(current) -> "phase_change"
            previous == null && after == "running" -> "start"
            previous == null && after == "paused" -> "pause"
            previous == null && after == "completed" -> "complete"
            previous == null && after == "cancelled" -> "cancel"
            previous == null -> "create"
            else -> "save_progress"
        }
        val kind = kind(current)
        val phase = phase(current)
        val subject = current.optJSONArray("subjectIds")?.optString(0)
            ?: current.optString("subject_id").takeIf { it.isNotBlank() }
        val metadata = metadata(current)
        fun create(actionName: String, revision: Long, id: String, elapsed: Long, occurrence: String?): JSONObject =
            JSONObject().put("mutation_id", id).put("session_id", sessionId)
                .put("expected_revision", revision).put("action", actionName)
                .put("device_id", deviceId).put("app", app(current)).put("kind", kind).put("phase", phase)
                .put("title", current.optString("title")).put("subject_id", subject ?: JSONObject.NULL)
                .put("metadata", metadata).put("occurred_at", occurrence ?: JSONObject.NULL)
                .put("elapsed_since_previous_ms", elapsed.coerceIn(0L, 604_800_000L))

        if (previous != null) return listOf(create(action, expectedRevision, mutationId,
            elapsedSincePreviousMs, occurredAt))

        return when (after) {
            "planned" -> listOf(create("create", expectedRevision, mutationId, 0, null))
            "running" -> listOf(create("start", expectedRevision, mutationId, 0, occurredAt))
            "paused", "completed", "cancelled" -> {
                val intervals = intervals(current)
                val total = intervals.sumOf { duration(it) }.coerceAtMost(604_800_000L)
                val firstId = mutationId
                val secondId = java.util.UUID.randomUUID().toString()
                val endAction = when (after) { "paused" -> "pause"; "completed" -> "complete"; else -> "cancel" }
                listOf(
                    create("start", expectedRevision, firstId, 0, null),
                    create(endAction, expectedRevision + 1, secondId, total, null)
                )
            }
            else -> listOf(create("create", expectedRevision, mutationId, 0, null))
        }
    }

    fun toLocal(canonical: JSONObject): JSONObject {
        val metadata = canonical.optJSONObject("metadata") ?: JSONObject()
        val legacy = metadata.optJSONObject("legacy_metadata") ?: metadata
        val local = JSONObject(legacy.toString())
        val id = canonical.optString("id")
        val state = canonical.optString("state")
        val segments = canonical.optJSONArray("segments") ?: JSONArray()
        val intervals = JSONArray()
        val durations = JSONArray()
        for (index in 0 until segments.length()) {
            val segment = segments.optJSONObject(index) ?: continue
            val start = nullableString(segment, "started_at").orEmpty()
            val end = nullableString(segment, "ended_at")
            intervals.put(JSONObject().put("start", start).apply { if (end != null) put("end", end) }.put("source", "manual"))
            if (end != null) durations.put(JSONObject().put("start", start).put("end", end))
        }
        val executionState = when (state) {
            "running", "paused" -> "in-progress"
            else -> state
        }
        val execution = JSONObject().put("state", executionState).put("intervals", intervals)
        val completedAt = nullableString(canonical, "completed_at")
        val pausedAt = nullableString(canonical, "paused_at")
        completedAt?.let { execution.put("completedAt", it) }
        local.put("id", id).put("title", canonical.optString("title"))
            .put("subjectIds", JSONArray().apply { nullableString(canonical, "subject_id")?.let { put(it) } })
            .put("created_at", canonical.optString("created_at")).put("updated_at", canonical.optString("updated_at"))
            .put("startTime", nullableString(canonical, "started_at") ?: canonical.optString("created_at"))
            .put("endTime", completedAt ?: pausedAt ?: JSONObject.NULL)
            .put("status", when (state) { "running", "paused" -> "in-progress"; else -> state })
            .put("execution", execution).put("activeDurations", durations)
            .put("revision", canonical.optLong("revision")).put("state", state)
            .put("kind", canonical.optString("kind")).put("phase", nullableString(canonical, "phase") ?: JSONObject.NULL)
            .put("accumulated_active_ms", canonical.optLong("accumulated_active_ms"))
            .put("timing_at", nullableString(canonical, "timing_at") ?: JSONObject.NULL)
        val integrations = local.optJSONObject("integrations")
        val timerSource = integrations?.optJSONObject("examtrack") ?: integrations?.optJSONObject("folio")
        if (timerSource != null) {
            if (state == "paused") timerSource.put("phaseBeforePause", canonical.optString("phase")).put("phase", "paused")
            else if (canonical.optString("phase") in setOf("reading", "writing")) timerSource.put("phase", canonical.optString("phase"))
        }
        return local
    }

    private fun metadata(current: JSONObject): JSONObject {
        val oldMetadata = current.optJSONObject("metadata")
        if (current.has("state") && oldMetadata != null) return JSONObject(oldMetadata.toString())
        val legacy = JSONObject(current.toString())
        listOf("execution", "status", "deleted_at", "activeDurations", "activeMillis", "startedAt", "pausedAt",
            "completedAt", "revision", "state", "phase", "timing_at", "accumulated_active_ms", "startTime", "endTime",
            "timing_anchor_elapsed_ms", "timing_anchor_boot_count", "timing_elapsed_override_ms")
            .forEach(legacy::remove)
        return JSONObject().put("legacy_metadata", legacy)
    }

    private fun app(current: JSONObject): String = when {
        current.optString("createdVia") == "examtrack" || current.optJSONObject("integrations")?.optJSONObject("examtrack") != null -> "examtrack"
        current.optJSONObject("integrations")?.optJSONObject("folio") != null -> "folio"
        else -> "focal"
    }

    private fun intervals(current: JSONObject): List<JSONObject> {
        val execution = current.optJSONObject("execution")
        val list = execution?.optJSONArray("intervals") ?: current.optJSONArray("activeDurations")
        return (0 until (list?.length() ?: 0)).mapNotNull { list?.optJSONObject(it) }
    }

    private fun nullableString(value: JSONObject, key: String): String? =
        if (!value.has(key) || value.isNull(key)) null else value.optString(key).takeIf { it.isNotBlank() }

    private fun duration(interval: JSONObject): Long {
        val start = interval.optString("start")
        val end = interval.optString("end")
        return runCatching {
            val startMillis = java.time.Instant.parse(start).toEpochMilli()
            val endMillis = java.time.Instant.parse(end).toEpochMilli()
            (endMillis - startMillis).coerceAtLeast(0L)
        }.getOrDefault(0L)
    }
}
