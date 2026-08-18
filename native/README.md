# Native shell

The PWA in `/client` is the application. This wraps it, and it cannot fork the
codebase because there is nothing here to fork: `scripts/stage-shell.mjs` copies
the same files a browser is served into `www/`, which is generated and not
committed. Every platform call in the client goes through `/client/platform`
behind a dynamic import, so the browser build never loads — or even fetches —
a line of Capacitor code. CI fails if a static `@capacitor` import appears in
`/client`, or if Capacitor reaches the client's `package.json`.

## Before reaching for this

**iOS and Android already work without it.** The client is an installable PWA:
manifest, maskable icon, safe-area insets, and a service worker that caches the
shell so it launches with the radio off. Install it from the browser's share
sheet and it runs full-screen from the home screen.

Two things — and only these two — would force a real package:

1. **iOS haptics.** Safari has no vibration API, and haptic confirmation matters
   when auditors scan without looking at the screen. `platform/haptics.ts`
   already has the branch; on the web it falls back to a beep.
2. **MDM deployment.** If the organisation pushes apps through Intune or Jamf,
   it may require a real package rather than a bookmarked PWA.

Both are five-minute questions for an endpoint team, and neither is answered.
Until one is, the shell is scaffolding that builds — not something anyone needs.

## Dependencies

Five, all dev, all pinned, in this directory's own `package.json` so the
client's count is unaffected:

```
@capacitor/core  @capacitor/cli  @capacitor/ios  @capacitor/android  @capacitor/haptics
```

## What is committed

`ios/` and `android/` are Capacitor's generated projects, minus the copied web
assets (their own `.gitignore` excludes those). Almost all of it is Gradle and
Xcode boilerplate. The parts worth reading are short:

| File | What to check |
|---|---|
| `capacitor.config.json` | app id, app name, `webDir` |
| `android/app/src/main/AndroidManifest.xml` | permissions |
| `ios/App/App/Info.plist` | `NSCameraUsageDescription` |

**The permissions are the argument.** The app asks for the camera, to read
barcodes, and network access. Nothing else — no location, no storage, no
contacts, no background execution. CI asserts that list and fails if it grows.
The camera is declared `required="false"` on Android so a device without a
usable one can still install and run: the walk is finishable by typing tags,
which is the point of Algorithm 1, and refusing to install would be worse than
degrading.

`appId` is `au.edu.example.assetwalk`. It is deliberately not a real
organisation's identifier — naming and trademark on a university-adjacent app
in a public repository is an open question (§19), and claiming one here would
answer it by accident.

## Building

Neither platform can be built here; both need their own SDK.

```sh
npm ci && npm run build     # at the repository root: builds the client
cd native && npm ci
npm run sync                # stage the client into www/ and copy into both projects
npm run open:ios            # needs macOS and Xcode
npm run open:android        # needs Android Studio
```

## Distribution

- **Not the public App Store.** Apple Business Manager Custom Apps: private
  distribution, still Apple-reviewed, no public listing.
- **Android:** private Google Play scoped to the organisation's Workspace
  domain, or a signed APK through Intune or Jamf.
- **Signing keys never enter this repository.** The organisation holds them and
  signs the artifacts itself, so the public repository carries no privileged
  material and they control what ships under their name.
