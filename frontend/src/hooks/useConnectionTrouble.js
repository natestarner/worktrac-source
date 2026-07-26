import { useSyncExternalStore } from 'react';
import { reachabilityMonitor } from '../lib/reachabilityMonitor';

// Whether recent API calls have been consistently failing to reach a server while the browser
// still reports itself online -- see reachabilityMonitor.js for the "lie-fi" gap this covers.
export function useConnectionTrouble() {
  return useSyncExternalStore(reachabilityMonitor.subscribe, reachabilityMonitor.isTrouble, () => false);
}
