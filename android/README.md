# Circuvent HR — native Android

Kotlin and Jetpack Compose, replacing the React Native / Expo app in `mobile/`.

```bash
cd android
./gradlew :app:testDebugUnitTest      # 92 tests
./gradlew :app:assembleDebug          # app-debug.apk
./gradlew :app:assembleRelease        # app-release-unsigned.apk
```

Requires JDK 17+ and an Android SDK with platform 35. `ANDROID_HOME` is picked
up automatically; a `local.properties` is only needed if it is not set.

---

## Why this exists

The Expo app worked and was well tested. This is not a rescue; it is a change of
platform, and it is worth being clear about what it actually bought:

| | Expo / React Native | Native |
|---|---|---|
| Release APK | ~19 MB, plus the JS bundle and Hermes | **1.9 MB** |
| Dates | ISO strings throughout, with a paragraph of comment explaining that `new Date("2026-03-01")` reads back as February 28th west of Greenwich | `java.time`, which has no timezone to get wrong |
| Text scaling | `fontSize` scaled by the OS, `lineHeight` not — clipped every screen at 200% until it was fixed by hand | `sp` for both; the ratio holds at every setting with no arithmetic |
| Startup | JS engine, bundle parse, then first paint | Straight to composition |
| Build proof | Typechecks. Had never been compiled for a device. | An APK, from this repository, today |

The cost is honest too: two codebases now describe the same product, and the
Expo app's 81 JavaScript tests do not run against this one. See
[Retiring the Expo app](#retiring-the-expo-app).

---

## Layout

```
app/src/main/java/com/circuvent/hrms/
├── core/design/     palette, contrast contract, spacing, type scale, theme
├── core/ui/         the kit: AppText, AppButton, AppCard, Banner, StatusPill,
│                    EmptyState, SkeletonRows
├── domain/          pure logic, no Android imports — the tested part
├── data/            TokenStore, ApiClient, AppRepository, OfflineQueue,
│                    LocationProvider
└── feature/         screens, tab bar, AppViewModel
```

`domain/` has no Android dependency on purpose, so it runs in a plain JVM test
with no emulator and no Robolectric. That is why there are 92 tests and they
finish in under a second.

---

## The parts that carry risk

**`domain/Geofence.kt`** decides whether a clock-in is accepted, which decides
whether somebody is paid for the day. The Earth radius is 6,371,008.8 m and
`GeofenceTest` asserts both the constant and the arc it implies — the previous
generation had the server on 6,371,000 and the phone on 6,371,008.8, and they
disagreed by about a metre per kilometre, which is enough to put somebody on
opposite sides of a 50 m office fence depending on which was asked.

Writing that test found a bug in the test itself: the literal 111,194.93 m is
what the *old* radius produces. Both numbers are now written down, next to each
other, with the reason.

**`data/queue/OfflineQueue.kt`** is why the app exists. Written to disk before
it is sent, never sent-then-queued-on-failure: the process can be killed
between the tap and the response, and locking the phone does exactly that. It
reports three outcomes — sent, queued, refused — because reporting a refusal as
a success is the worst of the three, and is a defect that shipped once already.

**`data/net/ApiClient.kt`** refreshes single-flight. Several screens discover an
expired token at the same moment; refreshing per request rotates the refresh
token three times, and the server correctly treats a reused refresh token as a
replay and revokes the session family — signing somebody out for opening their
phone.

**`core/design/Color.kt`** carries the audited palette, and `PaletteTest`
measures all twenty pairs the app renders in both schemes. The previous web
palette shipped fifteen WCAG failures, including a dark card at 1.04:1 against
its own background — a surface that was not visibly there.

---

## Screens

| Screen | Route | Notes |
|---|---|---|
| Sign in | — | MFA field appears only after the server asks for it |
| Today | `today` | Geofenced clock in/out, offline queue, refused-work retry and discard |
| Leave | `leave` | Balances and requests |
| Apply for leave | `leave/apply` | Validated by `LeaveRules`, submitted through the queue |
| Leave request | `leave/{id}` | |
| Shifts | `shifts` | Published rosters, next shift promoted, offer a shift for swap |
| Payslips | `payslips` | |
| Payslip | `payslips/{id}` | No arithmetic on the phone |
| Profile | `profile` | The hub; role-gated links |
| Attendance | `attendance` | Month cursor that cannot pass the current month |
| My equipment | `assets` | Assigned assets, warranty flagged |
| Benefits | `benefits` | Cover, plans on offer, dependants |
| Check-ins | `check-ins` | One-to-one notes and agreed actions |
| Learning | `learning` | In-progress first, then what can be started |
| Course | `learning/{id}` | Modules, enrol, mark a module done |
| Referrals | `referrals` | Bonus figures rendered only when the server sends them |
| Refer someone | `referrals/new` | |
| Shift swaps | `swaps` | Take a shift offered to you |
| Helpdesk | `helpdesk` | Live / waiting / all |
| Raise a ticket | `helpdesk/new` | Online only, by design |
| Ticket | `helpdesk/{id}` | Threaded replies, internal notes filtered twice |
| Approvals inbox | `inbox` | The workflow engine's queue — any process, not just leave |
| Leave approvals | `approvals` | Own requests refused before the tap |
| Settings | `settings` | Biometric unlock, sign out |

The tab bar shows on the five roots and nowhere else — a bar under a
half-finished form is an invitation to leave it.

---

## What is deliberately not built

Not oversights. Each one is a decision with a reason:

| | Why |
|---|---|
| **Expenses** | `GET /api/expenses` is a stub: it authenticates and returns `data: []` with a summary of all zeroes. A screen on it would tell every employee they have no expenses, which reads as a fact rather than a gap — the exact defect `docs/ROADMAP.md` records for `/api/helpdesk`. |
| **Goals** | `GET /api/performance/goals` requires a `cycleId` and no route lists cycles, so a mobile client cannot obtain one. |
| **Benefits enrolment** | Reading is here; electing is not. The server accepts an election only inside an enrolment window, or outside one with a life event, and getting that wrong means telling somebody they have cover they do not have. The screen says where to do it instead. |
| **Asset history** | The route is manager-only, so no row opens one. A tap that always 403s reads as a broken app. |
| **Documents to sign** | No route lists documents pending *my* signature. `/api/sign/[id]` is token-based, reached from an email. |
| **Certifications** | `GET /api/learning/certifications` is manager-only. |

---

## What is not built yet

| | |
|---|---|
| **Push notifications** | Not started on either platform. The listing does not claim it. |
| **Instrumented tests** | None. No Compose UI test, nothing run on a device or emulator. |
| **Biometric gate on launch** | The setting works and the prompt works; nothing yet re-locks the app after a minute in the background. |
| **Signing** | `assembleRelease` produces an *unsigned* APK. See below. |

**Nothing here has run on a device.** It compiles, R8 shrinks it to 2.3 MB, and
92 unit tests pass. That is not the same as working, and the first run against a
real Neon-backed API will find things: `docs/DEPLOYMENT.md` §7 records that no
backend exists yet either.

---

## Signing and release

There is no `signingConfig` in `build.gradle.kts` and no keystore in this
repository. A keystore is the app's identity for ever — lose it and you cannot
update the listing, you have to publish a new app under a new package name and
ask every user to reinstall — and committing one hands somebody the ability to
ship an update to every installed device.

For Play, either:

* keep using EAS-style managed credentials by having your CI hold the keystore
  and inject a `signingConfig`, or
* run `./gradlew :app:bundleRelease` and sign the `.aab` in CI with a key from
  a secret store.

The Play listing material in `mobile/store/play/` — listing copy, data-safety
answers, screenshots, feature graphic — applies unchanged to this build. The
package name is the same (`com.circuvent.hrms`), so it is the same listing.

`mobile/store/play/data-safety.md` remains accurate: this app collects location
at the moment of a punch and stores it on the attendance record, declares no
advertising ID, and never receives biometric data. `ACCESS_BACKGROUND_LOCATION`
is removed by `tools:node="remove"` in the manifest rather than merely not
requested, so a dependency cannot add it through manifest merging — which is
what a reviewer checks the declaration against.

---

## Retiring the Expo app

`mobile/` is still present and still wired into `npm run verify`, which is
deliberate. Deleting it in the same change that introduces this one would drop
81 passing JavaScript tests and leave nothing to compare against while this is
still unproven on hardware.

Retire it when this app has run on a device against a real API and the screens
listed above are ported. At that point, remove:

* the `mobile/` directory,
* `typecheck:mobile` from `verify` and `scripts/typecheck-mobile.mjs`,
* the `mobile/src/**` entries from `vitest.config.ts` and from `lint:strict`.

Until then, two apps describe the same product, and that is a cost being paid
knowingly rather than an oversight.
