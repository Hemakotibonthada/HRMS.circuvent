package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

/**
 * Whether this organisation photographs its staff when they punch.
 *
 * Every field defaults to the safe answer. A response the phone cannot parse,
 * or one from an older server that has never heard of this, must mean "no
 * photograph" — the failure direction matters more here than almost anywhere
 * else in the app.
 */
@Serializable
data class AttendancePolicyDto(
    val requireSelfieOnPunch: Boolean = false,
    val selfieRetentionDays: Int = 90,
    val canEdit: Boolean = false,
    /**
     * What the employee is told before the first photograph.
     *
     * Written by the server because it quotes the organisation's own retention
     * period. A notice composed on the phone would eventually quote a number
     * the server had changed, which is worse than no notice: it is a specific
     * false assurance.
     */
    val notice: String? = null,
)

@Serializable
data class AttendancePolicySave(
    val requireSelfieOnPunch: Boolean,
    val selfieRetentionDays: Int? = null,
)

/** A punch photograph on its way to the server. */
@Serializable
data class PunchSelfie(
    val base64: String,
    val contentType: String,
    /** When the shutter fired, which is not when the request is sent. */
    val takenAt: Long,
)
