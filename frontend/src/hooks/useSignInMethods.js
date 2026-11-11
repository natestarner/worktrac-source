import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { queryKeys } from '../api/queryKeys';
import { getSignInMethods } from '../api/socialSignIn';

/**
 * The signed-in LOGIN's own ways in: `{ hasPassword, connected: [{ provider, connectedAt,
 * lastUsedAt }], available: [...] }`, or undefined until it has loaded.
 *
 * Callers must treat undefined as "assume a password, nothing connected" -- today's behaviour --
 * so a device that has never loaded it (first open, offline) shows exactly what it always did,
 * and the server's own refusal (`NO_PASSWORD`, `APPLE_RECONFIRMATION_REQUIRED`) is what corrects
 * it. A read, so it never blocks anything.
 */
export function useSignInMethods() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.signInMethods(user?.id),
    queryFn: getSignInMethods,
    enabled: Boolean(user?.id),
    staleTime: 60_000,
  });
  return query;
}
