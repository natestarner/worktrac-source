import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppSettingsTab from './AppSettingsTab';
import { addCategory } from '../../api/categories';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { useExercises } from '../../hooks/useExercises';
import { useCategories } from '../../hooks/useCategories';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../api/categories', () => ({ addCategory: vi.fn(), removeCategory: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../context/UIContext', () => ({ useUI: vi.fn() }));
vi.mock('../../hooks/useExercises', () => ({ useExercises: vi.fn() }));
vi.mock('../../hooks/useCategories', () => ({ useCategories: vi.fn() }));

describe('AppSettingsTab category validation', () => {
  let refetchCategories;

  beforeEach(() => {
    vi.clearAllMocks();
    addCategory.mockResolvedValue({ id: 1 });
    refetchCategories = vi.fn();
    useAuth.mockReturnValue({ account: { defaultUnit: 'lb' }, refreshPeople: vi.fn() });
    useUI.mockReturnValue({ openConfirm: vi.fn() });
    useExercises.mockReturnValue({ exercises: [], loading: false, refetch: vi.fn() });
    useCategories.mockReturnValue({ categories: [], loading: false, refetch: refetchCategories });
  });

  it('shows an error and does not add a category when the name is blank', async () => {
    render(<AppSettingsTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Enter a category name.')).toBeInTheDocument();
    expect(addCategory).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    expect(screen.queryByText('Enter a category name.')).not.toBeInTheDocument();
  });

  it('adds the category once a name is provided', async () => {
    render(<AppSettingsTab />);

    fireEvent.change(screen.getByPlaceholderText('New category name'), { target: { value: 'Legs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(addCategory).toHaveBeenCalledWith('Legs'));
    expect(refetchCategories).toHaveBeenCalled();
  });
});
