import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

// The single read surface for "is the app online?" across the UI (offline banner now; every
// "this needs a connection" gate later). Backed by TanStack Query's `onlineManager`, which already
// tracks `navigator.onLine` and subscribes to the window `online`/`offline` events -- so this hook,
// the query/mutation network behavior, and the banner all agree on one source of truth and flip the
// instant connectivity changes mid-session.
//
// (Server-reachable-but-down is a separate signal handled by the write outbox's failure taxonomy;
// this hook is specifically the browser's network state.)
export function useOnlineStatus() {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
    () => true, // SSR/first paint: assume online so nothing flashes an offline state pre-hydration
  );
}
