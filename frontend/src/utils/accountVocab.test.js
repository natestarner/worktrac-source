import { describe, expect, it } from 'vitest';
import { accountVocab, capitalize } from './accountVocab';

// The server derives these (AccountVocab.java); this pins the CLIENT half, which is entirely about
// what happens when the server's answer is missing or partial. That is not a hypothetical: the auth
// snapshot outlives a deploy, so a browser holding yesterday's snapshot is the normal case for the
// first load after this ships.
describe('accountVocab', () => {

  it('passes through what the server sent', () => {
    expect(accountVocab({
      account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant',
    })).toEqual({
      account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant',
    });
  });

  // ⚠️ The load-bearing case. An auth snapshot written before `vocab` existed has no such key, and
  // the wrong-but-safe answer is the family nouns -- correct for every account that has one, and a
  // familiar word rather than `undefined` rendered into a sentence about who can see your workouts.
  it.each([[undefined], [null]])('falls back to the family nouns for %s', (missing) => {
    expect(accountVocab(missing)).toEqual({
      account: 'household',
      owner: 'household owner',
      member: 'family member',
      manager: 'co-parent',
    });
  });

  // A server that adds a fifth noun later hands older clients a partial object. One missing key
  // must not blank the others, which is why the fallback is per-key rather than all-or-nothing.
  it('fills in only the keys that are missing', () => {
    expect(accountVocab({ account: 'practice' })).toEqual({
      account: 'practice',
      owner: 'household owner',
      member: 'family member',
      manager: 'co-parent',
    });
  });

  // An empty string is missing, not a valid noun: it would render as a gap mid-sentence.
  it('treats an empty string as absent', () => {
    expect(accountVocab({ account: '' }).account).toBe('household');
  });
});

describe('capitalize', () => {

  it('capitalises only the first letter, leaving a two-word noun phrase intact', () => {
    expect(capitalize('household owner')).toBe('Household owner');
    expect(capitalize('trainer')).toBe('Trainer');
  });

  // Called on values that came from the fallback path, so it must not throw on nothing.
  it.each([[''], [undefined], [null]])('passes %s through untouched', (nothing) => {
    expect(capitalize(nothing)).toBe(nothing);
  });
});
