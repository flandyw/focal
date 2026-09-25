package com.andy.focal

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

class FocalViewModel(application: Application) : AndroidViewModel(application) {
    private val db = FocalDb(application)
    private val app = application
    private val secrets = SecretStore(application)
    private val cloud = FocalCloud(application, db, secrets)
    private val notion = NotionSync(db, secrets)
    private val updates = UpdateEngine(application)
    private val syncMutex = Mutex()
    private val timerMutex = Mutex()
    val configured get() = cloud.configured
    val account get() = cloud.session?.userId ?: "guest"
    var email by mutableStateOf<String?>(null); private set
    var events by mutableStateOf<List<FocalRow>>(emptyList()); private set
    var sessions by mutableStateOf<List<FocalRow>>(emptyList()); private set
    val sharedSessions get() = sessions.filter { it.id != timer.sessionId && it.data.optJSONObject("execution")?.optString("state") == "in-progress" }
    var subjects by mutableStateOf(Subjects.builtIn); private set
    var cloudConflicts by mutableStateOf<List<MergeConflict>>(emptyList()); private set
    var notionConflicts by mutableStateOf<List<MergeConflict>>(emptyList()); private set
    var syncStatus by mutableStateOf("Offline ready"); private set
    var accountBusy by mutableStateOf(false); private set
    var message by mutableStateOf<String?>(null); private set
    var timer by mutableStateOf(TimerState()); private set
    var now by mutableStateOf(System.currentTimeMillis()); private set
    var availableUpdate by mutableStateOf<AppUpdate?>(null); private set
    var updateStatus by mutableStateOf(""); private set
    var updateBusy by mutableStateOf(false); private set

    init {
        reload()
        viewModelScope.launch {
            while (true) {
                delay(1000)
                now = System.currentTimeMillis()
                if (timer.deadline != null && timer.seconds(now) == 0L) finishExpiredTimer()
            }
        }
        viewModelScope.launch {
            if (cloud.session != null || notion.token().isNotBlank()) syncAll()
            while (true) {
                delay(if (timer.sessionId != null || sessions.any { it.data.optJSONObject("execution")?.optString("state") == "in-progress" }) 5_000 else 60_000)
                if (cloud.session != null || notion.token().isNotBlank()) syncAll()
            }
        }
        viewModelScope.launch { checkUpdates(false) }
    }
    private fun reload() {
        events = db.rows(account, "events").sortedBy { it.data.optString("startTime") }
        sessions = db.rows(account, "study_sessions").sortedBy { it.data.optString("startTime") }
        val hidden = db.rows(account, "hidden_subjects").map { it.id }.toSet()
        subjects = Subjects.builtIn.filterNot { it.id in hidden } + db.rows(account, "custom_subjects").mapNotNull { row ->
            val o = row.data
            o.optString("name").takeIf { it.isNotBlank() }?.let { Subject(row.id, it, runCatching { android.graphics.Color.parseColor(o.optString("color")) }.getOrDefault(0xFF6750A4.toInt()).toLong() and 0xffffffffL) }
        }
        cloudConflicts = db.conflicts(account)
        notionConflicts = db.notionConflicts(account)
        timer = TimerState.parse(db.meta(account, "timer"))
    }
    fun clearMessage() { message = null }
    private fun launchAction(block: suspend () -> Unit) = viewModelScope.launch {
        try { block() }
        catch (error: CancellationException) { throw error }
        catch (error: Exception) { message = error.message ?: "Something went wrong" }
    }
    private fun accountAction(block: suspend () -> Unit) = launchAction {
        if (accountBusy) return@launchAction
        accountBusy = true
        try { block() }
        catch (error: Exception) { syncStatus = "Sign-in needed"; throw error }
        finally { accountBusy = false }
    }
    fun signIn(emailValue: String, password: String) = accountAction {
        if (timer.deadline != null) throw IllegalStateException("Pause or finish the timer before signing in.")
        require(android.util.Patterns.EMAIL_ADDRESS.matcher(emailValue.trim()).matches()) { "Enter a valid email address." }
        require(password.isNotBlank()) { "Enter your password." }
        syncStatus = "Signing in…"
        cloud.signIn(emailValue, password)
        email = emailValue.trim()
        reload()
        syncAll()
    }
    fun signUp(emailValue: String, password: String) = accountAction {
        if (timer.deadline != null) throw IllegalStateException("Pause or finish the timer before creating an account.")
        require(android.util.Patterns.EMAIL_ADDRESS.matcher(emailValue.trim()).matches()) { "Enter a valid email address." }
        require(password.length >= 6) { "Use a password with at least 6 characters." }
        val signedIn = cloud.signUp(emailValue, password)
        if (signedIn) { email = emailValue.trim(); reload(); syncAll() }
        else message = "Check your email to confirm the account, then sign in."
    }
    fun signOut() = accountAction {
        if (timer.deadline != null) throw IllegalStateException("Finish or pause the timer before signing out.")
        cloud.signOut(); email = null; syncStatus = "Offline ready"; reload()
    }
    suspend fun syncAll() = syncMutex.withLock {
        if (cloud.session == null && (notion.token().isBlank() || notion.settings(account).database.isBlank())) return@withLock
        try {
            var pending = 0
            if (cloud.session != null) {
                syncStatus = "Syncing Focal…"
                pending = withContext(Dispatchers.IO) { cloud.sync() }
                reload()
                reconcileSharedTimer()
            }
            if (notion.token().isNotBlank() && notion.settings(account).database.isNotBlank()) {
                syncStatus = "Syncing Notion…"
                withContext(Dispatchers.IO) { notion.sync(account) }
                if (cloud.session != null) pending = withContext(Dispatchers.IO) { cloud.sync() }
                reload()
                if (cloud.session != null) reconcileSharedTimer()
            }
            syncStatus = if (cloudConflicts.isNotEmpty() || notionConflicts.isNotEmpty()) "Changes need review"
                else if (pending > 0) "$pending changes waiting to sync"
                else "Synced · ${java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))}"
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { syncStatus = "Sync needed"; message = error.message ?: "Sync failed" }
    }
    fun syncNow() = launchAction { syncAll() }
    fun checkUpdates() = viewModelScope.launch { checkUpdates(true) }
    private suspend fun checkUpdates(manual: Boolean) {
        if (updateBusy) return
        updateBusy = true
        try {
            val (update, status) = updates.check(manual)
            availableUpdate = update
            if (status.isNotBlank()) updateStatus = status
        } finally { updateBusy = false }
    }
    fun installUpdate() = launchAction {
        val update = availableUpdate ?: return@launchAction
        if (updateBusy) return@launchAction
        updateBusy = true
        try { updateStatus = updates.install(update) }
        finally { updateBusy = false }
    }
    fun saveEvent(record: JSONObject, onSaved: () -> Unit, onFailure: () -> Unit) = launchAction {
        try {
            withContext(Dispatchers.IO) { db.saveLocal(account, "events", record) }
            reload(); onSaved()
        } catch (error: Exception) { onFailure(); throw error }
        syncAll()
    }
    fun deleteEvent(id: String, onDeleted: () -> Unit, onFailure: () -> Unit) = launchAction {
        try {
            withContext(Dispatchers.IO) { db.deleteLocal(account, "events", id) }
            reload(); onDeleted()
        } catch (error: Exception) { onFailure(); throw error }
        syncAll()
    }
    fun resolveCloud(conflict: MergeConflict, keepLocal: Boolean) = launchAction {
        withContext(Dispatchers.IO) { db.resolve(account, conflict, keepLocal) }
        reload(); syncAll()
    }
    fun resolveNotion(conflict: MergeConflict, keepLocal: Boolean) = launchAction {
        withContext(Dispatchers.IO) { notion.resolve(account, conflict, keepLocal) }
        reload(); syncAll()
    }
    fun notionSettings() = notion.settings(account)
    fun hasNotionToken() = notion.token().isNotBlank()
    fun saveNotion(token: String, mapping: NotionSettings) = launchAction {
        withContext(Dispatchers.IO) { notion.saveSettings(account, token.ifBlank { notion.token() }, mapping) }
        reload(); syncAll()
    }
    private fun persistTimer(next: TimerState) {
        timer = next
        db.setMeta(account, "timer", next.json())
    }
    private suspend fun reconcileSharedTimer() = timerMutex.withLock {
        val current = timer
        val sessionId = current.sessionId
        if (sessionId != null) {
            val ownSession = db.row(account, "study_sessions", sessionId)?.data
            val execution = ownSession?.optJSONObject("execution")
            if (ownSession == null || execution == null || execution.optString("state") == "completed") {
                persistTimer(TimerState())
                TimerAlarm.cancel(app, account)
            } else {
                val intervals = execution.optJSONArray("intervals")
                val last = intervals?.optJSONObject((intervals.length() - 1).coerceAtLeast(0))
                val open = intervals != null && intervals.length() > 0 && last != null && !last.has("end")
                val ownIntegrations = ownSession.optJSONObject("integrations")
                val phase = (ownIntegrations?.optJSONObject("examtrack") ?: ownIntegrations?.optJSONObject("folio"))?.optString("phase")
                val remoteRunning = phase == "reading" || (phase != "paused" && open)
                val otherRunning = sessions.any { row ->
                    if (row.id == sessionId) false else {
                        val data = row.data
                        val state = data.optJSONObject("execution")
                        val rowIntervals = state?.optJSONArray("intervals")
                        val rowLast = rowIntervals?.optJSONObject((rowIntervals.length() - 1).coerceAtLeast(0))
                        val rowOpen = rowIntervals != null && rowIntervals.length() > 0 && rowLast != null && !rowLast.has("end")
                        val rowIntegrations = data.optJSONObject("integrations")
                        val rowPhase = (rowIntegrations?.optJSONObject("examtrack") ?: rowIntegrations?.optJSONObject("folio"))?.optString("phase")
                        state?.optString("state") == "in-progress" && rowPhase != "paused" && (rowOpen || rowPhase == "reading")
                    }
                }
                when {
                    !remoteRunning && current.deadline != null -> {
                        persistTimer(current.paused())
                        TimerAlarm.cancel(app, account)
                    }
                    remoteRunning && current.deadline == null -> {
                        persistTimer(current.resumed())
                        timer.deadline?.let { TimerAlarm.schedule(app, account, it) }
                    }
                }
                if (otherRunning && timer.deadline != null) {
                    timer.sessionId?.let { id -> db.row(account, "study_sessions", id)?.data?.let { session ->
                        FocalJson.closeInterval(session, Instant.now())
                        withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                    } }
                    persistTimer(timer.paused())
                    TimerAlarm.cancel(app, account)
                    reload()
                }
            }
        }
    }
    fun controlSharedSession(id: String, action: String) = launchAction {
        require(action in setOf("pause", "resume", "finish", "discard"))
        timerMutex.withLock {
            if (action == "discard") {
                withContext(Dispatchers.IO) { db.deleteLocal(account, "study_sessions", id) }
                if (timer.sessionId == id) {
                    persistTimer(TimerState())
                    TimerAlarm.cancel(app, account)
                }
            } else {
                val session = db.row(account, "study_sessions", id)?.data ?: return@withLock
                val execution = session.optJSONObject("execution") ?: return@withLock
                if (execution.optString("state") != "in-progress") return@withLock
                val intervals = execution.optJSONArray("intervals") ?: JSONArray().also { execution.put("intervals", it) }
                val now = Instant.now()
                val last = intervals.optJSONObject((intervals.length() - 1).coerceAtLeast(0))
                val open = intervals.length() > 0 && last != null && !last.has("end")
                val integrations = session.optJSONObject("integrations")
                val examtrack = integrations?.optJSONObject("examtrack") ?: integrations?.optJSONObject("folio")
                when (action) {
                    "pause" -> {
                        if (open) last?.put("end", now.toString())
                        if (examtrack != null) {
                            val previous = examtrack.optString("phase").takeIf { it == "reading" || it == "writing" }
                                ?: examtrack.optString("phaseBeforePause").takeIf { it == "reading" || it == "writing" }
                                ?: "writing"
                            examtrack.put("phaseBeforePause", previous).put("phase", "paused")
                        }
                    }
                    "resume" -> {
                        val priorPhase = examtrack?.optString("phaseBeforePause")
                        if (!open && priorPhase != "reading") intervals.put(JSONObject().put("start", now.toString()).put("source", "imported"))
                        if (examtrack != null) examtrack.put("phase", if (priorPhase == "reading") "reading" else "writing").remove("phaseBeforePause")
                    }
                    "finish" -> {
                        if (open) last?.put("end", now.toString())
                        execution.put("state", "completed").put("completedAt", now.toString())
                        session.put("status", "completed").put("completedAt", now.toString())
                    }
                }
                if (action == "pause") session.put("status", "in-progress")
                if (action == "resume") session.put("status", "in-progress")
                withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                if (timer.sessionId == id) {
                    when (action) {
                        "pause" -> { persistTimer(timer.paused()); TimerAlarm.cancel(app, account) }
                        "resume" -> { persistTimer(timer.resumed()); timer.deadline?.let { TimerAlarm.schedule(app, account, it) } }
                        "finish" -> { persistTimer(TimerState()); TimerAlarm.cancel(app, account) }
                    }
                }
            }
            reload()
        }
        syncAll()
    }
    fun chooseDuration(minutes: Int) {
        if (timer.sessionId != null || timer.deadline != null) return
        persistTimer(TimerState(minutes = minutes, remaining = minutes * 60L))
    }
    fun startTimer(subjectId: String?) = launchAction {
        timerMutex.withLock {
            val current = timer
            if (current.deadline != null) return@withLock
            val instant = Instant.now()
            if (current.phase == "focus") {
                if (current.sessionId == null) {
                    val session = FocalJson.session(subjectId, current.minutes, instant, subjects.firstOrNull { it.id == subjectId }?.name)
                    withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                    persistTimer(current.copy(sessionId = session.getString("id")).resumed())
                } else {
                    val session = db.row(account, "study_sessions", current.sessionId)?.data ?: error("Study session is missing")
                    FocalJson.reopenInterval(session, instant)
                    withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                    persistTimer(current.resumed())
                }
            } else persistTimer(current.resumed())
            timer.deadline?.let { TimerAlarm.schedule(app, account, it) }
            reload()
        }
        syncAll()
    }
    fun retargetTimerSubject(subjectId: String?) = launchAction {
        timerMutex.withLock {
            val current = timer
            if (current.phase != "focus" || current.sessionId == null) return@withLock
            db.row(account, "study_sessions", current.sessionId)?.data?.let { session ->
                session.put("subjectIds", JSONArray().apply { if (subjectId != null) put(subjectId) })
                val label = subjectId?.let { id -> subjects.firstOrNull { it.id == id }?.name } ?: "Pomodoro"
                session.put("title", "$label · Focus")
                withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
            }
        }
        reload()
        syncAll()
    }
    fun pauseTimer() = launchAction {
        timerMutex.withLock {
            val current = timer
            if (current.deadline == null) return@withLock
            if (current.phase == "focus") current.sessionId?.let { id ->
                db.row(account, "study_sessions", id)?.data?.let { session ->
                    FocalJson.closeInterval(session, Instant.now())
                    withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                }
            }
            persistTimer(current.paused())
            TimerAlarm.cancel(app, account)
            reload()
        }
        syncAll()
    }
    fun finishTimer() = launchAction {
        timerMutex.withLock {
            val current = timer
            if (current.phase == "focus") current.sessionId?.let { id ->
                db.row(account, "study_sessions", id)?.data?.let { session ->
                    FocalJson.finishSession(session, Instant.now())
                    withContext(Dispatchers.IO) { db.saveLocal(account, "study_sessions", session) }
                }
            }
            persistTimer(TimerState())
            TimerAlarm.cancel(app, account)
            reload()
        }
        syncAll()
    }
    private suspend fun finishExpiredTimer() = timerMutex.withLock {
        val phase = timer.phase
        if (TimerAlarm.complete(app, account)) {
            reload()
            message = if (phase == "focus") "Focus complete. Take a break." else "Break complete. Ready to focus?"
            viewModelScope.launch { syncAll() }
        }
    }
    fun onResume() = launchAction {
        now = System.currentTimeMillis()
        if (timer.deadline != null && timer.seconds(now) == 0L) finishExpiredTimer()
        viewModelScope.launch { checkUpdates(false) }
        syncAll()
    }
}
