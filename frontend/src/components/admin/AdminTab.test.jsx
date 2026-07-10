import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminTab from './AdminTab';
import { addCategory } from '../../api/categories';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { useCategories } from '../../hooks/useCategories';

vi.mock('../../api/categories', () => ({ addCategory: vi.fn(), removeCategory: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/useCategories', () => ({ useCategories: vi.fn() }));

describe('AdminTab category validation', () => {
  let refetchCategories;

  beforeEach(() => {
    vi.clearAllMocks();
    addCategory.mockResolvedValue({ id: 1 });
    refetchCategories = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, people: [], refreshPeople: vi.fn() });
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn() });
    useCategories.mockReturnValue({ categories: [], loading: false, refetch: refetchCategories });
  });

  it('shows an error and does not add a category when the name is blank', async () => {
    render(<AdminTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a category name.')).toBeInTheDocument();
    expect(addCategory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    expect(screen.queryByText('Enter a category name.')).not.toBeInTheDocument();
  });

  it('adds the category once a name is provided', async () => {
    render(<AdminTab />);

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addCategory).toHaveBeenCalledWith('Legs'));
    expect(refetchCategories).toHaveBeenCalled();
  });
});
