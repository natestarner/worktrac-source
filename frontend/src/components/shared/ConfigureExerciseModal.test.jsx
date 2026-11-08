import { onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigureExerciseModal from './ConfigureExerciseModal';
import { setPersistentNote } from '../../api/notes';
import { updateExerciseMuscles } from '../../api/exercises';

// Muscles worked on the household's own exercises: an online-only edit, offered to whoever may
// change them, handing the server's row back so the caller can update the cached catalog.
describe('ConfigureExerciseModal muscles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  function renderWithMuscles(exercise, accountAccess, onMusclesSaved = vi.fn(), onClose = vi.fn()) {
    access.current = accountAccess;
    render(
      <ConfigureExerciseModal
        exercise={exercise}
        personId={1}
        exerciseId={exercise.id}
        allTags={[]}
        appliedTagNames={[]}
        customFields={[]}
        onClose={onClose}
        onFieldsChanged={vi.fn()}
        onTagsChanged={vi.fn()}
        onExerciseChanged={vi.fn()}
        onRequestDelete={vi.fn()}
        muscles={{ primary: ['biceps'], secondary: [] }}
        onMusclesSaved={onMusclesSaved}
      />,
    );
    return onMusclesSaved;
  }

  it('lets the creator change them, and hands back the saved row', async () => {
    const updated = { id: 9, primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'] };
    updateExerciseMuscles.mockResolvedValue(updated);
    const onMusclesSaved = renderWithMuscles(
      { id: 9, name: 'My Curl', isGlobal: false, createdByYou: true, renamable: true },
      { isMember: true, ownerName: 'Nate' },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Chest and arms' }));
    expect(screen.getByRole('button', { name: 'Biceps: main' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forearms: not worked' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forearms: main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Update muscles' }));

    await waitFor(() => expect(updateExerciseMuscles).toHaveBeenCalledWith(9, { primary: ['biceps'], secondary: ['forearms'] }));
    await waitFor(() => expect(onMusclesSaved).toHaveBeenCalledWith(updated));
  });

  // Picking muscles and then closing reads as done -- nobody should have to find "Update muscles"
  // first. Both exits, and Escape, which Modal routes through the same onClose as the X.
  const MY_CURL = { id: 9, name: 'My Curl', isGlobal: false, createdByYou: true, renamable: true };
  const CREATOR = { isMember: true, ownerName: 'Nate' };

  function addForearms() {
    fireEvent.click(screen.getByRole('button', { name: 'Chest and arms' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forearms: not worked' }));
  }

  it.each([
    ['Done', () => fireEvent.click(screen.getByRole('button', { name: 'Done' }))],
    ['the X', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })],
  ])('saves an un-updated muscle edit when closed with %s', async (_label, close) => {
    const updated = { id: 9, primaryMuscles: ['biceps', 'forearms'], secondaryMuscles: [] };
    updateExerciseMuscles.mockResolvedValue(updated);
    const onClose = vi.fn();
    const onMusclesSaved = renderWithMuscles(MY_CURL, CREATOR, vi.fn(), onClose);

    addForearms();
    close();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateExerciseMuscles).toHaveBeenCalledWith(9, { primary: ['biceps', 'forearms'], secondary: [] });
    await waitFor(() => expect(onMusclesSaved).toHaveBeenCalledWith(updated));
  });

  it('closes without a write when nothing changed', () => {
    const onClose = vi.fn();
    renderWithMuscles(MY_CURL, CREATOR, vi.fn(), onClose);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateExerciseMuscles).not.toHaveBeenCalled();
  });

  it('does not save twice after "Update muscles" already did', async () => {
    updateExerciseMuscles.mockResolvedValue({ id: 9, primaryMuscles: ['biceps', 'forearms'], secondaryMuscles: [] });
    const onClose = vi.fn();
    renderWithMuscles(MY_CURL, CREATOR, vi.fn(), onClose);

    addForearms();
    fireEvent.click(screen.getByRole('button', { name: 'Update muscles' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Update muscles' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateExerciseMuscles).toHaveBeenCalledTimes(1);
  });

  // Closing never waits on the server, so a failed save must still be said out loud -- the modal
  // closing as if it saved would be the silently-lost outcome.
  it('closes anyway and says so when the save fails', async () => {
    const showToast = vi.fn();
    useUI.mockReturnValue({ showToast });
    updateExerciseMuscles.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const onClose = vi.fn();
    renderWithMuscles(MY_CURL, CREATOR, vi.fn(), onClose);

    addForearms();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Your muscle changes didn't save. Try again.", { tone: 'error' }),
    );
  });

  // Signal dropped between picking and closing: the gate's own connection message, then it closes.
  it('closes and says it needs a connection when signal dropped after the edit', () => {
    const showToast = vi.fn();
    useUI.mockReturnValue({ showToast });
    const onClose = vi.fn();
    renderWithMuscles(MY_CURL, CREATOR, vi.fn(), onClose);

    addForearms();
    act(() => onlineManager.setOnline(false));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateExerciseMuscles).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Editing needs a connection.', { tone: 'info' });
  });

  it('is not offered on a library exercise', () => {
    renderWithMuscles({ id: 1, name: 'Hammer Curl', isGlobal: true }, { isMember: false, ownerName: null });
    expect(screen.queryByRole('group', { name: 'Muscles worked' })).toBeNull();
  });

  it("is not offered to a member on somebody else's exercise", () => {
    renderWithMuscles(
      { id: 3, name: "Nate's Curl", isGlobal: false, createdByYou: false, createdByName: 'Nate', renamable: false },
      { isMember: true, ownerName: 'Nate' },
    );
    expect(screen.queryByRole('group', { name: 'Muscles worked' })).toBeNull();
  });
});
import { useUI } from '../../context/UIContext';

vi.mock('../../api/exercises', () => ({
  addCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  setExerciseTags: vi.fn(),
  updateExercise: vi.fn(),
  updateExerciseMuscles: vi.fn(),
}));

vi.mock('../../api/notes', () => ({
  setPersistentNote: vi.fn(),
}));

vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

const access = vi.hoisted(() => ({ current: {} }));
vi.mock('../../hooks/useAccountAccess', () => ({
  useAccountAccess: () => access.current,
}));

const asOwner = { isMember: false, ownerName: null };
const asMember = { isMember: true, ownerName: 'Nate' };

function renderModal(exercise, accountAccess = asOwner) {
  access.current = accountAccess;
  return render(
    <ConfigureExerciseModal
      exercise={exercise}
      personId={1}
      exerciseId={exercise.id}
      allTags={[]}
      appliedTagNames={[]}
      customFields={[]}
      onClose={vi.fn()}
      onFieldsChanged={vi.fn()}
      onTagsChanged={vi.fn()}
      onExerciseChanged={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
}

describe('ConfigureExerciseModal ownership', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
    access.current = asOwner;
  });
  afterEach(() => onlineManager.setOnline(true));

  it('shows "Created by you" plus rename + delete for your own exercise', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, createdByYou: true, renamable: true });

    expect(screen.getByText('Created by you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeInTheDocument();
  });

  it('shows "Preloaded exercise" and no rename/delete for a shared exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true });

    expect(screen.getByText('Preloaded exercise')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this exercise' })).not.toBeInTheDocument();
  });

  // The reported bug, both halves in one test: an owner opening a MEMBER's exercise used to be
  // told they created it, because `isGlobal` was standing in for authorship.
  it('names the real creator for an owner looking at a member’s exercise, and still lets them rename it', () => {
    renderModal({ id: 3, name: 'Yoke Carry', isGlobal: false, createdByYou: false, createdByName: 'Sam', renamable: true });

    expect(screen.getByText('Created by Sam')).toBeInTheDocument();
    expect(screen.queryByText('Created by you')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeInTheDocument();
  });

  it('gives a member the name as plain text, and says who to ask, on somebody else’s exercise', () => {
    renderModal(
      { id: 4, name: 'Yoke Carry', isGlobal: false, createdByYou: false, createdByName: 'Nate', renamable: false },
      asMember,
    );

    expect(screen.getByText('Created by Nate')).toBeInTheDocument();
    expect(screen.getByText('Only Nate or the account owner can rename this exercise.')).toBeInTheDocument();
    // The control is gone, not merely disabled -- and the name is still readable.
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Yoke Carry')).not.toBeInTheDocument();
    expect(screen.getByText('Yoke Carry')).toBeInTheDocument();
  });

  it('tells a member whose own exercise is now in use to ask the owner, and offers the alternative', () => {
    renderModal(
      { id: 5, name: 'Sled Push', isGlobal: false, createdByYou: true, createdByName: 'Sam', renamable: false },
      asMember,
    );

    expect(screen.getByText('Created by you')).toBeInTheDocument();
    expect(
      screen.getByText(/Other people have already logged this, so only Nate can rename it now/),
    ).toBeInTheDocument();
    expect(screen.getByText(/add your own exercise instead/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  // Delete is DELETE_SHARED_RESOURCE, which no member holds -- so it 403'd for every member on
  // every exercise, including ones they created.
  it('never offers Delete to a member, even on an exercise they created', () => {
    renderModal(
      { id: 6, name: 'Sled Push', isGlobal: false, createdByYou: true, renamable: true },
      asMember,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this exercise' })).not.toBeInTheDocument();
  });

  it('names nobody when the creator is unknown, rather than claiming "you"', () => {
    renderModal(
      { id: 7, name: 'Old Row', isGlobal: false, createdByYou: false, createdByName: null, renamable: false },
      asMember,
    );

    expect(screen.getByText('Household exercise')).toBeInTheDocument();
    expect(screen.queryByText('Created by you')).not.toBeInTheDocument();
    expect(
      screen.getByText('Only the person who added it or the account owner can rename this exercise.'),
    ).toBeInTheDocument();
  });

  // ⚠️ resilience.md axis D: a PersonExerciseDto cached before these fields existed has NEITHER of
  // them. It must degrade to the pre-change behaviour -- offer the control and let the server
  // refuse -- never to locking somebody out of renaming their own exercise. Test the UPGRADE path,
  // not just a fresh row.
  it('falls open on a row cached before these fields existed', () => {
    renderModal({ id: 8, name: 'My Curl', isGlobal: false }, asMember);

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('My Curl')).toBeInTheDocument();
    expect(screen.queryByText('Created by you')).not.toBeInTheDocument();
    expect(screen.getByText('Household exercise')).toBeInTheDocument();
  });
});

describe('ConfigureExerciseModal standing note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
    access.current = asOwner;
  });
  afterEach(() => onlineManager.setOnline(true));

  // Regression: Modal's default autofocuses the first real control, which for a preloaded
  // exercise (no Name field) IS the standing note textarea -- popping the mobile keyboard the
  // instant the modal opens, before anyone's seen what's in it. See Modal.jsx's initialFocus doc.
  it('does not autofocus the standing note textarea on open', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true, note: '' });

    expect(document.activeElement).not.toBe(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light'));
  });

  it('does not autofocus the name field on open, for the same reason', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });

    expect(document.activeElement).not.toBe(screen.getByDisplayValue('My Curl'));
  });

  it('prefills the existing standing note, even for a preloaded (global) exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true, note: 'Bar is loaded to 45lb' });

    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toHaveValue('Bar is loaded to 45lb');
  });

  it('saves the standing note on blur', async () => {
    setPersistentNote.mockResolvedValue({ note: 'Keep elbows tucked' });
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });

    const textarea = screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light');
    fireEvent.change(textarea, { target: { value: 'Keep elbows tucked' } });
    fireEvent.blur(textarea);

    await waitFor(() => expect(setPersistentNote).toHaveBeenCalledWith(1, 1, 'Keep elbows tucked'));
  });

  it('does not call the API when blurring without a change', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Already saved' });

    fireEvent.blur(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light'));

    expect(setPersistentNote).not.toHaveBeenCalled();
  });
});

describe('ConfigureExerciseModal offline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUI.mockReturnValue({ showToast: vi.fn() });
    // Must be an OWNER: these assert the Delete button is disabled, and it is hidden outright for
    // a member. They also happen to carry no createdByYou/renamable at all, which is the axis-D
    // fail-open path -- the Name input still renders, exactly as it did before those fields existed.
    access.current = asOwner;
  });
  afterEach(() => onlineManager.setOnline(true));

  it('still opens and shows the current name/note/tags/fields while offline', () => {
    onlineManager.setOnline(false);
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Go light' });

    expect(screen.getByDisplayValue('My Curl')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toHaveValue('Go light');
  });

  it('disables every edit control and shows an offline note while offline', () => {
    onlineManager.setOnline(false);
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: 'Go light' });

    expect(screen.getByText(/Editing needs a connection/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('My Curl')).toBeDisabled();
    expect(screen.getByPlaceholderText('e.g. Keep elbows tucked, bad knee — go light')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeDisabled();
  });

  it('re-enables every control once back online', () => {
    onlineManager.setOnline(false);
    const { rerender } = renderModal({ id: 1, name: 'My Curl', isGlobal: false, note: '' });
    onlineManager.setOnline(true);
    rerender(
      <ConfigureExerciseModal
        exercise={{ id: 1, name: 'My Curl', isGlobal: false, note: '' }}
        personId={1}
        exerciseId={1}
        allTags={[]}
        appliedTagNames={[]}
        customFields={[]}
        onClose={vi.fn()}
        onFieldsChanged={vi.fn()}
        onTagsChanged={vi.fn()}
        onExerciseChanged={vi.fn()}
        onRequestDelete={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Editing needs a connection/)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('My Curl')).not.toBeDisabled();
  });
});
