package br.com.atriocatolico

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.util.Log
import android.view.Surface
import android.view.TextureView
import java.io.IOException

/** TextureView stretches the buffer to its own bounds; enlarge just the shorter axis to undo that stretch. */
internal fun openingCoverScale(
    viewportWidth: Int, viewportHeight: Int, videoWidth: Int, videoHeight: Int
): Pair<Float, Float> {
    if (minOf(viewportWidth, viewportHeight, videoWidth, videoHeight) <= 0) return 1f to 1f
    val relativeAspect = (videoWidth.toFloat() / videoHeight) / (viewportWidth.toFloat() / viewportHeight)
    return maxOf(1f, relativeAspect) to maxOf(1f, 1f / relativeAspect)
}

/** A single local player, clipped by TextureView to the viewport when using center-crop. */
internal class OpeningVideoTexture(context: Context) : TextureView(context),
    TextureView.SurfaceTextureListener {
    var onPlaybackComplete: () -> Unit = {}
    var onPlaybackError: () -> Unit = {}
    private var player: MediaPlayer? = null
    private var output: Surface? = null
    private var prepared = false
    private var shouldPlay = false
    private var disposed = false
    private var videoWidth = 0
    private var videoHeight = 0

    init {
        isOpaque = false
        surfaceTextureListener = this
    }

    fun setPlaying(playing: Boolean) {
        shouldPlay = playing
        val media = player ?: return
        if (!prepared) return
        if (playing) media.start() else if (media.isPlaying) media.pause()
    }

    override fun onSurfaceTextureAvailable(texture: SurfaceTexture, width: Int, height: Int) {
        if (disposed) return
        try {
            val surface = Surface(texture).also { output = it }
            val media = MediaPlayer().also { player = it }
            media.setAudioAttributes(AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build())
            media.setSurface(surface)
            media.setOnVideoSizeChangedListener { active, w, h ->
                if (active === player) updateVideoSize(w, h)
            }
            media.setOnPreparedListener { active ->
                if (active === player) {
                    prepared = true
                    updateVideoSize(active.videoWidth, active.videoHeight)
                    if (shouldPlay) active.start()
                }
            }
            media.setOnCompletionListener { active ->
                if (active === player) onPlaybackComplete()
            }
            media.setOnErrorListener { active, what, extra ->
                if (active === player) fail("Falha de reprodução ($what, $extra)")
                true
            }
            // The resource qualifier selects the portrait or landscape edit; both play offline.
            resources.openRawResourceFd(R.raw.abertura_atrio).use { file ->
                media.setDataSource(file.fileDescriptor, file.startOffset, file.length)
            }
            media.prepareAsync()
        } catch (error: IOException) {
            fail("Não foi possível carregar a abertura", error)
        } catch (error: RuntimeException) {
            fail("Não foi possível iniciar a abertura", error)
        }
    }

    override fun onSurfaceTextureSizeChanged(texture: SurfaceTexture, width: Int, height: Int) {
        applyCover(width, height)
    }

    override fun onSurfaceTextureUpdated(texture: SurfaceTexture) = Unit

    override fun onSurfaceTextureDestroyed(texture: SurfaceTexture): Boolean {
        releasePlayback()
        return true
    }

    fun dispose() {
        disposed = true
        releasePlayback()
    }

    private fun updateVideoSize(width: Int, height: Int) {
        if (width > 0 && height > 0) {
            videoWidth = width
            videoHeight = height
            applyCover(this.width, this.height)
        }
    }

    private fun applyCover(width: Int, height: Int) {
        val (scaleX, scaleY) = openingCoverScale(width, height, videoWidth, videoHeight)
        setTransform(Matrix().apply { setScale(scaleX, scaleY, width / 2f, height / 2f) })
    }

    private fun fail(message: String, error: Throwable? = null) {
        Log.w("AtrioOpening", message, error)
        releasePlayback()
        if (!disposed) onPlaybackError()
    }

    private fun releasePlayback() {
        prepared = false
        val media = player
        player = null
        media?.release()
        output?.release()
        output = null
    }
}
