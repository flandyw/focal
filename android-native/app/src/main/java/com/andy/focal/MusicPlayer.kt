package com.andy.focal

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

class MusicPlayer(private val context: Context) {
    private val preferences = context.getSharedPreferences("focal_music", Context.MODE_PRIVATE)
    private var player: MediaPlayer? = null
    private val session = MediaSession(context, "Focal music").apply {
        setCallback(object : MediaSession.Callback() {
            override fun onPlay() { if (!playing) toggle() }
            override fun onPause() { if (playing) toggle() }
            override fun onSkipToNext() { seek(10_000) }
            override fun onSkipToPrevious() { seek(-10_000) }
        })
    }
    var title by mutableStateOf("Choose audio from your device"); private set
    var playing by mutableStateOf(false); private set
    var ready by mutableStateOf(false); private set
    init { preferences.getString("uri", null)?.let { runCatching { load(Uri.parse(it), preferences.getString("title", "Audio") ?: "Audio") } } }
    fun load(uri: Uri, name: String) {
        player?.release(); player = null; ready = false; playing = false
        title = name
        val media = MediaPlayer()
        try {
            media.setDataSource(context, uri)
            media.setOnPreparedListener { ready = true; publish() }
            media.setOnCompletionListener { playing = false; publish() }
            media.prepareAsync()
            player = media
            preferences.edit().putString("uri", uri.toString()).putString("title", name).apply()
            session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, name)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Focal · local audio").build())
            session.isActive = true
        } catch (error: Exception) { media.release(); title = error.message ?: "Could not open audio" }
    }
    fun toggle() {
        val media = player ?: return
        if (!ready) return
        if (media.isPlaying) media.pause() else media.start()
        playing = media.isPlaying
        publish()
    }
    fun seek(milliseconds: Int) {
        val media = player ?: return
        if (!ready) return
        media.seekTo((media.currentPosition + milliseconds).coerceIn(0, media.duration.coerceAtLeast(0)))
        publish()
    }
    private fun publish() {
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                runCatching { player?.currentPosition?.toLong() ?: 0L }.getOrDefault(0L), if (playing) 1f else 0f).build())
    }
    fun release() { player?.release(); session.release() }
}
