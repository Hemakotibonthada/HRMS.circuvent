# Why this tsconfig does not extend `expo/tsconfig.base`

Expo scaffolds `"extends": "expo/tsconfig.base"`, which resolves inside
`node_modules`. That is fine for a standalone app and wrong here.

`mobile/src/theme` is plain TypeScript with no React Native import, and it is
included in the repository-root Vitest run so that `npm run verify` fails when
the palette drops below WCAG AA. Extending a config that lives in
`node_modules` breaks that: on a clean checkout, before anyone has run
`npm install` inside `mobile/`, the root test run fails with

    [TSCONFIG_ERROR] Failed to load tsconfig ... Tsconfig not found

and CI would need a full React Native install to check a contrast ratio.

So the options in `tsconfig.json` are Expo's own defaults written out, with two
changes: `strict` is on, and `noUncheckedIndexedAccess` is on.

If you upgrade Expo, diff `node_modules/expo/tsconfig.base.json` against the
compiler options here and bring across anything new.

## The `@shared/*` alias

`@shared/*` maps to `../src/lib/*` — the platform-neutral core (`api-client`,
`offline-queue`, `geofence`) that the server and the phone both use. It is
shared rather than copied on purpose: there were briefly two geofence
implementations with different Earth radii, and they disagreed about whether an
employee standing at the edge of an office was at work.

TypeScript resolves the alias through `paths` here. Metro resolves it through
`watchFolders` and `extraNodeModules` in `metro.config.js`. **Both are
required.** With only the first, typechecks pass and the app crashes at runtime
with "Unable to resolve module". With only the second, the reverse.
