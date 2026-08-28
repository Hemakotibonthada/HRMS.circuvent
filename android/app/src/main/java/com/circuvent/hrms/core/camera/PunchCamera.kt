package com.circuvent.hrms.core.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Takes the punch photograph.
 *
 * Front camera, one frame, no preview recording and no file written by this
 * object. The bytes are handed straight to the caller.
 *
 * They do not always leave the device immediately: a punch made offline is
 * queued, and the photograph is queued with it, so it sits in the app's own
 * offline store until the punch is sent. That is the honest cost of letting
 * somebody clock in without a signal, and it is bounded — the queue entry is
 * deleted once the punch is accepted.
 *
 * The image is deliberately small. A punch photograph exists to show that a
 * recognisable person was there, which a 640px frame does at a fraction of the
 * size — and smaller means less to upload on a bad connection, less to store,
 * less to sit in a queue, and less to lose control of.
 */
object PunchCamera {

    /** Longest edge, in pixels. */
    private const val MAX_EDGE = 640
    private const val JPEG_QUALITY = 78

    sealed interface Result {
        class Captured(val jpeg: ByteArray, val takenAt: Long) : Result

        data class Failed(val message: String) : Result
    }

    /**
     * Binds the camera, takes one frame, and unbinds.
     *
     * Unbinding matters. Leaving the camera bound keeps the privacy indicator
     * lit, which is an accurate signal that the app can see you and a
     * misleading one about whether it is still recording. Neither belongs on a
     * screen somebody opens twice a day.
     */
    suspend fun capture(context: Context, lifecycleOwner: LifecycleOwner): Result {
        val provider = try {
            awaitProvider(context)
        } catch (e: Exception) {
            return Result.Failed(e.message ?: "The camera could not be started")
        }

        val capture = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .build()

        val selector = if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            // A device with no front camera still has to be able to punch. The
            // back camera is worse for this and better than refusing.
            CameraSelector.DEFAULT_BACK_CAMERA
        }

        return try {
            provider.unbindAll()
            provider.bindToLifecycle(lifecycleOwner, selector, capture)
            takeOne(context, capture)
        } catch (e: Exception) {
            Result.Failed(e.message ?: "The camera could not be started")
        } finally {
            provider.unbindAll()
        }
    }

    private suspend fun awaitProvider(context: Context): ProcessCameraProvider =
        suspendCoroutine { continuation ->
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener(
                { continuation.resume(future.get()) },
                ContextCompat.getMainExecutor(context),
            )
        }

    private suspend fun takeOne(context: Context, capture: ImageCapture): Result =
        suspendCoroutine { continuation ->
            capture.takePicture(
                ContextCompat.getMainExecutor(context),
                object : ImageCapture.OnImageCapturedCallback() {
                    override fun onCaptureSuccess(image: ImageProxy) {
                        val takenAt = System.currentTimeMillis()
                        val jpeg = try {
                            shrink(image)
                        } catch (e: Exception) {
                            image.close()
                            continuation.resume(
                                Result.Failed(e.message ?: "That photograph could not be read")
                            )
                            return
                        }
                        image.close()
                        continuation.resume(Result.Captured(jpeg, takenAt))
                    }

                    override fun onError(exception: ImageCaptureException) {
                        continuation.resume(
                            Result.Failed(exception.message ?: "The photograph was not taken")
                        )
                    }
                },
            )
        }

    /**
     * Downscales, rotates upright, and re-encodes.
     *
     * The rotation is not cosmetic. CameraX reports orientation as metadata a
     * server-side viewer may ignore, and a sideways face is harder to
     * recognise — which defeats the only reason the photograph is taken.
     */
    private fun shrink(image: ImageProxy): ByteArray {
        val buffer = image.planes[0].buffer
        val raw = ByteArray(buffer.remaining())
        buffer.get(raw)

        val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size)
            ?: throw IllegalStateException("That photograph could not be read")

        val longest = maxOf(decoded.width, decoded.height)
        val scale = if (longest > MAX_EDGE) MAX_EDGE.toFloat() / longest else 1f

        val matrix = Matrix().apply {
            postScale(scale, scale)
            postRotate(image.imageInfo.rotationDegrees.toFloat())
        }

        val out = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        val stream = ByteArrayOutputStream()
        out.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)

        if (out !== decoded) out.recycle()
        decoded.recycle()

        return stream.toByteArray()
    }
}
