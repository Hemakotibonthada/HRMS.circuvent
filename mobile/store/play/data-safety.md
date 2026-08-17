# Data safety — the answers, and why

Play Console → Policy → App content → **Data safety**.

Getting this wrong is the most common cause of a suspension that arrives months
after release, because the form is checked against what the app actually does,
not against what you meant. Every answer below is traceable to a line of code.

---

## Does your app collect or share any of the required user data types?

**Yes.**

## Is all of the user data collected by your app encrypted in transit?

**Yes.** Every request goes through `MobileApiClient` over HTTPS. The base URL
is set per build profile in `eas.json`; there is no cleartext fallback and
`resolveBaseUrl()` throws rather than guessing a host.

## Do you provide a way for users to request that their data be deleted?

**Yes, through the employer.**

This is the answer that needs care. The person using this app is an employee;
their employer is the data controller and Circuvent is the processor. An
employee cannot delete their own attendance record — it is a payroll and
statutory record, and in India there are retention obligations on it.

What exists: `/api/governance/requests` implements subject access and erasure
as three separate decisions with an append-only evidence log, and
`/api/governance/holds` implements legal holds that block erasure. The route in
is the employer's HR team.

Say so in the URL field: link to the privacy policy section that names the
process. Claiming self-serve deletion the app does not have is worse than the
truth.

---

## Data types

### Location → Approximate location, Precise location

| Question | Answer |
|---|---|
| Collected | **Yes** |
| Shared | No |
| Processed ephemerally | **No** — the coordinates are stored on the attendance record |
| Required or optional | **Required** for clock-in at a geofenced site |
| Purpose | **App functionality** |

Read only at the moment the user taps clock in or out (`readPosition()` in
`mobile/src/lib/location.ts`, called from the punch handler and nowhere else).

`ACCESS_BACKGROUND_LOCATION` is in `blockedPermissions` in `app.json` — blocked
outright, not merely unrequested, so the OS will refuse it even if a future
version asks. State this in the listing; reviewers look for it on any app that
requests foreground location.

Do **not** tick "Processed ephemerally". The latitude, longitude, accuracy and a
geofence verdict are written to `hrms.attendance_records`. Ephemeral means it
never leaves memory, and this leaves memory.

### Personal info → Name, Email address, User IDs

| Question | Answer |
|---|---|
| Collected | **Yes** |
| Shared | No |
| Required | **Required** — it is the sign-in |
| Purpose | **App functionality**, **Account management** |

The email and password are typed in at sign-in; the name, employee id and role
come back from `/api/auth/me`.

### Financial info → *not declared*

Payslip amounts are **displayed**, not collected. Play's question is about data
gathered from the device and transmitted off it. Pay figures travel the other
way — server to phone — and the app performs no arithmetic on them and never
sends them anywhere.

If you later add expense capture with receipt photos, this changes: that is
"Photos" and possibly "Financial info", and it is collected.

### App activity, Messages, Contacts, Photos, Files, Calendar, Health → *none*

No analytics SDK, no crash reporter, no advertising identifier. Ticket text and
leave reasons the user types are stored, but Play's "Messages" category means
personal communications (SMS, email, in-app messaging between users), not free
text in a form the employer already owns.

### Biometrics → *not declared, deliberately*

`expo-local-authentication` asks the operating system to confirm the enrolled
person. The fingerprint or face never reaches the app, let alone a server; what
comes back is a boolean.

This is also why the app treats biometric unlock as a lock on an existing
session rather than a way of signing in — the settings screen says so in as many
words. If it were treated as authentication, the phone would be the authority,
and bypassing the prompt on a rooted device is a solved problem.

---

## Data collected but not sent by the app

Kept on the device only, and worth knowing about even though the form does not
ask:

| What | Where | Why |
|---|---|---|
| Access and refresh tokens | `expo-secure-store` (Keychain / Keystore) | The session |
| Queued actions awaiting a connection | `expo-sqlite` | Offline clock-in |
| The biometric-unlock preference | `expo-secure-store` | A single boolean |

No payslip is cached. That is deliberate and commented in
`mobile/app/payslips/index.tsx`: salary is the most sensitive field in the
product, and keeping it in app storage so it can be read in a tunnel is a poor
trade for a screen nobody opens in one.
