// "Rest's up" as a local notification, for when the phone is locked or Huddle is in the background.
//
// The rest timer itself needs no help: it is wall-clock (UIContext's startedAt), so it is right the
// moment the app is looked at again. What the app cannot do while suspended is SAY so -- iOS freezes
// its JavaScript -- so the device is asked to say it at the time the timer would have filled.
//
// Web: every function is a no-op. Browsers have no reliable way to fire a notification from a
// suspended tab, and a web push service is not worth building for this.
//
// Failures here lose nothing: the timer, and every set logged, are untouched. A notification that
// could not be scheduled is a missing nudge, the same order of loss as a missing haptic.
import { isNativeApp } from './platform';

// Marks our notifications so cancelling never touches anything else the app might schedule later.
const REST_KIND = 'rest';

let permissionAsked = false;

async function plugin() {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return LocalNotifications;
}

// Asked the first time a rest timer starts, never at launch: the question only makes sense once
// the person is resting. iOS shows the prompt once; after that this just reads the answer.
export async function ensureRestNotificationPermission() {
  if (!isNativeApp() || permissionAsked) return;
  permissionAsked = true;
  try {
    const notifications = await plugin();
    const { display } = await notifications.checkPermissions();
    if (display === 'prompt' || display === 'prompt-with-rationale') {
      await notifications.requestPermissions();
    }
  } catch {
    // No permission means no nudge; the timer on screen is unaffected.
  }
}

// items: [{ personId, at: Date, name }]. Replaces whatever rest notifications were pending.
export async function scheduleRestNotifications(items) {
  if (!isNativeApp()) return;
  try {
    const notifications = await plugin();
    await cancelPending(notifications);
    if (items.length === 0) return;
    await notifications.schedule({
      notifications: items.map((item, index) => ({
        id: restNotificationId(item.personId, index),
        title: 'Rest’s up',
        body: item.name ? `${item.name}, time for your next set.` : 'Time for your next set.',
        schedule: { at: item.at, allowWhileIdle: true },
        extra: { kind: REST_KIND, personId: item.personId },
      })),
    });
  } catch {
    // Same as above: the nudge is lost, nothing else is.
  }
}

// Coming back to the app means the person can see the timer, so a pending nudge is redundant -- and
// one that fired later would be about a rest that may already be over.
export async function cancelRestNotifications() {
  if (!isNativeApp()) return;
  try {
    await cancelPending(await plugin());
  } catch {
    // A notification that still fires is about a rest the timer on screen also shows as done.
  }
}

async function cancelPending(notifications) {
  const { notifications: pending } = await notifications.getPending();
  const ours = pending.filter((n) => n.extra?.kind === REST_KIND).map((n) => ({ id: n.id }));
  if (ours.length > 0) await notifications.cancel({ notifications: ours });
}

// iOS wants a 32-bit integer id. Person ids are database ids; folding them into a fixed band keeps
// ours recognisable and away from any id another feature picks.
export function restNotificationId(personId, index = 0) {
  const n = Number(personId);
  return 700_000_000 + (Number.isFinite(n) ? n % 1_000_000 : index);
}
