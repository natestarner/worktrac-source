import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppSettingsTab from './AppSettingsTab';
import { createTag } from '../../api/tags';
import { setRestTimerPreference } from '../../api/people';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useTags } from '../../hooks/useTags';

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
vi.mock('../../api/people', () => ({ setRestTimerPreference: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useTags', () => ({ useTags: vi.fn() }));

describe('AppSettingsTab tag management', () => {
  let refetchTags;

  beforeEach(() => {
    vi.clearAllMocks();
    createTag.mockResolvedValue({ id: 1, name: 'Legs' });
    refetchTags = vi.fn().mockResolvedValue();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [], refreshPeople: vi.fn() });
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: refetchTags });
  });

  it('shows an error and does not add a tag when the name is blank', async () => {
    render(<AppSettingsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a tag name.')).toBeInTheDocument();
    expect(createTag).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'Legs' } });
    expect(screen.queryByText('Enter a tag name.')).not.toBeInTheDocument();
  });

  it('creates a tag once a name is provided', async () => {
    render(<AppSettingsTab />);

    fireEvent.change(screen.getByPlaceholderText('New tag name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(createTag).toHaveBeenCalledWith('Legs'));
    expect(refetchTags).toHaveBeenCalled();
  });

  it('no longer renders an exercises section', () => {
    render(<AppSettingsTab />);
    expect(screen.queryByRole('button', { name: '+ Add exercise' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search all exercises to add')).not.toBeInTheDocument();
  });
});

describe('AppSettingsTab rest timer toggle', () => {
  let refreshPeople;

  beforeEach(() => {
    vi.clearAllMocks();
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
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useTags.mockReturnValue({ tags: [], loading: false, refetch: vi.fn().mockResolvedValue() });
  });

  it('renders a toggle for every person and configures each independently', async () => {
    render(<AppSettingsTab />);

    // A per-person toggle for each household member, all shown at once.
    expect(screen.getByRole('button', { name: 'Rest timer Off for Nate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rest timer On for Sam' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rest timer Off for Nate' }));

    await waitFor(() => expect(setRestTimerPreference).toHaveBeenCalledWith(7, false));
    expect(setRestTimerPreference).not.toHaveBeenCalledWith(8, expect.anything());
    expect(refreshPeople).toHaveBeenCalled();
  });
});
