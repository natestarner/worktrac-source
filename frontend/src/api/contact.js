import { apiClient } from './client';

// Tier-3 / online-only. The submit goes through useGatedMutation at the call site, never
// useDurableMutation: sending a message is not idempotent on replay, and the outbox retries
// forever across reloads and deploys, so a queued submission could reach the inbox repeatedly with
// no way for the person to see or cancel it.
export function sendContactMessage(payload) {
  return apiClient.post('/api/contact', payload);
}
