package com.andy.focal

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import java.time.Instant

object TimerAlarm {
    private const val channel = "focal_focus"
    private fun pending(context: Context, account: String) = PendingIntent.getBroadcast(context, 6101,
        Intent(context, TimerAlarmReceiver::class.java).putExtra("account", account), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun schedule(context: Context, account: String, deadlineElapsed: Long) {
        context.getSharedPreferences("focal_alarm", Context.MODE_PRIVATE).edit().putString("account", account).apply()
        val alarm = context.getSystemService(AlarmManager::class.java)
        // ponytail: Android may defer this inexact alarm to save battery; the persisted deadline
        // still closes the session at the intended instant. Use an exact-alarm grant only if
        // second-accurate background notifications become a product requirement.
        alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadlineElapsed, pending(context, account))
    }
    fun cancel(context: Context, account: String) {
        context.getSystemService(AlarmManager::class.java).cancel(pending(context, account))
    }
    fun complete(context: Context, account: String): Boolean {
        val db = FocalDb(context)
        val state = TimerState.parse(db.meta(account, "timer"), context)
        if (state.bootChanged) {
            state.sessionId?.let { db.recoverSessionAfterReboot(account, it) }
            db.setMeta(account, "timer", state.copy(bootChanged = false).json())
            return true
        }
        val deadline = state.deadlineElapsed ?: return false
        if (deadline > android.os.SystemClock.elapsedRealtime()) return false
        if (state.phase == "focus") {
            state.sessionId?.let { id ->
                db.row(account, "study_sessions", id)?.data?.let { session ->
                    if (session.optJSONObject("execution")?.optString("state") != "completed") {
                        val startElapsed = state.runStartedElapsed ?: (deadline - state.remaining * 1000L)
                        val startWall = state.runStartedWall ?: (state.deadline ?: System.currentTimeMillis()) - state.remaining * 1000L
                        val endWall = startWall + (deadline - startElapsed).coerceAtLeast(0L)
                        val sessionAnchor = session.optLong("timing_anchor_elapsed_ms", 0L)
                        if (sessionAnchor > 0L) session.put("timing_elapsed_override_ms", (deadline - sessionAnchor).coerceIn(0L, 604_800_000L))
                        FocalJson.finishSession(session, Instant.ofEpochMilli(endWall))
                        db.saveLocal(account, "study_sessions", session)
                    }
                }
            }
            db.setMeta(account, "timer", TimerState(phase = "break", minutes = 5, remaining = 300).json())
            notify(context, "Focus complete", "Take a breath. Your study time is saved.")
        } else {
            db.setMeta(account, "timer", TimerState().json())
            notify(context, "Break complete", "Ready for your next focus block?")
        }
        return true
    }
    private fun notify(context: Context, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(channel, "Focus timer", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 6102, Intent(context, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        manager.notify(6101, Notification.Builder(context, channel).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title).setContentText(text).setContentIntent(open).setAutoCancel(true).build())
    }
}

class TimerAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val account = intent.getStringExtra("account") ?: return
        val pending = goAsync()
        Thread { try { TimerAlarm.complete(context, account) } finally { pending.finish() } }.start()
    }
}

class TimerBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val account = context.getSharedPreferences("focal_alarm", Context.MODE_PRIVATE).getString("account", null) ?: return
        val db = FocalDb(context)
        val state = TimerState.parse(db.meta(account, "timer"), context)
        if (state.bootChanged) {
            state.sessionId?.let { db.recoverSessionAfterReboot(account, it) }
            db.setMeta(account, "timer", state.copy(bootChanged = false).json())
            return
        }
        val deadline = state.deadlineElapsed ?: return
        if (deadline <= android.os.SystemClock.elapsedRealtime()) TimerAlarm.complete(context, account)
        else TimerAlarm.schedule(context, account, deadline)
    }
}
