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
        // Pull before importing guest edits so a fresh install never publishes empty defaults.
        pull(account)
        db.mergeGuest(account)
        val conflicting = db.conflicts(account).map { it.entity to it.rowId }.toSet()
        for (change in db.pending(account)) {
            if ((change.entity to change.rowId) in conflicting) continue
            val token = freshSession().accessToken
            val body = JSONObject().put("user_id", account).put("change_id", change.id).put("device_id", deviceId)
                .put("entity", change.entity).put("row_id", change.rowId).put("operation", change.operation)
                .put("payload", change.payload ?: JSONObject.NULL)
            request("POST", "$base/rest/v1/sync_changes", body, authHeaders(token) + ("Prefer" to "return=minimal"))
            db.acknowledge(change.id)
        }
        pull(account)
        db.pending(account).size
    }

    private fun pull(account: String) {
        var cursor = db.meta(account, "revision")?.toLongOrNull() ?: 0L
        while (true) {
            val token = freshSession().accessToken
            val response = requestArray("GET", "$base/rest/v1/sync_changes?select=change_id,entity,row_id,operation,payload,revision,device_id&revision=gt.$cursor&order=revision.asc&limit=1000", authHeaders(token))
            val pendingIds = db.pending(account).map { it.id }.toSet()
            for (i in 0 until response.length()) {
                val change = response.getJSONObject(i)
                if (change.optString("change_id") in pendingIds) db.acknowledge(change.getString("change_id"))
                val revision = change.getLong("revision")
                val entity = change.getString("entity")
                if (entity in setOf("events", "study_sessions", "projects", "custom_subjects", "hidden_subjects", "timetable_config", "user_settings")) {
                    val payload = if (entity == "hidden_subjects" && change.opt("payload") is String)
                        JSONObject().put("id", change.getString("payload")) else change.optJSONObject("payload")
                    db.applyRemote(account, entity, change.getString("row_id"), change.getString("operation"), payload, revision)
                }
                cursor = maxOf(cursor, revision)
                db.setMeta(account, "revision", cursor.toString())
            }
            if (response.length() < 1000) break
        }
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
