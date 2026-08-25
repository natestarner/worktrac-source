import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppSettingsTab from './AppSettingsTab';
import { createTag } from '../../api/tags';
import { updateDefaultUnit } from '../../api/account';
import { setRestTimerPreference } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';
import { __resetOfflineModeForTests, isOfflinePinned } from '../../lib/offlineMode';
import { listImports } from '../../api/dataImport';

// Every setting here is household-wide -- no dependence on which person is active. The rest timer
// is per-person but shown for everyone at once, persisted account-side (not localStorage).
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/tags', () => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  renameTag: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../../api/account', () => ({ updateDefaultUnit: vi.fn() }));
vi.mock('../../api/export', () => ({ downloadAllPeopleZip: vi.fn() }));
vi.mock('../../api/dataImport', () => ({ listImports: vi.fn(), undoImport: vi.fn() }));
vi.mock('../../api/people', () => ({ setRestTimerPreference: vi.fn() }));
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
});

describe('AppSettingsTab rest timer toggle', () => {
  let refreshPeople;

  beforeEach(() => {
    vi.clearAllMocks();
    listImports.mockResolvedValue([]);
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
});
