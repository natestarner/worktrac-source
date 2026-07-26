import { useSyncExternalStore } from 'react';
import { isOfflinePinned, subscribeOfflinePin } from '../lib/offlineMode';

// Whether the user has manually pinned the app into offline mode -- distinct from
// useOnlineStatus, which is also false for a genuine hard-down connection. Settings and the
// trouble/recovery banners need to tell those two apart.
export function useOfflinePin() {
  return useSyncExternalStore(subscribeOfflinePin, isOfflinePinned, () => false);
}
