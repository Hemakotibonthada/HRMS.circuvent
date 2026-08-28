# EAS configuration — the parts a JSON file cannot explain

`eas.json` has no comments, so the reasoning lives here.

## `appVersionSource: "local"`

The version and `versionCode` stay in `app.json`, in git, where a reviewer can
see them in the diff. The alternative — `remote` — keeps the counter in EAS's
database, which is fine until the day you need to know what `versionCode` a
given commit shipped as and the answer is not in the repository.

`autoIncrement` on the production profile bumps `versionCode` for you and
writes it back to `app.json`. **Commit that change.** A build whose
`versionCode` exists only on a CI runner is one nobody can reproduce.

Play rejects an upload whose `versionCode` is not strictly greater than the
last one on the track. That is the single most common first-submission
failure, and it is why this is automated rather than remembered.

## `EXPO_PUBLIC_API_BASE_URL` per profile

Set per profile, not in `app.json`, because `app.json` is one file shared by
every build and the whole point is that preview and production must not agree
about which database they are talking to.

`10.0.2.2` in the development profile is the Android emulator's route to the
host machine's `localhost`. `localhost` inside the emulator is the emulator.

**These URLs do not exist yet.** No Vercel project has been created and no DNS
has been pointed — see `docs/DEPLOYMENT.md` §7. A build made today will
install, launch, and fail at sign-in with a network error. That is the correct
behaviour: `resolveBaseUrl()` refuses to guess, because a build silently
pointed at the wrong API looks like it works right up until somebody's
clock-in goes to a staging database.

## `distribution: "internal"` on development and preview

Produces an APK that installs directly from a link, for the people testing it.
Production produces an `.aab`, which is the only format Play accepts, and
which cannot be installed on a device directly — do not try to test with it.

## `releaseStatus: "draft"` on submit

The first upload of a new package name **must** be promoted by hand in the Play
Console; the API cannot do it. `draft` also means an accidental `eas submit`
cannot release to users. Change it to `completed` only once the listing has
been through review at least once and you are certain.

## `serviceAccountKeyPath`

Points outside the repository on purpose. It is a Google Cloud service account
key with permission to publish to your Play listing; committing it hands
somebody the ability to ship an update to every installed device.

`secrets/` is not in `.gitignore` because the directory does not exist here and
should not — keep the key outside the working tree entirely, or use
`eas secret:create` and drop the path.
