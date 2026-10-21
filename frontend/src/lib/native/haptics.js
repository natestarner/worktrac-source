// The app's half of lib/haptics.js: Apple's real haptic engine, which Safari can never reach.
//
// Returns true when it took the call (inside the app), false on the web so lib/haptics.js falls
// through to its existing navigator.vibrate / iOS-switch routes unchanged. The same decoration-only
// contract applies: fire and forget, and every failure is silence.
import { isNativeApp } from './platform';

export function nativeHaptic(pattern) {
  if (!isNativeApp()) return false;
  import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle, NotificationType }) =>
      pattern === 'celebrate'
        ? // A personal record: the system "success" pattern, the same two-beat shape as the web's.
          Haptics.notification({ type: NotificationType.Success })
        : // Finishing a workout: one soft tap, an acknowledgement rather than a fanfare.
          Haptics.impact({ style: ImpactStyle.Light })
    )
    // A haptic is decoration; it may never be the reason a celebration or an End failed. The
    // person loses nothing perceptible beyond a missing tick, and there is no one to report to.
    .catch(() => {});
  return true;
}
