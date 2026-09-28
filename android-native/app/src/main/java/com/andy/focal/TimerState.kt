package com.andy.focal

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import org.json.JSONObject

data class TimerState(
    val phase: String = "focus",
    val minutes: Int = 25,
    val remaining: Long = 1500,
    val deadline: Long? = null, // wall-clock display/legacy compatibility only
    val sessionId: String? = null,
    val deadlineElapsed: Long? = null,
    val runStartedElapsed: Long? = null,
    val runStartedWall: Long? = null,
    val bootCount: Int = -1,
    val bootChanged: Boolean = false
) {
    fun seconds(nowElapsed: Long = SystemClock.elapsedRealtime()): Long = deadlineElapsed?.let {
        ((it - nowElapsed + 999) / 1000).coerceAtLeast(0)
    } ?: remaining

    fun paused(nowElapsed: Long = SystemClock.elapsedRealtime()) = copy(
        remaining = seconds(nowElapsed), deadline = null, deadlineElapsed = null,
        runStartedElapsed = null, runStartedWall = null, bootChanged = false
    )

    fun resumed(
        nowElapsed: Long = SystemClock.elapsedRealtime(),
        nowWall: Long = System.currentTimeMillis(),
        currentBootCount: Int = bootCount
    ) = copy(
        deadline = nowWall + remaining * 1000,
        deadlineElapsed = nowElapsed + remaining * 1000,
        runStartedElapsed = nowElapsed,
        runStartedWall = nowWall,
        bootCount = currentBootCount,
        bootChanged = false
    )

    fun json() = JSONObject().put("phase", phase).put("minutes", minutes).put("remaining", remaining)
        .put("deadline", deadline ?: JSONObject.NULL).put("sessionId", sessionId ?: JSONObject.NULL)
        .put("deadlineElapsed", deadlineElapsed ?: JSONObject.NULL)
        .put("runStartedElapsed", runStartedElapsed ?: JSONObject.NULL)
        .put("runStartedWall", runStartedWall ?: JSONObject.NULL).put("bootCount", bootCount).toString()

    companion object {
        fun currentBootCount(context: Context?): Int = runCatching {
            if (context == null) -1 else Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)
        }.getOrDefault(-1)

        fun parse(value: String?, context: Context? = null): TimerState = try {
            if (value == null) TimerState() else JSONObject(value).let { o ->
                val minutes = o.getInt("minutes").coerceIn(1, 180)
                val bootCount = o.optInt("bootCount", -1)
                val currentBoot = currentBootCount(context)
                val bootChanged = bootCount >= 0 && currentBoot >= 0 && currentBoot != bootCount && !o.isNull("deadline")
                val savedWallDeadline = if (o.isNull("deadline")) null else o.optLong("deadline").takeIf { it > 0 }
                val oldRemaining = o.optLong("remaining", minutes * 60L).coerceIn(0, 10800)
                val storedElapsed = if (o.isNull("deadlineElapsed")) null else o.optLong("deadlineElapsed").takeIf { it > 0 }
                val migratedElapsed = if (storedElapsed == null && savedWallDeadline != null && !bootChanged) {
                    SystemClock.elapsedRealtime() + (savedWallDeadline - System.currentTimeMillis()).coerceAtLeast(0L)
                } else storedElapsed
                val remaining = if (bootChanged) oldRemaining else if (storedElapsed == null && savedWallDeadline != null)
                    ((savedWallDeadline - System.currentTimeMillis() + 999) / 1000).coerceIn(0, 10800) else oldRemaining
                TimerState(
                    phase = o.optString("phase").takeIf { it in listOf("focus", "break") } ?: "focus",
                    minutes = minutes,
                    remaining = remaining,
                    deadline = if (bootChanged) null else savedWallDeadline,
                    sessionId = o.optString("sessionId").takeIf { it.isNotBlank() },
                    deadlineElapsed = if (bootChanged) null else migratedElapsed,
                    runStartedElapsed = if (bootChanged || o.isNull("runStartedElapsed")) null else o.optLong("runStartedElapsed"),
                    runStartedWall = if (bootChanged || o.isNull("runStartedWall")) null else o.optLong("runStartedWall"),
                    bootCount = if (currentBoot >= 0) currentBoot else bootCount,
                    bootChanged = bootChanged
                )
            }
        } catch (_: Exception) { TimerState() }
    }
}
