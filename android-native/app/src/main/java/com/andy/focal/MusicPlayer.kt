package com.andy.focal

import android.content.ComponentName
import android.content.Context
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.NotificationManagerCompat

internal fun musicCanToggle(actions: Long, playing: Boolean): Boolean = actions and
    (if (playing) PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE
     else PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PLAY_PAUSE) != 0L

// ponytail: Android's active media sessions cover players that publish one. Provider-specific
// APIs would need separate sign-in flows; a provider without a media session cannot be controlled.
class MusicPlayer(private val context: Context) {
    private val manager = context.getSystemService(MediaSessionManager::class.java)
    private val component = ComponentName(context, FocalMediaListener::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var controllers = emptyList<MediaController>()
    private var selected: MediaController? = null
    private var listening = false
    private val callback = object : MediaController.Callback() {
        override fun onPlaybackStateChanged(state: PlaybackState?) = publish()
        override fun onMetadataChanged(metadata: MediaMetadata?) = publish()
        override fun onSessionDestroyed() = refresh()
    }
    private val sessionsChanged = MediaSessionManager.OnActiveSessionsChangedListener { sessions ->
        updateSessions(sessions ?: emptyList())
    }

    var accessGranted by mutableStateOf(false); private set
    var sources by mutableStateOf<List<String>>(emptyList()); private set
    var selectedIndex by mutableStateOf(0); private set
    var title by mutableStateOf("Start music in another app"); private set
    var artist by mutableStateOf(""); private set
    var playing by mutableStateOf(false); private set
    var canToggle by mutableStateOf(false); private set
    var canPrevious by mutableStateOf(false); private set
    var canNext by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set

    fun refresh() {
        accessGranted = context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)
        if (!accessGranted) {
            stopListening()
            updateSessions(emptyList())
            return
        }
        try {
            if (!listening) {
                manager.addOnActiveSessionsChangedListener(sessionsChanged, component, handler)
                listening = true
            }
            updateSessions(manager.getActiveSessions(component))
            error = null
        } catch (_: SecurityException) {
            stopListening()
            updateSessions(emptyList())
            error = "Music access is unavailable. Check notification access for Focal."
        } catch (_: RuntimeException) {
            updateSessions(emptyList())
            error = "Could not connect to the active music player. Try reopening it."
        }
    }

    private fun stopListening() {
        if (listening) manager.removeOnActiveSessionsChangedListener(sessionsChanged)
        listening = false
    }

    private fun updateSessions(sessions: List<MediaController>) {
        val prior = selected?.sessionToken
        val next = sessions.firstOrNull { it.sessionToken == prior }
            ?: sessions.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: sessions.firstOrNull()
        if (selected?.sessionToken != next?.sessionToken) {
            selected?.unregisterCallback(callback)
            selected = next
            next?.registerCallback(callback, handler)
        }
        controllers = sessions
        sources = sessions.map { controller ->
            runCatching {
                context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(controller.packageName, 0)).toString()
            }.getOrDefault(controller.packageName.substringAfterLast('.'))
        }
        selectedIndex = sessions.indexOfFirst { it.sessionToken == next?.sessionToken }.coerceAtLeast(0)
        publish()
    }

    fun select(index: Int) {
        val next = controllers.getOrNull(index) ?: return
        if (selected?.sessionToken != next.sessionToken) {
            selected?.unregisterCallback(callback)
            selected = next
            next.registerCallback(callback, handler)
        }
        selectedIndex = index
        publish()
    }

    private fun publish() {
        val controller = selected
        val state = controller?.playbackState
        val actions = state?.actions ?: 0L
        title = controller?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE)?.takeIf(String::isNotBlank)
            ?: if (controller == null) "Start music in another app" else "No track information"
        artist = controller?.metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST).orEmpty()
        playing = state?.state == PlaybackState.STATE_PLAYING
        canToggle = musicCanToggle(actions, playing)
        canPrevious = actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L
        canNext = actions and PlaybackState.ACTION_SKIP_TO_NEXT != 0L
    }

    fun toggle() = command { if (playing) it.pause() else it.play() }
    fun previous() = command { it.skipToPrevious() }
    fun next() = command { it.skipToNext() }
    private fun command(action: (MediaController.TransportControls) -> Unit) {
        val controller = selected ?: return
        try {
            action(controller.transportControls)
            error = null
        } catch (_: RuntimeException) {
            refresh()
            error = "The music player did not accept that control."
        }
    }
    fun release() {
        stopListening()
        selected?.unregisterCallback(callback)
        selected = null
    }
}

class FocalMediaListener : NotificationListenerService()
