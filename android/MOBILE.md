# Circuvent HRMS — mobile

One application, two native front ends, sharing one implementation of the
product.

```
android/
  shared/      Kotlin Multiplatform — the product's logic, compiled twice
  app/         Android app, Jetpack Compose
  iosApp/      iOS app, SwiftUI
```

## Why it is arranged this way

The brief was a single mobile application for both platforms, in their native
languages. Those two things pull in opposite directions unless the split is
made in the right place.

Everything that decides **what the product does** lives in `shared/` and is
compiled twice — to a JVM class file Android loads, and to a native framework
iOS links. Whether a leave request overlaps one already booked, how many
working days it costs, whether a punch is inside the geofence, what the API
returns and how a 401 is handled: one implementation, and neither app can
disagree with the other about any of it.

Everything that decides **how it looks and feels** is written per platform.
Android draws its screens in Jetpack Compose, iOS in SwiftUI. A shared UI layer
is what makes cross-platform apps feel wrong on both: the back gesture, the
navigation bar, the date picker, Dynamic Type and the accessibility model all
differ, and imitating one on the other is the thing users notice immediately
and cannot name.

The alternative — two apps written independently — is how the same product ends
up with two different answers to "can I book this week off", one of them wrong,
discovered by an employee rather than a test.

## What is verified, and where

| | Runs on |
|---|---|
| `shared` logic — 38 tests | Any machine. `./gradlew :shared:jvmTest` |
| Android app — debug and release APK | Any machine. `./gradlew :app:assembleDebug` |
| iOS app | **A Mac only.** Kotlin/Native cannot emit an Apple framework anywhere else, and Xcode does not exist off macOS. |

The Apple targets in `shared/build.gradle.kts` are declared inside a host
check, so this whole project configures and the Android app builds on Windows
and Linux. On a Mac they appear and the framework is produced.

That limit is real and worth stating plainly rather than discovering: the
Swift in `iosApp/` and the Kotlin it calls are written and reviewed, and the
iOS binary has not been compiled, because it cannot be on the machine this was
written on.

## Building

**Android**

```bash
cd android
./gradlew :shared:jvmTest        # the shared logic
./gradlew :app:assembleDebug     # app/build/outputs/apk/debug/
```

**iOS** — on a Mac

```bash
brew install xcodegen
cd android/iosApp
xcodegen generate
open HRMS.xcodeproj
```

The project's pre-build phase runs `:shared:embedAndSignAppleFrameworkForXcode`,
so the Kotlin framework is produced before Swift compiles. Building from a
clean checkout without it fails on `import Shared`, which reads as a broken
project rather than a missing step.

## Where the session token lives

`TokenStore` is `expect`/`actual` — the one place the platforms genuinely
differ and should. An access token is a bearer credential for somebody's salary
record, so it goes in the Android Keystore on one side and the iOS Keychain on
the other. Neither has an equivalent the other can use, and a shared
file-backed store would be worse than both.

On iOS it is stored `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: not
readable until the phone has been unlocked once since boot, and excluded from a
backup that could be restored onto a different handset.
