import { useOnlineStatus } from './useOnlineStatus';
import { useUI } from '../context/UIContext';

// Gate for actions that are deliberately online-only (Tier 3): account/person management, settings,
// exercise customization, exports, and retroactive past-workout entry. Rather than let these fail
// with a confusing error offline -- or, worse, queue a NON-idempotent write like createPastSession
// that would duplicate on replay -- wrap the handler so an offline attempt shows a uniform, calm
// "needs a connection" toast and does nothing else. `online` is returned too, for disabling the
// control up front so the gate is a backstop, not the only signal.
export function useRequireOnline() {
  const online = useOnlineStatus();
  const { showToast } = useUI();

  function requireOnline(action, message = 'You need a connection to do that.') {
    return (...args) => {
      if (!online) {
        showToast(message);
        return undefined;
      }
      return action(...args);
    };
  }

  return { online, requireOnline };
}
