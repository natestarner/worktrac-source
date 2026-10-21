// Keep the screen on during a workout, so it doesn't lock between sets on an iPad propped against a
// rack. iOS releases this itself whenever the app goes to the background, so it can never keep a
// phone in a pocket awake.
//
// Web: no-op. The web's Screen Wake Lock API exists but is unreliable in iOS home-screen apps, and
// adding it would change the web's behaviour; that is a separate decision from shipping the app.
import { isNativeApp } from './platform';

export async function keepScreenAwake() {
  if (!isNativeApp()) return;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.keepAwake();
  } catch {
    // The screen may lock between sets, exactly as it does today. Nothing is lost.
  }
}

export async function allowScreenSleep() {
  if (!isNativeApp()) return;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await KeepAwake.allowSleep();
  } catch {
    // Backgrounding the app releases it anyway.
  }
}
