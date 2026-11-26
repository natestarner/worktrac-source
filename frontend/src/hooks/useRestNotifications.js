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
  const { restTimers, celebration } = useUI();
  const { people } = useAuth();
  const latest = useRef({ restTimers, people });
  latest.current = { restTimers, people };

  // Ask at the first rest that STARTS with nothing celebrating on screen -- the moment the question
  // makes sense, never at launch, and never on top of a celebration. A person's very first set
  // always raises its "First Barbell Bench Press" card, and iOS's alert landed right over it
  // (TestFlight 1.4 build 34, 2026-11-25: "that is a special time for them"). A rest that began
  // under a card is passed over for good, so dismissing the card does not raise the alert either;
  // the next set's rest asks instead. iOS shows the alert once per install, so this decides only
  // WHEN; the adapter makes repeat calls cheap.
  const latestStart = Object.values(restTimers ?? {}).reduce(
    (latest, t) => (t && !t.capped && t.startedAt > latest ? t.startedAt : latest),
    0,
  );
  const consideredStart = useRef(0);
  useEffect(() => {
    if (!latestStart || consideredStart.current === latestStart) return;
    consideredStart.current = latestStart;
    if (celebration) return;
    ensureRestNotificationPermission();
    // Keyed on the START, deliberately not on `celebration`: its closing must not re-ask.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestStart]);

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
