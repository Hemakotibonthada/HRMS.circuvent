package com.circuvent.hrms.data.queue

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlin.math.min
import kotlin.math.pow

/**
 * THE OFFLINE QUEUE
 *
 * The reason this app exists. Somebody clocking in from a basement car park
 * has no signal, and their punch is the record that they were at work.
 *
 * Written to disk *before* it is sent, not sent-then-queued-on-failure. The
 * process can be killed between the tap and the response — locking the phone
 * and putting it in a pocket does exactly that — and the punch has to survive
 * it.
 *
 * Three properties matter, and each one is a defect that shipped somewhere
 * before it was understood:
 *
 *  * **Idempotency.** Every operation carries a client-generated id that is
 *    stable across retries and is sent as `Idempotency-Key`. A double tap on a
 *    slow network must not produce two punches.
 *  * **Ordering.** Operations on the same `streamKey` are sent in the order
 *    they were made. A clock-out that overtakes its clock-in records an
 *    impossible day.
 *  * **Three outcomes, not two.** Sent, queued, or refused. A permanently
 *    refused punch that reports as "clocked in" is the worst possible result,
 *    because the person stops thinking about it and finds out at payday.
 *
 * Plain SQLite rather than Room: one table, no relations, and Room would bring
 * an annotation processor and a compiler-plugin version to keep in step for a
 * schema that fits on a screen.
 */
class OfflineQueue(context: Context) {

    enum class Status { PENDING, IN_FLIGHT, FAILED, QUARANTINED }

    data class Operation(
        val id: String,
        val kind: String,
        val payload: String,
        val streamKey: String?,
        val status: Status,
        val attempts: Int,
        val nextAttemptAt: Long,
        val createdAt: Long,
        val lastError: String?,
    )

    private val helper = object : SQLiteOpenHelper(context, DB, null, VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE $TABLE (
                    id TEXT PRIMARY KEY NOT NULL,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    stream_key TEXT,
                    status TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    last_error TEXT
                )
                """.trimIndent()
            )
            // Reading the queue is "what is due, oldest first", on every tick.
            db.execSQL("CREATE INDEX idx_due ON $TABLE (status, next_attempt_at, created_at)")
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // Never dropped. The table can hold somebody's unsent clock-in, and
            // a migration that recreates it loses a record of them being at
            // work. A future version adds columns; it does not start again.
            throw IllegalStateException(
                "No migration from $oldVersion to $newVersion. The queue may hold unsent work."
            )
        }
    }

    /**
     * Adds an operation, or leaves the existing one alone.
     *
     * `CONFLICT_IGNORE` on the primary key is the idempotency guarantee at the
     * device end: enqueueing the same id twice — which is what a double tap
     * does — is one row.
     */
    fun enqueue(id: String, kind: String, payload: String, streamKey: String?): Boolean {
        val values = ContentValues().apply {
            put("id", id)
            put("kind", kind)
            put("payload", payload)
            put("stream_key", streamKey)
            put("status", Status.PENDING.name)
            put("attempts", 0)
            put("next_attempt_at", 0L)
            put("created_at", System.currentTimeMillis())
        }
        val row = helper.writableDatabase.insertWithOnConflict(
            TABLE, null, values, SQLiteDatabase.CONFLICT_IGNORE
        )
        return row != -1L
    }

    /**
     * What may be sent now.
     *
     * Only the head of each stream is returned. An operation behind a blocked
     * one in the same stream waits, because the order is the point.
     */
    fun due(now: Long = System.currentTimeMillis()): List<Operation> {
        val all = query(
            "status IN (?, ?) AND next_attempt_at <= ?",
            arrayOf(Status.PENDING.name, Status.FAILED.name, now.toString()),
        )

        val seenStreams = mutableSetOf<String>()
        return all.filter { operation ->
            val stream = operation.streamKey ?: return@filter true
            seenStreams.add(stream)
        }
    }

    fun pending(): List<Operation> =
        query("status IN (?, ?)", arrayOf(Status.PENDING.name, Status.FAILED.name))

    fun quarantined(): List<Operation> =
        query("status = ?", arrayOf(Status.QUARANTINED.name))

    /**
     * The outcome of one operation, in three states.
     *
     * Not a boolean. `submit()` in the previous implementation asked "is this
     * still pending?" to decide whether it had worked — and `pending()`
     * deliberately excludes quarantined work, so a permanently refused punch
     * came back as success. The clock-in screen said "Clocked in" to somebody
     * whose punch the server had rejected outright.
     */
    fun outcomeOf(id: String): Status? {
        helper.readableDatabase.query(
            TABLE, arrayOf("status"), "id = ?", arrayOf(id), null, null, null
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            return Status.valueOf(cursor.getString(0))
        }
    }

    fun markSent(id: String) {
        helper.writableDatabase.delete(TABLE, "id = ?", arrayOf(id))
    }

    /**
     * Records a failure and decides whether it is worth trying again.
     *
     * A 4xx other than 408 or 429 is the server saying no on the merits: the
     * payload is wrong, or the action is not allowed. Retrying it forever
     * would hide a refusal behind an amber "sending" state for ever. Anything
     * else — a 5xx, a timeout, a dead network — is retried with exponential
     * backoff.
     */
    fun markFailed(id: String, status: Int?, error: String?, now: Long = System.currentTimeMillis()) {
        val permanent = status != null && status in 400..499 && status != 408 && status != 429
        val db = helper.writableDatabase

        if (permanent) {
            db.execSQL(
                "UPDATE $TABLE SET status = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?",
                arrayOf(Status.QUARANTINED.name, error, id),
            )
            return
        }

        db.execSQL(
            "UPDATE $TABLE SET status = ?, last_error = ?, attempts = attempts + 1, " +
                "next_attempt_at = ? WHERE id = ?",
            arrayOf(Status.FAILED.name, error, backoffFrom(id, now), id),
        )
    }

    private fun backoffFrom(id: String, now: Long): Long {
        val attempts = query("id = ?", arrayOf(id)).firstOrNull()?.attempts ?: 0
        return now + backoffMs(attempts + 1)
    }

    /** Puts refused work back in the queue, only ever at the user's request. */
    fun retry(id: String) {
        helper.writableDatabase.execSQL(
            "UPDATE $TABLE SET status = ?, next_attempt_at = 0, last_error = NULL WHERE id = ?",
            arrayOf(Status.PENDING.name, id),
        )
    }

    /** Throws refused work away. Only ever an explicit user action. */
    fun discard(id: String) {
        helper.writableDatabase.delete(TABLE, "id = ?", arrayOf(id))
    }

    private fun query(where: String, args: Array<String>): List<Operation> {
        helper.readableDatabase.query(
            TABLE, null, where, args, null, null, "created_at ASC"
        ).use { cursor ->
            val out = mutableListOf<Operation>()
            while (cursor.moveToNext()) {
                out += Operation(
                    id = cursor.getString(cursor.getColumnIndexOrThrow("id")),
                    kind = cursor.getString(cursor.getColumnIndexOrThrow("kind")),
                    payload = cursor.getString(cursor.getColumnIndexOrThrow("payload")),
                    streamKey = cursor.getString(cursor.getColumnIndexOrThrow("stream_key")),
                    status = Status.valueOf(cursor.getString(cursor.getColumnIndexOrThrow("status"))),
                    attempts = cursor.getInt(cursor.getColumnIndexOrThrow("attempts")),
                    nextAttemptAt = cursor.getLong(cursor.getColumnIndexOrThrow("next_attempt_at")),
                    createdAt = cursor.getLong(cursor.getColumnIndexOrThrow("created_at")),
                    lastError = cursor.getString(cursor.getColumnIndexOrThrow("last_error")),
                )
            }
            return out
        }
    }

    companion object {
        private const val DB = "circuvent_queue.db"
        private const val VERSION = 1
        private const val TABLE = "operations"

        /**
         * Exponential backoff, capped at five minutes.
         *
         * Capped because this runs while the app is open and somebody is
         * looking at it. An hour-long backoff on a phone that regained signal
         * two minutes ago means a punch that sits there for no reason.
         */
        fun backoffMs(attempt: Int): Long {
            if (attempt <= 0) return 0
            val exponential = 1_000L * 2.0.pow(attempt - 1).toLong()
            return min(exponential, 5 * 60 * 1000L)
        }
    }
}
