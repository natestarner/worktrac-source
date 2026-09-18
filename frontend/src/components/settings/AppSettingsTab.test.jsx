import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppSettingsTab from './AppSettingsTab';
import { createTag } from '../../api/tags';
import { setMemberVisibility, updateDefaultUnit } from '../../api/account';
import { setRestTimerPreference, setStepperIncrements } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';
import { __resetOfflineModeForTests, isOfflinePinned } from '../../lib/offlineMode';
import { listImports } from '../../api/dataImport';
import { getHistory, getHistoryWindow } from '../../api/sessions';

// Every setting here is household-wide -- no dependence on which person is active. The rest timer
// is per-person but shown for everyone at once, persisted account-side (not localStorage).
// Link is needed now that the Free-tier import prompt offers a route to the billing screen. A
// plain anchor keeps this mock as thin as it was -- the test asserts the href, not routing.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ to, children, ...rest }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../api/tags', () => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  renameTag: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../../api/account', () => ({ updateDefaultUnit: vi.fn(), setMemberVisibility: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadAllPeopleZip: vi.fn() }));
vi.mock('../../api/dataImport', () => ({ listImports: vi.fn(), undoImport: vi.fn() }));
vi.mock('../../api/sessions', () => ({ getHistory: vi.fn(), getHistoryWindow: vi.fn() }));
vi.mock('../../api/people', () => ({ setRestTimerPreference: vi.fn(), setStepperIncrements: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useTags', () => ({ useTags: vi.fn() }));

// The Data card participates in the query cache (an undo invalidates everything derived from
// sets), so the component needs a provider. One helper rather than a wrapper repeated per test.
function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppSettingsTab />
    </QueryClientProvider>,
  );
}

describe('AppSettingsTab tag management', () => {
  let refetchTags;

  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(true);
    createTag.mockResolvedValue({ id: 1, name: 'Legs' });
    refetchTags = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [], refreshPeople: vi.fn() });
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: refetchTags });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('shows an error and does not add a tag when the name is blank', async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a tag name.')).toBeInTheDocument();
    expect(createTag).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'Legs' } });
    expect(screen.queryByText('Enter a tag name.')).not.toBeInTheDocument();
  });

  it('creates a tag once a name is provided', async () => {
    renderTab();

    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTag).toHaveBeenCalledWith('Legs'));
    expect(refetchTags).toHaveBeenCalled();
  });

  it('no longer renders an exercises section', () => {
    renderTab();
    expect(screen.queryByRole('button', { name: '+ Add exercise' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search all exercises to add')).not.toBeInTheDocument();
  });

  // Settings is the one place these are reachable any time, not just at signup or checkout.
  it('links to Terms and Privacy Policy', () => {
    renderTab();

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://huddle.fitness/terms.html');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      'https://huddle.fitness/privacy.html',
    );
  });

  // The build stamp existed, but only inside Contact Us's "What gets sent" disclosure -- so finding
  // out which version you were on meant starting a bug report and expanding a panel. It is the
  // first thing any support conversation asks for. ("dev" is what APP_BUILD resolves to under
  // Vitest, which does not apply vite.config.js's define.)
  it('shows which build this is, without having to start a bug report', () => {
    renderTab();

    expect(screen.getByText(/^Huddle · build/)).toBeInTheDocument();
  });
});

describe('AppSettingsTab rest timer toggle', () => {
  let refreshPeople;

  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(true);
    refreshPeople = vi.fn().mockResolvedValue();
    setRestTimerPreference.mockResolvedValue({});
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [
        { id: 7, name: 'Nate', restTimerEnabled: true },
        { id: 8, name: 'Sam', restTimerEnabled: true },
      ],
      refreshPeople,
    });
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('renders a toggle for every person and configures each independently', async () => {
    renderTab();

    // A per-person toggle for each household member, all shown at once.
    expect(screen.getByRole('button', { name: 'Rest timer Off for Nate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rest timer On for Sam' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rest timer Off for Nate' }));

    await waitFor(() => expect(setRestTimerPreference).toHaveBeenCalledWith(7, false));
    expect(setRestTimerPreference).not.toHaveBeenCalledWith(8, expect.anything());
    expect(refreshPeople).toHaveBeenCalled();
  });
});

describe('AppSettingsTab offline mode toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(true);
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [], refreshPeople: vi.fn() });
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
  });

  afterEach(() => {
    __resetOfflineModeForTests();
    onlineManager.setOnline(true);
  });

  it('is a device-wide setting, not scoped to any person', () => {
    renderTab();
    expect(screen.getByRole('button', { name: 'Offline mode Off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Offline mode On' })).toBeInTheDocument();
  });

  it('pins the app offline when switched on, and back on when switched off', () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Offline mode On' }));
    expect(isOfflinePinned()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Offline mode Off' }));
    expect(isOfflinePinned()).toBe(false);
  });
});

describe('AppSettingsTab offline gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(false);
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [{ id: 7, name: 'Nate', restTimerEnabled: true }],
      refreshPeople: vi.fn(),
    });
    useUI.mockReturnValue({ openConfirm: (_msg, onConfirm) => onConfirm(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [{ id: 1, name: 'Legs' }], loading: false, refetch: vi.fn().mockResolvedValue() });
  });

  afterEach(() => onlineManager.setOnline(true));

  it('disables the unit, rest-timer, and tag controls but leaves the Offline Mode toggle itself enabled', () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'lb' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rest timer On for Nate' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    // The Offline Mode toggle itself is the one control that must keep working offline --
    // it's how someone gets back online, and it's a purely local setting either way.
    expect(screen.getByRole('button', { name: 'Offline mode Off' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Offline mode On' })).not.toBeDisabled();
  });

  it('does not call the API when clicking a disabled unit button', () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'lb' }));

    expect(updateDefaultUnit).not.toHaveBeenCalled();
  });

  // Importing is a Plus feature and the backend answers 403, so a Free household must get the
  // explanation INSTEAD of a control -- offering a button that cannot work is the "spinner over a
  // request that will never succeed" shape the degraded-conditions contract forbids.
  describe('the import entry point', () => {
    it('offers Plus instead of a button on a Free household', () => {
      useAuth.mockReturnValue({
        account: { defaultUnit: 'lb', plan: 'FREE' },
        people: [],
        refreshPeople: vi.fn(),
      });
      renderTab();

      expect(screen.queryByRole('button', { name: 'Import data' })).not.toBeInTheDocument();
      expect(screen.getByText(/Importing past workouts is part of Plus/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'See Plus' })).toHaveAttribute('href', '/app/billing');
    });

    it('offers the real control on a Plus household', () => {
      useAuth.mockReturnValue({
        account: { defaultUnit: 'lb', plan: 'PLUS' },
        people: [],
        refreshPeople: vi.fn(),
      });
      renderTab();

      expect(screen.getByRole('button', { name: 'Import data' })).toBeInTheDocument();
      expect(screen.queryByText(/part of Plus/)).not.toBeInTheDocument();
    });

    // EXPORTING IS NOT GATED, on either plan. This is the assertion that stops someone "tidying"
    // the two controls into one gate later: a household must always be able to take its own data
    // out, and the privacy policy's self-serve data rights depend on it.
    it('never gates exporting, even on Free', () => {
      useAuth.mockReturnValue({
        account: { defaultUnit: 'lb', plan: 'FREE' },
        people: [],
        refreshPeople: vi.fn(),
      });
      renderTab();

      expect(screen.getByRole('button', { name: 'Export all data' })).toBeInTheDocument();
    });

    // An auth snapshot written before billing shipped carries no plan. Showing the real control
    // and letting the server answer beats telling a paying household its import is unavailable.
    it('shows the control when the plan is unknown', () => {
      useAuth.mockReturnValue({
        account: { defaultUnit: 'lb' },
        people: [],
        refreshPeople: vi.fn(),
      });
      renderTab();

      expect(screen.getByRole('button', { name: 'Import data' })).toBeInTheDocument();
    });
  });
});

// A member's Settings is trimmed to what is actually theirs. Household-wide controls are hidden
// rather than greyed: they are MANAGE_HOUSEHOLD / DELETE_SHARED_RESOURCE / IMPORT_DATA /
// EXPORT_ACCOUNT_DATA, which a member can never hold, so a dead control would be pure noise.
describe('AppSettingsTab as a member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [{ id: 1, name: 'Push' }], isLoading: false });
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    useAuth.mockReturnValue({
      account: { id: 1, defaultUnit: 'lb', plan: 'PLUS' },
      membership: { accountRole: 'MEMBER', personId: 2, membersSeeEveryone: true },
      people: [
        { id: 1, name: 'Nate', isPrimary: true, restTimerEnabled: true },
        { id: 2, name: 'Samuel', isPrimary: false, restTimerEnabled: true },
      ],
      refreshPeople: vi.fn(),
    });
  });

  // The value is genuinely useful to them -- it is what their own new sets get recorded in --
  // while a dead switch communicates only that something is broken.
  it('shows the household unit as a value, not a toggle', async () => {
    renderTab();
    expect(await screen.findByText('Set by the household owner.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'kg' })).not.toBeInTheDocument();
  });

  // A sibling's rest-timer preference is not information a member needs, and their own row must
  // stay live -- turning the timer off mid-workout must not require the owner.
  it('shows only their own rest-timer row, still interactive', async () => {
    renderTab();
    await screen.findAllByText('Samuel');
    expect(screen.queryByText('Nate')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Rest timer Off for Samuel')).toBeEnabled();
  });

  it('hides the whole-household export and import section', async () => {
    renderTab();
    await screen.findAllByText('Samuel');
    expect(screen.queryByRole('button', { name: 'Export all data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import data' })).not.toBeInTheDocument();
  });

  // Creating and applying tags stays open to members. Deleting one they didn't create, or one
  // somebody else has already applied, is not -- `deletable` is the server's own answer to "would
  // DELETE succeed for me right now" (TagDto), so the client never re-derives that from raw ids.
  it('hides the delete control on a tag they cannot delete', async () => {
    useTags.mockReturnValue({ tags: [{ id: 1, name: 'Push', deletable: false }], isLoading: false });
    renderTab();
    expect(await screen.findByText('Push')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '\u00d7' })).not.toBeInTheDocument();
  });

  // The one they made, and nobody else has applied yet.
  it('shows the delete control on a tag the member may delete', async () => {
    useTags.mockReturnValue({ tags: [{ id: 1, name: 'Push', deletable: true }], isLoading: false });
    renderTab();
    expect(await screen.findByText('Push')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '\u00d7' })).toBeInTheDocument();
  });
});

// Pro's member-visibility toggle. The privacy claim on the pricing page is only as good as who is
// allowed to change it, so most of this is about who does NOT see the control.
describe('AppSettingsTab member visibility', () => {
  const PRO_VOCAB = { account: 'practice', owner: 'trainer', member: 'client', manager: 'assistant' };

  function signedInAs(accountRole, account) {
    useAuth.mockReturnValue({
      account,
      membership: accountRole ? { accountRole } : null,
      people: [],
      refreshPeople: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn() });
    setMemberVisibility.mockResolvedValue({});
  });
  afterEach(() => onlineManager.setOnline(true));

  it("offers the owner of a Pro account both states, in the account's own words", () => {
    signedInAs('OWNER', { defaultUnit: 'lb', plan: 'PRO', membersSeeEveryone: false, vocab: PRO_VOCAB });
    renderTab();

    expect(screen.getByText('Client privacy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Client privacy Private' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Client privacy Shared' })).toBeInTheDocument();
  });

  it('sends the new value when the owner switches to Shared', async () => {
    signedInAs('OWNER', { defaultUnit: 'lb', plan: 'PRO', membersSeeEveryone: false, vocab: PRO_VOCAB });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Client privacy Shared' }));

    await waitFor(() => expect(setMemberVisibility).toHaveBeenCalledWith(true));
  });

  // Clicking the state you are already in is a no-op rather than a redundant round trip -- the
  // same guard handleUnitSelect has.
  it('does not re-send the state the account is already in', () => {
    signedInAs('OWNER', { defaultUnit: 'lb', plan: 'PRO', membersSeeEveryone: false, vocab: PRO_VOCAB });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Client privacy Private' }));

    expect(setMemberVisibility).not.toHaveBeenCalled();
  });

  // THE IMPORTANT ONE. A MANAGER sees and writes every client, so it is tempting to treat them as
  // an owner -- and `isOwner` was literally `!isMember` until the role existed. Whether the clients
  // can see each other is a promise the account made to the people in it, and it belongs to
  // whoever made it. The server agrees (MANAGE_HOUSEHOLD is owner-only), so offering this would be
  // a control that 403s.
  it('does not offer it to a manager', () => {
    signedInAs('MANAGER', { defaultUnit: 'lb', plan: 'PRO', membersSeeEveryone: false, vocab: PRO_VOCAB });
    renderTab();

    expect(screen.queryByText('Client privacy')).not.toBeInTheDocument();
  });

  it('does not offer it to a member', () => {
    signedInAs('MEMBER', { defaultUnit: 'lb', plan: 'PRO', membersSeeEveryone: false, vocab: PRO_VOCAB });
    renderTab();

    expect(screen.queryByText('Client privacy')).not.toBeInTheDocument();
  });

  // Asking for the FEATURE, not the tier. A family plan cannot make its members private at all --
  // that is a promise Free and Plus make, enforced server-side with a 409.
  it('does not offer it on a family tier, even to the owner', () => {
    signedInAs('OWNER', { defaultUnit: 'lb', plan: 'PLUS', membersSeeEveryone: true, vocab: null });
    renderTab();

    expect(screen.queryByText(/privacy$/)).not.toBeInTheDocument();
  });
});


describe('AppSettingsTab stepper increments', () => {
  let refreshPeople;

  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    getHistory.mockResolvedValue([{ id: 1 }]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    onlineManager.setOnline(true);
    refreshPeople = vi.fn().mockResolvedValue();
    setStepperIncrements.mockResolvedValue({});
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [
        { id: 7, name: 'Nate', weightIncrement: 2.5, durationIncrementSeconds: 5 },
        { id: 8, name: 'Sam', weightIncrement: 1, durationIncrementSeconds: 30 },
      ],
      refreshPeople,
    });
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('configures each person independently, and sends the untouched increment back unchanged', async () => {
    renderTab();

    expect(screen.getByRole('button', { name: 'Weight step 10 lb for Nate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Time step 15s for Sam' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Weight step 5 lb for Nate' }));

    // Nate's current 5s duration rides along rather than being left out, so a partial payload can
    // never half-apply the pair.
    await waitFor(() => expect(setStepperIncrements).toHaveBeenCalledWith(7, 5, 5));
    expect(setStepperIncrements).not.toHaveBeenCalledWith(8, expect.anything(), expect.anything());
    expect(refreshPeople).toHaveBeenCalled();
  });

  it("changing the time keeps that person's own weight increment", async () => {
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Time step 10s for Sam' }));

    await waitFor(() => expect(setStepperIncrements).toHaveBeenCalledWith(8, 1, 10));
  });

  it('falls back to the defaults for a person row that predates the columns', async () => {
    useAuth.mockReturnValue({
      account: { defaultUnit: 'lb' },
      people: [{ id: 7, name: 'Nate' }],
      refreshPeople,
    });
    renderTab();

    fireEvent.click(screen.getByRole('button', { name: 'Time step 30s for Nate' }));

    await waitFor(() => expect(setStepperIncrements).toHaveBeenCalledWith(7, 2.5, 30));
  });

  it('is gated offline like every other Tier-3 setting', async () => {
    onlineManager.setOnline(false);
    renderTab();

    const pill = screen.getByRole('button', { name: 'Weight step 5 lb for Nate' });
    expect(pill).toBeDisabled();

    fireEvent.click(pill);
    expect(setStepperIncrements).not.toHaveBeenCalled();
  });
});

// Export shouldn't be offered as if there's something to download when there isn't -- it reads as
// unfinished rather than as "nothing here yet". This reuses the exact same signal HistoryTab's own
// Export data button already relies on (getHistory + the Free history window), fanned out across
// every person in the household.
describe('AppSettingsTab "Export all data" enablement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ openConfirm: vi.fn(), showToast: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  function withPeople(people) {
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people, refreshPeople: vi.fn() });
  }

  it('disables it when nobody in the household has ever logged a workout', async () => {
    getHistory.mockResolvedValue([]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    withPeople([{ id: 7, name: 'Nate' }, { id: 8, name: 'Sam' }]);
    renderTab();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export all data' })).toBeDisabled());
  });

  it('enables it once anyone in the household has logged a workout', async () => {
    getHistory.mockImplementation((personId) => Promise.resolve(personId === 8 ? [{ id: 1 }] : []));
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 0 });
    withPeople([{ id: 7, name: 'Nate' }, { id: 8, name: 'Sam' }]);
    renderTab();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export all data' })).not.toBeDisabled());
  });

  // A Free household's sessions before the window floor are simply absent from getHistory, but the
  // export itself is full-history and unclamped -- so there IS something to download even though
  // History's own list (and this same check on an empty getHistory alone) would say otherwise.
  it('enables it when a session exists only outside the Free history window', async () => {
    getHistory.mockResolvedValue([]);
    getHistoryWindow.mockResolvedValue({ hiddenSessions: 1 });
    withPeople([{ id: 7, name: 'Nate' }]);
    renderTab();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Export all data' })).not.toBeDisabled());
  });
});
