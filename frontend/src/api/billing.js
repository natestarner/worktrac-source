import { apiClient } from './client';

// Billing reads. The writes (checkout, portal) arrive with the Stripe integration and go through
// useGatedMutation -- they are Tier-3, non-idempotent, and must never enter the durable outbox.
export function getSubscription() {
  return apiClient.get('/api/billing/subscription');
}
