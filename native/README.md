# Native shell

Empty on purpose, and that emptiness is the argument.

The PWA in `/client` is the real application. Capacitor is a shell that must
not be able to fork the codebase: every platform-specific call goes through
`/client/platform`, behind a dynamic import guarded by a runtime check, so the
browser build never loads — or even fetches — a line of Capacitor code.

`ios/` and `android/` are committed so a reviewer can see exactly what native
configuration exists. If either directory ever grows application logic rather
than build configuration, the browser-auditable property has been lost.

## What would force a shell to exist at all

1. **iOS haptics.** Safari has no vibration API, and auditors scan without
   looking at the screen.
2. **MDM deployment.** If the organisation pushes apps through Intune or Jamf,
   it may require a real package rather than a bookmarked PWA.

Both are five-minute questions for an endpoint team, and neither is answered
yet. Until one is, this stays empty.

## Distribution, when it happens

- **Not the public App Store.** Apple Business Manager Custom Apps: private
  distribution, still Apple-reviewed, no public listing.
- **Android:** private Google Play scoped to the organisation's Workspace
  domain, or a signed APK through Intune or Jamf.
- **Signing keys never enter this repository.** The organisation holds them and
  signs the artifacts itself, so the public repository carries no privileged
  material and they control what ships under their name.
