import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { registerOfflineMutationDefaults } from './queryClient';

// Every durable-write key that has EVER been persisted to an outbox, frozen as a literal on purpose.
//
// A write queued offline is stored by its mutation key and replayed by whatever handler the CURRENT
// build registers for that key (outboxPersistence.restoreOutbox -> getMutationDefaults). On the web
// a queued write meets a new build within hours of a deploy; in the App Store app it can be MONTHS,
// because the person updates when they update. So a key that is renamed or removed does not merely
// change -- every set still queued under the old name comes back with no handler and can never
// land.
//
// Deriving this list from queryClient.js would agree with any rename, which is exactly the mistake
// it exists to catch. Append to it; never edit or remove an entry. A key that is genuinely retired
// still needs a handler that can replay (or deliberately and visibly settle) what old builds queued.
// .claude/rules/api-compatibility.md has the rest of the rule.
const EVERY_SHIPPED_DURABLE_KEY = [
  ['logSet'],
  ['createExercise'],
  ['editSet'],
  ['deleteSet'],
  ['saveNote'],
  ['endWorkout'],
  ['favorite'],
];

describe('outbox compatibility across builds', () => {
  const client = new QueryClient();
  registerOfflineMutationDefaults(client);

  it.each(EVERY_SHIPPED_DURABLE_KEY.map((key) => [key[0], key]))(
    'still knows how to replay a %s queued by an older build',
    (_name, key) => {
      const defaults = client.getMutationDefaults(key);
      expect(typeof defaults.mutationFn).toBe('function');
    }
  );
});
