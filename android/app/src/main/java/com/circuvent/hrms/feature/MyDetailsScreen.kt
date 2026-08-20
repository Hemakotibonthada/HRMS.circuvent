package com.circuvent.hrms.feature

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.core.design.Theme
import com.circuvent.hrms.core.ui.AppButton
import com.circuvent.hrms.core.ui.AppCard
import com.circuvent.hrms.core.ui.AppText
import com.circuvent.hrms.core.ui.Banner
import com.circuvent.hrms.core.ui.BannerTone
import com.circuvent.hrms.core.ui.SkeletonRows
import com.circuvent.hrms.core.ui.TextTone
import com.circuvent.hrms.core.ui.rememberFormattedDate
import com.circuvent.hrms.core.ui.screenPadding
import com.circuvent.hrms.data.MyDetailsDto
import com.circuvent.hrms.data.MyDetailsSave
import kotlinx.coroutines.launch

/**
 * The details somebody owns about themselves.
 *
 * Everything here previously required asking HR to type it in, which is why
 * not one employee had a date of birth recorded and the birthday strip on the
 * home screen had never had anything to show.
 *
 * The fields that are *not* here matter as much as the ones that are:
 * designation, department, manager, pay and employment dates are shown where
 * relevant but never editable, because an employee who can change those can
 * promote themselves or reroute their own approvals. The server enforces that
 * independently; this screen simply does not offer it.
 */
@Composable
fun MyDetailsScreen(container: AppContainer) {
    var state by remember { mutableStateOf<Loaded<MyDetailsDto>>(Loaded.Loading) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<BannerTone, String>?>(null) }

    var phone by remember { mutableStateOf("") }
    var personalEmail by remember { mutableStateOf("") }
    var dateOfBirth by remember { mutableStateOf("") }
    var bloodGroup by remember { mutableStateOf("") }
    var addressLine1 by remember { mutableStateOf("") }
    var city by remember { mutableStateOf("") }
    var stateName by remember { mutableStateOf("") }
    var postalCode by remember { mutableStateOf("") }

    val scope = rememberCoroutineScope()

    fun adopt(me: MyDetailsDto) {
        state = Loaded.Ready(me)
        phone = me.phone.orEmpty()
        personalEmail = me.personalEmail.orEmpty()
        dateOfBirth = me.dateOfBirth?.take(10).orEmpty()
        bloodGroup = me.bloodGroup.orEmpty()
        addressLine1 = me.addressLine1.orEmpty()
        city = me.city.orEmpty()
        stateName = me.state.orEmpty()
        postalCode = me.postalCode.orEmpty()
    }

    suspend fun load() {
        state = try {
            val me = container.repository.myDetails()
            adopt(me)
            Loaded.Ready(me)
        } catch (e: Throwable) {
            failureOf("Your details", e)
        }
    }

    LaunchedEffect(Unit) { load() }

    fun save() {
        busy = true
        message = null
        scope.launch {
            try {
                // Blank means "clear it", so blanks are sent as null rather
                // than as empty strings — an empty phone number in the database
                // is a phone number nobody can ring.
                val saved = container.repository.saveMyDetails(
                    MyDetailsSave(
                        phone = phone.trim().ifBlank { null },
                        personalEmail = personalEmail.trim().ifBlank { null },
                        // Only sent when it is not already recorded. The server
                        // refuses a change, and sending the unchanged value
                        // would turn a no-op save into a 409.
                        dateOfBirth = dateOfBirth.trim()
                            .ifBlank { null }
                            ?.takeIf { (state as? Loaded.Ready)?.value?.dateOfBirthLocked != true },
                        bloodGroup = bloodGroup.trim().ifBlank { null },
                        addressLine1 = addressLine1.trim().ifBlank { null },
                        city = city.trim().ifBlank { null },
                        state = stateName.trim().ifBlank { null },
                        postalCode = postalCode.trim().ifBlank { null },
                    )
                )
                adopt(saved)
                message = BannerTone.SUCCESS to "Saved"
            } catch (e: Exception) {
                // The server's sentence is shown as-is. It is the one that
                // explains why a date of birth cannot be changed, and it is
                // better than anything this screen could invent.
                message = BannerTone.ERROR to (e.message ?: "That was not saved")
            } finally {
                busy = false
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(screenPadding()),
        verticalArrangement = Arrangement.spacedBy(Theme.spacing.md),
    ) {
        when (val current = state) {
            is Loaded.Loading -> SkeletonRows(count = 4, rowHeight = 72.dp)

            is Loaded.Failed -> Banner(
                BannerTone.ERROR,
                current.title,
                description = current.description,
            )

            is Loaded.Ready -> {
                val me = current.value

                message?.let { (tone, text) -> Banner(tone, text) }

                // The parts HR owns. Shown because people need to check them,
                // and flat text because asking somebody not to edit something
                // they can see a box around never works.
                AppCard(muted = true) {
                    AppText("${me.firstName} ${me.lastName}".trim(), weight = FontWeight.SemiBold)
                    listOfNotNull(
                        me.designation?.takeIf { it.isNotBlank() },
                        me.employeeCode?.takeIf { it.isNotBlank() },
                    ).takeIf { it.isNotEmpty() }?.let {
                        AppText(
                            it.joinToString(" · "),
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                    }
                    me.joinDate?.takeIf { it.isNotBlank() }?.let {
                        AppText(
                            "Joined ${rememberFormattedDate(it)}",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                    }
                    Spacer(Modifier.height(Theme.spacing.xs))
                    AppText(
                        "Your role, code and joining date are set by HR.",
                        size = Theme.type.caption,
                        lineHeight = Theme.type.captionLine,
                        tone = TextTone.MUTED,
                    )
                }

                Field("Mobile number", phone, { phone = it }, KeyboardType.Phone, busy)
                Field("Personal email", personalEmail, { personalEmail = it }, KeyboardType.Email, busy)

                if (me.dateOfBirthLocked) {
                    AppCard(muted = true) {
                        AppText("Date of birth", size = Theme.type.caption, tone = TextTone.MUTED)
                        AppText(
                            me.dateOfBirth?.let { rememberFormattedDate(it) } ?: "—",
                            weight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(Theme.spacing.xs))
                        AppText(
                            "Ask HR to change this. It affects gratuity and your retirement date.",
                            size = Theme.type.caption,
                            lineHeight = Theme.type.captionLine,
                            tone = TextTone.MUTED,
                        )
                    }
                } else {
                    OutlinedTextField(
                        value = dateOfBirth,
                        onValueChange = { dateOfBirth = it.take(10) },
                        label = { Text("Date of birth") },
                        supportingText = {
                            Text("YYYY-MM-DD. You can set this once; after that HR changes it.")
                        },
                        singleLine = true,
                        enabled = !busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }

                Field("Blood group", bloodGroup, { bloodGroup = it }, KeyboardType.Text, busy)
                Field("Address", addressLine1, { addressLine1 = it }, KeyboardType.Text, busy)

                Row(horizontalArrangement = Arrangement.spacedBy(Theme.spacing.sm)) {
                    Column(Modifier.weight(1f)) {
                        Field("City", city, { city = it }, KeyboardType.Text, busy)
                    }
                    Column(Modifier.weight(1f)) {
                        Field("State", stateName, { stateName = it }, KeyboardType.Text, busy)
                    }
                }

                Field("PIN code", postalCode, { postalCode = it }, KeyboardType.Number, busy)

                AppButton(label = "Save", onClick = ::save, busy = busy)
            }
        }
    }
}

@Composable
private fun Field(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    keyboard: KeyboardType,
    busy: Boolean,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        modifier = Modifier.fillMaxWidth(),
    )
}
