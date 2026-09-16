import { apiClient } from './client';

/**
 * Everyone this login can see, quietest first.
 *
 * ⚠️ The ZONE is sent, not assumed. "Days since" and "this week" mean the viewer's calendar, and
 * the server stores UTC — a client who trained at 9pm in a negative-offset zone is a day out
 * otherwise, which on the one screen about who has gone quiet is the difference between "yesterday"
 * and "two days ago".
 *
 * Resolved per call rather than cached at module load: a person can cross a timezone between
 * opening the app and opening this screen, and the cost is one Intl lookup.
 */
export function listRoster(weeks) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({ zone });
  if (weeks != null) params.set('weeks', String(weeks));
  return apiClient.get(`/api/account/roster?${params.toString()}`);
}
