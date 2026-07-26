import { onlineManager } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomFieldEditorModal from './CustomFieldEditorModal';
import { updateCustomField } from '../../api/exercises';
import { useUI } from '../../context/UIContext';

vi.mock('../../api/exercises', () => ({ updateCustomField: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));

function renderModal(field = { id: 1, name: 'Seat height', value: '5' }) {
  return render(
    <CustomFieldEditorModal personId={1} exerciseId={2} field={field} onClose={vi.fn()} onSaved={vi.fn()} />,
  );
}

describe('CustomFieldEditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlineManager.setOnline(true);
    useUI.mockReturnValue({ showToast: vi.fn() });
  });
  afterEach(() => onlineManager.setOnline(true));

  it('saves the value while online', async () => {
    updateCustomField.mockResolvedValue({});
    renderModal();

    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateCustomField).toHaveBeenCalledWith(1, 2, 1, { value: '7' }));
  });

  it('still shows the current value while offline, but disables editing', () => {
    onlineManager.setOnline(false);
    renderModal();

    expect(screen.getByDisplayValue('5')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Editing needs a connection/)).toBeInTheDocument();
    expect(updateCustomField).not.toHaveBeenCalled();
  });
});
