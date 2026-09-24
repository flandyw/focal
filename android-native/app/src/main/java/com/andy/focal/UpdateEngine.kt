package com.andy.focal

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.min
import kotlin.random.Random

data class AppUpdate(val version: String, val code: Int, val url: String, val sha256: String, val size: Long)

// ponytail: a static release asset avoids GitHub's REST quota; if release traffic needs a CDN, move this one URL.
internal object UpdateSchedule {
    private const val MINUTE = 60_000L
    fun nextFailure(now: Long, status: Int, retryAfter: String?, remaining: String?, reset: String?, failures: Int): Long {
        val retryAt = retryAfter?.toLongOrNull()?.let { now + it.coerceAtLeast(0) * 1000 }
            ?: retryAfter?.let { runCatching { ZonedDateTime.parse(it, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }.getOrNull() }
        val resetAt = if (remaining == "0") reset?.toLongOrNull()?.times(1000) else null
        val base = if (status == 403 || status == 429) MINUTE else 15 * MINUTE
        val exponential = base * (1L shl min(failures.coerceAtLeast(0), 6))
        return maxOf(now + min(exponential, 24 * 60 * MINUTE), retryAt ?: 0, resetAt ?: 0)
    }
}

internal class UpdateEngine(private val context: Context) {
    private val prefs = context.getSharedPreferences("github_updates", Context.MODE_PRIVATE)
    private val manifestUrl = "https://github.com/flandolf/focal/releases/latest/download/android-update.json"
    private val apkPrefix = "https://github.com/flandolf/focal/releases/download/"

    suspend fun check(manual: Boolean): Pair<AppUpdate?, String> = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        val blocked = prefs.getLong("blockedUntil", 0)
        if (now < blocked) return@withContext cached() to if (manual) "Update server cooldown active. Try again later." else ""
        if (!manual && now < prefs.getLong("nextAuto", 0)) return@withContext cached() to ""
        try {
            val connection = open(manifestUrl)
            try {
                prefs.getString("etag", null)?.let { connection.setRequestProperty("If-None-Match", it) }
                val status = connection.responseCode
                require(connection.url.protocol == "https") { "Update check was redirected to an insecure URL" }
                when (status) {
                200 -> {
                    val raw = connection.inputStream.use { stream ->
                        val bytes = ByteArray(32_769)
                        var used = 0
                        while (used < bytes.size) {
                            val count = stream.read(bytes, used, bytes.size - used)
                            if (count < 0) break
                            used += count
                        }
                        require(used <= 32_768) { "Update manifest is too large" }
                        String(bytes, 0, used, Charsets.UTF_8)
                    }
                    val update = parse(raw)
                    prefs.edit().putString("manifest", raw).putString("etag", connection.getHeaderField("ETag"))
                        .putLong("nextAuto", now + 24 * 60 * 60_000L + Random.nextLong(0, 2 * 60 * 60_000L))
                        .putLong("blockedUntil", 0).putInt("failures", 0).apply()
                    update to if (manual) "${if (update == null) "You're up to date" else "Update available"}." else ""
                }
                304 -> {
                    prefs.edit().putLong("nextAuto", now + 24 * 60 * 60_000L).putLong("blockedUntil", 0).putInt("failures", 0).apply()
                    cached() to if (manual) "Update check complete." else ""
                }
                else -> {
                    defer(connection, now, status)
                    cached() to if (manual) "Update check unavailable (HTTP $status)." else ""
                }
                }
            } finally { connection.disconnect() }
        } catch (error: CancellationException) { throw error
        } catch (error: Exception) {
            val failures = prefs.getInt("failures", 0) + 1
            prefs.edit().putInt("failures", failures).putLong("blockedUntil", UpdateSchedule.nextFailure(now, 0, null, null, null, failures)).apply()
            cached() to if (manual) "Update check failed: ${error.message ?: "network error"}" else ""
        }
    }

    suspend fun install(update: AppUpdate): String = withContext(Dispatchers.IO) {
        if (System.currentTimeMillis() < prefs.getLong("blockedUntil", 0))
            return@withContext "Update server cooldown active. Try again later."
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            withContext(Dispatchers.Main) { context.startActivity(intent) }
            return@withContext "Allow installs for Focal, then tap Install update again."
        }
        val directory = File(context.cacheDir, "updates").apply { mkdirs() }
        val target = File(directory, "Focal-Android.apk")
        val part = File(directory, "Focal-Android.apk.part")
        try {
            val connection = open(update.url)
            val digest = MessageDigest.getInstance("SHA-256")
            var received = 0L
            try {
                val status = connection.responseCode
                require(connection.url.protocol == "https") { "Download was redirected to an insecure URL" }
                if (status != 200) {
                    defer(connection, System.currentTimeMillis(), status)
                    error("Download unavailable (HTTP $status)")
                }
                connection.inputStream.use { input -> part.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        received += count
                        require(received <= update.size && received <= 200_000_000) { "APK size is invalid" }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                    }
                } }
            } finally { connection.disconnect() }
            require(received == update.size) { "APK download is incomplete" }
            require(digest.digest().joinToString("") { "%02x".format(it) } == update.sha256) { "APK checksum mismatch" }
            Files.move(part.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", target)
            withContext(Dispatchers.Main) {
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            "Android will confirm the update."
        } finally { part.delete() }
    }

    private fun open(url: String): HttpURLConnection {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "Focal-Android/${BuildConfig.VERSION_NAME}")
            setRequestProperty("Accept", "application/octet-stream")
        }
        return connection
    }

    private fun defer(connection: HttpURLConnection, now: Long, status: Int) {
        val failures = prefs.getInt("failures", 0) + 1
        val until = if (status == 404) now + 60 * 60_000L else UpdateSchedule.nextFailure(now, status,
            connection.getHeaderField("Retry-After"), connection.getHeaderField("X-RateLimit-Remaining"),
            connection.getHeaderField("X-RateLimit-Reset"), failures)
        prefs.edit().putInt("failures", failures).putLong("blockedUntil", until).apply()
    }

    private fun cached(): AppUpdate? = prefs.getString("manifest", null)?.let { runCatching { parse(it) }.getOrNull() }

    private fun parse(raw: String): AppUpdate? {
        val json = JSONObject(raw)
        val version = json.getString("version")
        val parts = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)$").matchEntire(version)?.groupValues ?: error("Invalid update version")
        val longCode = parts[1].toLong() * 1_000_000 + parts[2].toLong() * 1_000 + parts[3].toLong()
        require(parts[2].toInt() < 1000 && parts[3].toInt() < 1000 && longCode in 1..Int.MAX_VALUE.toLong()) { "Invalid update version code" }
        val code = longCode.toInt()
        require(json.getInt("versionCode") == code) { "Update version mismatch" }
        val url = json.getString("apkUrl")
        require(url == "${apkPrefix}app-v$version/Focal-Android.apk") { "Unexpected update URL" }
        val hash = json.getString("sha256")
        require(Regex("^[a-f0-9]{64}$").matches(hash)) { "Invalid APK checksum" }
        val size = json.getLong("size")
        require(size in 1..200_000_000) { "Invalid APK size" }
        return AppUpdate(version, code, url, hash, size).takeIf { it.code > BuildConfig.VERSION_CODE }
    }
}
