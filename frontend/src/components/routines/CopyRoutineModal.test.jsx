import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../test/queryWrapper';
import CopyRoutineModal from './CopyRoutineModal';
import { copyRoutine } from '../../api/routines';
import { queryKeys } from '../../api/queryKeys';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';

vi.mock('../../api/routines', () => ({ copyRoutine: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

const routine = { id: 5, name: 'Push Day' };

const people = [
  { id: 1, name: 'Nate' },
  { id: 2, name: 'Sam' },
  { id: 3, name: 'Jordan' },
];

describe('CopyRoutineModal', () => {
  const showToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({ people });
    useUI.mockReturnValue({ showToast });
    copyRoutine.mockResolvedValue([{ id: 6, name: 'Push Day' }]);
  });

  it('renders a checkbox for every other person, excluding the active person', () => {
    renderWithQuery(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: 'Sam' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Jordan' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Nate' })).not.toBeInTheDocument();
  });

  it('shows a validation message and does not call copyRoutine when nothing is selected', async () => {
    renderWithQuery(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Select at least one person.')).toBeInTheDocument();
    expect(copyRoutine).not.toHaveBeenCalled();
  });

  it('calls copyRoutine with the selected target ids and closes on success', async () => {
    const onClose = vi.fn();
    renderWithQuery(<CopyRoutineModal routine={routine} personId={1} onClose={onClose} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Jordan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(copyRoutine).toHaveBeenCalledWith(1, 5, [2, 3]));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a toast naming the target people on success', async () => {
    renderWithQuery(<CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Copied "Push Day" to Sam'));
  });

  it("invalidates each recipient's cached routines so the copy shows up immediately", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <QueryClientProvider client={queryClient}>
        <CopyRoutineModal routine={routine} personId={1} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Sam' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Jordan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(copyRoutine).toHaveBeenCalled());
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.routines(2) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.routines(3) });
    // The copying person's own routines aren't the ones that changed.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: queryKeys.routines(1) });
  });
});
