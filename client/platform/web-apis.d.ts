// Ambient declarations for platform APIs TypeScript's DOM library does not yet
// describe. Nothing here implements anything — these are the shapes of browser
// and Capacitor APIs, narrowed to the members this project actually calls, so
// that using them does not require an `as`.

interface DetectedBarcode {
  readonly rawValue: string;
  readonly format: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats?: readonly string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

// Non-standard but universally implemented where a torch exists at all.
interface MediaTrackConstraintSet {
  torch?: boolean;
  focusMode?: string;
}

interface MediaTrackSupportedConstraints {
  torch?: boolean;
}

interface Window {
  // Present only inside a Capacitor shell. The browser build never defines it,
  // and never loads the code guarded by it.
  Capacitor?: { isNativePlatform?: () => boolean };
}

// Resolved from /native at shell build time and never installed for the
// browser build, so the import that uses it has to be described rather than
// imported. Narrowed to the one call this project makes.
declare module '@capacitor/haptics' {
  export const ImpactStyle: { readonly Medium: string };
  export const Haptics: { impact(options: { style: string }): Promise<void> };
}
