package com.circuvent.hrms.data

import kotlinx.serialization.Serializable

/**
 * The employee's own record, as far as they are allowed to see and change it.
 *
 * A deliberately narrow shape. The server will only accept the personal fields
 * back, and giving the phone a DTO that carried a designation or a salary would
 * invite a screen that lets somebody edit one and then fails on save.
 */
@Serializable
data class MyDetailsDto(
    val id: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val employeeCode: String? = null,
    val workEmail: String? = null,
    val personalEmail: String? = null,
    val phone: String? = null,
    val dateOfBirth: String? = null,
    val bloodGroup: String? = null,
    val maritalStatus: String? = null,
    val addressLine1: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postalCode: String? = null,
    val country: String? = null,
    /** Read-only here; changing it is not self-service. */
    val designation: String? = null,
    val joinDate: String? = null,
    /** Also HR's to set. Shown because a person is entitled to know their own terms. */
    val confirmationDate: String? = null,
    val employmentType: String? = null,
    val departmentName: String? = null,
    val managerName: String? = null,
    /**
     * True once a date of birth exists.
     *
     * Sent by the server rather than inferred from the value being non-null,
     * because the rule about who may change it lives there — and a phone that
     * guessed would eventually guess differently from the endpoint enforcing
     * it, showing an editable field that then refuses to save.
     */
    val dateOfBirthLocked: Boolean = false,
)

/**
 * Only what the server accepts.
 *
 * Nulls are meaningful — clearing a phone number is a real edit — so every
 * field is nullable and the encoder is configured to send explicit nulls.
 */
@Serializable
data class MyDetailsSave(
    val phone: String? = null,
    val personalEmail: String? = null,
    val dateOfBirth: String? = null,
    val bloodGroup: String? = null,
    val maritalStatus: String? = null,
    val addressLine1: String? = null,
    val city: String? = null,
    val state: String? = null,
    val postalCode: String? = null,
)

/**
 * One dated fact in somebody's employment history.
 *
 * There is no promotions or transfers table in this system and `designation` is
 * a single overwritten column, so a role change leaves no record behind. The
 * timeline is therefore only what was genuinely recorded with a date.
 */
@Serializable
data class TimelineEntryDto(
    val date: String = "",
    /** joined | confirmed | pay_revised | left */
    val kind: String = "",
    val title: String = "",
    val detail: String? = null,
)

@Serializable
data class TimelineResponse(
    val items: List<TimelineEntryDto> = emptyList(),
    /** What the list is built from, so the screen can say it rather than imply completeness. */
    val note: String = "",
)
