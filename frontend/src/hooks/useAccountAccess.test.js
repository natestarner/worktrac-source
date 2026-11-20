import { describe, expect, it, vi } from 'vitest';
import { useAccountAccess } from './useAccountAccess';

const auth = vi.hoisted(() => ({ current: { membership: null, people: [] } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth.current }));

// The hook reads only useAuth(), so it can be called as a plain function here.
function useAccessAs(membership) {
  auth.current = { membership, people: [] };
  return useAccountAccess();
}

const OWNER_PERSON = 1;
const SELF = 2;
const KID = 3;

describe('useAccountAccess.canWritePerson', () => {
  it('lets an owner write everyone', () => {
    const access = useAccessAs({ accountRole: 'OWNER', personId: OWNER_PERSON });
    expect(access.canWritePerson(KID)).toBe(true);
    expect(access.canWritePerson(OWNER_PERSON)).toBe(true);
    expect(access.isOwner).toBe(true);
  });

  it('lets a member write only themselves', () => {
    const access = useAccessAs({ accountRole: 'MEMBER', personId: SELF, ownerPersonId: OWNER_PERSON });
    expect(access.canWritePerson(SELF)).toBe(true);
    expect(access.canWritePerson(KID)).toBe(false);
    expect(access.canWritePerson(OWNER_PERSON)).toBe(false);
  });

  // The trusted member: everyone but the owner's own person (PersonService's WRITE_ACCOUNT_OWNER).
  it('lets a trusted member write everyone except the owner', () => {
    const access = useAccessAs({ accountRole: 'MANAGER', personId: SELF, ownerPersonId: OWNER_PERSON, ownerName: 'Nate' });
    expect(access.canWritePerson(SELF)).toBe(true);
    expect(access.canWritePerson(KID)).toBe(true);
    expect(access.canWritePerson(String(OWNER_PERSON))).toBe(false);
    expect(access.isOwner).toBe(false);
    expect(access.isManager).toBe(true);
  });

  // An auth snapshot written before ownerPersonId existed: fail open, as the rest of the hook does.
  it('fails open for a trusted member whose snapshot predates ownerPersonId', () => {
    const access = useAccessAs({ accountRole: 'MANAGER', personId: SELF });
    expect(access.canWritePerson(OWNER_PERSON)).toBe(true);
  });

  it('treats "no person selected yet" as writable for everyone', () => {
    expect(useAccessAs({ accountRole: 'MANAGER', personId: SELF, ownerPersonId: OWNER_PERSON }).canWritePerson(null)).toBe(true);
    expect(useAccessAs({ accountRole: 'MEMBER', personId: SELF }).canWritePerson(undefined)).toBe(true);
  });
});

describe('useAccountAccess.readOnlyMessage', () => {
  it('names the owner when a trusted member looks at the owner', () => {
    const access = useAccessAs({ accountRole: 'MANAGER', personId: SELF, ownerPersonId: OWNER_PERSON, ownerName: 'Nate' });
    expect(access.readOnlyMessage(OWNER_PERSON)).toBe('Only Nate can change their own workouts.');
  });

  it('falls back to a phrase that names nobody when the owner has no name', () => {
    const access = useAccessAs({ accountRole: 'MANAGER', personId: SELF, ownerPersonId: OWNER_PERSON });
    expect(access.readOnlyMessage(OWNER_PERSON)).toBe('Only the account owner can change their own workouts.');
  });

  it('keeps the member wording for a member', () => {
    const access = useAccessAs({ accountRole: 'MEMBER', personId: SELF, ownerPersonId: OWNER_PERSON, ownerName: 'Nate' });
    expect(access.readOnlyMessage(KID)).toBe('You can only change your own workouts.');
  });
});
