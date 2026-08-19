# HRMS Upload — Circuvent HR on Google Play

Everything needed to publish the Android app, and the reasoning behind the
answers Play asks for. Written from a build that was made, signed, installed and
run — not from intent.

**Status: ready to upload.** Last verified 19 August 2026.

---

## 1. The files

All in `android\release-artifacts\`.

| File | Size | What it is |
| --- | --- | --- |
| `circuvent-hr-1.0.0.aab` | 5.1 MB | **Upload this one.** Play requires a bundle for new apps. |
| `circuvent-hr-1.0.0.apk` | 2.5 MB | Sideloading and manual testing only. Play will not accept it. |
| `play-icon-512.png` | 512×512 | Store listing icon, opaque. |
| `play-feature-graphic-1024x500.png` | 1024×500 | Listing header, opaque. |
| `play-screenshots\1-sign-in.png` … `4-profile.png` | 1080×1920 each | Phone screenshots, 9:16. |

The same images also live in `android\fastlane\metadata\android\en-US\images\`,
which is the layout `fastlane supply` and Gradle Play Publisher upload from, if
you later want this automated.

**Download size on a real device: 1.82 MB.** The bundle is 5.1 MB because it
carries every density and architecture; Play sends each phone only its own
slice.

---

## 2. Build identity

| Field | Value |
| --- | --- |
| Package name | `com.circuvent.hrms` |
| Version name | `1.0.0` |
| Version code | `1` |
| Minimum SDK | 26 (Android 8.0) |
| Target SDK | 36 (Android 16) |
| Signature schemes | v2 + v3 (v1 deliberately off) |
| Signing key | RSA 4096, valid ~27 years |
| Certificate | `CN=Circuvent Technologies, O=Circuvent Technologies, C=IN` |
| SHA-256 | `2a23faca4031835e830cda1fa433eab331dfa106ee636b199f2f93f410d5d61b` |
| SHA-1 | `c1384f1d19e4cae14df2e1b9f1473c929eb313ef` |

**The package name is permanent.** It cannot be changed after the first upload,
and it cannot be reused even if you delete the app. Be sure `com.circuvent.hrms`
is what you want before you press publish.

**Version code must increase on every upload.** The next build is `2`, then `3`.
Play rejects a repeat, and it is the single most common failed upload.

### Why target 36

Play requires **new apps submitted from 31 August 2026 to target Android 16
(API 36)**. A bundle built against 35 is rejected after that date, and the
rejection lands at the end of a review rather than at build time. This was
raised from 35 and then verified on an Android 16 emulator, because the changes
that bite at targetSdk 36 — enforced edge-to-edge, predictive back on by
default — are exactly the ones a successful compile cannot tell you about.

---

## 3. Signing, and the one thing you must not lose

The bundle is signed with an **upload key**. Under Play App Signing, which is
mandatory for new apps, Google holds the real app signing key and re-signs every
APK it serves. Your upload key only proves a bundle came from you.

| Item | Location |
| --- | --- |
| Keystore | `android\circuvent-upload.jks` |
| Password, alias | `android\keystore.properties` |
| Alias | `circuvent-upload` |

Both files are gitignored and are **not** in the repository. A signing key in
git is publishing rights for everyone who has ever cloned it.

**Back both up somewhere that is not this machine.** Losing the upload key is
recoverable — Play support can reset it — but only if you still control the
account, and the reset takes days you will not want to spend.

For CI, set `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` instead; the build reads either.

If no credentials are present the release build comes out **unsigned** rather
than falling back to the debug key. That is deliberate — a debug-signed release
installs and runs perfectly on your desk, which is precisely why that mistake
otherwise survives every local test.

---

## 4. Store listing

Fill these in under **Main store listing**. Written to be accurate about what
the app currently does; edit freely, but do not add features it does not have —
a listing that overpromises is a removal risk, not just a disappointed user.

**App name** (30 char max)

```
Circuvent HR
```

**Short description** (80 char max)

```
Clock in, book leave and read your payslips from your phone.
```

**Full description** (4000 char max)

```
Circuvent HR puts your working day in your pocket.

Clock in and out from wherever you work, book leave and watch it get approved,
and read your payslips the moment payroll signs them off — without asking
anyone or waiting for an email.

WHAT YOU CAN DO

• Clock in and out, and see today's hours as they add up
• Apply for leave and track every request through to approval
• See your leave balance for each type before you ask
• Read and keep your payslips once a payroll run is approved
• Check your shifts and rota
• Look up your attendance history month by month
• See the equipment issued to you and the benefits you are covered by
• Follow up on your one-to-one check-ins and agreed actions
• Take the learning assigned to you
• Refer someone for a role and follow how they get on

SIGNING IN

Use your work email and password, a passkey, or your company's single sign-on.
Passkeys use your phone's own fingerprint or face unlock — your biometrics stay
on the device and are never sent to us.

LOCATION

If your employer records where you clock in, the app asks for your location at
the moment you press the button, and only then. It never tracks you in the
background: the permission that would allow that is removed from the app at
build time, so it is not a promise we ask you to take on trust.

YOU NEED AN ACCOUNT FROM YOUR EMPLOYER

Circuvent HR works with the Circuvent HRMS your company runs. You cannot sign up
inside the app — your HR team creates your account.
```

**App category:** Business
**Tags:** Human resources, Productivity
**Contact email:** *(your support address — required and shown publicly)*
**Website:** `https://hrms.circuvent.com`
**Privacy policy:** `https://hrms.circuvent.com/privacy`

> `/privacy` and `/terms` are both listed as public routes in the app's
> middleware, so they do not sit behind a login — that part is already right.
> What remains is that the production site is actually deployed and serving
> them. Play fetches the URL during review, and a policy that 404s is the most
> common reason a first submission fails.

---

## 5. Data safety

Play asks you to declare this, then checks your answers against the merged
manifest and observed traffic. These answers were taken from what the app
actually does.

**The app contains no analytics, crash-reporting, advertising or attribution
SDKs.** The only Google libraries are Play Services Location, used when you
clock in, and Credential Manager, used for passkeys. Nothing is shared with
third parties.

| Question | Answer |
| --- | --- |
| Does your app collect or share user data? | Yes, collects. **Does not share.** |
| Is data encrypted in transit? | **Yes** — the release build forbids cleartext traffic outright |
| Can users request data deletion? | Via their employer's HR administrator |

Data types to declare:

| Type | Collected | Purpose | Optional? |
| --- | --- | --- | --- |
| Name | Yes | App functionality — shown on your profile | Required |
| Email address | Yes | App functionality, account management — sign-in | Required |
| Approximate location | Yes | App functionality — attendance | Optional |
| Precise location | Yes | App functionality — attendance | Optional |
| Salary / payslips | Yes | App functionality — payslips | Required |
| Employment info (attendance, leave, shifts) | Yes | App functionality | Required |

Location is **optional** because the app installs and runs on a device with no
GPS, and remote staff clock in without it.

**Do not declare biometrics.** Passkeys and biometric unlock go through Android's
own `BiometricPrompt` and Credential Manager. The app never receives a
fingerprint or face template — only a yes-or-no from the operating system.
Declaring biometric collection would be inaccurate and invites questions you
would then have to answer.

### Permissions, and what to say if asked

Taken from the merged manifest of the built artifact — not the source, which is
not the same thing once dependencies have merged theirs in.

| Permission | Why |
| --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Talking to your HRMS |
| `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` | Recording where a clock-in happened, at the moment of the tap |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | Unlocking the app and passkeys. `USE_FINGERPRINT` is merged in by AndroidX Biometric for older devices |
| `com.circuvent.hrms.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Added automatically by AndroidX Core; self-scoped, grants nothing external |

`ACCESS_BACKGROUND_LOCATION` is **absent**, and absent on purpose. It is stripped
with `tools:node="remove"` so that no dependency can reintroduce it through
manifest merging. An HR app that can follow staff home is a surveillance tool,
and the only credible promise that this one cannot is one the build enforces.
That also means you will not face Play's background-location review, which is a
questionnaire, a video, and weeks of delay.

---

## 6. Content rating

Answer the questionnaire honestly; for this app every answer is no.

- No violence, sexual content, profanity, gambling, or drug references
- No user-generated content shared publicly
- Does the app share the user's location with other users? **No** — an
  employee's clock-in location goes to their employer's HR records, not to other
  app users
- Expected result: **Everyone / PEGI 3**

---

## 7. Uploading, step by step

1. **Play Console → Create app.** Name `Circuvent HR`, English (United Kingdom
   or United States), App, Free.
2. **Set up your app** — work through the checklist Play shows. Privacy policy,
   ads (none), content rating, target audience (18+, this is a workplace tool),
   data safety, government apps (no).
3. **Release → Testing → Internal testing** first. Not production. Internal
   testing has no review wait, so you find installation problems in minutes
   rather than days.
4. **Create new release.** Upload `circuvent-hr-1.0.0.aab`.
5. Accept **Play App Signing** when offered. This is the point of no return for
   the key; from here Google holds the app signing key.
6. Release notes — for a first release:
   ```
   The first release of Circuvent HR. Clock in and out, book leave, check your
   balance, and read your payslips from your phone.
   ```
7. Add yourself as an internal tester, install from the link, **sign in and
   clock in once**. See section 9 before you do.
8. When it behaves, promote the same release to **Production**.

First reviews commonly take a few days. Later updates are usually faster.

---

## 8. Rebuilding

```
cd android
.\gradlew.bat :app:bundleRelease :app:assembleRelease
```

Store images, if the mark ever changes:

```
npm run android:assets
```

Before any store build, **check the API host**. It is compiled in rather than
read at runtime, so a shipped build cannot be repointed by anything on the
device — but that also means a wrong one is baked in:

- `android\local.properties` must not set `apiBaseUrl`
- the `API_BASE_URL` environment variable must be unset

Both must be clear, or the release points at whatever they say. The current
build points at `https://hrms.circuvent.com`. A release aimed at a laptop is not
obviously broken; it simply fails for everyone who installs it.

Verify before uploading:

```
apksigner verify --print-certs app\build\outputs\apk\release\app-release.apk
aapt2 dump badging app\build\outputs\apk\release\app-release.apk
```

Read the badging output rather than skimming it. It is the merged manifest — the
one a reviewer sees — and it is where you discover that a dependency has quietly
added a permission your data-safety form does not mention.

---

## 9. Before you publish

Two things are outside what could be checked from here.

**The production API must be live at `https://hrms.circuvent.com` with a valid
certificate.** The release build refuses cleartext, so a self-signed or expired
certificate means nobody can sign in — and the app cannot tell the user why in
any useful way. Install the APK on a real phone on mobile data, not office
Wi-Fi, and sign in once.

**The production database must be reachable as `hrms_app`, not `neondb_owner`.**
The tenant guard refuses to serve when the connection has `BYPASSRLS`, which is
correct and will present as every screen being empty.

Also worth knowing:

- **The passkey ceremony has not been proven end to end on a device with Google
  Play Services.** It compiles and is wired correctly, and it is one button on
  the sign-in screen. Test it in internal testing before you rely on it;
  password and SSO sign-in are unaffected either way.
- **There is no iOS app yet.** The Swift shell exists; passkeys and SSO are not
  implemented there, and it needs a Mac to build.
- **A demo tenant is still live** — `hr@northwind-demo.test`, organisation
  "Northwind Demo HR". It was created to take the screenshots. Remove it when
  you no longer want it.

---

## 10. If the upload is rejected

The likely causes, in the order they actually happen:

| Message | Cause |
| --- | --- |
| "Version code 1 has already been used" | Bump `versionCode` in `android\app\build.gradle.kts` |
| "Your app targets API level 35" | Built before the target bump — rebuild from this commit |
| "Upload a valid privacy policy URL" | The page is behind a login, or the URL 404s |
| "You uploaded an APK" | Upload the `.aab` |
| "Your data safety form is incomplete" | A declared permission has no matching data type |
| Signature mismatch on a later upload | Built without `keystore.properties` present, so it went out unsigned or debug-signed |
