package com.andy.focal

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

data class Subject(val id: String, val name: String, val color: Long)

object Subjects {
    val builtIn = listOf(
        Subject("eng", "English", 0xFFE11D48), Subject("eng-lang", "English Language", 0xFFE11D48),
        Subject("lit", "Literature", 0xFFE11D48), Subject("mm", "Mathematical Methods", 0xFF2563EB),
        Subject("sm", "Specialist Mathematics", 0xFF2563EB), Subject("gm", "General Mathematics", 0xFF2563EB),
        Subject("csl", "Chinese Second Language", 0xFFDC2626), Subject("pe", "Physical Education", 0xFF16A34A),
        Subject("chem", "Chemistry", 0xFF059669), Subject("phys", "Physics", 0xFF7C3AED),
        Subject("bio", "Biology", 0xFF16A34A), Subject("psych", "Psychology", 0xFFEA580C),
        Subject("hist", "History", 0xFFA16207), Subject("geo", "Geography", 0xFF0D9488),
        Subject("econ", "Economics", 0xFFDC2626), Subject("bm", "Business Management", 0xFF4F46E5)
    )
    fun name(id: String) = builtIn.firstOrNull { it.id == id }?.name
    fun idForName(name: String): String? = builtIn.firstOrNull {
        it.name.equals(name, true) || it.id.equals(name, true)
    }?.id
}

object FocalJson {
    fun iso(date: String, time: String): String = LocalDateTime.parse("${date}T${time}")
        .atZone(ZoneId.systemDefault()).toInstant().toString()
    fun dateTime(value: String): LocalDateTime = Instant.parse(value).atZone(ZoneId.systemDefault()).toLocalDateTime()
    fun localDate(value: String): LocalDate = dateTime(value).toLocalDate()
    fun prettyTime(value: String): String = runCatching { dateTime(value).format(DateTimeFormatter.ofPattern("h:mm a")) }.getOrDefault("")
    fun event(title: String, start: String, end: String?, type: String, subject: String?, description: String, location: String): JSONObject {
        require(title.trim().isNotBlank()) { "Give the event a title." }
        require(end == null || Instant.parse(end) > Instant.parse(start)) { "End time must be after start time." }
        val now = Instant.now().toString()
        return JSONObject().put("id", UUID.randomUUID().toString()).put("title", title.trim())
            .put("startTime", start).put("endTime", end ?: start).put("eventType", type)
            .put("subjectId", subject ?: JSONObject.NULL).put("description", description.trim())
            .put("location", location.trim()).put("isFinished", false)
            .put("created_at", now).put("updated_at", now).put("deleted_at", JSONObject.NULL)
    }
    fun session(subject: String?, minutes: Int, now: Instant = Instant.now(), subjectLabel: String? = null): JSONObject {
        val end = now.plusSeconds(minutes * 60L)
        val title = (subjectLabel ?: subject?.let(Subjects::name) ?: "Pomodoro") + " · Focus"
        val interval = JSONObject().put("start", now.toString()).put("source", "pomodoro").put("cycleNumber", 1)
        return JSONObject().put("schemaVersion", 2).put("id", UUID.randomUUID().toString()).put("title", title)
            .put("description", "Pomodoro — ${minutes}m focused study")
            .put("subjectIds", JSONArray().apply { if (subject != null) put(subject) })
            .put("schedule", JSONObject().put("blocks", JSONArray().put(JSONObject().put("start", now.toString()).put("end", end.toString()))))
            .put("execution", JSONObject().put("state", "in-progress").put("intervals", JSONArray().put(interval)))
            .put("createdVia", "manual").put("startTime", now.toString()).put("endTime", end.toString())
            .put("status", "in-progress").put("created_at", now.toString()).put("updated_at", now.toString()).put("deleted_at", JSONObject.NULL)
    }
    fun closeInterval(session: JSONObject, end: Instant) {
        val execution = session.getJSONObject("execution")
        val intervals = execution.getJSONArray("intervals")
        for (i in intervals.length() - 1 downTo 0) {
            val interval = intervals.getJSONObject(i)
            if (!interval.has("end")) { interval.put("end", end.toString()); break }
        }
    }
    fun reopenInterval(session: JSONObject, start: Instant) {
        session.getJSONObject("execution").getJSONArray("intervals").put(JSONObject()
            .put("start", start.toString()).put("source", "pomodoro").put("cycleNumber", 1))
    }
    fun finishSession(session: JSONObject, end: Instant) {
        closeInterval(session, end)
        session.getJSONObject("execution").put("state", "completed").put("completedAt", end.toString())
        session.put("status", "completed").put("completedAt", end.toString())
    }
}

data class TimerState(val phase: String = "focus", val minutes: Int = 25, val remaining: Long = 1500,
    val deadline: Long? = null, val sessionId: String? = null) {
    fun seconds(now: Long = System.currentTimeMillis()): Long = deadline?.let { ((it - now + 999) / 1000).coerceAtLeast(0) } ?: remaining
    fun paused(now: Long = System.currentTimeMillis()) = copy(remaining = seconds(now), deadline = null)
    fun resumed(now: Long = System.currentTimeMillis()) = copy(deadline = now + remaining * 1000)
    fun json() = JSONObject().put("phase", phase).put("minutes", minutes).put("remaining", remaining)
        .put("deadline", deadline ?: JSONObject.NULL).put("sessionId", sessionId ?: JSONObject.NULL).toString()
    companion object {
        fun parse(value: String?): TimerState = try {
            if (value == null) TimerState() else JSONObject(value).let { o ->
                val minutes = o.getInt("minutes").coerceIn(1, 180)
                TimerState(o.optString("phase").takeIf { it in listOf("focus", "break") } ?: "focus", minutes,
                    o.optLong("remaining", minutes * 60L).coerceIn(0, 10800),
                    if (o.isNull("deadline")) null else o.optLong("deadline").takeIf { it > 0 },
                    o.optString("sessionId").takeIf { it.isNotBlank() })
            }
        } catch (_: Exception) { TimerState() }
    }
}
