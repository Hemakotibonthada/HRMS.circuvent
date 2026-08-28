package com.circuvent.hrms.domain

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlin.math.abs

/**
 * HELPDESK RULES — vocabulary, SLA phrasing and form validation
 *
 * Three jobs, each with a trap in it.
 *
 * The state vocabulary must not silently drop a state the server knows and this
 * build does not. A ticket whose status renders blank is one the person
 * believes nobody has touched.
 *
 * The SLA phrase is the only number on the screen somebody plans around —
 * "they will look at this before I leave" — so an overdue ticket has to say
 * overdue rather than counting down past zero into a negative "due in".
 *
 * The validation mirrors the server's schema exactly. Client validation that is
 * stricter rejects things the server would have taken; looser sends a round
 * trip to be told what the phone already knew, on a form somebody is filling in
 * one-handed.
 */
object HelpdeskRules {

    enum class Tone { SUCCESS, WARNING, DANGER, NEUTRAL, INFO }

    enum class Field { SUBJECT, BODY }

    /** The four the API's enum accepts, most severe first. */
    val selectablePriorities = listOf("urgent", "high", "normal", "low")

    private val stateLabels = mapOf(
        "new" to "New",
        "open" to "In progress",
        "pending_requester" to "Waiting for you",
        "pending_third_party" to "Waiting on someone else",
        "resolved" to "Resolved",
        "closed" to "Closed",
    )

    private val stateTones = mapOf(
        "new" to Tone.INFO,
        "open" to Tone.INFO,
        // The one state that needs the requester to do something. It is the
        // only one in the attention colour, so a list of six tickets shows at a
        // glance which is waiting on them.
        "pending_requester" to Tone.WARNING,
        "pending_third_party" to Tone.NEUTRAL,
        "resolved" to Tone.SUCCESS,
        "closed" to Tone.NEUTRAL,
    )

    private val priorityLabels = mapOf(
        "urgent" to "Urgent",
        "high" to "High",
        "normal" to "Normal",
        "low" to "Low",
    )

    private val priorityTones = mapOf(
        "urgent" to Tone.DANGER,
        "high" to Tone.WARNING,
        "normal" to Tone.NEUTRAL,
        "low" to Tone.NEUTRAL,
    )

    private fun humanise(value: String): String {
        val spaced = value.replace('_', ' ').trim()
        return if (spaced.isEmpty()) "" else spaced.replaceFirstChar { it.uppercase() }
    }

    fun stateLabel(state: String): String =
        stateLabels[state] ?: humanise(state).ifEmpty { "Unknown" }

    fun stateTone(state: String): Tone = stateTones[state] ?: Tone.NEUTRAL

    fun priorityLabel(priority: String): String =
        priorityLabels[priority] ?: humanise(priority).ifEmpty { "Normal" }

    fun priorityTone(priority: String): Tone = priorityTones[priority] ?: Tone.NEUTRAL

    /** True once a ticket needs nothing further from anyone. */
    fun isSettled(state: String): Boolean = state == "resolved" || state == "closed"

    data class DueState(val text: String, val tone: Tone, val overdue: Boolean)

    /** "2 hours", "1 day", "45 minutes" — a span, with no direction implied. */
    private fun span(millis: Long): String {
        val minutes = millis / 60_000
        if (minutes < 1) return "less than a minute"
        if (minutes < 60) return "$minutes ${if (minutes == 1L) "minute" else "minutes"}"

        val hours = Math.round(millis / 3_600_000.0)
        if (millis < 48 * 3_600_000L) return "$hours ${if (hours == 1L) "hour" else "hours"}"

        val days = Math.round(millis / 86_400_000.0)
        return "$days ${if (days == 1L) "day" else "days"}"
    }

    /**
     * How the resolution deadline should read.
     *
     * `breached` is the server's own verdict and wins over the arithmetic. The
     * clock pauses while a ticket waits on the requester, so a deadline that
     * looks past on a phone may not have been missed — and telling somebody
     * their request is overdue when the helpdesk is waiting on *them* is both
     * wrong and the opposite of useful.
     *
     * Null when there is no deadline to report, so the caller renders nothing
     * rather than an empty row where a time belongs.
     */
    fun dueState(
        dueAt: String?,
        now: Instant,
        breached: Boolean = false,
        settled: Boolean = false,
    ): DueState? {
        // A settled ticket has no deadline left to run. Counting down on a
        // resolved ticket invites somebody to chase one that is already done.
        if (settled) return null
        if (dueAt.isNullOrBlank()) return null

        val due = try {
            Instant.parse(dueAt)
        } catch (_: DateTimeParseException) {
            return null
        }

        val remaining = Duration.between(now, due).toMillis()

        if (breached || remaining < 0) {
            return DueState("Overdue by ${span(abs(remaining))}", Tone.DANGER, overdue = true)
        }

        return DueState(
            text = "Due in ${span(remaining)}",
            // Inside two hours it becomes worth looking at, so it stops being
            // grey.
            tone = if (remaining <= 2 * 3_600_000L) Tone.WARNING else Tone.NEUTRAL,
            overdue = false,
        )
    }

    /**
     * Validates a new ticket against the same bounds the server enforces:
     * subject trimmed to 3–200 characters, body trimmed to 1–20,000.
     *
     * Trimmed on both sides, because a subject of five spaces passes a naive
     * length check here and is rejected there — which reads as the app losing
     * the ticket.
     */
    fun validateTicket(subject: String, body: String): Map<Field, String> {
        val errors = mutableMapOf<Field, String>()

        val trimmedSubject = subject.trim()
        when {
            trimmedSubject.length < 3 ->
                errors[Field.SUBJECT] = "Give the ticket a subject of at least three characters"
            trimmedSubject.length > 200 ->
                errors[Field.SUBJECT] = "Keep the subject under 200 characters"
        }

        val trimmedBody = body.trim()
        when {
            trimmedBody.isEmpty() ->
                errors[Field.BODY] = "Describe the problem, however briefly"
            trimmedBody.length > 20_000 ->
                errors[Field.BODY] = "This is too long to send. Attach the detail to a reply instead."
        }

        return errors
    }
}
