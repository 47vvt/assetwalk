// The only native-aware code in the project, alongside scanner.ts.
//
// The PWA is the real application; Capacitor is a shell that must not be able
// to fork the codebase. Every native call goes through a dynamic import behind
// a runtime check, so the browser build never loads — or even fetches — a line
// of Capacitor code.

// Auditors scan without looking at the screen, so confirmation has to arrive
// through some sense other than sight. Safari has no vibration API at all,
// which is the main thing that would force a native shell.
export async function confirmScan(): Promise<void> {
  if (window.Capacitor?.isNativePlatform?.() === true) {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    return Haptics.impact({ style: ImpactStyle.Medium });
  }
  navigator.vibrate?.(50);
  beep(880, 0.08);
}

export function rejectScan(): void {
  navigator.vibrate?.([40, 60, 40]);
  beep(220, 0.18);
}

let audio: AudioContext | null = null;

function beep(hz: number, seconds: number): void {
  // Constructed on first use: browsers refuse to create an AudioContext before
  // a user gesture, and the first beep always follows one.
  audio ??= new AudioContext();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = hz;
  gain.gain.setValueAtTime(0.15, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + seconds);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + seconds);
}
