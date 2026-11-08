import { useAuth } from '../context/AuthContext';
import { useAccountAccess } from './useAccountAccess';
import { accountVocab } from '../utils/accountVocab';

// The account-wide muscle highlighter switch (AccountDto.muscleMapEnabled, V102), in the shape every
// place that would draw a body takes as its `muscleMap` prop.
//
// OFF unless the account says exactly `true`. A snapshot written before the field existed, a
// still-booting render and a signed-out one all read as off -- the default, and the answer that
// never draws a body somebody did not choose to show. Read from the auth snapshot, so it is the same
// on a cold offline boot as online; nothing here branches on connectivity.
export function useMuscleMap() {
  const { account } = useAuth();
  const { isOwner } = useAccountAccess();
  return {
    on: account?.muscleMapEnabled === true,
    // Only the owner can change it (MANAGE_HOUSEHOLD), so the note tells everyone else who can.
    canChange: isOwner,
    owner: accountVocab(account?.vocab).owner,
  };
}

// What a component draws when no caller passed a setting: OFF. A call site that forgets the prop
// shows the note, never a body.
export const MUSCLE_MAP_OFF = { on: false, canChange: true, owner: 'household owner' };
