// Camera capture and barcode reading.
//
// Native BarcodeDetector is preferred where it exists: it is
// hardware-accelerated, free, and nothing has to be shipped for it. Where it
// does not, scanning is unavailable and the walk falls back to the keypad —
// the keypad is a first-class path, not a degraded one, because the whole
// point of Algorithm 1 is finishing an audit without reaching a barcode.

export type ScanEvent =
  | { kind: 'CODE'; value: string }
  // Several codes in one frame. Stacked devices sit close enough together that
  // this is routine, and silently taking the first one marks the wrong asset
  // scanned. The auditor picks.
  | { kind: 'AMBIGUOUS'; values: readonly string[] };

export interface Camera {
  readonly video: HTMLVideoElement;
  readonly hasTorch: boolean;
  setTorch(on: boolean): Promise<void>;
  stop(): void;
}

export function scanningAvailable(): boolean {
  return 'BarcodeDetector' in globalThis;
}

// A code held in frame is read many times a second. Two seconds is long enough
// that the auditor has moved to the next device, short enough that a genuine
// re-scan of the same device still registers.
const REPEAT_WINDOW = 2000;

// Ten frames a second is well past what a hand-held read needs and leaves the
// phone's battery to last a full audit.
const FRAME_INTERVAL = 100;

export async function openCamera(onScan: (event: ScanEvent) => void): Promise<Camera> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', focusMode: 'continuous' },
  });
  const track = stream.getVideoTracks()[0];
  if (track === undefined) throw new Error('camera returned no video track');

  const video = window.document.createElement('video');
  video.srcObject = stream;
  video.playsInline = true;
  await video.play();

  const detector = new BarcodeDetector();
  const seen = new Map<string, number>();
  let running = true;

  const read = async (): Promise<void> => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, FRAME_INTERVAL));
      if (!running) return;
      // A dropped frame is normal — the camera can be mid-focus or the page
      // backgrounded. Losing one costs 100ms; stopping the loop costs the walk.
      const codes = await detector.detect(video).catch(() => []);
      const now = Date.now();
      const fresh = codes
        .map((code) => code.rawValue)
        .filter((value) => (seen.get(value) ?? -Infinity) < now - REPEAT_WINDOW);
      if (fresh.length === 0) continue;
      for (const value of fresh) seen.set(value, now);
      const only = fresh[0];
      if (fresh.length === 1 && only !== undefined) onScan({ kind: 'CODE', value: only });
      else onScan({ kind: 'AMBIGUOUS', values: fresh });
    }
  };
  void read();

  // Comms rooms, under-desk labels and the bottom of a rack are dark, and an
  // auditor who cannot turn the light on stops using the camera entirely.
  const torch = navigator.mediaDevices.getSupportedConstraints().torch === true;

  return {
    video,
    hasTorch: torch,
    setTorch: (on) => track.applyConstraints({ advanced: [{ torch: on }] }),
    stop: () => {
      running = false;
      for (const t of stream.getTracks()) t.stop();
    },
  };
}
