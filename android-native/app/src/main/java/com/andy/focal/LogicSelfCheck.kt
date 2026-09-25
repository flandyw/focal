package com.andy.focal

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import android.media.session.PlaybackState
import org.json.JSONObject

// Runnable on every debug launch; small enough to catch timer persistence regressions.
internal fun checkNativeLogic() {
    val started = TimerState(minutes = 25, remaining = 1500).resumed(1_000)
    check(started.seconds(61_000) == 1440L)
    val paused = started.paused(61_000)
    check(paused.seconds(121_000) == 1440L)
    check(paused.resumed(121_000).seconds(1_561_000) == 0L)
    val session = FocalJson.session("eng", 25, Instant.parse("2026-01-01T00:00:00Z"))
    FocalJson.finishSession(session, Instant.parse("2026-01-01T00:25:00Z"))
    check(session.getJSONObject("execution").getString("state") == "completed")
    check(session.getJSONObject("execution").getJSONArray("intervals").getJSONObject(0).getString("end") == "2026-01-01T00:25:00Z")
    val now = 1_700_000_000_000L
    check(UpdateSchedule.nextFailure(now, 429, "120", null, null, 0) >= now + 120_000)
    check(UpdateSchedule.nextFailure(now, 403, null, "0", "1700000300", 0) >= now + 300_000)
    check(UpdateSchedule.nextFailure(now, 429, null, null, null, 0) >= now + 60_000)
    check(musicCanToggle(PlaybackState.ACTION_PLAY, false))
    check(!musicCanToggle(PlaybackState.ACTION_PLAY, true))
    check(musicCanToggle(PlaybackState.ACTION_PAUSE, true))
    val day = LocalDate.parse("2026-01-01")
    val timed = JSONObject().put("execution", org.json.JSONObject().put("intervals", org.json.JSONArray()
        .put(JSONObject().put("start", "2026-01-01T00:00:00Z").put("end", "2026-01-01T00:20:00Z"))
        .put(JSONObject().put("start", "2026-01-01T23:50:00Z").put("end", "2026-01-02T00:10:00Z"))))
    check(focusedMinutesOn(timed, day, ZoneId.of("UTC")) == 30L)
}
