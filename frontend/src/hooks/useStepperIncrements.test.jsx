import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStepperIncrements } from './useStepperIncrements';

const people = [
  { id: 7, name: 'Nate', weightIncrement: 5, durationIncrementSeconds: 15 },
  { id: 8, name: 'Samuel', weightIncrement: 1, durationIncrementSeconds: 1 },
  // No increment fields at all -- the shape every person has in an auth snapshot written before
  // V79, which is the normal case on the first load after this deploys.
  { id: 9, name: 'Eli' },
  // A DECIMAL(5,2) does not always reach JSON as a number.
  { id: 10, name: 'Jonah', weightIncrement: '2.50', durationIncrementSeconds: '10' },
];

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ people, refreshPeople: vi.fn() }),
}));

describe('useStepperIncrements', () => {
  it('reads each person their own increments', () => {
    const nate = renderHook(() => useStepperIncrements(7)).result.current;
    expect(nate).toEqual({ weightIncrement: 5, durationIncrement: 15 });

    const samuel = renderHook(() => useStepperIncrements(8)).result.current;
    expect(samuel).toEqual({ weightIncrement: 1, durationIncrement: 1 });
  });

  // The upgrade path, not the fresh-profile one: a person row that predates the columns must read
  // as the values these steps were hardcoded to, never as undefined -- which would make every
  // step NaN on the app's most-used screen.
  it('falls back to the defaults when the person row predates the columns', () => {
    const { result } = renderHook(() => useStepperIncrements(9));
    expect(result.current).toEqual({ weightIncrement: 2.5, durationIncrement: 5 });
  });

  it('falls back for a person who is not in the list at all', () => {
    const { result } = renderHook(() => useStepperIncrements(404));
    expect(result.current).toEqual({ weightIncrement: 2.5, durationIncrement: 5 });
  });
});

describe('a DECIMAL that arrived as a string', () => {
  // Left as a string, stepping CONCATENATES: 135 + '2.50' is '1352.50', which then rounds to a
  // weight nobody asked for and is refused at the wire.
  it('is converted, so stepping adds rather than concatenates', () => {
    const { result } = renderHook(() => useStepperIncrements(10));

    expect(result.current).toEqual({ weightIncrement: 2.5, durationIncrement: 10 });
    expect(135 + result.current.weightIncrement).toBe(137.5);
  });
});
