# Releasing the Android app

Everything Play needs, and where it comes from.

## What is built

| Artifact | Path | Purpose |
| --- | --- | --- |
| App bundle | `app/build/outputs/bundle/release/app-release.aab` | The upload. Play requires a bundle for new apps. |
| APK | `app/build/outputs/apk/release/app-release.apk` | Sideloading and manual testing. Not accepted by Play. |
| Store images | `fastlane/metadata/android/en-US/images/` | Listing icon, feature graphic, screenshots. |

A copy of each is placed in `release-artifacts/` under a versioned name for
convenience. That directory is ignored by git — binaries do not belong in the
repository, and an `.aab` committed once stays in the history forever.

## Signing

The release build is signed with an **upload key**. Under Play App Signing —
mandatory for new apps — Google holds the actual app signing key and re-signs
every APK it serves. The upload key only proves that a bundle came from you.

Credentials are read, in order, from:

1. `keystore.properties` in this directory, or
2. the environment: `ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Both the keystore and the properties file are gitignored. If neither is
present, the release build is left **unsigned** rather than falling back to the
debug key. That is deliberate: a debug-signed release installs and runs
perfectly on a developer's machine, so the mistake is invisible until Play
rejects the upload.

### Back the key up

Losing the upload key is recoverable — Play support can reset it — but losing
it *and* not noticing is how an app becomes unupdatable. Keep `*.jks` and its
password somewhere that is not this machine.

To create one:

```
keytool -genkeypair -v -keystore circuvent-upload.jks \
  -alias circuvent-upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=<your company>, O=<your company>, C=IN"
```

Play requires the certificate to stay valid past 22 October 2033; 10000 days is
about 27 years.

## Building

```
cd android
./gradlew :app:bundleRelease :app:assembleRelease
```

The API host is compiled in, not read at runtime, so a shipped build cannot be
repointed at another database by anything on the device. It defaults to
`https://hrms.circuvent.com` and is overridden by `apiBaseUrl` in
`local.properties` or the `API_BASE_URL` environment variable — **check both are
unset before a store build.** A release aimed at a laptop is not obviously
broken; it just fails for everyone who installs it.

## Store images

```
npm run android:assets
```

Regenerates the launcher icons, the 512px listing icon and the feature graphic
from `app/src/main/res/drawable/ic_launcher_foreground.xml`. That drawable is
the single source: nothing is exported by hand, so the icon on the home screen
and the icon in the listing cannot drift apart.

Note that Android reads an eight-digit colour as `#AARRGGBB` — alpha first —
while CSS reads the same digits as `#RRGGBBAA`. Writing a window shade as
`#00000047` makes it fully transparent, which is how the mark once shipped
looking like a bar chart. The generator warns when a path is invisible.

## Screenshots

Play requires at least two phone screenshots. Capture them from a real build:

```
adb shell wm size 1080x1920      # 9:16, which Play always accepts
adb exec-out screencap -p > shot.png
adb shell wm size reset
```

Put them in `fastlane/metadata/android/en-US/images/phoneScreenshots/`,
named so they sort in the order they should appear.

## Verifying before upload

```
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
aapt2 dump badging app/build/outputs/apk/release/app-release.apk
java -jar bundletool.jar build-apks --bundle=...aab --output=out.apks --mode=universal
```

The badging output is worth reading rather than skimming. It is the merged
manifest — the one a Play reviewer sees — and it is where you find out that a
dependency quietly added a permission you have not declared in the data-safety
form. `ACCESS_BACKGROUND_LOCATION` is removed by `tools:node="remove"` in the
manifest for exactly this reason, and the badging output is the proof it worked.
