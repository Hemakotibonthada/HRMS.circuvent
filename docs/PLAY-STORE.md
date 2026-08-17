# Play Store release — Circuvent HR

Everything in this repository that can be prepared without a Google account is
prepared. This document is the part that needs a person, in the order it has to
happen.

Read [`§0 Before anything`](#0-before-anything) first. There is a blocker.

---

## 0. Before anything

**The app has never been run on a device, and there is no backend to run it
against.** No Neon project exists, no Vercel project exists, and no DNS has been
pointed — `docs/DEPLOYMENT.md` §7 is explicit about this.

A build made today will install, launch, show the sign-in screen and then fail
with a network error, because `https://hrms.circuvent.com` does not resolve to
this application. That is deliberate: `resolveBaseUrl()` refuses to guess a
host, because a build silently pointed at the wrong API looks like it works
right up until somebody's clock-in reaches a staging database.

So the order is:

1. Stand up the backend — `docs/DEPLOYMENT.md` §§1–4.
2. Build a `preview` APK and run it on a real phone against that backend.
3. Fix whatever that finds. It will find something; nothing here has executed
   on ARM, on a real network, or against a real Postgres.
4. Then come back to this document.

Steps 1–3 are not optional and are not paperwork. Publishing an app whose only
evidence of working is that it compiles is how a one-star review that says
"won't open" becomes the first thing anyone reads.

---

## 1. What is already done

| | Where |
|---|---|
| Build profiles for development, preview and production | `mobile/eas.json`, explained in `mobile/EAS.md` |
| Release `app.json` — version, `versionCode`, adaptive icon, splash, notification icon, runtime version | `mobile/app.json` |
| App icon, adaptive icon, notification icon, light and dark splash | `mobile/assets/` |
| Listing icon, feature graphic, six phone screenshots | `mobile/store/play/` |
| Store listing copy, within Play's character limits | `mobile/store/play/listing.md` |
| Data safety answers, each traced to the code that justifies it | `mobile/store/play/data-safety.md` |
| Release notes for 1.0.0 | `mobile/store/play/release-notes/1.0.0.txt` |
| A privacy policy that describes the app | `/privacy` on the web app |
| A store link on the web that stays hidden until the listing exists | `src/lib/mobile-app.ts` |

Regenerate every image with `npm run assets:store`. They are produced from the
palette in `mobile/src/theme/tokens.ts`, so a brand change is one command and
not a design-tool round trip.

---

## 2. Accounts and one-time setup

1. **Google Play developer account** — US$25, once, and identity verification
   that can take a few days. Start this first; it is the longest pole.
2. **Expo account**, then in `mobile/`:
   ```bash
   npx eas login
   npx eas init          # writes extra.eas.projectId into app.json — commit it
   ```
3. **Android keystore.** Let EAS generate and hold it:
   ```bash
   npx eas credentials
   ```
   > **The keystore is the app's identity for ever.** Lose it and you cannot
   > update this listing — you have to publish a new app under a new package
   > name and ask every user to reinstall. Either let EAS keep it, or back the
   > `.jks` and its passwords up somewhere you would still have after a laptop
   > is stolen.

4. **Package name.** `com.circuvent.hrms`, fixed at first upload and
   unchangeable afterwards. Check it in `mobile/app.json` now, not later.

---

## 3. Build

```bash
cd mobile

# Internal testing: an APK that installs straight from a link.
npx eas build --profile preview --platform android

# Play: an .aab, which is the only format the Console accepts.
npx eas build --profile production --platform android
```

`production` has `autoIncrement`, so `versionCode` is bumped and written back to
`app.json`. **Commit that change** — a build whose `versionCode` exists only on
a CI runner is one nobody can reproduce.

Do not try to install the `.aab` on a phone. It is not an installable artefact.

---

## 4. Create the listing

Play Console → **Create app**.

| Field | Value |
|---|---|
| App name | Circuvent HR |
| Default language | English (United Kingdom) |
| App or game | App |
| Free or paid | Free |

Then work through the left-hand checklist. The two that fail people:

**App content → Data safety.** Answer it from
`mobile/store/play/data-safety.md`, which explains why each answer is what it
is. The trap: do not tick "processed ephemerally" for location. The coordinates
are stored on the attendance record, and a mismatch between this form and the
app's behaviour is the usual cause of a suspension that arrives months later.

**App content → App access.** This app cannot be used without an employer
creating the account, so Play cannot review it by signing up. Provide working
demo credentials under "All or some functionality is restricted", with a note:

> This is an employee app for organisations running Circuvent HRMS. Accounts
> are created by the employer; there is no self-registration. Demo credentials
> are provided for review.

Reviewers reject apps they cannot get into. Test the credentials the day you
submit them, and keep that account alive.

**App content → Advertising ID.** Declare that the app does not use one. It
does not: there is no analytics or advertising SDK in `mobile/package.json`.

**Content rating.** Complete the questionnaire honestly — a business utility
with no user-generated content shown to other users, no ads and no purchases.
Expect "Everyone" / PEGI 3.

**Government apps / Financial features.** Answer no. Payslips are displayed, but
the app does not provide banking, lending or payment functionality.

---

## 5. Upload and roll out

```bash
cd mobile
npx eas submit --profile production --platform android
```

`eas.json` submits to the **internal** track with `releaseStatus: "draft"`, so
nothing reaches a user by accident.

**The first release of a new package must be promoted by hand in the Console.**
The API cannot do it. This surprises everybody once.

The order that avoids a public mistake:

1. **Internal testing** — up to 100 testers, available in minutes. Put the
   payroll and HR teams on it and let them use it for a full pay cycle. Payroll
   is monthly; a bug in a payslip screen is a bug you find once a month.
2. **Closed testing** — a real department. Play now requires a period of closed
   testing before production access for new personal developer accounts;
   organisation accounts differ. Check the current rule in the Console rather
   than trusting this paragraph.
3. **Production, staged.** Start at 10%. Halt the rollout if crash-free
   sessions drop; a halted staged rollout is undoable, a full rollout is not.

Review takes anywhere from a few hours to a week. An app requesting fine
location gets looked at harder — which is why the listing text says plainly that
background location is blocked in the manifest.

---

## 6. Turn on the link in the web app

Only once the listing is on a **public** track. An internal-testing link works
for the testers on it and 404s for everyone else.

```bash
# Vercel → hrms project → Settings → Environment Variables (Production)
NEXT_PUBLIC_PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.circuvent.hrms
```

Then redeploy. The button appears in the landing-page footer and on
**My Profile** in the dashboard. Until the variable is set, `GetTheApp` renders
`null` — there is no "coming soon" state, because a promise with no date is a
thing to be held to.

If you want Google's official *Get it on Google Play* badge instead of the
plain button, download it from Google's Play brand resource centre and put it in
`public/`. It must be used unmodified and at the stated minimum size. It is not
recreated in this repository, and it should not be: it is Google's artwork.

---

## 7. What is deliberately not done

- **iOS.** `app.json` carries the bundle identifier and usage strings, but
  there is no Apple developer account, no provisioning and no App Store listing.
  `NEXT_PUBLIC_APP_STORE_URL` exists and is unset.
- **Push notifications.** `expo-notifications` is a dependency and the
  notification icon is generated, but nothing registers a token and there is no
  server route to store one. The listing does not claim push.
- **Screenshots from a device.** The six supplied are rendered from the app's
  own design tokens, not captured from hardware. See
  `mobile/store/play/screenshots/README.md` — replace them after step 0.
- **A tablet layout.** No tablet screenshots are supplied, because shipping a
  stretched phone layout as a tablet screenshot is a claim the build does not
  support.
- **`eas.json` service account key.** Path only. The key is a credential that
  can ship an update to every installed device; it does not belong in a
  repository.
