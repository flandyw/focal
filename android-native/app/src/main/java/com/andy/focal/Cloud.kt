package com.andy.focal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AccountSession(val userId: String, val accessToken: String, val refreshToken: String, val expiresAt: Long)

class SecretStore(private val context: Context) {
    private val prefs = context.getSharedPreferences("focal_secrets", Context.MODE_PRIVATE)
    private val alias = "focal-android-secrets"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun put(name: String, value: String?) {
        if (value == null) { prefs.edit().remove(name).apply(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val bytes = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(name, Base64.encodeToString(bytes, Base64.NO_WRAP)).apply()
    }
    fun get(name: String): String? = try {
        val bytes = Base64.decode(prefs.getString(name, null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
        String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    } catch (_: Exception) { null }
}

class FocalCloud(private val context: Context, private val db: FocalDb, private val secrets: SecretStore) {
    val configured = BuildConfig.SUPABASE_URL.startsWith("https://") && BuildConfig.SUPABASE_PUBLISHABLE_KEY.isNotBlank()
    private val base = BuildConfig.SUPABASE_URL.trimEnd('/')
    private val key = BuildConfig.SUPABASE_PUBLISHABLE_KEY
    private val deviceId = context.getSharedPreferences("focal_device", Context.MODE_PRIVATE).let { prefs ->
        prefs.getString("id", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("id", it).apply() }
    }
    var session: AccountSession? = restore()
        private set

    init { db.setDeviceId(deviceId) }

    private fun restore(): AccountSession? = try {
        secrets.get("account")?.let { JSONObject(it) }?.let {
            AccountSession(it.getString("userId"), it.getString("accessToken"), it.getString("refreshToken"), it.getLong("expiresAt"))
        }
    } catch (_: Exception) { null }

    private fun save(value: AccountSession?) {
        session = value
        secrets.put("account", value?.let { JSONObject().put("userId", it.userId).put("accessToken", it.accessToken)
            .put("refreshToken", it.refreshToken).put("expiresAt", it.expiresAt).toString() })
    }

    suspend fun signIn(email: String, password: String): AccountSession = withContext(Dispatchers.IO) {
        require(configured) { "Set FOCAL_SUPABASE_URL and FOCAL_SUPABASE_PUBLISHABLE_KEY in local.properties." }
        require(email.isNotBlank() && password.isNotBlank()) { "Email and password are required." }
        val response = request("POST", "$base/auth/v1/token?grant_type=password", JSONObject().put("email", email.trim()).put("password", password), mapOf("apikey" to key))
        parseSession(response).also(::save)
    }
    suspend fun signUp(email: String, password: String): Boolean = withContext(Dispatchers.IO) {
        require(configured) { "Supabase is not configured." }
        val response = request("POST", "$base/auth/v1/signup", JSONObject().put("email", email.trim()).put("password", password), mapOf("apikey" to key))
        if (response.has("access_token")) { save(parseSession(response)); true } else false
    }
    suspend fun signOut() = withContext(Dispatchers.IO) {
        session?.let { runCatching { request("POST", "$base/auth/v1/logout", JSONObject(), authHeaders(it.accessToken)) } }
        save(null)
    }
    private fun parseSession(json: JSONObject): AccountSession = AccountSession(
        json.getJSONObject("user").getString("id"), json.getString("access_token"), json.getString("refresh_token"),
        System.currentTimeMillis() + json.optLong("expires_in", 3600) * 1000
    )
    private fun authHeaders(token: String) = mapOf("apikey" to key, "Authorization" to "Bearer $token")
    private fun freshSession(): AccountSession {
        val current = session ?: error("Sign in to sync.")
        if (System.currentTimeMillis() < current.expiresAt - 60_000) return current
        val refreshed = request("POST", "$base/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", current.refreshToken), mapOf("apikey" to key))
        return parseSession(refreshed).also(::save)
    }

    suspend fun sync(): Int = withContext(Dispatchers.IO) {
        val account = freshSession().userId
        pull(account)
        db.mergeGuest(account)
        db.migrateLegacySessionOutbox(account, deviceId)
        flushSessionCommands(account)
        val conflicting = db.conflicts(account).map { it.entity to it.rowId }.toSet()
        for (change in db.pending(account)) {
            if (change.entity == "study_sessions" || (change.entity to change.rowId) in conflicting) continue
            val item = JSONObject().put("change_id", change.id).put("client_id", deviceId)
                .put("entity", change.entity).put("row_id", change.rowId).put("operation", change.operation)
                .put("payload", change.payload ?: JSONObject.NULL)
            val response = rpc("sync_apply_changes", JSONObject().put("p_changes", JSONArray().put(item))
                .put("p_expected_user_id", account))
            val receipts = response.optJSONArray("receipts") ?: JSONArray()
            val received = (0 until receipts.length()).mapNotNull { receipts.optJSONObject(it)?.optString("change_id") }.toSet()
            if (change.id in received) db.acknowledge(change.id)
            val stale = response.optJSONArray("stale") ?: JSONArray()
            for (index in 0 until stale.length()) {
                val itemStale = stale.optJSONObject(index) ?: continue
                if (itemStale.optString("change_id") != change.id) continue
                val remote = itemStale.optJSONObject("current")
                db.recordStale(account, change.entity, change.rowId, remote?.optJSONObject("payload"))
            }
        }
        pull(account)
        db.pending(account).size + db.pendingSessionCommands(account).size
    }

    private fun flushSessionCommands(account: String) {
        for (pending in db.pendingSessionCommands(account)) {
            var command = JSONObject(pending.payload.toString())
            var storedMutationId = pending.mutationId
            var rebases = 0
            while (true) {
                val result = rpc("study_session_mutate", JSONObject().put("p_command",
                    JSONObject(command.toString()).put("expected_user_id", account)))
                result.optString("server_now").takeIf { it.isNotBlank() }?.let(db::setServerClock)
                val reason = result.optString("reason").takeIf { it.isNotBlank() }
                val canonical = result.optJSONObject("session")
                if (reason == "stale_revision" && canonical != null) {
                    val state = canonical.optString("state")
                    val phase = canonical.optString("phase")
                    if (mutationSatisfied(command.optString("action"), state, phase, command.optString("phase"))) {
                        db.finishSessionCommand(account, command.optString("mutation_id"), canonical, result.optLong("change_seq"))
                        break
                    }
                    if (state in setOf("completed", "cancelled")) {
                        db.finishTerminalSessionCommands(account, pending.sessionId, canonical, result.optLong("change_seq"))
                        break
                    }
                    if (!mutationCanRebase(command, state, phase)) {
                        db.finishSessionCommand(account, command.optString("mutation_id"), canonical, result.optLong("change_seq"))
                        break
                    }
                    if (rebases++ >= 2) error("Study session changed repeatedly; retry sync to rebase the command")
                    command.put("mutation_id", UUID.randomUUID().toString()).put("expected_revision", canonical.optLong("revision"))
                    storedMutationId = db.rebaseSessionCommand(account, storedMutationId, command)
                    continue
                }
                if (reason == "session_terminal") {
                    db.finishTerminalSessionCommands(account, pending.sessionId, canonical, result.optLong("change_seq"))
                    break
                }
                if (reason == "invalid_transition" || reason == "not_found") {
                    db.finishSessionCommand(account, command.optString("mutation_id"), canonical, result.optLong("change_seq"))
                    break
                }
                if (!result.optBoolean("ok") && reason != "already_exists") error("study_session_mutate failed: ${reason ?: "server error"}")
                db.finishSessionCommand(account, command.optString("mutation_id"), canonical, result.optLong("change_seq"))
                break
            }
        }
    }

    private fun mutationSatisfied(action: String, state: String, phase: String, requestedPhase: String): Boolean = when (action) {
        "start", "resume" -> state == "running"
        "pause" -> state == "paused"
        "complete" -> state == "completed"
        "cancel" -> state == "cancelled"
        "phase_change" -> phase == requestedPhase
        else -> false
    }

    private fun mutationCanRebase(command: JSONObject, state: String, phase: String): Boolean = when (command.optString("action")) {
        "pause" -> state == "running"
        "resume" -> state == "paused"
        "start" -> state == "planned"
        "complete", "cancel" -> state in setOf("planned", "running", "paused")
        "phase_change" -> state in setOf("running", "paused") && phase != command.optString("phase")
        "save_progress" -> state !in setOf("completed", "cancelled")
        else -> false
    }

    private fun pull(account: String) {
        var cursor = db.meta(account, "cursor")?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L
        while (true) {
            val response = rpc("sync_read_changes", JSONObject().put("p_after", cursor).put("p_limit", 500)
                .put("p_expected_user_id", account))
            response.optString("server_now").takeIf { it.isNotBlank() }?.let(db::setServerClock)
            val head = response.optLong("head")
            val rows = response.optJSONArray("rows") ?: JSONArray()
            if (response.optString("mode") == "snapshot") {
                val snapshot = (0 until rows.length()).mapNotNull { index -> remoteRow(rows.optJSONObject(index), snapshot = true) }
                db.applySnapshot(account, snapshot, head)
                cursor = head
                db.setMeta(account, "cursor", cursor.toString())
                break
            }
            for (index in 0 until rows.length()) {
                val raw = rows.optJSONObject(index) ?: continue
                val row = remoteRow(raw, snapshot = false) ?: continue
                val changeId = raw.optString("change_id")
                if (changeId.isNotBlank() && db.pending(account).any { it.id == changeId }) db.acknowledge(changeId)
                if (row.entity == "study_sessions") db.applyCanonicalSession(account, row.rowId, row.payload ?: continue, row.seq)
                else db.applyRemote(account, row.entity, row.rowId, row.operation, row.payload, row.seq)
                cursor = maxOf(cursor, row.seq)
            }
            db.setMeta(account, "cursor", cursor.toString())
            if (rows.length() < 500 || cursor >= head) break
        }
    }

    private fun remoteRow(raw: JSONObject?, snapshot: Boolean): NativeRemoteRow? {
        if (raw == null) return null
        val entity = raw.optString("entity")
        val rowId = raw.optString("row_id")
        val operation = raw.optString("operation", "put")
        if (entity !in setOf("events", "study_sessions", "projects", "custom_subjects", "hidden_subjects", "timetable_config", "user_settings") || rowId.isBlank()) return null
        val value = raw.opt("payload")
        val payload = when {
            value is JSONObject -> value
            entity == "hidden_subjects" && value is String -> JSONObject().put("id", value)
            else -> null
        }
        return NativeRemoteRow(entity, rowId, operation, payload, raw.optLong("seq", if (snapshot) raw.optLong("lamport") else 0L))
    }

    private fun rpc(function: String, body: JSONObject): JSONObject {
        val token = freshSession().accessToken
        return request("POST", "$base/rest/v1/rpc/$function", body, authHeaders(token))
    }
}

internal fun request(method: String, url: String, body: JSONObject?, headers: Map<String, String> = emptyMap()): JSONObject {
    val text = requestText(method, url, body, headers)
    return if (text.isBlank()) JSONObject() else JSONObject(text)
}
internal fun requestArray(method: String, url: String, headers: Map<String, String> = emptyMap()): JSONArray =
    JSONArray(requestText(method, url, null, headers))

internal fun requestText(method: String, url: String, body: JSONObject?, headers: Map<String, String> = emptyMap()): String {
    require(URL(url).protocol == "https") { "Only HTTPS endpoints are allowed." }
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = 20_000
        readTimeout = 30_000
        for ((name, value) in headers) setRequestProperty(name, value)
        if (body != null) {
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
    }
    try {
        val status = connection.responseCode
        val text = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (status !in 200..299) {
            val message = runCatching { JSONObject(text).optString("message") }.getOrDefault("")
            throw IllegalStateException("HTTP $status: ${message.ifBlank { text.take(250) }}")
        }
        return text
    } finally { connection.disconnect() }
}
