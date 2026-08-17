# Screenshots — what these are, and what you must do before publishing

## What they are

Rendered by `npm run assets:store` from the app's own design tokens
(`mobile/src/theme/tokens.ts`) at the app's own spacing scale. The colours, the
type sizes, the layout, the tab bar and the wording are the real ones — the
generator reads the palette out of the TypeScript rather than keeping a copy,
so a token change regenerates them.

The data in them is invented. There is no employee called Asha and nobody is
paid ₹84,320.

## What they are not

**They are not captures from a device.** The app has never been run on one —
see `docs/ROADMAP.md`. These are renders of its design.

## Before you publish

Google Play's Store Listing policy requires that screenshots represent the
actual app experience. These do represent it, but the honest and safe order is:

1. Build the app (`eas build --profile preview --platform android`).
2. Install it on a real device and sign in against a real environment.
3. Capture the same six screens.
4. Replace the files in this folder.

Then delete this file, because it will no longer be true.

If you upload these as they are, you are asserting that the app looks like this.
It should — that is what the tokens say — but nobody has checked it on hardware,
and "should" is doing a lot of work in that sentence.

## The set

| File | Screen | Caption |
|---|---|---|
| `01-today.png` | Today — clock in/out | Clock in, even with no signal |
| `02-shifts.png` | Shifts | Know when you are next in |
| `03-leave.png` | Leave | Book leave in three taps |
| `04-payslips.png` | Payslips | Every payslip, whenever you need it |
| `05-attendance.png` | Attendance history | Your own attendance, month by month |
| `06-today-dark.png` | Today, dark mode | Follows your phone's dark mode |

Order matters: Play shows the first two in search results, so the offline
clock-in and the roster lead.
