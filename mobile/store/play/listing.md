# Play Console listing — Circuvent HR

Copy these into **Play Console → Grow → Store presence → Main store listing**.
Character counts are the Play limits; the values below are within them.

---

## App name (max 30)

```
Circuvent HR
```
`12/30`

Not "Circuvent HRMS". "HRMS" is jargon to the person installing it, and the
audience here is an employee who has been told by their employer to download
the app, not somebody shopping for HR software.

## Short description (max 80)

```
Clock in, book leave and read your payslip — even where there is no signal.
```
`74/80`

The offline claim is first because it is the only thing here a competitor
cannot copy in an afternoon, and it is the one that matters to the site staff
and field engineers this is aimed at.

## Full description (max 4000)

```
Circuvent HR is the employee app for organisations running Circuvent HRMS.
It is for the working day, not for HR administration: clock in, book leave,
check a shift, read a payslip, raise a ticket.

You need an account created by your employer. This app cannot be used on its
own, and there is nothing to sign up for here.

WORKS WITHOUT A CONNECTION
Clock in and out from a basement car park, a lift, or a site with no coverage.
Your punch is written to your phone first and sent when the signal comes back,
so it is never lost between the tap and the response. The app tells you plainly
whether something has been sent, is waiting, or was refused — it never claims
an action succeeded when it did not.

ATTENDANCE
• Clock in and out, with your work location checked on the device before the
  request is even sent, so you are told immediately if you are in the wrong place
• Your own attendance history, month by month, with hours worked and overtime
• Late arrivals and corrections shown as they were recorded

LEAVE
• See your balance for every leave type before you apply
• Apply in a few taps, with the dates checked before anything is submitted
• Track where a request has reached, and read the reason if it was declined
• Managers can approve or decline from the approvals inbox

SHIFTS
• Your published roster for the next four weeks
• The shift you are on now, or the next one to start, at the top of the screen
• Overnight shifts marked clearly, so you know which day you finish

PAY
• Every released payslip, with gross, deductions and net
• Working days, days present and any loss of pay
• Figures come straight from the payroll run — this app performs no arithmetic
  of its own on your pay

HELPDESK
• Raise a ticket with HR or IT and follow it
• See which tickets are waiting on you and which are with the helpdesk
• Reply in the thread

BUILT FOR THE PHONE IT RUNS ON
• Follows your phone's light and dark setting
• Respects your text size, right up to the largest accessibility setting
• Screen-reader labelled throughout, with touch targets that meet the platform
  minimums
• Optional biometric unlock for when you put the phone down

ABOUT YOUR LOCATION
Your location is read only at the moment you tap clock in or clock out. The app
cannot track you in the background — that permission is blocked in the app
itself, not merely unused, so the operating system will not grant it even if a
future version asked. Your employer sees the location of a punch, because that
is what a geofenced clock-in is; it does not see where you are at any other
time.

PRIVACY
Your employer is the controller of your employment data. Circuvent processes it
on their behalf. The full policy is at https://hrms.circuvent.com/privacy
```
`~2,450/4000`

## Release notes (max 500) — 1.0.0

See `release-notes/1.0.0.txt`.

## Categorisation

| Field | Value |
|---|---|
| App or game | App |
| Category | Business |
| Tags | Human resources, Productivity |
| Contact email | support@circuvent.com |
| Contact website | https://hrms.circuvent.com |
| Contact phone | optional — leave blank rather than give one nobody answers |
| Privacy policy | https://hrms.circuvent.com/privacy |

## Graphics

| Asset | File | Size |
|---|---|---|
| App icon | `icon-512.png` | 512 × 512 |
| Feature graphic | `feature-graphic.png` | 1024 × 500 |
| Phone screenshots | `screenshots/phone/*.png` | 1080 × 1920 |

Play requires between 2 and 8 phone screenshots. Six are supplied. There are no
tablet screenshots: the app declares `supportsTablet` on iOS only, and shipping
a stretched phone layout as a tablet screenshot would be a claim the build does
not support.

All of these are produced by `npm run assets:store` from the palette in
`mobile/src/theme/tokens.ts`. Do not edit them by hand — a change would be
overwritten by the next run and would put the store out of step with the app.

**Read `screenshots/README.md` before you upload them.**
