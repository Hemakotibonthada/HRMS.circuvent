package com.circuvent.hrms.desktop

import com.circuvent.hrms.shared.api.HrmsApi
import com.circuvent.hrms.shared.api.TokenStore
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Signs in against a real server and reads what the screens read.
 *
 * This exists because the sign-in path could not be covered by a unit test and
 * was wrong in three separate ways at once — the session nested under `user`,
 * the tokens nested under `tokens`, and neither returned at all unless the
 * caller identifies as native. Each was invisible to the compiler and to every
 * mocked test, and together they meant a "successful" sign-in left every later
 * call unauthenticated.
 *
 * Skipped unless told where to point and who to be:
 *
 *   HRMS_TEST_BASE_URL=http://localhost:3000
 *   HRMS_TEST_EMAIL=someone@example.com
 *   HRMS_TEST_PASSWORD=...
 *
 * Credentials come from the environment and are never written down here. A
 * password in a test file is a password in the repository.
 */
class ApiSmokeTest {

    private val baseUrl = System.getenv("HRMS_TEST_BASE_URL")
    private val email = System.getenv("HRMS_TEST_EMAIL")
    private val password = System.getenv("HRMS_TEST_PASSWORD")

    private fun requireConfig(): Boolean =
        !baseUrl.isNullOrBlank() && !email.isNullOrBlank() && !password.isNullOrBlank()

    @Test
    fun `signs in and reads the screens`() {
        if (!requireConfig()) {
            println("ApiSmokeTest skipped: set HRMS_TEST_BASE_URL, HRMS_TEST_EMAIL, HRMS_TEST_PASSWORD")
            return
        }

        runBlocking {
            val api = HrmsApi(baseUrl!!, TokenStore())

            val session = when (val r = api.signIn(email!!, password!!)) {
                is HrmsApi.Result.Ok -> r.value
                is HrmsApi.Result.Failed -> fail("Sign-in failed: ${r.status} ${r.message}")
                is HrmsApi.Result.Offline -> fail("Sign-in could not reach $baseUrl: ${r.message}")
                HrmsApi.Result.Unauthorised -> fail("Sign-in refused those credentials")
            }

            assertTrue(session.email.isNotBlank(), "the session should carry an email")

            // The token test. `me()` needs the Authorization header, so it only
            // passes if the tokens were found in the response and stored —
            // which is precisely what was broken.
            when (val r = api.me()) {
                is HrmsApi.Result.Ok -> Unit
                HrmsApi.Result.Unauthorised ->
                    fail("Signed in but the session was not kept: no token was captured")
                is HrmsApi.Result.Failed -> fail("me() failed: ${r.status} ${r.message}")
                is HrmsApi.Result.Offline -> fail("me() offline: ${r.message}")
            }

            // Every read a screen makes. A 200 that cannot be deserialised now
            // reports as Failed rather than Offline, so a shape change here
            // names itself instead of looking like a network problem.
            //
            // `documents` is allowed to answer 403: it is the HR-wide list of
            // every letter in the tenant, deliberately restricted because a
            // document carries salary. An ordinary employee being refused is
            // the endpoint working, not a fault.
            val reads: List<Triple<String, suspend () -> HrmsApi.Result<*>, Boolean>> = listOf(
                Triple("clockState", { api.clockState() }, false),
                Triple("leaveBalances", { api.leaveBalances() }, false),
                Triple("leaveRequests", { api.leaveRequests() }, false),
                Triple("attendance", { api.attendance() }, false),
                Triple("teamAttendance", { api.teamAttendance() }, false),
                Triple("colleagues", { api.colleagues() }, false),
                Triple("praise", { api.praise() }, false),
                Triple("payslips", { api.payslips() }, false),
                Triple("expenses", { api.expenses() }, false),
                Triple("tickets", { api.tickets() }, false),
                Triple("holidays", { api.holidays() }, false),
                Triple("announcements", { api.announcements() }, false),
                Triple("documents", { api.documents() }, true),
                Triple("workArrangements", { api.workArrangements() }, false),
                Triple("regularisations", { api.regularisations() }, false),
                Triple("myDetails", { api.myDetails() }, false),
                Triple("wallPosts", { api.wallPosts() }, false),
                Triple("loans", { api.loans() }, false),
                Triple("reviewCycles", { api.reviewCycles() }, false),
                Triple("taxDeclaration", { api.taxDeclaration() }, false),
                Triple("benefitPlans", { api.benefitPlans() }, false),
                Triple("benefitEnrolments", { api.benefitEnrolments() }, false),
                Triple("assets", { api.assets() }, false),
                Triple("courses", { api.courses() }, false),
                Triple("enrolments", { api.enrolments() }, false),
                Triple("shiftSwaps", { api.shiftSwaps() }, false),
            )

            val broken = mutableListOf<String>()
            for ((name, call, forbiddenIsFine) in reads) {
                when (val r = call()) {
                    is HrmsApi.Result.Ok -> Unit
                    is HrmsApi.Result.Failed ->
                        if (!(forbiddenIsFine && r.status == 403)) {
                            broken += "$name → ${r.status} ${r.message}"
                        }
                    is HrmsApi.Result.Offline -> broken += "$name → offline ${r.message}"
                    HrmsApi.Result.Unauthorised -> broken += "$name → unauthorised"
                }
            }

            // Reported together rather than one per run. Fifteen endpoints
            // fixed one failing test at a time is fifteen builds.
            assertTrue(broken.isEmpty(), "Endpoints the desktop app cannot read:\n" + broken.joinToString("\n"))
        }
    }
}
