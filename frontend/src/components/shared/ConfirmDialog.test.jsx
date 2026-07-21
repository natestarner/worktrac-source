import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UIProvider, useUI } from '../../context/UIContext';
import ConfirmDialog from './ConfirmDialog';

// Drives ConfirmDialog through a real openConfirm/runConfirm cycle (not the mocked useUI
// used by most other component tests) so the pending-state contract itself is verified,
// independent of any one caller (e.g. ExerciseDetail's delete-set flow).
function Harness({ onConfirm }) {
  const { openConfirm } = useUI();
  return (
    <>
      <button onClick={() => openConfirm('Delete this set?', onConfirm)}>open</button>
      <ConfirmDialog />
    </>
  );
}

function renderHarness(onConfirm) {
  return render(
    <UIProvider>
      <Harness onConfirm={onConfirm} />
    </UIProvider>,
  );
}

// A caller whose onConfirm is a genuine promise (e.g. ExerciseDetail's handleDeleteSet
// returning deleteSetMutation.mutateAsync(...), rather than the old fire-and-forget
// deleteSetMutation.mutate(...)) is what makes any of this observable: runConfirm awaits
// whatever onConfirm returns, so a fire-and-forget onConfirm would resolve the await -- and
// close the dialog -- on the next microtask regardless of these assertions.
describe('ConfirmDialog pending state', () => {
  it('stays open with Delete disabled+spinning until onConfirm settles, and keeps Cancel clickable', async () => {
    let resolveDelete;
    const onConfirm = vi.fn(() => new Promise((resolve) => { resolveDelete = resolve; }));
    renderHarness(onConfirm);

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument());
    // The dialog must not have closed yet -- the request is still in flight.
    expect(screen.getByText('Delete this set?')).toBeInTheDocument();
    // Cancel stays clickable even mid-request: a request paused offline could sit for a long
    // time, and the user must always be able to back out of the dialog.
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled();

    resolveDelete();
    await waitFor(() => expect(screen.queryByText('Delete this set?')).not.toBeInTheDocument());
  });

  it('closes immediately if Cancel is tapped while a delete is still pending', async () => {
    const onConfirm = vi.fn(() => new Promise(() => {})); // never resolves (simulates offline-paused)
    renderHarness(onConfirm);

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).not.toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete this set?')).not.toBeInTheDocument();
  });
});
