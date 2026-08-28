# Translating the mobile app

The app is English only today. This is what has to happen for that to change,
and one thing that must not.

## The rule about statutory terms

**Do not machine-translate this app.**

Most software can be run through a translation service and comes out
acceptable. This one cannot, because a large part of what it says is legal
rather than descriptive:

| Term | Why a wrong word is harmful |
|---|---|
| Gratuity | A specific payment under the Payment of Gratuity Act, 1972. Not a tip, not a bonus. |
| Professional tax | A state levy under section 16(iii). Not income tax, and not a professional fee. |
| Perquisite | A taxable benefit in kind under section 17(2). Not a perk in the casual sense. |
| Chapter VI-A | The deductions chapter of the Income-tax Act. A chapter number, not a description. |
| Compensatory off | Leave earned by working a holiday. Not compensation, and not ordinary leave. |
| Leave encashment | Payment for unused leave, with its own exemption ceiling. |
| Notice recovery | Money deducted for notice not served. Not a fine. |
| Full and final settlement | A defined process on exit with statutory components. |

A translation service will produce a fluent, confident, plausible word for each
of these. When it is wrong, the result is an employee being told their legal
entitlement incorrectly — and neither they nor anyone reviewing the file will
be able to tell, because the wrong word reads perfectly well.

So every language must come from **a person who speaks it and understands
Indian payroll**. Where no settled term exists in the target language, keep the
English one rather than inventing something. Employees encounter these words on
their payslips in English; matching that is more useful than a novel
translation.

## Adding a language

Two steps, and only two.

1. Create `android/app/src/main/res/values-<tag>/strings.xml`, translated from
   `values/strings.xml`. Use a BCP 47 tag: `te` Telugu, `hi` Hindi, `ta` Tamil,
   `bn` Bengali.

2. Add a line to `android/app/src/main/res/xml/locales_config.xml`:

   ```xml
   <locale android:name="te" />
   ```

That is all. The picker in Settings reads `locales_config.xml` at runtime, so
the language appears there by itself — and cannot appear before its file
exists. That is deliberate: a language that silently falls back to English
leaves the reader unable to tell whether the app is broken or simply
untranslated.

The picker also hides itself entirely while English is the only option, because
a control with one choice does nothing.

## What is not extracted yet

Most of the app's text is still written inline in Kotlin. To see how much:

```
node scripts/find-hardcoded-strings.mjs
```

At the time of writing that reports **246 strings across 23 files**. They have
to move into `values/strings.xml` before they can be translated at all.

The report only counts arguments to parameters that are definitely read by a
person — `label`, `title`, `description`, `contentDescription`, and the first
argument to `AppText`. It undercounts, and it never rewrites anything.
Extracting automatically is how a log line or a route name ends up being
translated.

## Checking a translation without shipping it

Debug builds carry `en-XA`, Android's pseudolocale: English with accents,
padded to roughly the length a real translation runs to. It is a test
instrument, not a language, and it exists only in the debug source set.

Select it from Settings → Language. Two things become visible at once:

- Every string that has been extracted turns into `[Åççéñtéd téxt one two]`.
- Every string still hardcoded stays in plain English — which is a live map of
  what is left to do.

The padding is the other half of the point. Translations of English run
noticeably longer, and a layout that only fits because English is short will
break here rather than in front of the person who needed the translation.

## Right-to-left

`android:supportsRtl="true"` is already set, and the layouts use start/end
padding rather than left/right, so an RTL language should lay out correctly.
Nothing has been tested in RTL, because nothing has been translated into one —
treat it as unproven rather than working.
