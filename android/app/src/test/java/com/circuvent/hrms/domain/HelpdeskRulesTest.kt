package com.circuvent.hrms.domain

import com.circuvent.hrms.domain.HelpdeskRules.Field
import com.circuvent.hrms.domain.HelpdeskRules.Tone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class HelpdeskRulesTest {

    private val now: Instant = Instant.parse("2026-03-10T12:00:00Z")

    private fun at(millis: Long): String = now.plusMillis(millis).toString()

    private val minute = 60_000L
    private val hour = 60 * minute
    private val day = 24 * hour

    @Test
    fun `states read as something a requester understands`() {
        assertEquals("New", HelpdeskRules.stateLabel("new"))
        assertEquals("In progress", HelpdeskRules.stateLabel("open"))
        assertEquals("Waiting on someone else", HelpdeskRules.stateLabel("pending_third_party"))
        assertEquals("Resolved", HelpdeskRules.stateLabel("resolved"))
    }

    @Test
    fun `the state that needs the requester says so`() {
        // The difference between "we are working on it" and "we cannot
        // continue until you reply" is the whole reason somebody opens this
        // screen.
        assertEquals("Waiting for you", HelpdeskRules.stateLabel("pending_requester"))
        assertEquals(Tone.WARNING, HelpdeskRules.stateTone("pending_requester"))
        assertEquals(Tone.NEUTRAL, HelpdeskRules.stateTone("pending_third_party"))
    }

    @Test
    fun `an unknown state is made readable rather than hidden`() {
        // A ticket whose status renders blank is one the person believes
        // nobody has touched.
        assertEquals("Escalated to vendor", HelpdeskRules.stateLabel("escalated_to_vendor"))
        assertEquals(Tone.NEUTRAL, HelpdeskRules.stateTone("escalated_to_vendor"))
    }

    @Test
    fun `the priorities offered are the four the server accepts`() {
        // An option here the server rejects is a form that fails on submit for
        // a reason the person cannot see.
        assertEquals(listOf("urgent", "high", "normal", "low"), HelpdeskRules.selectablePriorities)
        assertEquals(Tone.DANGER, HelpdeskRules.priorityTone("urgent"))
        assertEquals(Tone.NEUTRAL, HelpdeskRules.priorityTone("blocker"))
        assertEquals("Blocker", HelpdeskRules.priorityLabel("blocker"))
    }

    @Test
    fun `settled means nothing further is needed`() {
        assertTrue(HelpdeskRules.isSettled("resolved"))
        assertTrue(HelpdeskRules.isSettled("closed"))
        assertFalse(HelpdeskRules.isSettled("pending_requester"))
    }

    @Test
    fun `the deadline counts down while there is time`() {
        assertEquals("Due in 3 hours", HelpdeskRules.dueState(at(3 * hour), now)?.text)
        assertEquals("Due in 45 minutes", HelpdeskRules.dueState(at(45 * minute), now)?.text)
        assertEquals("Due in 3 days", HelpdeskRules.dueState(at(3 * day), now)?.text)
        assertEquals("Due in 30 hours", HelpdeskRules.dueState(at(30 * hour), now)?.text)
    }

    @Test
    fun `an overdue ticket says overdue rather than counting past zero`() {
        // The failure being prevented: "Due in -2 hours".
        val state = HelpdeskRules.dueState(at(-2 * hour), now)
        assertEquals("Overdue by 2 hours", state?.text)
        assertTrue(state!!.overdue)
        assertEquals(Tone.DANGER, state.tone)
    }

    @Test
    fun `the server's breach verdict beats the arithmetic`() {
        // The SLA clock pauses while a ticket waits on the requester, so a
        // deadline that looks past on a phone may not have been missed. The
        // server knows about the pauses; this does not.
        val breachedButFuture = HelpdeskRules.dueState(at(3 * hour), now, breached = true)
        assertTrue(breachedButFuture!!.overdue)
        assertTrue(breachedButFuture.text.startsWith("Overdue by"))
    }

    @Test
    fun `the last two hours turn amber`() {
        assertEquals(Tone.WARNING, HelpdeskRules.dueState(at(90 * minute), now)?.tone)
        assertEquals(Tone.NEUTRAL, HelpdeskRules.dueState(at(6 * hour), now)?.tone)
    }

    @Test
    fun `a settled ticket has no deadline left to run`() {
        // Counting down on a resolved ticket invites somebody to chase one
        // that is already done.
        assertNull(HelpdeskRules.dueState(at(-5 * hour), now, breached = true, settled = true))
        assertNull(HelpdeskRules.dueState(at(5 * hour), now, settled = true))
    }

    @Test
    fun `no deadline renders nothing rather than a blank`() {
        assertNull(HelpdeskRules.dueState(null, now))
        assertNull(HelpdeskRules.dueState("", now))
        assertNull(HelpdeskRules.dueState("not a date", now))
    }

    @Test
    fun `a few seconds is not rounded down to nothing`() {
        assertEquals("Due in less than a minute", HelpdeskRules.dueState(at(20_000), now)?.text)
        assertEquals("Overdue by less than a minute", HelpdeskRules.dueState(at(-20_000), now)?.text)
    }

    @Test
    fun `exactly one is singular`() {
        assertEquals("Due in 1 hour", HelpdeskRules.dueState(at(hour), now)?.text)
        assertEquals("Due in 1 minute", HelpdeskRules.dueState(at(minute), now)?.text)
    }

    @Test
    fun `a complete ticket is accepted`() {
        assertTrue(HelpdeskRules.validateTicket("Laptop will not charge", "It stopped last night.").isEmpty())
    }

    @Test
    fun `the bounds are the server's bounds`() {
        assertNotNull(HelpdeskRules.validateTicket("ab", "x")[Field.SUBJECT])
        assertNull(HelpdeskRules.validateTicket("abc", "x")[Field.SUBJECT])
        assertNull(HelpdeskRules.validateTicket("a".repeat(200), "x")[Field.SUBJECT])
        assertNotNull(HelpdeskRules.validateTicket("a".repeat(201), "x")[Field.SUBJECT])
        assertNull(HelpdeskRules.validateTicket("Subject", "a".repeat(20_000))[Field.BODY])
        assertNotNull(HelpdeskRules.validateTicket("Subject", "a".repeat(20_001))[Field.BODY])
    }

    @Test
    fun `whitespace is trimmed before it is measured`() {
        // A subject of five spaces passes a naive length check here and is
        // rejected there, which reads as the app losing the ticket.
        assertNotNull(HelpdeskRules.validateTicket("     ", "Something")[Field.SUBJECT])
        assertNotNull(HelpdeskRules.validateTicket("Subject", "   ")[Field.BODY])
    }

    @Test
    fun `every problem is reported at once`() {
        val errors = HelpdeskRules.validateTicket("", "")
        assertEquals(setOf(Field.SUBJECT, Field.BODY), errors.keys)
    }
}
