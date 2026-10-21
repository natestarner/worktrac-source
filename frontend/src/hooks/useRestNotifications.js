import { useEffect, useRef } from 'react';
import { useUI } from '../context/UIContext';
import { useAuth } from '../context/AuthContext';
import {
  cancelRestNotifications,
  ensureRestNotificationPermission,
  scheduleRestNotifications,
} from '../lib/native';

// Leaves anything due sooner than this to the screen: the person is almost certainly still looking.
const MIN_LEAD_MS = 1000;

// Which rest timers should nudge the person, and when. A timer the person has turned off
// (restTimerEnabled false) never nudges, a capped one has nothing left to say, and one already full
// would fire the instant the app is backgrounded, which the ring on screen already said.
export function restNotificationsFor(restTimers, people, now) {
  const items = [];
  for (const [personId, timer] of Object.entries(restTimers ?? {})) {
    if (!timer || timer.capped) continue;
    const person = (people ?? []).find((p) => String(p.id) === String(personId));
    if (person && person.restTimerEnabled === false) continue;
    const dueAt = timer.startedAt + timer.targetSeconds * 1000;
    if (dueAt - now < MIN_LEAD_MS) continue;
    items.push({ personId, at: new Date(dueAt), name: person?.name ?? null });
  }
  return items;
}

// Mounted once, in AppShell. When the app goes to the background with a rest timer running, the
// device is asked to say "rest's up" at the moment the ring would have filled; coming back cancels
// it, because the ring is on screen again. Inside the App Store app only -- on the web every
// lib/native call here is a no-op, so this hook changes nothing there.
//
// Not a connectivity branch: notifications are local to the device and need no network at all.
export function useRestNotifications() {
  const { restTimers } = useUI();
  const { people } = useAuth();
  const latest = useRef({ restTimers, people });
  latest.current = { restTimers, people };

  // Ask the first time any rest timer starts -- the moment the question makes sense -- never at
  // launch. Idempotent: the library asks once per app session, iOS once per install.
  const anyRunning = Object.values(restTimers ?? {}).some((t) => t && !t.capped);
  useEffect(() => {
    if (anyRunning) ensureRestNotificationPermission();
  }, [anyRunning]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        const { restTimers: timers, people: everyone } = latest.current;
        scheduleRestNotifications(restNotificationsFor(timers, everyone, Date.now()));
      } else {
        cancelRestNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
