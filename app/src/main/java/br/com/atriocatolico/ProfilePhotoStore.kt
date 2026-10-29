package br.com.atriocatolico

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest

/**
 * Foto privada no próprio aparelho, separada por UID. Não é um upload público.
 *
 * O Firestore atual impede leitura de profiles de terceiros e não há regras de
 * Firebase Storage aprovadas. Evita simular uma sincronização que não existe.
 */
internal object ProfilePhotoStore {
    private const val MAX_INPUT_BYTES = 12L * 1024 * 1024
    private const val MAX_ORIGINAL_SIDE = 10000
    private const val OUTPUT_SIZE = 400
    private const val MAX_OUTPUT_BYTES = 180 * 1024

    private fun file(context: Context, uid: String): File {
        require(uid.isNotBlank())
        val digest = MessageDigest.getInstance("SHA-256").digest(uid.toByteArray(Charsets.UTF_8))
        val hash = digest.joinToString("") { "%02x".format(it) }
        return File(File(context.filesDir, "private-profile-photos"), hash + ".jpg")
    }

    fun load(context: Context, uid: String): Bitmap? = runCatching {
        val f = file(context, uid)
        if (!f.isFile || f.length() > MAX_OUTPUT_BYTES) null
        else BitmapFactory.decodeFile(f.absolutePath)
    }.getOrNull()

    fun decodeSelection(context: Context, uri: Uri): Bitmap {
        val mime = context.contentResolver.getType(uri).orEmpty().lowercase()
        require(mime == "image/jpeg" || mime == "image/png" || mime == "image/webp") {
            "Escolha uma imagem JPG, PNG ou WebP."
        }
        val length = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        require(length <= MAX_INPUT_BYTES || length == -1L) {
            "A imagem deve ter até 12 MB."
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        } ?: error("Não foi possível abrir a imagem.")
        require(bounds.outWidth in 1..MAX_ORIGINAL_SIDE && bounds.outHeight in 1..MAX_ORIGINAL_SIDE) {
            "Resolução da imagem não suportada."
        }
        var sample = 1
        while (bounds.outWidth / sample > 1200 || bounds.outHeight / sample > 1200) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: error("Não foi possível decodificar a imagem.")
    }

    /** O recorte quadrado no preview é o mesmo recorte salvo, sem distorção. */
    fun crop(source: Bitmap, zoom: Float, horizontal: Float, vertical: Float): Bitmap {
        require(zoom in 1f..3f && horizontal in -1f..1f && vertical in -1f..1f)
        val side = minOf(source.width, source.height) / zoom
        val travelX = (source.width - side).coerceAtLeast(0f)
        val travelY = (source.height - side).coerceAtLeast(0f)
        val left = ((horizontal + 1f) * 0.5f * travelX).toInt()
        val top = ((vertical + 1f) * 0.5f * travelY).toInt()
        val src = Rect(
            left.coerceIn(0, source.width - 1), top.coerceIn(0, source.height - 1),
            (left + side.toInt().coerceAtLeast(1)).coerceAtMost(source.width),
            (top + side.toInt().coerceAtLeast(1)).coerceAtMost(source.height)
        )
        val out = Bitmap.createBitmap(OUTPUT_SIZE, OUTPUT_SIZE, Bitmap.Config.ARGB_8888)
        Canvas(out).apply {
            drawColor(Color.WHITE)
            drawBitmap(source, src, Rect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
        }
        return out
    }

    fun save(context: Context, uid: String, bitmap: Bitmap) {
        require(bitmap.width == OUTPUT_SIZE && bitmap.height == OUTPUT_SIZE)
        val image = ByteArrayOutputStream().use { output ->
            check(bitmap.compress(Bitmap.CompressFormat.JPEG, 82, output))
            output.toByteArray()
        }
        require(image.size <= MAX_OUTPUT_BYTES) { "A imagem final excedeu 180 KB." }
        val dest = file(context, uid)
        check(dest.parentFile?.mkdirs() == true || dest.parentFile?.isDirectory == true)
        val tmp = File(dest.parentFile, dest.name + ".tmp")
        try {
            tmp.outputStream().use { it.write(image) }
            check(tmp.renameTo(dest)) { "Não foi possível salvar a foto." }
        } finally {
            tmp.delete()
        }
    }

    fun remove(context: Context, uid: String): Boolean {
        val f = file(context, uid)
        return !f.exists() || f.delete()
    }
}
