# Circuvent HR — iOS

The other half of one application. Every product rule lives in the shared Kotlin
module; this target owns how it looks and behaves on an iPhone.

## Build

Requires **macOS**. There is no way around this and it is not a project choice:
Kotlin/Native cannot cross-compile Apple targets, and `shared/build.gradle.kts`
gates the iOS targets behind a host check for that reason. Xcode does not exist
for Windows or Linux.

```sh
brew install xcodegen
cd android/iosApp
xcodegen generate
open HRMS.xcodeproj
```

Gradle builds the shared framework as a pre-action, so a clean checkout works on
the first build. The `.xcodeproj` is generated and deliberately not committed —
`project.yml` is the source of truth.

Point a debug build at a local server with `HRMS_BASE_URL`; release builds are
pinned to production in `project.yml` so a debug URL cannot ship by accident.

## What is here

| Screen | State |
|---|---|
| Sign in | Working |
| Home (punch card, today) | Working |
| Leave — balances, list, apply | Working |
| **Inbox — leave, working-away and corrections in one queue** | **Written, not yet run** |
| **Team — who is away, whose birthday it is** | **Written, not yet run** |
| Me — profile, payslips, expenses, holidays, directory, documents, helpdesk | Working; reorganised |
| Payslips, Expenses, Holidays, Directory, Documents, Helpdesk | Working |

Android additionally has: attendance history, work-arrangement and correction
*requests* (iOS can approve them, not raise them), the company wall,
announcements, goals, tax declaration, Form 16, loans, benefits, learning,
assets, shift swaps, settings, my details and the identity card. Those are not
on iOS yet.

## What has not been verified

The rows in bold, the tab restructure and the `Me` reorganisation were written
on a Windows machine. **They have never been compiled.** Swift is not type-checked
anywhere in this repository's CI, so nothing has told them they are wrong.

Expect to fix compile errors on the first Mac build — most likely around how
Kotlin types bridge into Swift, since that is the part a person cannot check by
reading. In particular:

- `outcome(_:)` casts through `HrmsApiResult`; a new shared model may need its
  Swift type spelled out.
- Kotlin `List<T>` arrives as `NSArray`-backed and sometimes needs an explicit
  cast at the call site.
- `KotlinUnit` is the return type for shared functions declared `Result<Unit>`.

They are committed rather than held back because the shared API they call is
tested and the logic they rely on is shared — but treat the first build as part
of the work, not as a regression.

## The shared module is where the rules live

`LeaveCost` (what a leave range actually costs, and whether it spends days
nobody works), `LeaveRules` and `AttendanceRules` are in `shared/commonMain`
with tests that run on the JVM — so they are verified here even though this
target is not. Anything iOS needs to *decide* belongs there, not in Swift: a
rule implemented twice is a rule that will eventually disagree with itself about
somebody's entitlement.
