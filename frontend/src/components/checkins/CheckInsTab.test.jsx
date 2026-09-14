import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckInsTab from './CheckInsTab';
import { addCheckIn, listCheckIns, removeCheckIn } from '../../api/checkIns';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import { useAccountAccess } from '../../hooks/useAccountAccess';
import { useUI } from '../../context/UIContext';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/checkIns', () => ({
  listCheckIns: vi.fn(),
  addCheckIn: vi.fn(),
  removeCheckIn: vi.fn(),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/AppStateContext', () => ({ useAppState: vi.fn() }));
vi.mock('../../hooks/useAccountAccess', () => ({ useAccountAccess: vi.fn() }));
// useGatedMutation reaches for the toast when a write fails; that is the path this file exercises.
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

const PRO_VOCAB = { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' };

// The draft lives in real React state so a change actually re-renders the component -- a plain
// variable would update but leave the Save button reading the stale (empty) draft, and every write
// test would fail on a disabled button rather than on what it means to assert.
let draft;
let clearCheckInDraft;

function signedInAs({ isMember = false, canWrite = true } = {}) {
  useAccountAccess.mockReturnValue({ isMember, canWritePerson: () => canWrite });
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CheckInsTab />
    </QueryClientProvider>,
  );
}

function entry(overrides = {}) {
  return {
    id: 1,
    enteredAt: '2026-09-14T10:00:00Z',
    bodyWeight: 180,
    bodyWeightUnit: 'lb',
    note: 'Felt strong',
    visibleToPerson: true,
    authorName: 'Nate',
    authoredByYou: true,
    ...overrides,
  };
}

describe('CheckInsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draft = null;
    clearCheckInDraft = vi.fn();
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb', vocab: PRO_VOCAB },
      people: [{ id: 1, name: 'Dana' }],
    });
    useAppState.mockImplementation(() => {
      const [held, setHeld] = useState(null);
      draft = held;
      return {
        activePersonId: 1,
        checkInDraft: held,
        // MERGES, mirroring the reducer: the component sends only the field that changed, and a
        // mock that replaced wholesale would pass while the real thing clobbered the other fields.
        setCheckInDraft: (patch) => {
          const merged = { bodyWeight: '', note: '', visibleToPerson: true, ...held, ...patch };
          draft = merged;
          setHeld(merged);
        },
        clearCheckInDraft: () => { clearCheckInDraft(); setHeld(null); },
      };
    });
    useUI.mockReturnValue({ showToast: vi.fn() });
    signedInAs();
    listCheckIns.mockResolvedValue([]);
    addCheckIn.mockResolvedValue({});
    removeCheckIn.mockResolvedValue({});
  });

  // ⚠️ THE LABEL RULE. This is the third note concept in the app; "Notes" already exists on other
  // screens and Playwright matches accessible names as a case-insensitive substring, so a control
  // called "note" here would break unrelated specs and read as a fourth concept.
  it('never uses the word note as a label', () => {
    renderTab();

    expect(screen.queryByText(/^note/i)).toBeNull();
    expect(screen.getByText(/Check-ins/)).toBeInTheDocument();
  });

  it('sends a weigh-in with the unit the account is set to', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText(/Body weight/), { target: { value: '182.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(addCheckIn).toHaveBeenCalledWith(1, expect.objectContaining({
      bodyWeight: 182.5,
      bodyWeightUnit: 'lb',
      visibleToPerson: true,
    })));
  });

  // ⚠️ A GATE OVER FREE TEXT WITHOUT A PRESERVED DRAFT IS THE SILENTLY-LOST OUTCOME the contract
  // forbids. Refusing this write offline is only acceptable because nothing typed is thrown away --
  // so the draft is cleared ONLY once the save has landed.
  it('keeps what was typed when the save fails', async () => {
    addCheckIn.mockRejectedValue(new Error('offline'));
    renderTab();

    fireEvent.change(screen.getByLabelText(/How did it go/), { target: { value: 'Knee sore' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(addCheckIn).toHaveBeenCalled());
    expect(clearCheckInDraft).not.toHaveBeenCalled();
    expect(draft.note).toBe('Knee sore');
  });

  it('clears the draft once the save lands', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText(/How did it go/), { target: { value: 'Good session' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(clearCheckInDraft).toHaveBeenCalled());
  });

  // An empty check-in records nothing, and the server refuses it with a 400 rather than letting the
  // DB constraint 500 and wedge the outbox. The button is disabled so it never gets that far.
  it('will not submit an entry with neither a weight nor anything written', () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'Save check-in' })).toBeDisabled();
  });

  // ⚠️ Only staff may keep something back. A person cannot hide an entry from themselves -- it is
  // meaningless, and it would create a place in the app their trainer can read but they cannot
  // un-write. The server forces this regardless, so the control is hidden rather than disabled.
  it('offers the keep-private control to a trainer', () => {
    renderTab();

    expect(screen.getByText(/Keep this to myself/)).toBeInTheDocument();
  });

  it('does not offer the keep-private control to a client', () => {
    signedInAs({ isMember: true });
    renderTab();

    expect(screen.queryByText(/Keep this to myself/)).toBeNull();
  });

  it('sends the private flag when a trainer ticks it', async () => {
    renderTab();

    fireEvent.change(screen.getByLabelText(/How did it go/), { target: { value: 'Watch the knee' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save check-in' }));

    await waitFor(() => expect(addCheckIn).toHaveBeenCalledWith(1, expect.objectContaining({
      visibleToPerson: false,
    })));
  });

  // ⚠️ The trainer's own signal that an entry is private. Without it they cannot tell, while
  // reading, which entries their client can see -- and would eventually write a private
  // observation into the visible slot.
  it('marks a private entry so the trainer can tell them apart', async () => {
    listCheckIns.mockResolvedValue([entry({ visibleToPerson: false, note: 'Knee still bothering her' })]);
    renderTab();

    expect(await screen.findByText(/only you/)).toBeInTheDocument();
  });

  it('shows no form at all on somebody this login cannot write to', () => {
    signedInAs({ canWrite: false });
    renderTab();

    expect(screen.queryByRole('button', { name: 'Save check-in' })).toBeNull();
  });
});
